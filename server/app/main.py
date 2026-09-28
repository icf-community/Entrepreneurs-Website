"""Foundry upload gateway.

Three endpoints and a health check:

    POST /v1/images        member uploads an image (post/avatar), authorised
                            by a ticket
    POST /v1/documents      member uploads a CV, authorised by a ticket
    POST /v1/blobs/delete   the deletion drain removes keys, service-to-service
    GET  /health            liveness

Everything the gateway knows about identity arrives in a signed ticket. It
holds no database connection and no Supabase client, on purpose: the only
thing it can do is turn bytes into a sanitised WebP or a validated document
at a key it was told to use, in the one container that ticket's purpose
maps to, which keeps the blast radius of a compromise to this container.
"""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import FastAPI, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import observability
from .auth import InvalidTicket, TicketPurpose, is_valid_key, verify_service_token, verify_ticket
from .config import settings
from .documents import RejectedDocument
from .documents import sanitise as sanitise_document
from .images import AVATAR_MAX_EDGE, RejectedImage
from .images import sanitise as sanitise_image
from .storage import BlobAlreadyExists, delete_blob, put_blob

log = logging.getLogger("foundry.gateway")

# G2: errors only, with request bodies, headers and blob keys scrubbed
# (observability.py). No SENTRY_DSN, no Sentry.
observability.init_sentry("gateway")

# docs_url/redoc_url only hide the Swagger/ReDoc UI — openapi_url is a
# separate FastAPI setting and defaults to serving the raw schema
# regardless, which would hand an unauthenticated caller every route,
# parameter, and response shape this gateway has. Every endpoint is
# already documented in the module docstring above; nothing needs a
# machine-readable version of the same thing exposed at runtime.
app = FastAPI(title="Foundry upload gateway", docs_url=None, redoc_url=None, openapi_url=None)

# Locked to the app's own origins. This is what stops another site driving a
# signed-in member's browser into uploading on their behalf.
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings().allowed_origins),
    allow_credentials=False,
    allow_methods=["POST"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=600,
)

# Read size. Small enough that a hostile client cannot make us buffer much
# per iteration, large enough not to make a real upload chatty.
CHUNK = 64 * 1024

# B22: the delete body is bounded here, not only by nginx. 100 items of
# ~130 bytes each is about 13 KiB; 64 KiB leaves room without letting a
# holder of the service token make the handler buffer arbitrary input.
DELETE_BODY_MAX_BYTES = 64 * 1024


async def _read_json_capped(request: Request, limit: int) -> dict:
    """Read a JSON object body of at most `limit` bytes.

    Checks Content-Length first, then counts while streaming, so a chunked
    request without a length can't get past it either. Bad or non-object
    JSON is a 400, not the 500 request.json() used to raise.
    """
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > limit:
        raise HTTPException(status_code=413, detail="Request body too large.")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > limit:
            raise HTTPException(status_code=413, detail="Request body too large.")
    try:
        payload = json.loads(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Body must be JSON.") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object.")
    return payload


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


async def _read_capped(file: UploadFile, max_bytes: int) -> bytes:
    """Read with a running total, aborting the moment the cap is passed.

    Reading the whole body first and checking len() afterwards is the
    obvious version and it is a memory-exhaustion target: the cost is paid
    before the check runs, so an attacker sets the size. Content-Length is
    no help either — it is a claim by the client. Only counting what has
    actually arrived is a real limit.
    """
    body = bytearray()
    while chunk := await file.read(CHUNK):
        body.extend(chunk)
        if len(body) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File must be {max_bytes // (1024 * 1024)}MB or smaller.",
            )
    return bytes(body)


