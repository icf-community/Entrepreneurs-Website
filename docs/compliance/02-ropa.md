# 02 · Record of Processing Activities (ROPA)

Prepared under **Article 30, UK GDPR**. DRAFT for the controller's review.

- **Data Controller:** IC Founders Ltd (Companies House 17171277), registered office
  71–75 Shelton Street, London WC2H 9JQ. The company operates Foundry
  (imperialentrepreneurs.com) and determines the purposes and means of the processing
  recorded here. Imperial College London is not the controller for this service; the
  society's association with the College does not make the College a joint controller of
  data the company collects through this platform.
- **Information Asset Owner (IAO):** ⚠ CONFIRM — [director or officer of IC Founders Ltd]
- **Information Asset Administrator (IAA):** ⚠ CONFIRM — [project owner running operations]
- **Categories of data subject:** Imperial students and verified Imperial alumni who register;
  individuals who contact the platform via the contact/appeals forms.
- **Special-category data:** None collected by design (Art. 9 not engaged).
- **Automated decision-making / profiling (Art. 22):** No decision producing legal or similarly
  significant effects. One automated measure exists and is disclosed rather than omitted: the
  connections sending throttle in item R, which reduces one rate limit for 30 days after five
  distinct members have blocked or successfully reported the sender. It is temporary, decays
  automatically, affects no account status or access, and is admin-reversible. Reasoned through
  against Art. 22 in item R and in `07-dpia-screening.md`.

> **Lawful basis** below is a *suggested* mapping for the DPO to confirm. For a voluntary
> membership community the realistic candidates are **performance of a contract / service**
> (Art. 6(1)(b)) for account and core features, and **legitimate interests** (Art. 6(1)(f))
> for security and cookieless analytics. The controller's data protection contact decides the final basis.

---

## Processing activities

### A. Account creation & authentication
| Field | Detail |
|-------|--------|
| **Data** | Email address, auth provider, sign-in timestamps; first name & surname |
| **Purpose** | Create and secure a member account; verify Imperial affiliation |
| **Suggested basis** | Contract / performance of a service (Art. 6(1)(b)) |
| **Recipients (processors)** | Supabase (store + auth); Supabase Auth SMTP (magic-link/confirmation email) |
| **Retention** | For the life of the account; erased immediately on user-initiated deletion (`delete_my_account`). **Proposed (not yet automated):** inactivity-based deletion after a defined dormancy period — see note below |
| **Location** | Supabase (⚠ confirm region) |

### B. Member profile & directory
| Field | Detail |
|-------|--------|
| **Data** | First/last name, optional LinkedIn/GitHub/portfolio URLs, graduation year, short bio, "what I'm working on", self-selected interests & expertise |
| **Purpose** | Display the member in the community directory; enable relevant introductions |
| **Suggested basis** | Contract / legitimate interests; optional fields are user-supplied |
| **Recipients** | Supabase; visible to other approved members in-app |
| **Retention** | For the life of the account; erased on account deletion |
| **Location** | Supabase (⚠ confirm region) |

### C. Listings (opportunities / events / VC-grants)
| Field | Detail |
|-------|--------|
| **Data** | Listing content + a contact email; poster identity (`posted_by`) |
| **Purpose** | Let members publish and discover opportunities, events and funding |
| **Suggested basis** | Contract / legitimate interests |
| **Recipients** | Supabase; published listings visible to approved members; admins during review |
| **Retention** | **Rejected** listings auto-purged **2 days** after review; **expired** listings removed by daily cron; otherwise until the poster deletes them or their account |
| **Location** | Supabase (⚠ confirm region) |

### D. Transactional email
| Field | Detail |
|-------|--------|
| **Data** | Recipient email address + message body (acceptance, rejection, contact reply, account-removal, connection accept, connection digest). One body carries a *third party's* address: the connection-accept mail names the address the requester has just been given |
| **Purpose** | Operational communication tied to membership and submissions |
| **Suggested basis** | Contract / legitimate interests |
| **Recipients** | Resend (send); recipient names are HTML-escaped, never in headers |
| **Retention** | Queued rows in `outbound_email` are drained every 5 minutes, and the sent row is then deleted after **7 days** by `purge_sent_outbound_email()` (daily, 02:50) — long enough to answer "did that mail go?", short enough that the queue is not an archive of message bodies. A row that exhausted its retries is kept 30 days as the delivery-failure diagnostic, then deleted. Delivery logs per Resend's retention |
| **Location** | Supabase (queue) → Resend (EU, ⚠ confirm) |

