# DPIA screening — Community posts, and post-approval intake (CV, photo, skills)

## Feature: post-approval intake — CV upload, deterministic skill matching, profile photo

**Controller:** IC Founders Ltd (Companies House 17171277)
**Assessed:** 1 September 2026
**Feature:** the `/intake` flow a member completes after admission — a profile photo (optional,
cropped client-side before upload), a CV upload (optional, PDF/DOCX), and a closed-taxonomy skill
picker pre-filled with deterministic string matches against the CV's extracted text.
**Outcome:** a full DPIA is **not** required. Reasoning below. **This conclusion should be
re-examined if the deterministic matcher is ever replaced by an LLM** — see
`cv-matchmaker-spec.md`'s planned successor, which is explicitly out of scope for what is screened
here.

### Art. 35(3) — the mandatory triggers

| Trigger | Applies? | Why |
|---|---|---|
| Systematic and extensive automated evaluation, profiling, or automated decision-making with legal or similarly significant effects | **No** | The matcher is a fixed string comparison against a ~180-entry controlled vocabulary — not inference, not scoring, not ranking. It produces suggestions a member must actively confirm; nothing is added to a profile, and no decision about a person is made, without that action. |
| Large-scale processing of special category or criminal-offence data | **Considered, not met.** A CV routinely carries data from which health, ethnicity, religion or age are *inferable* — this is exactly why the feature gets its own screening rather than folding into the community-posts one. But nothing here infers or acts on those categories: the only processing is a literal substring match against a skills list, and the extracted text is discarded within the same request, never stored, never reviewed by a human as text. |
| Systematic monitoring of a publicly accessible area on a large scale | **No** | Not applicable — this is a member uploading their own document to their own account. |

None of the three mandatory triggers is met.

### ICO screening criteria

- **Innovative technology / new use of technology.** The closest-fitting criterion. Extracting text
  from an uploaded document and matching it against a list is not novel, but doing so from a CV
  specifically invites the "could this become profiling" question. **Resolved by design**: the
  matcher can only ever return one of ~180 fixed skill ids, never freeform text, never a score,
  and never anything the CV's author didn't already choose to write. There is no model, no
  training, no inference step.
- **Vulnerable data subjects.** Same population as the rest of the platform — Imperial students
  and alumni, 18+. No change.
- **Special category data risk.** Covered above. The mitigation is architectural, not procedural:
  extracted text is held in memory for the one request and never written anywhere (see ROPA item
  O), so there is nothing to later mine, re-purpose, or breach.
- **Scale.** Bounded to the size of the membership; one CV per member, no version history.

### Risks identified, and what mitigates them

| Risk | Mitigation |
|---|---|
| CV text (potentially revealing health/ethnicity/religion/age) is retained and later repurposed | Not retained at all — extracted, matched, discarded within the same server action; never logged, never sent to a third party, never rendered back to any user (`lib/cv/extractText.ts`, `lib/cv/matchSkills.ts`) |
| A suggested skill is added to a profile without the member's knowledge | Every suggestion is a chip the member must tap to add — nothing is auto-applied, and the UI marks suggestions as distinct from confirmed skills |
| XXE / SSRF via a crafted DOCX | Verified directly against the actual parser (`mammoth`): a hand-built XXE-payload DOCX throws rather than resolving the external entity. No local-file-read or SSRF path exists |
| A macro-enabled `.docm` disguised as `.docx` | Rejected at the gateway by presence of `word/vbaProject.bin` in the zip, in addition to the `word/document.xml` check |
| Admin access to a member's CV is unaccountable | Permitted, but never silent — every admin view writes an `admin_actions` row (`action='view_cv'`), disclosed in ROPA item N |
| PDF embedded JavaScript reaches another member | It cannot: the file is served `Content-Disposition: attachment` from a separate origin (`blob.core.windows.net`), so it is inert unless the CV's own owner or an admin chooses to download and open it in a desktop reader |
| A member's face is treated as biometric data | It is not processed for unique identification anywhere — only displayed — so Art. 9 is not engaged (recorded explicitly in ROPA item M) |

### Open point for the DPO

None specific to this feature beyond the standing controller/IAO/IAA confirmations already open at
the top of `02-ropa.md`. The one design decision worth the DPO's attention is **PDF embedded
JavaScript is accepted, not stripped** (ROPA item N) — a deliberate trade-off (stripping would
require re-encoding, which breaks the "re-runnable from original bytes" property the matcher
depends on) rather than an oversight, but it is a judgement call about acceptable residual risk that
should be confirmed rather than assumed.