@app.post("/v1/images")
async def upload_image(
    file: UploadFile,
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    try:
        ticket = verify_ticket(authorization)
    except InvalidTicket as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    if ticket.purpose not in ("post_image", "profile_picture"):
        raise HTTPException(status_code=400, detail="That ticket is not valid for an image upload.")

    body = await _read_capped(file, ticket.max_bytes)
    if not body:
        raise HTTPException(status_code=400, detail="No image was uploaded.")

    # A profile picture is never shown larger than a small circle; the
    # feed's 1600px ceiling would store it four times larger than anything
    # will ever render it.
    # sanitise_image is CPU-bound (full decode, resize, WebP re-encode) and
    # synchronous. Called inline, it blocks this worker's whole event loop
    # for the duration — with two Uvicorn workers (gunicorn.conf.py), that
    # is a concurrency ceiling of exactly 2 for the entire process, image
    # uploads included. to_thread moves the decode/encode off the event
    # loop so a slow image does not stall every other in-flight request on
    # this worker, including this endpoint's own concurrent callers.
    max_edge = AVATAR_MAX_EDGE if ticket.purpose == "profile_picture" else None
    try:
        image = (
            await asyncio.to_thread(sanitise_image, body)
            if max_edge is None
            else await asyncio.to_thread(sanitise_image, body, max_edge=max_edge)
        )
    except RejectedImage as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc

    try:
        # put_blob is a synchronous, blocking Azure SDK call — same
        # concurrency-ceiling problem as sanitise_image above, and the SDK
        # gives no async client here, so to_thread is the same fix.
        await asyncio.to_thread(
            put_blob,
            ticket.container,
            ticket.key,
            image.data,
            content_type="image/webp",
            content_disposition="inline",
        )
    except BlobAlreadyExists as exc:
        # The ticket named a key that is already occupied. A member cannot
        # cause this — keys are fresh uuids — so it means a replayed or
        # forged ticket, and refusing is the whole point of create-only
        # writes. Logged at warning because it is worth someone seeing.
        log.warning("Rejected upload to an existing key (sub=%s)", ticket.sub)
        raise HTTPException(status_code=409, detail="That upload has already been used.") from exc
    except Exception as exc:  # noqa: BLE001
        log.exception("Blob write failed")
        raise HTTPException(status_code=502, detail="Storage is unavailable.") from exc

    return JSONResponse(
        {
            "key": ticket.key,
            "width": image.width,
            "height": image.height,
            "bytes": len(image.data),
        }
    )


@app.post("/v1/documents")
async def upload_document(
    file: UploadFile,
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    try:
        ticket = verify_ticket(authorization)
    except InvalidTicket as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    if ticket.purpose != "cv":
        raise HTTPException(status_code=400, detail="That ticket is not valid for a document upload.")

    body = await _read_capped(file, ticket.max_bytes)
    if not body:
        raise HTTPException(status_code=400, detail="No file was uploaded.")

    try:
        # sanitise_document now actually parses the PDF object graph
        # (pikepdf) rather than a byte search — the same
        # blocks-the-event-loop concern as sanitise_image above applies to
        # it now too, so it gets the same to_thread treatment.
        document = await asyncio.to_thread(sanitise_document, body)
    except RejectedDocument as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc

    try:
        await asyncio.to_thread(
            put_blob,
            ticket.container,
            ticket.key,
            document.data,
            content_type=document.content_type,
            # Never inline. A CV opened by clicking a link should download,
            # not render in-tab from a storage-account origin.
            content_disposition="attachment",
        )
    except BlobAlreadyExists as exc:
        log.warning("Rejected upload to an existing key (sub=%s)", ticket.sub)
        raise HTTPException(status_code=409, detail="That upload has already been used.") from exc
    except Exception as exc:  # noqa: BLE001
        log.exception("Blob write failed")
        raise HTTPException(status_code=502, detail="Storage is unavailable.") from exc

    return JSONResponse({"key": ticket.key, "bytes": len(document.data)})


@app.post("/v1/blobs/delete")
async def delete_blobs(
    request: Request,
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    """Destroy blobs on behalf of the deletion drain.

    This is a compliance path, not housekeeping: the keys arriving here
    belong to content — a post's image, a removed avatar, a replaced or
    deleted CV — a member has been told is gone. If it stops working, those
    bytes stay in their container.

    Each item names its own container, since blob_deletion_queue
    (20260901000002) now tracks that per row rather than assuming
    post-images for everything.
    """
    try:
        verify_service_token(authorization)
    except InvalidTicket as exc:
        raise HTTPException(status_code=401, detail="Forbidden") from exc

    payload = await _read_json_capped(request, DELETE_BODY_MAX_BYTES)
    items = payload.get("items")
    if not isinstance(items, list):
        raise HTTPException(status_code=400, detail="items must be a list.")
    if len(items) > 100:
        raise HTTPException(status_code=400, detail="At most 100 items per request.")

    valid_containers = set(settings().containers.values())
    purpose_by_container = {v: k for k, v in settings().containers.items()}

    parsed: list[tuple[str, str]] = []
    for item in items:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="Each item must be an object.")
        key = item.get("key")
        container = item.get("container")
        if not isinstance(container, str) or container not in valid_containers:
            raise HTTPException(status_code=400, detail="Each item needs a recognised container.")
        # Same rule as the upload path: a key becomes a path component, so
        # it is validated on arrival rather than trusted because the caller
        # held the service token. Holding that token means "you may delete
        # blobs in these containers", not "you may name any object in them".
        purpose: TicketPurpose = purpose_by_container[container]  # type: ignore[assignment]
        if not is_valid_key(key, purpose):
            raise HTTPException(status_code=400, detail="Each item needs a valid blob key.")
        parsed.append((container, key))

    # Up to 100 items, each a serial blocking Azure call — worst case (a
    # degraded storage connection) would otherwise stall this worker's
    # event loop for the whole batch, taking every other concurrent
    # request on it down too, /health included. to_thread moves each
    # delete off the loop; still sequential (delete_blob isn't
    # thread-safe to fan out further without its own client per thread),
    # but no longer blocking.
    deleted, missing = 0, 0
    for container, key in parsed:
        try:
            if await asyncio.to_thread(delete_blob, container, key):
                deleted += 1
            else:
                missing += 1
        except Exception:  # noqa: BLE001
            log.exception("Blob delete failed")
            raise HTTPException(status_code=502, detail="Storage is unavailable.") from None

    # `missing` is reported but is not a failure — see storage.delete_blob.
    return JSONResponse({"deleted": deleted, "missing": missing})
