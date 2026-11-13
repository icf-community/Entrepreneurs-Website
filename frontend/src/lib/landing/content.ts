// The words of the landing page (route `/`), in one place. Every section renders from this module and the scene reads the picker
// data from it, so a copy change is a change here and nowhere else.
//
// DOM-free on purpose: the server components import it, and so does the scene (the picker's skills, for smart matching).
//
// The copy is the Lumen mock's (design/phase-2/kit/content.js), with the destinations of the live site (`/login`, `/contact`, ...) in
// place of the sketch's `#signin` links, plus the two things the live footer carries that the mock lacks and that the law requires: the
// company's disclosure paragraph and the copyright line. Nothing here is invented: PRODUCT.md says the people, listings and events on
// `/` are illustrative, which is why the three example groups carry a quiet "Example" marker.
//
// Strings the live page had and this one leaves out on purpose (longer section paragraphs, event "spots left" counts and Reserve buttons,
// the mock signup form, sector / skills / posted details on listings, initials and skills on members, the hero lede, eyebrow labels) are
// listed verbatim in docs/design-system/landing-extras.md.

import {
  AUDIENCES, EVENT_TYPES, LISTING_KINDS, SIGNUP_STEPS, STATUS_GLYPHS,
  type AudienceId, type EventTypeId, type GlyphName, type ListingTypeId, type SignupStepId,
} from "@/design-system/icons/glyphs";

/** Quiet marker for the example groups (members, listings and events on `/` are illustrative). */
export const EXAMPLE = "Example";

// The drawings and the kit's labels for the audiences, listing kinds, event types and sign-up steps are the design system's (design-system/icons/glyphs.ts):
// the page picks a drawing by id and never names one twice, so the glyph beside the words and the body in the scene are one drawing.
const glyphById = <T extends { id: string; glyph: GlyphName }>(list: readonly T[]) => Object.fromEntries(list.map((x) => [x.id, x.glyph])) as Record<T["id"], GlyphName>;
const labelById = <T extends { id: string }>(list: readonly T[], pick: (x: T) => string) => Object.fromEntries(list.map((x) => [x.id, pick(x)])) as Record<T["id"], string>;
export const AUDIENCE_GLYPH = glyphById(AUDIENCES);
export const AUDIENCE_LABEL = labelById(AUDIENCES, (a) => a.full);
export const KIND_GLYPH = glyphById(LISTING_KINDS);
export const EVENT_GLYPH = glyphById(EVENT_TYPES);
export const EVENT_LABEL = labelById(EVENT_TYPES, (e) => e.name);
export const STEP_GLYPH = glyphById(SIGNUP_STEPS);
export const STEP_LABEL = labelById(SIGNUP_STEPS, (x) => x.name);

export const NAV = {
  /** The five stations of the altitude rail, lowest tick first; the ids are the section ids, the hrefs are real anchors, the drawings are the design system's
   *  (Ascent's choice: a lighthouse, a row of chips, a briefcase, a calendar, a tick). */
  links: [
    { id: "who-we-are", label: "Who are we?", href: "#who-we-are", glyph: AUDIENCE_GLYPH.mentors },
    { id: "community", label: "Community", href: "#community", glyph: STEP_GLYPH.work },
    { id: "opportunities", label: "Opportunities", href: "#opportunities", glyph: KIND_GLYPH.opportunities },
    { id: "events", label: "Events", href: "#events", glyph: KIND_GLYPH.events },
    { id: "apply", label: "Apply", href: "#apply", glyph: STATUS_GLYPHS.verified },
  ],
  /** The label of the rail itself, for assistive technology. */
  railLabel: "Sections",
  /** The quiet pill top right. The live login page opens in sign-up mode and has no deep link for sign-in, so it is the same destination as Join Foundry. */
  signIn: { label: "Sign in", href: "/login" },
  /** The phone's menu button: the visible word, and the name the live site's hamburger already had. */
  menu: { label: "Menu", ariaLabel: "Toggle menu" },
} as const satisfies { links: readonly { id: string; label: string; href: string; glyph: GlyphName }[] } & Record<string, unknown>;

