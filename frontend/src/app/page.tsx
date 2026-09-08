import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import WhoWeAre from "@/components/WhoWeAre";
import Community from "@/components/Community";
import Opportunities from "@/components/Opportunities";
import Events from "@/components/Events";
import Apply from "@/components/Apply";
import Footer from "@/components/Footer";
import { structuredData, serialiseJsonLd } from "@/lib/structuredData";

// Statically rendered, and it must stay that way — this is the app's
// most-requested route and C2 Finding 6 measured it as the slowest, at
// 12.3 s p95 under 500 VUs, entirely render cost against zero data
// access. Nothing in this tree may read cookies(), headers() or the
// database: any one of those silently turns the page dynamic again and
// gives the cost straight back. "/" is on csp.ts's STATIC_CSP_ROUTES,
// which is what lets the JSON-LD below render without a nonce.
export default function Home() {
  return (
    <main id="main-content" tabIndex={-1} style={{ position: "relative", zIndex: 1 }}>
      {/* Site-level schema, moved here from the root layout. No nonce and
          no suppressHydrationWarning needed: the page is static, so the
          markup the browser receives is the markup React rendered.
          serialiseJsonLd escapes `<` so a string in the graph can never
          close this tag early — see its doc comment for why that is the
          real hazard here rather than the value itself. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serialiseJsonLd(structuredData) }}
      />
      <Navbar />
      <Hero />
      <WhoWeAre />
      <Community />
      <Opportunities />
      <Events />
      <Apply />
      <Footer />
    </main>
  );
}