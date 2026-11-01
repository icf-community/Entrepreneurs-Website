import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { psql } from "./ai-services";

// ════════════════════════════════════════════════════════════════════
// Foundry · CV upload through the real UI (AI-plan §14.4, gap 24).
//
// cv-upload.spec.ts is the only spec that needs this: a real browser
// upload, through the real FastAPI gateway, into a real (local) blob
// store. storage.py refuses AZURE_STORAGE_CONNECTION_STRING unless its
// BlobEndpoint host is local — same shape as fake_provider.assert_local
// — so this can never point anywhere but Azurite.
// ════════════════════════════════════════════════════════════════════

const SERVER = join(__dirname, "..", "..", "server");
const PYTHON = process.env.E2E_PYTHON ?? join(SERVER, "venv", "bin", "python");
const GATEWAY_PASSWORD = "cv_worker-gateway-local";

const AZURITE_CONTAINER = "foundry-e2e-azurite";
const AZURITE_PORT = 10000;
// Azurite's well-known well-published devstoreaccount1 key — not a secret,
// documented by Microsoft, and only ever reachable at 127.0.0.1 here.
const AZURITE_CONNECTION_STRING =
  "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;" +
  "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;" +
  `BlobEndpoint=http://127.0.0.1:${AZURITE_PORT}/devstoreaccount1;`;
const CV_CONTAINER = "member-cvs";

export const GATEWAY_URL = "http://127.0.0.1:8000";
export const TICKET_SECRET = "e2e-cv-upload-ticket-secret";

function dbUrl(): string {
  const url = process.env.E2E_DB_URL;
  if (!url) throw new Error("E2E_DB_URL is not set — run through scripts/e2e-local.sh.");
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error(`refuses to run against ${host}`);
  return url;
}

function asRole(role: string, password: string): string {
  const u = new URL(dbUrl());
  u.username = role;
  u.password = password;
  u.searchParams.set("sslmode", "disable");
  return u.toString();
}

function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      void fetch(url)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() - started > timeoutMs) reject(new Error(`timed out waiting for ${url}`));
          else setTimeout(attempt, 300);
        });
    };
    attempt();
  });
}

/** Starts a local Azurite container and creates the one container this
 *  spec needs. Returns a closure that stops it. */
export async function startAzurite(): Promise<() => void> {
  try {
    execFileSync("docker", ["rm", "-f", AZURITE_CONTAINER], { stdio: "ignore" });
  } catch {
    // Nothing to remove — the common case.
  }
  execFileSync("docker", [
    "run", "-d", "--rm", "--name", AZURITE_CONTAINER,
    "-p", `${AZURITE_PORT}:${AZURITE_PORT}`,
    "mcr.microsoft.com/azure-storage/azurite",
    "azurite-blob", "--blobHost", "0.0.0.0", "--skipApiVersionCheck",
  ]);
  await waitForHttp(`http://127.0.0.1:${AZURITE_PORT}/devstoreaccount1?comp=list`, 20_000);

  execFileSync(PYTHON, ["-c", CREATE_CONTAINER_PY, AZURITE_CONNECTION_STRING, CV_CONTAINER]);

  return () => {
    try {
      execFileSync("docker", ["rm", "-f", AZURITE_CONTAINER], { stdio: "ignore" });
    } catch {
      // Already gone.
    }
  };
}

const CREATE_CONTAINER_PY = `
import sys
from azure.storage.blob import BlobServiceClient
from azure.core.exceptions import ResourceExistsError
svc = BlobServiceClient.from_connection_string(sys.argv[1])
try:
    svc.create_container(sys.argv[2])
except ResourceExistsError:
    pass
`;

/** Starts the real FastAPI gateway (app.main) and the CV ingest worker
 *  (app.worker, scoped to ingest_cv), both pointed at Azurite with the
 *  fake OpenAI provider. Returns a closure that stops both. */
