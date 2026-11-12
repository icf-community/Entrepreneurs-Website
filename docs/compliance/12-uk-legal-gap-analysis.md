# 12 · UK Legal Gap Analysis — whole platform

**Date:** 12 November 2026 · **Branch read:** `fix/privacy-cv-openai-disclosure` (HEAD `22f8679`)
**Scope:** every UK statute and regulatory regime the platform could plausibly fall under, tested
against what the code actually does (not what the docs say it does), plus the live public copy:
`/privacy`, `/terms`, `/cookies`, `/ai-notice`, the signup disclosure, the footer, emails and metadata.

> **Status of this document.** This is an issue-spotting audit written from the codebase. It is
> not a solicitor's opinion and is not a substitute for one. Items marked **⚖ SOLICITOR** turn on
> judgement or facts a lawyer must own (and in a few cases on law I could not verify to the
> letter). Everything else is a factual mismatch or a missing document you can close yourselves.

---

## 0. The verdict, plainly

The privacy engineering is well above the norm for a platform of this size: short retention clocks
enforced by cron, deny-all RLS, identifier stripping before OpenAI, a working DSAR export, logged
admin CV reads, a real moderation log with legal hold. The ROPA and the AI DPIA are serious work.

**It is not yet airtight, and the gaps are not where the effort went.** They fall into four groups:

1. **Nothing in the portfolio has been adopted.** Every sign-off block (08, 09, 10, 11), the IAO/IAA,
   the escalation decision-maker and the controller sign-off in the README are blank. Until someone
   with authority at IC Founders Ltd signs them, they are drafts, and a regulator can treat them as
   if they did not exist.
2. **The Online Safety Act work is out of date.** The illegal-content risk assessment predates
   Connections and treats only the Community feed as in scope. The mandatory children's access
   assessment has never been done, and the 18+ rule is not enforced anywhere.
3. **The public copy still makes several statements that are untrue.** These are the cheapest
   fixes on the list, and the kind of thing the ICO and the CMA pick up first.
4. **Exposures outside data protection have not been looked at:** use of Imperial's name, financial
   promotion, job-advert law, consumer-contract fairness, company disclosures, and the regulator fee.

Severity scale: **Blocker** = fix before launch / before the named feature goes on in prod ·
**High** = fix before launch · **Medium** = fix within the first term of operation ·
**Low** = good practice / hygiene.

---

## 1. Law-by-law register

