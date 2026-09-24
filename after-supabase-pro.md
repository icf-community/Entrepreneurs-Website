# After Supabase Pro and Resend Pro

One list of every step that waits on a paid plan, so none of them gets lost.
Each item says **why** it waits and **how to check** it worked. Tick them off
here, in git, as you go.

Where these came from: `tasks/todo.md` (O1–O3), `docs/audits/C6-launch-capacity-and-connections.md`
("Launch gate"), `docs/audits/C2-scalability-findings.md` (Finding 4),
`docs/audits/C4-connections-production-readiness.md`, and the saved notes
on the digest cap and the digest seed.

> **Order matters for one thing only:** the Resend step that raises the
> digest cap must come **after** Resend Pro is active, never before. On
> Resend Free, raising it would spend the 100 emails a day that sign-in
> codes also need, and people would stop being able to log in.

---

## 0 · Not a Pro step, but the one most likely to be forgotten

This belongs to the Connections prod push, whatever plan you're on. It's
here because skipping it fails **silently**: the morning digest mails
nobody, forever, and there's no error anywhere.

- [ ] Right after `supabase db push` of the Connections migrations, run this
      once in the prod SQL Editor. It adds only the new row and never touches
      `cron_secret`:
      ```sql
      insert into public.app_config (key, value)
      select 'connections_digest_url',
             replace(value, '/api/cron/drain-email', '/api/cron/connections-digest')
        from public.app_config where key = 'drain_email_url'
      on conflict (key) do nothing;
      ```
- [ ] **Check:** run the verification `select` at the bottom of
      `supabase/snippets/seed_app_config.sql`. `connections_digest_url` must
      read `present` and use the same host as `drain_email_url` (prod: the
      `vercel.app` address, which serves the site without redirecting; never
      the bare domain, which redirects, and the cron call doesn't follow redirects).
      ✅ Seeded 2026-09-24.
- [ ] On the domain change, re-run the **full** snippet with the new origin,
      so all four URL rows move together.

---

## 1 · Resend Pro

Resend Free allows 100 emails a day **in total**, shared by sign-in codes
(Supabase Auth sends through Resend) and everything the site queues: accept
notices, digests and admin mail. Pro removes the daily cap (50,000 a month).

- [ ] **Buy Resend Pro** on the account that owns the `mail.` sending domain.
      **Check:** the Resend dashboard shows Pro, and the `mail.` domain still
      reads *Verified*. Upgrading doesn't move domains, but confirm it.
- [ ] **Raise the Connections digest cap from 40 to 800 people a day.** Run in
      the prod SQL Editor, only after Pro is active:
      ```sql
      update app_config
         set value = (value::jsonb || '{"digest_daily_cap":800}')::text
       where key = 'connection_limits';
      ```
      - It takes effect at the next digest run (every 15 min, 08:00–11:45 UTC).
      - It counts **people**, not emails. Only members with a waiting request
        get one, and nobody gets a blank digest.
      - 800 is also the most the code can send (50 per run × 16 runs). Going
        higher needs a code change, not just this setting.
      - To undo, set it back to 40. Setting it to 0 pauses digests.
      - Needs migration `20260917000016` in prod first; the key doesn't exist before it.
      - **Check:** the next morning, run the digest-budget query in
        `supabase/checks/launch_capacity.sql`.
- [ ] **Raise Supabase Auth's email limit** (Dashboard → Authentication → Rate
      Limits → *emails sent per hour*). With custom SMTP it starts low, and on
      launch day the whole campus requests codes from one shared IP.
      Set it to what Resend Pro can carry. **Check:** request a code from two
      accounts back to back and confirm both arrive.
- [ ] **Switch on the weekly GitHub showcase email.** Found 2026-09-24: prod
      never had `github_showcase_nudge_url`, so the Monday cron has run and
      done nothing since 20260907000004. Only after Pro, since it emails
      members. Same host as `drain_email_url`:
      ```sql
      insert into public.app_config (key, value)
      select 'github_showcase_nudge_url',
             replace(value, '/api/cron/drain-email', '/api/cron/github-showcase-nudge')
        from public.app_config where key = 'drain_email_url'
      on conflict (key) do nothing;
      ```
      **Check:** the verification `select` in `supabase/snippets/seed_app_config.sql`
      shows no `MISSING` rows.
- [ ] **Leave the drain alone.** The general queue sends 20 emails every 5
      minutes (up to about 5,760 a day), which is already far above launch
      volume. Resend's API limit (about 2 requests a second by default) is
      not the constraint at 20 per run.
