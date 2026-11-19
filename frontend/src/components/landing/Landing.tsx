import "./landing.css";
import { Apply } from "./Apply";
import { Community } from "./Community";
import { Events } from "./Events";
import { Footer } from "./Footer";
import { Hero } from "./Hero";
import { LandingFrame } from "./LandingFrame";
import { Nav } from "./Nav";
import { Opportunities } from "./Opportunities";
import { Who } from "./Who";

// The landing page (route `/`): Lumen. One page, one scene, the mark at the centre, the altitude rail on the right edge.
//
// Every word is real markup in the server's HTML, in order: hero, who we are, community, opportunities, events, apply, footer. The scene (a fixed
// WebGL canvas behind the words, the rail's cursor and gauge, the leader lines, the painted posters for reduced motion) is a client island that attaches
// to this markup once the page has painted (LandingFrame). Nothing in this tree reads cookies(), headers(), the query string, the database or the
// network: the route is statically rendered, and csp.ts lists "/" in STATIC_CSP_ROUTES on the strength of that.
//
// The design is docs/design-system/landing.md; the words are lib/landing/content.ts.

export function Landing() {
  return (
    <LandingFrame>
      {/* The scene's canvas is added here by the engine: it cannot exist in the server's HTML. */}
      <div className="stage" aria-hidden="true" />
      <Nav />
      <main id="main-content" tabIndex={-1}>
        <Hero />
        <Who />
        <Community />
        <Opportunities />
        <Events />
        <Apply />
      </main>
      <Footer />
    </LandingFrame>
  );
}