### E. Contact & appeals inbox
| Field | Detail |
|-------|--------|
| **Data** | Submitter email, subject, free-text message |
| **Purpose** | Respond to enquiries and membership appeals |
| **Suggested basis** | Legitimate interests (handling enquiries) |
| **Recipients** | Resend (confirmation/ticket email); Cloudflare email routing → monitored inbox |
| **Retention** | ⚠ POLICY NEEDED — recommend "archived on resolution, purged at end of the following academic year unless needed for an ongoing dispute" (consistent with the DART draft). Not currently automated. |
| **Location** | Resend / Cloudflare / inbox provider |

### F. Abuse prevention (rate limiting & bot-check)
| Field | Detail |
|-------|--------|
| **Data** | Short-lived counters keyed to user-id / IP; Cloudflare Turnstile token |
| **Purpose** | Prevent spam, brute force and automated abuse |
| **Suggested basis** | Legitimate interests (security) |
| **Recipients** | Upstash Redis (counters); Cloudflare (Turnstile) |
| **Retention** | Counters expire within the sliding window (minutes–1 hour); no profile data stored |
| **Location** | Upstash EU (⚠ confirm) / Cloudflare global edge |

### G. Error monitoring
| Field | Detail |
|-------|--------|
| **Data** | Error stack traces; may incidentally include a user-id |
| **Purpose** | Detect and fix production faults; security incident detection |
| **Suggested basis** | Legitimate interests |
| **Recipients** | Sentry (errors only — no performance tracing, no session replay, no PII replay) |
| **Retention** | Per Sentry's default error-event retention |
| **Location** | Sentry EU via DSN (⚠ confirm org region) |

### H. Product analytics
| Field | Detail |
|-------|--------|
| **Data** | Page-view / page-leave events tied to a Supabase user-id; IP seen at network level |
| **Purpose** | Understand feature usage to improve the platform |
| **Suggested basis** | Legitimate interests (cookieless, no cross-site tracking) |
| **Recipients** | PostHog |
| **Notes** | **Cookieless** — `persistence: "memory"`, no cookies, no localStorage device id; autocapture off; session recording disabled |
| **Location** | PostHog EU (`eu.i.posthog.com`) |

### I. Admin audit log
| Field | Detail |
|-------|--------|
| **Data** | Which admin approved/rejected which item, and when |
| **Purpose** | Accountability and operational audit |
| **Suggested basis** | Legitimate interests |
| **Recipients** | Supabase only (admin-readable) |
| **Retention** | Retained as an audit record; admin's own authored actions removed if that admin deletes their account |
| **Location** | Supabase (⚠ confirm region) |

### J. Community posts (member-to-member feed)
| Field | Detail |
|-------|--------|
| **Data** | Post title and body written by the member; 0–2 attached images and the alt text describing them; author identity |
| **Purpose** | Operating the member-to-member Community feed |
| **Suggested basis** | Performance of contract (the membership service), supported by consent at the point of posting |
| **Recipients** | Supabase (post text); Microsoft Azure UK South (images only) |
| **Retention** | **7 days from publication**, enforced by `purge_expired_posts()` hourly. Sooner on member request (self-delete), on admin takedown, on ban, or on account deletion |
| **Location** | Supabase (EU/London) + Azure Blob Storage (UK South), private container, read only via short-expiry SAS |

Images are re-encoded on upload and all embedded metadata is discarded, including EXIF GPS
coordinates written by phone cameras. The original file is never stored.

### K. Post reports (complaints mechanism)
| Field | Detail |
|-------|--------|
| **Data** | Reporter identity, the post reported (title snapshotted so it survives removal), category, free-text reason, outcome and any note |
| **Purpose** | Operating a complaints and illegal-content reporting route, and evidencing that reports were acted on |
| **Suggested basis** | Legitimate interests (member safety, platform integrity), and compliance with a legal obligation where the report concerns illegal content |
| **Recipients** | Supabase only (admin-readable via RPC; the table itself is deny-all) |
| **Retention** | **12 months** from creation, via `purge_moderation_records()` daily |
| **Location** | Supabase |

The reporter is never disclosed to the author of the reported post.

