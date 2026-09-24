// Map Supabase / Postgres errors to user-readable strings.
//
// Supabase passes through Postgres errors verbatim — fine for server
// logs, awful for end users (e.g. "new row violates check constraint
// profiles_grad_year_role_consistency"). This translator catches the
// common ones by Postgres SQLSTATE code, message-content sniffing, or
// the PGRST* codes PostgREST raises. Add cases as they show up.
//
// UNMAPPED ERRORS DO NOT REACH THE USER. This used to fall through to
// the raw message, on the reasoning that a real message beats a blank
// "Something went wrong". That reasoning holds for the messages our own
// SECURITY DEFINER functions raise — those are written for the user and
// are passed through deliberately below — and fails for everything else:
// an unmapped Postgres error carries constraint names, column names and,
// on a unique violation, the conflicting *value*, straight into the UI.
// submitContactTicket already states the rule this file was breaking —
// "never surface the underlying error text (it can carry DB/network
// internals)".
//
// So the raw text is logged and a generic string is returned. The
// diagnostic is not lost; it just stops being shown to whoever tripped
// it. When one turns up in the logs often enough to matter, map it here
// — which is the same "add cases as they show up" loop as before, now
// with the leak closed while you wait.

import { MAX_NAME_LENGTH } from "@/lib/text";

type AnyError =
  | string
  | Error
  | { message?: string; code?: string; details?: string | null; hint?: string | null }
  | null
  | undefined;

// Shared with describeSupabaseError below so a caller can both show the
// friendly message AND redirect to /login — unlike a page-load or server
// action gate, a client-initiated RPC call (ProfileForm/IntakeFlow talk to
// Supabase directly from the browser) has no framework-level redirect on
// expiry; without this, the member has to notice the banner and navigate
// themselves.
export function isSessionExpiredError(err: AnyError): boolean {
  if (err == null || typeof err === "string") return false;
  const message = ("message" in err && err.message) ? String(err.message) : "";
  const code = ("code" in err && err.code) ? String(err.code) : "";
  return code === "PGRST301" || /jwt|jwk|invalid claim|invalid signature/i.test(message);
}