| # | Law / regime | Applies? | Covered today? | Gap → section |
|---|---|---|---|---|
| 1 | **UK GDPR** + **Data Protection Act 2018** | Yes. IC Founders Ltd is controller | Mostly; strong ROPA/DPIA | Lawful-basis errors, false statements, Art 9 in AI network mode, LIAs, sign-offs → §2, §3 |
| 2 | **Data (Use and Access) Act 2025** | Yes. Main changes in force since 5 Feb 2026 | No. Docs still reason under old Art 22 | Arts 22A–D, complaints procedure (s.164A DPA 2018), PECR changes → §3.9 |
| 3 | **Data Protection (Charges and Information) Regs 2018**, the ICO fee | Almost certainly yes | **No.** Registration outstanding | → §2.6 |
| 4 | **PECR 2003** (cookies and storage, e-marketing) | Yes | Partly. Cookie table is accurate for cookies | localStorage not disclosed; no analytics objection; nudge-email classification → §4.5 |
| 5 | **Age Appropriate Design Code** (DPA 2018 s.123) | Possibly: under-18 freshers | No assessment | → §2.2 |
| 6 | **EU GDPR** (Art 3(2), extraterritorial) | Possibly: EU-resident alumni plus AI profiling | Not considered | Art 27 representative question → §4.8 ⚖ |
| 7 | **Online Safety Act 2023** (Part 3, user-to-user) | **Yes.** Feed, connection notes, profiles, listings | Partly. Illegal-content risk assessment is draft and stale | Stale assessment, no children's access assessment, ToS duties, affected-person complaints, named accountable person → §2.1 |
| 8 | **Electronic Commerce (EC Directive) Regs 2002** | Yes (information-society service) | Partly | Reg 6 info not "permanently accessible"; reg 19 hosting defence depends on takedown on notice → §4.3, §4.4 |
| 9 | **Defamation Act 2013 s.5** + Website Operators Regs 2013; Defamation Act 1996 s.1 | Yes (hosts member content) | No | No route for a non-member to complain; no defamation category → §4.4 |
| 10 | **Consumer Rights Act 2015**, Part 2 (unfair terms) | Yes. Members are mostly consumers; no price needed | No | Indemnity, £100 cap over statutory claims, exclusive jurisdiction, variation clause → §3.6 |
| 11 | **DMCC Act 2024**, Part 4 Ch 1 (unfair commercial practices) | Yes | Partly | Unlabelled example profiles; affiliation claims; false privacy statements → §3.1, §4.7 |
| 12 | CRA Part 1 digital-content rights; Consumer Contracts Regs 2013; DMCC subscriptions | **No.** No price is paid | n/a | Re-check if you ever charge |
| 13 | **Companies Act 2006** + Company, LLP and Business (Names and Trading Disclosures) Regs 2015 | Yes | Partly (legal pages only) | Emails and footer lack the registered-name particulars → §4.3 |
| 14 | **Trade Marks Act 1994** / passing off (Imperial's name) | **Yes.** Core brand risk | Unknown. No licence on file | → §2.4 ⚖ |
| 15 | Trade Marks Act 1994 ("Foundry") | Possibly | No clearance search | → §4.9 |
| 16 | **Copyright, Designs and Patents Act 1988** | Yes (user content, own assets, OSS) | Licence-in from users is fine | No IP-takedown route; OSS notices → §4.4, §5 |
| 17 | **FSMA 2000 s.21** + Financial Promotion Order 2005 | **Plausibly**: investor audience, founders raising, admin-approved listings | No | No prohibition on investment solicitation → §2.7 ⚖ |
| 18 | **Equality Act 2010**: s.29 services, s.20 adjustments, Part 7 associations, s.111–112 (job ads, AI) | Yes | Partly. Strong on AI recruiter screening | Listing rules; accessibility statement → §4.6 |
| 19 | **Employment Agencies Act 1973** + Conduct Regs 2003 | Arguably, once "Find candidates" is live | Not considered | → §4.6 ⚖ |
| 20 | **National Minimum Wage Act 1998** | Indirectly (you publish unpaid / equity-only roles) | No | Listing rule → §4.6 |
| 21 | **EU AI Act** (recruitment ranking is Annex III high-risk) | Only if outputs are used in the EU | Not considered | Watch item → §4.8 ⚖ |
| 22 | **Limitation Act 1980** (sets defensible retention periods) | Relevant to "indefinite" retention | No | Admin log → §3.5 |
| 23 | Computer Misuse Act 1990, Fraud Act 2006, Protection from Harassment Act 1997 | Bind users, not the platform | Terms §3 already prohibit the conduct | None |
| 24 | Modern Slavery Act s.54, PSBAR 2018 accessibility regs, NIS Regs, Payment Services / MLR 2017, Gambling Act, Charities Act, OSA categorised-service duties, Ofcom fees | **No.** Below thresholds, not a public body, no payments, not a charity | n/a | Do not describe IC Founders Ltd as a "charity" anywhere |
| 25 | Contractual regimes: Google API User Data Policy, OpenAI usage policies, GitHub API terms, Microsoft Entra (parked) | Yes (contract, not statute) | Mostly | OpenAI human-review requirement is met; keep it so |

---

## 2. Blockers and High: non-privacy-copy issues

### 2.1 Online Safety Act: the risk assessment is stale, and a mandatory assessment is missing — **Blocker**

**What the law needs.** A regulated user-to-user service must (a) hold a suitable and sufficient
illegal content risk assessment, and redo it *before* any significant change to the service;
(b) complete and record a **children's access assessment** (Ofcom deadline 16 April 2025, or three
months after coming into scope); (c) put in its terms of service how users are protected from
illegal content, how complaints work, and any proactive technology it uses; (d) run a complaints
procedure open to users **and affected persons** (non-users the content is about); (e) name an
individual accountable for these duties (Ofcom Illegal Content Codes).

**What exists.** `09-osa-illegal-content-risk-assessment.md` is dated 31 Aug 2026 and is still a
draft. Its §8 sign-off is blank and the §6 escalation decision-maker is unnamed. It states:

- *"The user-to-user functionality in scope is one feature: the Community feed."* (§2)
- *"There is no private messaging."* (§2)
- *"Opportunity, event and VC/grant listings … pass through admin approval … so they are not
  user-to-user content in the relevant sense."* (§2)

**Why that is wrong.**
- **Connections shipped on 24 Sept.** A 300-character note addressed to one named person is,
  functionally, a one-to-one message, and Ofcom treats direct messaging as a key risk factor for
  grooming, harassment and fraud. The assessment's own §9 lists "private messaging … added" as a
  trigger for re-assessment. That trigger fired and nothing was done. The code already knows this:
  `lib/email.ts` at the connection-report templates says the note *"brings the Online Safety Act's
  illegal-content duties with it."*
- **Pre-moderation does not take content out of scope.** A listing is still content a user
  generated that other users encounter. Admin approval is a mitigation to record, not an exemption.
  The same goes for **member profiles**: free-text bio, hobbies and photos are user content shown in
  the directory.
- **Foundry AI** is a further significant change, so re-assess before any AI flag goes on.
- **No children's access assessment exists anywhere in the repo.** See §2.2 for why its outcome is
  not obvious.

**Do.**
1. Rewrite 09 to cover the feed, connection notes, profiles (text and photo), listings and
   listing edits, and AI search outputs. Record Connections and AI as significant changes.
2. Write `13-osa-childrens-access-assessment.md` and record its outcome, whatever the outcome is.
3. Name the accountable individual (a director of IC Founders Ltd) and the §6 escalation
   decision-maker. Adopt 08, 09 and 10.
4. Add an OSA section to the Terms (§3.6 below lists the content).
5. Open a public complaint route for non-members (§4.4).

### 2.2 Under-18 members: the 18+ rule is not enforced — **High** ⚖

`terms/page.tsx:46` says Foundry is for students *"aged 18 or over"*. Privacy §12 says the
service is not directed at under-18s. But students are **auto-approved on any `@imperial.ac.uk`
address**, and nothing asks for an age or a date of birth (I searched the frontend). Imperial
admits some first-years at 17. So under-18s are in the product today, and the Terms say they
can't be.

