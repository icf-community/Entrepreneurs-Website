import Link from "next/link";

// Privacy Policy — UK GDPR / Data Protection Act 2018.
// Controller: IC Founders Ltd (Companies House 17171277). Grounded in the
// app's actual data flows and sub-processors. Reviewed facts as of the
// LAST_UPDATED date below; the signup flow links here from SignupDisclosures.

export const metadata = {
  title: "Privacy Policy · Foundry",
};

const LAST_UPDATED = "12 November 2026";

export default function PrivacyPage() {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-bg-primary text-text-primary px-8 py-16">
      <div className="max-w-[720px] mx-auto">
        <Link href="/login" className="text-[0.8rem] text-text-muted no-underline hover:text-text-secondary transition-colors">
          ← Back
        </Link>
        <div className="mt-6 mb-10 rule-draw pt-6">
          <p className="label-wide text-text-secondary mb-3">Legal</p>
          <h1 className="font-display text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.1] tracking-tight">
            Privacy Policy
          </h1>
          <p className="text-[0.825rem] text-text-muted mt-3">
            Last updated: {LAST_UPDATED}.
          </p>
        </div>

        <article className="space-y-6 text-[0.875rem] text-text-secondary leading-relaxed [overflow-wrap:anywhere]">
          <Section title="1. Who we are">
            <p>
              Foundry is a private community platform for Imperial College London students and alumni
              interested in the startup ecosystem, operated under the name &ldquo;Imperial Entrepreneurs&rdquo;.
            </p>
            <p className="mt-2">
              The data controller responsible for your personal data is <strong>IC Founders Ltd</strong>, a
              company limited by guarantee registered in England and Wales (company number{" "}
              <strong>17171277</strong>), registered office 71–75 Shelton Street, Covent Garden, London,
              WC2H 9JQ. In this policy &ldquo;we&rdquo;, &ldquo;us&rdquo; and &ldquo;our&rdquo; mean IC Founders Ltd.
            </p>
            <p className="mt-2">
              IC Founders Ltd runs Foundry for Imperial Entrepreneurs, an Imperial College Union society. Foundry is
              not operated by Imperial College London, and we do not share your data with the College.
            </p>
            <p className="mt-2">
              Questions about this policy or your data, including any request to exercise your rights, can be sent
              to <strong>contact@imperialentrepreneurs.com</strong>.
            </p>
          </Section>

          <Section title="2. The personal data we collect">
            <p>We collect only what we need to run a members&rsquo; directory and the features you use:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Account data</strong> — your name and email address, and a record that you confirmed you are 18 or over and accepted our Terms (which version, and when). If you sign in with Google, Google provides your name and email to us (see section 4).</li>
              <li><strong>Eligibility</strong> — your Imperial email address if you are a current student; if you join as an alum or another affiliate, what you tell us about your connection to Imperial, which our admins check before approving you.</li>
              <li><strong>Profile data (onboarding and after)</strong> — the course you study or studied, your graduation year, an optional short bio, an optional profile photograph, optional LinkedIn / GitHub / portfolio links, and (once you complete the post-approval intake) your ranked interests, the venture or role you&rsquo;re working on, and the sectors and skills you select.</li>
              <li><strong>Your CV, if you choose to upload one</strong> — stored as the file you uploaded. If you tick the separate consent for it, we read the text once to suggest skills from our fixed list for you to confirm — see section 2a below for exactly what that does and doesn&rsquo;t do.</li>
              <li><strong>Membership status</strong> — whether you are a current student or alum, and your approval status, which our admins set during review.</li>
              <li><strong>Content you post</strong> — the opportunities, events, and VC / grant listings you submit, including any contact email you choose to attach to a listing; and your community posts, including any images you attach and the text you write to describe them.</li>
              <li><strong>Connections</strong> — which members you have connected with, who asked whom and when, and the short note attached to a request if you wrote one. See section 7a for how this works and what it shares.</li>
              <li><strong>Reports and moderation records</strong> — if you report a community post or a connection, what you tell us about it; and if one of your posts is removed by an admin, a record of the post and the reason it was removed. See section 8 for how long we keep these.</li>
              <li><strong>Engagement data</strong> — which opportunities, events and grants you open or click through. Posters see only totals for their own listings, never who viewed them.</li>
              <li><strong>Foundry AI, if you use it or choose to be found by it</strong> — your AI searches and their results, and the parts of your profile it uses. See section 2c.</li>
              <li><strong>Technical and security data</strong> — your IP address and request metadata, used by our edge provider and rate limiter to prevent abuse, and limited error diagnostics (e.g. URL, browser, your user ID) if something goes wrong.</li>
            </ul>
            <p className="mt-2">
              We do not ask for special category data (such as health, ethnicity, religion, sexuality or political
              opinions), and we do not ask for payment details — Foundry is free to use. Anything you write about
              yourself, or a CV, can still contain such information; we do not search on it, and Foundry AI refuses
              searches for people by these traits. To join, you must give us your name, email address and enough to
              show you are eligible; without them we cannot provide membership. Everything else is optional.
            </p>
          </Section>

          <Section title="2a. Your CV: what we do, and don&rsquo;t do, with it">
            <p>
              Uploading a CV is optional, and so is letting us read it. If you tick the separate consent checkbox
              on upload, we read your CV to build a searchable summary of your background and to suggest skills
              for you to confirm. Nothing is added to your profile without you choosing to add it.
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>We extract the plain text from your CV and <strong>store it</strong>, together with the structured summary (skills, projects, roles) and search data derived from it, for as long as that CV is your current one. Replacing or removing the CV, or deleting your account, deletes the text and the data derived from it.</li>
              <li>Before anything leaves our systems, we remove your name, email addresses, phone numbers, links, street addresses, postcodes and dates of birth from the text. The remaining text is sent to <strong>OpenAI</strong>, our AI provider, to check it for unsafe content, to turn it into the structured summary, and to create the search data. OpenAI processes it for us under a data processing agreement. See sections 5 and 6.</li>
              <li>The extracted text is not shown to other members, with one exception you control: if you turn on &ldquo;Show recruiters lines from my CV&rdquo; in Settings, a recruiter whose search found you can see up to two short lines from it. It is included in the copy of your data you can download. Your CV file itself is kept as you uploaded it (see sections 5 and 8) and is visible only to you and our admins.</li>
              <li>Skill suggestions are checked against a fixed list of around 180 skills, so only skills from that list are ever offered to you to add.</li>
            </ul>
          </Section>

          <Section title="2b. GitHub, if you connect it">
            <p>
              Connecting GitHub is optional. If you do, we use GitHub&rsquo;s sign-in to read your <strong>public,
              non-fork repositories</strong>: their names, descriptions, languages, star counts and dates, an excerpt
              of each README, and your profile README if you have one. We store an access token (encrypted) and the
              repository details we read, and we check again periodically, analysing only what has changed.
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>That material is sent to <strong>OpenAI</strong> to judge which of your projects stand out and to write the project part of your profile summary. See sections 5 and 6.</li>
              <li>You choose which projects (up to three) are shown with your profile.</li>
              <li>Disconnecting GitHub deletes the stored connection and the skills we took from it, and your summary is regenerated from your CV alone.</li>
            </ul>
          </Section>

          <Section title="2c. Foundry AI">
            <p>
              Foundry AI suggests members to job posters and to members building their network, and suggests jobs to
              you. Nobody can find you through it unless you turn that on: there are three separate choices in
              Settings, all off by default, and turning one off removes you straight away. Suggestions are only
              suggestions; Foundry AI never contacts, rejects or applies for anyone.
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>It uses your skills, sectors, course and what you&rsquo;re working on; your interests and hobbies for network suggestions only; your CV and GitHub details only if you agreed to those. It never uses your name, email, photo or links to match.</li>
              <li>Short extracts, with names, contact details and links removed, are sent to <strong>OpenAI</strong> to read a search and check the evidence for it.</li>
              <li>Your AI chats and results are deleted after 7 days, and cached checks after at most 30 days.</li>
            </ul>
            <p className="mt-2">
              The detail, including what the match score means, is in{" "}
              <Link href="/ai-notice" className="text-accent underline underline-offset-[3px] hover:text-accent-light">How AI search works</Link>.
            </p>
          </Section>

          <Section title="3. How we use your data, and our lawful basis">
            <p>Under the UK GDPR we must have a lawful basis for each use of your data:</p>
            <ul className="list-disc pl-5 space-y-1.5 mt-2">
              <li><strong>Creating and running your account, checking you are eligible, and showing your profile in the member directory</strong> — necessary to provide the membership you signed up for (performance of our contract with you under the Terms). The directory is the service, so you cannot be a member and be hidden from it; you choose what optional details it shows, and you can leave at any time by deleting your account.</li>
              <li><strong>Storing a profile photo or a CV you upload</strong> — your consent. Both are optional and skippable, and reading your CV to suggest skills needs a separate consent tick, unticked by default.</li>
              <li><strong>Exchanging your email address when you connect with a member</strong> — your consent, given by sending a request or by accepting one, and withdrawable by removing the connection. See section 7a.</li>
              <li><strong>Sending you service / transactional emails</strong> (sign-in and password reset, decisions on your application and listings, account and content notices, a summary of connection requests waiting for you, and replies when you contact us) — necessary to perform our contract with you and our legitimate interest in operating the platform. You can turn the connection summary off in Settings.</li>
              <li><strong>Reading your CV, connecting GitHub, and being findable through Foundry AI</strong> — your consent, given by the separate choices described in sections 2a, 2b and 2c, each withdrawable at any time. Matching jobs to your own profile is part of the service you asked for (contract).</li>
              <li><strong>Keeping the platform secure</strong> (anti-bot challenges, rate limiting, abuse prevention, and a security record of changes to your sign-in email) — our legitimate interest in protecting members and the service.</li>
              <li><strong>Handling reports, removing content and enforcing our Terms</strong> (including the records described in section 8) — our legitimate interest in keeping members safe, and our legal duties under the Online Safety Act 2023 where content may be illegal.</li>
              <li><strong>Counting views and clicks on listings</strong> — our legitimate interest in showing posters how much interest a listing gets.</li>
              <li><strong>Keeping a log of admin actions</strong> — our legitimate interest in holding admins accountable for their decisions.</li>
              <li><strong>Understanding how the product is used</strong> (cookieless, pseudonymous analytics) — our legitimate interest in improving Foundry. See our <Link href="/cookies" className="text-accent underline underline-offset-[3px] hover:text-accent-light">Cookie Policy</Link>.</li>
            </ul>
            <p className="mt-2">
              We do not use your data for advertising, we do not sell it, and we do not carry out automated
              decision-making that produces legal or similarly significant effects about you. One automated
              limit does exist and we would rather name it than leave it unsaid: if several different members
              block you or successfully report you, how many connection requests you can send per day is
              reduced for 30 days. It lifts automatically, changes nothing else about your account, and an
              admin can remove it — see section 7a.
            </p>
          </Section>

          <Section title="4. Sign-in with Google">
            <p>
              If you choose to sign in with Google, Google shares your name, email address, and basic profile
              identifier with us so we can create or access your account. We only request this basic profile
              information and do not receive your Google password. Google&rsquo;s handling of your data is governed
              by Google&rsquo;s own privacy policy.
            </p>
          </Section>

          <Section title="5. Who processes your data on our behalf">
            <p>
              Your profile, content and files are stored in the UK (Supabase, London; Microsoft Azure, UK South). We
              use the following processors, each under a data processing agreement and each receiving only the data
              needed for its role:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Supabase</strong> (London) — database, authentication, and storage. Holds your profile and the content you post.</li>
              <li><strong>Vercel</strong> (EU / Frankfurt) — application hosting and serving.</li>
              <li><strong>Microsoft Azure</strong> (UK South) — image and document storage. Holds images you attach to community posts and any profile photo you upload; these are re-processed on upload, which strips embedded metadata including any location recorded by your camera. It also holds any CV you upload, kept as the file you gave us rather than reprocessed, in a separate, more tightly restricted location that only you and our admins can read.</li>
              <li><strong>OpenAI</strong> (United States and other regions) — AI processing, only for features you opt in to. It receives the text of a CV you chose to have us read (with your name, contact details and links removed first) and public details of a GitHub account you chose to connect, in order to create your structured summary and search data. It does not receive your name, email address or photo. We have turned off OpenAI&rsquo;s use of this data to train its models. Under its standard terms OpenAI may keep API data for a limited period, historically up to 30 days, to detect abuse, and then deletes it.</li>
              <li><strong>Resend</strong> — sending our service emails; processes the recipient address and message content.</li>
              <li><strong>Cloudflare</strong> (global network) — DNS, inbound contact-email routing, edge security, and the Turnstile anti-bot challenge on our forms. Processes request metadata such as your IP address to block abuse.</li>
              <li><strong>Upstash</strong> — rate limiting. Stores only short-lived request counters keyed to your user ID or IP; no profile data.</li>
              <li><strong>Sentry</strong> (EU) — error monitoring. May capture technical diagnostics when an error occurs; we do not send it form contents.</li>
              <li><strong>PostHog</strong> (EU) — privacy-friendly, cookieless product analytics (which pages and features are used), tied to a pseudonymous user ID. You can turn it off in Settings.</li>
            </ul>
            <p className="mt-2">
              Messages you send to our contact or appeals email addresses are received in an inbox hosted by Google.
            </p>
          </Section>

          <Section title="6. International transfers">
            <p>
              We store your data in the UK, and some providers process it in the EU (Vercel, Sentry, PostHog). Several
              providers are headquartered in the United States and may process or access data there: in particular
              OpenAI, which processes the extracts described above in the United States and other regions, and
              Cloudflare, whose network is global. Wherever personal data leaves the UK, it is protected by a safeguard
              recognised under UK law: UK adequacy regulations (including the UK–US data bridge, where the provider is
              certified), or the UK International Data Transfer Addendum to the Standard Contractual Clauses in the
              provider&rsquo;s data processing agreement. You can ask us for a copy of the relevant safeguard.
            </p>
          </Section>

          <Section title="7. Who can see your data">
            <p>
              Your profile (name, course, graduation year, photo, bio, what you&rsquo;re working on, sectors,
              skills, and links) is visible to other approved Foundry members in the directory. Your email address
              is <strong>not</strong> displayed in the directory. There are exactly two ways another member sees
              it: if you choose to attach a contact email to a listing, and if you connect with them — see
              section 7a. Your CV file is visible only to you and to our admins; other members never see it. The only
              part of it another member can see is up to two short lines shown to a recruiter whose search found
              you, and only if you turn that on in Settings. Our
              admins can see all profile data, including email addresses and CVs, for review and operational
              purposes; every admin view of a member&rsquo;s CV is individually logged. If you join the committee, your
              profile card also appears on the committee page, which is likewise visible only to signed-in members.
              We do not make your data public on the open internet.
            </p>
          </Section>

          <Section title="7a. Connections: how your email address gets shared">
            <p>
              Foundry lets you connect with another member. <strong>The point of connecting is that you
              each get the other&rsquo;s email address</strong> — the address you sign in with. Nothing else
              is exchanged, because your profile and links are already visible to members in the directory.
            </p>
            <p className="mt-3">
              It only happens if you both agree. Sending a request is your agreement; accepting one is
              theirs. Before you accept, we show you the exact address that will be released, and we record
              which version of that wording you saw. If you decline, we tell the other person nothing at
              all — the request simply disappears from their view.
            </p>
            <p className="mt-3">
              Either of you can remove the connection at any time, which stops the address being shown in
              Foundry. To be straightforward about the limits of that: <strong>removing a connection cannot
              un-send an address someone already has.</strong> Treat sharing it as permanent, as you would
              anywhere else.
            </p>
            <p className="mt-3">
              You can add a short note (up to 300 characters) to a request. Only the person you sent it to
              can read it. An admin can read it only if someone reports that connection, and every such read
              is individually logged. Notes never appear in any email we send.
            </p>
            <p className="mt-3">
              <strong>We never show anyone else&rsquo;s connections to you.</strong> The network view shows
              you and the people you are connected to. If two of your connections know each other, we do not
              draw that or count it — they agreed to share an address with you, not to show you their own
              relationships. There is no admin screen that browses the network either: admins see totals, such as
              how many connections exist across the community, and never a list of who is connected to whom.
              The one exception is a report — if you or the other member reports a connection, the admins
              handling it necessarily see that the two of you were connected, because that is what they are
              being asked to look at.
            </p>
            <p className="mt-3">
              You can turn off new requests entirely in Settings, and you can block an individual member.
              Blocking is silent — they are never told — and only you can undo it. If several different
              members block or successfully report you, we automatically reduce how many requests you can
              send per day for 30 days. That limit lifts by itself, affects nothing else about your account,
              and an admin can remove it. We never apply it because your requests go unanswered: people not
              replying is not misconduct.
            </p>
          </Section>

          <Section title="8. How long we keep it">
            <p>
              We keep your data while your account is active. When you delete your account (Settings → Delete
              account) we remove your profile and the content you posted from our live systems. Our admins also run
              a graduate-cleanup that removes current-student accounts whose graduation year has passed, with a
              notice giving you the option to reapply as an alum. Residual copies may persist briefly in encrypted
              backups before being overwritten on our providers&rsquo; normal backup cycle.
            </p>
            <p className="mt-3">
              Some things have a fixed retention period, enforced automatically:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Community posts and their images — 7 days.</strong> Every post is deleted automatically seven days after it is published, along with any images attached to it. You can delete a post sooner at any time from Community → My posts.</li>
              <li><strong>Profile photo and CV — until you replace, remove, or your account is deleted.</strong> We keep one of each at a time; uploading a new one, removing it, or deleting your account queues the old file for deletion within minutes, and deletes the text and search data we extracted from the old CV at the same time. The one thing we keep is the CV you currently have: if you upload an identical file again we recognise it and reuse that data instead of reading it a second time.</li>
              <li><strong>Removed accounts — 12 months.</strong> If an account is removed from Foundry for breaking the rules and then deleted, we keep a one-way hash of its email address for 12 months so that the same address cannot rejoin with automatic approval; it would wait in the normal review queue instead. We keep this because it is needed to enforce a removal, which is a legitimate interest. The hash cannot be turned back into the address, and it is not kept for accounts that were not removed. Deleting your account is never refused.</li>
              <li><strong>Moderation records — 12 months.</strong> If an admin removes one of your posts, we keep a record of the removal: the post&rsquo;s title and text, your member ID and the email address you had at the time, the reason given, and who removed it and when. We keep this so that a removal can be explained, reviewed, or defended if it is challenged, which is a legitimate interest and, where the record relates to a potential legal claim, is permitted under Article 17(3)(e) UK GDPR even if you ask us to erase your data. It is deleted after 12 months unless a specific dispute is still live.</li>
              <li><strong>Reports — 12 months.</strong> If you report a post or a connection, we keep your report, what you told us, and the outcome, on the same 12-month clock. A report that is still open when the 12 months are up is kept until it is resolved, so that nothing is deleted out from under an investigation.</li>
              <li><strong>Connections — while they last.</strong> A connection you remove is deleted permanently within a day. A request that is withdrawn or declined is deleted permanently three weeks later, along with any note that was sent with it. The three weeks are not storage for its own sake: that is the period during which the member who sent the request cannot send another to the same person, and the record is what enforces it. A request nobody answers expires after six months and is deleted at that point. A block is kept until you lift it, because the block is the record. If the person you blocked deletes their account, we keep your member ID and a one-way hash of their email address for 12 months, so that if that address signs up again the block is put back; it is removed once it has been used, when you delete your account, or after 12 months. The hash cannot be turned back into the address. We also keep a record of connection activity (a request sent, accepted, declined, blocked) for 12 months, which is what lets us spot someone sending unwanted requests to many people. As with moderation records, that activity log is kept even if you delete your account, for the same reason and under the same Article 17(3)(e) basis.</li>
              <li><strong>Emails we send you — 7 days.</strong> Mail leaves Foundry through a short queue, and we delete the queued copy a week after it is sent. We keep it that long only so we can tell you whether something actually went out if you say you never received it. This matters for one email in particular: when someone accepts your connection request, the email telling you so contains their address, and that copy goes with the rest. The email in your own inbox is yours and stays there. A message that could not be delivered at all is kept for 30 days instead, so we can work out why.</li>
              <li><strong>Notifications in the app — 90 days.</strong> The notices shown in your account (for example a connection request or a decision on a listing) are deleted automatically after 90 days.</li>
              <li><strong>Email changes — as long as your account.</strong> When you change your sign-in email we record the old address, the new address and the time, as a security record, and delete it with your account.</li>
              <li><strong>Which listings you view or click — as long as your account.</strong> We record which opportunities, events and grants you open or click through, to understand how much interest each listing gets, and delete it with your account.</li>
              <li><strong>Admin actions — 6 years.</strong> When an admin approves, rejects, removes or edits something, we log what was done and by whom, for accountability, and delete each entry after 6 years, the period in which a legal claim about a decision could be brought. If that admin deletes their account sooner, their identity is removed and the entry stays.</li>
              <li><strong>Your age confirmation and Terms acceptance — as long as your account.</strong></li>
              <li><strong>Messages to our contact and appeals addresses — until the end of the academic year after the matter is closed,</strong> unless they are needed for a dispute that is still live.</li>
              <li><strong>Error reports and analytics — the provider&rsquo;s standard retention period for our plan.</strong> Error reports in Sentry and analytics events in PostHog are deleted on the provider&rsquo;s schedule; neither holds your name or email address.</li>
              <li><strong>Foundry AI — 7 to 30 days.</strong> See section 2c.</li>
            </ul>
          </Section>

          <Section title="9. How we protect it">
            <p>
              Access to your data is restricted by database row-level security, server-side authorisation checks,
              and least-privilege access controls. Data is encrypted in transit. We keep the platform patched and
              monitor for errors and abuse. No system is perfectly secure, but we take reasonable and proportionate
              measures appropriate to a community of this size.
            </p>
          </Section>

          <Section title="10. Your rights">
            <p>Under data protection law you have the right to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>access the personal data we hold about you;</li>
              <li>have inaccurate data corrected — you can edit most of it yourself in your profile;</li>
              <li>have your data erased — use Settings → Delete account, or contact us;</li>
              <li>restrict or object to certain processing;</li>
              <li>data portability — you can download a copy of your data yourself in Settings; and</li>
              <li>withdraw consent at any time, without affecting processing done before withdrawal.</li>
            </ul>
            <p className="mt-2">
              To exercise any of these, email <strong>contact@imperialentrepreneurs.com</strong> or use the{" "}
              <Link href="/contact" className="text-accent underline underline-offset-[3px] hover:text-accent-light">contact form</Link>.
              We will respond within one month, or tell you within that month if a complex request needs up to two
              more.
            </p>
            <div className="mt-3 rounded-xl border border-border-strong px-4 py-3">
              <p className="text-text-primary font-medium">Your right to object</p>
              <p className="mt-1">
                Where we rely on our legitimate interests (section 3), you can object at any time to our using your
                data that way, and we will stop unless we have compelling grounds that override your interests, or
                need the data for a legal claim. You can stop analytics yourself in Settings; for anything else,
                email us.
              </p>
            </div>
          </Section>

          <Section title="11. Cookies">
            <p>
              We use only strictly necessary cookies (for your sign-in session and security), keep a few things in
              your browser so the site works as you left it (such as an unfinished intake form), and run our
              analytics cookielessly, so we do not show a cookie banner. Full details are in our{" "}
              <Link href="/cookies" className="text-accent underline underline-offset-[3px] hover:text-accent-light">Cookie Policy</Link>.
            </p>
          </Section>

          <Section title="12. Children">
            <p>
              Foundry is for people aged 18 or over, and everyone confirms their age when they join. We do not
              knowingly hold data about anyone under 18: if we learn that a member is under 18, we close their
              account, and they are welcome to join again once they turn 18.
            </p>
          </Section>

          <Section title="13. Changes to this policy">
            <p>
              We may update this policy from time to time. If we make a material change we will notify members by
              email at their registered address. The date at the top shows when it was last updated.
            </p>
          </Section>

          <Section title="14. Contact and complaints">
            <p>
              If you are unhappy with how we have handled your data, please complain to us first, at{" "}
              <strong>contact@imperialentrepreneurs.com</strong> or through the{" "}
              <Link href="/contact" className="text-accent underline underline-offset-[3px] hover:text-accent-light">contact form</Link>{" "}
              (choose &ldquo;Data protection request or complaint&rdquo;). We will acknowledge your complaint within
              30 days and tell you what we are doing about it without undue delay. If you are still unhappy, you can
              complain to the UK Information Commissioner&rsquo;s Office (ICO) at{" "}
              <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-[3px] hover:text-accent-light">ico.org.uk/make-a-complaint</a>{" "}
              or by calling 0303 123 1113.
            </p>
          </Section>
        </article>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[1.05rem] text-text-primary font-medium tracking-tight mb-2">{title}</h2>
      <div>{children}</div>
    </section>
  );
}
