import { describe, it, expect } from "vitest";
import { opportunitySchema, eventSchema, vcGrantSchema, validate } from "./listings";
import { contactSchema } from "./contact";

// A future-dated ISO day, so the "deadline must be today or later" refine passes.
const futureDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const futureDateTime = new Date(Date.now() + 30 * 86_400_000).toISOString();

const validOpportunity = {
  positionName: "Founding Engineer",
  company: "Acme",
  pay: "£80k",
  locationType: "onsite" as const,
  locationText: "London",
  description: "A".repeat(25),
  startMonth: 6,
  startYear: 2026,
  applicationDeadline: futureDate,
  contactEmail: "a@b.com",
  contactEmailVisible: false,
  applyMethod: "link" as const,
  applyUrl: "https://acme.com/apply",
  skillIds: [1, 2],
  sectorIds: [3],
  eligibleAudience: "both" as const,
};

describe("opportunitySchema", () => {
  it("requires who the job is for (AI-plan §7.2)", () => {
    expect(validate(opportunitySchema, { ...validOpportunity, eligibleAudience: undefined }).ok).toBe(false);
    expect(validate(opportunitySchema, { ...validOpportunity, eligibleAudience: "alumni" }).ok).toBe(false);
  });

  it("accepts a well-formed opportunity", () => {
    const r = validate(opportunitySchema, validOpportunity);
    expect(r.ok).toBe(true);
  });

  it("rejects a short description", () => {
    const r = validate(opportunitySchema, { ...validOpportunity, description: "too short" });
    expect(r.ok).toBe(false);
  });

  it("requires a location for onsite roles", () => {
    const r = validate(opportunitySchema, { ...validOpportunity, locationText: null });
    expect(r.ok).toBe(false);
  });

  it("allows a missing location for remote roles", () => {
    const r = validate(opportunitySchema, { ...validOpportunity, locationType: "remote", locationText: null });
    expect(r.ok).toBe(true);
  });

  it("rejects a past application deadline", () => {
    const r = validate(opportunitySchema, { ...validOpportunity, applicationDeadline: "2000-01-01" });
    expect(r.ok).toBe(false);
  });

  // Adversarial sweep F8: these passed zod and ended as a generic error (or a
  // stored oddity) once they reached Postgres.
  it.each(["2027-02-30", "2027-13-01", "2027-00-10", "9999-12-31", "2100-01-01"])(
    "rejects an impossible or absurd application deadline %s", (applicationDeadline) => {
      expect(validate(opportunitySchema, { ...validOpportunity, applicationDeadline }).ok).toBe(false);
    });

  it.each([[0], [-5], [999999], [40000], [1.5]])("rejects skill id %j (not a real, smallint-sized id)", (id) => {
    expect(validate(opportunitySchema, { ...validOpportunity, skillIds: [id] }).ok).toBe(false);
    expect(validate(opportunitySchema, { ...validOpportunity, sectorIds: [id] }).ok).toBe(false);
  });

  it("still accepts ordinary ids", () => {
    expect(validate(opportunitySchema, { ...validOpportunity, skillIds: [1, 167], sectorIds: [7] }).ok).toBe(true);
  });

  it("requires applyUrl when applyMethod is link", () => {
    const r = validate(opportunitySchema, { ...validOpportunity, applyUrl: null });
    expect(r.ok).toBe(false);
  });

  it("rejects a non-http apply url", () => {
    const r = validate(opportunitySchema, { ...validOpportunity, applyUrl: "ftp://acme.com" });
    expect(r.ok).toBe(false);
  });

  it("allows the email apply method without an apply url", () => {
    const r = validate(opportunitySchema, { ...validOpportunity, applyMethod: "email", applyUrl: null });
    expect(r.ok).toBe(true);
  });

  it("requires a location for hybrid roles", () => {
    const r = validate(opportunitySchema, { ...validOpportunity, locationType: "hybrid", locationText: null });
    expect(r.ok).toBe(false);
  });

  it("rejects an apply url longer than 512 characters", () => {
    const longUrl = "https://acme.com/" + "a".repeat(512);
    const r = validate(opportunitySchema, { ...validOpportunity, applyUrl: longUrl });
    expect(r.ok).toBe(false);
  });

  it("accepts an apply url at the 512-character boundary", () => {
    const boundaryUrl = "https://acme.com/" + "a".repeat(512 - "https://acme.com/".length);
    expect(boundaryUrl.length).toBe(512);
    const r = validate(opportunitySchema, { ...validOpportunity, applyUrl: boundaryUrl });
    expect(r.ok).toBe(true);
  });
});

