"""Foundry · Phase 2 matching agent — NOT IMPLEMENTED YET.

This file is deliberately a stub with a docstring and nothing else. The
constraints below were written while it was still empty, because they are
cheap now and expensive once there is a working agent to retrofit them
onto.

Read this before writing a single tool.

═══════════════════════════════════════════════════════════════════════
THE CONNECTION GRAPH: YOU MAY USE IT. YOU MAY NOT CITE IT.
═══════════════════════════════════════════════════════════════════════

`public.connections` holds every relationship in the community. It is
private by construction — RLS is default-deny with no policies, and every
read goes through a SECURITY DEFINER function that scopes to one caller's
own edges.

This agent may legitimately *use* the graph as a ranking signal. It must
never *cite* it as a reason.

    ALLOWED:  ranking Priya above Tom partly because the graph says she
              is better connected to the asker's area.
    FORBIDDEN: "Priya is connected to your connection Sam."

The second sentence discloses the Sam–Priya edge as surely as drawing it
on a screen. Sam and Priya each agreed to share an email address with the
ASKER; neither agreed to have their relationship with each other
described to anybody. The graph view in the web app renders an ego
network only, for exactly this reason (docs/compliance/07-dpia-screening.md,
the Connections screening), and an agent that explains its ranking in
terms of other people's edges would reopen by inference what the UI
closed by design.

The same reasoning forbids a mutual-connection COUNT. "You have 3 mutual
connections with Priya" is a disclosure about three people who are not
in the conversation, and at this community's size a count of 1 is an
identification. No count, no names, no "people you both know".

═══════════════════════════════════════════════════════════════════════
CONCRETE RULES FOR WHOEVER IMPLEMENTS THIS
═══════════════════════════════════════════════════════════════════════

1. NO TOOL RETURNS AN EDGE THE ASKER IS NOT A PARTY TO. If a ranking
   tool needs graph structure, it returns an opaque SCORE, never the
   edges the score was computed from. A tool whose output the model can
   quote is a tool whose output the model will quote.

2. NO TOOL RETURNS AN EMAIL ADDRESS. Ever. The address is released by
   the connection handshake, in the app, with consent recorded on the
   row — not by an assistant summarising a profile. If a member wants
   someone's address, the answer is "send them a connection request",
   which the agent may say and may link to.

3. THE MODEL NEVER SEES RAW EDGES. Keeping edges out of the context
   window is the only reliable version of rule 1: a model cannot leak
   what it was not given, and no amount of prompt instruction is as
   strong as absence.

4. RE-CHECK APPROVAL AT READ TIME. A banned member (status='rejected')
   holds a valid GoTrue JWT for up to an hour. Gate on
   `is_approved() or is_admin()`, never on `auth.uid() is not null` —
   the same rule every RPC in supabase/migrations/20260917000002-4
   follows.

5. HARD-CAP EVERY LLM PATH. Three layers, per the standing rule for this
   codebase. Campus NAT means an IP bucket is a campus bucket, so per-IP
   limits alone are not a limit.

6. IF A CHANGE HERE WOULD MAKE ANY OF THE ABOVE UNTRUE, the DPIA
   screening has to be re-run first — it lists "the Phase 2 agent is
   permitted to cite the graph as a reason for a recommendation" as an
   explicit re-run trigger.

═══════════════════════════════════════════════════════════════════════
WHAT THE AGENT IS ACTUALLY FOR (context, not a spec)
═══════════════════════════════════════════════════════════════════════

Natural-language discovery over the member directory and the opportunity
listings, replacing the chip filters for questions those cannot express.
Opportunity matching needs PARTIAL CREDIT on adjacent skills — PyTorch
against Keras is a near match, not a miss — rather than exact category
equality.

The five read tools this was sketched against do not exist yet, and
neither do the `postings` / `searches` / `contact_events` tables.
"""
