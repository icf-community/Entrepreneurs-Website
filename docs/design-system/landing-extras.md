# What the live landing page said that the Lumen page does not

When the landing page moved to Lumen (`frontend/src/components/landing/`, copy in `frontend/src/lib/landing/content.ts`), the words became the design mock's
(`design/phase-2/kit/content.js`), which is shorter than the old page's. The owner decided to **leave these out for now and decide later**. Nothing here is lost:
the old components (`Navbar`, `Hero`, `HeroScene`, `WhoWeAre`, `Community`, `Opportunities`, `Events`, `Apply`, `Footer`, `SectionHead`) are in git history, and every string
they held that the new page lacks is below, verbatim (apostrophes and dashes as the old source wrote them), with the component and the field it lived in.

To bring one back, add it to `content.ts` and render it in the section's component; the stylesheet (`landing.css`) has no rule for most of these, so give each a home first
(the page has no room for a paragraph beside a headline: the mock uses a glyph or a drawn mark where the old page used words).

What the new page **kept** from the old one that the mock did not have: the footer's copyright line and company disclosure (both verbatim), the social links' names, the
legal links, the `Join Foundry` destination (`/login`), and the names the old controls had (`Toggle menu`, `Learn more about who we are`,
`Foundry — Imperial Entrepreneurs`). Three things the mock draws as a glyph carry the old words as visually hidden text so assistive technology loses nothing: the scroll cue
(`Learn more about who we are`), the example members' roles (`Current student` …) and the listing field names (`Pay`, `Equity`, `Location`).

## Hero (`Hero.tsx`)

| Field | Verbatim |
|---|---|
| lede paragraph under the headline | `Foundry connects students, recent graduates, alumni founders, mentors, and investors across Imperial's ecosystem. Build something real, together.` |
| "Learn more" button, visible label | `Learn more` (now a drawn arrow; the words are visually hidden text: `Learn more about who we are`) |
| "Join Foundry" button | a trailing arrow icon after the label (now the orbit glyph before it) |
| the mark's fallback image, `alt` | `Imperial Entrepreneurs` (the 2025 `/logo-roundel.png`, replaced by the scene and the painted poster) |

## Navbar (`Navbar.tsx`, with `BrandLogo`)

