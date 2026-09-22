import Link from "next/link";

// Terms & Conditions — the contract between IC Founders Ltd and members.
// Grounded in the real eligibility rules (Imperial email / alumni review),
// the directory/signposting nature of the service, and English law. The
// signup flow links here from SignupDisclosures.

export const metadata = {
  title: "Terms & Conditions · Foundry",
};

const LAST_UPDATED = "20 September 2026";

export default function TermsPage() {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-bg-primary text-text-primary px-8 py-16">
      <div className="max-w-[720px] mx-auto">
        <Link href="/login" className="text-[0.8rem] text-text-muted no-underline hover:text-text-secondary transition-colors">
          ← Back
        </Link>
        <div className="mt-6 mb-10 rule-draw pt-6">
          <p className="label-wide text-text-secondary mb-3">Legal</p>
          <h1 className="font-display text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.1] tracking-tight">
            Terms &amp; Conditions
          </h1>
          <p className="text-[0.825rem] text-text-muted mt-3">
            Last updated: {LAST_UPDATED}.
          </p>
        </div>

        <article className="space-y-6 text-[0.875rem] text-text-secondary leading-relaxed">
          <Section title="1. Who we are and these terms">
            <p>
              Foundry is operated under the name &ldquo;Imperial Entrepreneurs&rdquo; by <strong>IC Founders Ltd</strong>,
              a company limited by guarantee registered in England and Wales (company number <strong>17171277</strong>),
              registered office 71–75 Shelton Street, Covent Garden, London, WC2H 9JQ (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;).
              These Terms and Conditions govern your access to and use of Foundry. By creating an account or using
              Foundry you agree to these terms and to our{" "}
              <Link href="/privacy" className="text-accent hover:text-accent-light no-underline">Privacy Policy</Link>. If you
              do not agree, please do not use Foundry.
            </p>
          </Section>

          <Section title="2. Eligibility and your account">
            <p>
              Foundry is for current Imperial College London students and alumni aged 18 or over. To join as a
              current student you need a valid Imperial email address (@imperial.ac.uk or @ic.ac.uk). To join as an
              alum you confirm you have studied at Imperial; our admins review alumni applications before granting
              access. You agree to provide accurate information, to keep your account secure, and not to share your
              login or let anyone else use your account. You may hold only one account.
            </p>
          </Section>

          <Section title="3. Acceptable use">
            <p>You agree that you will not, and will not attempt to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>post content that is unlawful, false, misleading, defamatory, discriminatory, harassing, or that infringes anyone&rsquo;s rights;</li>
              <li>misrepresent an opportunity, event, or funding source, or post scams, fraudulent, or &ldquo;too good to be true&rdquo; offers;</li>
              <li>post a listing that solicits money, fees, or personal financial information from members under false pretences;</li>
              <li>impersonate any person or organisation, or misstate your affiliation with Imperial;</li>
              <li>collect, scrape, or harvest other members&rsquo; data, or use the member directory for spam or unsolicited marketing;</li>
              <li>upload malware, attempt to bypass our security or access controls, probe or disrupt the service, or use it other than through the interface we provide;</li>
              <li>use Foundry for any commercial purpose unrelated to its community aims without our permission.</li>
            </ul>
            <p className="mt-3">
              <strong>Connections and the email addresses they release.</strong> Connecting with another member
              exists so the two of you can contact each other, and an address you obtain that way is given to you
              for that and nothing else. You additionally agree that you will not:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>add an address you obtained through a connection to a mailing list, newsletter, CRM, or any bulk or automated sending, or pass it to anyone else, without that member&rsquo;s separate agreement;</li>
              <li>send connection requests indiscriminately, or keep approaching someone who has declined, withdrawn from, or removed a connection with you;</li>
              <li>use connection requests, or the note attached to one, to advertise, recruit, solicit money or investment, or send anything you would not be willing to post publicly;</li>
              <li>collect connections, or the addresses behind them, in order to build a contact list rather than to speak to the people in it.</li>
            </ul>
            <p className="mt-2">
              We may remove content and suspend or terminate accounts that breach this section, at our reasonable
              discretion.
            </p>
          </Section>

          <Section title="4. Content you post">
            <p>
              You retain ownership of the content you submit — including a profile photo or CV you upload. By
              posting it, you grant us a non-exclusive, royalty-free licence to host, store, and display that
              content for the purpose of operating Foundry: your profile photo and profile details to other
              approved members in the directory, and your CV to yourself and to our admins only. You confirm that
              you have the right to post it, that a profile photo is of you, and that it does not breach these
              terms or anyone&rsquo;s rights. When you delete a listing, your CV, your photo, or your account, we
              remove that content from our live systems as described in the{" "}
              <Link href="/privacy" className="text-accent hover:text-accent-light no-underline">Privacy Policy</Link>.
            </p>
            <p className="mt-3">
              <strong>Community posts are temporary.</strong> A post you publish to the Community feed is deleted
              automatically seven days after it is published, together with any images attached to it. You can
              delete a post sooner from Community → My posts. Do not use the feed as a place to store anything you
              would be sorry to lose.
            </p>
            <p className="mt-3">
              <strong>Community guidelines.</strong> The Community feed is published immediately, without review,
              so what keeps it usable is that everyone posting to it sticks to the same rules. In addition to the
              acceptable use terms in section 3, do not post:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>anything illegal, or content that encourages or assists a criminal offence;</li>
              <li>abuse, harassment, threats, or content that attacks someone for who they are;</li>
              <li>sexual or explicit material;</li>
              <li>someone else&rsquo;s personal information, or a photograph of an identifiable person who has not agreed to appear in it;</li>
              <li>spam, chain messages, or repeated promotion of the same thing;</li>
              <li>links intended to deceive — in particular, anything imitating an Imperial College or Foundry sign-in page;</li>
              <li>content you do not have the right to share, including copyrighted material.</li>
            </ul>
            <p className="mt-3">
              Every member can report a post. If you see something that breaches these rules, use the Report
              control on the post — an admin will review it and email you the outcome either way.
            </p>
            <p className="mt-3">
              <strong>The note on a connection request is content you post.</strong> It is optional, limited to 300
              characters, and written to one named person rather than to the feed — but the community guidelines
              above apply to it in full, and so does section 3. Only the member you sent it to can read it, and an
              admin only if one of you reports the request, in which case the reading is logged. The note is deleted
              with the request: three weeks after it is declined or withdrawn, or when an unanswered request expires.
              Notes never appear in any email we send, so do not use one to reach someone who is not reading Foundry.
            </p>
          </Section>

          <Section title="5. Listings are signposting, not endorsements">
            <p>
              Foundry is a directory and signposting service. The opportunities, events, and VC / grant listings are
              posted by members and third parties. <strong>We do not verify, endorse, or guarantee</strong> any
              listing, organisation, or person, and nothing on Foundry is financial, legal, investment, or careers
              advice. You are responsible for your own due diligence before applying to, attending, funding, or
              otherwise engaging with anything you find here. Any dealings between you and a third party are solely
              between you and them.
            </p>
          </Section>

          <Section title="6. Moderation, suspension, and removal">
            <p>
              We may review, moderate, suspend, or remove accounts or content — including accounts we cannot verify
              as belonging to current Imperial students or alumni, and current-student accounts at the end of their
              final year (with an option to reapply as an alum). Where we suspend or remove your account we will aim
              to notify you by email with a reason. If you believe a decision was wrong, you can appeal by emailing{" "}
              <strong>appeals@imperialentrepreneurs.com</strong>.
            </p>
            <p className="mt-3">
              If we remove one of your community posts, we will email you saying what was removed, when, and why.
              We keep a record of that removal — including the text of the post and the reason given — for 12
              months, so that the decision can be explained or reviewed if you challenge it. That record is kept
              even if you delete your account, and section 8 of the{" "}
              <Link href="/privacy" className="text-accent hover:text-accent-light no-underline">Privacy Policy</Link>{" "}
              explains the basis for keeping it.
            </p>
            <p className="mt-3">
              <strong>Connections.</strong> Declining a request tells the sender nothing — it simply disappears from
              their view — and blocking someone is silent too. You can report a connection or a request the same way
              you report a post, and we will email you the outcome either way, including when we decide to take no
              action. If several different members block you or successfully report you, Foundry automatically
              reduces how many connection requests you can send per day for a while. That limit lifts on its own, it
              affects nothing else about your account, and an admin can remove it if it was applied unfairly —
              email <strong>appeals@imperialentrepreneurs.com</strong>.
            </p>
          </Section>

          <Section title="7. Our intellectual property">
            <p>
              Foundry, the &ldquo;Imperial Entrepreneurs&rdquo; and &ldquo;Foundry&rdquo; names, the platform, and its design and
              code are owned by or licensed to us. These terms do not grant you any right to use our branding or
              reproduce the platform except as needed to use Foundry normally.
            </p>
          </Section>

          <Section title="8. Availability and changes to the service">
            <p>
              Foundry is provided free of charge and on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. We may change,
              suspend, or discontinue features, or the whole service, at any time. We do not guarantee that Foundry
              will be uninterrupted or error-free.
            </p>
          </Section>

          <Section title="9. Liability">
            <p>
              Nothing in these terms limits or excludes our liability for death or personal injury caused by our
              negligence, for fraud or fraudulent misrepresentation, or for any other liability that cannot be
              limited or excluded under English law.
            </p>
            <p className="mt-2">
              Subject to that, to the fullest extent permitted by law: we are not liable for any loss or damage
              arising from listings posted by members or third parties, from your dealings with other members or
              third parties, from your reliance on any content on Foundry, or from any interruption, error, or
              unavailability of the service; and we are not liable for indirect or consequential loss, or for loss
              of profit, opportunity, data, or goodwill. Because Foundry is provided free of charge, our total
              liability to you for any claim connected with the service is limited to £100.
            </p>
          </Section>

          <Section title="10. Indemnity">
            <p>
              You agree to indemnify us against reasonable losses and costs we incur as a result of content you post
              in breach of these terms or of your misuse of Foundry.
            </p>
          </Section>

          <Section title="11. Changes to these terms">
            <p>
              We may update these terms. If we make a material change we will notify members by email at their
              registered address. Continued use of Foundry after notification constitutes acceptance of the updated
              terms.
            </p>
          </Section>

          <Section title="12. Governing law and jurisdiction">
            <p>
              These terms and any dispute arising out of or in connection with them are governed by the laws of
              England and Wales, and the courts of England and Wales have exclusive jurisdiction.
            </p>
          </Section>

          <Section title="13. Contact">
            <p>
              Questions about these terms: <strong>contact@imperialentrepreneurs.com</strong>. Appeals against a
              moderation decision: <strong>appeals@imperialentrepreneurs.com</strong>.
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
