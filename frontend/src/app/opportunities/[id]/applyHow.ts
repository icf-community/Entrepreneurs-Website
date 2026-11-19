import type { Opportunity } from "@/lib/data/opportunities";

// How a reader applies to a role: through the poster's own portal, by emailing
// the poster, or (when the poster gave neither) by finding them on LinkedIn.
//
// Its own module, not a function in OpportunityActions, because the page (a
// server component) needs the answer too: the portal or the email is the page's
// lit button, which sits in the masthead, and with neither there is no button, so
// the page must not ask PageHead for an empty actions row.

export type ApplyHow =
  | { how: "portal"; url: string }
  | { how: "email"; email: string }
  | { how: "linkedin" };

export function applyHow(o: Pick<Opportunity, "applyMethod" | "applyUrl" | "contactEmail">): ApplyHow {
  if (o.applyMethod === "link" && o.applyUrl) return { how: "portal", url: o.applyUrl };
  if (o.contactEmail) return { how: "email", email: o.contactEmail };
  return { how: "linkedin" };
}
