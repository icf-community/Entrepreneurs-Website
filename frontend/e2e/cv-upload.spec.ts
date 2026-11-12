import { test, expect } from "@playwright/test";
import { startAzurite, startGatewayAndWorker, makeSamplePdf, waitForHttp, GATEWAY_URL } from "./gateway-services";

// ════════════════════════════════════════════════════════════════════
// Foundry · CV upload, driven through the real UI (AI-plan §14.4, gap 24)
//
// Every other CV test either monkeypatches storage.py's get_blob/put_blob
// (server/tests) or asserts on the RPCs directly (rls_smoke) — nothing
// drives upload -> gateway -> real blob store -> ingest worker -> "ready"
// through an actual browser. That's what this proves. Opt-in only: see
// scripts/local-env.sh (E2E_CV_UPLOAD=1) for why.
// ════════════════════════════════════════════════════════════════════

test.describe("CV upload through the real UI (gap 24)", () => {
  test.skip(
    !process.env.UPLOAD_GATEWAY_URL,
    "Run with E2E_CV_UPLOAD=1 (needs Docker, for Azurite) — see scripts/local-env.sh.",
  );

  let stopAzurite: (() => void) | undefined;
  let stopGateway: (() => void) | undefined;
  let pdfPath: string;

  test.beforeAll(async ({ baseURL }) => {
    stopAzurite = await startAzurite();
    stopGateway = startGatewayAndWorker(baseURL!);
    await waitForHttp(`${GATEWAY_URL}/health`, 20_000);
    pdfPath = makeSamplePdf();
  });

  test.afterAll(() => {
    stopGateway?.();
    stopAzurite?.();
  });

  test("uploading a real PDF reaches Processed, with skills picked up", async ({ page }) => {
    await page.goto("/profile");
    // Make sure the CV section has hydrated (its onChange handler is a
    // client component) before handing the input a file.
    await page.getByRole("heading", { name: "CV", exact: true }).waitFor({ state: "visible" });

    // A re-run against an un-reset local Supabase (this spec doesn't own a
    // throwaway account) may find the student already has a CV from a
    // prior run — the dropzone is then behind "Change CV".
    const changeCv = page.getByRole("button", { name: "Change CV" });
    if (await changeCv.isVisible().catch(() => false)) await changeCv.click();

    await page.getByLabel("Drop a PDF or DOCX").setInputFiles(pdfPath);

    const consent = page.getByRole("checkbox", { name: /Read my CV/ });
    if (await consent.isVisible().catch(() => false)) await consent.check();

    await page.getByRole("button", { name: "Upload CV" }).click();

    // extracting -> embedding -> ready, through the real worker.
    // Anchored and case-sensitive: getByText("Processed") is a case-insensitive
    // substring match and also matches "Couldn't be processed". (Not exact:true
    // either: the label shares its span with the "View details" button.)
    await expect(page.getByText(/^Processed/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("cv.pdf")).toBeVisible();

    await page.getByRole("button", { name: "View details" }).click();
    await expect(page.getByText(/Python/)).toBeVisible();
  });
});
