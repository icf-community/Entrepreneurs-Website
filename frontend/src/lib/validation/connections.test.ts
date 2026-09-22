import { describe, it, expect } from "vitest";
import {
  CONNECTION_NOTE_MAX,
  cleanNote,
  noteLength,
  sendRequestSchema,
  respondSchema,
  reportConnectionSchema,
  settingsSchema,
  validateConnection,
} from "./connections";

// The rules under test are MIRRORS of SQL rules (connection_clean_note,
// the connections_note_len CHECK). What matters is not that they are
// reasonable but that they agree with Postgres — a client that cleans
// differently shows the member one note and sends another, and a client
// that counts differently refuses a note the database would accept.

describe("cleanNote", () => {
  it("returns null for an untouched textarea", () => {
    expect(cleanNote("")).toBeNull();
    expect(cleanNote("   ")).toBeNull();
  });

  it("strips control characters \u2014 the note is rendered as text, not typed by a wire protocol", () => {
    expect(cleanNote("hello\u0000world")).toBe("hello world");
    expect(cleanNote("a\u0007b")).toBe("a b");
    expect(cleanNote("a\u007fb")).toBe("a b");
  });

  it("collapses the whitespace Postgres collapses, including the unicode ones", () => {
    // Probed against connection_clean_note on the local stack, not
    // assumed. U+00A0 and U+2028 are the two that matter: they are what a
    // note pasted out of Word or off a web page actually contains.
    expect(cleanNote("a\u00a0b")).toBe("a b");
    expect(cleanNote("line\u2028break")).toBe("line break");
    expect(cleanNote("a\u3000b")).toBe("a b");
    expect(cleanNote("a\u0085b")).toBe("a b");
    expect(cleanNote("\u00a0")).toBeNull();
    expect(cleanNote("\u2028")).toBeNull();
  });

  it("leaves the zero-width characters alone, exactly as Postgres does", () => {
    // The other side of the same divergence. JavaScript's \\s matches
    // U+FEFF and Postgres's does not, so a mirror written with \\s would
    // silently delete a character the database keeps -- and the note the
    // member was shown would not be the note that was stored.
    expect(cleanNote("a\u200bb")).toBe("a\u200bb");
    expect(cleanNote("a\ufeffb")).toBe("a\ufeffb");
    expect(cleanNote("a\u2060b")).toBe("a\u2060b");
    expect(noteLength(cleanNote("a\ufeffb") ?? "")).toBe(3);
  });

  it("turns newlines and tabs into spaces and collapses the runs", () => {
    expect(cleanNote("one\n\ntwo\t\tthree")).toBe("one two three");
    expect(cleanNote("  padded  \n")).toBe("padded");
  });

  it("keeps ordinary punctuation and unicode intact", () => {
    expect(cleanNote("Hi — I'm building a fintech thing 🚀")).toBe(
      "Hi — I'm building a fintech thing 🚀",
    );
  });
});

describe("noteLength", () => {
  it("counts code points, not UTF-16 units — this is the emoji bug", () => {
    // Postgres length() counts characters. String.length would say 2 for
    // a single rocket, so a 300-emoji note would measure 600 and be
    // refused by the composer while the database accepted it happily.
    expect("🚀".length).toBe(2);
    expect(noteLength("🚀")).toBe(1);
    expect(noteLength("🚀".repeat(CONNECTION_NOTE_MAX))).toBe(CONNECTION_NOTE_MAX);
  });

  it("counts a plain ASCII note the obvious way", () => {
    expect(noteLength("hello")).toBe(5);
  });
});

describe("sendRequestSchema", () => {
  const base = {
    memberId: "11111111-1111-4111-8111-111111111111",
    consentVersion: "2026-09-17",
  };

  it("accepts a request with no note at all", () => {
    const r = validateConnection(sendRequestSchema, base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.note).toBeNull();
  });

  it("treats an empty textarea as no note rather than an error", () => {
    const r = validateConnection(sendRequestSchema, { ...base, note: "   " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.note).toBeNull();
  });

  it("cleans the note it passes on, so what is sent is what was shown", () => {
    const r = validateConnection(sendRequestSchema, { ...base, note: " hi\n\nthere " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.note).toBe("hi there");
  });

  it("accepts a note exactly at the boundary, in emoji", () => {
    const r = validateConnection(sendRequestSchema, {
      ...base,
      note: "🚀".repeat(CONNECTION_NOTE_MAX),
    });
    expect(r.ok).toBe(true);
  });

  it("refuses one character past the boundary", () => {
    const r = validateConnection(sendRequestSchema, {
      ...base,
      note: "a".repeat(CONNECTION_NOTE_MAX + 1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(String(CONNECTION_NOTE_MAX));
  });

  it("measures the note AFTER cleaning — whitespace is not part of the budget", () => {
    const r = validateConnection(sendRequestSchema, {
      ...base,
      note: `${" ".repeat(50)}${"a".repeat(CONNECTION_NOTE_MAX)}${" ".repeat(50)}`,
    });
    expect(r.ok).toBe(true);
  });

  it("refuses a non-uuid member id", () => {
    const r = validateConnection(sendRequestSchema, { ...base, memberId: "not-a-uuid" });
    expect(r.ok).toBe(false);
  });

  it("requires a consent version — the RPC will not stamp a row without one", () => {
    const r = validateConnection(sendRequestSchema, { memberId: base.memberId });
    expect(r.ok).toBe(false);
  });
});

describe("respondSchema", () => {
  const base = {
    connectionId: "22222222-2222-4222-8222-222222222222",
    consentVersion: "2026-09-17",
  };

  it("accepts both decisions", () => {
    expect(validateConnection(respondSchema, { ...base, accept: true }).ok).toBe(true);
    expect(validateConnection(respondSchema, { ...base, accept: false }).ok).toBe(true);
  });

  it("refuses a missing decision rather than defaulting one", () => {
    // Defaulting either way is a disclosure bug in one direction and a
    // silent decline in the other.
    expect(validateConnection(respondSchema, base).ok).toBe(false);
  });

  it("refuses a string where a boolean belongs", () => {
    expect(validateConnection(respondSchema, { ...base, accept: "true" }).ok).toBe(false);
  });
});

describe("reportConnectionSchema", () => {
  const base = {
    connectionId: "33333333-3333-4333-8333-333333333333",
    category: "harassment",
    reason: "They sent an abusive note.",
  };

  it("accepts a well-formed report", () => {
    expect(validateConnection(reportConnectionSchema, base).ok).toBe(true);
  });

  it("refuses a category outside the list", () => {
    expect(validateConnection(reportConnectionSchema, { ...base, category: "vibes" }).ok).toBe(false);
  });

  it("requires enough detail for an admin to act on", () => {
    expect(validateConnection(reportConnectionSchema, { ...base, reason: "bad" }).ok).toBe(false);
  });
});

describe("settingsSchema", () => {
  it("accepts a single toggle", () => {
    expect(validateConnection(settingsSchema, { emailsEnabled: false }).ok).toBe(true);
    expect(validateConnection(settingsSchema, { openToConnections: false }).ok).toBe(true);
  });

  it("refuses a no-op call rather than spending an RPC on nothing", () => {
    expect(validateConnection(settingsSchema, {}).ok).toBe(false);
  });
});
