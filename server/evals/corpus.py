"""Retrieval corpus generator and benchmark (S5 gap 5).

python -m evals retrieval --dsn postgresql://postgres:postgres@127.0.0.1:54322/postgres --size 2k

Builds a synthetic corpus of N members (plus jobs for opportunities
mode) directly in the local Supabase, with 36 real queries (12 per
mode) each carrying its own planted, graded set — generated, never
hand-placed, since hand-placing is infeasible at 10k. Every query runs
as a real turn: `ai_submit_turn` -> the real executor (`run_turn`,
fake provider) -> `ai_result_cards`, the same path a member actually
hits. Gates: recall@200 >= .95 per mode, nDCG@10 >= .80, zero
ineligible results, no grade-3 must-have match lost.

**Scope decision, not oversight**: the plan's four ablations
(lexical-only/exact-only/broad-only/full) are not implemented. They
would need a way to disable individual legs of `exec_retrieve`'s SQL,
which has no such parameter today — building one (even eval-only) risks
accidentally changing production retrieval behaviour, which is a much
bigger change than this corpus generator should make unreviewed. The
full hybrid pipeline is exercised and gated; ablations are left for a
follow-up that first adds a retrieval-leg toggle to exec_retrieve
itself, reviewed on its own.

Fair-exposure slices (newcomers, no-CV, students vs graduates) are also
not broken out as separate reported metrics — the planted members
already vary along these axes (background members have no CV, askers
vary in enrolled/graduated status), but the report doesn't currently
group recall/nDCG by them. Left for a follow-up: it's an additional
aggregation over data this generator already produces, not new seeding.
Paired-bootstrap confidence intervals on nDCG@10 (eval §7) are likewise
not computed — only the point estimate — for the same reason: an
addition to the existing report, not a redesign.

Member/job seeding is batched (one multi-row INSERT/UPDATE per table
for the whole corpus); promotion (`build_member_docs`/
`process_refresh_job_ai`-equivalent + one `worker_put_*_docs` RPC) is
necessarily one call per row — there is no bulk path in the codebase
(checked: no COPY/execute_values/executemany usage anywhere).

Cleanup: every seeded id is tracked and deleted via `auth.users`
cascade (members) / direct delete (jobs), and queued AI jobs are
cleared, exactly like test_ai_integration.py's `_cleanup`. A corpus run
is also only ever pointed at a local DSN — `fake_provider`'s own
`assert_local()` guard refuses anything else.
"""

from __future__ import annotations

import json
import math
import os
import random
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

CV_WORKER_PASSWORD = "cv_worker-local"
AI_SERVICE_PASSWORD = "ai_service-local"

# ─── sizing ──────────────────────────────────────────────────────────
GRADE3, GRADE2, GRADE1, HARD_NEG, INELIGIBLE = 5, 5, 5, 8, 6
PER_QUERY = GRADE3 + GRADE2 + GRADE1 + HARD_NEG + INELIGIBLE  # 29