Consequences:
- **OSA:** without "highly effective" age assurance, the children's access assessment will very
  likely find it *possible* for children to access the service. Then the question is whether there
  is a "significant number" of child users. A handful of 17-year-old freshers each autumn could be
  argued either way, and Ofcom reads "significant" as relative, not absolute. ⚖ This is the single
  most important judgement call in this report.
- **Children's Code:** applies if the service is "likely to be accessed" by under-18s. Same facts.
- **Contract:** a term your own onboarding contradicts is weak evidence of anything.

**Decide one of the two, deliberately:**
- **(A) Keep it 18+ and make it true.** Add an age declaration at signup ("I am 18 or over"). For
  students, defer approval until 18 or route under-18s to manual review. Record in the children's
  access assessment why self-declaration plus Imperial enrolment is proportionate. Self-declaration
  is not "highly effective" age assurance, so the solicitor needs to own the conclusion.
- **(B) Admit 17-year-olds openly.** Do the children's access assessment honestly. If the child
  user condition is met, do the children's risk assessment and apply the Children's Code defaults:
  high-privacy defaults (AI discovery is already off by default, which is good) and no CV-excerpt
  sharing for under-18s.

### 2.3 Foundry AI network mode processes special category data with no Art 9 condition — **Blocker for the AI launch**

The owner decision of 10 Nov 2026 lets network-mode searches name ethnicity, religion and sexuality
(`server/app/ai/policy.py:57–89`). The Equality Act reasoning behind it is sound: no one is
screened out of a job. **The data-protection consequence was missed.**

- `server/app/projection.py:185–186` puts the member's own free-text `bio_hobbies` into
  network-mode evidence, unfiltered. A search for "LGBTQ+ founders" or "Muslim founders" therefore
  works by having the model **infer sexual orientation or religious belief from what members
  wrote**, and then surfacing those members to someone else.
- Inferring or revealing racial or ethnic origin, religious belief or sexual orientation in order
  to act on it is processing **special category data** (Art 9). The network-discovery toggle is an
  Art 6 consent. It is not an *explicit* Art 9 consent naming these categories.
  "Manifestly made public" (Art 9(2)(e)) does not fit either: profiles are members-only.
- The public notice contradicts the processing. `ai-notice/page.tsx:63` says it *"never [uses]
  your … gender, ethnicity, nationality, religion … sexuality"*. DPIA 11 line 126 says protected
  characteristics are *"excluded from the evidence … by construction."* Neither is true in network
  mode.
- Gender and nationality are protected under the Equality Act but are **not** Art 9 categories,
  so they are a different problem.

**Recommendation (pick one):**
- **(A) Narrow the carve-out:** allow gender and nationality affinity searches; refuse ethnicity,
  religion and sexuality again in network mode. This is the cheapest lawful option.
