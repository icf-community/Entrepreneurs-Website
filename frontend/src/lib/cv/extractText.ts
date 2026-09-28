import "server-only";
import { errorSummary } from "@/lib/errorSummary";

// ════════════════════════════════════════════════════════════════════
// Foundry · Deterministic CV text extraction
//
// unpdf for PDF, mammoth for DOCX — no LLM, per the plan's explicit
// decision to avoid one where a deterministic result is good enough.
// The kind is sniffed from magic bytes rather than trusted from a
// filename or the upload ticket's purpose, matching the rule the
// gateway itself follows.
//
// Extracted text is returned to the CALLER, which must match it against
// the skills taxonomy and discard it immediately — see lib/cv/matchSkills
// and mediaActions.confirmCvUpload. This module never logs or persists
// the text it returns.
// ════════════════════════════════════════════════════════════════════

function detectKind(bytes: Buffer): "pdf" | "docx" | null {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "docx"; // PK\x03\x04 (zip)
  return null;
}

/**
 * Best-effort text extraction. Returns null for anything that doesn't
 * yield usable text — a scanned/rasterised PDF with no text layer, a
 * format neither library can parse, or a parse failure. Callers must
 * treat null as "no suggestions", never as an error to surface.
 */
export async function extractCvText(bytes: Buffer): Promise<string | null> {
  const kind = detectKind(bytes);
  if (!kind) return null;

  try {
    if (kind === "pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractText(pdf, { mergePages: true });
      return text?.trim() || null;
    }

    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: bytes });
    return result.value?.trim() || null;
  } catch (e) {
    // Malformed or unsupported bytes degrade to "no suggestions" — this
    // path runs on attacker-controllable input, so it must never throw
    // past this point.
    console.error("CV text extraction failed:", errorSummary(e));
    return null;
  }
}