### L. Post moderation log (takedown record)
| Field | Detail |
|-------|--------|
| **Data** | Snapshot of the removed post's title and body, author id and email at time of removal, acting admin, reason given, timestamps |
| **Purpose** | Explaining, reviewing, and if necessary defending a moderation decision that a member challenges |
| **Suggested basis** | Legitimate interests; and Art. 17(3)(e) where retention is necessary for the establishment, exercise or defence of legal claims |
| **Recipients** | No application access at all — service role / direct SQL only |
| **Retention** | **12 months**, via `purge_moderation_records()` daily. A `legal_hold` flag exempts a single record while a dispute is live |
| **Location** | Supabase |

⚠ **This is the one record that deliberately survives account deletion.** `author_id` carries no
foreign key precisely so that a member cannot erase the record of their own moderation by closing
their account — the record exists for the case where that matters. The member is told this in
Privacy §8 and Terms §6. **This design decision should be confirmed with the DPO before launch.**

### M. Profile photographs
| Field | Detail |
|-------|--------|
| **Data** | A member-supplied photo, cropped by the member to a square before upload |
| **Purpose** | Display the member in the directory and their own profile |
| **Suggested basis** | Consent (upload is optional and skippable; a member who declines is shown initials instead) |
| **Recipients** | Microsoft Azure UK South only — never Supabase, never the web tier |
| **Retention** | Follows the profile; replacing or removing a photo, or deleting the account, immediately queues the old blob for deletion (drained within ~5 min); the 30-day account-lifecycle rule is the backstop |
| **Location** | Azure Blob Storage (UK South), private container, read only via short-expiry SAS |

Re-encoded on upload the same way a community post image is — EXIF (including GPS) stripped, no
original retained. A face is personal data, but is **not** treated as biometric data under Art. 9:
the photo is never processed for unique identification, only displayed, so no special-category
basis applies.

### N. CV / résumé storage
| Field | Detail |
|-------|--------|
| **Data** | A member-supplied PDF or DOCX CV, stored as uploaded — the original bytes, not re-encoded |
| **Purpose** | Let the member share their CV from their profile; source document for the skill-suggestion processing in item O |
| **Suggested basis** | Consent (upload is optional; a separate, explicit, unticked-by-default checkbox covers the text-extraction use in item O) |
| **Recipients** | Microsoft Azure UK South only. **Admin access is permitted and logged**: every admin view of a member's CV writes an `admin_actions` row (`action='view_cv'`) — this is a deliberate decision, not an oversight, needed for abuse handling and DSARs |
| **Retention** | One CV per member, no version history. Replacing or removing it, or deleting the account, immediately queues the old blob for deletion (drained within ~5 min); the 30-day account-lifecycle rule is the backstop |
| **Location** | Azure Blob Storage (UK South), private container, read only via short-expiry SAS scoped to the owner or an admin |

A CV routinely carries data from which health, ethnicity, religion or age are inferable, which is
why it gets its own item rather than folding into "member profile." **PDF embedded JavaScript /
launch actions are accepted, not stripped** — a deliberate decision, not an oversight: the file is
served `Content-Disposition: attachment` from a separate origin, so any embedded script is inert
unless a member downloads and opens it in a desktop PDF reader, and the only person exposed to that
is the CV's own owner or an admin who chose to open it. Stripping it would require re-encoding the
document, which would break the "re-runnable from the original bytes" property the skill-suggestion
matcher in item O depends on.

### O. CV text extraction for skill suggestion
| Field | Detail |
|-------|--------|
| **Data** | Plain text extracted from the CV in item N, held only in memory for the duration of one request |
| **Purpose** | Suggest closed-taxonomy skills for the member to confirm on their profile — a deterministic string match, not inference. The list of ~180 possible skills is fixed; nothing outside it can ever be suggested |
| **Suggested basis** | Consent — a separate, explicit, unticked-by-default checkbox, distinct from the CV-upload consent in item N |
| **Recipients** | None — processed entirely within the member's own upload request; the extracted text is never sent to a third party, never logged, and never rendered back to any user |
| **Retention** | **Not retained.** The text is extracted, matched against the fixed skill list, and discarded within the same request. Only the matched skill ids — not the text, and not the matched strings — are returned to the member's browser, and only as suggestions the member must actively confirm |
| **Location** | Vercel (the Next.js server action that already holds the CV read credential) |

