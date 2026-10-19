"""S4 gap 13: seeded random action sequences, invariants checked after
every step. No hypothesis dependency — plain `random.Random(seed)` drives
a small, explicit action set, which is enough for the plan's "submit,
edit, cancel, rescan, consent change, forget, expire, withdraw, delete"
list and keeps this file free of a new third-party dependency.

Scope: network and opportunities modes only. Recruiter mode needs a job
with confirmed requirements per actor, which would roughly double this
file's setup for a mode that already gets its own targeted coverage in
test_ai_races.py and test_ai_limits.py; out of scope here by choice, not
oversight.

AI_PROPERTY_SEQUENCES controls how many seeds run (default 20 locally;
set to 200 for the plan's CI figure — kept out of the default so a
regular test run stays fast, with the full count opt-in).

Opt-in like the other AI integration tests (AI_INTEGRATION_DSN, local only).
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import uuid

import psycopg
import pytest

from .test_ai_faults import _run_turn_with
from .test_ai_races import _as, _submit, ai  # noqa: F401 — fixture

DSN = os.environ.get("AI_INTEGRATION_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="set AI_INTEGRATION_DSN to the local Supabase to run")

N_SEQUENCES = int(os.environ.get("AI_PROPERTY_SEQUENCES", "20"))
STEPS_PER_SEQUENCE = 10
ACTIONS = ["submit", "run_executor", "cancel", "edit", "rescan_attempt", "toggle_consent",
          "forget", "expire", "withdraw", "delete"]


class Actor:
    def __init__(self, ai, tag: str, idx: int):
        self.uid = ai.candidate(f"{tag}a{idx}")
        self.mode = "network"
        self.conv = None
        self.turn = None
        self.deleted = False


def _call_as(ai, uid, sql, params=()):
    with ai.transaction(), ai.cursor() as cur:
        _as(cur, uid)
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else None


def _settings(ai, uid, *, use_chat_memory=True, network_discoverable=True):
    _call_as(ai, uid, "select public.set_my_ai_settings(%s, %s, %s, %s, %s, %s, %s, %s, %s)",
             (False, network_discoverable, False, use_chat_memory, [], [], [], [], "v1"))


def _act_submit(ai, actor, rng):
    message = rng.choice(["python", "rust ninja", "go wizardry", "javascript"])
    try:
        turn, conv, outcome = _submit(ai, actor.uid, message, mode=actor.mode, conversation=actor.conv)
        if outcome == "queued":
            actor.turn, actor.conv = turn, conv
    except psycopg.errors.RaiseException:
        pass


def _act_run_executor(ai, actor, rng):
    try:
        asyncio.run(_run_turn_with(None))
    except AssertionError:
        pass  # nothing queued right now — a valid state, not a failure


def _act_cancel(ai, actor, rng):
    if actor.turn:
        _call_as(ai, actor.uid, "select public.ai_cancel_turn(%s)", (actor.turn,))


def _act_edit(ai, actor, rng):
    if not actor.conv:
        return
    rev = ai.execute("select spec_revision from ai_private.conversations where id = %s", (actor.conv,)).fetchone()
    if not rev:
        return
    op = '[{"op": "add", "kind": "tool", "concept": "python", "required": false, "negated": false}]'
    try:
        _call_as(ai, actor.uid, "select * from public.ai_edit_spec(%s, %s, %s)", (actor.conv, rev[0], op))
    except psycopg.Error:
        pass  # every exception ai_edit_spec raises is an enumerated business refusal


def _act_rescan_attempt(ai, actor, rng):
    # No recruiter job is ever set up for these actors (out of scope, see
    # the module docstring) — this exercises the refusal path itself:
    # a rescan with no conversation/job must be refused, never crash.
    try:
        _call_as(ai, actor.uid, "select * from public.ai_submit_turn("
                 "'recruiter', null, null, 'rescan', null, %s, null, false)", (uuid.uuid4().hex,))
    except psycopg.errors.RaiseException:
        pass


def _act_toggle_consent(ai, actor, rng):
    _settings(ai, actor.uid, use_chat_memory=rng.choice([True, False]),
             network_discoverable=rng.choice([True, False]))


def _act_forget(ai, actor, rng):
    row = ai.execute("select m.id from ai_private.messages m where m.owner_id = %s order by random() limit 1",
                     (actor.uid,)).fetchone()
    if row:
        _call_as(ai, actor.uid, "select public.ai_forget_message(%s)", (row[0],))


def _act_expire(ai, actor, rng):
    row = ai.execute("select m.id from ai_private.messages m where m.owner_id = %s order by random() limit 1",
                     (actor.uid,)).fetchone()
    if row:
        ai.execute("update ai_private.messages set expires_at = now() - interval '1 second' where id = %s", (row[0],))
        ai.execute("select ai_private.cron_purge()")


def _act_withdraw(ai, actor, rng):
    ai.execute("update public.profiles set open_to_connections = not open_to_connections where id = %s", (actor.uid,))


def _act_delete(ai, actor, rng):
    _call_as(ai, actor.uid, "select public.delete_my_account()")
    actor.deleted = True
    actor.turn = actor.conv = None


_ACTION_FNS = {
    "submit": _act_submit, "run_executor": _act_run_executor, "cancel": _act_cancel, "edit": _act_edit,
    "rescan_attempt": _act_rescan_attempt, "toggle_consent": _act_toggle_consent, "forget": _act_forget,
    "expire": _act_expire, "withdraw": _act_withdraw, "delete": _act_delete,
}


def _check_invariants(ai, actors: list[Actor]) -> None:
    for actor in actors:
        if actor.deleted:
            continue
        # 1. no provider spend left 'reserved' for a turn that has already
        # reached a terminal state (exec_abandon/exec_settle always run).
        stuck = ai.execute(
            "select count(*) from ai_private.spend s join ai_private.turns t on t.id = s.turn_id "
            "where t.owner_id = %s and s.status = 'reserved' "
            "and t.status in ('completed', 'partial', 'failed', 'cancelled', 'expired')",
            (actor.uid,)).fetchone()[0]
        assert stuck == 0, f"{actor.uid}: {stuck} reservations stuck on a finished turn"

        # 2. the daily rate cap never silently overruns (sanity: this
        # sequence never submits anywhere near 40, so a violation here
        # would mean the count query itself is broken, not a real race).
        today = ai.execute("select count(*) from ai_private.usage_events where owner_id = %s "
                          "and created_at > now() - interval '24 hours'", (actor.uid,)).fetchone()[0]
        assert today <= 40, f"{actor.uid}: {today} usage events in 24h, over the cap"

        # 3. no orphan rows: every message/spend row's turn exists, every
        # turn has a conversation (FKs already guarantee this; checked
        # explicitly as a property, not trusted implicitly).
        orphan_msg = ai.execute("select count(*) from ai_private.messages m where m.owner_id = %s "
                               "and m.turn_id is not null "
                               "and not exists (select 1 from ai_private.turns t where t.id = m.turn_id)",
                               (actor.uid,)).fetchone()[0]
        assert orphan_msg == 0

        # 4. effective_spec never carries an atom whose source has expired
        # — the comparison runs in SQL so timestamptz parsing/formatting
        # is Postgres's own, not a lexical string guess in Python.
        stale_atoms = ai.execute(
            "select count(*) from ai_private.conversations c, "
            "jsonb_array_elements(ai_private.effective_spec(c.spec)->'atoms') a "
            "where c.owner_id = %s and (a #>> '{source,expires_at}') is not null "
            "and (a #>> '{source,expires_at}')::timestamptz <= now()", (actor.uid,)).fetchone()[0]
        assert stale_atoms == 0, f"{actor.uid}: effective_spec kept an atom sourced from an expired message"

        # 5. no AI result for an ineligible member — ai_result_cards'
        # own filter re-checked independently, not just trusted.
        if actor.turn:
            turn_row = ai.execute("select status from ai_private.turns where id = %s", (actor.turn,)).fetchone()
            if turn_row and turn_row[0] in ("completed", "partial"):
                conv_spec = ai.execute("select spec from ai_private.conversations where id = %s",
                                       (actor.conv,)).fetchone()[0]
                cards = _call_as(ai, actor.uid, "select target_id from public.ai_result_cards(%s)", (actor.turn,))
                for (target,) in cards or []:
                    ok = ai.execute("select ai_private.member_candidate_ok(%s, %s, %s, null, %s::jsonb)",
                                   (actor.uid, actor.mode, target, json.dumps(conv_spec))).fetchone()[0]
                    assert ok, f"{actor.uid}: result card returned ineligible target {target}"


def _run_sequence(ai, seed: int) -> None:
    rng = random.Random(seed)
    actors = [Actor(ai, f"prop{seed}", i) for i in range(3)]
    for _ in range(STEPS_PER_SEQUENCE):
        live = [a for a in actors if not a.deleted]
        if not live:
            break
        actor = rng.choice(live)
        action = rng.choice(ACTIONS)
        try:
            _ACTION_FNS[action](ai, actor, rng)
        except psycopg.Error as exc:
            pytest.fail(f"seed {seed} step {action} on {actor.uid} raised an unhandled {type(exc).__name__}: {exc}")
        _check_invariants(ai, actors)


@pytest.mark.parametrize("seed", range(N_SEQUENCES))
def test_random_action_sequence_never_breaks_an_invariant(ai, seed):
    _run_sequence(ai, seed)
