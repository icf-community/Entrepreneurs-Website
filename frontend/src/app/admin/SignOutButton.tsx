"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignOutButton() {
  const router = useRouter();
  const supabase = createClient();
  const [pending, setPending] = useState(false);

  const handleSignOut = async () => {
    if (pending) return;
    setPending(true);
    // supabase.auth.signOut() clears the local session even if the server
    // request fails, so we redirect either way. Log so we can spot
    // recurring server-side failures.
    try {
      const { error } = await supabase.auth.signOut();
      if (error) console.error("Sign out server call failed:", error);
    } catch (e) {
      console.error("Sign out server call failed:", e);
    }
    router.replace("/");
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={pending}
      aria-busy={pending}
      className="text-[0.8rem] bg-white/[0.05] border border-border-strong text-text-primary rounded-lg px-4 py-1.5 cursor-pointer transition-colors duration-150 hover:bg-white/[0.10] hover:border-accent disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