export function describeSupabaseError(err: AnyError): string {
  if (err == null) return "Something went wrong.";
  if (typeof err === "string") return err;

  const message = ("message" in err && err.message) ? String(err.message) : "";
  const code = ("code" in err && err.code) ? String(err.code) : "";

  // Auth / session expiry — JWT errors come through with code "PGRST301"
  // or messages like "JWT expired" / "invalid claim".
  if (isSessionExpiredError(err)) {
    return "Your session has expired. Please sign in again.";
  }

  // Row-level security blocked the call (insufficient_privilege).
  //
  // Two very different things arrive here. Postgres's own denials ("new row
  // violates row-level security policy for table …") mean nothing to an end
  // user. But our SECURITY DEFINER RPCs deliberately raise 42501 with a
  // message written *for* the user — "Only pending listings can be edited",
  // "Forbidden: not an admin" — and flattening those loses the one thing
  // that told them what to do about it. So: generic for Postgres's wording,
  // passthrough for ours.
  if (code === "42501") {
    if (!message || /row-level security|permission denied for/i.test(message)) {
      return "You don't have permission to do that.";
    }
    return message;
  }

  // The OTHER codes our own SECURITY DEFINER functions raise with a
  // message written for the user. Same argument as the 42501 branch
  // above, and the same shape — but these were missing, and everything
  // raised with them was being flattened into "Something went wrong."
  //
  // Found while wiring the connections actions: that feature's entire
  // vocabulary is 22023 ("That request is no longer pending.", "You've
  // reached your daily limit…", the byte-identical generic refusal), and
  // none of it was reaching anybody. It is not a new problem —
  // create_post, submit_intake, the showcase picker and the committee
  // RPCs all raise 22023 with sentences nobody has ever seen.
  //
  // The risk this guards is the same one the 42501 branch guards: these
  // codes are also raised by POSTGRES ITSELF, whose wording carries
  // internals. Postgres's own 22023/22001 messages are recognisable —
  // they are lowercase technical fragments ("invalid regular
  // expression: …", "value too long for type character varying(50)") —
  // and every message this codebase raises is a capitalised sentence
  // written for a member. So: passthrough for a sentence, generic for
  // anything that looks like the engine talking.
  //
  //   22023 invalid_parameter_value      — the house's "you did something
  //                                        that isn't allowed" code
  //   22001 string_data_right_truncation — over-length input
  //   P0002 no_data_found                — "Profile not found"
  if (code === "22023" || code === "22001" || code === "P0002") {
    if (message && !/^[a-z]/.test(message.trim())) return message;
    console.error("Unmapped database error surfaced to a user:", { code, message });
    return "Something went wrong. Please try again.";
  }

  // Unique constraint violations — show a humanised version when we can
  // identify the column.
  if (code === "23505") {
    if (/_email_/.test(message)) return "That email is already registered.";
    return "That value is already taken.";
  }

  // Check constraint violations — two different shapes arrive here, and
  // they need opposite treatment.
  //
  // Postgres's own auto-generated wording is always
  // `new row for relation "x" violates check constraint "y"` — that leaks
  // a table/constraint name and is translated via the lookup table below,
  // falling back to a generic string for anything not yet mapped.
  //
  // But `profile_interests_per_profile_cap` and `profile_skills_cap_core`
  // (the per-profile caps on interests/hobbies and core skills) can't be
  // real CHECK constraints — a CHECK can't count sibling rows — so they're
  // enforced by a trigger that hand-raises errcode 23514 with a message
  // already written for the user, exactly like the 42501 branch above.
  // Verified live against PostgREST: `RAISE ... USING CONSTRAINT = 'x'`
  // does not inject `constraint "x"` into the message text the way
  // Postgres's own violations do, so the regex below never matches these,
  // and passing them through — rather than routing every 23514 through the
  // lookup-or-generic path — is what stops their message from being
  // silently replaced by the generic fallback.
  if (code === "23514") {
    const native = message.match(/violates check constraint "([^"]+)"/);
    if (native) {
      const friendly = CHECK_CONSTRAINT_MESSAGES[native[1]];
      return friendly ?? "One of the values you entered was rejected by a validation rule.";
    }
    return message || "One of the values you entered was rejected by a validation rule.";
  }

  // Foreign key violations — usually mean a stale ID was submitted.
  if (code === "23503") {
    return "That item no longer exists.";
  }

  // Not-found from a single-row query (PGRST116). We surface these as
  // "not found" so the UI can show a 404-style state.
  if (code === "PGRST116" || /no rows/.test(message)) {
    return "Not found.";
  }

  // Network / connection errors don't have a code but bubble up from
  // fetch.
  if (/network|fetch|failed to fetch|load failed/i.test(message)) {
    return "Network error. Check your connection and try again.";
  }

  // Unmapped. Log the real thing, show the user a safe one.
  if (message) {
    console.error("Unmapped database error surfaced to a user:", { code, message });
  }
  return "Something went wrong. Please try again.";
}

