"""Azure Blob Storage access.

This process is the ONLY thing in the system that can write or delete a
blob in any of the three containers (post-images, profile-pictures,
member-cvs). Next.js holds a read-only principal per container, used solely
to sign SAS URLs; the storage account key is not held anywhere, and
shared-key access is disabled on the account, so there is no connection
string that could leak.

Credentials here come from the VM's system-assigned managed identity via
DefaultAzureCredential, which means there are no storage secrets on disk at
all — the strongest single argument for running this on an Azure VM rather
than anywhere that would need a secret to be handed to it.
"""

from __future__ import annotations

from functools import lru_cache

from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError
from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient, ContentSettings

from .config import settings


class BlobAlreadyExists(Exception):
    """Something already occupies that key."""


@lru_cache(maxsize=1)
def _service() -> BlobServiceClient:
    cfg = settings()
    return BlobServiceClient(
        f"https://{cfg.storage_account}.blob.core.windows.net",
        credential=DefaultAzureCredential(),
        # The SDK default (20s) is unbounded enough to matter here: every
        # call through this client now runs inside asyncio.to_thread from
        # main.py, so a hung connection ties up a thread-pool slot rather
        # than the event loop — bounded, but still worth capping tightly
        # given uploads/deletes are small payloads, not long transfers.
        connection_timeout=10,
    )


def put_blob(
    container: str,
    key: str,
    data: bytes,
    *,
    content_type: str,
    content_disposition: str,
) -> None:
    """Write a sanitised blob. Create-only — never an overwrite.

    `overwrite=False` is the control that contains a leaked ticket secret.
    Without it, anyone holding the signing key could mint a ticket naming an
    existing key and replace another member's file in place, while the
    referencing row and the moderation/consent log both still described the
    original. With it, a forged or replayed ticket can only ever fail.

    Content-Type and Content-Disposition are always supplied by the caller
    from what it itself determined (sniffed magic bytes for Content-Type;
    a fixed policy per purpose for disposition) — never echoed from the
    request. The storage host must never serve a type or disposition the
    client had a hand in choosing.
    """
    blob = _service().get_blob_client(container, key)
    try:
        blob.upload_blob(
            data,
            overwrite=False,
            content_settings=ContentSettings(
                content_type=content_type,
                content_disposition=content_disposition,
                cache_control="private, max-age=3600",
            ),
        )
    except ResourceExistsError as exc:
        raise BlobAlreadyExists(key) from exc


def get_blob(container: str, key: str) -> bytes:
    """Read a blob back. Used by the ingest worker to re-fetch a member's CV
    for (re)processing — never by the gateway's own request handlers, which
    only ever write.

    No ResourceNotFoundError handling here: a caller asking for a key it
    doesn't already have on record (from a `cvs` row) is a bug in the
    caller, not an expected outcome to swallow.
    """
    blob = _service().get_blob_client(container, key)
    return blob.download_blob().readall()


def delete_blob(container: str, key: str) -> bool:
    """Delete one blob. Returns False when it was already gone.

    "Already gone" is not an error. A retried batch, a key the account
    lifecycle rule collected first, or an upload that never completed all
    reach here legitimately, and treating them as failures would retry the
    row to its dead-letter state while the bytes are in fact destroyed.
    """
    blob = _service().get_blob_client(container, key)
    try:
        blob.delete_blob()
        return True
    except ResourceNotFoundError:
        return False