# 12 queries per mode. Each target concept set is drawn from the frozen
# dictionary and confirmed (elsewhere, see evals/authoring/benign.py's
# own verification habit) to be a real, non-ambiguous concept.
#
# Every query carries exactly 2 concepts, not 1: grade3 members/jobs have
# both (full coverage, "meets"), grade2 only the first (partial coverage,
# a real — not tied — lower score). A single-concept criterion is binary
# (met or not); there is no such thing as "half of one concept" for
# concept_state to score, so a single concept can never produce a
# genuine grade2 (confirmed empirically: with only 1 target concept,
# grade2's identical-looking evidence scored identically to grade3 —
# tied at coverage=1.0 — and which 10 of a larger tied set got published
# became arbitrary SQL tie-break order, not a real relevance signal).
QUERIES = {
    "network": [
        ("net-q01", "Python and NumPy", ["python", "numpy"]),
        ("net-q02", "deep learning and PyTorch", ["deep-learning", "pytorch"]),
        ("net-q03", "chess and climbing", ["chess", "climbing"]),
        ("net-q04", "Figma and Blender", ["figma", "blender"]),
        ("net-q05", "Docker and Kubernetes", ["docker", "kubernetes"]),
        ("net-q06", "AWS and GCP", ["aws", "gcp"]),
        ("net-q07", "climbing and hiking", ["climbing", "hiking"]),
        ("net-q08", "SQL and PostgreSQL", ["sql", "postgresql"]),
        ("net-q09", "React and TypeScript", ["react", "typescript"]),
        ("net-q10", "Blender and 3D printing", ["blender", "3d-printing"]),
        ("net-q11", "biochemistry and pharmacology", ["biochemistry", "pharmacology"]),
        ("net-q12", "robotics hardware and robotics software", ["robotics-hardware", "robotics-software"]),
    ],
    "recruiter": [
        ("rec-q01", "must have PyTorch and NumPy", ["pytorch", "numpy"]),
        ("rec-q02", "must have Django and PostgreSQL", ["django", "postgresql"]),
        ("rec-q03", "must have Excel and Power BI", ["excel", "power-bi"]),
        ("rec-q04", "must have Figma and UI design", ["figma", "ui-design"]),
        ("rec-q05", "must have Terraform and AWS", ["terraform", "aws"]),
        ("rec-q06", "must have Tableau and Power BI", ["tableau", "power-bi"]),
        ("rec-q07", "must have TensorFlow and Keras", ["tensorflow", "keras"]),
        ("rec-q08", "must have AutoCAD and SolidWorks", ["autocad", "solidworks"]),
        ("rec-q09", "must have Salesforce and HubSpot", ["salesforce", "hubspot"]),
        ("rec-q10", "must have Kafka and Airflow", ["kafka", "airflow"]),
        ("rec-q11", "must have Spring Boot and PostgreSQL", ["spring-boot", "postgresql"]),
        ("rec-q12", "must have MongoDB and Redis", ["mongodb", "redis"]),
    ],
    "opportunities": [
        ("opp-q01", "pytorch and numpy", ["pytorch", "numpy"]),
        ("opp-q02", "django and postgresql", ["django", "postgresql"]),
        ("opp-q03", "excel and power bi", ["excel", "power-bi"]),
        ("opp-q04", "figma and ui design", ["figma", "ui-design"]),
        ("opp-q05", "terraform and aws", ["terraform", "aws"]),
        ("opp-q06", "tableau and power bi", ["tableau", "power-bi"]),
        ("opp-q07", "tensorflow and keras", ["tensorflow", "keras"]),
        ("opp-q08", "autocad and solidworks", ["autocad", "solidworks"]),
        ("opp-q09", "salesforce and hubspot", ["salesforce", "hubspot"]),
        ("opp-q10", "kafka and airflow", ["kafka", "airflow"]),
        ("opp-q11", "spring boot and postgresql", ["spring-boot", "postgresql"]),
        ("opp-q12", "mongodb and redis", ["mongodb", "redis"]),
    ],
}

BACKGROUND_CONCEPTS = ["cooking", "astronomy", "boxing", "rowing", "swimming", "guitar", "photography",
                       "piano", "travel", "yoga", "basketball", "cricket"]


def _dsn_for(dsn: str, role: str, password: str) -> str:
    params = psycopg.conninfo.conninfo_to_dict(dsn)
    params.update(user=role, password=password, sslmode="disable")
    return psycopg.conninfo.make_conninfo(**params)


def _sql(conn, query: str, params: tuple = ()):
    with conn.cursor() as cur:
        cur.execute(query, params)
        return cur.fetchall() if cur.description else None


def _batch(rows: list, size: int = 500):
    for i in range(0, len(rows), size):
        yield rows[i:i + size]


@dataclass
class PlantedMember:
    key: str
    query_id: str
    mode: str
    grade: str  # grade3 | grade2 | grade1 | hard_negative | ineligible | background
    skills_raw: list[str] = field(default_factory=list)
    bio_hobbies: str = ""
    recruiter: bool = True
    network: bool = True
    is_committee: bool = False
    blocked: bool = False  # blocked against this member's own query's asker


