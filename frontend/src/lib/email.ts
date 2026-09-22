import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

// ════════════════════════════════════════════════════════════════════
// Foundry · Outbound email
//
// Every send goes through the `outbound_email` queue table in Postgres
// and is dispatched by the pg_cron-driven drain route at
// /api/cron/drain-email (see migration 20260530000003). Reasons:
//
//   * Resend's free tier is 100/day and ~2 req/sec. Bursty paths (grad
//     cleanup, contact spike) cannot send inline without tripping
//     rate limits.
//   * Pure outbox pattern gives at-least-once delivery and one place
//     to centralise retry / backoff / permanent-failure handling.
//   * 5-minute drain cadence is well inside the latency tolerance
//     for every Foundry email (rejection notices, contact tickets,
//     graduation congrats). Auth / verification / OTP mail goes
//     through Supabase Auth SMTP, not this path.
//
// All inserts run via the service-role client. The user-JWT RPC path
// previously used here was open to abuse: any authenticated session
// could relay phishing email from the Foundry sending domain. The
// service-role client bypasses RLS on outbound_email and is gated by
// `server-only` at import time, so the only callers are server-side
// actions/routes that this module already trusts to construct vetted
// templates.
// ════════════════════════════════════════════════════════════════════

type EnqueueArgs = {
  to:      string;
  subject: string;
  text:    string;
  html:    string;
  replyTo?: string;
};

function contactInbox(): string {
  return process.env.CONTACT_INBOX_EMAIL ?? "contact@imperialentrepreneurs.com";
}

// Reply-to address for messages a recipient might want to appeal:
// account rejection, account removal by admin, listing rejection.
// Falls back to the contact inbox so appeals always land somewhere
// monitored, even before APPEALS_EMAIL is configured.
function appealsInbox(): string {
  return process.env.APPEALS_EMAIL ?? "appeals@imperialentrepreneurs.com";
}

// Where a new content report lands. Falls back to the contact inbox so
// reports always reach somebody monitored, even before MODERATION_INBOX_EMAIL
// is configured — an unrouted report is the one failure this whole path
// exists to prevent.
function moderationInbox(): string {
  return process.env.MODERATION_INBOX_EMAIL ?? contactInbox();
}

// ─── Enqueue helpers ────────────────────────────────────────────────
// Service-role insert. outbound_email has RLS deny-all for
// authenticated/anon; the service role bypasses RLS and writes
// directly. No SECURITY DEFINER RPC sits between us and the table any
// more, which removes the open-relay vector that existed when the RPC
// was granted to `authenticated`.
async function enqueueEmail(args: EnqueueArgs): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("outbound_email").insert({
    to_address: args.to,
    subject:    args.subject,
    text_body:  args.text,
    html_body:  args.html,
    reply_to:   args.replyTo ?? null,
  });
  if (error) {
    throw new Error(`Failed to queue outbound email: ${error.message}`);
  }
}

