// ════════════════════════════════════════════════════════════════════
// Foundry · Server-action policy registry (launch programme B23)
//
// Every exported server action, with the one decision that matters for
// abuse: what limits it. `registry.test.ts` fails when an action is
// exported without an entry here, when an entry names an action that no
// longer exists, or when an entry claims a bucket its code doesn't call —
// the same forcing function `ratelimit.test.ts` uses for buckets.
//
// Kinds:
//   read         returns data; limited by the per-user `mutations`
//                backstop (every server action is a POST) and by RLS.
//   write-cheap  a small owner-scoped write (toggle, delete-own); the
//                fail-open backstop is enough, and failing closed would
//                lock members out of their own data during an outage.
//   write-costly a write that fans out (email, LLM, storage, other
//                members' inboxes); needs its own named bucket.
//   admin        requireAdmin() inside; admins are trusted and audited
//                (admin_actions), so no extra bucket.
//   public       reachable without a session; needs its own bucket.
//
// `bucket` is the rate-limit bucket the action (or `via`) calls.
// `via` names the shared helper file that makes the call, when it isn't
// the action's own body.
// ════════════════════════════════════════════════════════════════════

import type { RateBucket } from "@/lib/ratelimit";

export type ActionKind = "read" | "write-cheap" | "write-costly" | "admin" | "public";

export type ActionPolicy = {
  kind: ActionKind;
  bucket?: RateBucket;
  via?: string;
};

const read: ActionPolicy = { kind: "read" };
const cheap: ActionPolicy = { kind: "write-cheap" };
const admin: ActionPolicy = { kind: "admin" };
const adminListing: ActionPolicy = { kind: "admin", via: "lib/listings/admin.ts" };
const adminEdit: ActionPolicy = { kind: "admin", via: "lib/listings/edits.ts" };

