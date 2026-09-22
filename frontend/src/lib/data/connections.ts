import "server-only";
import { rows, maybeRow, type Db } from "./query";
import {
  toDirectoryMember,
  withAvatarUrls,
  filterArgs,
  EMPTY_FACETS,
  type Facets,
  type MemberFilters,
  type DirectoryMember,
} from "./directory";

// ════════════════════════════════════════════════════════════════════
// Foundry · The connections read path
//
// Three lists that all render member cards, so all three reuse the
// directory's card mapper and its one-round avatar signer rather than
// growing a parallel set. What each adds on top is small and specific:
//
//   connections — the email address, which is the entire point
//   pending     — the requester's note
//   sent        — neither (a request you sent discloses nothing)
//
// KEYSET, NOT OFFSET. A well-connected member is exactly the person who
// scrolls, and OFFSET degrades linearly on deep pages. The cursor is
// `(sort key, id)`; the id is not decoration — a cursor on a non-unique
// timestamp either skips rows or repeats them.
//
// EMAIL IS NEVER SNAPSHOT. list_my_connections joins auth.users live, so
// a member who changes their login address does not leave a stale one in
// anybody's list. Nothing in this file caches a row that contains one.
// ════════════════════════════════════════════════════════════════════

/** One screen of cards, matching the directory's page size. */
export const CONNECTIONS_PAGE_SIZE = 48;

/**
 * The cursor, as it travels to the client and back.
 *
 * Opaque on purpose — base64 of the two values, the same shape
 * lib/data/posts.ts uses. Not for secrecy (it is a timestamp and a uuid
 * the caller can already see) but so the client cannot construct one:
 * a hand-built cursor is a way to ask for a page the server never
 * offered, and decoding defensively means a malformed one is "start at
 * the top", never an error.
 */
export type ConnectionCursor = { at: string; id: string };