// Constraints we want to translate by name. Add as needed.
const CHECK_CONSTRAINT_MESSAGES: Record<string, string> = {
  profiles_grad_year_role_consistency:        "Graduation year is required to complete onboarding.",
  profiles_grad_year_range:                   "Graduation year must be between 1950 and 2099.",
  profiles_linkedin_url_format:               "LinkedIn URL is not in a recognised format.",
  profiles_github_url_format:                 "GitHub URL is not in a recognised format.",
  profiles_portfolio_url_format:              "Portfolio URL must start with http:// or https://.",
  profiles_linkedin_url_len:                  "LinkedIn URL must be 512 characters or fewer.",
  profiles_github_url_len:                    "GitHub URL must be 512 characters or fewer.",
  profiles_portfolio_url_len:                 "Portfolio URL must be 512 characters or fewer.",
  profiles_bio_len:                           "Bio must be 1000 characters or fewer.",
  profiles_working_on_len:                    "\"What you're working on\" must be 500 characters or fewer.",
  profiles_course_len:                        "Course must be between 1 and 200 characters.",
  profiles_course_required_post_onboarding:   "Course is required to complete onboarding.",
  profiles_first_name_len:                    "First name must be 100 characters or fewer.",
  profiles_surname_len:                       "Surname must be 100 characters or fewer.",
  opportunities_description_len:              "Description must be between 20 and 5000 characters.",
  opportunities_position_name_len:            "Role title must be between 2 and 200 characters.",
  opportunities_company_len:                  "Company must be between 1 and 200 characters.",
  opportunities_contact_email_format:         "Contact email is not in a recognised format.",
  opportunities_apply_consistency:            "Pick one of \"contact me\" or \"application portal link\" and fill in the matching field.",
  opportunities_apply_url_len:                "Application portal URL must be 512 characters or fewer.",
  events_title_len:                           "Title must be between 2 and 200 characters.",
  events_description_len:                     "Description must be between 20 and 5000 characters.",
  events_luma_link_format:                    "Luma link must be a valid URL.",
  events_luma_link_len:                       "Luma link must be 512 characters or fewer.",
  events_contact_email_format:                "Contact email is not in a recognised format.",
  vcs_grants_name_len:                        "Name must be between 2 and 200 characters.",
  vcs_grants_description_len:                 "Description must be between 20 and 5000 characters.",
  vcs_grants_link_format:                     "Link must be a valid URL.",
  vcs_grants_link_len:                        "Link must be 512 characters or fewer.",
  posts_title_len:                            "Title must be between 3 and 120 characters.",
  posts_body_len:                             "Post must be between 1 and 3000 characters.",
  post_images_alt_len:                        "Image description must be between 1 and 200 characters.",
  post_images_position:                       "A post can have at most 2 images.",
  post_images_dims:                           "That image's dimensions are outside the supported range.",
  post_images_byte_size:                      "That image is too large — the limit is 8MB.",
  post_reports_reason_len:                    "Report reason must be between 1 and 1000 characters.",
  post_reports_category:                      "Choose one of the listed reasons.",
  profiles_cv_path_len:                       "That CV reference is too long.",
  profiles_cv_original_filename_len:          "That filename is too long — try renaming the file.",
  profiles_preferred_name_len:                `That name must be between 1 and ${MAX_NAME_LENGTH} characters.`,
  profiles_bio_focus_len:                     "Keep this to 500 characters or fewer.",
  profiles_bio_hobbies_len:                   "Keep this to 500 characters or fewer.",
  profiles_current_focus_check:               "Choose one of the listed options for what takes up most of your week.",
  profiles_venture_stage_check:                "Choose one of the listed venture stages.",
  profiles_venture_name_len:                  "Venture name must be between 1 and 200 characters.",
  profiles_venture_url_format:                "Venture URL must start with http:// or https://.",
  profiles_venture_url_len:                   "Venture URL must be 512 characters or fewer.",
  profiles_venture_one_liner_len:             "Keep the one-liner to 140 characters or fewer.",
  profiles_recruiting_status_check:           "Choose one of the listed recruiting options.",
  profiles_intent_urgency_check:              "Choose one of the listed urgency options.",
  profiles_availability_hours_check:          "Choose one of the listed time commitments.",
  profile_interests_label_len:                "Keep each entry to 100 characters or fewer.",
  profile_interests_kind_check:               "That isn't a recognised interest category.",
  profile_interests_per_profile_cap:          "You can add up to 12 entries in this section.",
  profile_intents_rank_range:                 "You can rank at most 3 choices.",
};
