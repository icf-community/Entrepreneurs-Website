"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/design-system/icons/Icon";
import { createClient } from "@/lib/supabase/client";

// `rail` draws it as the last row of the signed-in rail (a mark and a label, like every row above it; the label is only drawn away when
// the rail is collapsed, so the name stays). The default is a button, for the headers of the pages that have no rail.
export default function SignOutButton({ variant = "button" }: { variant?: "button" | "rail" }) {
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

  if (variant === "rail") {
    return (
      <button
        type="button"
        onClick={handleSignOut}
        disabled={pending}
        aria-busy={pending}
        title="Sign out"
        className="lm-navitem disabled:cursor-wait disabled:opacity-60"
      >
        <span className="lm-navitem__mark">
          <Icon name="sign-out" size={18} />
        </span>
        <span className="lm-navitem__label">{pending ? "Signing out…" : "Sign out"}</span>
      </button>
    );
  }

  return (
    <Button type="button" variant="ghost" size="sm" onClick={handleSignOut} loading={pending}>
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