export const HERO = {
  headline: ["The founder community,", "built by Imperial students", "for Imperial students."],
  cta: { label: "Join Foundry", href: "/login" },
  /** The scroll cue: a glyph, named (as visually hidden text) as the live "Learn more" link was. */
  cue: { label: "Learn more about who we are", href: "#who-we-are", glyph: STATUS_GLYPHS.learnMore },
  audienceLabel: "Who is in Foundry",
  caption: "Verified Imperial members",
} as const;

export const WHO = {
  heading: "A community with skin in the game.",
  story: [
    "Built by Imperial students who wanted direct access to founders still in the trenches.",
    "A private network where introductions are warm, opportunities are real, and membership is earned.",
  ],
  access: "Verified with your @imperial.ac.uk or @ic.ac.uk email. Membership is free.",
  rolesLabel: "Who can join",
  /** The six audiences, in the design system's order: the name and the drawing are the audience's (AUDIENCE_LABEL, AUDIENCE_GLYPH); the line is the page's. */
  roles: [
    { id: "students", line: "Undergrad to PhD, building while they study." },
    { id: "grads", line: "Within 3 years of graduating, moving fast." },
    { id: "founders", line: "Been through it, giving back." },
    { id: "mentors", line: "Operators and experts available to the community." },
    { id: "angels", line: "Angels looking at early-stage Imperial startups." },
    { id: "faculty", line: "Researchers bridging academia and startups." },
  ],
} as const satisfies { roles: readonly { id: AudienceId; line: string }[] } & Record<string, unknown>;

export const COMMUNITY = {
  heading: ["Build your profile.", "Get found."],
  line: "Skills, sectors and what you're looking for. Smart matching finds the right people.",
  /** The name of the picker group: "Skills" and "sector focus", from the two labels below. */
  pickerLabel: "Skills and sector focus",
  skillsLabel: "Skills · pick up to 5",
  sectorsLabel: "Sector focus · pick up to 2",
  /** The most a visitor may pick of each (the labels say so). */
  limits: { skills: 5, sectors: 2 },
  skills: [
    "Machine learning", "Full-stack dev", "Bioengineering", "Product",
    "Hardware", "Finance / VC", "Design", "Sales / GTM",
    "Regulatory", "Clinical research", "Deep tech", "Climate / Energy",
  ],
  sectors: ["Biotech / Health", "Climate / Energy", "AI / ML", "Deeptech", "Fintech", "Consumer", "Defence"],
  /** The picks the page opens with (the rest are behind the "+"). */
  activeSkills: ["Machine learning", "Bioengineering", "Hardware"],
  activeSectors: ["Biotech / Health", "AI / ML"],
  moreLabel: "All skills and sectors",
  lookingLabel: "Looking for",
  /** Four example members; the role is drawn by the audience glyph (and read as visually hidden text). `skills` feed the picker's smart matching. */
  profiles: [
    { id: "sofia", role: "Current student", name: "Sofia A.", audience: "students", line: "Building sensor fusion for surgical robotics", skills: ["Hardware", "Machine learning"], looking: "Co-founder" },
    { id: "james", role: "Alumni founder", name: "James K.", audience: "founders", line: "Ex-McKinsey → founded a climate fintech, raised seed", skills: ["Finance / VC", "Product"], looking: "Funding" },
    { id: "maria", role: "Mentor", name: "Maria L.", audience: "mentors", line: "Director of Product @ scale-up, 10 yrs in healthtech", skills: ["Product", "Clinical research"], looking: "Just here to help" },
    { id: "rishi", role: "Recent grad", name: "Rishi P.", audience: "grads", line: "Full-stack dev, building a dev tool for clinical trials", skills: ["Full-stack dev", "Regulatory"], looking: "Beta users" },
  ],
} as const satisfies { profiles: readonly { id: string; role: string; name: string; audience: AudienceId; line: string; skills: readonly string[]; looking: string }[] } & Record<string, unknown>;