export const ACTION_POLICIES: Record<string, ActionPolicy> = {
  // ── admin ───────────────────────────────────────────────────────────
  "app/admin/actions.ts#getIngestionStatus": admin,
  "app/admin/actions.ts#setIngestionEnabled": admin,
  "app/admin/actions.ts#getConnectionsStatus": admin,
  "app/admin/actions.ts#setConnectionsEnabled": admin,
  "app/admin/actions.ts#revealConnectionNote": admin,
  "app/admin/actions.ts#resolveConnectionReport": admin,
  "app/admin/actions.ts#clearSenderThrottle": admin,
  "app/admin/edits/actions.ts#approveEdit": adminEdit,
  "app/admin/edits/actions.ts#declineEdit": adminEdit,
  "app/admin/events/actions.ts#approveEvent": adminListing,
  "app/admin/events/actions.ts#rejectEvent": adminListing,
  "app/admin/events/actions.ts#bulkApproveEvents": adminListing,
  "app/admin/events/actions.ts#bulkRejectEvents": adminListing,
  "app/admin/graduates/actions.ts#previewGraduates": admin,
  "app/admin/graduates/actions.ts#promptGraduates": admin,
  "app/admin/members/actions.ts#adminDeleteUser": admin,
  "app/admin/members/actions.ts#adminSetCommittee": admin,
  "app/admin/opportunities/actions.ts#approveOpportunity": adminListing,
  "app/admin/opportunities/actions.ts#rejectOpportunity": adminListing,
  "app/admin/opportunities/actions.ts#bulkApproveOpportunities": adminListing,
  "app/admin/opportunities/actions.ts#bulkRejectOpportunities": adminListing,
  "app/admin/reports/actions.ts#resolveReport": admin,
  "app/admin/banner/actions.ts#publishSiteBanner": admin,
  "app/admin/banner/actions.ts#clearSiteBanner": admin,
  "app/admin/users/actions.ts#approveUser": admin,
  "app/admin/users/actions.ts#rejectUser": admin,
  "app/admin/users/actions.ts#bulkApproveUsers": admin,
  "app/admin/users/actions.ts#bulkRejectUsers": admin,
  "app/admin/vcs/actions.ts#approveVcGrant": adminListing,
  "app/admin/vcs/actions.ts#rejectVcGrant": adminListing,
  "app/admin/vcs/actions.ts#bulkApproveVcGrants": adminListing,
  "app/admin/vcs/actions.ts#bulkRejectVcGrants": adminListing,
  "app/community/actions.ts#adminDeletePost": admin,
  "app/profile/mediaActions.ts#adminGetCvDownloadUrl": admin,

  // ── community ───────────────────────────────────────────────────────
  "app/community/actions.ts#requestUploadTicket": { kind: "write-costly", bucket: "communityUpload" },
  "app/community/actions.ts#createPost": { kind: "write-costly", bucket: "communityPost" },
  "app/community/actions.ts#reportPost": { kind: "write-costly", bucket: "postReport" },
  "app/community/actions.ts#deleteMyPost": cheap,
  "app/community/actions.ts#toggleLike": cheap,
  "app/community/actions.ts#refreshLikeCounts": read,
  "app/community/actions.ts#loadMoreFeed": read,
  "app/community/actions.ts#loadMoreMyPosts": read,

  // ── connections ─────────────────────────────────────────────────────
  "app/connections/actions.ts#sendConnectionRequest": { kind: "write-costly", bucket: "connectionRequest" },
  "app/connections/actions.ts#respondToConnectionRequest": { kind: "write-costly", bucket: "connectionRespond" },
  "app/connections/actions.ts#withdrawConnectionRequest": { kind: "write-costly", bucket: "connectionRespond" },
  "app/connections/actions.ts#removeConnection": { kind: "write-costly", bucket: "connectionRespond" },
  "app/connections/actions.ts#blockMember": { kind: "write-costly", bucket: "connectionRespond" },
  "app/connections/actions.ts#unblockMember": { kind: "write-costly", bucket: "connectionRespond" },
  "app/connections/actions.ts#reportConnection": { kind: "write-costly", bucket: "postReport" },
  "app/connections/actions.ts#updateConnectionSettings": cheap,
  "app/connections/actions.ts#loadMoreConnections": read,
  "app/connections/actions.ts#loadMorePendingRequests": read,
  "app/connections/actions.ts#loadMoreSentRequests": read,

  // ── listings ────────────────────────────────────────────────────────
  "app/opportunities/actions.ts#submitOpportunity": { kind: "write-costly", bucket: "submit", via: "lib/actions/guardSubmission.ts" },
  "app/events/actions.ts#submitEvent": { kind: "write-costly", bucket: "submit", via: "lib/actions/guardSubmission.ts" },
  "app/vcs/actions.ts#submitVcGrant": { kind: "write-costly", bucket: "submit", via: "lib/actions/guardSubmission.ts" },
  // A staged edit emails the admins (B23).
  "app/opportunities/actions.ts#updateOwnOpportunity": { kind: "write-costly", bucket: "listingEdit", via: "lib/listings/user.ts" },
  "app/events/actions.ts#updateOwnEvent": { kind: "write-costly", bucket: "listingEdit", via: "lib/listings/user.ts" },
  "app/vcs/actions.ts#updateOwnVcGrant": { kind: "write-costly", bucket: "listingEdit", via: "lib/listings/user.ts" },
  "app/opportunities/actions.ts#toggleOpportunityBookmark": cheap,
  "app/my-submissions/actions.ts#deleteOwnListing": cheap,

  // ── profile and media ───────────────────────────────────────────────
  // Only drops the cached directory facets for the next read; takes no input.
  "app/profile/actions.ts#invalidateDirectoryCache": cheap,
  // A whole-account read (F-x2), so it gets its own daily ceiling.
  "app/settings/actions.ts#exportMyData": { kind: "read", bucket: "dataExport" },
  "app/profile/mediaActions.ts#requestAvatarTicket": { kind: "write-costly", bucket: "avatarUpload" },
  "app/profile/mediaActions.ts#requestCvTicket": { kind: "write-costly", bucket: "cvUpload" },
  "app/profile/mediaActions.ts#setMyGithubShowcase": { kind: "write-costly", bucket: "githubShowcase" },
  // Confirms consume a ticket the costly request already limited; CV
  // processing is also capped in the DB (llm_job_budget_available).
  "app/profile/mediaActions.ts#confirmAvatarUpload": cheap,
  "app/profile/mediaActions.ts#confirmCvUpload": cheap,
  "app/profile/mediaActions.ts#removeAvatar": cheap,
  "app/profile/mediaActions.ts#removeCv": cheap,
  "app/profile/mediaActions.ts#disconnectGithub": cheap,
  "app/profile/mediaActions.ts#dismissGithubShowcasePrompt": cheap,
  "app/profile/mediaActions.ts#setGithubNudges": cheap,
  "app/profile/mediaActions.ts#getMyCvDownloadUrl": read,
  "app/profile/mediaActions.ts#getMySuggestedCvSkillIds": read,
  "app/profile/mediaActions.ts#getMyCvStatus": read,
  "app/profile/mediaActions.ts#getMyCvProfile": read,
  "app/profile/mediaActions.ts#getMyGithubStatus": read,
  "app/profile/mediaActions.ts#getMyGithubShowcase": read,

  // ── Foundry AI (AI-plan §9.1) ─────────────────────────────────────────
  // A search admits a paid turn: its own fail-closed bucket, with the
  // authoritative quotas and money caps inside ai_submit_turn.
  "app/foundry-ai/actions.ts#submitTurn": { kind: "write-costly", bucket: "aiSubmit" },
  "app/foundry-ai/actions.ts#editSpec": { kind: "write-cheap", bucket: "aiEdit" },
  "app/foundry-ai/actions.ts#confirmRequirements": { kind: "write-cheap", bucket: "aiEdit" },
  "app/foundry-ai/actions.ts#loadConversation": { kind: "read", bucket: "aiRead" },
  "app/foundry-ai/actions.ts#loadResults": { kind: "read", bucket: "aiRead" },
  "app/foundry-ai/actions.ts#loadConversations": read,
  "app/foundry-ai/actions.ts#loadJobRequirements": read,
  // Owner-scoped deletes and controls; never rate-limited past the backstop,
  // so a member can always delete their own history (§9.1).
  "app/foundry-ai/actions.ts#cancelTurn": cheap,
  "app/foundry-ai/actions.ts#deleteConversation": cheap,
  "app/foundry-ai/actions.ts#deleteAllAiHistory": cheap,
  "app/foundry-ai/actions.ts#forgetMessage": cheap,
  "app/foundry-ai/actions.ts#saveFindings": cheap,
  "app/foundry-ai/actions.ts#reportMatch": { kind: "write-costly", bucket: "aiReportMatch" },
  "lib/ai/entryPoint.ts#createAiDraftHandoff": cheap,
  "lib/ai/entryPoint.ts#consumeAiDraftHandoff": cheap,
  "app/members/actions.ts#getMemberCard": read,
  "app/settings/actions.ts#setMyEducation": cheap,
  "app/home/actions.ts#confirmGraduation": cheap,
  "app/settings/actions.ts#saveAiSettings": cheap,
  "app/settings/actions.ts#previewMyProjection": read,
  "app/admin/ai/actions.ts#setAiFlag": admin,
  "app/admin/ai/actions.ts#setAiLimits": admin,
  "app/admin/ai/actions.ts#rebuildAiIndex": admin,
  "app/admin/ai/actions.ts#setOpportunityAudience": admin,

  // ── public ──────────────────────────────────────────────────────────
  "app/contact/actions.ts#submitContactTicket": { kind: "public", bucket: "submit" },
  "lib/auth/verifyOtpGate.ts#checkOtpVerifyRateLimit": { kind: "public", bucket: "otpVerify" },
  // Clears one cookie on the caller's own response; accepted in D2 (B28).
  "app/reset-password/actions.ts#clearRecoveryMarker": { kind: "public" },
};
