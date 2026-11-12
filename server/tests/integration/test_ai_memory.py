"""Vector chat memory (programme S2, AI-plan §5.1, O09).

Keyword memory needs every word of the new message in an old one; the
vector leg finds a paraphrased reference. These run the real executor
(fake provider, whose bag-of-words embedding gives real similarity for
shared words) and the real exec_memory.

Opt-in like the other integration tests (AI_INTEGRATION_DSN, local only).
"""

from __future__ import annotations

import os

import psycopg
import pytest

from app import fake_provider

from .test_ai_integration import _run_executor_once
from .test_ai_races import _as, _claim, _clear_queue, _submit, ai  # noqa: F401  (ai is a fixture)

DSN = os.environ.get("AI_INTEGRATION_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="set AI_INTEGRATION_DSN to the local Supabase to run")

EARLIER = "Looking for a computer vision researcher who uses PyTorch"
LATER = "the computer vision researcher from before"


def _literal(text: str) -> str:
    return "[" + ",".join(repr(x) for x in fake_provider.embed(text)) + "]"


@pytest.fixture()
def remembered(ai):  # noqa: F811
    """A member with one earlier network chat that went through the
    interpreter (so its message was embedded and stored)."""
    ai.execute("alter role ai_service password 'ai_service-local'")
    _clear_queue(ai)
    owner = ai.member(f"mem{os.urandom(3).hex()}")
    turn, conv, outcome = _submit(ai, owner, EARLIER)
    assert outcome == "queued"
    _run_executor_once()
    return owner, conv


def test_the_executor_stores_the_message_vector_on_its_own_row(ai, remembered):  # noqa: F811
    owner, conv = remembered
    row = ai.execute("select embedding is not null, embedding_model from ai_private.messages "
                     "where conversation_id = %s and role = 'member'", (conv,)).fetchone()
    assert row[0], "the interpreted message was not embedded"
    assert row[1]
    cached = ai.execute("select count(*) from ai_private.query_embeddings q "
                        "where q.embedding = (select embedding from ai_private.messages "
                        "where conversation_id = %s and role = 'member')", (conv,)).fetchone()[0]
    assert cached == 0, "a chat message's vector must not land in the shared query cache"


def test_hybrid_memory_finds_a_paraphrase_that_keywords_miss(ai, remembered):  # noqa: F811
    owner, earlier_conv = remembered
    turn, conv, _ = _submit(ai, owner, LATER)
    ctx = _claim(ai)
    keyword_only = ai.execute("select body from ai_private.exec_memory(%s, %s, %s, null)",
                              (turn, ctx["lease"], LATER)).fetchall()
    hybrid = ai.execute("select body from ai_private.exec_memory(%s, %s, %s, %s)",
                        (turn, ctx["lease"], LATER, _literal(LATER))).fetchall()
    assert EARLIER not in [r[0] for r in keyword_only]
    assert EARLIER in [r[0] for r in hybrid]


def test_unrelated_chats_stay_out_of_memory(ai, remembered):  # noqa: F811
    owner, _ = remembered
    text = "chess club on tuesdays"
    turn, conv, _ = _submit(ai, owner, text)
    ctx = _claim(ai)
    rows = ai.execute("select body from ai_private.exec_memory(%s, %s, %s, %s)",
                      (turn, ctx["lease"], text, _literal(text))).fetchall()
    assert EARLIER not in [r[0] for r in rows], "nearest-twelve without a floor would drag this in"


def test_memory_off_returns_nothing_even_with_a_vector(ai, remembered):  # noqa: F811
    owner, _ = remembered
    ai.execute("insert into ai_private.member_settings (member_id, use_chat_memory, consent_version, consent_epoch) "
               "values (%s, false, 'test', 1) on conflict (member_id) do update set use_chat_memory = false", (owner,))
    turn, conv, _ = _submit(ai, owner, LATER)
    ctx = _claim(ai)
    rows = ai.execute("select body from ai_private.exec_memory(%s, %s, %s, %s)",
                      (turn, ctx["lease"], LATER, _literal(LATER))).fetchall()
    assert rows == []


def test_r16_a_message_forgotten_before_its_vector_lands_stays_forgotten(ai):  # noqa: F811
    _clear_queue(ai)
    owner = ai.member(f"r16{os.urandom(3).hex()}")
    turn, conv, _ = _submit(ai, owner, EARLIER)
    ctx = _claim(ai)
    message = ai.execute("select message_id from ai_private.turns where id = %s", (turn,)).fetchone()[0]
    with ai.transaction(), ai.cursor() as cur:
        _as(cur, owner)
        cur.execute("select public.ai_forget_message(%s)", (message,))
    # The executor's write arrives after the forget: nothing to update, no error.
    ai.execute("select ai_private.exec_message_embedding(%s, %s, %s, 'fake-embedding')",
               (turn, ctx["lease"], _literal(EARLIER)))
    assert ai.execute("select count(*) from ai_private.messages where id = %s", (message,)).fetchone()[0] == 0


def test_only_the_executor_can_write_or_read_memory_vectors(ai):  # noqa: F811
    for fn in ("ai_private.exec_message_embedding(uuid, uuid, text, text)",
               "ai_private.exec_memory(uuid, uuid, text, text)"):
        for role in ("anon", "authenticated"):
            assert not ai.execute("select has_function_privilege(%s, %s, 'execute')", (role, fn)).fetchone()[0], (role, fn)
        assert ai.execute("select has_function_privilege('ai_service', %s, 'execute')", (fn,)).fetchone()[0]
