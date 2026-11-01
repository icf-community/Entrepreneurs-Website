import baseTeardown from "../global-teardown";
import { service } from "./helpers";

// The adversarial specs create throwaway members (adv-*) and not every test
// deletes its own. Left behind they pile up in the local auth table, which
// is what once pushed the seeded e2e users off the first page of
// listUsers and broke global-setup. Remove them when a run finishes.
export default async function teardown(): Promise<void> {
  baseTeardown();
  const db = service();
  for (let sweep = 0; sweep < 20; sweep++) {
    const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) return;
    const mine = data.users.filter((u) => u.email?.startsWith("adv-"));
    if (mine.length === 0) return;
    await Promise.all(mine.map((u) => db.auth.admin.deleteUser(u.id).catch(() => undefined)));
  }
}
