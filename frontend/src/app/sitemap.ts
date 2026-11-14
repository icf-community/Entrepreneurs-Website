import type { MetadataRoute } from "next";

const SITE_URL = "https://www.imperialentrepreneurs.com";

// Only publicly-reachable routes belong here. Every app route (/community,
// /opportunities, /admin, …) is auth-gated and redirects, so listing them would
// just feed Google soft-404/redirect noise.
export default function sitemap(): MetadataRoute.Sitemap {
  const routes: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
    { path: "/", priority: 1.0, changeFrequency: "weekly" },
    { path: "/login", priority: 0.8, changeFrequency: "monthly" },
    { path: "/ideaforge", priority: 0.8, changeFrequency: "monthly" },
    { path: "/contact", priority: 0.5, changeFrequency: "yearly" },
    { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
    { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
    { path: "/cookies", priority: 0.3, changeFrequency: "yearly" },
  ];
  const lastModified = new Date();
  return routes.map(({ path, priority, changeFrequency }) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