### Re-run this screening if

- the deterministic string matcher is replaced by an LLM, embeddings, or any model that infers
  rather than matches (`cv-matchmaker-spec.md`'s planned successor does exactly this);
- extracted CV text starts being retained, logged, or sent to a third party for any reason;
- suggestions are ever applied to a profile without an explicit per-suggestion confirmation;
- the skill taxonomy stops being a fixed, curated list (e.g. free-text skills reintroduced);
- CV access broadens beyond the owner and admins, or admin access stops being logged.

---

# DPIA screening — Community posts

**Controller:** IC Founders Ltd (Companies House 17171277)
**Assessed:** 29 August 2026
**Feature:** the Community feed — member-written posts with optional images, published without
prior review, deleted automatically after 7 days.
**Outcome:** a full DPIA is **not** required. Reasoning below.

The value of this document is that the assessment was made and recorded, not the conclusion it
reached. UK GDPR Art. 5(2) makes us accountable for demonstrating compliance, and "we considered
it, and here is why not" is a complete answer where "we never thought about it" is not. Re-run
this screening if any of the assumptions in the last section stop holding.

---

## Art. 35(3) — the mandatory triggers

| Trigger | Applies? | Why |
|---|---|---|
| Systematic and extensive automated evaluation, profiling, or automated decision-making with legal or similarly significant effects | **No** | There is no ranking, scoring, recommendation, or profiling anywhere in the feature. Posts are ordered strictly reverse-chronologically. No decision about a person is made automatically — an admin takedown is a human decision, recorded with the acting admin's identity. |
| Large-scale processing of special category or criminal-offence data | **No** | Special category data is not collected anywhere on the platform (Privacy §2). Members could in principle write such data into a post, but that is incidental content, not processing we design for or act on. |
| Systematic monitoring of a publicly accessible area on a large scale | **No** | The feed is behind authentication and restricted to approved members. It is `noindex`, and `robots.txt` disallows it. It is not a publicly accessible area, and nothing monitors anyone. |

None of the three mandatory triggers is met.

## ICO screening criteria

The ICO's higher-risk list was worked through as well; the criteria that come closest:

- **Processing that could result in denial of service or a discriminatory effect.** A takedown
  removes content and, in the ban case, access. This is a human decision with a mandatory written
  reason, an email to the affected member, and an appeals route (`appeals@imperialentrepreneurs.com`).
  A moderation record is retained for 12 months precisely so a challenge can be reviewed against
  evidence rather than memory.
- **Combining datasets.** Nothing is combined. Post data is not joined to analytics, and the feed
  is excluded from the response cache.
- **Vulnerable data subjects.** Members are Imperial students and alumni aged 18+ (Terms §2).
  There is no children's data, and no employer/employee power imbalance.
- **Innovative technology.** Nothing novel: a text feed with image attachments. No AI, no
  biometrics, no inference. The image pipeline strips metadata rather than extracting it.
- **Scale.** ~2,000 members, with a 7-day retention window. Not large scale on any reading.

## Risks identified, and what mitigates them

These were identified during design and are already implemented; they are recorded here because
the mitigations are the reason the residual risk is low, not because the risk was theoretical.

| Risk | Mitigation |
|---|---|
| A member unknowingly publishes their home location via photo EXIF | Every upload is decoded and re-encoded; EXIF, including GPS, is discarded and the original file is never stored (`server/app/images.py`) |
| Member content leaks beyond the membership | Private Azure container, `--allow-blob-public-access false`, reads only via short-expiry user-delegation SAS; feed is `noindex` and approved-members-only at the RLS layer |
| "Deleted" content is not actually deleted | Hard delete throughout — no soft-delete flag. A database trigger on `post_images` queues the blob bytes for destruction on *every* deletion path; Azure blob soft-delete and versioning are explicitly disabled so nothing is silently retained |
| Illegal or abusive content reaches members | Report control on every post, an admin queue that is reviewed and answered, immediate takedown with a mandatory reason, and a kill switch that stops all posting via one config change |
| Unbounded retention creeping in | Both windows are stored as data (`expires_at`, `purge_after`), enforced by cron, and stated in the privacy policy. `legal_hold` lets one record outlive the window without disabling the purge for everyone |
| Retention of a moderation record after an erasure request | Bounded to 12 months, minimised to what a challenge would need, disclosed in Privacy §8 and Terms §6. **See the open point below.** |

## Open point for the DPO

The `post_moderation_log` deliberately survives account deletion: `author_id` carries no foreign
key, so a member cannot erase the record of their own moderation by closing their account. The
basis relied on is Art. 17(3)(e) — establishment, exercise or defence of legal claims — bounded to
12 months and disclosed to members in both legal pages.

This is a defensible position but it is a legal judgement rather than an engineering one, and it
should be confirmed by whoever advises IC Founders Ltd before launch. If the advice is that the
record must not survive erasure, the change is small: add the foreign key and let it cascade.

## Related duties

Separate from data protection, the feed is a user-to-user service and engages the UK Online Safety
Act's illegal-content duties. Reporting, complaints handling and takedown are implemented; the
written risk assessment those duties require is **not** part of this document and still needs to be
produced.

## Re-run this screening if

- ranking, recommendation, or any automated scoring of posts is introduced;
- the feed becomes visible without authentication, or is indexed;
- retention is extended materially beyond 7 days;
- private messaging, comments, or any non-public interaction is added;
- membership grows by an order of magnitude;
- automated content classification (including any AI moderation) is introduced.

---

# DPIA screening — Connections (mutual connection graph and email exchange)

**Controller:** IC Founders Ltd (Companies House 17171277)
**Assessed:** 18 September 2026 · **Revised:** 20 September 2026
**Revision:** the data-protection audit walked this screening against the shipped code rather than
the plan, and two claims had drifted. Notes were described as "cleared when the request is
answered" when nothing deleted a settled row at all, and "no second copy" of a released address
overlooked the accept email sitting in the outbound queue. Both are corrected in place below, and
both were fixed in code as well as in prose — migrations `20260917000011` and `20260917000013`.
**Feature:** Connections — a member asks another member to connect, optionally with a
≤300-character note; if the other accepts, each can see the other's login email address. Persistent
mutual relationships, a personal graph view, block and report controls, and an automatic sending
throttle.
**Outcome:** a full DPIA is **not** required. Reasoning below.

**This screening is a re-run triggered by our own rule, not a fresh one.** The Community posts
screening above says to re-run if *"private messaging, comments, or any non-public interaction is
added"*. A connection request with a free-text note is a non-public member-to-member interaction,
so that trigger fired and is answered here rather than being quietly skipped.

Two things are genuinely new to the platform and neither existed when the earlier screenings were
written: **a record of who knows whom**, and **the deliberate disclosure of a contact detail from
one member to another**.

---

## Art. 35(3) — the mandatory triggers

| Trigger | Applies? | Why |
|---|---|---|
| Systematic and extensive automated evaluation, profiling, or automated decision-making with legal or similarly significant effects | **No** | Nothing is ranked, scored or recommended: v1 discovery is the existing directory, and connections are ordered by date. One automated measure exists — the sending throttle — and it is examined on its own below rather than dismissed. |
| Large-scale processing of special category or criminal-offence data | **No** | No special category data is collected (Privacy §2). A member could write anything into a note, but that is incidental content, not processing we design for. Notes are capped at 300 characters, readable by one person, and deleted with the row that carries them — three weeks after the request is declined or withdrawn, on the next nightly purge after a connection is removed, or on sight once it expires (`purge_removed_connections()`). |
| Systematic monitoring of a publicly accessible area on a large scale | **No** | Everything here is behind authentication and restricted to approved members. The graph is never published; the `connections` table is deny-all RLS with **no policies at all**, and every read goes through a `SECURITY DEFINER` function that scopes to the caller's own edges. |

None of the three mandatory triggers is met.

## The two new data categories, assessed

### 1. The connection graph — who knows whom

This is a new category of personal data for this platform, and a relational one: an edge is data
about *two* people, so anything that reveals it reveals something about somebody who is not the
reader.

The design constraint that follows is that **no RPC returns an edge the caller is not a party to**,
and it is enforced in SQL rather than in the UI:

- `list_my_connections`, `list_my_connection_graph` and `connection_state_with` all scope to
  `auth.uid()`'s own rows.
- The graph view draws **you at the centre and your own connections around you**. An edge between
  two of your connections exists in the table and is deliberately **not drawn** — those two
  consented to share an address with *you*, not to have their relationship with each other shown
  to you. Rendering it would be a separate consent decision and is out of scope.
- **"N mutual connections" badges are excluded from v1**, and the reason is inference, not effort:
  at this community's size a count of 1 identifies the person.
- The Phase 2 matching agent may *use* the graph for ranking but is forbidden from *citing* it —
  "X is connected to your connection Y" discloses the Y–X edge as surely as drawing it. This is
  written into the agent's tool constraints while it is still a stub, which is the only cheap
  moment to do it.
- **There is no admin view of the whole network**, considered and rejected. A standing UI rendering
  everyone's relationships would be the largest personal-data read in the app, permanently, needing
  to be secured, audited and defended here whether or not anyone opened it. What exists instead is
  three aggregates — total connections, median per member, cross-cohort percentage — which answer
  the community-health question with no per-member exposure.

### 2. The email address — a deliberate disclosure between members

The whole feature exists to disclose one thing, and it is worth being exact about which. Profile
links (LinkedIn, GitHub, portfolio) are **already** visible to every member on the profile card, so
gating those would be theatre. The email address is the only thing not otherwise discoverable, and
it matters more than it first appears: students sign up with predictable Imperial addresses, but
**alumni, mentors and angel investors pass manual review with personal addresses**. Those are the
non-guessable disclosures, and the anti-harvesting design exists because of them.

**Consent is the basis, and it is taken from both sides.**

- *At send:* "If they accept, you'll each be able to see the other's email address." Sending is the
  requester's consent, and the line is on screen at the moment they send — not in a help page.
- *At accept:* the dialog names **the literal address being released** — "Dev will be able to see
  cora.connector@imperial.ac.uk" — not an abstract "your email". Members sign up with one address
  and live in another; a sentence naming the actual string is one somebody can act on.
- *Demonstrable (Art. 7(1)):* the version of the consent wording is stamped on the row at accept.
  Without a version stamp, a later rewording would leave no record of what anyone actually agreed
  to. A stale version is refused by the RPC rather than silently accepted.
- *Withdrawable (Art. 7(3)):* either party can remove the connection, which stops the address being
  shown in Foundry. The remove confirmation says plainly that this **cannot un-send an address
  someone already has** — that is a true statement about the world and members are told it rather
  than left to assume otherwise.

**The address is never copied into the connection record.** It is joined live from `auth.users` at
read time, and only where both parties are still `approved`, so there is no snapshot to go stale
after an email change.

There is one copy elsewhere, and it is stated rather than glossed: the accept notification *tells*
the requester the address, so the mail body sitting in the `outbound_email` queue contains it. That
was an unbounded window until `purge_sent_outbound_email()` (migration
`20260917000013`) — a sent row is now deleted 7 days after it is sent. The mail itself, once
delivered, is in the recipient's inbox and outside our control; that is inherent to disclosing an
address by email and is what the remove confirmation is telling members when it says removal cannot
un-send what someone already has.

## The automatic throttle, against Art. 22

A member's daily request cap drops from 10 to 3 for 30 days once **five distinct** other members
have blocked them or had a report upheld against them. This is the one automated measure in the
feature and it is reasoned through rather than waved past.

- **What it affects:** one rate limit. Not account status, not visibility in the directory, not
  access to any part of the service, not existing connections, not the ability to reply to anyone.
  A throttled member can still send three requests a day.
- **What triggers it:** other members' explicit acts — a block, or a report an admin upheld. Never
  inference, and specifically **never a decline rate.** This community has a status gradient
  (students → alumni → angels), so a junior member's requests going unanswered is not misbehaviour,
  and throttling on it would penalise exactly who the platform exists to help. Decline rate is
  surfaced to a human in the admin queue and drives nothing.
- **Temporary and self-reversing:** it is *computed* at call time from a 90-day event window, never
  stored. There is no flag to go stale and no un-throttle job to fail — the window simply stops
  matching.
- **Human intervention (Art. 22(3)):** an admin can lift it, and doing so writes an `admin_actions`
  row.

A rate limit with a trigger is not a decision producing legal or similarly significant effects.
Recorded here because the honest way to reach that conclusion is to state the measure and test it,
not to answer "None" on the ROPA line and move on — which is why the ROPA line now says what this
is instead.

## Risks identified, and what mitigates them

| Risk | Mitigation |
|---|---|
| **Email harvesting** — one member farming addresses at scale | Caps enforced **inside the RPC**, in the same transaction as the insert, so a direct PostgREST call cannot bypass them: 10/day, 25/week, 30 outstanding. A second Upstash bucket sits above them as an outer guard. Both parties must be approved at *every* step, re-checked at accept, not just at request |
| A **banned member** collects an address between request and accept | `respond_to_connection_request` re-checks both parties' status at accept; pending rows from non-approved members are filtered out of every inbox |
| **Probing** — using refusals to learn that you have been blocked | Blocked, on-cooldown, paused (`open_to_connections = false`) and no-such-member all return one **byte-identical** message, and `connection_state_with` collapses them to a single `unavailable` state. `rls_smoke.sql` asserts the messages are identical, because this is the guarantee most easily broken by a well-meaning copy edit |
| **Harassment by repeated requesting** | 21-day cooldown after decline *and* after withdraw *and* after removal. Removal deliberately carries one: without it, remove → re-request → repeat is a harassment loop bounded only by the daily cap |
| A member cannot make contact stop | **Block** is a distinct control, never folded into decline — buried in a decline flow, people decline when they mean to block and the signal goes quiet. It is permanent, silent, removes any existing connection, and reversible only by the blocker. `list_my_blocked_members` exists so unblocking does not require finding the person again in a directory of thousands |
| An **abusive note** reaches someone who never opened the app | The digest carries **names and counts only, never note text**. In Foundry a note sits next to a Block control and a Report control; in an inbox it sits next to nothing. This also removes the HTML-injection surface entirely rather than relying on an escape staying correct forever |
| **Admins reading private notes** unaccountably | A note is not a column on the admin queue. Reading one is a separate action that writes an `admin_actions` row **before** the text is returned, so the audit record survives a lost response. An admin who is a party to the reported connection is shown a conflict-of-interest notice, and the action is logged either way |
| A report becomes **unadjudicable** because the connection was deleted | The note is snapshotted into the report at report time |
| Digest mail **degrading sign-in deliverability** | Auth mail and digests leave on the same sending domain, so a spam complaint about a digest costs sign-in codes. Hence the per-member opt-out, one digest per day maximum, only when something is actually waiting, and exactly-once claiming so a cron misfire cannot double-send |
| Unbounded retention creeping in | Every window is enforced by cron: pending expires at 6 months and the expired row is then deleted outright; a removed, declined or withdrawn connection is hard-deleted 21 days after it settled, when the cooldown it was holding lapses; reports and events purge at 12 months, except a report still open, which is kept until a human closes it rather than silently deleted |

## Open point for the DPO

`connection_events` deliberately survives account deletion — the connection id and the actor and
subject ids carry no foreign key, so a member cannot erase the record of their own conduct by
closing their account. Art. 17(3)(e), bounded to 12 months.

**This is the same judgement already open for `post_moderation_log`**, on the same basis, and the
two should be confirmed together rather than separately. If the advice is that the record must not
survive erasure, the change is small in both cases: add the foreign key and let it cascade.

One thing is worth flagging alongside it. Unlike a moderation log, `connection_events` also records
ordinary, unremarkable behaviour — that A asked B to connect and B accepted — and it keeps that for
12 months after the connection itself is gone. The retention is justified by the throttle (which
reads a 90-day window) and by report adjudication, but the DPO may take the view that
`requested` / `accepted` / `withdrawn` events should age out faster than `blocked` /
`report_upheld` ones. That would be a straightforward change to `purge_connection_records()` and is
raised now rather than after launch.

## Related duties

The note makes this a user-to-user service under the UK Online Safety Act, extending the
illegal-content duties already flagged for community posts. Reporting, complaints handling, block
and admin resolution are implemented, and a new report now notifies the moderation inbox rather
than waiting to be found in a queue. `09-osa-illegal-content-risk-assessment.md` covers the feed
and **should be extended to cover member-to-member connection notes**.

## Re-run this screening if

- connection-to-connection edges are ever **drawn** (they are stored today, never rendered), or a
  "N mutual connections" count reaches any surface;
- an admin view of the whole network is introduced;
- the Phase 2 agent is permitted to cite the graph as a reason for a recommendation;
- the throttle is extended to affect anything beyond a rate limit, or to trigger on anything other
  than another member's explicit act;
- in-app messaging is added, or the note stops being a one-shot field attached to a request;
- any email carries note text;
- a contact detail beyond the login email address is exchanged;
- membership grows by an order of magnitude.
