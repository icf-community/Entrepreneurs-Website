import type { Metadata } from "next";

// page.tsx is a client component ("use client", for its interactive
// sign-in state) — Next.js only reads a `metadata` export from a Server
// Component, so it lives here instead.
export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in or join Foundry, the founder community for Imperial College London students and alumni.",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
