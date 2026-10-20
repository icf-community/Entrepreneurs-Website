import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ACTION_POLICIES } from "./registry";

// S0 (docs/audits/D9-concurrency.md): what happens when every write action
// is sent twice — a double click, Enter after a click, a retry on a slow
// connection. Each write in the registry says why a second call is safe:
//
//   server  the database makes it safe (idempotent RPC, conditional update,
//           row lock, advisory lock, unique index, claim-once), proven in
//           server/tests/integration/test_concurrency.py, test_ai_races.py
//           or rls_smoke.sql;
//   e2e     the browser test that double-submits it under a slow server
//           (named here, checked to exist).
//
// A new write action fails this test until it says which.

type Why = { server: string } | { e2e: string };

const DOUBLE_SUBMIT: Record<string, Why> = {
  // ── admin ─────────────────────────────────────────────────────────
  "app/admin/actions.ts#setIngestionEnabled": { server: "sets a flag to a value; repeating it changes nothing" },
  "app/admin/actions.ts#setConnectionsEnabled": { server: "sets a flag to a value" },
  "app/admin/actions.ts#revealConnectionNote": { server: "a read with an audit row; a second reveal is a second, true audit entry" },
  "app/admin/actions.ts#resolveConnectionReport": { server: "conditional update on an open report" },
  "app/admin/actions.ts#clearSenderThrottle": { server: "clears to a fixed state" },
  "app/admin/edits/actions.ts#approveEdit": { server: "admin_apply_listing_edit locks the pending edit (for update)" },
  "app/admin/edits/actions.ts#declineEdit": { server: "admin_reject_listing_edit locks the pending edit (for update)" },
  "app/admin/events/actions.ts#approveEvent": { server: "row lock before the pending check (test_approve_and_reject_…)" },
  "app/admin/events/actions.ts#rejectEvent": { server: "row lock before the pending check" },
  "app/admin/events/actions.ts#bulkApproveEvents": { server: "per-item row lock; a decided item is refused" },
  "app/admin/events/actions.ts#bulkRejectEvents": { server: "per-item row lock" },
  "app/admin/graduates/actions.ts#promptGraduates": { server: "stamps each student once; a second run reaches nobody (rls_smoke 38)" },
  "app/admin/members/actions.ts#adminDeleteUser": { server: "locks the account; the second finds it gone (test_an_account_is_deleted_once)" },
  "app/admin/members/actions.ts#adminSetCommittee": { server: "sets a flag to a value" },
  "app/admin/opportunities/actions.ts#approveOpportunity": { server: "row lock before the pending check" },
  "app/admin/opportunities/actions.ts#rejectOpportunity": { server: "row lock before the pending check" },
  "app/admin/opportunities/actions.ts#bulkApproveOpportunities": { server: "per-item row lock" },
  "app/admin/opportunities/actions.ts#bulkRejectOpportunities": { server: "per-item row lock" },
  "app/admin/reports/actions.ts#resolveReport": { server: "row lock on the report (test_a_post_report_is_resolved_once)" },
  "app/admin/banner/actions.ts#publishSiteBanner": { server: "one-row upsert of the same content" },
  "app/admin/banner/actions.ts#clearSiteBanner": { server: "clears the one row" },
  "app/admin/users/actions.ts#approveUser": { server: "row lock on the profile" },
  "app/admin/users/actions.ts#rejectUser": { server: "row lock on the profile (test_approve_and_reject_of_one_member_…)" },
  "app/admin/users/actions.ts#bulkApproveUsers": { server: "per-item row lock" },
  "app/admin/users/actions.ts#bulkRejectUsers": { server: "per-item row lock" },
  "app/admin/vcs/actions.ts#approveVcGrant": { server: "row lock before the pending check" },
  "app/admin/vcs/actions.ts#rejectVcGrant": { server: "row lock before the pending check" },
  "app/admin/vcs/actions.ts#bulkApproveVcGrants": { server: "per-item row lock" },
  "app/admin/vcs/actions.ts#bulkRejectVcGrants": { server: "per-item row lock" },
  "app/community/actions.ts#adminDeletePost": { server: "row lock on the post (test_a_post_is_removed_once)" },
  "app/admin/ai/actions.ts#setAiFlag": { server: "sets a flag to a value" },
  "app/admin/ai/actions.ts#setAiLimits": { server: "locks the settings row; sets values" },
  "app/admin/ai/actions.ts#rebuildAiIndex": { server: "jobs_one_pending trigger: one pending refresh per target" },
  "app/admin/ai/actions.ts#setOpportunityAudience": { server: "sets a value" },
  // ── members ───────────────────────────────────────────────────────
  "app/community/actions.ts#requestUploadTicket": { server: "a second ticket is unused and purged after 24 h" },
  "app/community/actions.ts#createPost": { server: "per-member advisory lock + duplicate check (test_a_double_submitted_post_is_posted_once)" },
  "app/community/actions.ts#reportPost": { server: "unique (post_id, reporter_id)" },
  "app/community/actions.ts#deleteMyPost": { server: "deleting a deleted post is a no-op" },
  "app/community/actions.ts#toggleLike": { server: "serialised per member and post (test_concurrent_like_toggles_never_error)" },
  "app/connections/actions.ts#sendConnectionRequest": { server: "returns the existing pending request (pair unique index + retry)" },
  "app/connections/actions.ts#respondToConnectionRequest": { server: "conditional update on a pending request" },
  "app/connections/actions.ts#withdrawConnectionRequest": { server: "conditional update on a pending request" },
  "app/connections/actions.ts#removeConnection": { server: "already removed returns ok" },
  "app/connections/actions.ts#blockMember": { server: "sets the pair to blocked" },
  "app/connections/actions.ts#unblockMember": { server: "sets the pair back" },
  "app/connections/actions.ts#reportConnection": { server: "unique (connection_id, reporter_id)" },
  "app/connections/actions.ts#updateConnectionSettings": { server: "sets values" },
  "app/opportunities/actions.ts#submitOpportunity": { e2e: "double submit: a ${kind.name} submitted twice on a slow connection is created once" },
  "app/events/actions.ts#submitEvent": { e2e: "double submit: a ${kind.name} submitted twice on a slow connection is created once" },
  "app/vcs/actions.ts#submitVcGrant": { e2e: "double submit: a ${kind.name} submitted twice on a slow connection is created once" },
  "app/opportunities/actions.ts#updateOwnOpportunity": { server: "writes the same fields again; locked against a racing approval" },
  "app/events/actions.ts#updateOwnEvent": { server: "writes the same fields again; locked against a racing approval" },
  "app/vcs/actions.ts#updateOwnVcGrant": { server: "writes the same fields again; locked against a racing approval" },
  "app/opportunities/actions.ts#toggleOpportunityBookmark": { e2e: "double submit: a bookmark tapped twice on a slow connection ends bookmarked once" },
  "app/my-submissions/actions.ts#deleteOwnListing": { server: "deleting a deleted listing is a no-op" },
  "app/profile/actions.ts#invalidateDirectoryCache": { server: "cache invalidation is idempotent" },
  "app/profile/mediaActions.ts#requestAvatarTicket": { server: "a second ticket is unused and purged after 24 h" },
  "app/profile/mediaActions.ts#requestCvTicket": { server: "a second ticket is unused and purged after 24 h" },
  "app/profile/mediaActions.ts#setMyGithubShowcase": { server: "sets picks; the refresh job is deduplicated by jobs_one_pending" },
  "app/profile/mediaActions.ts#confirmAvatarUpload": { server: "ticket claimed atomically (test_an_avatar_ticket_is_consumed_once)" },
  "app/profile/mediaActions.ts#confirmCvUpload": { server: "ticket claimed atomically (test_an_upload_ticket_is_consumed_once)" },
  "app/profile/mediaActions.ts#removeAvatar": { server: "clears to a fixed state" },
  "app/profile/mediaActions.ts#removeCv": { server: "clears to a fixed state" },
  "app/profile/mediaActions.ts#disconnectGithub": { server: "disconnecting twice leaves it disconnected" },
  "app/profile/mediaActions.ts#dismissGithubShowcasePrompt": { server: "sets a timestamp" },
  "app/profile/mediaActions.ts#setGithubNudges": { server: "sets a flag to a value" },
  "app/foundry-ai/actions.ts#submitTurn": { server: "one idempotency key per user action; the second call returns the same turn (test_one_idempotency_key_makes_one_turn…)" },
  "app/foundry-ai/actions.ts#editSpec": { server: "expected revision: the second edit gets stale_revision" },
  "app/foundry-ai/actions.ts#confirmRequirements": { server: "locks the requirements row; same list again; version-checked (R9)" },
  "app/foundry-ai/actions.ts#cancelTurn": { server: "conditional update on queued/running" },
  "app/foundry-ai/actions.ts#deleteConversation": { server: "deleting twice is a no-op" },
  "app/foundry-ai/actions.ts#deleteAllAiHistory": { server: "deleting twice is a no-op" },
  "app/foundry-ai/actions.ts#forgetMessage": { server: "deleting twice is a no-op" },
  "app/foundry-ai/actions.ts#saveFindings": { server: "on conflict (turn_id) do nothing (test_r15_…)" },
  "app/foundry-ai/actions.ts#reportMatch": { server: "on conflict (turn_id, reporter_id, target_id) do nothing" },
  "app/settings/actions.ts#setMyEducation": { server: "upsert to the same values" },
  "app/home/actions.ts#confirmGraduation": { server: "locks the profile; the second call is refused once the member is no longer a student" },
  "app/settings/actions.ts#saveAiSettings": { server: "upsert to the same values" },
  // ── public ────────────────────────────────────────────────────────
  "app/contact/actions.ts#submitContactTicket": { server: "Turnstile tokens are single-use: the second submit fails verification" },
  "lib/auth/verifyOtpGate.ts#checkOtpVerifyRateLimit": { server: "counts an attempt; no state beyond the rate bucket" },
  "app/reset-password/actions.ts#clearRecoveryMarker": { server: "clears a cookie" },
};

