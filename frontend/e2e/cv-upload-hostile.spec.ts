import { test, expect, type Page } from "@playwright/test";
import {
  startAzurite,
  startGatewayAndWorker,
  makeSamplePdf,
  makeDocxBomb,
  listCvBlobs,
  waitForHttp,
  GATEWAY_URL,
} from "./gateway-services";
import { readFileSync } from "node:fs";

// ════════════════════════════════════════════════════════════════════
// Foundry · Hostile files, through the real browser to the real gateway
//
// The gateway's own checks (polyglots, bombs, scripted PDFs, empty and
// oversized bodies, ticket misuse) are pinned at the HTTP level in
// server/tests/test_endpoints.py and fuzzed in test_upload_fuzz.py. What none
// of those can show is what a MEMBER sees: that a refused file gives a plain
// sentence in the page, not a crash, an error screen or a stack trace; that
// nothing is stored for a refused file; that a hostile filename is inert in
// the page; and that the form still works afterwards.
//
// Opt-in, like cv-upload.spec.ts: run with E2E_CV_UPLOAD=1 (needs Docker, for
// Azurite) — see scripts/local-env.sh.
// ════════════════════════════════════════════════════════════════════

const LEAKS = /traceback|internal server error|stack|exception|\bat \S+\.py|errno|sqlstate|azure|blob|\/app\//i;

test.describe.configure({ mode: "serial", timeout: 90_000 });

