# AI audit: complete migration inventory — 2026-09-26

Companion to [AI-data-audit.md](../AI-data-audit.md) and [AI-plan.md](../AI-plan.md).
All migration files were inventoried and screened for schema, functions, policies, lifecycle and
feature-data references. Relevant definitions were inspected in migration order. This ledger
distinguishes full file coverage from an assertion that every SQL statement has been executed or
every unrelated subsystem has undergone a security audit; neither occurred.

Each row links to the source, records its current SHA-256 prefix and lists declared/altered
objects (first six when longer). Focus is derived from the migration purpose in its filename.
All 134 source paths occur in the Graphify graph; path coverage alone does not prove graph content
freshness, so conclusions use the fingerprinted source. No secrets or production data were read.

| Migration / review focus | Lines | SHA-256 prefix | Declared or altered objects |
|---|---:|---|---|
| [20260527000001_initial_schema.sql](../supabase/migrations/20260527000001_initial_schema.sql) — initial schema | 350 | `56c2b3ea8b2e` | `user_role`, `user_status`, `listing_status`, `location_type`, `vc_grant_kind`, `skills`; +16 more |
| [20260527000002_rls_policies.sql](../supabase/migrations/20260527000002_rls_policies.sql) — rls policies | 262 | `d6a4d600f212` | Policies / grants / indexes / data or scheduler changes; see source |
| [20260527000003_admin_functions.sql](../supabase/migrations/20260527000003_admin_functions.sql) — admin functions | 217 | `076717146057` | `approve_opportunity`, `reject_opportunity`, `approve_vc_grant`, `reject_vc_grant`, `approve_user`, `reject_user` |
| [20260527000004_seed_data.sql](../supabase/migrations/20260527000004_seed_data.sql) — seed data | 31 | `434dd5e14296` | Policies / grants / indexes / data or scheduler changes; see source |
| [20260527000005_oauth_provider_role.sql](../supabase/migrations/20260527000005_oauth_provider_role.sql) — oauth provider role | 53 | `14b53459d5b7` | `tg_handle_new_user` |
| [20260527000006_restrict_azure_to_imperial.sql](../supabase/migrations/20260527000006_restrict_azure_to_imperial.sql) — restrict azure to imperial | 60 | `2f8b02d3e32f` | `tg_handle_new_user` |
| [20260527000007_relax_grad_year_for_onboarding.sql](../supabase/migrations/20260527000007_relax_grad_year_for_onboarding.sql) — relax grad year for onboarding | 21 | `bc78d51f14e1` | `profiles` |
| [20260527000008_parse_oauth_full_name.sql](../supabase/migrations/20260527000008_parse_oauth_full_name.sql) — parse oauth full name | 90 | `1d4a00f51ac2` | `tg_handle_new_user` |
| [20260527000009_onboarding_support.sql](../supabase/migrations/20260527000009_onboarding_support.sql) — onboarding support | 240 | `69588c6a0130` | `tg_profiles_protect_status`, `submit_onboarding`, `update_profile`, `reject_user` |
| [20260528000010_github_url.sql](../supabase/migrations/20260528000010_github_url.sql) — github url | 183 | `cdc064e5c4c2` | `profiles`, `submit_onboarding`, `update_profile` |
| [20260528000011_delete_my_account.sql](../supabase/migrations/20260528000011_delete_my_account.sql) — delete my account | 30 | `5acf577db41c` | `delete_my_account` |
| [20260528000012_name_min_length.sql](../supabase/migrations/20260528000012_name_min_length.sql) — name min length | 93 | `d03ad45c1122` | `update_profile` |
| [20260528000013_listing_status_expired.sql](../supabase/migrations/20260528000013_listing_status_expired.sql) — listing status expired | 9 | `a90e49215cf2` | Policies / grants / indexes / data or scheduler changes; see source |
| [20260528000014_opportunities_expansion.sql](../supabase/migrations/20260528000014_opportunities_expansion.sql) — opportunities expansion | 82 | `4fa4a23dae0b` | `apply_method`, `opportunities` |
| [20260528000015_events.sql](../supabase/migrations/20260528000015_events.sql) — events | 100 | `54c340d0536c` | `events` |
| [20260528000016_listings_rpcs.sql](../supabase/migrations/20260528000016_listings_rpcs.sql) — listings rpcs | 472 | `b573e7ae1004` | `tg_listings_protect_status`, `submit_opportunity`, `submit_event`, `submit_vc_grant`, `approve_event`, `reject_event`; +3 more |
| [20260528000017_opportunities_expire_cron.sql](../supabase/migrations/20260528000017_opportunities_expire_cron.sql) — opportunities expire cron | 53 | `c98306997f70` | `expire_opportunities` |
| [20260528000018_admin_signup_emails.sql](../supabase/migrations/20260528000018_admin_signup_emails.sql) — admin signup emails | 28 | `c3167ab92327` | `admin_get_signup_emails` |
| [20260529000001_email_domain_full_lifecycle.sql](../supabase/migrations/20260529000001_email_domain_full_lifecycle.sql) — email domain full lifecycle | 137 | `97e5ca6ca4d3` | `is_imperial_email`, `tg_handle_new_user`, `tg_auth_users_protect_email_domain` |
| [20260529000002_relax_name_min_length.sql](../supabase/migrations/20260529000002_relax_name_min_length.sql) — relax name min length | 88 | `87e78351643a` | `update_profile` |
| [20260529000003_onboarding_expansion.sql](../supabase/migrations/20260529000003_onboarding_expansion.sql) — onboarding expansion | 265 | `9c831abe0641` | `profiles`, `submit_onboarding`, `update_profile` |
| [20260529000004_delete_my_account_full_cleanup.sql](../supabase/migrations/20260529000004_delete_my_account_full_cleanup.sql) — delete my account full cleanup | 58 | `174fb343bf68` | `delete_my_account` |
| [20260529000005_expire_events_and_vcs_grants.sql](../supabase/migrations/20260529000005_expire_events_and_vcs_grants.sql) — expire events and vcs grants | 119 | `88aa4e88e9e0` | `vcs_grants`, `expire_events`, `expire_vcs_grants` |
| [20260529000006_listing_reject_returns_poster.sql](../supabase/migrations/20260529000006_listing_reject_returns_poster.sql) — listing reject returns poster | 156 | `1551a36873bb` | `reject_opportunity`, `reject_event`, `reject_vc_grant` |
| [20260529000007_admin_delete_user_rpcs.sql](../supabase/migrations/20260529000007_admin_delete_user_rpcs.sql) — admin delete user rpcs | 146 | `a0e7b0834d67` | `admin_delete_user`, `admin_delete_graduates` |
| [20260529000008_user_can_delete_own_rejected_listings.sql](../supabase/migrations/20260529000008_user_can_delete_own_rejected_listings.sql) — user can delete own rejected listings | 25 | `33e9db277753` | Policies / grants / indexes / data or scheduler changes; see source |
| [20260529000009_user_update_opportunity_rpc.sql](../supabase/migrations/20260529000009_user_update_opportunity_rpc.sql) — user update opportunity rpc | 97 | `ce985937b535` | `update_opportunity` |
| [20260530000001_user_can_delete_own_listings_any_status.sql](../supabase/migrations/20260530000001_user_can_delete_own_listings_any_status.sql) — user can delete own listings any status | 30 | `2993ee0b82d5` | Policies / grants / indexes / data or scheduler changes; see source |
| [20260530000002_protect_contact_email.sql](../supabase/migrations/20260530000002_protect_contact_email.sql) — protect contact email | 329 | `5785f83cdded` | `list_approved_opportunities`, `list_approved_events`, `get_opportunity_for_edit`, `get_event_for_edit`, `list_pending_opportunities_admin`, `list_pending_events_admin` |
| [20260530000003_outbound_email_queue.sql](../supabase/migrations/20260530000003_outbound_email_queue.sql) — outbound email queue | 299 | `78af1472eb3b` | `app_config`, `outbound_email`, `enqueue_outbound_email`, `enqueue_outbound_email_bulk`, `claim_outbound_email_batch`, `cron_drain_outbound_email`; +1 more |
| [20260530000004_approve_user_returns_email.sql](../supabase/migrations/20260530000004_approve_user_returns_email.sql) — approve user returns email | 50 | `b355a1219818` | `approve_user` |
| [20260530000005_opportunity_bookmarks.sql](../supabase/migrations/20260530000005_opportunity_bookmarks.sql) — opportunity bookmarks | 118 | `b1e608f37fdf` | `opportunity_bookmarks`, `list_my_bookmarked_opportunities` |
| [20260530000006_listing_analytics.sql](../supabase/migrations/20260530000006_listing_analytics.sql) — listing analytics | 122 | `3ca37dbf53cc` | `listing_event_kind`, `listing_event_type`, `listing_events`, `record_listing_event`, `get_my_listing_stats` |
| [20260531000001_reject_user_full_delete.sql](../supabase/migrations/20260531000001_reject_user_full_delete.sql) — reject user full delete | 91 | `a322716fea1d` | `reject_user` |
| [20260531000002_listing_events_orphan_cleanup.sql](../supabase/migrations/20260531000002_listing_events_orphan_cleanup.sql) — listing events orphan cleanup | 50 | `de43441df0b8` | `tg_cleanup_listing_events_for_listing` |
| [20260531000003_lock_status_to_role.sql](../supabase/migrations/20260531000003_lock_status_to_role.sql) — lock status to role | 138 | `ad9ca2254a4b` | `tg_profiles_protect_status`, `submit_onboarding` |
| [20260531000004_revoke_enqueue_outbound_email.sql](../supabase/migrations/20260531000004_revoke_enqueue_outbound_email.sql) — revoke enqueue outbound email | 23 | `297e5101c4b6` | Policies / grants / indexes / data or scheduler changes; see source |
| [20260531000005_user_listing_actions.sql](../supabase/migrations/20260531000005_user_listing_actions.sql) — user listing actions | 272 | `0ee6690fa90f` | `user_action_type`, `user_listing_actions`, `mark_listing_action`, `unmark_listing_action`, `get_my_listing_actions`, `get_my_activity`; +1 more |
| [20260601000000_fix_onboarding_status_guc.sql](../supabase/migrations/20260601000000_fix_onboarding_status_guc.sql) — fix onboarding status guc | 139 | `2ca068589876` | `submit_onboarding` |
| [20260602000001_listing_stats_distinct_clicks.sql](../supabase/migrations/20260602000001_listing_stats_distinct_clicks.sql) — listing stats distinct clicks | 58 | `1fea1e815239` | `get_my_listing_stats` |
| [20260602000002_purge_rejected_listings.sql](../supabase/migrations/20260602000002_purge_rejected_listings.sql) — purge rejected listings | 81 | `8d6de2506023` | `purge_rejected_listings` |
| [20260602000003_validate_profile_name_chars.sql](../supabase/migrations/20260602000003_validate_profile_name_chars.sql) — validate profile name chars | 129 | `b12e55ce90f0` | `update_profile` |
| [20260602000004_cap_url_lengths.sql](../supabase/migrations/20260602000004_cap_url_lengths.sql) — cap url lengths | 69 | `c43d557f3ef8` | `profiles`, `opportunities`, `events`, `vcs_grants` |
| [20260603000001_role_lock_and_grad_year_bounds.sql](../supabase/migrations/20260603000001_role_lock_and_grad_year_bounds.sql) — role lock and grad year bounds | 298 | `2036ae374e85` | `tg_profiles_protect_role`, `submit_onboarding`, `update_profile` |
| [20260603000002_event_society_flag.sql](../supabase/migrations/20260603000002_event_society_flag.sql) — event society flag | 181 | `9c65c6020472` | `events`, `tg_events_protect_society_flag`, `admin_create_event`, `list_approved_events` |
| [20260608000001_lock_internal_function_grants.sql](../supabase/migrations/20260608000001_lock_internal_function_grants.sql) — lock internal function grants | 128 | `1cdd487f2766` | `claim_outbound_email_batch` |
| [20260608000002_capture_and_lock_rls_auto_enable.sql](../supabase/migrations/20260608000002_capture_and_lock_rls_auto_enable.sql) — capture and lock rls auto enable | 60 | `0f24015b9195` | `rls_auto_enable` |
| [20260610000000_admin_create_require_profile.sql](../supabase/migrations/20260610000000_admin_create_require_profile.sql) — admin create require profile | 217 | `45d81848a1fe` | `admin_create_opportunity`, `admin_create_event`, `admin_create_vc_grant` |
| [20260826000001_user_update_event_and_vc_rpcs.sql](../supabase/migrations/20260826000001_user_update_event_and_vc_rpcs.sql) — user update event and vc rpcs | 151 | `80bba91a67c0` | `update_event`, `update_vc_grant` |
| [20260826000002_directory_card_rpc.sql](../supabase/migrations/20260826000002_directory_card_rpc.sql) — directory card rpc | 71 | `539be2eb2dc7` | `list_directory_cards` |
| [20260826000003_directory_pagination.sql](../supabase/migrations/20260826000003_directory_pagination.sql) — directory pagination | 258 | `912f875fcddb` | `list_directory_cards`, `list_directory_facets` |
| [20260826000004_admin_profile_pagination.sql](../supabase/migrations/20260826000004_admin_profile_pagination.sql) — admin profile pagination | 299 | `80fe29989804` | `admin_list_profiles`, `admin_profile_facets`, `admin_list_pending_profiles` |
| [20260827000001_revoke_anon_admin_rpcs.sql](../supabase/migrations/20260827000001_revoke_anon_admin_rpcs.sql) — revoke anon admin rpcs | 79 | `371bee4cf449` | Policies / grants / indexes / data or scheduler changes; see source |
| [20260827000002_index_cascade_fks.sql](../supabase/migrations/20260827000002_index_cascade_fks.sql) — index cascade fks | 64 | `7195e4fa0317` | Policies / grants / indexes / data or scheduler changes; see source |
| [20260827000003_bound_listing_events.sql](../supabase/migrations/20260827000003_bound_listing_events.sql) — bound listing events | 90 | `a9bef7f6dff2` | `record_listing_event` |
| [20260827000004_email_change_log.sql](../supabase/migrations/20260827000004_email_change_log.sql) — email change log | 109 | `a77928270419` | `email_change_log`, `tg_log_email_change` |
| [20260828000001_user_role_add_values.sql](../supabase/migrations/20260828000001_user_role_add_values.sql) — user role add values | 31 | `154555e37449` | Policies / grants / indexes / data or scheduler changes; see source |
| [20260828000002_six_roles_constraints_and_rpcs.sql](../supabase/migrations/20260828000002_six_roles_constraints_and_rpcs.sql) — six roles constraints and rpcs | 295 | `ee54e3540ddd` | `profiles`, `submit_onboarding`, `update_profile` |
| [20260828000003_profile_intake_columns.sql](../supabase/migrations/20260828000003_profile_intake_columns.sql) — profile intake columns | 103 | `01516e9443e5` | `profiles`, `tg_profiles_protect_avatar_path` |
| [20260828000004_self_service_affiliation.sql](../supabase/migrations/20260828000004_self_service_affiliation.sql) — self service affiliation | 143 | `ee0310aef8c5` | `tg_profiles_protect_role`, `set_my_affiliation` |
| [20260828000005_submit_onboarding_guc_reset.sql](../supabase/migrations/20260828000005_submit_onboarding_guc_reset.sql) — submit onboarding guc reset | 154 | `c777c9fe3c0c` | `submit_onboarding` |
| [20260829000001_community_posts.sql](../supabase/migrations/20260829000001_community_posts.sql) — community posts | 426 | `0a3d3540bac6` | `posts`, `post_images`, `upload_tickets`, `blob_deletion_queue`, `post_reports`, `post_moderation_log`; +2 more |
| [20260829000002_community_posts_rpcs.sql](../supabase/migrations/20260829000002_community_posts_rpcs.sql) — community posts rpcs | 618 | `124b1d0122bb` | `posting_enabled`, `issue_upload_ticket`, `create_post`, `delete_my_post`, `admin_delete_post`, `report_post`; +4 more |
| [20260829000003_community_posts_crons.sql](../supabase/migrations/20260829000003_community_posts_crons.sql) — community posts crons | 310 | `ae3c655336fe` | `purge_expired_posts`, `purge_stale_upload_tickets`, `purge_moderation_records`, `claim_blob_deletion_batch`, `cron_drain_blob_deletions` |
| [20260829000004_community_system_posts.sql](../supabase/migrations/20260829000004_community_system_posts.sql) — community system posts | 200 | `6ed76966d2d0` | `create_system_post`, `tg_opportunity_system_post`, `tg_event_system_post`, `tg_vc_grant_system_post`, `tg_delete_system_post` |
| [20260830000001_community_posts_hardening.sql](../supabase/migrations/20260830000001_community_posts_hardening.sql) — community posts hardening | 471 | `bc6bb4e71199` | `issue_upload_ticket`, `create_post`, `report_post`, `list_community_feed`, `list_my_posts`, `admin_list_post_reports` |
| [20260830000002_report_post_returns_inserted.sql](../supabase/migrations/20260830000002_report_post_returns_inserted.sql) — report post returns inserted | 87 | `8bcfa97c2b1f` | `report_post` |
| [20260830000003_cap_unbounded_admin_queries.sql](../supabase/migrations/20260830000003_cap_unbounded_admin_queries.sql) — cap unbounded admin queries | 126 | `ad189571f790` | `list_pending_opportunities_admin`, `list_pending_events_admin` |
| [20260830000004_cap_unbounded_approved_listings.sql](../supabase/migrations/20260830000004_cap_unbounded_approved_listings.sql) — cap unbounded approved listings | 140 | `fcdc53d9362b` | `list_approved_opportunities`, `list_approved_events` |
| [20260830000005_revoke_anon_member_rpcs.sql](../supabase/migrations/20260830000005_revoke_anon_member_rpcs.sql) — revoke anon member rpcs | 99 | `a46df3d5681c` | Policies / grants / indexes / data or scheduler changes; see source |
| [20260831000001_post_likes.sql](../supabase/migrations/20260831000001_post_likes.sql) — post likes | 229 | `362dbbda0f7f` | `post_likes`, `toggle_post_like`, `list_community_feed`, `list_my_posts` |
| [20260831000002_get_post_like_counts.sql](../supabase/migrations/20260831000002_get_post_like_counts.sql) — get post like counts | 57 | `c39efda56be3` | `get_post_like_counts` |
| [20260901000001_skills_taxonomy.sql](../supabase/migrations/20260901000001_skills_taxonomy.sql) — skills taxonomy | 294 | `a03e1972dc86` | `skills`, `profile_skills`, `tg_profile_skills_cap_core` |
| [20260901000002_blob_deletion_container.sql](../supabase/migrations/20260901000002_blob_deletion_container.sql) — blob deletion container | 117 | `aa94d4c72349` | `blob_deletion_queue`, `tg_enqueue_profile_media_deletion`, `claim_blob_deletion_batch` |
| [20260901000003_profile_media.sql](../supabase/migrations/20260901000003_profile_media.sql) — profile media | 398 | `8ae4f780a117` | `profiles`, `tg_profiles_protect_avatar_path`, `confirm_avatar_upload`, `remove_my_avatar`, `confirm_cv_upload`, `remove_my_cv`; +4 more |
| [20260901000004_intake_columns.sql](../supabase/migrations/20260901000004_intake_columns.sql) — intake columns | 78 | `b0d3bdc8132a` | `profiles` |
| [20260901000005_interests_and_intents.sql](../supabase/migrations/20260901000005_interests_and_intents.sql) — interests and intents | 114 | `a6eca640ad90` | `profile_interests`, `tg_profile_interests_cap`, `profile_intents` |
| [20260901000006_submit_intake.sql](../supabase/migrations/20260901000006_submit_intake.sql) — submit intake | 519 | `75991ae7955e` | `_apply_intake_fields`, `submit_intake`, `defer_intake`, `submit_onboarding`, `update_profile` |
| [20260901000007_directory_bio_avatar_cutover.sql](../supabase/migrations/20260901000007_directory_bio_avatar_cutover.sql) — directory bio avatar cutover | 150 | `af47b9fbe67c` | `list_directory_cards` |
| [20260901000008_ticket_purposes.sql](../supabase/migrations/20260901000008_ticket_purposes.sql) — ticket purposes | 79 | `ad60400d6ec7` | `issue_upload_ticket` |
| [20260901000009_lock_cv_columns.sql](../supabase/migrations/20260901000009_lock_cv_columns.sql) — lock cv columns | 43 | `751d00da9909` | Policies / grants / indexes / data or scheduler changes; see source |
| [20260901000010_intake_v2.sql](../supabase/migrations/20260901000010_intake_v2.sql) — intake v2 | 108 | `f8e036c344ce` | `profile_intents`, `submit_intake` |
| [20260901000011_scope_interest_intent_policies.sql](../supabase/migrations/20260901000011_scope_interest_intent_policies.sql) — scope interest intent policies | 36 | `76814511264c` | Policies / grants / indexes / data or scheduler changes; see source |
| [20260901000012_cv_suggested_skills.sql](../supabase/migrations/20260901000012_cv_suggested_skills.sql) — cv suggested skills | 164 | `cd17ba4ea01c` | `profiles`, `confirm_cv_upload`, `remove_my_cv`, `set_cv_suggested_skills`, `get_my_cv_info` |
| [20260901000013_intake_role_gates.sql](../supabase/migrations/20260901000013_intake_role_gates.sql) — intake role gates | 185 | `ac3e1d5133ce` | `set_my_linkedin`, `submit_intake`, `defer_intake` |
| [20260902000001_close_audit_gaps.sql](../supabase/migrations/20260902000001_close_audit_gaps.sql) — close audit gaps | 49 | `39c8eed4c86d` | `profiles` |
| [20260902000002_update_profile_status_gate.sql](../supabase/migrations/20260902000002_update_profile_status_gate.sql) — update profile status gate | 148 | `1d575b4d8170` | `update_profile` |
| [20260902000003_approve_user_status_guard.sql](../supabase/migrations/20260902000003_approve_user_status_guard.sql) — approve user status guard | 65 | `e5468484176e` | `approve_user` |
| [20260902000004_index_opportunity_junction_fks.sql](../supabase/migrations/20260902000004_index_opportunity_junction_fks.sql) — index opportunity junction fks | 25 | `a15a8f566e8c` | Policies / grants / indexes / data or scheduler changes; see source |
| [20260904000001_listing_approve_reject_status_guard.sql](../supabase/migrations/20260904000001_listing_approve_reject_status_guard.sql) — listing approve reject status guard | 297 | `f71d7c744e1a` | `approve_opportunity`, `reject_opportunity`, `approve_event`, `reject_event`, `approve_vc_grant`, `reject_vc_grant` |
| [20260904000002_paginate_approved_vcs_grants.sql](../supabase/migrations/20260904000002_paginate_approved_vcs_grants.sql) — paginate approved vcs grants | 89 | `aa84079dcf74` | `list_approved_vcs_grants` |
| [20260904000003_committee.sql](../supabase/migrations/20260904000003_committee.sql) — committee | 376 | `ebc019233289` | `profiles`, `list_directory_cards`, `list_committee_cards`, `admin_set_committee`, `admin_list_profiles` |
| [20260904000004_committee_admin_sync.sql](../supabase/migrations/20260904000004_committee_admin_sync.sql) — committee admin sync | 84 | `e416af9e7453` | `admin_set_committee` |
| [20260905000001_lock_admin_profile_pagination_grants.sql](../supabase/migrations/20260905000001_lock_admin_profile_pagination_grants.sql) — lock admin profile pagination grants | 33 | `f5efe6241a11` | Policies / grants / indexes / data or scheduler changes; see source |
| [20260905000002_capture_ensure_rls_event_trigger.sql](../supabase/migrations/20260905000002_capture_ensure_rls_event_trigger.sql) — capture ensure rls event trigger | 37 | `f10ae5e804e1` | Policies / grants / indexes / data or scheduler changes; see source |
| [20260905000003_lock_list_approved_vcs_grants.sql](../supabase/migrations/20260905000003_lock_list_approved_vcs_grants.sql) — lock list approved vcs grants | 23 | `5d941e009214` | Policies / grants / indexes / data or scheduler changes; see source |
| [20260906000001_cv_matchmaker_pipeline.sql](../supabase/migrations/20260906000001_cv_matchmaker_pipeline.sql) — cv matchmaker pipeline | 343 | `1e63c5816952` | `cv_status`, `cvs`, `cv_profiles`, `cv_chunk_type`, `cv_chunks`, `cv_skills`; +7 more |
| [20260907000001_github_signal.sql](../supabase/migrations/20260907000001_github_signal.sql) — github signal | 168 | `fe7e322278f1` | `github_connections`, `member_skills`, `cv_profiles`, `confirm_github_connected`, `get_my_github_status`, `disconnect_github` |
| [20260907000002_fix_github_pgcrypto_schema.sql](../supabase/migrations/20260907000002_fix_github_pgcrypto_schema.sql) — fix github pgcrypto schema | 60 | `3015a7b3e7f5` | `confirm_github_connected` |
| [20260907000003_github_rescan_cron.sql](../supabase/migrations/20260907000003_github_rescan_cron.sql) — github rescan cron | 93 | `641960f2533b` | `enqueue_github_rescans` |
| [20260907000004_github_showcase.sql](../supabase/migrations/20260907000004_github_showcase.sql) — github showcase | 624 | `30066a7162a7` | `github_connections`, `get_my_github_showcase`, `set_my_github_showcase`, `dismiss_my_github_showcase_prompt`, `set_my_github_nudges`, `get_my_github_status`; +6 more |
| [20260907000005_listing_edits.sql](../supabase/migrations/20260907000005_listing_edits.sql) — listing edits | 983 | `91a439228eaa` | `listing_edit_status`, `listing_edits`, `listing_table_name`, `listing_snapshot`, `apply_listing_edit_payload`, `stage_listing_edit`; +11 more |
| [20260908000001_directory_search_hoist.sql](../supabase/migrations/20260908000001_directory_search_hoist.sql) — directory search hoist | 239 | `3ddbba9ff9b7` | `list_directory_cards` |
| [20260908000002_job_enqueue_dedupe.sql](../supabase/migrations/20260908000002_job_enqueue_dedupe.sql) — job enqueue dedupe | 387 | `b476992f2fa0` | `llm_job_budget_available`, `set_my_github_showcase`, `confirm_github_connected` |
| [20260908000003_vector_indexes.sql](../supabase/migrations/20260908000003_vector_indexes.sql) — vector indexes | 84 | `258b2544c044` | Policies / grants / indexes / data or scheduler changes; see source |
| [20260910000001_github_showcase_themes.sql](../supabase/migrations/20260910000001_github_showcase_themes.sql) — github showcase themes | 45 | `e691ae801cb3` | `get_my_github_showcase` |
| [20260911000001_summary_lifecycle_fixes.sql](../supabase/migrations/20260911000001_summary_lifecycle_fixes.sql) — summary lifecycle fixes | 173 | `35062b295133` | `remove_my_cv`, `disconnect_github`, `github_connections`, `enqueue_github_rescans` |
| [20260911000002_dedupe_cv_profile_skills.sql](../supabase/migrations/20260911000002_dedupe_cv_profile_skills.sql) — dedupe cv profile skills | 47 | `ca2ea5c4cdb4` | `get_my_cv_profile` |
| [20260911000003_ingestion_kill_switch.sql](../supabase/migrations/20260911000003_ingestion_kill_switch.sql) — ingestion kill switch | 198 | `3dbfc866861b` | `github_cv_ingestion_enabled`, `confirm_cv_upload`, `confirm_github_connected` |
| [20260911000004_backfill_stranded_pending_scans.sql](../supabase/migrations/20260911000004_backfill_stranded_pending_scans.sql) — backfill stranded pending scans | 83 | `11ebdbf5b283` | `enqueue_github_rescans` |
| [20260912000001_students_cv_required.sql](../supabase/migrations/20260912000001_students_cv_required.sql) — students cv required | 62 | `ea8570bbfbf4` | `remove_my_cv` |
| [20260913000001_kill_switch_gates_stranded_backfill.sql](../supabase/migrations/20260913000001_kill_switch_gates_stranded_backfill.sql) — kill switch gates stranded backfill | 84 | `4fa289253bcd` | `enqueue_github_rescans` |
| [20260914000001_kill_switch_gates_weekly_rescan.sql](../supabase/migrations/20260914000001_kill_switch_gates_weekly_rescan.sql) — kill switch gates weekly rescan | 79 | `4a1a610fbaad` | `enqueue_github_rescans` |
| [20260914000002_admin_ingestion_toggle.sql](../supabase/migrations/20260914000002_admin_ingestion_toggle.sql) — admin ingestion toggle | 98 | `792478d9ce37` | `admin_set_ingestion_enabled`, `admin_get_ingestion_status` |
| [20260914000003_github_revoke_on_disconnect.sql](../supabase/migrations/20260914000003_github_revoke_on_disconnect.sql) — github revoke on disconnect | 60 | `6a0228a40b9d` | `tg_enqueue_github_revocation` |
| [20260917000001_connections.sql](../supabase/migrations/20260917000001_connections.sql) — connections | 625 | `42343e99df47` | `connections`, `connection_events`, `connection_reports`, `profiles`, `connections_enabled`, `connection_limit_defaults`; +3 more |
| [20260917000002_connections_rpcs_write.sql](../supabase/migrations/20260917000002_connections_rpcs_write.sql) — connections rpcs write | 964 | `b4682a5c3599` | `connection_refusal_message`, `connection_log_event`, `connection_sender_throttled`, `connection_assert_can_send`, `connection_clean_note`, `send_connection_request`; +6 more |
| [20260917000003_connections_rpcs_read.sql](../supabase/migrations/20260917000003_connections_rpcs_read.sql) — connections rpcs read | 710 | `621752957826` | `list_my_connections`, `list_my_pending_requests`, `list_my_sent_requests`, `connection_state_with`, `my_pending_connection_count`, `list_my_connection_facets`; +3 more |
| [20260917000004_connections_admin_cron.sql](../supabase/migrations/20260917000004_connections_admin_cron.sql) — connections admin cron | 878 | `8fb613c66f11` | `expire_connection_requests`, `purge_removed_connections`, `purge_connection_records`, `claim_connection_digests`, `cron_connection_digest`, `admin_list_connection_reports`; +7 more |
| [20260917000005_connections_keyset_pushdown.sql](../supabase/migrations/20260917000005_connections_keyset_pushdown.sql) — connections keyset pushdown | 364 | `29dd815ffc63` | `list_my_connections` |
| [20260917000006_fix_admin_delete_graduates.sql](../supabase/migrations/20260917000006_fix_admin_delete_graduates.sql) — fix admin delete graduates | 99 | `84cc416684a8` | `admin_delete_graduates` |
| [20260917000007_list_my_blocked_members.sql](../supabase/migrations/20260917000007_list_my_blocked_members.sql) — list my blocked members | 73 | `81283cea18a7` | `list_my_blocked_members` |
| [20260917000008_report_connection_returns_filed.sql](../supabase/migrations/20260917000008_report_connection_returns_filed.sql) — report connection returns filed | 121 | `bddd64c65801` | `report_connection` |
| [20260917000009_admin_delete_graduates_never_deletes_caller.sql](../supabase/migrations/20260917000009_admin_delete_graduates_never_deletes_caller.sql) — admin delete graduates never deletes caller | 121 | `96fbbee0ed61` | `admin_delete_graduates` |
| [20260917000010_connection_graph_filters.sql](../supabase/migrations/20260917000010_connection_graph_filters.sql) — connection graph filters | 161 | `526603420470` | `list_my_connection_graph` |
| [20260917000011_purge_settled_connections.sql](../supabase/migrations/20260917000011_purge_settled_connections.sql) — purge settled connections | 85 | `1b0cf62dba26` | `purge_removed_connections` |
| [20260917000012_block_cannot_launder_cooldown.sql](../supabase/migrations/20260917000012_block_cannot_launder_cooldown.sql) — block cannot launder cooldown | 436 | `8baeef04c312` | `connections`, `connection_limit_defaults`, `connection_assert_can_send`, `connection_assert_can_block`, `block_member`, `unblock_member` |
| [20260917000013_purge_sent_outbound_email.sql](../supabase/migrations/20260917000013_purge_sent_outbound_email.sql) — purge sent outbound email | 98 | `a3e92d93df51` | `purge_sent_outbound_email` |
| [20260917000014_index_settled_connection_purge.sql](../supabase/migrations/20260917000014_index_settled_connection_purge.sql) — index settled connection purge | 145 | `2dd6afa14d65` | `purge_removed_connections` |
| [20260917000015_report_connection_validates_input.sql](../supabase/migrations/20260917000015_report_connection_validates_input.sql) — report connection validates input | 143 | `7e13c47c219b` | `report_connection` |
| [20260917000016_digest_lease_and_budget.sql](../supabase/migrations/20260917000016_digest_lease_and_budget.sql) — digest lease and budget | 333 | `d569c4bdfd0a` | `connections`, `connection_limit_defaults`, `claim_connection_digests`, `complete_connection_digests` |
| [20260917000017_connections_directional_cooldown.sql](../supabase/migrations/20260917000017_connections_directional_cooldown.sql) — connections directional cooldown | 639 | `b43cc6fdf95d` | `send_connection_request`, `connection_state_with`, `block_member`, `purge_removed_connections`, `my_connection_quota` |
| [20260917000018_listing_feeds_set_based.sql](../supabase/migrations/20260917000018_listing_feeds_set_based.sql) — listing feeds set based | 156 | `7ac1d931f91d` | `list_approved_opportunities`, `list_approved_events` |
| [20260917000019_home_newest_listings.sql](../supabase/migrations/20260917000019_home_newest_listings.sql) — home newest listings | 71 | `64c5233eaf63` | `list_newest_events`, `list_newest_opportunities` |

