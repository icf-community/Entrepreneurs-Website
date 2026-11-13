"use client";

import Link from "next/link";
import { useState } from "react";
import { Notice } from "@/components/ui/Notice";

// Shown on a listing page after a successful submission (?submitted=1).
// The new listing is `pending` and so isn't on the public list yet —
// this reassures the poster and points them to /my-submissions.
// A success Notice with its own dismiss control.
export default function SubmittedBanner({ kind }: { kind: string }) {
  const [show, setShow] = useState(true);
  if (!show) return null;

  return (
    <Notice tone="success" onDismiss={() => setShow(false)} className="mb-6">
      Thanks — your {kind} was submitted and is now in review. It&apos;ll appear publicly once an admin approves it. Track it under{" "}
      <Link href="/my-submissions">your submissions</Link>.
    </Notice>
  );
}
