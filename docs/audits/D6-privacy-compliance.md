# D6 — Privacy and compliance

Audit date: 2026-10-05. Branch `feat/connections`. I compared the public privacy page
(`frontend/src/app/privacy/page.tsx`), the ROPA (`docs/compliance/02`) and the processor register
(`docs/compliance/03`) against what the code and the database actually do. That means every
`pg_cron` job, every purge function, every table keyed to a member, `export_my_data`, and every
external service the code calls.

**Gate (programme Part D):** controller sign-off recorded; no known false statement in public
copy.

**Result: not passable by me.** One false public statement (F15) and three missing processors need
**wording and a decision from the owner**, the controller. I don't write legal copy. One
code-side mismatch was fixed so the code matches what the page already promises.

## Fixed (code now matches the page)

| # | Finding | Fix |
| --- | --- | --- |
| D6-F1 | The page says *"a report that is still open when the 12 months are up is kept until it is resolved."* `connection_reports` did that. **`post_reports` didn't**: `purge_moderation_records()` deleted open post reports at 12 months. | `20260928000012_purge_keeps_open_post_reports.sql`: recreated from the live definition with `and status <> 'open'`. `rls_smoke.sql` D6 block: an open report past its date survives and a dismissed one goes. It fails before the migration and passes after. |

## For the owner: public statements that don't match processing

| # | Severity | What the page / ROPA / register says | What actually happens | Needed |
| --- | --- | --- | --- | --- |
| D6-1 | **High** | Privacy page, lines 78–79: extracted CV text *"is never stored"*, *"never … sent to a third party"* (**F15**). | The worker stores `raw_text` and sends CV text and GitHub data to **OpenAI** for extraction and summaries. The export even includes `extracted_text`. | New wording (owner/reviewer). **Until it's published, keep CV/GitHub ingestion switched off in prod** (admin → ingestion kill switch, `github_cv_ingestion_enabled`). With it on, the page is false today. |
| D6-2 | **High** | **OpenAI** isn't in the privacy page, the ROPA or the processor register. | Worker → OpenAI (CV and GitHub extraction, summaries). | A processor row: role, data, region, transfer mechanism, DPA, retention or zero-retention setting. The privacy page names it. |
| D6-3 | **Medium** | **Azure** isn't in the processor register (it is in the ROPA and on the page). | Azure Blob Storage holds every CV and profile photo. The Azure VMs run the gateway and worker. UK South. | A register row (DPA = Microsoft Products and Services DPA). |
| D6-4 | Low | **GitHub** isn't in the register. | GitHub OAuth plus API reads of a connected member's public repos. GitHub is a separate controller for the member's own account, but our API use belongs in the register. | A register row, or a note that it's a separate controller. |
| D6-5 | Low | The page says *"Emails we send you — 7 days."* | Sent mail: 7 days ✓. **Mail that failed permanently is kept 30 days** (`purge_sent_outbound_email`), for diagnosis. | One clause, or shorten the code to 7 days. |
| D6-6 | Low | No mention of **in-app notifications**. | Kept 90 days (`purge_old_notifications`), and they're in the export. | A line in the retention list, plus ROPA. |
| D6-7 | Low | No mention of the **admin audit log**. | `admin_actions` is kept indefinitely. Since D3 it survives an admin's account deletion with the admin's identity removed. | A line: what's logged, for how long, and the basis (legitimate interest / Art. 17(3)(e)). Also decide the D3 question: keep a "who" snapshot after deletion or not. |
| D6-8 | Low | No mention of the **email-change log**. | `email_change_log`: old address, new address and time, kept with the account. It's in the export. | A line in the retention list. |
| D6-9 | Low | **Listing view and click analytics.** | `listing_events` (who viewed or clicked which listing) has no purge job, so it's kept until account deletion. It's in the export as `listing_views`. | Set a retention period (e.g. 12 months, which would need a purge job), or state "until you delete your account". |

## Retention: code vs page (all other rows match)

| Data | Page | Code |
| --- | --- | --- |
| Community posts and images | 7 days | `posts.expires_at = now() + 7 days`, hourly purge ✓ |
| Profile photo and CV | until replaced, removed or account deleted | blob-deletion queue on replace/remove/delete ✓ |
| Moderation records | 12 months, unless a dispute is live | `purge_after` 1 year, `legal_hold` respected ✓ |
| Reports | 12 months; open ones kept until resolved | ✓ after D6-F1 |
| Removed connection | deleted within a day | daily `purge_removed_connections` ✓ |
| Declined / withdrawn request | 3 weeks (the cooldown) | deleted once `cooldown_until` passes ✓ |
| Unanswered request | expires after 6 months | `expire_connection_requests` uses `connection_limit('expiry_months')` ✓ |
| Connection activity log | 12 months, survives account deletion | `connection_events.purge_after` 1 year ✓ |
| Sent email | 7 days | 7 days ✓ (failed mail: 30, see D6-5) |
| Upload tickets | (internal) | 24 h |
| Rejected listings | (internal) | 2 days |

## Data export (DSAR) — what it covers

`export_my_data` covers the following, and `e2e/export.spec.ts` runs it end to end:
- account and profile, skills, sectors, interests, intents;
- listings and edits;
- bookmarks, listing actions and views;
- posts, likes and reports;
- connections (own side) and connection reports;
- notifications and email changes;
- CVs, including extracted text, profile and skills;
- GitHub.

Not included, for an owner decision:
- **an admin's own `admin_actions` rows**, which are personal data about that admin;
- **`connection_events` about the member** (the 12-month activity log). Only the member's own
  side could go in, without other members' IDs;
- **`cv_profiles.summary`** (already on the owner list).

## Owner checklist (gate)

1. Wording for D6-1 to D6-9, then update the privacy page, ROPA and register. **D6-1 and D6-2
   before ingestion is switched on in prod.**
2. Decide the export additions above.
3. Record controller sign-off (date and name) in `docs/compliance/README.md`.