test.describe("hostile CV uploads through the browser", () => {
  test.skip(
    !process.env.UPLOAD_GATEWAY_URL,
    "Run with E2E_CV_UPLOAD=1 (needs Docker, for Azurite) — see scripts/local-env.sh.",
  );

  let stopAzurite: (() => void) | undefined;
  let stopGateway: (() => void) | undefined;
  let validPdf: Buffer;

  test.beforeAll(async ({ baseURL }) => {
    stopAzurite = await startAzurite();
    stopGateway = startGatewayAndWorker(baseURL!);
    await waitForHttp(`${GATEWAY_URL}/health`, 20_000);
    validPdf = readFileSync(makeSamplePdf());
  });

  test.afterAll(() => {
    stopGateway?.();
    stopAzurite?.();
  });

  type Upload = { name: string; mimeType: string; buffer: Buffer };

  /** Pick a file in the CV form and press Upload, like a member would. */
  async function submit(page: Page, file: Upload) {
    await page.goto("/profile");
    await page.getByRole("heading", { name: "CV", exact: true }).waitFor({ state: "visible" });
    const changeCv = page.getByRole("button", { name: "Change CV" });
    if (await changeCv.isVisible().catch(() => false)) await changeCv.click();
    await page.getByLabel("Drop a PDF or DOCX").setInputFiles(file);
    const consent = page.getByRole("checkbox", { name: /Read my CV/ });
    if (await consent.isVisible().catch(() => false)) await consent.check();
    await page.getByRole("button", { name: "Upload CV" }).click();
  }

  /** Watch for the things a hostile file must never cause. */
  function watch(page: Page) {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("dialog", async (d) => {
      problems.push(`dialog: ${d.message()}`);
      await d.dismiss();
    });
    return problems;
  }

  /** A refused upload: a plain alert, no leaked internals, nothing stored, the page intact. */
  async function expectRefused(page: Page, file: Upload, problems: string[]) {
    const before = listCvBlobs();
    await submit(page, file);
    // The first role=alert on the page can be an empty announcer region; take the one with text.
    const alert = page.getByRole("alert").filter({ hasText: /\S/ }).first();
    await expect(alert, `no refusal shown for ${file.name}`).toBeVisible({ timeout: 25_000 });
    const text = (await alert.textContent()) ?? "";
    expect(text.trim().length, "the refusal is empty").toBeGreaterThan(5);
    expect(text, `the refusal leaks internals: ${text}`).not.toMatch(LEAKS);
    expect(listCvBlobs(), `a refused file (${file.name}) left a blob behind`).toEqual(before);
    await expect(page.getByRole("heading", { name: "CV", exact: true })).toBeVisible();
    expect(problems, problems.join("\n")).toEqual([]);
  }

  const refused: [string, () => Upload][] = [
    ["an executable named cv.pdf", () => ({ name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.concat([Buffer.from("MZ\x90\x00\x03\x00\x00\x00"), Buffer.alloc(4096, 0x41)]) })],
    ["an HTML page with a script, named cv.pdf", () => ({ name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html><script>alert(document.cookie)</script></html>") })],
    [
      "a PDF whose OpenAction runs JavaScript",
      () => ({
        name: "cv.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(
          "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R/OpenAction 4 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
            "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n4 0 obj<</S/JavaScript/JS(app.alert\\(1\\))>>endobj\n" +
            "trailer<</Root 1 0 R>>\n%%EOF\n",
        ),
      }),
    ],
    ["a zip bomb named cv.docx", () => ({ name: "cv.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: makeDocxBomb() })],
    ["an empty file", () => ({ name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) })],
    ["a 9 MB file (over the 8 MB limit)", () => ({ name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(9 * 1024 * 1024, 0x20)]) })],
    ["random bytes with a .docx name", () => ({ name: "cv.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from(Array.from({ length: 6000 }, (_, i) => (i * 131 + 7) % 256)) })],
  ];

  // The gateway can only sniff a file's type; a PDF that is cut off in the middle still starts
  // with %PDF-, so it is stored and the worker finds out when it tries to read it. What the member
  // sees then must be the plain "Couldn't be processed" state: no crash, no stack, nothing stuck.
  test("a truncated PDF is either refused or ends as \"Couldn't be processed\", and the page stays up", async ({ page }) => {
    const problems = watch(page);
    await submit(page, { name: "cv.pdf", mimeType: "application/pdf", buffer: validPdf.subarray(0, Math.floor(validPdf.length / 2)) });
    const refusal = page.getByRole("alert").filter({ hasText: /\S/ }).first();
    const degraded = page.getByText(/Couldn.t be processed/);
    await expect(refusal.or(degraded).first()).toBeVisible({ timeout: 40_000 });
    if (await refusal.isVisible()) expect((await refusal.textContent()) ?? "").not.toMatch(LEAKS);
    await expect(page.getByRole("heading", { name: "CV", exact: true })).toBeVisible();
    expect(problems, problems.join("\n")).toEqual([]);
  });

  for (const [name, make] of refused) {
    test(`${name} is refused plainly, stores nothing, and the page stays up`, async ({ page }) => {
      const problems = watch(page);
      await expectRefused(page, make(), problems);
    });
  }

  test("a hostile filename is inert in the page and never reaches storage as a name", async ({ page }) => {
    const problems = watch(page);
    const name = '"><img src=x onerror=alert(1)>../../etc/passwd‮fdp.pdf';
    await submit(page, { name, mimeType: "application/pdf", buffer: validPdf });
    // Either the gateway refuses the odd name, or it accepts the (valid) file; both are fine.
    // What must hold is that the name is only ever text, and no blob is named after it.
    await expect(page.getByRole("alert").filter({ hasText: /\S/ }).or(page.getByText(/^Processed/)).first()).toBeVisible({ timeout: 40_000 });
    expect(await page.locator("img[src='x']").count(), "the filename was rendered as markup").toBe(0);
    for (const blob of listCvBlobs()) {
      expect(blob, `a blob is named after the upload's filename: ${blob}`).not.toMatch(/passwd|\.\.|onerror|<|>|‮/i);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("control: after every refusal a valid PDF still uploads and is processed", async ({ page }) => {
    const problems = watch(page);
    await submit(page, { name: "cv.pdf", mimeType: "application/pdf", buffer: validPdf });
    // Anchored and case-sensitive: plain "Processed" would also match "Couldn't be processed".
    await expect(page.getByText(/^Processed/)).toBeVisible({ timeout: 40_000 });
    expect(listCvBlobs().length, "the valid upload stored nothing").toBeGreaterThan(0);
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