const E2E_DIR = join(__dirname, "..", "..", "..", "e2e");
const e2eText = readdirSync(E2E_DIR).filter((f) => f.endsWith(".spec.ts"))
  .map((f) => readFileSync(join(E2E_DIR, f), "utf8")).join("\n");

describe("every write action is safe to send twice", () => {
  // Reads are safe to repeat by definition, including admin reads that
  // carry the admin kind (get*/preview*/download-url).
  const writes = Object.entries(ACTION_POLICIES)
    .filter(([key, p]) => p.kind !== "read" && !/#(get[A-Z]|preview|adminGetCvDownloadUrl)/.test(key))
    .map(([key]) => key);

  it.each(writes)(
    "%s says why",
    (key) => {
      expect(DOUBLE_SUBMIT[key], `${key} needs an entry: which guarantee makes a second call safe?`).toBeDefined();
    },
  );

  it("names only actions that exist", () => {
    const stale = Object.keys(DOUBLE_SUBMIT).filter((k) => !(k in ACTION_POLICIES));
    expect(stale).toEqual([]);
  });

  it("names only browser tests that exist", () => {
    const missing = Object.values(DOUBLE_SUBMIT).filter((w): w is { e2e: string } => "e2e" in w)
      .filter((w) => !e2eText.includes(w.e2e));
    expect(missing).toEqual([]);
  });
});