- [ ] **Check the real thing:** do one controlled test and confirm delivered
      mail, not just a green queue. Send a connection request between two
      real accounts, leave it unanswered overnight, and confirm the digest
      arrives **once** the next morning, and that nothing arrives for an
      account with no waiting requests.

> Planned later: moving email to Azure Communication Services (`tasks/todo.md`
> E1–E3). Its default limits (30 a minute, 100 an hour) can't carry launch
> day, so launch stays on Resend Pro. When ACS takes over, revisit the digest
> cap and the Auth email limit against ACS's actual quota.

---

## 2 · Supabase Pro

Free is the real ceiling today. It has:

- 500 MB of database, and the C2 audit projected ~270 MB before the vector
  index and ~400–450 MB after it.
- No dashboard backups.
- Projects pause after a week of inactivity.
- Tiny compute.

Pro is $25 a month including $10 of compute credit.

- [ ] **Upgrade the project to Pro** (needs the society funding).
- [ ] **Set compute to Medium** (the owner's choice for launch; 4 GB RAM,
      120 direct connections; step down to Small if it's idle). Same 2
      shared cores as Small; Medium buys RAM, not CPU (`scalability-audit.md` §3).
      Why this matters, measured locally on 2026-09-24 (C4, "Read load"):
      - A database the size of Free sustains about **50** members active at
        the same moment, and falls over at 100.
      - One the size of Small served **250** active members with every page
        under 0.43s and no errors.
      - Small, Micro and Medium are *burstable shared* CPU. If sustained
        traffic ever goes well past that, step up a size (one click,
        reversible) before optimising further.

      Upgrading the plan does **not** necessarily upgrade compute; it can
      stay on Nano/Micro.
      **Check:** Dashboard → Settings → Compute and Disk shows *Medium*.
      Changing compute restarts the database for a minute or two, so do it
      out of hours.
- [ ] **Keep the spend cap ON** (it is by default). It turns surprise
      overage into throttling rather than a bill.
- [ ] **Backups:**
  - [ ] Confirm daily backups now appear (Dashboard → Database → Backups).
  - [ ] **Actually test a restore** into a throwaway project. A backup you've
        never restored is a hope, not a backup.
  - [ ] Until you've seen one listed, keep taking the manual
        `db dump --db-url` on the **session pooler**. After that, the manual
        dump (and the `todo.md` item about adding moderation tables to it)
        is only for an extra copy.
  - [ ] Point-in-time recovery is a separate paid add-on and needs Small
        compute or above. Optional; decide once there's real member data.
- [ ] **Turn on leaked-password protection** (Authentication → Attack
      Protection; Pro only). It blocks passwords that appear in known breach
      lists. Alumni sign in with passwords, so this is worth having.
      **Check:** try setting a well-known breached password on a test account;
      it must be refused.
- [ ] **Raise Auth rate limits for campus** (`todo.md` O3: Authentication →
      Rate Limits). Everyone on campus Wi-Fi shares one public IP, so per-IP
      sign-in limits are effectively per-campus limits.
      **Check:** several sign-ins from one network in a minute all succeed.
- [ ] **CAPTCHA on login** (Authentication → Attack Protection → CAPTCHA →
      Turnstile). This doesn't need Pro, but it's still switched off, and the
      same dashboard screen. The secret key is in Cloudflare → Turnstile → the
      existing widget → *Secret Key*.
      **Check:** the login form still works.
- [ ] **Re-run the capacity checks** now that the database is bigger:
  - `supabase/checks/launch_capacity.sql` for a read-only snapshot.
  - `supabase/tests/verify_prod_schema.sql` for all four crons registered and active.
  - The next day, `cron.job_run_details` to see that all four actually fired.
- [ ] **The staging load test** (`todo.md` S4, C6 "Launch gate"): 100 → 250 → 500
      signed-in users, a 10-minute hold at 500, then a burst. Pro makes a
      staging copy possible (a Supabase branch, or a second small project).
      **Never point the 500-user test at the live site.**
      Pass means:
      - zero failed or wrong pages
      - no unexpected 429s
      - p95 under 5 seconds per route
      - no growing email queue
- [ ] **Uptime monitoring can now mean something.** Pro projects don't pause,
      but point any external monitor at `/api/health` (which touches the
      database), not at `/`. A homepage ping stays green through a dead
      database.

---

## 3 · Vercel Pro (planned alongside)

Listed so it isn't forgotten; nothing in the code waits on it.

- [ ] After upgrading, confirm the cron routes (`/api/cron/*`) still answer
      within their time limits, and that the Sentry source-map env vars are
      still set.

---

## Done means

Every box above is ticked **and** its check was run. For each one, note
the date in this file next to it, so the next person can see when it was
done and not just that it was.