No LLM is involved and no automated decision is made: the match is a fixed string comparison
against a controlled vocabulary, and every suggestion requires the member's own action to become
part of their profile. This is a materially weaker processing claim than an LLM-based version would
be — see `07-dpia-screening.md` for the corresponding re-screen.

### P. Connections — the mutual connection graph
| Field | Detail |
|-------|--------|
| **Data** | One row per *pair* of members for the life of the relationship: the two member ids, the current status, who sent, who decided, when, and (on an accepted row) the version of the consent wording both parties saw |
| **Purpose** | Letting two members who each agreed to it exchange their email addresses, and remembering that they agreed |
| **Suggested basis** | **Consent** (Art. 6(1)(a)) — sending is the requester's consent and accepting is the addressee's, and either can be withdrawn by removing the connection. Not contract: nothing about membership requires anyone to connect with anyone |
| **Recipients** | Supabase only. The table is deny-all RLS with **no policies at all**; every read goes through a `SECURITY DEFINER` RPC that scopes to the caller's own edges |
| **Retention** | For the life of the relationship. A settled row — removed, declined or withdrawn — is hard-deleted once its 21-day cooldown lapses (`purge_removed_connections()`); the cooldown is enforced by reading that row, so it cannot be deleted sooner. A pending request expires at 6 months and the expired row is deleted on sight, since expiry carries no cooldown. A blocked row is never purged: the block is the row, and it lasts until the blocker lifts it. Account deletion cascades every row on both FK columns |
| **Location** | Supabase (EU/London) |

**The email address is never stored here.** It is joined live from `auth.users` at read time, and
only for a pair where both sides are still `approved`. A member who changes their login address
does not leave a stale copy in anybody else's connection list. The one qualification, because it
would otherwise be an overclaim: the accept notification names the address in its body, so a copy
exists in the `outbound_email` row for as long as that row does — 7 days after sending, per item D.
Nothing in this table holds one.

**Who-knows-who is a new data category for this platform, and it is never published.** No RPC
returns an edge the caller is not a party to. The graph view renders the caller's own connections
only — an edge between two of your connections exists in the table and is deliberately not drawn,
because those two consented to share an address with *you*, not to have their own relationships
shown to you. "N mutual connections" counts are excluded from v1 for the same reason: at this
community's size a count of 1 is an identification.

### Q. Connection request notes
| Field | Detail |
|-------|--------|
| **Data** | An optional free-text note of up to 300 characters, written by the requester and addressed to one other member |
| **Purpose** | Letting a requester say why they want to connect, so the recipient has something to decide on |
| **Suggested basis** | Consent — the note is optional, and is written knowing the recipient will read it |
| **Recipients** | The recipient only. Admins can read one **only** on a report, and each read writes an `admin_actions` row *before* the text is returned |
| **Retention** | The note has no separate clock: it is deleted with the row that carries it, per item P — three weeks after the request is declined or withdrawn, or on sight once it expires. A note snapshotted into a report follows item R's 12 months |
| **Location** | Supabase |

**The note never appears in an email.** The daily digest carries names and counts only. That
removes the HTML-injection surface entirely rather than relying on an escape staying correct, and
it stops an abusive note reaching the inbox of somebody who would never have opened the app — in
Foundry that note sits next to a Block control and a Report control; in an inbox it sits next to
nothing.

### R. Connection reports and the connection event log
| Field | Detail |
|-------|--------|
| **Data** | *Reports:* reporter identity, the member reported, category, free-text reason, the note text snapshotted at report time, outcome and any note. *Events:* an append-only row per state change — requested, accepted, declined, withdrawn, blocked, unblocked, removed, expired, reported, report upheld — with actor, subject and timestamp |
| **Purpose** | Operating a complaints route for member-to-member contact; and computing the automatic sending throttle, which is derived from the event log rather than stored |
| **Suggested basis** | Legitimate interests (member safety, platform integrity); compliance with a legal obligation where a report concerns illegal content |
| **Recipients** | Supabase only (admin-readable via RPC; both tables are deny-all) |
| **Retention** | **12 months**, via `purge_connection_records()` daily — with one exemption: a report still `open` at 12 months is kept until a human closes it. A complaint nobody adjudicated in a year is a process failure, and deleting it on schedule would hide the failure instead of fixing it |
| **Location** | Supabase |