export function startGatewayAndWorker(appOrigin: string): () => void {
  psql(`alter role cv_worker password '${GATEWAY_PASSWORD}'`);

  const common = { ...process.env, PYTHONUNBUFFERED: "1", SENTRY_DSN: "" };
  const gatewayEnv = {
    ...common,
    UPLOAD_TICKET_SECRET: TICKET_SECRET,
    SERVICE_TOKEN: "unused",
    AZURE_BLOB_CONTAINER: "post-images",
    AZURE_AVATAR_CONTAINER: "profile-pictures",
    AZURE_CV_CONTAINER: CV_CONTAINER,
    ALLOWED_ORIGINS: appOrigin,
    AZURE_STORAGE_CONNECTION_STRING: AZURITE_CONNECTION_STRING,
  };
  const workerEnv = {
    ...common,
    DATABASE_URL: asRole("cv_worker", GATEWAY_PASSWORD),
    OPENAI_PROVIDER: "fake",
    WORKER_JOB_KINDS: "ingest_cv",
    OPENAI_API_KEY: "unused",
    GITHUB_TOKEN_ENCRYPTION_KEY: "unused",
    GITHUB_OAUTH_CLIENT_ID: "unused",
    GITHUB_OAUTH_CLIENT_SECRET: "unused",
    AZURE_CV_CONTAINER: CV_CONTAINER,
    AZURE_STORAGE_CONNECTION_STRING: AZURITE_CONNECTION_STRING,
  };

  const procs: ChildProcess[] = [
    spawn(PYTHON, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"], {
      cwd: SERVER,
      env: gatewayEnv,
      stdio: ["ignore", "inherit", "inherit"],
    }),
    spawn(PYTHON, ["-m", "app.worker"], {
      cwd: SERVER,
      env: workerEnv,
      stdio: ["ignore", "inherit", "inherit"],
    }),
  ];
  return () => {
    for (const p of procs) p.kill("SIGTERM");
  };
}

/** A real, minimal one-page PDF with recognisable text, via the server
 *  venv's PyMuPDF — cv_sanitise.py extracts with PyMuPDF too, so this
 *  exercises the actual extraction path, not just the "%PDF-" magic-byte
 *  sniff in documents.py. */
export function makeSamplePdf(): string {
  const path = join(mkdtempSync(join(tmpdir(), "foundry-cv-")), "cv.pdf");
  execFileSync(PYTHON, ["-c", MAKE_PDF_PY, path]);
  return path;
}

const MAKE_PDF_PY = `
import sys
import pymupdf as fitz
doc = fitz.open()
page = doc.new_page()
# Long enough to clear the worker's minimum (cv_sanitise.MIN_EXTRACTED_CHARS = 200): a CV
# shorter than that is refused as "not enough extractable text", which is the right
# behaviour for a scan but made a one-line sample fail without anyone noticing.
lines = [
    "Jordan Example",
    "Software Engineer, Imperial College London",
    "Summary: Full-stack engineer with four years of experience building web products.",
    "Experience: Built a React and Python platform used by two thousand students;",
    "designed the SQL schema, wrote the Docker deployment, and ran the on-call rota.",
    "Projects: A recommendation service in Python and PyTorch; a React dashboard for founders.",
    "Skills: Python, React, SQL, Docker, TypeScript, PostgreSQL, Git",
    "Education: MEng Computing, Imperial College London",
]
y = 72
for line in lines:
    page.insert_text((72, y), line)
    y += 18
doc.save(sys.argv[1])
`;

/** Names of the blobs currently in the CV container (Azurite). Lets a spec
 *  prove that a refused upload stored nothing. */
export function listCvBlobs(): string[] {
  const out = execFileSync(PYTHON, ["-c", LIST_BLOBS_PY, AZURITE_CONNECTION_STRING, CV_CONTAINER], { encoding: "utf8" });
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

const LIST_BLOBS_PY = `
import sys
from azure.storage.blob import BlobServiceClient
svc = BlobServiceClient.from_connection_string(sys.argv[1])
print("\\n".join(b.name for b in svc.get_container_client(sys.argv[2]).list_blobs()))
`;

/** A .docx whose parts are tiny compressed but expand enormously (a zip bomb). */
export function makeDocxBomb(): Buffer {
  const out = execFileSync(PYTHON, ["-c", DOCX_BOMB_PY], { maxBuffer: 64 * 1024 * 1024 });
  return Buffer.from(out);
}

const DOCX_BOMB_PY = `
import io, sys, zipfile
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
    z.writestr("word/document.xml", b"<w:t>" + b"0" * (120 * 1024 * 1024) + b"</w:t>")
sys.stdout.buffer.write(buf.getvalue())
`;

export { waitForHttp };
