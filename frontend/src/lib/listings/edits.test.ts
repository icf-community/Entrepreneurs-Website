import { describe, it, expect } from "vitest";
import { changedFields, fieldLabel, movesEventLogistics } from "./edits";
import { renderListingEditDecisionEmail } from "@/lib/email";

// ════════════════════════════════════════════════════════════════════
// The pure half of the post-approval revision path.
//
// changedFields is load-bearing in three places at once — what the admin
// diff shows, which fields the proposal email names, and whether the
// organiser gets the Luma reminder. A false negative there means a
// reviewer skims past a moved start time, so the cases below are about
// what counts as "changed", not about formatting.
// ════════════════════════════════════════════════════════════════════

describe("changedFields", () => {
  it("reports only the keys whose value actually moved", () => {
    const current  = { title: "Talk", location: "Huxley 340", contact_email_visible: false };
    const proposed = { title: "Talk", location: "Blackett 202", contact_email_visible: false };
    expect(changedFields(current, proposed)).toEqual(["location"]);
  });

  it("treats null and a missing key as the same absence", () => {
    // The snapshot builder emits explicit nulls for optional columns while a
    // proposal may omit them. Flagging that as a change would put a field in
    // front of a reviewer that nobody touched.
    expect(changedFields({ amount: null }, {})).toEqual([]);
    expect(changedFields({}, { amount: null })).toEqual([]);
  });

  it("catches a false→true flip on the contact-email visibility flag", () => {
    // Publishing a previously private address is a disclosure change, so it
    // has to survive into the reviewer's diff.
    expect(changedFields({ contact_email_visible: false }, { contact_email_visible: true }))
      .toEqual(["contact_email_visible"]);
  });

  it("compares arrays by contents, not by identity", () => {
    expect(changedFields({ skill_ids: [1, 2] }, { skill_ids: [1, 2] })).toEqual([]);
    expect(changedFields({ skill_ids: [1, 2] }, { skill_ids: [2, 1] })).toEqual(["skill_ids"]);
  });

  it("only walks the proposed keys — the payload defines the writable set", () => {
    // apply_listing_edit_payload has a fixed column list per kind, so a key
    // present only on the live row is not something a revision can change.
    expect(changedFields({ status: "approved", title: "T" }, { title: "T" })).toEqual([]);
  });
});

describe("movesEventLogistics", () => {
  it("is true when an event's time or place moved", () => {
    expect(movesEventLogistics("event", ["event_at"])).toBe(true);
    expect(movesEventLogistics("event", ["location"])).toBe(true);
    expect(movesEventLogistics("event", ["title", "location"])).toBe(true);
  });

  it("is false for a description-only event edit", () => {
    expect(movesEventLogistics("event", ["description", "title"])).toBe(false);
  });

  it("is false for the other two kinds — nobody registered on Luma for them", () => {
    expect(movesEventLogistics("opportunity", ["location_text"])).toBe(false);
    expect(movesEventLogistics("vc_grant", ["deadline"])).toBe(false);
  });
});

describe("fieldLabel", () => {
  it("names the fields a reviewer sees", () => {
    expect(fieldLabel("event_at")).toBe("Date & time");
    expect(fieldLabel("contact_email_visible")).toBe("Contact email visible");
  });

  it("falls back to the raw key rather than dropping an unknown field", () => {
    // A silently unlabelled field would vanish from the diff, which is the
    // one failure mode worse than an ugly label.
    expect(fieldLabel("some_new_column")).toBe("some_new_column");
  });
});

describe("renderListingEditDecisionEmail", () => {
  const base = {
    firstName: "Sam",
    listingKind: "event" as const,
    listingTitle: "Founders' night",
    reason: null,
    remindAboutLuma: false,
  };

  it("says the listing is still live when a revision is refused", () => {
    // The organiser's first fear on being told "not approved" is that their
    // event has been pulled. It hasn't been, and the email has to say so.
    const out = renderListingEditDecisionEmail({
      ...base, decision: "rejected", reason: "That room doesn't exist.",
    });
    expect(out.text).toContain("still live");
    expect(out.text).toContain("That room doesn't exist.");
  });

  it("tells an organiser to update Luma when the time or place moved", () => {
    const out = renderListingEditDecisionEmail({
      ...base, decision: "applied", remindAboutLuma: true,
    });
    expect(out.text).toContain("Luma");
    expect(out.html).toContain("Luma");
  });

  it("stays quiet about Luma when nothing an attendee cares about moved", () => {
    const out = renderListingEditDecisionEmail({ ...base, decision: "applied" });
    expect(out.text).not.toContain("Luma");
  });

  it("escapes a hostile listing title in the HTML body", () => {
    const out = renderListingEditDecisionEmail({
      ...base, decision: "applied", listingTitle: '<img src=x onerror="alert(1)">',
    });
    expect(out.html).not.toContain("<img");
    expect(out.html).toContain("&lt;img");
  });
});