describe("eventSchema", () => {
  const validEvent = {
    title: "Demo Night",
    description: "B".repeat(25),
    lumaLink: "https://lu.ma/x",
    eventAtIso: futureDateTime,
    location: "Imperial",
    organiserName: "Foundry",
    contactEmail: "a@b.com",
    contactEmailVisible: true,
  };

  it("accepts a well-formed event", () => {
    expect(validate(eventSchema, validEvent).ok).toBe(true);
  });

  it("rejects a non-url luma link", () => {
    expect(validate(eventSchema, { ...validEvent, lumaLink: "lu.ma/x" }).ok).toBe(false);
  });

  it("rejects an unparseable event date/time", () => {
    expect(validate(eventSchema, { ...validEvent, eventAtIso: "not-a-date" }).ok).toBe(false);
  });

  it("rejects an event date years in the future or beyond the representable range", () => {
    // Adversarial sweep F1/F8: these parse, so the Date.parse check alone let
    // them through to the RPC. Mirrors submit_event's five-year ceiling.
    const sixYears = new Date(Date.now() + 6 * 365 * 864e5).toISOString();
    for (const eventAtIso of [sixYears, "9999-12-31T00:00:00Z", "+275760-09-13T00:00:00.000Z"]) {
      expect(validate(eventSchema, { ...validEvent, eventAtIso }).ok, eventAtIso).toBe(false);
    }
  });

  it("rejects a luma link longer than 512 characters", () => {
    const longUrl = "https://lu.ma/" + "a".repeat(512);
    expect(validate(eventSchema, { ...validEvent, lumaLink: longUrl }).ok).toBe(false);
  });

  it("rejects a luma link carrying an embedded CR/LF (ICS injection source)", () => {
    const injected = "https://lu.ma/x\r\nORGANIZER:attacker@evil.example";
    expect(validate(eventSchema, { ...validEvent, lumaLink: injected }).ok).toBe(false);
  });

  it("accepts the optional isSocietyEvent flag (true / false / omitted)", () => {
    expect(validate(eventSchema, { ...validEvent, isSocietyEvent: true }).ok).toBe(true);
    expect(validate(eventSchema, { ...validEvent, isSocietyEvent: false }).ok).toBe(true);
    expect(validate(eventSchema, validEvent).ok).toBe(true); // omitted
  });

  it("rejects a non-boolean isSocietyEvent", () => {
    expect(validate(eventSchema, { ...validEvent, isSocietyEvent: "yes" }).ok).toBe(false);
  });
});

describe("vcGrantSchema", () => {
  const validVc = {
    kind: "vc" as const,
    name: "Seedcamp",
    description: "C".repeat(25),
    link: "https://seedcamp.com",
    amount: null,
    deadline: null,
    stage: null,
  };

  it("accepts a well-formed VC", () => {
    expect(validate(vcGrantSchema, validVc).ok).toBe(true);
  });

  it("rejects an invalid kind", () => {
    expect(validate(vcGrantSchema, { ...validVc, kind: "angel" }).ok).toBe(false);
  });

  it("rejects a link longer than 512 characters", () => {
    const longUrl = "https://seedcamp.com/" + "a".repeat(512);
    expect(validate(vcGrantSchema, { ...validVc, link: longUrl }).ok).toBe(false);
  });

  describe("deadline (F8)", () => {
    it("accepts none (rolling applications), today and the future", () => {
      expect(validate(vcGrantSchema, { ...validVc, deadline: null }).ok).toBe(true);
      expect(validate(vcGrantSchema, { ...validVc, deadline: futureDate }).ok).toBe(true);
      expect(validate(vcGrantSchema, { ...validVc, deadline: new Date().toISOString().slice(0, 10) }).ok).toBe(true);
    });
    it.each(["2020-05-05", "2027-02-30", "2027-13-01", "9999-12-31", "2100-01-01", "not-a-date"])(
      "rejects %s", (deadline) => {
        expect(validate(vcGrantSchema, { ...validVc, deadline }).ok).toBe(false);
      });
  });
});

describe("contactSchema", () => {
  const base = { email: "ada@example.com", subject: "Hi", message: "Hello there" };

  it("accepts a valid ticket with a name", () => {
    expect(validate(contactSchema, { ...base, name: "Ada Lovelace" }).ok).toBe(true);
  });

  it("accepts a valid ticket without a name (optional)", () => {
    expect(validate(contactSchema, base).ok).toBe(true);
  });

  it("rejects a missing email", () => {
    expect(validate(contactSchema, { subject: "Hi", message: "ok" }).ok).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(validate(contactSchema, { ...base, email: "not-an-email" }).ok).toBe(false);
  });

  it("rejects an over-length name", () => {
    expect(validate(contactSchema, { ...base, name: "x".repeat(121) }).ok).toBe(false);
  });

  it("rejects an over-length subject", () => {
    expect(validate(contactSchema, { ...base, subject: "x".repeat(200) }).ok).toBe(false);
  });

  it("rejects an empty message", () => {
    expect(validate(contactSchema, { ...base, message: "   " }).ok).toBe(false);
  });

  it("rejects a subject with CR/LF (email header injection)", () => {
    expect(validate(contactSchema, { ...base, subject: "Hi\r\nBcc: victim@example.com" }).ok).toBe(false);
    expect(validate(contactSchema, { ...base, subject: "Hi\nthere" }).ok).toBe(false);
  });
});
