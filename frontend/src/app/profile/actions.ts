"use server";

import { revalidatePath } from "next/cache";
import { getActionAuth } from "@/lib/auth/actionAuth";
import { invalidate } from "@/lib/cache";
import { check } from "@/lib/ratelimit";

// ProfileForm and OnboardingForm call update_profile / submit_onboarding
// straight from the browser, so no server action runs on that write and
// nothing gets the chance to drop the cached directory. Without this the
// member would edit their profile, land on /community, and see their old
// details until the 60s TTL expired — precisely the kind of staleness a
// TTL alone is a poor answer to.
//
// Routing those two writes through server actions is the real fix and is
// part of the backend migration; until then the form calls this on
// success.
//
// It takes no input and its only effect is to make the next directory read go to
// Postgres, which is why it is for approved members only and rate limited.
export async function invalidateDirectoryCache(): Promise<void> {
  const { user, isAdmin, status } = await getActionAuth();
  if (!user) return;
  // Every directory read after this goes to Postgres, so it is not for pending or rejected
  // accounts, and one account cannot loop it to keep the cache permanently cold.
  if (!isAdmin && status !== "approved") return;
  if ((await check("directoryRefresh", user.id)) === "limited") return;

  await invalidate("directoryFacets");
  revalidatePath("/members");
}
