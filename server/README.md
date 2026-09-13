# Foundry upload gateway

Sanitises member-uploaded images and writes them to Azure Blob Storage. Runs on an Azure VM behind
nginx; the Next.js app never sees image bytes.

```
POST /v1/images        one image, authorised by a short-lived signed ticket
POST /v1/blobs/delete  service-to-service, drives the deletion queue
GET  /health           liveness
```

**It holds no database connection and no Supabase client.** Everything it knows about identity
arrives in a 5-minute HS256 ticket minted by Next.js, which has already decided the member is
approved and within their rate limit. That split keeps authorisation in one place while keeping
image bytes off Vercel — and because the ticket format is ours rather than Supabase's, moving the
app to a different identity provider does not touch this service.

## Why each rule in `app/images.py` exists

Everything reaching `sanitise()` is attacker-controlled and everything leaving it is served to the
whole membership. Do not relax these without reading the tests that pin them:

- **Type comes from magic bytes.** The filename and `Content-Type` are supplied by the client and
  are never consulted.
- **SVG is rejected, not sanitised.** It is XML that can carry `<script>`; serving one from our own
  origin is a stored-XSS primitive.
- **Every upload is re-encoded to WebP.** This is what strips EXIF — including the GPS coordinates
  a phone writes into every photo — and what neutralises polyglot files. Original bytes are never
  stored.
- **`Image.MAX_IMAGE_PIXELS` is pinned.** A 50KB PNG can decode to tens of gigabytes.
- **Writes are create-only** (`overwrite=False`). This is what contains a leaked ticket secret: a
  forged ticket naming an existing key can only fail, never replace another member's image.

## Local development

```bash
# 3.12 deliberately: it is what CI runs and what Ubuntu 24.04 gives the VM.
# Testing on a newer interpreter than production is how a Pillow or PyJWT
# behaviour difference reaches the box unnoticed.
python3.12 -m venv venv && source venv/bin/activate
pip install -r requirements-dev.txt
pip install -e . --no-deps   # the app itself; deps already came from requirements-dev.txt
pytest                       # no Azure needed
uvicorn app.main:app --reload
```

`tests/` covers the sanitisation boundary and the auth surface directly. Storage is stubbed, so the
suite runs anywhere. This venv + pytest loop is still the fastest way to iterate — it's not being
replaced by Docker.

### CV ingest worker (Phase 1 of the CV matchmaker)

`app/worker.py` processes uploaded CVs — moderation, structured extraction, skill normalisation,
chunk+embed — per `cv-matchmaker-spec.md`. It also processes `scan_github` jobs (a member connecting
their GitHub account, `app/github_pipeline.py`) — a second, independent, optional signal that gets
folded into the same CV skill/summary pipeline. It is a separate process from the gateway above, on
purpose: a pathological CV must never be able to stall someone else's upload. Run it in a second
terminal, alongside `uvicorn app.main:app --reload`, never instead of it.

It does NOT need the gateway's full env — `UPLOAD_TICKET_SECRET`/`SERVICE_TOKEN`/`ALLOWED_ORIGINS` exist
only to verify/serve HTTP requests, which this process never does. It does need `AZURE_STORAGE_ACCOUNT`
(`config.storage_account()`, shared with the gateway — Storage access is via the VM's managed identity,
so this is an identifier, not a secret) plus its own vars, all fail-loud via `config.worker_settings()`:

| Variable | Notes |
|---|---|
| `AZURE_STORAGE_ACCOUNT` | Same value as the gateway's — not a secret, Storage access is via managed identity |
| `AZURE_CV_CONTAINER` | The one blob container this process ever reads (member-uploaded CVs) — not a secret, just an identifier |
| `DATABASE_URL` | Direct Postgres connection. Local Supabase: `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| `OPENAI_API_KEY` | Used for moderation, extraction, and embedding calls. Not `server/.env`'s key — see below |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | Decrypts `github_connections.access_token_encrypted` (pgcrypto `pgp_sym_decrypt`). Must be the exact same value as the Next.js app's `GITHUB_TOKEN_ENCRYPTION_KEY` (it's what encrypted the token in the first place) — never persisted in the database itself |

```bash
# one-time, after `supabase start` + `supabase db reset` have applied the
# CV matchmaker migration, and with DATABASE_URL/OPENAI_API_KEY exported:
python scripts/seed_skills.py

