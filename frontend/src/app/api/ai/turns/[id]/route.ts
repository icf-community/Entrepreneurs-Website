import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/auth/currentUser";
import { check } from "@/lib/ratelimit";
import type { TurnStatusResponse } from "@/lib/ai/types";

// ════════════════════════════════════════════════════════════════════
// Foundry AI · turn status, for the browser's poller (AI-plan §9, §10.1)
//
// A same-origin GET the client polls with one request in flight, backing
// off 1 s → 2 s → 4 s and pausing on hidden tabs. The response carries no
// candidate data, only lifecycle state; results are fetched once, after
// the turn finishes, through the result-card RPC that re-authorises them.
//
// Conditional: the turn's revision is the ETag, so an unchanged poll is a
// 304 with no body. Private and no-store: a turn id is only ever the
// caller's own (ai_turn_status filters on auth.uid()), and nothing here
// may be cached by a CDN or shared browser cache.
// ════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404, headers: HEADERS });

  const supabase = await createClient();
  const { user } = await currentUser(supabase);
  if (!user) return NextResponse.json({ error: "unauthorised" }, { status: 401, headers: HEADERS });

  if ((await check("aiRead", user.id)) === "limited") {
    return NextResponse.json({ error: "limited" }, { status: 429, headers: { ...HEADERS, "Retry-After": "10" } });
  }

  const { data, error } = await supabase.rpc("ai_turn_status", { p_turn: id });
  if (error) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: HEADERS });
  const row = data?.[0];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404, headers: HEADERS });

  const etag = `"${row.revision}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ...HEADERS, ETag: etag } });
  }
  const body: TurnStatusResponse = {
    status: row.status as TurnStatusResponse["status"],
    stage: (row.stage as TurnStatusResponse["stage"]) ?? null,
    outcome: row.outcome ?? null,
    revision: row.revision,
    conversationId: row.conversation_id,
    resultCount: row.result_count,
    finished: row.finished,
  };
  return NextResponse.json(body, { headers: { ...HEADERS, ETag: etag } });
}
