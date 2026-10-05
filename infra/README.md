# Infrastructure

Everything needed to stand up and run the upload gateway. Three scripts, two
config files, and no step that lives only in someone's head.

```
azure/provision.sh              creates the Azure side. Idempotent.
deploy.sh <ip> [--bootstrap]    sets up and ships to the VM. Run from anywhere.
vm/bootstrap.sh                 one-time VM setup. Called by deploy.sh, not by you.
vm/foundry-gateway.service      systemd unit
vm/nginx-foundry-gateway.conf   nginx origin server block
```

## First run

```bash
az account show                 # confirm you are in the RIGHT subscription
./infra/azure/provision.sh      # prints the VM IP and the Vercel variables
./infra/deploy.sh <vm-ip> --bootstrap
```

Then, in order: paste the Cloudflare origin certificate onto the VM (bootstrap
tells you where), set `AZURE_STORAGE_ACCOUNT` in `/etc/foundry/gateway.env`,
add the DNS record **proxied**, set the Vercel variables, and redeploy Vercel.

## Every deploy after that

```bash
./infra/deploy.sh <vm-ip>
```

Runs the gateway's test suite locally first and refuses to ship past a red
one — that suite *is* the security review for this service, so a deploy that
skipped it would be shipping past SVG rejection, EXIF stripping and JWT
algorithm confusion. Then it builds `server/` into a container image, pushes
it to `ghcr.io/icf-community/foundry-gateway`, has the VM pull and restart,
and curls `/health`. A failed build or push never touches the running
service — only a successful `docker pull` on the VM triggers the restart.
Needs `docker` and `gh` (authenticated) locally. The GHCR package stays
private — org policy blocks public package visibility even for an Owner
account — so the VM authenticates its own pulls with a scoped
`read:packages` token instead. See `infra/vm/bootstrap.sh`'s GHCR pull
credential section for how `/etc/foundry/ghcr-pull.env` gets created.

## What holds this together

**No storage credentials exist on the VM.** The system-assigned managed
identity carries `Storage Blob Data Contributor` scoped to the container, and
`DefaultAzureCredential` reads it from the instance metadata endpoint.
`/etc/foundry/gateway.env` contains two shared secrets and three plain
identifiers, and nothing that would let an attacker reach Azure from a
backup of that file.

**Vercel gets a different principal**, `Storage Blob Data Reader`, which can
fetch a user-delegation key and sign read URLs but cannot write or delete.
Full compromise of the Vercel environment cannot destroy or replace a member's
image.

**Neither holds the account key**, because it was disabled at the account
level. It cannot be scoped to one container, so the only safe thing to do with
it is turn it off.

**The origin is unreachable except through Cloudflare, and SSH isn't reachable
from the public internet at all.** The NSG admits 443 from Cloudflare's
published ranges only, so the DDoS protection cannot be bypassed by anyone who
discovers the IP. Cloudflare adds ranges occasionally — re-run `provision.sh`
when uploads start failing for everyone at once with no deploy behind it.
There is no port-22 rule, not even scoped to one IP — SSH goes over Tailscale
(`infra/vm/bootstrap.sh` installs it), which authenticates the connecting
*device* rather than a source IP, so access isn't tied to being on one
network. See `production-runbook.md` for the reasoning and the fallback if
Tailscale itself is ever unreachable.

**The resource group cannot be deleted by accident.** A `CanNotDelete` lock
sits on it from the moment it's created; removing it takes a deliberate
`az lock delete`, not a fat-fingered `az group delete`.

**Spend is watched, not just capped.** Set `BUDGET_ALERT_EMAIL` before
running `provision.sh` and it wires up a monthly budget that emails that
address at 80% and 100% of `BUDGET_AMOUNT` (default $60) — so a
misconfiguration shows up as an email, not a surprise on the bill.

**The gateway runs containerized, hardened at the Docker level.** systemd
runs `docker run` as root (Docker is the privilege boundary now, not a
systemd `User=`), but the container itself runs as a non-root user
(`server/Dockerfile`), read-only, with every capability dropped and a
memory/PID ceiling — replacing the process-level systemd sandboxing the
bare-metal gunicorn process used to carry directly. It uses `--network
host` rather than a published port, specifically so gunicorn's existing
`127.0.0.1`-only bind (and its trust of `X-Forwarded-For` from `127.0.0.1`)
keeps meaning exactly what it always did, with nginx as the only path in.
CI (`gateway-docker` in `ci.yml`) builds the image and runs a Trivy scan on
every push, so a vulnerable dependency or base-image CVE with an available
fix fails the build before it ever reaches `deploy.sh`.

## The compliance step you cannot skip

`provision.sh` disables blob soft-delete, container soft-delete and
versioning, then **re-reads them and aborts if any came back True**. Azure
turns all three on by default and all three retain "deleted" blobs. Left on, a
member exercising erasure would be told their image was destroyed while Azure
quietly kept it — the privacy policy would be false, and the deletion queue
would be doing nothing that matters.

## Ongoing

`unattended-upgrades` applies security patches by itself. Kernel updates need
a reboot: once a month, during a quiet window, `sudo reboot`. systemd brings
the gateway back. That is the standing cost of a VM over a managed host.

Re-running `deploy.sh --bootstrap` is the supported way to re-apply hardening
after an Ubuntu upgrade. It never regenerates the secrets in
`/etc/foundry/gateway.env` — doing so would invalidate every in-flight upload
ticket and desynchronise the gateway from Vercel until somebody noticed.

## Auto-deploy

`.github/workflows/deploy-gateway.yml` ships `server/**` and `infra/vm/**`
changes to the VM automatically on push to `main` (or via manual
`workflow_dispatch`) — runs the gateway tests, builds and pushes a SHA-tagged
image to GHCR, then signs in to Azure via OIDC federation (no stored secret —
see the `foundry-gateway-deploy` app registration in `production-runbook.md`)
and asks the Azure control plane (`az vm run-command`) to run
`infra/vm/foundry-release.sh` on the VM. Deliberately not SSH-based: the NSG
never opens port 22 to the internet at all (see above), and GitHub-hosted
runners come from a pool of thousands with no fixed IP range to allow even if
it did.

`infra/vm/foundry-release.sh` is the one place "pull, restart, verify health"
is implemented — both this workflow and a manual `deploy.sh` call it, so the
two paths can't drift apart. `infra/azure/provision.sh` is never run
automatically; new Azure resources stay a deliberate, human-run action.

## Rollback

The gateway and worker units run `:latest` and re-pull it on every start
(including a crash or reboot), so **asking a VM to run an older tag is not a
rollback**: the restart pulls `:latest` again. Point `:latest` at the build
you want first, then release it:

1. Find the last good commit SHA (GHCR keeps every SHA-tagged image).
2. Retag it as `:latest` in the registry. With a token that can write
   packages:
   `docker buildx imagetools create -t ghcr.io/icf-community/foundry-gateway:latest ghcr.io/icf-community/foundry-gateway:<sha>`
   (or run the deploy workflow via `workflow_dispatch` from a branch at that
   commit, which rebuilds and pushes it as `:latest`).
3. Release it: `foundry-release ghcr.io/icf-community/foundry-gateway:<sha>`
   on the gateway VM, `foundry-worker-release …:<sha>` on the worker VM
   (`az vm run-command`, as the workflow does).

Both release scripts compare the image the running container(s) actually use
with the requested ref and **fail** if they differ, so a step 3 without step
2 reports an error instead of a false `FOUNDRY_DEPLOY_OK` (D5, 2026-10-05).
After changing either script, copy it to `/usr/local/sbin/` on its VM.