# then, in its own terminal, alongside uvicorn:
python -m app.worker
```

`scripts/seed_skills.py` loads `scripts/skills_seed.csv` — a small hand-picked ~180-skill list for
local testing, not the full ESCO taxonomy the spec describes for production. Swapping in the real
ESCO download later needs no code change: point the script at a different CSV with the same
`canonical_name` column.

`server/.env`'s `OPENAI_API_KEY` is flagged elsewhere in this file as an unrelated leftover — for
local worker testing, put a real key in `.env.gateway.local` instead (loaded the same way the
gateway's other local env vars are), or export both `DATABASE_URL` and `OPENAI_API_KEY` directly
in the shell running `python -m app.worker`.

### Adding or upgrading a dependency

Dependencies are pinned in `requirements.txt` (runtime) and `requirements-dev.txt` (adds
test-only packages on top). There is no dependency list in `pyproject.toml` — that file now
holds only build/packaging metadata and the pytest config.

To add or upgrade one, regenerate the full pinned closure rather than hand-editing transitive
versions:

```bash
python3.12 -m venv /tmp/freeze-venv
/tmp/freeze-venv/bin/pip install --upgrade pip
/tmp/freeze-venv/bin/pip install .                 # add the new package to setup below first
/tmp/freeze-venv/bin/pip freeze --exclude-editable | grep -v '^foundry-gateway' > requirements.txt
```

Since dependencies no longer live in `pyproject.toml`, "installing the package" to pick up a new
one means installing it directly into the throwaway venv (`pip install . new-package==x.y.z`)
before freezing. Then re-derive `requirements-dev.txt`'s dev-only lines (`pytest`, `httpx2`, and
whatever they pull in) the same way, on top of that same venv. Review the resulting diff — a
version bump you didn't ask for anywhere in the closure is worth understanding before committing.

**Running the built image locally**, to check the actual artifact `infra/deploy.sh` ships (not just
the source): `docker compose up gateway` runs it as production does; `docker compose --profile dev
up gateway-dev` bind-mounts `app/` and runs `uvicorn --reload` for fast iteration inside a
container. Both read env vars from a git-ignored `.env.gateway.local` (see the table below for what
to put in it — not `server/.env`, which holds an unrelated leftover key, not gateway config).

## Deploying to the VM

The full provisioning runbook — storage account, NSG rules, managed identity, nginx, TLS — is in
`infra/README.md`. The gateway itself ships as a container image
(`ghcr.io/icf-community/foundry-gateway`), built and pushed by `infra/deploy.sh`; the VM pulls and
restarts. The parts that live here:

**Systemd unit** (`/etc/systemd/system/foundry-gateway.service`):

```ini
[Unit]
Description=Foundry upload gateway
After=network.target docker.service
Requires=docker.service

[Service]
EnvironmentFile=/etc/foundry/gateway.env
Environment=GATEWAY_IMAGE=ghcr.io/icf-community/foundry-gateway:latest
ExecStartPre=/usr/bin/docker pull ${GATEWAY_IMAGE}
ExecStartPre=-/usr/bin/docker rm -f foundry-gateway
ExecStart=/usr/bin/docker run --rm --name foundry-gateway \
  --network host \
  --env-file /etc/foundry/gateway.env \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop=ALL --security-opt=no-new-privileges \
  --memory=512m --pids-limit=256 \
  ${GATEWAY_IMAGE}
ExecStop=/usr/bin/docker stop -t 35 foundry-gateway
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Runs as root (Docker is the privilege boundary now, not a systemd `User=`) — the container itself
runs as the non-root `gateway` user (`Dockerfile`), read-only, with every capability dropped. See
`infra/README.md` for the full reasoning, including why this uses `--network host` rather than a
published port.

**Environment** (`/etc/foundry/gateway.env`, mode 600):

| Variable | Notes |
|---|---|
| `UPLOAD_TICKET_SECRET` | Must match the Vercel env of the same name |
| `SERVICE_TOKEN` | Must match Vercel's `GATEWAY_SERVICE_TOKEN` |
| `AZURE_STORAGE_ACCOUNT` | Account name, not a URL |
| `AZURE_BLOB_CONTAINER` | `post-images` |
| `ALLOWED_ORIGINS` | Comma-separated. No wildcard default — CORS is what stops another origin driving a member's browser into uploading |
| `MAX_UPLOAD_BYTES` | Optional, defaults to 8MB |
| `GATEWAY_WORKERS` | Optional, defaults to 2 — raise with the VM's core count |
| `GATEWAY_TIMEOUT` | Optional, defaults to 60s |
| `GATEWAY_MAX_REQUESTS` | Optional, defaults to 1000 before a worker recycles |
| `GATEWAY_LOG_LEVEL` | Optional, defaults to `info` |

The first five are required and fail loudly if absent. The `GATEWAY_*` four are
process tuning read by `gunicorn.conf.py`; a malformed value there falls back
to the documented default rather than refusing to boot, because losing the
service to a typo in a tuning parameter is the worse outcome.

**No Azure credentials go in this file.** The VM's system-assigned managed identity carries
`Storage Blob Data Contributor` on the container, and `DefaultAzureCredential` reads it from the
instance metadata endpoint — so there are no storage secrets on disk at all. Every value above
fails loud if missing; there are no fallbacks.

**nginx** needs `client_max_body_size 10m;`. The default is 1MB, which would reject uploads at a
size the gateway is configured to accept.

## Not in scope here

`server/server.py` holds unimplemented CV stubs (`/cv-store`, `/cv-retrieve`) left over from before
the CV matchmaker's real ingest pipeline (`app/worker.py`, `app/cv_pipeline.py`) was built — it is
still dead code, not part of this service. `server/ai-agent/` (Phase 2 of `cv-matchmaker-spec.md`,
the conversational agent) is still empty and deliberately untouched by the Phase 1 ingest work
above — Phase 2 is a separate, later build with its own, stricter isolation requirements (its own
service/VM, no Blob credential — see the spec).