## Latest named function definitions used in the feature review

This index tracks CREATE FUNCTION definitions by name for navigation, not SQL overload resolution.
Implementation must separately verify dropped overloads, signatures, policies and later grants.

| Function | Latest defining migration |
|---|---|
| `update_profile` | [20260902000002_update_profile_status_gate.sql](../supabase/migrations/20260902000002_update_profile_status_gate.sql) |
| `_apply_intake_fields` | [20260901000006_submit_intake.sql](../supabase/migrations/20260901000006_submit_intake.sql) |
| `submit_intake` | [20260901000013_intake_role_gates.sql](../supabase/migrations/20260901000013_intake_role_gates.sql) |
| `set_my_affiliation` | [20260828000004_self_service_affiliation.sql](../supabase/migrations/20260828000004_self_service_affiliation.sql) |
| `admin_delete_graduates` | [20260917000009_admin_delete_graduates_never_deletes_caller.sql](../supabase/migrations/20260917000009_admin_delete_graduates_never_deletes_caller.sql) |
| `delete_my_account` | [20260529000004_delete_my_account_full_cleanup.sql](../supabase/migrations/20260529000004_delete_my_account_full_cleanup.sql) |
| `list_directory_cards` | [20260908000001_directory_search_hoist.sql](../supabase/migrations/20260908000001_directory_search_hoist.sql) |
| `list_directory_facets` | [20260826000003_directory_pagination.sql](../supabase/migrations/20260826000003_directory_pagination.sql) |
| `get_my_cv_profile` | [20260911000002_dedupe_cv_profile_skills.sql](../supabase/migrations/20260911000002_dedupe_cv_profile_skills.sql) |
| `remove_my_cv` | [20260912000001_students_cv_required.sql](../supabase/migrations/20260912000001_students_cv_required.sql) |
| `update_cv_currency` | [20260906000001_cv_matchmaker_pipeline.sql](../supabase/migrations/20260906000001_cv_matchmaker_pipeline.sql) |
| `confirm_cv_upload` | [20260911000003_ingestion_kill_switch.sql](../supabase/migrations/20260911000003_ingestion_kill_switch.sql) |
| `confirm_github_connected` | [20260911000003_ingestion_kill_switch.sql](../supabase/migrations/20260911000003_ingestion_kill_switch.sql) |
| `disconnect_github` | [20260911000001_summary_lifecycle_fixes.sql](../supabase/migrations/20260911000001_summary_lifecycle_fixes.sql) |
| `get_my_github_showcase` | [20260910000001_github_showcase_themes.sql](../supabase/migrations/20260910000001_github_showcase_themes.sql) |
| `set_my_github_showcase` | [20260908000002_job_enqueue_dedupe.sql](../supabase/migrations/20260908000002_job_enqueue_dedupe.sql) |
| `enqueue_github_rescans` | [20260914000001_kill_switch_gates_weekly_rescan.sql](../supabase/migrations/20260914000001_kill_switch_gates_weekly_rescan.sql) |
| `llm_job_budget_available` | [20260908000002_job_enqueue_dedupe.sql](../supabase/migrations/20260908000002_job_enqueue_dedupe.sql) |
| `list_approved_opportunities` | [20260917000018_listing_feeds_set_based.sql](../supabase/migrations/20260917000018_listing_feeds_set_based.sql) |
| `list_newest_opportunities` | [20260917000019_home_newest_listings.sql](../supabase/migrations/20260917000019_home_newest_listings.sql) |
| `list_my_bookmarked_opportunities` | [20260530000005_opportunity_bookmarks.sql](../supabase/migrations/20260530000005_opportunity_bookmarks.sql) |
| `submit_opportunity` | [20260528000016_listings_rpcs.sql](../supabase/migrations/20260528000016_listings_rpcs.sql) |
| `update_opportunity` | [20260907000005_listing_edits.sql](../supabase/migrations/20260907000005_listing_edits.sql) |
| `apply_listing_edit_payload` | [20260907000005_listing_edits.sql](../supabase/migrations/20260907000005_listing_edits.sql) |
| `admin_apply_listing_edit` | [20260907000005_listing_edits.sql](../supabase/migrations/20260907000005_listing_edits.sql) |
| `mark_listing_action` | [20260531000005_user_listing_actions.sql](../supabase/migrations/20260531000005_user_listing_actions.sql) |
| `record_listing_event` | [20260827000003_bound_listing_events.sql](../supabase/migrations/20260827000003_bound_listing_events.sql) |
| `tg_opportunity_system_post` | [20260829000004_community_system_posts.sql](../supabase/migrations/20260829000004_community_system_posts.sql) |
| `list_community_feed` | [20260831000001_post_likes.sql](../supabase/migrations/20260831000001_post_likes.sql) |
| `connection_state_with` | [20260917000017_connections_directional_cooldown.sql](../supabase/migrations/20260917000017_connections_directional_cooldown.sql) |
| `send_connection_request` | [20260917000017_connections_directional_cooldown.sql](../supabase/migrations/20260917000017_connections_directional_cooldown.sql) |
| `set_connection_settings` | [20260917000003_connections_rpcs_read.sql](../supabase/migrations/20260917000003_connections_rpcs_read.sql) |
| `block_member` | [20260917000017_connections_directional_cooldown.sql](../supabase/migrations/20260917000017_connections_directional_cooldown.sql) |

## Interpretation boundaries

- Migration dates do not establish that production applied them. No live schema was queried.
- JSONB schemas were checked against CV/GitHub producers; table definitions alone are insufficient.
- Taxonomy CSV seeds are outside this migration set; replaying migrations does not populate `cv_skills`.
- Read policies and column grants were reviewed together, including SECURITY DEFINER bypass paths.
- Email/moderation/connection-private records are operational or access-control data, not ranking features.
- Later lifecycle functions supersede earlier ones; do not patch the first historical definition.
- This is a static inventory. Runtime migration replay, privilege tests and load tests remain release gates.