The note is snapshotted into the report because removing a connection hard-deletes the row — a
report pointing at a deleted connection would otherwise be unadjudicable.

⚠ **`connection_events` deliberately survives account deletion**, exactly as the post moderation
log does and for the same reason: `connection_id` and the actor/subject ids carry no foreign key,
so a member cannot erase the record of their own conduct by closing their account. Art. 17(3)(e),
bounded to 12 months. **Confirm with the DPO alongside item L.**

**On Art. 22.** The automatic throttle drops a member's daily request cap from 10 to 3 for 30 days once five
*distinct* other members have blocked them or had a report upheld against them. It is reasoned
through rather than waved past: it is triggered only by other members' explicit acts, never by
inference or by a decline rate; it restricts one rate limit and nothing else — no account status,
no visibility, no access to any part of the service; it is temporary and decays on its own, with
no stored flag to go stale; and an admin can lift it, which is the human intervention Art. 22(3)
asks for. It is a rate limit with a trigger, not a decision about a person, and the header of
`admin_list_flagged_senders` records why decline rate is excluded from it.

---

## Retention summary (as actually implemented in code)

| Item | Retention | Mechanism |
|------|-----------|-----------|
| Rejected listings | 2 days after review | `purge_rejected_listings()` daily cron (02:30) |
| Expired opportunities / events / VC-grants | Removed once expired | Three daily expire crons (02:00 / 02:05 / 02:10) |
| Outbound email queue (sent) | 7 days after sending | `purge_sent_outbound_email()` daily (02:50); drained every 5 min |
| Outbound email queue (retries exhausted) | 30 days | `purge_sent_outbound_email()` daily (02:50) |
| Community posts + attached images | 7 days after publication | `purge_expired_posts()` hourly (:15) |
| Post likes | Cascade-deletes with the post; no independent retention | `on delete cascade` from `posts` |
| Abandoned image uploads | 24 hours | `purge_stale_upload_tickets()` hourly (:25) |
| Image bytes in Azure Blob | Follows the post; queued on delete | `blob_deletion_queue` → drained every 5 min; 30-day account lifecycle rule as backstop |
| Profile photograph | Follows the profile; queued on replace/remove/delete | `blob_deletion_queue` → drained every 5 min; 30-day account lifecycle rule as backstop |
| CV / résumé | One per member, no versions; queued on replace/remove/delete | `blob_deletion_queue` → drained every 5 min; 30-day account lifecycle rule as backstop |
| CV extracted text (skill suggestion) | Not retained — discarded within the same request | Held in memory only, never written to a table or a log |
| Post reports | 12 months | `purge_moderation_records()` daily (02:35) |
| Post moderation log (takedowns) | 12 months, unless `legal_hold` | `purge_moderation_records()` daily (02:35) |
| Connections (accepted) | For the life of the relationship | Removed on either party's action, or on account deletion (FK cascade) |
| Connections (removed, declined, withdrawn) | 21 days after the row settled — the cooldown period it is holding — then hard-deleted | `purge_removed_connections()` daily (02:45) |
| Connections (blocked) | Until the blocker lifts it; never purged, because the row *is* the block | `unblock_member()` (member-initiated) |
| Connection requests (pending) | 6 months, then `expired` | `expire_connection_requests()` daily (02:40) |
| Connections (expired) | Deleted on sight — expiry carries no cooldown, so the row has nothing left to enforce | `purge_removed_connections()` daily (02:45) |
| Connection request notes | No separate clock; deleted with the row that carries it | `purge_removed_connections()` daily (02:45) |
| Connection reports + event log | 12 months; a report still `open` is kept until a human closes it | `purge_connection_records()` daily (02:45) |
| Account & all user-owned data | Immediate on request | `delete_my_account()` (user-initiated) |
| Contact/appeals messages | ⚠ Policy to be set (proposed: end of following academic year) | Manual / not yet automated |
| Inactive accounts | ⚠ **Proposed, not implemented** (DART draft's "24 months" is aspirational) | Would require a new cron |

**Data-subject rights:** account holders can edit their profile in-app and erase their entire
account (and all owned listings/joins) themselves via Settings → Delete account. This operationally
supports the rights of rectification and erasure. Access/portability requests would currently be
handled manually by export from Supabase — a documented manual procedure should be agreed with the DPO.