def _member_specs(rng: random.Random, size: int) -> list[PlantedMember]:
    specs: list[PlantedMember] = []
    for mode in ("network", "recruiter"):
        for qid, _msg, concepts in QUERIES[mode]:
            labels = [c.replace("-", " ") for c in concepts]
            both, first = " and ".join(labels), labels[0]
            for i in range(GRADE3):
                specs.append(PlantedMember(f"{qid}-g3-{i}", qid, mode, "grade3",
                            skills_raw=concepts, bio_hobbies=f"I work extensively with {both}."))
            for i in range(GRADE2):
                # Only the FIRST of the 2 target concepts — real partial
                # coverage (half the criteria met), not a tied duplicate of
                # grade3 (a single concept is binary: met or not, so this
                # only works when every query carries >=2 concepts).
                specs.append(PlantedMember(f"{qid}-g2-{i}", qid, mode, "grade2",
                            skills_raw=concepts[:1], bio_hobbies=f"Some exposure to {first}."))
            for i in range(GRADE1):
                specs.append(PlantedMember(f"{qid}-g1-{i}", qid, mode, "grade1",
                            bio_hobbies=f"Curious about {first} but no direct experience."))
            for i in range(HARD_NEG):
                # Mentions a target concept, but never as positive evidence —
                # a naive lexical match would wrongly surface these.
                polarity_phrase = rng.choice([f"doesn't use {both}", f"wants to learn {both} one day",
                                             f"avoided {both} on purpose"])
                specs.append(PlantedMember(f"{qid}-hn-{i}", qid, mode, "hard_negative",
                            bio_hobbies=polarity_phrase))
            for i in range(INELIGIBLE):
                kind = ["blocked", "not_discoverable", "committee", "not_discoverable", "blocked", "committee"][i]
                m = PlantedMember(f"{qid}-in-{i}", qid, mode, "ineligible",
                                  skills_raw=concepts, bio_hobbies=f"I work extensively with {both}.",
                                  is_committee=(kind == "committee"),
                                  recruiter=(kind != "not_discoverable"), network=(kind != "not_discoverable"))
                if kind == "blocked":
                    m.blocked = True
                specs.append(m)
    designed = len(specs)
    background_needed = max(1, size - designed)  # at least one asker identity always exists
    for i in range(background_needed):
        concept = rng.choice(BACKGROUND_CONCEPTS)
        specs.append(PlantedMember(f"bg-{i}", "", "background", "background",
                    bio_hobbies=f"Into {concept.replace('-', ' ')} mostly."))
    return specs


@dataclass
class PlantedJob:
    key: str
    query_id: str
    grade: str
    description: str
    eligible_audience: str = "both"
    status: str = "approved"
    creation_source: str = "admin"