// Bulk insert for paths that produce many rows at once (graduate
// cleanup, currently). Same service-role path; one round trip per
// call. Callers are responsible for ensuring the action is admin-
// authorised before invoking this — historically that happens via the
// admin server action's underlying RPC raising 42501 for non-admins.
export async function enqueueEmailsBulk(rows: EnqueueArgs[]): Promise<number> {
  if (rows.length === 0) return 0;
  const supabase = createServiceClient();
  const payload = rows.map((r) => ({
    to_address: r.to,
    subject:    r.subject,
    text_body:  r.text,
    html_body:  r.html,
    reply_to:   r.replyTo ?? null,
  }));
  const { error, count } = await supabase
    .from("outbound_email")
    .insert(payload, { count: "exact" });
  if (error) {
    throw new Error(`Failed to bulk-queue outbound emails: ${error.message}`);
  }
  return count ?? rows.length;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Profile acceptance ─────────────────────────────────────────────
// Rendered separately from sending, like renderGraduationEmail below, so
// the bulk approve path can build many of these and hand them to
// enqueueEmailsBulk in one round trip instead of one insert per member.
//
// `appUrl` deep-links to /intake, not /home. Under the identity/intake
// split (20260901000006), this email is the ONLY thing that brings an
// approved alum back to finish their profile — /home itself only bounces
// a first-time visitor there, and this is what gets them to that first
// visit. See ethereal-fluttering-blossom.md §4j.
//
// NOTE: the CTA button below is still #c9a84c gold, from before the
// 2026-08-27 monochrome redesign (PRODUCT.md). Flagged, not fixed here —
// email visual rebrand is its own piece of work.
export function renderAcceptanceEmail(opts: {
  firstName: string | null;
  appUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.firstName ? `Hi ${escapeName(opts.firstName)},` : "Hi,";
  const subject = "You're in — welcome to Foundry";
  const text = [
    greeting,
    "",
    "Good news: your Foundry application has been approved. Welcome to the private community for Imperial College London's startup ecosystem.",
    "",
    "You can now sign in and:",
    "  • Browse the member directory and connect with fellow founders, operators and alumni",
    "  • See open roles posted by people in the community on the Opportunities page",
    "  • RSVP to upcoming events on the Events page",
    "  • Find live VCs and grants accepting applications on the VCs page",
    "  • Post your own opportunity, event or VC/grant for admin review",
    "",
    "About two minutes finishes your profile — a photo, your skills, and what you're looking for. It's the difference between being a name in a list and being findable for the things you actually do:",
    "",
    opts.appUrl,
    "",
    "If you have any questions, just reply to this email.",
    "",
    "— The Foundry team",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.6;">
      <p>${escapeHtml(greeting)}</p>
      <p>Good news: your <strong>Foundry</strong> application has been approved. Welcome to the private community for Imperial College London's startup ecosystem.</p>
      <p>You can now sign in and:</p>
      <ul style="padding-left: 20px; margin: 12px 0;">
        <li>Browse the member directory and connect with fellow founders, operators and alumni</li>
        <li>See open roles posted by people in the community on the <strong>Opportunities</strong> page</li>
        <li>RSVP to upcoming events on the <strong>Events</strong> page</li>
        <li>Find live VCs and grants accepting applications on the <strong>VCs</strong> page</li>
        <li>Post your own opportunity, event or VC/grant for admin review</li>
      </ul>
      <p>About two minutes finishes your profile — a photo, your skills, and what you're looking for. It's the difference between being a name in a list and being findable for the things you actually do.</p>
      <p style="margin: 20px 0;">
        <a href="${escapeHtml(opts.appUrl)}" style="display: inline-block; padding: 10px 18px; border-radius: 8px; background: #c9a84c; color: #0c0c0b; text-decoration: none; font-weight: 500;">Finish your profile →</a>
      </p>
      <p>If you have any questions, just reply to this email.</p>
      <p style="color: #5a5855; margin-top: 32px;">— The Foundry team</p>
    </div>
  `;

  return { subject, text, html };
}

export async function sendAcceptanceEmail(opts: {
  to: string;
  firstName: string | null;
  appUrl: string;
}): Promise<void> {
  const { subject, text, html } = renderAcceptanceEmail({
    firstName:    opts.firstName,
    appUrl: opts.appUrl,
  });
  await enqueueEmail({ to: opts.to, subject, text, html, replyTo: contactInbox() });
}

/** Reply-to for the acceptance email, exported for the bulk path. */
export const acceptanceReplyTo = contactInbox;

// ─── Profile rejection ──────────────────────────────────────────────
export function renderRejectionEmail(opts: {
  firstName: string | null;
}): { subject: string; text: string; html: string } {
  const greeting = opts.firstName ? `Hi ${escapeName(opts.firstName)},` : "Hi,";
  const subject = "Your Foundry application";
  const text = [
    greeting,
    "",
    "Thank you for applying to Foundry, the private community for Imperial College London's startup ecosystem.",
    "",
    "After reviewing your application, we're unable to approve your membership at this time.",
    "",
    "If you believe this is a mistake or your circumstances have changed, please reply to this email and we'll take another look.",
    "",
    "— The Foundry team",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.6;">
      <p>${escapeHtml(greeting)}</p>
      <p>Thank you for applying to <strong>Foundry</strong>, the private community for Imperial College London's startup ecosystem.</p>
      <p>After reviewing your application, we're unable to approve your membership at this time.</p>
      <p>If you believe this is a mistake or your circumstances have changed, please reply to this email and we'll take another look.</p>
      <p style="color: #5a5855; margin-top: 32px;">— The Foundry team</p>
    </div>
  `;

  return { subject, text, html };
}

export async function sendRejectionEmail(opts: {
  to: string;
  firstName: string | null;
}): Promise<void> {
  const { subject, text, html } = renderRejectionEmail({ firstName: opts.firstName });
  await enqueueEmail({ to: opts.to, subject, text, html, replyTo: appealsInbox() });
}

/** Reply-to for the rejection email, exported for the bulk path. */
export const rejectionReplyTo = appealsInbox;

// ─── Account removed by admin ───────────────────────────────────────
export async function sendAccountRemovalEmail(opts: {
  to: string;
  firstName: string | null;
  reason: string;
}): Promise<void> {
  const greeting = opts.firstName ? `Hi ${escapeName(opts.firstName)},` : "Hi,";
  const subject = "Your Foundry account has been removed";
  const text = [
    greeting,
    "",
    "Your Foundry account has been removed by a community admin. Their note:",
    "",
    opts.reason,
    "",
    "All of your profile data, posted opportunities, events, and VC/grant submissions have been deleted from our systems.",
    "",
    "If you believe this is a mistake, please reply to this email and we'll review.",
    "",
    "— The Foundry team",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.6;">
      <p>${escapeHtml(greeting)}</p>
      <p>Your Foundry account has been removed by a community admin. Their note:</p>
      <blockquote style="margin: 16px 0; padding: 12px 16px; background: #f6f5f1; border-left: 3px solid #c9a84c; white-space: pre-wrap;">${escapeHtml(opts.reason)}</blockquote>
      <p>All of your profile data, posted opportunities, events, and VC/grant submissions have been deleted from our systems.</p>
      <p>If you believe this is a mistake, please reply to this email and we'll review.</p>
      <p style="color: #5a5855; margin-top: 32px;">— The Foundry team</p>
    </div>
  `;

  await enqueueEmail({ to: opts.to, subject, text, html, replyTo: appealsInbox() });
}

// ─── Graduation congrats + reapply-as-alum ──────────────────────────
// Two exports: the single-recipient helper for any future ad-hoc use,
// and a render helper used by the bulk-enqueue path in
// /admin/graduates/actions.ts so it can produce N rows without
// rebuilding the template logic.
export function renderGraduationEmail(opts: {
  firstName: string | null;
  alumSignupUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.firstName ? `Hi ${escapeName(opts.firstName)},` : "Hi,";
  const subject = "Congratulations on graduating from Imperial!";
  const text = [
    greeting,
    "",
    "Congratulations on graduating from Imperial College London — we wish you the very best for whatever you go on to build.",
    "",
    "Foundry's student community is for current Imperial students, so your account will be removed shortly. If you'd like to stay involved as an alum, you're warmly welcome to reapply for an alumni account using a personal email — just visit:",
    "",
    opts.alumSignupUrl,
    "",
    "Alumni applications are reviewed by an admin before access is granted; bring your strongest LinkedIn link.",
    "",
    "Thank you for being part of Foundry as a student — keep us posted on what you build next.",
    "",
    "— The Foundry team",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.6;">
      <p>${escapeHtml(greeting)}</p>
      <p>Congratulations on graduating from Imperial College London — we wish you the very best for whatever you go on to build.</p>
      <p>Foundry's student community is for current Imperial students, so your account will be removed shortly. If you'd like to stay involved as an alum, you're warmly welcome to reapply for an alumni account using a personal email:</p>
      <p style="margin: 16px 0;">
        <a href="${escapeHtml(opts.alumSignupUrl)}" style="display: inline-block; padding: 10px 18px; border-radius: 8px; background: #c9a84c; color: #0c0c0b; text-decoration: none; font-weight: 500;">Apply as an alum →</a>
      </p>
      <p>Alumni applications are reviewed by an admin before access is granted; bring your strongest LinkedIn link.</p>
      <p>Thank you for being part of Foundry as a student — keep us posted on what you build next.</p>
      <p style="color: #5a5855; margin-top: 32px;">— The Foundry team</p>
    </div>
  `;

  return { subject, text, html };
}

export async function sendGraduationEmail(opts: {
  to: string;
  firstName: string | null;
  alumSignupUrl: string;
}): Promise<void> {
  const { subject, text, html } = renderGraduationEmail({
    firstName:     opts.firstName,
    alumSignupUrl: opts.alumSignupUrl,
  });
  await enqueueEmail({ to: opts.to, subject, text, html, replyTo: contactInbox() });
}

// ─── Listing rejection ──────────────────────────────────────────────
type ListingKind = "opportunity" | "event" | "VC/grant submission";

// Rendered separately from sending, like renderAcceptanceEmail above, so
// the bulk reject path can build many of these and hand them to
// enqueueEmailsBulk in one round trip instead of one insert per listing.
export function renderListingRejectionEmail(opts: {
  firstName: string | null;
  listingKind: ListingKind;
  listingTitle: string;
  reason: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.firstName ? `Hi ${escapeName(opts.firstName)},` : "Hi,";
  const subject = `Your Foundry ${opts.listingKind} wasn't approved`;
  const articleAndKind = opts.listingKind === "opportunity"
    ? "your opportunity"
    : opts.listingKind === "event"
      ? "your event"
      : "your VC/grant submission";

  const text = [
    greeting,
    "",
    `Thanks for submitting ${articleAndKind} "${opts.listingTitle}" to Foundry.`,
    "",
    "After review, we weren't able to approve it. The reviewer's notes:",
    "",
    opts.reason,
    "",
    "If you'd like to update and resubmit, you're welcome to — most rejections come down to a missing detail or a small policy mismatch, both fixable. If you'd like to discuss the decision, reply to this email and we'll take another look.",
    "",
    "— The Foundry team",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.6;">
      <p>${escapeHtml(greeting)}</p>
      <p>Thanks for submitting ${articleAndKind} <strong>"${escapeHtml(opts.listingTitle)}"</strong> to Foundry.</p>
      <p>After review, we weren't able to approve it. The reviewer's notes:</p>
      <blockquote style="margin: 16px 0; padding: 12px 16px; background: #f6f5f1; border-left: 3px solid #c9a84c; white-space: pre-wrap;">${escapeHtml(opts.reason)}</blockquote>
      <p>If you'd like to update and resubmit, you're welcome to — most rejections come down to a missing detail or a small policy mismatch, both fixable. If you'd like to discuss the decision, reply to this email and we'll take another look.</p>
      <p style="color: #5a5855; margin-top: 32px;">— The Foundry team</p>
    </div>
  `;

  return { subject, text, html };
}

export async function sendListingRejectionEmail(opts: {
  to: string;
  firstName: string | null;
  listingKind: ListingKind;
  listingTitle: string;
  reason: string;
}): Promise<void> {
  const { subject, text, html } = renderListingRejectionEmail(opts);
  await enqueueEmail({ to: opts.to, subject, text, html, replyTo: appealsInbox() });
}

/** Reply-to for the listing rejection email, exported for the bulk path. */
export const listingRejectionReplyTo = appealsInbox;

// ─── Community post takedown ────────────────────────────────────────
// Sent when an admin removes a post. Four things have to be in here for
// the removal to be defensible, and one thing has to be left out.
//
// In: what was removed and when it was posted; that a person removed it
// and when; the reason; and how to appeal. A takedown a member cannot
// identify or contest is not moderation, it is just deletion.
//
// Out: the body of the post. Quoting back the content we have just
// destroyed would undercut the deletion — and the member wrote it, so
// they are the one person who does not need a copy.
//
// The 12-month retention line is deliberate too: telling someone a record
// is kept, and for how long, is the transparency half of relying on
// Article 17(3)(e) to keep it.
export function renderPostTakedownEmail(opts: {
  firstName: string | null;
  postTitle: string;
  postedAt: Date;
  reason: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.firstName ? `Hi ${escapeName(opts.firstName)},` : "Hi,";
  const posted = opts.postedAt.toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });
  const subject = "Your Foundry community post has been removed";

  const text = [
    greeting,
    "",
    `Your community post "${opts.postTitle}", published on ${posted}, has been removed by a Foundry admin. Their reason:`,
    "",
    opts.reason,
    "",
    "Posting guidelines are in our Terms of Use. We keep a record of removals like this one for 12 months.",
    "",
    "If you think this was a mistake, reply to this email and we'll review it.",
    "",
    "— The Foundry team",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.6;">
      <p>${escapeHtml(greeting)}</p>
      <p>Your community post &ldquo;${escapeHtml(opts.postTitle)}&rdquo;, published on ${escapeHtml(posted)}, has been removed by a Foundry admin. Their reason:</p>
      <blockquote style="margin: 16px 0; padding: 12px 16px; background: #f6f5f1; border-left: 3px solid #c9a84c; white-space: pre-wrap;">${escapeHtml(opts.reason)}</blockquote>
      <p>Posting guidelines are in our Terms of Use. We keep a record of removals like this one for 12 months.</p>
      <p>If you think this was a mistake, reply to this email and we&rsquo;ll review it.</p>
      <p style="color: #5a5855; margin-top: 32px;">&mdash; The Foundry team</p>
    </div>`;

  return { subject, text, html };
}

export async function sendPostTakedownEmail(opts: {
  to: string;
  firstName: string | null;
  postTitle: string;
  postedAt: Date;
  reason: string;
}): Promise<void> {
  const { subject, text, html } = renderPostTakedownEmail(opts);
  await enqueueEmail({ to: opts.to, subject, text, html, replyTo: appealsInbox() });
}

export const postTakedownReplyTo = appealsInbox;

// ─── Report outcome ─────────────────────────────────────────────────
// Closes the loop with whoever reported a post. This is the half of a
// complaints process that is easiest to skip and the half that makes it
// real: a report route that never reports back trains members to stop
// using it, and leaves us with a documented notification and no evidence
// we did anything about it.
//
// Sent for BOTH outcomes. "We looked and took no action" is a result;
// silence is not.
export function renderReportOutcomeEmail(opts: {
  firstName: string | null;
  postTitle: string;
  outcome: "actioned" | "dismissed";
  note: string | null;
}): { subject: string; text: string; html: string } {
  const greeting = opts.firstName ? `Hi ${escapeName(opts.firstName)},` : "Hi,";
  const subject = "We've reviewed your Foundry report";

  const verdict =
    opts.outcome === "actioned"
      ? "We agreed, and the post has been removed."
      : "We reviewed it and decided it doesn't breach our posting guidelines, so it will stay up.";

  const text = [
    greeting,
    "",
    `Thanks for reporting the community post "${opts.postTitle}". An admin has now reviewed it.`,
    "",
    verdict,
    ...(opts.note ? ["", "They added:", "", opts.note] : []),
    "",
    "If you disagree with this outcome, reply to this email and we'll take another look.",
    "",
    "— The Foundry team",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.6;">
      <p>${escapeHtml(greeting)}</p>
      <p>Thanks for reporting the community post &ldquo;${escapeHtml(opts.postTitle)}&rdquo;. An admin has now reviewed it.</p>
      <p>${escapeHtml(verdict)}</p>
      ${opts.note
        ? `<p>They added:</p><blockquote style="margin: 16px 0; padding: 12px 16px; background: #f6f5f1; border-left: 3px solid #c9a84c; white-space: pre-wrap;">${escapeHtml(opts.note)}</blockquote>`
        : ""}
      <p>If you disagree with this outcome, reply to this email and we&rsquo;ll take another look.</p>
      <p style="color: #5a5855; margin-top: 32px;">&mdash; The Foundry team</p>
    </div>`;

  return { subject, text, html };
}

export async function sendReportOutcomeEmail(opts: {
  to: string;
  firstName: string | null;
  postTitle: string;
  outcome: "actioned" | "dismissed";
  note: string | null;
}): Promise<void> {
  const { subject, text, html } = renderReportOutcomeEmail(opts);
  await enqueueEmail({ to: opts.to, subject, text, html, replyTo: appealsInbox() });
}

// ─── Contact form ───────────────────────────────────────────────────
// ─── New report notification (to us, not to a member) ───────────────
// The Online Safety Act asks a user-to-user service to act on illegal
// content once it knows about it, and knowing cannot depend on somebody
// remembering to open /admin/reports. This turns the queue from a page you
// have to visit into a message that arrives.
//
// Deliberately does NOT quote the reported post's body. The admin can read
// it in the app behind an admin session; putting members' content into an
// inbox spreads it further than the report asked us to.
export function renderPostReportEmail(opts: {
  category: string;
  reason: string;
  postTitle: string;
  reportedAt: Date;
  siteUrl: string;
}): { subject: string; text: string; html: string } {
  const when = opts.reportedAt.toLocaleString("en-GB", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const queue = `${opts.siteUrl.replace(/\/$/, "")}/admin/reports`;
  // Category first, so severity is legible in a notification list without
  // opening anything.
  const subject = `[Foundry] Post reported — ${opts.category}`;

  const text = [
    `A member reported a community post on ${when}.`,
    "",
    `Category: ${opts.category}`,
    `Post:     "${opts.postTitle}"`,
    "",
    "What they said:",
    opts.reason,
    "",
    `Review it: ${queue}`,
    "",
    "The reporter is identified in the admin queue, not here.",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.6;">
      <p>A member reported a community post on ${escapeHtml(when)}.</p>
      <table style="border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 2px 12px 2px 0; color: #5a5855;">Category</td><td style="padding: 2px 0;"><strong>${escapeHtml(opts.category)}</strong></td></tr>
        <tr><td style="padding: 2px 12px 2px 0; color: #5a5855;">Post</td><td style="padding: 2px 0;">&ldquo;${escapeHtml(opts.postTitle)}&rdquo;</td></tr>
      </table>
      <p style="margin-bottom: 4px;">What they said:</p>
      <blockquote style="margin: 4px 0 16px; padding: 12px 16px; background: #f6f5f1; border-left: 3px solid #c9a84c; white-space: pre-wrap;">${escapeHtml(opts.reason)}</blockquote>
      <p><a href="${escapeHtml(queue)}" style="color: #1a1a1a;">Review it in the admin queue</a></p>
      <p style="color: #5a5855; font-size: 13px; margin-top: 24px;">The reporter is identified in the admin queue, not here.</p>
    </div>`;

  return { subject, text, html };
}

export async function sendPostReportEmail(opts: {
  category: string;
  reason: string;
  postTitle: string;
  reportedAt: Date;
  siteUrl: string;
}): Promise<void> {
  const { subject, text, html } = renderPostReportEmail(opts);
  await enqueueEmail({ to: moderationInbox(), subject, text, html });
}

export const postReportRecipient = moderationInbox;

export async function sendContactTicket(opts: {
  fromEmail: string;
  firstName: string | null;
  surname: string | null;
  subject: string;
  message: string;
}): Promise<void> {
  const fullName = [opts.firstName, opts.surname].filter(Boolean).join(" ").trim() || "—";
  const sentAt = new Date().toISOString();
  const subject = `[Foundry contact] ${opts.subject}`;

  const text = [
    `From:  ${fullName}`,
    `Email: ${opts.fromEmail}`,
    `Sent:  ${sentAt}`,
    "",
    "─────────────────────────",
    "",
    opts.message,
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.6;">
      <table style="border-collapse: collapse; margin: 0 0 20px; font-size: 14px;">
        <tr>
          <td style="color: #5a5855; padding: 2px 12px 2px 0;">From</td>
          <td style="color: #1a1a1a;"><strong>${escapeHtml(fullName)}</strong></td>
        </tr>
        <tr>
          <td style="color: #5a5855; padding: 2px 12px 2px 0;">Email</td>
          <td style="color: #1a1a1a;"><a href="mailto:${escapeHtml(opts.fromEmail)}" style="color: #1a1a1a;">${escapeHtml(opts.fromEmail)}</a></td>
        </tr>
        <tr>
          <td style="color: #5a5855; padding: 2px 12px 2px 0;">Sent</td>
          <td style="color: #1a1a1a;">${escapeHtml(sentAt)}</td>
        </tr>
      </table>
      <div style="white-space: pre-wrap; border-top: 1px solid #e5e5e5; padding-top: 16px;">${escapeHtml(opts.message)}</div>
    </div>
  `;

  await enqueueEmail({
    to:      contactInbox(),
    replyTo: opts.fromEmail,
    subject,
    text,
    html,
  });
}

// ─── Contact form — sender acknowledgement ──────────────────────────
// Auto-reply to the person who submitted the contact form so they know
// it went through. Sent best-effort by the action after the team ticket;
// Reply-To points at the contact inbox so a reply continues to the team.
export async function sendContactConfirmation(opts: {
  to: string;
  firstName: string | null;
  subject: string;
}): Promise<void> {
  const greeting = opts.firstName ? `Hi ${escapeName(opts.firstName)},` : "Hi,";
  const subject = "We've got your message — Foundry";
  const ref = opts.subject.trim();
  const text = [
    greeting,
    "",
    `Thanks for getting in touch with Foundry. We've received your message${ref ? ` about "${ref}"` : ""} and someone will get back to you as soon as we can.`,
    "",
    "If you need to add anything, just reply to this email.",
    "",
    "— The Foundry team",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.6;">
      <p>${escapeHtml(greeting)}</p>
      <p>Thanks for getting in touch with <strong>Foundry</strong>. We've received your message${ref ? ` about <strong>"${escapeHtml(ref)}"</strong>` : ""} and someone will get back to you as soon as we can.</p>
      <p>If you need to add anything, just reply to this email.</p>
      <p style="color: #5a5855; margin-top: 32px;">— The Foundry team</p>
    </div>
  `;

  await enqueueEmail({ to: opts.to, subject, text, html, replyTo: contactInbox() });
}

// ─── Name sanitiser ─────────────────────────────────────────────────
// Used in email greetings to defang anything weird in user-supplied
// names. Strips zero-width, normalises Unicode, collapses internal
// whitespace, trims, caps length.
function escapeName(raw: string): string {
  const cleaned = raw
    .normalize("NFC")
    .replace(/[​-‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 64 ? `${cleaned.slice(0, 64)}…` : cleaned;
}

// ─── GitHub showcase nudge ──────────────────────────────────────────
// The one piece of LIFECYCLE mail in this file — everything else here is
// transactional (you did a thing; here is the outcome). That difference
// is why it carries an unsubscribe pointer the others don't need, and
// why due_github_showcase_nudges enforces a 30-day floor and a per-member
// opt-out before a row ever reaches this renderer.
//
// Event-driven, never a timer: a member only hears from us when a scan
// has actually turned up a repo they have never been shown. Rendered
// separately from sending so the cron route can build a batch and hand
// it to enqueueEmailsBulk in one round trip.
export function renderShowcaseNudgeEmail(opts: {
  firstName: string | null;
  newRepoNames: string[];
  appUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.firstName ? `Hi ${escapeName(opts.firstName)},` : "Hi,";
  const count = opts.newRepoNames.length;
  // Naming them is the whole point — "you have new activity" is spam,
  // "we noticed foo and bar" is a reason to click. Capped so a member who
  // pushed thirty repos doesn't get a wall of text.
  const named = opts.newRepoNames.slice(0, 3).join(", ");
  const extra = count > 3 ? ` and ${count - 3} more` : "";

  const subject =
    count === 1
      ? `New on your GitHub: ${opts.newRepoNames[0]}`
      : `${count} new projects on your GitHub`;

  const text = [
    greeting,
    "",
    `We spotted something new on your GitHub — ${named}${extra}.`,
    "",
    "You choose which three projects recruiters see first on your Foundry profile, along with a line describing each one in your own words. If any of this new work is stronger than what's there now, it's worth swapping in:",
    "",
    opts.appUrl,
    "",
    "If you'd rather not hear about this, you can turn these emails off from the GitHub section of your profile.",
    "",
    "— The Foundry team",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.6;">
      <p>${escapeHtml(greeting)}</p>
      <p>We spotted something new on your GitHub — ${escapeHtml(named)}${escapeHtml(extra)}.</p>
      <p>You choose which three projects recruiters see first on your Foundry profile, along with a line describing each one in your own words. If any of this new work is stronger than what's there now, it's worth swapping in.</p>
      <p style="margin: 16px 0;">
        <a href="${escapeHtml(opts.appUrl)}" style="display: inline-block; padding: 10px 18px; border-radius: 8px; background: #c9a84c; color: #0c0c0b; text-decoration: none; font-weight: 500;">Review your projects →</a>
      </p>
      <p style="color: #5a5855; font-size: 0.9em;">If you'd rather not hear about this, you can turn these emails off from the GitHub section of your profile.</p>
      <p style="color: #5a5855; margin-top: 32px;">— The Foundry team</p>
    </div>
  `;

  return { subject, text, html };
}

// ─── Post-approval listing revisions ────────────────────────────────
// Three messages, one per hop of the revision path added by
// 20260907000005: the organiser proposes, an admin reviews, the
// organiser hears the outcome.
//
// The Luma line in the applied/proposed copy is the whole point of D3
// and is not decoration. Foundry has no attendee list — registration
// happens entirely on Luma (events.luma_link is `not null`), so nobody
// on Foundry's side can email the people who already signed up. An
// organiser who changes a time here and assumes attendees were told is
// the actual failure mode this feature can create, so every message
// that touches a live event says plainly where the notification has to
// come from.

/** Sent to the moderation inbox the moment a revision is proposed. */
export async function sendListingEditProposalEmail(opts: {
  listingKind: ListingKind;
  listingTitle: string;
  proposerName: string | null;
  changedFields: string[];
  siteUrl: string;
}): Promise<void> {
  const queue = `${opts.siteUrl.replace(/\/$/, "")}/admin/edits`;
  const who = opts.proposerName ? escapeName(opts.proposerName) : "A member";
  const fields = opts.changedFields.length ? opts.changedFields.join(", ") : "—";
  const subject = `[Foundry] Proposed change to a live ${opts.listingKind}`;

  const text = [
    `${who} proposed a change to the published ${opts.listingKind} "${opts.listingTitle}".`,
    "",
    `Fields changed: ${fields}`,
    "",
    "The published version is unchanged and still live. Review the proposal here:",
    queue,
    "",
    "— Foundry",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.6;">
      <p>${escapeHtml(who)} proposed a change to the published ${escapeHtml(opts.listingKind)} <strong>&ldquo;${escapeHtml(opts.listingTitle)}&rdquo;</strong>.</p>
      <p style="margin-bottom: 4px;">Fields changed:</p>
      <p style="margin-top: 0;"><strong>${escapeHtml(fields)}</strong></p>
      <p>The published version is unchanged and still live.</p>
      <p><a href="${escapeHtml(queue)}" style="color: #1a1a1a;">Review it in the admin queue</a></p>
    </div>`;

  await enqueueEmail({ to: moderationInbox(), subject, text, html });
}

/**
 * Sent to the organiser once an admin has reviewed their revision.
 * Rendered separately from sending so both outcomes share one renderer
 * and the copy cannot drift between them.
 */
export function renderListingEditDecisionEmail(opts: {
  firstName: string | null;
  listingKind: ListingKind;
  listingTitle: string;
  decision: "applied" | "rejected";
  reason: string | null;
  /** True when the revision moved an event's date/time or location. */
  remindAboutLuma: boolean;
}): { subject: string; text: string; html: string } {
  const greeting = opts.firstName ? `Hi ${escapeName(opts.firstName)},` : "Hi,";
  const applied = opts.decision === "applied";
  const subject = applied
    ? `Your changes to "${opts.listingTitle}" are live`
    : `Your changes to "${opts.listingTitle}" weren't approved`;

  const lumaLine =
    "Important: this doesn't notify anyone who already registered. Registration lives on Luma, so update your Luma event too — that's what reaches the people who signed up.";

  const text = [
    greeting,
    "",
    applied
      ? `An admin approved your changes to the ${opts.listingKind} "${opts.listingTitle}". They're now live on Foundry.`
      : `An admin reviewed your proposed changes to the ${opts.listingKind} "${opts.listingTitle}" and didn't approve them. The published version is unchanged and still live.`,
    ...(opts.reason ? ["", "The reviewer's notes:", "", opts.reason] : []),
    ...(applied && opts.remindAboutLuma ? ["", lumaLine] : []),
    "",
    applied
      ? "— The Foundry team"
      : "You can edit and propose again from your submissions page, or reply to this email to discuss it.\n\n— The Foundry team",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.6;">
      <p>${escapeHtml(greeting)}</p>
      <p>${
        applied
          ? `An admin approved your changes to the ${escapeHtml(opts.listingKind)} <strong>&ldquo;${escapeHtml(opts.listingTitle)}&rdquo;</strong>. They&rsquo;re now live on Foundry.`
          : `An admin reviewed your proposed changes to the ${escapeHtml(opts.listingKind)} <strong>&ldquo;${escapeHtml(opts.listingTitle)}&rdquo;</strong> and didn&rsquo;t approve them. The published version is unchanged and still live.`
      }</p>
      ${opts.reason ? `<blockquote style="margin: 16px 0; padding: 12px 16px; background: #f6f5f1; border-left: 3px solid #c9a84c; white-space: pre-wrap;">${escapeHtml(opts.reason)}</blockquote>` : ""}
      ${applied && opts.remindAboutLuma ? `<p style="padding: 12px 16px; background: #f6f5f1; border-left: 3px solid #c9a84c;">${escapeHtml(lumaLine)}</p>` : ""}
      ${applied ? "" : "<p>You can edit and propose again from your submissions page, or reply to this email to discuss it.</p>"}
      <p style="color: #5a5855; margin-top: 32px;">— The Foundry team</p>
    </div>`;

  return { subject, text, html };
}

export async function sendListingEditDecisionEmail(opts: {
  to: string;
  firstName: string | null;
  listingKind: ListingKind;
  listingTitle: string;
  decision: "applied" | "rejected";
  reason: string | null;
  remindAboutLuma: boolean;
}): Promise<void> {
  const { subject, text, html } = renderListingEditDecisionEmail(opts);
  await enqueueEmail({ to: opts.to, subject, text, html, replyTo: appealsInbox() });
}

// ─── Connections ────────────────────────────────────────────────────
// Two messages, and deliberately only two.
//
// The accept notice goes to the REQUESTER only. The accepter just
// pressed the button; mailing them about their own action is how people
// learn to filter Foundry mail, and the deliverability of that domain is
// shared with sign-in codes.
//
// A decline sends nothing at all, ever. That is a product decision, not
// an oversight: a silent decline is what lets someone say no without a
// social cost, and it is the reason the decline rate is not a throttle
// signal either.
//
// NEITHER MESSAGE CARRIES THE NOTE. The note is member-written text and
// these templates build HTML; the digest in particular would deliver an
// abusive note into the inbox of someone who had not chosen to open the
// app. Names and counts only — the note is read in Foundry, where it can
// be reported.

/**
 * Sent to the requester when their request is accepted. This is the one
 * message in the whole feature that carries an email address, and it
 * carries it because the address IS the payoff — a notification that
 * says "you're connected" and makes you go and look is a worse version
 * of the same disclosure.
 */
export function renderConnectionAcceptedEmail(opts: {
  firstName: string | null;
  accepterName: string;
  accepterEmail: string;
  appUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.firstName ? `Hi ${escapeName(opts.firstName)},` : "Hi,";
  const who = escapeName(opts.accepterName);
  const connections = `${opts.appUrl.replace(/\/$/, "")}/connections`;
  const subject = `${who} accepted your connection request`;

  const text = [
    greeting,
    "",
    `${who} accepted your connection request on Foundry. You can now see each other's email address:`,
    "",
    opts.accepterEmail,
    "",
    `They can see yours too — that exchange is what accepting a request does.`,
    "",
    "Your connections:",
    connections,
    "",
    "— The Foundry team",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.6;">
      <p>${escapeHtml(greeting)}</p>
      <p><strong>${escapeHtml(who)}</strong> accepted your connection request on Foundry. You can now see each other&rsquo;s email address:</p>
      <p style="margin: 16px 0; padding: 12px 16px; background: #f6f5f1; border-left: 3px solid #c9a84c;"><a href="mailto:${escapeHtml(opts.accepterEmail)}" style="color: #1a1a1a;">${escapeHtml(opts.accepterEmail)}</a></p>
      <p>They can see yours too &mdash; that exchange is what accepting a request does.</p>
      <p><a href="${escapeHtml(connections)}" style="color: #1a1a1a;">See all your connections</a></p>
      <p style="color: #5a5855; margin-top: 32px;">&mdash; The Foundry team</p>
    </div>`;

  return { subject, text, html };
}

export async function sendConnectionAcceptedEmail(opts: {
  to: string;
  firstName: string | null;
  accepterName: string;
  accepterEmail: string;
  appUrl: string;
}): Promise<void> {
  const { subject, text, html } = renderConnectionAcceptedEmail(opts);
  await enqueueEmail({ to: opts.to, subject, text, html });
}

/**
 * One daily digest per recipient, however many requests are waiting.
 *
 * Claimed exactly once by claim_connection_digests(), which stamps
 * digested_at inside the same statement that selects the row — so a
 * request ignored last week never nags again, and a cron misfire cannot
 * double-send. Rendered separately from sending so the cron route builds
 * a batch and hands it to enqueueEmailsBulk in one round trip.
 *
 * The link is tab-addressed on purpose. Dropping someone on the default
 * view when the mail was about their pending requests is the lesson the
 * listing pages already learned with their deep links.
 */
export function renderConnectionDigestEmail(opts: {
  firstName: string | null;
  senderNames: string[];
  pendingCount: number;
  appUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.firstName ? `Hi ${escapeName(opts.firstName)},` : "Hi,";
  const pending = `${opts.appUrl.replace(/\/$/, "")}/connections?tab=pending`;
  const n = opts.pendingCount;

  // Named, not counted, for the same reason the showcase nudge names
  // repos: "you have 3 requests" is a notification, "Priya, Tom and one
  // other want to connect" is a reason to open it. Capped at three so a
  // popular member's subject line stays a sentence.
  const names = opts.senderNames.slice(0, 3).map(escapeName);
  const extra = opts.senderNames.length - names.length;
  const who =
    names.length === 0
      ? `${n} ${n === 1 ? "member" : "members"}`
      : extra > 0
        ? `${names.join(", ")} and ${extra} ${extra === 1 ? "other" : "others"}`
        : names.length === 1
          ? names[0]!
          : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;

  const subject =
    n === 1 ? `${who} wants to connect on Foundry` : `${n} connection requests on Foundry`;

  const text = [
    greeting,
    "",
    n === 1
      ? `${who} sent you a connection request on Foundry.`
      : `${who} sent you connection requests on Foundry.`,
    "",
    "Accepting means you each see the other's email address. Declining tells them nothing at all.",
    "",
    "Review them here:",
    pending,
    "",
    "You can turn these emails off in your settings.",
    "",
    "— The Foundry team",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.6;">
      <p>${escapeHtml(greeting)}</p>
      <p><strong>${escapeHtml(who)}</strong> sent you ${n === 1 ? "a connection request" : "connection requests"} on Foundry.</p>
      <p>Accepting means you each see the other&rsquo;s email address. Declining tells them nothing at all.</p>
      <p><a href="${escapeHtml(pending)}" style="color: #1a1a1a;">Review your requests</a></p>
      <p style="color: #5a5855; margin-top: 32px;">You can turn these emails off in your settings.<br />&mdash; The Foundry team</p>
    </div>`;

  return { subject, text, html };
}

// ─── Connection reports ─────────────────────────────────────────────
// The two halves of a complaints process, and neither is optional.
//
// A connection carries an optional 300-character note, which makes this
// user-to-user content and brings the Online Safety Act's illegal-content
// duties with it — the same duties already flagged for community posts.
// A service has to act once it KNOWS, and knowing cannot depend on
// somebody remembering to open an admin page. That is the first mail.
//
// The second is telling the reporter what happened. A report route that
// never reports back trains members to stop using it, and leaves us
// holding a documented notification with no evidence we acted on it.
// "We looked and took no action" is a result. Silence is not.

/**
 * To the moderation inbox, on a genuinely new report only.
 *
 * Carries NO note text and no reason quoting beyond what the reporter
 * typed about it. The note is private member-to-member content read
 * through the audited `admin_reveal_connection_note`, behind an admin
 * session — putting it in an inbox would spread it further than the
 * report asked us to and would bypass the audit row entirely.
 */
export function renderConnectionReportEmail(opts: {
  category: string;
  reason: string;
  reportedName: string;
  reportedAt: Date;
  siteUrl: string;
}): { subject: string; text: string; html: string } {
  const when = opts.reportedAt.toLocaleString("en-GB", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const queue = `${opts.siteUrl.replace(/\/$/, "")}/admin/connections`;
  // Category first, so severity is legible in a notification list without
  // opening anything.
  const subject = `[Foundry] Connection reported — ${opts.category}`;

  const text = [
    `A member reported a connection on ${when}.`,
    "",
    `Category: ${opts.category}`,
    `About:    ${opts.reportedName || "(member no longer on the platform)"}`,
    "",
    "What they said:",
    opts.reason,
    "",
    `Review it: ${queue}`,
    "",
    "The reporter is identified in the admin queue, not here. Any note sent with",
    "the request is read there too, and reading it is logged.",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.6;">
      <p>A member reported a connection on ${escapeHtml(when)}.</p>
      <table style="border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 2px 12px 2px 0; color: #5a5855;">Category</td><td style="padding: 2px 0;"><strong>${escapeHtml(opts.category)}</strong></td></tr>
        <tr><td style="padding: 2px 12px 2px 0; color: #5a5855;">About</td><td style="padding: 2px 0;">${escapeHtml(opts.reportedName || "(member no longer on the platform)")}</td></tr>
      </table>
      <p style="margin-bottom: 4px;">What they said:</p>
      <blockquote style="margin: 0 0 16px; padding: 12px 16px; background: #f6f5f1; border-left: 3px solid #c9a84c; white-space: pre-wrap;">${escapeHtml(opts.reason)}</blockquote>
      <p><a href="${escapeHtml(queue)}" style="color: #1a1a1a;">Review it in the admin queue</a></p>
      <p style="color: #5a5855; font-size: 13px; margin-top: 24px;">The reporter is identified in the admin queue, not here. Any note sent with the request is read there too, and reading it is logged.</p>
    </div>`;

  return { subject, text, html };
}

export async function sendConnectionReportEmail(opts: {
  category: string;
  reason: string;
  reportedName: string;
  reportedAt: Date;
  siteUrl: string;
}): Promise<void> {
  const { subject, text, html } = renderConnectionReportEmail(opts);
  await enqueueEmail({ to: moderationInbox(), subject, text, html });
}

/**
 * To the reporter, on both outcomes.
 *
 * Names the member the report was about, because a member who reported
 * one person out of several needs to know which one this is closing —
 * and unlike a post title, the reporter already knows this name; it is
 * not a disclosure.
 */
export function renderConnectionReportOutcomeEmail(opts: {
  firstName: string | null;
  reportedName: string;
  outcome: "actioned" | "dismissed";
  note: string | null;
}): { subject: string; text: string; html: string } {
  const greeting = opts.firstName ? `Hi ${escapeName(opts.firstName)},` : "Hi,";
  const subject = "We've reviewed your Foundry report";
  const about = opts.reportedName || "another member";

  const verdict =
    opts.outcome === "actioned"
      ? "We agreed, and we've acted on it."
      : "We reviewed it and decided it doesn't breach our guidelines, so no action was taken.";

  const text = [
    greeting,
    "",
    `Thanks for reporting your connection with ${about}. An admin has now reviewed it.`,
    "",
    verdict,
    ...(opts.note ? ["", "They added:", "", opts.note] : []),
    "",
    "You can block a member at any time from their profile. Blocking is silent — they are never told.",
    "",
    "If you disagree with this outcome, reply to this email and we'll take another look.",
    "",
    "— The Foundry team",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.6;">
      <p>${escapeHtml(greeting)}</p>
      <p>Thanks for reporting your connection with ${escapeHtml(about)}. An admin has now reviewed it.</p>
      <p>${escapeHtml(verdict)}</p>
      ${opts.note
        ? `<p>They added:</p><blockquote style="margin: 16px 0; padding: 12px 16px; background: #f6f5f1; border-left: 3px solid #c9a84c; white-space: pre-wrap;">${escapeHtml(opts.note)}</blockquote>`
        : ""}
      <p>You can block a member at any time from their profile. Blocking is silent &mdash; they are never told.</p>
      <p>If you disagree with this outcome, reply to this email and we&rsquo;ll take another look.</p>
      <p style="color: #5a5855; margin-top: 32px;">&mdash; The Foundry team</p>
    </div>`;

  return { subject, text, html };
}

export async function sendConnectionReportOutcomeEmail(opts: {
  to: string;
  firstName: string | null;
  reportedName: string;
  outcome: "actioned" | "dismissed";
  note: string | null;
}): Promise<void> {
  const { subject, text, html } = renderConnectionReportOutcomeEmail(opts);
  await enqueueEmail({ to: opts.to, subject, text, html, replyTo: appealsInbox() });
}