- **(B) Keep it, lawfully:** add a separate, unticked, explicit Art 9 consent ("Let members find me
  through shared identity, such as religion, ethnicity or sexuality, based on what I've written on
  my profile"). Only consenting members' evidence is eligible for those terms. Update `/ai-notice`
  and DPIA 11, and add Art 9 to the ROPA. Note that DUAA's new Art 22A keeps its strict rule for
  special category data.

Whichever you pick, fix the `/ai-notice` sentence and DPIA line 126 so they describe what the code
does.

### 2.4 Imperial College London's name and identity — **High** ⚖

IC Founders Ltd trades as "Imperial Entrepreneurs" at imperialentrepreneurs.com. The footer prints
"Imperial College London" beside the logo (`components/BrandLogo.tsx:70`, used in `Footer.tsx`).
Metadata and JSON-LD call it *"The founder community at Imperial College London"*. Terms §7
(`terms/page.tsx:169`) asserts that the "Imperial Entrepreneurs" name is *"owned by or licensed to
us."*

- Imperial College London protects its name and brand. A private company using "Imperial" for a
  service aimed at Imperial's own students invites a **passing-off** claim, and possibly a
  **registered trade mark** claim, unless Imperial (and the Union, if this is a society brand) has
  agreed in writing. Check the UKIPO register for Imperial's marks.
- The governance story is inconsistent. `docs/ict-consent-overview.md` presents Foundry as built
  by *"a registered Imperial College Union society."* The legal pages say IC Founders Ltd. If a
  Union society owns the name and the company uses it, you need a written licence from the society
  (and the Union's consent under its rules). If no licence exists, Terms §7 is a false statement.
- Presenting as "the" Imperial founder community is also a **misleading-practice** risk under the
  DMCC Act if it suggests College endorsement that doesn't exist.

**Do.** Get written permission from Imperial's brand / legal team and a written licence from the
society or Union, whichever owns the name. Until then: drop "Imperial College London" from the
lockup, say "a community *for* Imperial students and alumni", and add a disclaimer: "Imperial
Entrepreneurs is run by IC Founders Ltd and is not operated or endorsed by Imperial College London"
(unless it is endorsed, in which case say so accurately). Fix the ICT consent document before it
is sent.

### 2.5 Nothing is adopted: accountability — **High**

Article 5(2) makes the controller *demonstrate* compliance. Today:
- IAO and IAA are `⚠ CONFIRM` (`02-ropa.md:11–12`). The controller sign-off is not recorded
  (README; D6 gate).
- Sign-offs in 08 §7, 09 §8, 10 §2 (moderator and deputy) and 11 are blank.
- The docs mention a "DPO" about 20 times, but **no DPO is designated**, and none is legally
  required: you are not processing on a large scale. Designating one brings Art 38–39 duties
  (independence, no conflict of interest). **Rename it "data protection lead"** throughout, and
  name that person.
- **No legitimate interests assessments exist** (searched `docs/`). You rely on legitimate
  interests for security, analytics, listing-view tracking, the removed-account email hash, the
  block tombstone hash, the connection event log and moderation log surviving deletion, and the
  admin log. Each needs a short written LIA (purpose, necessity, balancing). One page each.

### 2.6 ICO data protection fee — **High** (10-minute fix)

Every controller pays the fee unless exempt. The not-for-profit exemption is narrow: it covers
processing *only* for membership of, and activities for, a not-for-profit body. Recruiter matching,
analytics and CV profiling for third-party job posters go beyond that, so do not rely on it. Tier 1
is reported at **£52 a year** (confirm on the ICO's self-assessment). Not paying risks a fixed
penalty of up to £4,350. Pay it, note the registration number in the README and the privacy page,
and diarise the renewal. (My memory notes say this has been outstanding since June.)

### 2.7 Financial promotion (FSMA s.21) — **High** ⚖

Communicating, in the course of business, an invitation or inducement to engage in investment
activity is a **criminal offence** unless an authorised person approved it or an exemption applies.
Foundry has an "angel investors" audience, founders who are raising, a free-text Community feed,
and **admin-approved** listings. Approval makes it harder to argue you are a mere conduit.

Terms §3 only prohibits soliciting money *"under false pretences"*. A genuine "we're raising a
£250k seed round, DM me" post is not prohibited, and the connection-note rule is the only place
investment solicitation is banned.

**Do.** Add an express rule across listings, posts, profiles and notes: no offers or invitations to
invest in shares, loans or other investments. Signposting to a VC or grant programme (the existing
VC/grants directory) is fine. Add a "financial promotion / investment offer" item to the admin
review checklist and a report category. ⚖ Ask the solicitor whether the VC/grant directory itself
needs any wording.

---

## 3. Blockers and High: the public copy

### 3.1 Statements that are untrue today — **High**

| Where | Says | Reality |
|---|---|---|
| `SignupDisclosures.tsx:60` | *"We don't … share your address with third parties."* | Connections release your address to other members by design (and processors carry it). |
| `SignupDisclosures.tsx:60` | *"Your email is removed from our systems when you delete your account."* | The post moderation log keeps `author_email_snapshot` for 12 months after deletion (`20260829000001_community_posts.sql:330`). The connection-accept email row holds an address for 7 days. Hashes are kept for 12 months. |
| `SignupDisclosures.tsx:54` | *"student magic-link"* | Typed 6-digit codes since PR #25. The list also omits the connection emails, the digest and the GitHub nudge. |
| `privacy/page.tsx:212` (moderation records) | Lists title, text, reason, who removed it and when | Omits that the record contains the author's **email address**. |
| `privacy/page.tsx:117` | *"Your data is hosted in UK / EU regions."* | OpenAI is Global residency. Cloudflare is a global edge. The sentence is false as a blanket claim. |
| `privacy/page.tsx:125` | *"Cloudflare (EU)"* | Global edge (your own register says so). |
| `privacy/page.tsx` §5 | Resend "(EU)", Upstash "(EU)" | Unconfirmed: still `⚠ confirm` in `03`. Don't state it until it is checked. |
| `ai-notice/page.tsx:85` | *"with storage turned off on each request"* | `store=False` stops stored responses. Without a zero-retention agreement, OpenAI still keeps API data for up to 30 days for abuse monitoring. Say that. |
| `ai-notice/page.tsx:63` | never uses gender, ethnicity, religion, sexuality … | False in network mode (§2.3). |
| `terms/page.tsx:169` | names *"owned by or licensed to us"* | Unverified (§2.4). |

### 3.2 Lawful bases in Privacy §3 are partly wrong — **High**

- **Directory display on "consent"** (`privacy/page.tsx:89`). Being in the directory is the core of
  membership ("the directory is the asset"). There is no way to stay a member and be hidden, so the
  consent is not freely given (Art 7(4)), and "withdraw by deleting your account" isn't a
  withdrawal mechanism. Switch to **contract (Art 6(1)(b))**.
- **"Supported by your consent at sign-up"** (line 88). The checkbox is agreement to the Terms. It
  is not a GDPR consent. Mixing the two bases misdescribes members' rights. Delete the phrase, and
  change the checkbox text from "agree to our … Privacy Policy" to "have read our Privacy Policy".
- **Purposes missing from §3:** Foundry AI (three consent toggles, plus the member's own job
  matches); moderation and reports (legitimate interests, plus legal obligation under the OSA);
  listing view/click tracking; email-change log; removed-account hash and block tombstone; admin
  audit log; graduate cleanup; alumni eligibility review; the GitHub nudge email.
- **Art 21(4).** The right to object to legitimate-interests processing (analytics, security) must
  be brought to members' attention "explicitly … clearly and separately". "Restrict or object to
  certain processing" (line 234) is not enough. Give it its own paragraph.
- **Art 13(2)(e).** Say which data is required to join (name, email, eligibility) and what happens
  if it is not given.

### 3.3 Foundry AI is not in the main privacy policy — **Blocker for the AI launch**

`/privacy` covers CV and GitHub ingestion, but not the three AI search modes, being found by
recruiters or by network search, CV-excerpt sharing, the 7-day and 30-day AI retention, or the
deterministic 0–100 scoring. `/ai-notice` covers them, and is itself marked *"factual draft for
owner review."* Before any flag goes on: add a Privacy section (or a clear link with a summary),
finalise `/ai-notice`, and link it from the footer.

### 3.4 Re-consent for CVs read under the old wording — **High (conditional)**

Until 12 Nov the CV consent promised the text was *"never stored … never sent to a third party."*
ROPA item T already flags the question. Rule: **if ingestion ever ran in prod under the old wording**,
those members' consent did not cover the processing. Either re-prompt and re-process, or delete
the derived data (`raw_text`, `cv_profiles`, `cv_chunks`) for those members. If the kill switch
was off throughout (owner decision 1), record that fact in the ROPA and close the question.

### 3.5 Retention gaps — **Medium**

- **Admin audit log: "indefinitely"** (privacy §8). Storage limitation (Art 5(1)(e)) needs a
  period. Six years is the usual defensible anchor (Limitation Act 1980), with a purge job.
- **Contact and appeals messages:** no policy, and they live in Gmail indefinitely (`02-ropa.md`
  item E is `⚠ POLICY NEEDED`). Set one, for example "the end of the following academic year
  unless a dispute is live", and add it to privacy §8.
- **Sentry and PostHog event retention:** not stated. Add the vendor periods.
- **Dormant accounts:** alumni accounts never expire. Either justify that in an LIA (alumni are
  the long-term audience) or implement a dormancy rule. Don't leave the DART draft's "24 months"
  floating as an unimplemented promise.

### 3.6 Terms & Conditions: consumer fairness and OSA content — **High**

Members are consumers for most purposes, so CRA Part 2 applies (no price is needed). Terms that
are not transparent and fair don't bind them, and the CMA can act on them.

| Clause | Problem | Fix |
|---|---|---|
| §10 Indemnity (`:200`) | Consumer indemnities are on the CMA's grey list and are likely unfair | Delete, or limit to members acting in the course of a business |
| §9 £100 cap (`:194`) | Applies to *"any claim"*, which includes UK GDPR Art 82 compensation and other statutory rights a contract cannot cut down | Carve out statutory data-protection rights and anything that cannot lawfully be limited |
| §12 exclusive E&W courts (`:216`) | Strips Scottish and NI consumers of their home courts; likely unfair | "If you live in Scotland or Northern Ireland you may also bring proceedings there" |
| §11 continued use = acceptance (`:208`) | Grey-listed unilateral variation | Keep the email notice; add "at least 30 days before; if you don't agree you can delete your account" |
| §8 discontinue "at any time" | Grey-listed | Add "with reasonable notice where practicable" |
| §2 18+ | Unenforced (§2.2) | Depends on the §2.2 decision |
| **Missing: OSA content** | Terms must say how users are protected from illegal content, what proactive technology (if any) is used, and how complaints, including about removals and restrictions, are handled | Add an "Online safety and complaints" section: report routes, response times from doc 10, appeals, whether automated checks run (the OpenAI moderation pass on CVs; say whether any runs on posts), and the affected-person route |
| **Missing: investment, job-ad and IP rules** | §2.7, §4.6, §4.4 | Add to §3 / §4 |

---

## 4. Medium

### 4.1 Consumer Gmail as the controller's inbox
contact@ and appeals@ forward to `thefoundryappeals@gmail.com`. DSARs, appeals, complaints and
reports about illegal content all land in a **consumer** Google account. Consumer Gmail comes with
no processor terms (for consumer accounts Google acts as a controller), access is tied to a
person, and continuity is not under control. Move it to a business mailbox (Google Workspace or
Microsoft 365) that has a DPA, MFA and shared access. Add the provider to the register and privacy
§5. Register row 11 (*"Google DPA / Workspace terms"*) currently describes something you don't
have.

### 4.2 Admin and volunteer confidentiality
Admins can see every email address and CV. Under Art 29 and 32(4) they process only on the
controller's instructions. Have each admin sign a one-page confidentiality and data-handling
undertaking based on doc 04, and keep the signed copies. Remove access on the day an admin leaves
(the add/remove procedure exists; make leaving part of it).

### 4.3 Company and e-commerce disclosures
- Every **email** you send is a business communication. Add a footer line to every template in
  `lib/email.ts`: "IC Founders Ltd · registered in England and Wales no. 17171277 · registered
  office 71–75 Shelton Street, London WC2H 9JQ". (2015 Trading Disclosures Regs)
- **Website footer:** `© 2026 Foundry` (`Footer.tsx:49`) names a brand, not the company. Use
  "© 2026 IC Founders Ltd" and add a one-line legal identity. E-Commerce Regs reg 6 requires the
  name, geographic address, email address and registration number to be "easily, directly and
  permanently accessible", and a footer satisfies that.
- ⚖ Reg 6 asks for the address at which you are *established*. A formation agent's registered
  office is fine for service of documents, but confirm whether you should also give an operating
  address.

### 4.4 Notice-and-takedown for non-members (defamation, IP, OSA affected persons)
The Report control exists only inside the app, and its categories (`lib/validation/posts.ts:63`)
have nothing for "this is about me / defamatory" or "infringes my copyright or trade mark". A person
defamed in a post, or a photographer whose image was used, has no route in. That weakens the
hosting defence (reg 19 depends on expeditious removal once you know), the s.5 Defamation Act
defence (it runs on a notice procedure), and OSA complaints for affected persons. Add a public
**"Report content"** option on `/contact` (it is reachable signed-out) with those categories, a
target response time, and a short takedown policy page.

### 4.5 PECR: browser storage and analytics
- PECR reg 6 covers **any** storage on the device, not just cookies. The app uses localStorage for
  intake drafts (which hold the member's typed answers: `lib/intake/useIntakeDraft.ts`), sidebar
  state and banner dismissal (`components/SiteBanner.tsx`). These are probably exempt as strictly
  necessary or user-requested, and DUAA widened the functionality exemptions, but the Cookie Policy
  says it lists everything and doesn't list them. Add a "Storage on your device" table. Also note
  that drafts stay on a shared campus computer until they are submitted or cleared.
- **PostHog:** the code sets no IP discard, so check that "Discard client IP data" is on in the
  PostHog project. If it isn't, *"tied only to a pseudonymous account ID"* is incomplete. Add an
  analytics opt-out in Settings: it is the practical way to honour Art 21 objections, and DUAA's
  new analytics exemption expects one.
- **GitHub "new projects" nudge** (`renderShowcaseNudgeEmail`): it is close to the line between a
  service message and marketing. It has an opt-out, which is good. Keep it strictly about the
  member's own profile; one promotional line would make it marketing, which needs consent (the soft
  opt-in is doubtful for a free service).

### 4.6 Job adverts, AI recruiting and employment law ⚖
- **Equality Act s.111–112:** you approve and publish job adverts. Knowingly helping a
  discriminatory advert is itself a contravention. Add an explicit listing rule ("no requirements
  based on protected characteristics unless lawful, such as a genuine occupational requirement")
  and an admin-checklist item. The AI recruiter-mode protections are good; the human listing
  pipeline has none.
- **Minimum wage:** `pay` is free text, so "unpaid" and "equity only" roles will be approved. If
  the role makes someone a worker, that is unlawful for the employer, and you publish it. Rule:
  unpaid roles only where lawful (genuine volunteering, a placement required by an HE course,
  work-shadowing), and the advert must say which.
- **Employment Agencies Act 1973:** "Find candidates" supplies employers with suggested candidates.
  That sits close to the Act's definition of an employment agency ("providing services … for the
  purpose of … supplying employers with persons"). You charge no fees, so the core prohibition
  (s.6) doesn't bite, but the Conduct Regs 2003 information and terms duties might. Get a solicitor
  view before that mode goes on.
- **Equality Act Part 7 / s.29:** admission rules (Imperial affiliation) are fine. Make sure the
  alumni manual-review criteria are written down and applied uniformly.
- **Accessibility:** private providers are not subject to PSBAR, but s.20/s.29 reasonable
  adjustments apply. The accessibility work here is strong. Publish an accessibility statement to
  evidence it, and give a contact for adjustments.

### 4.7 Homepage example profiles
`components/Community.tsx:20–40` shows "Sofia A.", "James K. … raised seed" and others as though
they were members. PRODUCT.md says they are illustrative placeholders. Label them ("Example
profiles"), or you risk a misleading action under DMCC Part 4.

### 4.8 EU reach ⚖
- **EU GDPR Art 3(2)(b):** EU-resident alumni profiled by Foundry AI may count as "monitoring of
  behaviour" in the Union. That could require an EU representative (Art 27) unless the
  occasional / low-risk exemption fits. Get a view; the decision is cheap to record either way.
- **EU AI Act:** AI used to rank candidates for recruitment is an Annex III high-risk use if its
  output is used in the EU, for example by an EU-based alum posting a job. Exposure is low at this
  size, and the timing of the high-risk obligations has been under revision. Re-check before
  opening "Find candidates" to posters outside the UK.

### 4.9 "Foundry" trade mark clearance
At least one established UK software company trades as "Foundry". Run a UKIPO / EUIPO clearance
search for software and online-community services. Consider registering "Foundry" (if it is clear)
and your own logo for IC Founders Ltd.

### 4.10 DUAA 2025 updates
- Art 22 was replaced by **Arts 22A–22D** from 5 Feb 2026. Rewrite the Art 22 reasoning in ROPA
  item R, DPIA 07 and DPIA 11 under the new test. The conclusions should survive: the throttle and
  the AI ranking are not solely automated significant decisions. Under 22A, special category data
  still needs the strict conditions, which links to §2.3.
- **Complaints (s.164A DPA 2018):** controllers must make it easy to complain (for example an
  electronic form), acknowledge within 30 days and respond without undue delay. Sources disagree
  on whether this started on 5 Feb or 19 Jun 2026 (⚖ check SI 2026/82). Either way it is in force
  now. Add a data-protection complaint option to `/contact`, and rewrite privacy §14 so the order
  is: complain to us first, then the ICO.
- PECR fines are now at UK GDPR levels. That raises the stakes on §4.5, though not the work.

---

## 5. Low

- Privacy §10: say members can download their data in-app (the `export_my_data` flow exists), and
  that the one-month deadline can be extended by two months for complex requests.
- Footer: add `/ai-notice` once AI is live, plus an accessibility statement link.
- Open-source licence notices: the JS bundle ships MIT/BSD code to browsers. A generated
  third-party licences page is cheap. Confirm the font licences (OFL or licensed).
- OSA s.66 (reporting CSEA content to the NCA): check commencement, and add it to doc 09 §6.
- Insurance (not law): cyber and media-liability cover for IC Founders Ltd, given user content and
  CV storage.
- Hygiene: `lib/data/committee.ts` says `/committee` is visible signed-out. It isn't
  (`requireApprovedUser`, anon revoked). Fix the comment so nobody writes copy from it.

---

## 6. What is already right (don't regress it)

Deny-all RLS with definer RPCs; identifier minimisation before every OpenAI call; unticked,
separate CV-reading consent; AI discovery off by default, three separate toggles, withdrawal that
deletes immediately; short, cron-enforced retention clocks that match the policy (D6 checked them
row by row); a working DSAR export; logged admin CV and note reads; a moderation log with a 12-month
cap and legal hold; EXIF/GPS stripping; nonce CSP; cookieless analytics with no replay or
autocapture; Sentry with `sendDefaultPii: false` and scrubbing; an honest explanation of the
connection throttle; an ICO complaint route; correct controller identity on all three legal pages;
the recruiter-mode ban on protected-characteristic filters.

---

## 7. Action plan, in order

**A. This week (yourselves, no lawyer needed)**
1. Pay the ICO fee; record the number (§2.6).
2. Fix every row of §3.1 (signup box, privacy §5/§8, `/ai-notice`).
3. Fix privacy §3 bases and the missing purposes; add a separate right-to-object paragraph (§3.2).
4. Move contact@/appeals@ off consumer Gmail (§4.1).
5. Add the company footer to every email and the site footer (§4.3).
6. Label the homepage example profiles (§4.7).
7. Confirm the Resend and Upstash regions and the PostHog IP setting (§3.1, §4.5).
8. Record whether CV ingestion ever ran in prod under the old wording (§3.4).

**B. Before launch**
9. Decide 18+ (A) or 17+ (B) and implement it (§2.2).
10. Rewrite the OSA illegal-content risk assessment; write the children's access assessment; name
    the accountable person and moderators; adopt 08, 09 and 10 (§2.1, §2.5).
11. Terms rewrite: the §3.6 table plus the investment, job-ad, IP and OSA sections (§2.7, §3.6,
    §4.4, §4.6).
12. Public "Report content" route and takedown policy; data-protection complaints route (§4.4,
    §4.10).
13. LIAs; rename DPO to data protection lead; IAO/IAA named; controller sign-off recorded (§2.5).
14. Retention: admin-log period plus purge job; contact-message policy; Sentry/PostHog periods
    (§3.5).
15. Cookie Policy storage table; analytics opt-out (§4.5).
16. Admin confidentiality undertakings (§4.2).
17. Written permission for the Imperial name, or rebrand the affiliation claims (§2.4).

**C. Before any AI flag goes on**
18. Resolve network-mode Art 9 (§2.3); finalise `/ai-notice`; add AI to the privacy policy (§3.3);
    update DPIA 11 and the ROPA under Arts 22A–D (§4.10).
19. Solicitor view on the Employment Agencies Act and on EU reach before "Find candidates" (§4.6,
    §4.8).

**D. Take to a solicitor (one engagement, these questions)**
- Under-18s: the OSA child user condition and Children's Code conclusion (§2.2).
- Imperial name: licence terms or rebrand (§2.4).
- FSMA s.21: listings and feed wording (§2.7).
- Employment Agencies Act and "Find candidates" (§4.6).
- EU representative / EU AI Act (§4.8).
- Final review of the rewritten Terms and Privacy Policy, and sign-off of 08, 09 and 11.

---

## Sources checked for recent law

- DUAA 2025 commencement: [SI 2026/82](https://www.legislation.gov.uk/uksi/2026/82/made) ·
  [DLA Piper](https://privacymatters.dlapiper.com/2026/02/uk-commencement-of-the-data-protection-provisions-in-the-data-use-and-access-act/) ·
  [Clifford Chance](https://www.cliffordchance.com/insights/resources/blogs/talking-tech/en/articles/2026/02/key-aspects-of-the-data--use-and-access--act-take-effect.html) ·
  [Bratby Law](https://bratby.law/data-use-and-access-act-2025-commencement/) ·
  [Governance Docs](https://governancedocs.com/data-use-and-access-act-2025/)
- OSA children's access assessment: [Ofcom](https://www.ofcom.org.uk/cy/online-safety/illegal-and-harmful-content/childrens-access-assessment-duties-under-the-online-safety-act) ·
  [Pinsent Masons](https://www.pinsentmasons.com/out-law/news/online-platforms-face-child-access-assessment-deadline-april)
- ICO fee: [Lewis Silkin](https://www.lewissilkin.com/insights/2025/02/06/fee-payable-to-the-ico-to-increase-in-february-102jzb9) ·
  [Acuity Law](https://acuitylaw.com/rise-in-ico-fees-data-protection-fees-february/) (confirm on ico.org.uk)

Related: [02 ROPA](./02-ropa.md) · [03 Register](./03-third-party-dpa-register.md) ·
[09 OSA](./09-osa-illegal-content-risk-assessment.md) · [11 AI DPIA](./11-dpia-ai-matching.md) ·
[D6 audit](../audits/D6-privacy-compliance.md)

---

## 8. Closure status — 12 November 2026

Work done on branch `docs/launch-status-2026-11-12` (PR #119, with #120 merged in). "Closed" means
fixed in code, copy or documents. "Owner" means it can only be done by a person at IC Founders Ltd.

| § | Item | Status |
|---|---|---|
| 2.1 | OSA risk assessment stale | **Closed (draft):** 09 revision 2 covers feed, connection notes, profiles, listings, AI; non-member reporting route added. **Owner:** adopt 09 §8, name the §6 escalation decision-maker |
| 2.1 | No children's access assessment | **Closed (draft):** [13](./13-osa-childrens-access-assessment.md). **Owner/solicitor:** confirm §4, adopt |
| 2.2 | 18+ not enforced | **Closed:** required 18+ confirmation at signup, recorded with Terms version and time; Google notice updated; Terms §2, Privacy §12. **Gap:** the 52 existing members never confirmed their age; the member notice (16) restates the rule |
| 2.3 | AI network Art 9 | **Closed:** ethnicity, religion and sexuality refused in every mode (policy.py, `is_sensitive` 20261112000001, interpret prompt, fake provider, 9 eval cases, new Python and SQL tests); `/ai-notice`, DPIA 11 and ROPA S corrected |
| 0 | **Who is the controller?** | **Open, top priority (raised 12 Nov 2026).** Owner says Foundry is "only a uni society", but every public legal page and compliance document names IC Founders Ltd (Companies House 17171277). One of them is wrong; decide, then every document is updated to match |
| 2.4 | Imperial name | **Partly closed:** "Imperial College London" removed from the logo lockup; non-endorsement line in footer, Terms §1 and Privacy §1; Terms §7 no longer claims to own the name; metadata says "for … students and alumni". **Owner:** written licence from the society to IC Founders Ltd, and the Union's agreement |
| 2.5 | Accountability | **Partly closed:** DPO renamed to data protection lead; LIAs written ([14](./14-legitimate-interests-assessments.md)). **Owner:** name the IAO/IAA and data protection lead; sign 08, 09, 10, 11, 13, 14 |
| 2.6 | ICO fee | **Owner** |
| 2.7 | Financial promotion | **Closed:** Terms §3 prohibits inviting members to invest; OSA fraud row updated. **Owner:** add it to the admin listing checklist; solicitor on the VC/grant directory |
| 3.1 | False statements | **Closed:** signup box, Privacy §5/§6/§8, `/ai-notice` (traits, OpenAI retention) |
| 3.2 | Lawful bases | **Closed:** directory on contract; consent wording removed; missing purposes added; separate right-to-object box; Art 13(2)(e) sentence |
| 3.3 | AI missing from privacy | **Closed:** Privacy §2c. **Owner:** sign off `/ai-notice` before any flag |
| 3.4 | CV re-consent | **Owner:** confirm ingestion never ran in prod under the old wording, and record it in ROPA item T |
| 3.5 | Retention | **Closed:** admin log 6 years with a purge job and smoke test (20261112000002); contact-message policy; Sentry/PostHog by provider period. Listing views stay life-of-account (LIA L3 recommends 12 months later) |
| 3.6 | Unfair terms / OSA ToS | **Closed:** indemnity limited to businesses; statutory rights carved out of the cap; Scotland/NI courts; 30-day notice; reasonable notice of discontinuance; new §6a online safety, reporting and complaints |
| 4.1 | Consumer Gmail | **Owner position:** keep it (it is a society activity). **Open:** being a society does not change the Art 28 / security gap; either accept it formally with safeguards, or move to a Union society mailbox |
| 4.2 | Admin confidentiality | **Closed (template):** [15](./15-admin-confidentiality-undertaking.md). **Owner:** collect signatures |
| 4.3 | Company disclosures | **Closed:** company line on every email (added at send, so SQL-queued mail too), site footer, © IC Founders Ltd. **Owner:** add the same line to the Supabase Auth email templates (dashboard) |
| 4.4 | Notice-and-takedown | **Closed:** contact form "Report content" and "Data protection request or complaint" topics, tagged in the ticket subject; Terms §6a sets out what a notice should contain |
| 4.5 | PECR storage / analytics | **Closed:** Cookie Policy storage table; per-device analytics opt-out in Settings, wired to PostHog. **Owner:** turn on PostHog "Discard client IP data" |
| 4.6 | Job ads / NMW / agencies | **Closed:** Terms §3 rule on discriminatory and unpaid roles. **Solicitor:** Employment Agencies Act before "Find candidates" |
| 4.7 | Example profiles | **Closed:** labelled "Example profiles" |
| 4.8 | EU reach | **Solicitor** |
| 4.9 | "Foundry" trade mark | **Owner:** clearance search |
| 4.10 | DUAA | **Closed:** DUAA notes in ROPA, 07 and 11; complaints process in Privacy §14 (acknowledge within 30 days) |
| 5 | Low items | Export and extension in Privacy §10: **closed**. Accessibility statement, OSS notices, s.66 NCA check, insurance: **open, low** |