export const OPPORTUNITIES = {
  heading: ["Jobs, internships,", "and more."],
  line: "Posted by alumni founders directly. Your golden ticket to warm outreach.",
  /** Three example listings; `kind` picks the listing glyph (KIND_GLYPH: a briefcase for a role, a coin for funding). */
  items: [
    { id: "ml", kind: "opportunities", tag: "Full-time", title: "ML Engineer", company: "Helixa Bio", pay: "£55–70k", equity: "0.2–0.5%", place: "London" },
    { id: "gtm", kind: "opportunities", tag: "Internship", title: "Growth & GTM Intern", company: "Quantora", pay: "£2,200/mo", equity: null, place: "Remote" },
    { id: "iuk", kind: "funding", tag: "Grant", title: "Innovate UK Young Founders Fund", company: "Innovate UK", pay: "Up to £50k", equity: null, place: "UK-wide" },
  ],
  /** The listing's fields have no visible labels (the pay, the equity mark and the place say what they are); assistive technology reads these. */
  labels: { pay: "Pay", equity: "Equity", place: "Location" },
} as const satisfies { items: readonly { id: string; kind: ListingTypeId; tag: string; title: string; company: string; pay: string; equity: string | null; place: string }[] } & Record<string, unknown>;

export const EVENTS = {
  heading: ["Things worth", "showing up for."],
  line: "In the same room as the people worth meeting.",
  /** Four example events; `type` is an event type of the design system (its name is EVENT_LABEL, its drawing EVENT_GLYPH). */
  items: [
    { id: "speed", type: "networking", day: "14", month: "May", title: "Founder Speed Networking", place: "Imperial College Union" },
    { id: "demo", type: "demo", day: "21", month: "May", title: "Demo Night", place: "The Hive, White City" },
    { id: "hack", type: "hackathon", day: "3", month: "Jun", title: "HealthTech Hackathon", place: "Barclays Eagle Labs" },
    { id: "office", type: "office-hours", day: "18", month: "Jun", title: "Angel Office Hours", place: "Online" },
  ],
} as const satisfies { items: readonly { id: string; type: EventTypeId; day: string; month: string; title: string; place: string }[] } & Record<string, unknown>;

export const APPLY = {
  heading: ["Join Foundry in", "a few minutes.", "That's it."],
  line: "Students get in instantly with an Imperial email. Alumni sign in with Google and pass a quick admin check.",
  /** The three sign-up steps: the title and the drawing are the step's (STEP_LABEL, STEP_GLYPH); the number and the line are the page's. */
  steps: [
    { n: "01", id: "identity", line: "Name, Imperial email and your role." },
    { n: "02", id: "work", line: "A one-line bio, skills, sector and what you're looking for." },
    { n: "03", id: "visibility", line: "Choose what you're open to: intros, jobs, co-founder talks." },
  ],
  cta: { label: "Join Foundry", href: "/login" },
  fine: "Free · Imperial students & verified alumni",
  /** The small mark before the small print. */
  fineGlyph: STATUS_GLYPHS.verified,
} as const satisfies { steps: readonly { n: string; id: SignupStepId; line: string }[] } & Record<string, unknown>;

export const FOOTER = {
  /** The footer's landmark name and the lockup link's: the brand, as the live nav's logo button named it. */
  label: "Imperial Entrepreneurs",
  lockupLabel: "Foundry — Imperial Entrepreneurs",
  social: [
    { id: "linkedin", label: "Imperial Entrepreneurs on LinkedIn", href: "https://www.linkedin.com/company/imperial-entrepreneurs/" },
    { id: "instagram", label: "Imperial Entrepreneurs on Instagram", href: "https://www.instagram.com/imperialentrepreneurs/" },
  ],
  links: [
    { label: "Contact", href: "/contact" },
    { label: "Privacy", href: "/privacy" },
    { label: "Cookies", href: "/cookies" },
    { label: "Terms", href: "/terms" },
  ],
  /** Required, verbatim from the live footer. */
  copyright: "© 2026 IC Founders Ltd · Built by students, for founders",
  /** Trading disclosures (Companies Act 2006 / 2015 Regs) and the E-Commerce Regs reg 6 identity, on every public page. Verbatim from the live footer. */
  disclosure:
    "Foundry is run by IC Founders Ltd for Imperial Entrepreneurs, an Imperial College Union society, and is not operated or endorsed by Imperial College London. IC Founders Ltd, registered in England and Wales, company number 17171277, registered office 71–75 Shelton Street, London WC2H 9JQ · contact@imperialentrepreneurs.com",
} as const;
