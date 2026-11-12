# 14 · Legitimate Interests Assessments

> **Status:** DRAFT for adoption, 12 Nov 2026. Sign-off at the end.
> Art 6(1)(f) UK GDPR, with Art 5(2) accountability: the controller must be able to show that it
> weighed each legitimate interest it relies on. One assessment per purpose, using the ICO's
> three-part test: **purpose** (is there a legitimate interest?), **necessity** (is this processing
> needed for it?), **balance** (do members' interests override it?).
> Every purpose here is listed in Privacy §3 and the ROPA ([02](./02-ropa.md)).

Members can object to any of these (Privacy §10, "Your right to object"). On an objection, stop
unless the "compelling grounds" line below applies to that person's case.

---

### L1. Security and abuse prevention (rate limits, Turnstile, IP at the edge)
- **Purpose:** keep accounts and the service safe from bots, brute force and spam. Also the
  controller's Art 32 duty.
- **Necessity:** counters are short-lived (minutes to an hour) and keyed to a user ID or IP, with
  no profile data. Nothing less intrusive stops automated abuse.
- **Balance:** expected by any user of an online service; minimal data; very short retention.
  Campus NAT means IP buckets are campus-wide, which protects individuals rather than profiling them.
- **Outcome:** ✅ legitimate interests applies. Compelling grounds would normally defeat an
  objection, because the processing protects everyone else.

### L2. Cookieless product analytics (PostHog)
- **Purpose:** learn which features are used, to improve Foundry.
- **Necessity:** pseudonymous user ID; no cookies, replay or autocapture; URLs scrubbed of AI and
  job IDs. Aggregate counts would be less useful but are an option if objections become common.
- **Balance:** low impact and low intrusion. There is now a **one-click per-device opt-out** in
  Settings.
- **Outcome:** ✅ applies. **An objection is always honoured**: there are no compelling grounds for
  analytics. Owner check: PostHog project setting "Discard client IP data" must be on.

### L3. Listing view and click records (`listing_events`)
- **Purpose:** show posters how much interest a listing gets (distinct-viewer totals only).
- **Necessity:** distinct counting needs the viewer ID. Posters never see who viewed.
- **Balance:** low impact; members expect posters to see interest totals. Kept for the life of the
  account (Privacy §8), which is long.
- **Outcome:** ✅ applies. ⚠ Review: a 12-month purge would weaken the necessity argument less than
  life-of-account retention does. Recommended for the next release, not blocking.

### L4. Email-change log
- **Purpose:** security. Detect and undo account takeover through an email change.
- **Necessity:** the old and new addresses are the evidence.
- **Balance:** the member's own data, in their own export, deleted with the account.
- **Outcome:** ✅ applies.

### L5. Removed-account email hash (12 months)
- **Purpose:** enforce a removal, so a banned address cannot come straight back with automatic
  approval.
- **Necessity:** a one-way hash is the minimum that recognises the same address. The person is
  not refused; they are routed to manual review.
- **Balance:** applies only to accounts removed for breaking the rules; cannot be reversed;
  time-limited.
- **Outcome:** ✅ applies.

### L6. Block tombstone hash (12 months)
- **Purpose:** keep a member's block working if the blocked person deletes their account and
  re-registers.
- **Necessity:** without it, a block can be evaded by re-registering — exactly the harassment
  pattern blocking exists to stop.
- **Balance:** protects the blocker; the hash cannot be reversed; it is removed once used, when the
  blocker leaves, or after 12 months.
- **Outcome:** ✅ applies.

### L7. Moderation log, kept after account deletion (12 months, includes the author's email)
- **Purpose:** explain, review and defend a takedown; also Art 17(3)(e) (legal claims) and OSA
  record-keeping.
- **Necessity:** a member could otherwise erase the record of their own moderation by closing
  their account. The email snapshot identifies the person if a claim arrives after deletion.
- **Balance:** the member is told (Privacy §8, Terms §6). 12 months with `legal_hold` is
  proportionate. See [08](./08-retention-decision-moderation-log.md).
- **Outcome:** ✅ applies.

### L8. Connection reports and activity log (12 months, kept after deletion)
- **Purpose:** handle complaints about member-to-member contact, and compute the anti-harassment
  sending throttle.
- **Necessity:** the throttle and adjudication need history; the 12-month window is what lets
  serial unwanted contact be seen.
- **Balance:** disclosed (Privacy §7a, §8); decline rate is deliberately excluded from the
  throttle; an admin can lift it.
- **Outcome:** ✅ applies.

### L9. Admin audit log (6 years)
- **Purpose:** hold admins accountable for decisions about members, and evidence for any challenge
  to a decision.
- **Necessity:** a decision log is the only way to answer "who did this and why".
- **Balance:** admins are told when they are given access ([15](./15-admin-confidentiality-undertaking.md)).
  Six years matches the Limitation Act 1980 period; after that the entries are deleted
  (`purge_old_admin_actions`). The admin's identity is removed if they delete their account.
- **Outcome:** ✅ applies.

### L10. Handling reports and contact/appeals messages
- **Purpose:** respond to enquiries, appeals, data-protection requests and content reports; OSA
  complaints duty.
- **Necessity:** these can't be handled without reading them.
- **Balance:** expected by the sender. Retention: the end of the academic year after closure,
  unless a dispute is live.
- **Outcome:** ✅ applies. ⚠ Depends on the inbox moving off consumer Gmail
  ([03](./03-third-party-dpa-register.md)).

---

## Adoption

| | |
|---|---|
| **Adopted by** | ______________________ (data protection lead, IC Founders Ltd) |
| **Date** | ______________________ |
| **Review due** | 12 months, or when a purpose changes |