def _job_specs(rng: random.Random, size: int) -> list[PlantedJob]:
    specs: list[PlantedJob] = []
    for qid, _msg, concepts in QUERIES["opportunities"]:
        labels = [c.replace("-", " ") for c in concepts]
        both, first = " and ".join(labels), labels[0]
        for i in range(GRADE3):
            specs.append(PlantedJob(f"{qid}-g3-{i}", qid, "grade3",
                        f"We need someone who has shipped real projects with {both}. You must know {both}."))
        for i in range(GRADE2):
            specs.append(PlantedJob(f"{qid}-g2-{i}", qid, "grade2", f"Some familiarity with {first} is useful."))
        for i in range(GRADE1):
            specs.append(PlantedJob(f"{qid}-g1-{i}", qid, "grade1", f"Exposure to tools similar to {first}."))
        for i in range(HARD_NEG):
            specs.append(PlantedJob(f"{qid}-hn-{i}", qid, "hard_negative",
                        f"No {both} experience needed — we will train you from scratch."))
        for i in range(INELIGIBLE):
            specs.append(PlantedJob(f"{qid}-in-{i}", qid, "ineligible",
                        f"We need someone who has shipped real projects with {both}. You must know {both}.",
                        eligible_audience="graduates"))
    designed = len(specs)
    background_needed = max(0, (size // 10) - designed)
    for i in range(background_needed):
        concept = rng.choice(BACKGROUND_CONCEPTS)
        specs.append(PlantedJob(f"bg-job-{i}", "", "background",
                    f"General role, some interest in {concept.replace('-', ' ')} a plus."))
    return specs


# ─── seeding ─────────────────────────────────────────────────────────
def seed(conn, specs: list[PlantedMember], tag: str) -> dict[str, uuid.UUID]:
    ids = {s.key: uuid.uuid4() for s in specs}
    user_rows = [(ids[s.key], f"corpus-{tag}-{s.key}@imperial.ac.uk",
                 Jsonb({"first_name": "Member", "surname": s.key, "role": "student", "grad_year": 2028}))
                for s in specs]
    for batch in _batch(user_rows):
        values_sql = ", ".join(["(%s, %s, %s, '{\"provider\":\"email\"}', '', '', '', '', 'authenticated', "
                                "'authenticated')"] * len(batch))
        params = [p for r in batch for p in (r[0], r[1], r[2])]
        _sql(conn, f"""
            insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, confirmation_token,
                                    recovery_token, email_change_token_new, email_change, aud, role)
            values {values_sql}
        """, tuple(params))

    with conn.transaction():
        _sql(conn, "select set_config('foundry.onboarding_submission', 'true', true)")
        for batch in _batch(specs):
            values_sql = ", ".join(["(%s, %s, %s, %s, %s)"] * len(batch))
            params = [p for s in batch for p in (ids[s.key], s.grade != "background", "Computing",
                     f"Working on {s.key}" if s.bio_hobbies else None, s.is_committee)]
            _sql(conn, f"""
                update public.profiles p set status = 'approved', course = d.course,
                    bio_focus = d.bio_focus, is_committee = d.is_committee, cv_parse_consent = true
                from (values {values_sql}) as d(id, is_approved, course, bio_focus, is_committee)
                where p.id = d.id::uuid
            """, tuple(params))
            # bio_hobbies set separately: text() cast simpler as its own pass
            values_sql2 = ", ".join(["(%s, %s)"] * len(batch))
            params2 = [p for s in batch for p in (ids[s.key], s.bio_hobbies or None)]
            _sql(conn, f"""
                update public.profiles p set bio_hobbies = d.bio_hobbies
                from (values {values_sql2}) as d(id, bio_hobbies) where p.id = d.id::uuid
            """, tuple(params2))

    settings_rows = [(ids[s.key], s.recruiter, s.network) for s in specs if s.grade != "background"] + \
                    [(ids[s.key], False, False) for s in specs if s.grade == "background"]
    for batch in _batch(settings_rows):
        values_sql = ", ".join(["(%s, %s, %s, false, 'corpus', 1)"] * len(batch))
        params = [p for r in batch for p in r]
        _sql(conn, f"""
            insert into ai_private.member_settings (member_id, recruiter_discoverable, network_discoverable,
                evidence_sharing, consent_version, consent_epoch) values {values_sql}
        """, tuple(params))

    edu_rows = [(ids[s.key],) for s in specs]
    for batch in _batch(edu_rows):
        values_sql = ", ".join(["(%s, true, false)"] * len(batch))
        params = [p for r in batch for p in r]
        _sql(conn, f"insert into public.member_education (member_id, currently_enrolled, has_completed_degree) "
                   f"values {values_sql}", tuple(params))
    return ids


def promote_members(specs: list[PlantedMember], ids: dict[str, uuid.UUID], d, versions: dict) -> None:
    from app import cv_pipeline, projection
    from app.db import connection

    for s in specs:
        src = {
            "status": "approved" if s.grade != "background" else "approved",
            "is_committee": s.is_committee,
            "settings": {"recruiter_discoverable": s.recruiter, "network_discoverable": s.network,
                        "consent_epoch": 1},
            # bio_focus reaches every purpose (self/recruiter/network);
            # bio_hobbies reaches network only (build_member_evidence).
            # A grade1/hard-negative member's only text is this sentence,
            # so it must go into bio_focus too, or recruiter-mode queries
            # would never see it at all — the real, meaningful text, never
            # a placeholder that drops the concept mention.
            "bio_focus": s.bio_hobbies or None,
            "bio_hobbies": s.bio_hobbies or None,
            # build_member_evidence text-matches "CV skill: {skill}" against
            # the dictionary — it needs the concept's own alias text (which
            # may contain a space, e.g. "Spring Boot"), not the raw
            # hyphenated slug ("spring-boot"), which several aliases don't
            # recognise as a surface form at all.
            "cv": {"skills_raw": [d.label(c) for c in s.skills_raw]} if s.skills_raw else None,
        }
        docs, rows = projection.build_member_docs(src, d)
        for doc in docs:
            if doc["body"].strip():
                [vector] = cv_pipeline._embed([doc["body"]])
                doc["embedding"] = cv_pipeline.vector_literal(vector)
                doc["embedding_model"] = cv_pipeline.EMBEDDING_MODEL
        with connection() as conn, conn.cursor() as cur:
            cur.execute("select ai_private.worker_put_member_docs(%s, %s, %s, %s, %s)",
                       (ids[s.key], versions.get(ids[s.key]), 1, Jsonb(docs), Jsonb(rows)))


def seed_jobs(conn, specs: list[PlantedJob], poster: uuid.UUID, tag: str) -> dict[str, uuid.UUID]:
    ids = {s.key: uuid.uuid4() for s in specs}
    rows = [(ids[s.key], poster, s.status, f"Role {s.key}", "Corpus Co", "Paid",
            s.description[:4990], s.eligible_audience, s.creation_source) for s in specs]
    for batch in _batch(rows):
        values_sql = ", ".join(["(%s, %s, %s, %s, %s, %s, 'remote', %s, 6, 2027, current_date + 60, "
                                "'jobs@corpus.test', 'email', now(), %s, %s, %s)"] * len(batch))
        params = [p for r in batch for p in (r[0], r[1], r[2], r[3], r[4], r[5], r[6], poster, r[7], r[8])]
        _sql(conn, f"""
            insert into public.opportunities (id, posted_by, status, position_name, company, pay, location_type,
              description, start_month, start_year, application_deadline, contact_email, apply_method,
              approved_at, approved_by, eligible_audience, creation_source)
            values {values_sql}
        """, tuple(params))
    return ids


def promote_jobs(specs: list[PlantedJob], ids: dict[str, uuid.UUID], d) -> None:
    from app import cv_pipeline
    from app.db import connection
    for s in specs:
        concepts = d.positive(s.description)
        [vector] = cv_pipeline._embed([s.description])
        doc = {"concepts": concepts, "body": s.description, "embedding": cv_pipeline.vector_literal(vector),
              "embedding_model": cv_pipeline.EMBEDDING_MODEL}
        with connection() as conn, conn.cursor() as cur:
            cur.execute("select ai_private.worker_put_job_ai(%s, %s, %s, null)", (ids[s.key], 1, Jsonb(doc)))


# ─── querying ────────────────────────────────────────────────────────
def as_member(conn, uid, query: str, params: tuple = ()):
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("set local role authenticated")
            cur.execute("select set_config('request.jwt.claims', %s, true)",
                       (json.dumps({"sub": str(uid), "role": "authenticated"}),))
            cur.execute(query, params)
            return cur.fetchall() if cur.description else None


_LAST_RETRIEVAL: list[dict] = []
# Wall-clock ms per exec_retrieve/ai_result_cards/ai_turn_status call, across
# every query in this run (S7, gap 26: "exec_retrieve ... at 10k"). Each query
# runs its own real turn, so this is `exec_retrieve`'s actual latency against
# whatever corpus size `run()` just seeded — 36 samples at --size 10k, not a
# synthetic benchmark loop.
_RETRIEVE_MS: list[float] = []
_CARDS_MS: list[float] = []
_STATUS_MS: list[float] = []


def _run_executor_once(dsn: str) -> None:
    """Runs every currently-queued turn (always exactly one in this
    script's usage) and, via a monkey-patch on Turn.retrieve, captures the
    raw retrieval pool (up to 200 candidates) into _LAST_RETRIEVAL — the
    plan's recall@200 is about this pool, not the published top-10
    (PUBLISH_LIMIT) or even the assessed top-20 (ASSESS_LIMIT), neither of
    which ai_result_cards alone could ever show a recall@200 of 1.0 for."""
    import asyncio

    os.environ["AI_DATABASE_URL"] = _dsn_for(dsn, "ai_service", AI_SERVICE_PASSWORD)
    os.environ["AI_PROVIDER"] = "fake"
    from app.ai import config as ai_config
    from app.ai.db import Db
    from app.ai.pipeline import Turn, run_turn
    from app.ai.provider import FakeProvider
    from app.ai.runner import _DictionaryCache

    ai_config.ai_settings.cache_clear()
    settings = ai_config.ai_settings()

    _LAST_RETRIEVAL.clear()
    original_retrieve = Turn.retrieve

    async def _capturing_retrieve(self, atoms, self_concepts):
        started = time.perf_counter()
        result = await original_retrieve(self, atoms, self_concepts)
        _RETRIEVE_MS.append((time.perf_counter() - started) * 1000)
        _LAST_RETRIEVAL.extend(result)
        return result

    Turn.retrieve = _capturing_retrieve
    try:
        async def go() -> None:
            db = Db(settings.database_url)
            try:
                while True:
                    ctx = await db.one("select ai_private.exec_claim(%s)", ("corpus",))
                    if ctx is None:
                        return
                    await run_turn(db, FakeProvider(), settings, await _DictionaryCache().get(db), ctx)
            finally:
                await db.close()

        asyncio.run(go())
    finally:
        Turn.retrieve = original_retrieve


def _dcg(grades: list[int]) -> float:
    return sum((2 ** g - 1) / math.log2(i + 2) for i, g in enumerate(grades))


@dataclass
class QueryResult:
    retrieved: list[uuid.UUID]  # the raw pool, up to 200 (recall@200)
    published: list[uuid.UUID]  # ai_result_cards, up to PUBLISH_LIMIT=10 (nDCG@10, ineligibility)


def run_query(conn, dsn, uid, mode, message, *, opportunity=None) -> QueryResult:
    row = as_member(conn, uid, "select * from public.ai_submit_turn(%s, %s, %s, 'message', %s, %s, null, false)",
                    (mode, None, opportunity, message, uuid.uuid4().hex))[0]
    turn, outcome = row[0], row[2]
    if outcome != "queued":
        raise RuntimeError(f"query {message!r} ({mode}) not queued: {outcome}")
    _run_executor_once(dsn)
    started = time.perf_counter()
    status = as_member(conn, uid, "select status from public.ai_turn_status(%s)", (turn,))[0][0]
    _STATUS_MS.append((time.perf_counter() - started) * 1000)
    if status not in ("completed", "partial"):
        spans = _sql(conn, "select stage, outcome from ai_private.trace_spans where turn_id = %s order by created_at",
                    (turn,))
        turn_outcome = _sql(conn, "select outcome from ai_private.turns where id = %s", (turn,))
        raise RuntimeError(f"query {message!r} ({mode}) ended {status}, outcome={turn_outcome}; spans={spans}")
    started = time.perf_counter()
    cards = as_member(conn, uid, "select target_id from public.ai_result_cards(%s)", (turn,))
    _CARDS_MS.append((time.perf_counter() - started) * 1000)
    retrieved = [r["target"] for r in _LAST_RETRIEVAL]
    return QueryResult(retrieved=retrieved, published=[r[0] for r in cards])


@dataclass
class QueryReport:
    query_id: str
    mode: str
    recall_at_200: float
    recall_at_20: float
    ndcg_at_10: float
    ineligible_in_results: int
    grade3_lost: int


def score_query(query_id: str, mode: str, target_type: str, result: QueryResult,
                ids: dict[str, uuid.UUID], specs) -> QueryReport:
    by_grade: dict[str, set[uuid.UUID]] = {"grade3": set(), "grade2": set(), "grade1": set(), "ineligible": set()}
    for s in specs:
        if s.query_id != query_id:
            continue
        if s.grade in by_grade:
            by_grade[s.grade].add(ids[s.key])
    grades = {m: 3 for m in by_grade["grade3"]} | {m: 2 for m in by_grade["grade2"]} | \
             {m: 1 for m in by_grade["grade1"]}
    relevant = set(grades)
    # recall@200/@20 are about the retrieval POOL (exec_retrieve, before
    # ASSESS_LIMIT=20/PUBLISH_LIMIT=10 truncate it) — ai_result_cards alone
    # could never show recall@200 of 1.0 for more than 10 relevant items.
    top200, top20 = result.retrieved[:200], result.retrieved[:20]
    recall200 = len(relevant & set(top200)) / len(relevant) if relevant else 1.0
    recall20 = len(relevant & set(top20)) / len(relevant) if relevant else 1.0
    # nDCG@10 and the eligibility/grade3 guarantees are about what the
    # member actually sees: the final published cards.
    top10 = result.published[:10]
    ideal = sorted(grades.values(), reverse=True)[:10]
    ndcg10 = _dcg([grades.get(i, 0) for i in top10]) / _dcg(ideal) if ideal else 1.0
    ineligible_hit = len(by_grade["ineligible"] & set(result.published))
    grade3_lost = len(by_grade["grade3"] - set(result.published))
    return QueryReport(query_id, mode, round(recall200, 4), round(recall20, 4), round(ndcg10, 4),
                       ineligible_hit, grade3_lost)


# ─── top-level run ───────────────────────────────────────────────────
def cleanup_orphans(dsn: str) -> int:
    """Recovery path for a run that didn't reach its own `finally` (a
    killed process, not just a raised exception — try/finally can't help
    there). Every corpus row is identifiable without needing the run's own
    tag: emails are always "corpus-<tag>-<key>@imperial.ac.uk" and jobs
    always company="Corpus Co" — this deletes any of them regardless of
    which run left them. `python -m evals retrieval --cleanup` runs this
    alone, with no corpus build/query attempted."""
    conn = psycopg.connect(dsn, autocommit=True)
    try:
        ids = [r[0] for r in _sql(conn, "select id from auth.users where email like %s", ("corpus-%@imperial.ac.uk",))]
        for batch in _batch(ids):
            _sql(conn, "delete from public.opportunities where posted_by = any(%s)", (batch,))
            _sql(conn, "delete from auth.users where id = any(%s)", (batch,))
        _sql(conn, "delete from public.opportunities where company = 'Corpus Co'")
        _sql(conn, "delete from public.jobs where kind in ('refresh_member_ai', 'refresh_job_ai') "
                   "and status = 'pending'")
        return len(ids)
    finally:
        conn.close()


def run(dsn: str, size: int, *, seed_value: int = 0, out: Path | None = None) -> dict:
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from app import config as app_config

    rng = random.Random(seed_value)
    tag = uuid.uuid4().hex[:8]
    conn = psycopg.connect(dsn, autocommit=True)
    saved_flags = dict(_sql(conn, "select key, value from public.app_config where key like 'ai_%%'"))
    _sql(conn, "update public.app_config set value = 'true' where key in "
               "('ai_enabled', 'ai_recruiter_enabled', 'ai_network_enabled', 'ai_opportunities_enabled')")
    _sql(conn, f"alter role ai_service password '{AI_SERVICE_PASSWORD}'")
    _sql(conn, f"alter role cv_worker password '{CV_WORKER_PASSWORD}'")

    member_specs: list[PlantedMember] = []
    job_specs: list[PlantedJob] = []
    member_ids: dict[str, uuid.UUID] = {}
    job_ids: dict[str, uuid.UUID] = {}
    try:
        member_specs = _member_specs(rng, size)
        job_specs = _job_specs(rng, size)
        member_ids = seed(conn, member_specs, tag)

        # One dedicated asking identity per query, for every mode — the
        # 5-a-minute admission limit (hardcoded, shared across modes, not
        # settings-editable) refuses a 6th submission from the same
        # identity inside 60s, so 12 sequential queries from one shared
        # asker would self-sabotage. recruiter mode additionally needs its
        # own job per query (confirmed requirements are per-opportunity).
        def _plain_member(key: str, *, enrolled: bool, graduated: bool, skills_raw: list[str] | None = None) -> uuid.UUID:
            uid = uuid.uuid4()
            _sql(conn, "insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, "
                       "confirmation_token, recovery_token, email_change_token_new, email_change, aud, role) "
                       "values (%s, %s, %s, '{\"provider\":\"email\"}', '', '', '', '', "
                       "'authenticated', 'authenticated')",
                (uid, f"corpus-{tag}-{key}@imperial.ac.uk",
                 Jsonb({"first_name": "Corpus", "surname": key, "role": "alum" if graduated else "student",
                       "grad_year": 2020 if graduated else 2028})))
            with conn.transaction():
                _sql(conn, "select set_config('foundry.onboarding_submission', 'true', true)")
                _sql(conn, "update public.profiles set status='approved', course='Computing', "
                           "cv_parse_consent = %s where id=%s", (bool(skills_raw), uid))
            _sql(conn, "insert into public.member_education (member_id, currently_enrolled, has_completed_degree) "
                       "values (%s, %s, %s)", (uid, enrolled, graduated))
            _sql(conn, "insert into ai_private.member_settings (member_id, recruiter_discoverable, "
                       "network_discoverable, evidence_sharing, consent_version, consent_epoch) "
                       "values (%s, false, false, false, 'corpus', 1)", (uid,))
            member_ids[key] = uid
            member_specs.append(PlantedMember(key, "", "asker", "background", skills_raw=skills_raw or []))
            return uid

        network_askers = {qid: _plain_member(f"{qid}-asker", enrolled=True, graduated=False)
                          for qid, _m, _c in QUERIES["network"]}
        recruiter_posters = {qid: _plain_member(f"{qid}-recruiter", enrolled=False, graduated=True)
                             for qid, _m, _c in QUERIES["recruiter"]}
        # Opportunities mode scores jobs against the ASKER's own evidence
        # (assess_jobs), not against query text — the asker needs the
        # query's target concept on their own CV for grade3 jobs to
        # resolve "met" at all.
        opportunities_askers = {qid: _plain_member(f"{qid}-asker", enrolled=True, graduated=False, skills_raw=concepts)
                                for qid, _m, concepts in QUERIES["opportunities"]}

        for s in member_specs:
            if s.blocked:
                against = network_askers.get(s.query_id) or recruiter_posters.get(s.query_id)
                if against:
                    _sql(conn, "insert into public.connections (requester_id, addressee_id, status, blocked_by, "
                               "decided_at) values (%s, %s, 'blocked', %s, now())",
                        (against, member_ids[s.key], against))

        job_poster = _plain_member("job-poster", enrolled=False, graduated=True)
        job_ids = seed_jobs(conn, job_specs, job_poster, tag)
        for qid, poster_uid in recruiter_posters.items():
            spec = PlantedJob(f"{qid}-job", qid, "n/a", f"Internal role for {qid}", creation_source="member")
            job_ids.update(seed_jobs(conn, [spec], poster_uid, tag))
            job_specs.append(spec)

        os.environ.update(DATABASE_URL=_dsn_for(dsn, "cv_worker", CV_WORKER_PASSWORD), OPENAI_PROVIDER="fake",
                          OPENAI_API_KEY="unused", GITHUB_TOKEN_ENCRYPTION_KEY="unused",
                          AZURE_CV_CONTAINER="unused", GITHUB_OAUTH_CLIENT_ID="unused",
                          GITHUB_OAUTH_CLIENT_SECRET="unused")
        app_config.worker_settings.cache_clear()
        from app import openai_client, projection
        openai_client.client.cache_clear()
        d = projection.dictionary()
        # worker_put_member_docs compares p_version against the REAL
        # ai_private.member_source_versions row for this member (bumped
        # by production triggers on every profile/settings/education
        # write this script just made — not necessarily 1), rejecting a
        # stale-looking write otherwise. Read it back as postgres (the
        # cv_worker role has no direct SELECT on this table).
        versions = dict(_sql(conn, "select member_id, version from ai_private.member_source_versions "
                             "where member_id = any(%s)", (list(member_ids.values()),)))
        promote_members(member_specs, member_ids, d, versions)
        promote_jobs(job_specs, job_ids, d)

        reports: list[QueryReport] = []
        for qid, message, _concepts in QUERIES["network"]:
            results = run_query(conn, dsn, network_askers[qid], "network", message)
            reports.append(score_query(qid, "network", "member", results, member_ids, member_specs))
        for qid, message, concepts in QUERIES["recruiter"]:
            atoms = [{"kind": "tool", "concept": c, "required": True} for c in concepts]
            as_member(conn, recruiter_posters[qid], "select public.ai_confirm_job_requirements(%s, %s)",
                     (job_ids[f"{qid}-job"], Jsonb(atoms)))
            results = run_query(conn, dsn, recruiter_posters[qid], "recruiter", message,
                               opportunity=job_ids[f"{qid}-job"])
            reports.append(score_query(qid, "recruiter", "member", results, member_ids, member_specs))
        for qid, message, _concepts in QUERIES["opportunities"]:
            results = run_query(conn, dsn, opportunities_askers[qid], "opportunities", "find jobs for me")
            reports.append(score_query(qid, "opportunities", "job", results, job_ids, job_specs))

        by_mode: dict[str, list[QueryReport]] = {}
        for r in reports:
            by_mode.setdefault(r.mode, []).append(r)
        summary = {
            mode: {
                "recall_at_200_min": round(min(r.recall_at_200 for r in rs), 4),
                "recall_at_20_mean": round(sum(r.recall_at_20 for r in rs) / len(rs), 4),
                "ndcg_at_10_mean": round(sum(r.ndcg_at_10 for r in rs) / len(rs), 4),
                "ineligible_hits": sum(r.ineligible_in_results for r in rs),
                "grade3_lost": sum(r.grade3_lost for r in rs),
                "gate_pass": min(r.recall_at_200 for r in rs) >= 0.95
                            and sum(r.ndcg_at_10 for r in rs) / len(rs) >= 0.80
                            and sum(r.ineligible_in_results for r in rs) == 0
                            and sum(r.grade3_lost for r in rs) == 0,
            }
            for mode, rs in by_mode.items()
        }
        def _pctl(values: list[float], p: float) -> float:
            if not values:
                return 0.0
            ordered = sorted(values)
            return round(ordered[min(len(ordered) - 1, int(p * len(ordered)))], 2)

        db_latency_ms = {
            name: {"p50": _pctl(vals, 0.50), "p95": _pctl(vals, 0.95), "max": round(max(vals), 2), "n": len(vals)}
            for name, vals in (("exec_retrieve", _RETRIEVE_MS), ("ai_result_cards", _CARDS_MS),
                               ("ai_turn_status", _STATUS_MS)) if vals
        }
        report = {"size": size, "members": len(member_specs), "jobs": len(job_specs),
                 "queries": [r.__dict__ for r in reports], "summary": summary, "db_latency_ms": db_latency_ms,
                 "verdict": "pass" if all(s["gate_pass"] for s in summary.values()) else "fail"}
        if out:
            out.write_text(json.dumps(report, indent=2))
        return report
    finally:
        all_member_ids = list(member_ids.values())
        for batch in _batch(all_member_ids):
            if batch:
                _sql(conn, "delete from public.opportunities where posted_by = any(%s)", (batch,))
                _sql(conn, "delete from auth.users where id = any(%s)", (batch,))
        for batch in _batch(list(job_ids.values())):
            if batch:
                _sql(conn, "delete from public.opportunities where id = any(%s)", (batch,))
        _sql(conn, "delete from public.jobs where kind in ('refresh_member_ai', 'refresh_job_ai') "
                   "and status = 'pending'")
        for key, value in saved_flags.items():
            _sql(conn, "update public.app_config set value = %s where key = %s", (value, key))
        conn.close()
