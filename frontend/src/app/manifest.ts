import type { MetadataRoute } from "next";

// Gives "Add to Home Screen" a real icon/name/theme colour on iOS/Android
// instead of falling back to a screenshot of the page. themeColor matches
// layout.tsx's <Viewport> so the installed app and the browser tab agree.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Imperial Entrepreneurs — Foundry",
    short_name: "Foundry",
    description:
      "Foundry is the founder community for Imperial College London students and alumni — student founders, alumni, mentors, and investors.",
    start_url: "/",
    display: "standalone",
    background_color: "#08080a",
    theme_color: "#08080a",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