export function encodeCursor(c: ConnectionCursor): string {
  return Buffer.from(`${c.at}|${c.id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: string | undefined): ConnectionCursor | null {
  if (!raw) return null;
  try {
    const [at, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    if (!at || !id) return null;
    if (Number.isNaN(Date.parse(at))) return null;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { at, id };
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// Your connections
// ────────────────────────────────────────────────────────────────────

/**
 * A connection: a member card, plus the two things that only exist
 * because you are connected — the address, and the row id every action
 * (remove, report) is addressed to.
 */
export type Connection = DirectoryMember & {
  connectionId: string;
  connectedAt: string;
  email: string | null;
};

export type ConnectionsPage = {
  connections: Connection[];
  nextCursor: string | null;
  /** Present on the first page only — the windowed count is what it costs. */
  total: number | null;
};

export async function myConnectionsPage(
  db: Db,
  filters: MemberFilters,
  cursor: ConnectionCursor | null,
): Promise<ConnectionsPage> {
  const data = await rows("list_my_connections", () =>
    db.rpc("list_my_connections", {
      ...filterArgs(filters),
      p_limit: CONNECTIONS_PAGE_SIZE,
      p_cursor_decided_at: cursor?.at,
      p_cursor_id: cursor?.id,
    }));

  const cards = await withAvatarUrls(
    data.map((r) => ({
      ...toDirectoryMember({ ...r, created_at: r.connected_at }, []),
      connectionId: r.connection_id,
      connectedAt: r.connected_at,
      email: r.email,
    })),
  );

  const last = data[data.length - 1];
  return {
    connections: cards,
    // A full page implies there may be more; a short one is the end. One
    // wasted request at an exact multiple of the page size beats a count
    // on every scroll.
    nextCursor:
      data.length === CONNECTIONS_PAGE_SIZE && last
        ? encodeCursor({ at: last.connected_at, id: last.connection_id })
        : null,
    total: cursor ? null : (data[0]?.total_count ?? 0),
  };
}

// ────────────────────────────────────────────────────────────────────
// Requests, incoming and outgoing
// ────────────────────────────────────────────────────────────────────

/** An incoming request: a card, the request id, and their note. */
export type PendingRequest = DirectoryMember & {
  connectionId: string;
  requestedAt: string;
  note: string | null;
};

/** An outgoing one. No note back, no address, nothing to disclose. */
export type SentRequest = DirectoryMember & {
  connectionId: string;
  requestedAt: string;
};

export type RequestsPage<T> = {
  requests: T[];
  nextCursor: string | null;
  total: number | null;
};

export async function myPendingRequestsPage(
  db: Db,
  cursor: ConnectionCursor | null,
): Promise<RequestsPage<PendingRequest>> {
  const data = await rows("list_my_pending_requests", () =>
    db.rpc("list_my_pending_requests", {
      p_limit: CONNECTIONS_PAGE_SIZE,
      p_cursor_created_at: cursor?.at,
      p_cursor_id: cursor?.id,
    }));

  const cards = await withAvatarUrls(
    data.map((r) => ({
      ...toDirectoryMember({ ...r, created_at: r.requested_at }, []),
      connectionId: r.connection_id,
      requestedAt: r.requested_at,
      note: r.note,
    })),
  );

  const last = data[data.length - 1];
  return {
    requests: cards,
    nextCursor:
      data.length === CONNECTIONS_PAGE_SIZE && last
        ? encodeCursor({ at: last.requested_at, id: last.connection_id })
        : null,
    total: cursor ? null : (data[0]?.total_count ?? 0),
  };
}

export async function mySentRequestsPage(
  db: Db,
  cursor: ConnectionCursor | null,
): Promise<RequestsPage<SentRequest>> {
  const data = await rows("list_my_sent_requests", () =>
    db.rpc("list_my_sent_requests", {
      p_limit: CONNECTIONS_PAGE_SIZE,
      p_cursor_created_at: cursor?.at,
      p_cursor_id: cursor?.id,
    }));

  // The sent list is deliberately thinner than the others: the RPC returns
  // no bio, no skills, no sectors and no note. You already know what you
  // wrote and who you wrote to; the row exists so you can withdraw it.
  // The card shape is still the directory's, with those fields empty, so
  // one MemberCard renders all three tabs rather than three near-copies.
  const cards = await withAvatarUrls(
    data.map((r) => ({
      ...toDirectoryMember(
        {
          ...r,
          created_at: r.requested_at,
          bio_focus: null,
          bio_hobbies: null,
          skill_names: null,
          sector_names: null,
        },
        [],
      ),
      connectionId: r.connection_id,
      requestedAt: r.requested_at,
    })),
  );

  const last = data[data.length - 1];
  return {
    requests: cards,
    nextCursor:
      data.length === CONNECTIONS_PAGE_SIZE && last
        ? encodeCursor({ at: last.requested_at, id: last.connection_id })
        : null,
    total: cursor ? null : (data[0]?.total_count ?? 0),
  };
}

// ────────────────────────────────────────────────────────────────────
// Facets, badge, settings, graph
// ────────────────────────────────────────────────────────────────────

/**
 * The filter chips, scoped to the caller's own edges.
 *
 * NOT cached, unlike directoryFacets: this one is per-member by
 * definition, so a shared cache entry would be a cross-member disclosure
 * rather than a saving.
 *
 * It is also the heaviest thing on the page — linear in your degree, ~17ms
 * at a realistic 100 connections (see the C3 benchmark). Worth knowing if
 * the page ever needs trimming: the panel could fetch it on open.
 */
export async function myConnectionFacets(db: Db): Promise<Facets> {
  const data = await rows("list_my_connection_facets", () =>
    db.rpc("list_my_connection_facets"));
  return data[0] ?? EMPTY_FACETS;
}

/**
 * The sidebar badge. Renders on every authenticated page, so it is an
 * index-only scan on the partial pending index and nothing more.
 *
 * Deliberately NOT cached in Redis: a round trip costs more than the scan
 * and would spend the shared 500K/month Upstash budget on every page view.
 *
 * Degrades to 0, never to an error — this number decorates the shell, and
 * a failed count must not take down every authenticated page with it.
 */
export async function myPendingConnectionCount(db: Db): Promise<number> {
  const n = await maybeRow("my_pending_connection_count", () =>
    db.rpc("my_pending_connection_count"));
  return typeof n === "number" ? n : 0;
}

export type ConnectionSettings = {
  connection_emails_enabled: boolean;
  open_to_connections: boolean;
};

export async function myConnectionSettings(db: Db): Promise<ConnectionSettings> {
  const data = await rows("my_connection_settings", () => db.rpc("my_connection_settings"));
  // Both columns are `not null default true`, so the defaults here are the
  // column defaults, not a guess — they only apply if the read failed.
  return data[0] ?? { connection_emails_enabled: true, open_to_connections: true };
}

/** The consent wording's version, stamped on the row the member agrees to. */
export async function consentVersion(db: Db): Promise<string> {
  const v = await maybeRow("connection_consent_version", () =>
    db.rpc("connection_consent_version"));
  return typeof v === "string" ? v : "";
}

// ────────────────────────────────────────────────────────────────────
// The graph payload
// ────────────────────────────────────────────────────────────────────

/**
 * Your ego network: you at the centre, your own connections around you.
 *
 * NODES ONLY — no edges, because the only edges drawn are yours, and the
 * client can derive those from the node list. A connection-to-connection
 * edge is stored but never returned: those two consented to share an
 * address with *you*, not to have their own relationships shown to you.
 *
 * NO EMAIL ADDRESSES, ever. The payload is a layout input; addresses live
 * on the card and detail surfaces where they are actually used.
 */
export type GraphNode = {
  id: string;
  firstName: string;
  surname: string;
  role: string;
  course: string | null;
  gradYear: number | null;
  avatarPath: string | null;
  connectedAt: string;
  skills: string[];
  sectors: string[];
};

export type ConnectionGraph = {
  nodes: GraphNode[];
  /** Everyone matching the filters, including nodes beyond the 500 the RPC plots. */
  total: number;
};

/**
 * The graph takes the SAME filters as the card view, and shares the
 * predicate in SQL rather than re-implementing it here (20260917000010).
 *
 * The chip filters could have been applied to the payload in the
 * browser; the free-text search could not, because `list_my_connections`
 * matches `q` against bio and working-on text that this payload
 * deliberately does not carry. A browser-side filter would have agreed
 * on every chip and disagreed on every search — a divergence that shows
 * up only for some inputs, which is the kind nobody trusts a test for.
 */
export async function myConnectionGraph(
  db: Db,
  filters: MemberFilters,
): Promise<ConnectionGraph> {
  const data = await rows("list_my_connection_graph", () =>
    db.rpc("list_my_connection_graph", filterArgs(filters)));

  return {
    nodes: data.map((r) => ({
      id: r.id,
      firstName: r.first_name,
      surname: r.surname,
      role: r.role,
      course: r.course,
      gradYear: r.grad_year,
      avatarPath: r.avatar_path,
      connectedAt: r.connected_at,
      skills: r.skill_names ?? [],
      sectors: r.sector_names ?? [],
    })),
    total: data[0]?.total_count ?? 0,
  };
}