| Field | Verbatim |
|---|---|
| desktop action "Join Foundry" (`href="/login"`), top right | `Join Foundry` (the nav now has `Sign in`, also `/login`; the two `Join Foundry` links are in the hero and in Apply) |
| mobile dropdown action | `Join Foundry` |
| mobile sticky bar fixed to the bottom of the screen | `Join Foundry` (a third `/login` link; the phone layout has none) |
| the wordmark set beside the lockup, in the header and in the footer (`BrandLogo`, visible at 380 px and up) | `Foundry` |
| section links | `Who are we?`, `Community`, `Opportunities`, `Events`, `Apply` (kept: they are the rail's tick names) |

## Section eyebrows (`SectionHead.tsx`, the `label` above each heading)

`Who are we?` · `Community` · `Opportunities` · `Events` · `Apply`. The words survive as the rail's tick names; the line above each heading is gone.

## WhoWeAre (`WhoWeAre.tsx`)

| Field | Verbatim |
|---|---|
| story paragraph 1 | `Foundry was built by Imperial students who were frustrated with the gap between academic brilliance and startup support. We wanted direct access to people who'd been where we were — actual founders, still in the trenches.` |
| story paragraph 2 | `Today, Foundry is the connective tissue of the Imperial startup ecosystem — a private network where introductions are warm, opportunities are real, and membership is earned.` |
| access note (with the two domains in the data face) | `Access is verified through your Imperial student email @imperial.ac.uk or @ic.ac.uk. Alumni go through a quick admin verification before being admitted. Membership is free.` |
| role "Current students", description | `Undergrad, postgrad, and PhD students building while they study.` |
| role "Recent grads", description | `Within 3 years of graduating — figuring it out and moving fast.` |
| role "Alumni founders", description | `Imperial alumni who've been through it and want to give back.` |
| role "Mentors", description | `Operators and experts who make themselves available to the community.` |
| role "Angel investors", description | `Angels actively looking at early-stage Imperial-connected startups.` |
| role "Staff & faculty", description | `Researchers and professors bridging academia and the startup world.` |

(Kept as the old page had them: the heading `A community with skin in the game.`, `Who can join`, and the six role names. The new page's story, access note and role lines are the mock's shorter wording, see `content.ts`.)

## Community (`Community.tsx`)

| Field | Verbatim |
|---|---|
| paragraph | `Your profile shows what you're building, what you're good at, and what you're looking for — skills, sectors, and intent. Smart matching surfaces the right people at the right time.` |
| caption over the four profiles | `Example profiles` (now the quiet marker `Example`) |
| Sofia A., initials | `SA` |
| James K., initials | `JK` |
| Maria L., initials | `ML` |
| Rishi P., initials | `RP` |
| Sofia A., role line (now visually hidden text) | `Current student` |
| James K., role line (now visually hidden text) | `Alumni founder` |
| Maria L., role line (now visually hidden text) | `Mentor` |
| Rishi P., role line (now visually hidden text) | `Recent grad` |
| Sofia A., skill chips | `Hardware`, `Machine learning` |
| James K., skill chips | `Finance / VC`, `Product` |
| Maria L., skill chips | `Product`, `Clinical research` |
| Rishi P., skill chips | `Full-stack dev`, `Regulatory` |

(The skills still drive the picker's smart matching in the scene: choosing a skill lights the members who share it. They are just not drawn on the members any more.
Kept verbatim: the headline, the two picker labels, all twelve skills and seven sectors, the five that open chosen, the names, bios and `Looking for` values.)

## Opportunities (`Opportunities.tsx`)

| Field | Verbatim |
|---|---|
| aside paragraph | `Roles posted by alumni founders directly — your golden ticket to finding your next job via warm outreach.` |
| "ML Engineer": company line | `Helixa Bio · Biotech / Health` (the new page shows the company only) |
| "ML Engineer": skill chips | `Machine learning`, `Python` |
| "ML Engineer": posted | `2d ago` |
| "Growth & GTM Intern": company line | `Quantora · Fintech` |
| "Growth & GTM Intern": skill chips | `Sales / GTM`, `Product` |
| "Growth & GTM Intern": posted | `4d ago` |
| "Innovate UK Young Founders Fund": company line | `Innovate UK · Deeptech` |
| "Innovate UK Young Founders Fund": skill chips | `Finance / VC` |
| "Innovate UK Young Founders Fund": posted | `3d ago` |
| field names above the values (now visually hidden text beside them) | `Pay`, `Equity`, `Location` |

## Events (`Events.tsx`)

| Field | Verbatim |
|---|---|
| aside paragraph | `Networking, demos, hackathons and office hours — designed to put you in the same room as the people worth meeting.` |
| "Founder Speed Networking": place | `Imperial College Union, London` (new page: `Imperial College Union`) |
| "Founder Speed Networking": description | `30-minute slots. Meet 6 founders in one evening. Structured, fast, no filler.` |
| "Founder Speed Networking": availability | `28 spots left` |
| "Demo Night": title | `Demo Night · Spring 2025` (new page: `Demo Night`) |
| "Demo Night": description | `Twelve startups, five-minute pitches, open Q&A. Angels and VCs in the room.` |
| "Demo Night": availability | `Open to members` |
| "HealthTech Hackathon": place | `Barclays Eagle Labs, London` (new page: `Barclays Eagle Labs`) |
| "HealthTech Hackathon": description | `48 hours. Teams of 2–5. £10k prize pool, mentored by Barclays clinicians.` |
| "HealthTech Hackathon": availability | `60 spots left` |
| "Angel Office Hours": place | `Online · Zoom` (new page: `Online`) |
| "Angel Office Hours": description | `One-on-one 20-min sessions with angels actively deploying into pre-seed rounds.` |
| "Angel Office Hours": availability | `12 slots available` |
| every event card, button (it did nothing) | `Reserve` |

(Kept: the four dates, titles except Demo Night's year, `The Hive, White City`, and the four types. The event descriptions are also in the mock's `content.js` as the optional `detail` field.)

## Apply (`Apply.tsx`)

| Field | Verbatim |
|---|---|
| paragraph | `Current students get in instantly with an Imperial email. Alumni sign in with Google and are admitted after a quick admin check. Then build your profile and start meeting people.` |
| step 01 "Identity", description | `Name, Imperial email, and your role in the ecosystem.` |
| step 02 "Your work", description | `A one-line bio, skills, sector focus, and what you're looking for.` |
| step 03 "Visibility", description | `Choose what you're open to — intros, work opportunities, co-founder conversations.` |
| the action's label | `Join Foundry →` (new page: `Join Foundry` with the orbit glyph before it) |

The mocked sign-up form beside the steps (`FormPreview`, `MockField`; all of it was a picture of a form, nothing could be typed):

| Field | Verbatim |
|---|---|
| panel title | `Member profile signup` |
| step counter | `Step 1 / 3` |
| field label, value | `First name`, `John` |
| field label, value | `Last name`, `Doe` |
| field label, value, hint | `Imperial email`, `username@imperial.ac.uk`, `Students: @imperial.ac.uk or @ic.ac.uk. Alumni: sign in with Google, admin-verified before access.` |
| role question | `I am a…` |
| role pills (the first one shown chosen) | `Current student`, `Recent grad`, `Alumni founder`, `Mentor`, `Angel investor` |
| greyed button | `Continue →` |

(Kept: the headline `Join Foundry in` / `a few minutes.` / `That's it.`, the three step titles, `Free · Imperial students & verified alumni`.)

## Footer (`Footer.tsx`)

Nothing left out. The copyright line `© 2026 IC Founders Ltd · Built by students, for founders`, the disclosure paragraph (company name, number 17171277, registered office, the
statement that Foundry is not operated or endorsed by Imperial College London, the contact address), the four legal links and the two social links with their names
are on the new page exactly as the old footer had them. The only change is the wordmark `Foundry` beside the lockup (listed under Navbar).

## Not words, but gone

- The hero's headline set the three lines at three weights (bold, regular condensed, light); Lumen's headline is one weight (300) on three lines.
- The old page's chips, panels, ruled tables and bordered cells (the structure the words sat in): the mock draws each entry as a glyph, a name and one or two lines.
- `HeroScene.tsx` (the 2025 mark sampled from `/logo-roundel.png` into stars, with the flat PNG as its fallback): replaced by the scene in `components/landing/scene/`, and `.hero-mark-fallback` in `globals.css` has no user.
