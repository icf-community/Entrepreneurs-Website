"""One turn, end to end (AI-plan §4, §9).

    claim → interpret → retrieve → assess (≤4 batches, in parallel) → score → publish

Fixed stages, no agent loop, no tools. The model is called at most once to
interpret (skipped entirely when the grammar reads the message) and at
most four times to assess, each call reserved in the ledger first and
settled after; one explicit retry only when the remaining deadline still
covers a full attempt. Every write goes through a lease-checked function,
so a turn that lost its lease (reclaimed, cancelled, expired) can change
nothing.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from dataclasses import dataclass, field

import psycopg

from .. import privacy
from ..concepts import Dictionary
from . import grammar, policy
from .db import Db
from .provider import ProviderError
from .schemas import (
    ASSESS_PROMPT_VERSION,
    ASSESS_SCHEMA,
    INTERPRET_SCHEMA,
    RUBRIC_VERSION,
    prompt,
    prompt_hash,
)
from .score import (
    SCORED_KINDS,
    Atom,
    AtomState,
    concept_state,
    criteria_from_atoms,
    order_key,
    score_candidate,
)

log = logging.getLogger("foundry.ai")

ASSESS_BATCH = 5
ASSESS_LIMIT = 20
PUBLISH_LIMIT = 10
INTERPRET_MAX_OUTPUT = 1500
ASSESS_MAX_OUTPUT = 3000
MIN_ATTEMPT_SECONDS = 3.0

_ALLOWED_KINDS = {
    "recruiter": {"tool", "method", "area", "language", "free"},
    "network": {"tool", "method", "area", "language", "interest", "free", "seek", "offer"},
    "opportunities": {"tool", "method", "area", "language", "free", "location", "role_type"},
}


class Stop(Exception):
    """End the turn with a failure outcome the member can understand."""

    def __init__(self, outcome: str, status: str = "failed") -> None:
        super().__init__(outcome)
        self.outcome = outcome
        self.status = status


class LeaseLost(Exception):
    """Someone else owns this turn now (or nobody does). Write nothing."""


@dataclass
class Turn:
    db: Db
    provider: object
    settings: object
    dictionary: Dictionary
    ctx: dict
    started: float = field(default_factory=time.monotonic)
    partial: bool = False

    @property
    def id(self) -> str:
        return self.ctx["turn_id"]

    @property
    def lease(self) -> str:
        return self.ctx["lease"]

    @property
    def mode(self) -> str:
        return self.ctx["mode"]

    def remaining(self) -> float:
        deadline = float(self.ctx.get("deadline_seconds") or 45)
        return deadline - (time.monotonic() - self.started)

    # ─── Database calls, with the lease and error mapping ─────────────
    async def call(self, sql: str, params: tuple, *, many: bool = False):
        try:
            if many:
                return await self.db.rows(sql, params)
            return await self.db.one(sql, params)
        except psycopg.errors.RaiseException as exc:
            message = str(exc).splitlines()[0]
            if message.startswith("stale_lease") or message.startswith("stale_revision"):
                raise LeaseLost(message) from exc
            for outcome in ("budget_exhausted", "provider_busy", "cancelled", "deadline", "unconfirmed_price",
                            "unknown_model"):
                if message.startswith(outcome):
                    status = "cancelled" if outcome == "cancelled" else "failed"
                    raise Stop("unavailable" if outcome in ("unconfirmed_price", "unknown_model") else outcome,
                               status) from exc
            raise

    async def stage(self, name: str) -> None:
        if self.remaining() <= 0:
            raise Stop("deadline")
        ok = await self.call("select ai_private.exec_heartbeat(%s, %s, %s)", (self.id, self.lease, name))
        if ok is False:
            raise Stop("cancelled", "cancelled")

    async def span(self, stage: str, model: str | None, phash: str | None, tokens_in: int | None,
                   tokens_out: int | None, cost: int | None, started: float, outcome: str, attempt: int) -> None:
        try:
            await self.db.one(
                "select ai_private.exec_span(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (self.id, stage, model, phash, tokens_in, tokens_out, cost,
                 int((time.monotonic() - started) * 1000), outcome, attempt),
            )
        except psycopg.Error:
            log.warning("could not record a trace span for turn %s", self.id)

    # ─── Metered provider calls ────────────────────────────────────────
    async def metered_json(self, stage: str, model: str, name: str, prompt_name: str, payload: dict,
                           schema: dict, max_output: int, *, attempt: int = 1) -> dict:
        system = prompt(prompt_name)
        user = json.dumps(payload, ensure_ascii=False)
        # The last outbound check, on the assembled payload (§3 step 2).
        privacy.assert_clean(system + "\n" + user)
        timeout = min(float(self.ctx.get("attempt_timeout_seconds") or 20), self.remaining())
        if timeout < MIN_ATTEMPT_SECONDS:
            raise Stop("deadline")
        estimate = max(1, len(system + user) // 3) + 50
        reservation = await self.call(
            "select ai_private.exec_reserve(%s, %s, %s, %s, %s, %s)",
            (self.id, self.lease, stage, model, estimate, max_output),
        )
        started = time.monotonic()
        try:
            result = await asyncio.wait_for(
                self.provider.json(reservation, model=model, name=name, system=system, user=user, schema=schema,
                                   max_output_tokens=max_output, timeout=timeout),
                timeout + 1,
            )
        except (ProviderError, asyncio.TimeoutError) as exc:
            outcome = exc.outcome if isinstance(exc, ProviderError) else "timeout"
            await self._abandon(reservation)
            await self.span(stage, model, prompt_hash(prompt_name), None, None, None, started, outcome, attempt)
            raise ProviderError(outcome) from exc
        cost = await self.db.one(
            "select ai_private.exec_settle(%s, %s, %s, %s)",
            (self.id, reservation, result.input_tokens, result.output_tokens),
        )
        await self.span(stage, model, prompt_hash(prompt_name), result.input_tokens, result.output_tokens, cost,
                        started, "ok", attempt)
        return result.value

    async def _abandon(self, reservation) -> None:
        try:
            await self.db.one("select ai_private.exec_abandon(%s, %s, %s)", (self.id, reservation, True))
        except psycopg.Error:
            log.warning("could not mark reservation %s unknown", reservation)

    async def with_retry(self, fn, *args, **kwargs) -> dict:
        """One explicit retry, and only if the deadline still covers a whole
        attempt (§9). A retry is another reservation and another bill."""
        try:
            return await fn(*args, **kwargs)
        except ProviderError:
            attempt_seconds = float(self.ctx.get("attempt_timeout_seconds") or 20)
            if self.remaining() < attempt_seconds:
                raise
            return await fn(*args, **kwargs, attempt=2)

    # ─── Stage 1: interpret ────────────────────────────────────────────
    async def interpret(self) -> tuple[list[Atom], int] | None:
        kind = self.ctx["kind"]
        spec = self.ctx.get("spec") or {}
        revision = int(self.ctx["spec_revision"])
        if kind == "confirm":
            result = await self.apply("confirm_pending", [])
            self.ctx["spec"] = result["spec"]
            return self._atoms(result["spec"]), int(result["spec_revision"])
        if kind != "message":
            return self._atoms(spec), revision

        message = privacy.minimise(self.ctx.get("message") or "").text.strip()
        if not message:
            await self.apply("clarify", [])
            return None
        # Deterministic refusals cost no model call (§9.1 admission order).
        refused = policy.screen(message)
        if refused:
            await self.apply(refused, [])
            return None
        ops = grammar.parse(message, self.mode, self.dictionary)
        decision = "apply"
        if ops is None:
            decision, ops = await self._model_interpret(message, spec)
        if decision == "apply" and not ops:
            decision = "clarify"
        if decision == "clarify" and self.mode == "opportunities":
            # "Find jobs for me" has no criteria to add: search on the
            # member's own profile with the criteria already set.
            return self._atoms(spec), revision
        try:
            result = await self.apply(decision, ops)
        except psycopg.errors.InvalidParameterValue:
            # The database refused an operation the local checks let
            # through (ungrounded, over a limit): treat it as unclear.
            result = await self.apply("clarify", [])
        if result is None:
            return None
        self.ctx["spec"] = result["spec"]
        return self._atoms(result["spec"]), int(result["spec_revision"])

    async def apply(self, decision: str, ops: list[dict]) -> dict | None:
        return await self.call(
            "select ai_private.exec_interpretation(%s, %s, %s, %s, %s)",
            (self.id, self.lease, self.ctx["fence"], decision, json.dumps(ops)),
        )

    async def _model_interpret(self, message: str, spec: dict) -> tuple[str, list[dict]]:
        allowed = _ALLOWED_KINDS[self.mode]
        candidates: dict[str, dict] = {}
        for m in self.dictionary.find(message):
            concept = self.dictionary.concepts[m.slug]
            if concept.kind in allowed or self.mode == "network":
                candidates.setdefault(m.slug, {"slug": m.slug, "label": concept.label, "kind": concept.kind,
                                               "start": m.start})
        memory = []
        if self.ctx.get("use_memory"):
            # Keyword plus vector search over the member's own earlier chats
            # (§5.1). The message's embedding is stored on its own row so a
            # later chat can find it; it expires and is forgotten with it.
            embedding = await self._message_embedding(message)
            rows = await self.call("select * from ai_private.exec_memory(%s, %s, %s, %s)",
                                   (self.id, self.lease, message, embedding), many=True)
            memory = [privacy.minimise(r["body"], max_chars=600).text for r in rows]
        current = [
            {"atom": a.get("id"), "kind": a.get("kind"), "label": self.dictionary.label(a["concept"])
             if a.get("concept") else a.get("free_text"), "required": bool(a.get("required"))}
            for a in spec.get("atoms") or []
        ]
        payload = {"mode": self.mode, "message": message, "current_criteria": current,
                   "candidate_concepts": list(candidates.values()), "memory": memory}
        value = await self.with_retry(
            self.metered_json, "interpret", self.settings.interpreter_model, "interpretation", "interpret", payload,
            INTERPRET_SCHEMA, INTERPRET_MAX_OUTPUT,
        )
        return value["decision"], self._ground(value.get("ops") or [], message, candidates, spec)

    def _ground(self, ops: list[dict], message: str, candidates: dict, spec: dict) -> list[dict]:
        return ground_ops(ops, message, candidates, spec, self.mode, self.dictionary)

    @staticmethod
    def _atoms(spec: dict) -> list[Atom]:
        return [Atom.from_json(a) for a in (spec or {}).get("atoms") or []]

    # ─── Stage 2: retrieve ─────────────────────────────────────────────
    async def retrieve(self, atoms: list[Atom], self_concepts: list[str]) -> list[dict]:
        d = self.dictionary
        concepts: set[str] = set()
        negated: set[str] = set()
        terms: list[str] = []
        for atom in atoms:
            if atom.kind in ("location", "role_type"):
                continue
            if atom.concept:
                expanded = d.expand_broad(atom.concept) if atom.kind == "area" else {atom.concept}
                if atom.negated:
                    negated |= expanded
                else:
                    concepts |= expanded
                    terms.append(d.label(atom.concept))
            elif atom.free_text and not atom.negated:
                terms.append(atom.free_text)
        if self.mode == "opportunities" and not concepts:
            concepts |= set(self_concepts[:40])
            terms.extend(d.label(c) for c in self_concepts[:10])
        query = " OR ".join(dict.fromkeys(t.replace('"', " ") for t in terms if t))
        embedding = await self._query_embedding(" ".join(terms)) if terms else None
        return await self.call(
            "select * from ai_private.exec_retrieve(%s, %s, %s, %s, %s, %s, %s)",
            (self.id, self.lease, sorted(concepts), sorted(negated), query, embedding, 200),
            many=True,
        )

    async def _query_embedding(self, text: str) -> str | None:
        text = privacy.minimise(text, max_chars=1000).text
        model = self.settings.embedding_model
        key = hashlib.sha256(f"{model}|{self.mode}|{text.lower()}".encode()).hexdigest()
        cached = await self.db.one("select ai_private.exec_embedding_get(%s)", (key,))
        if cached:
            return cached
        timeout = min(10.0, self.remaining())
        if timeout < MIN_ATTEMPT_SECONDS:
            return None
        reservation = await self.call(
            "select ai_private.exec_reserve(%s, %s, %s, %s, %s, %s)",
            (self.id, self.lease, "query_embedding", model, max(1, len(text) // 3) + 20, 0),
        )
        started = time.monotonic()
        try:
            result = await asyncio.wait_for(
                self.provider.embed(reservation, model=model, texts=[text], timeout=timeout), timeout + 1)
        except (ProviderError, asyncio.TimeoutError):
            # Retrieval still runs on exact and lexical matches.
            await self._abandon(reservation)
            await self.span("query_embedding", model, None, None, None, None, started, "provider_error", 1)
            return None
        cost = await self.db.one("select ai_private.exec_settle(%s, %s, %s, %s)",
                                 (self.id, reservation, result.input_tokens, 0))
        await self.span("query_embedding", model, None, result.input_tokens, 0, cost, started, "ok", 1)
        literal = "[" + ",".join(repr(float(x)) for x in result.vectors[0]) + "]"
        await self.db.one("select ai_private.exec_embedding_put(%s, %s, %s)", (key, literal, model))
        return literal

    async def _message_embedding(self, message: str) -> str | None:
        """Embed the member's own (minimised) message for memory search.
        Not the shared query cache: a chat message's vector is personal data
        and lives only on that message's row. Metered like every call; a
        failure falls back to keyword memory."""
        text = privacy.minimise(message, max_chars=1000).text
        model = self.settings.embedding_model
        timeout = min(10.0, self.remaining())
        if not text.strip() or timeout < MIN_ATTEMPT_SECONDS:
            return None
        reservation = await self.call(
            "select ai_private.exec_reserve(%s, %s, %s, %s, %s, %s)",
            (self.id, self.lease, "memory_embedding", model, max(1, len(text) // 3) + 20, 0),
        )
        started = time.monotonic()
        try:
            result = await asyncio.wait_for(
                self.provider.embed(reservation, model=model, texts=[text], timeout=timeout), timeout + 1)
        except (ProviderError, asyncio.TimeoutError):
            await self._abandon(reservation)
            await self.span("memory_embedding", model, None, None, None, None, started, "provider_error", 1)
            return None
        cost = await self.db.one("select ai_private.exec_settle(%s, %s, %s, %s)",
                                 (self.id, reservation, result.input_tokens, 0))
        await self.span("memory_embedding", model, None, result.input_tokens, 0, cost, started, "ok", 1)
        literal = "[" + ",".join(repr(float(x)) for x in result.vectors[0]) + "]"
        await self.call("select ai_private.exec_message_embedding(%s, %s, %s, %s)",
                        (self.id, self.lease, literal, model))
        return literal

    # ─── Stage 3: assess ───────────────────────────────────────────────
    def _cache_key(self, target: str, projection_hash: str, criteria_atoms: list[Atom], model: str) -> str:
        role_level = (self.ctx.get("job") or {}).get("role_level")
        material = json.dumps({
            "mode": self.mode, "target": target, "projection": projection_hash, "role_level": role_level,
            "atoms": sorted([a.kind, a.concept, a.free_text, a.required] for a in criteria_atoms),
            "rubric": RUBRIC_VERSION, "prompt": ASSESS_PROMPT_VERSION, "phash": prompt_hash("assess"),
            "model": model,
        }, sort_keys=True, default=str)
        return hashlib.sha256(material.encode()).hexdigest()

    async def assess_members(self, atoms: list[Atom], candidates: list[dict]) -> list[dict]:
        top = candidates[:ASSESS_LIMIT]
        if not top:
            return []
        rows = await self.call("select * from ai_private.exec_candidate_evidence(%s, %s, %s)",
                               (self.id, self.lease, [c["target"] for c in top]), many=True)
        evidence_by = {str(r["target"]): r for r in rows}
        criteria = criteria_from_atoms(atoms)
        criteria_atoms = [a for c in criteria for a in c.atoms]
        free_atoms = [a for a in criteria_atoms if a.kind == "free" or (a.concept is None and a.free_text)]
        needs_model = self.mode == "recruiter" or bool(free_atoms)
        model = self.settings.assessor_models[self.mode]

        prepared = []
        for rank, cand in enumerate(top):
            target = str(cand["target"])
            ev = evidence_by.get(target)
            if not ev:
                continue
            evidence = list(ev["evidence"] or [])
            substantial = len(evidence) >= 3
            states = {a.id: concept_state(a, evidence, self.dictionary, substantial=substantial)
                      for a in criteria_atoms if a.concept}
            prepared.append({"target": target, "rank": rank, "evidence": evidence, "states": states,
                             "projection_hash": ev["projection_hash"],
                             "key": self._cache_key(target, ev["projection_hash"], criteria_atoms, model)})

        if needs_model and prepared:
            await self._model_assess(prepared, criteria_atoms, model)
        return self._score(prepared, criteria)

    async def _model_assess(self, prepared: list[dict], criteria_atoms: list[Atom], model: str) -> None:
        cached = await self.call("select * from ai_private.exec_assessment_get(%s, %s, %s)",
                                 (self.id, self.lease, [p["key"] for p in prepared]), many=True)
        verdicts = {r["cache_key"]: r["verdict"] for r in cached}
        pending = []
        for p in prepared:
            if p["key"] in verdicts:
                self._apply_verdict(p, verdicts[p["key"]])
            else:
                pending.append(p)
        if not pending:
            return
        await self.stage("assessing")
        batches = [pending[i:i + ASSESS_BATCH] for i in range(0, len(pending), ASSESS_BATCH)][:4]
        for leftover in pending[4 * ASSESS_BATCH:]:
            leftover["failed"] = True
        outcomes = await asyncio.gather(*(self._assess_batch(b, criteria_atoms, model) for b in batches),
                                        return_exceptions=True)
        for batch, outcome in zip(batches, outcomes):
            if isinstance(outcome, (Stop, LeaseLost)):
                raise outcome
            if isinstance(outcome, BaseException):
                for p in batch:
                    p["failed"] = True
                self.partial = True

    async def _assess_batch(self, batch: list[dict], criteria_atoms: list[Atom], model: str) -> None:
        criteria = [{"ref": a.id, "kind": a.kind,
                     "label": self.dictionary.label(a.concept) if a.concept else a.free_text,
                     "required": a.required} for a in criteria_atoms]
        candidates = []
        maps = []
        for i, p in enumerate(batch):
            ref_map = {f"e{j + 1}": e["id"] for j, e in enumerate(p["evidence"])}
            maps.append(ref_map)
            candidates.append({"ref": f"c{i + 1}",
                               "evidence": [{"ref": f"e{j + 1}", "kind": e.get("kind"), "text": e.get("text")}
                                            for j, e in enumerate(p["evidence"])]})
        payload = {"mode": self.mode, "role_level": (self.ctx.get("job") or {}).get("role_level"),
                   "criteria": criteria, "candidates": candidates}
        value = await self.with_retry(self.metered_json, "assess", model, "assessment", "assess", payload,
                                      ASSESS_SCHEMA, ASSESS_MAX_OUTPUT)
        by_ref = {c["ref"]: c for c in value["candidates"]}
        owner_scoped = any(a.source == "message" for a in criteria_atoms)
        expiry = min((a.expires_at for a in criteria_atoms if a.expires_at), default=None)
        for i, p in enumerate(batch):
            raw = by_ref.get(f"c{i + 1}")
            if raw is None:
                p["failed"] = True
                self.partial = True
                continue
            verdict = self._bind(raw, maps[i], {a.id for a in criteria_atoms if not a.concept})
            self._apply_verdict(p, verdict)
            await self.call(
                "select ai_private.exec_assessment_put(%s, %s, %s, %s, %s, %s, %s, %s)",
                (self.id, self.lease, p["target"], p["key"], p["projection_hash"], json.dumps(verdict), expiry,
                 owner_scoped),
            )

    @staticmethod
    def _bind(raw: dict, ref_map: dict, free_ids: set[str]) -> dict:
        """Evidence must belong to this candidate (§7): unknown refs are
        dropped, and a free-text 'met' with no valid evidence is unknown.
        The model's claims about concept criteria are ignored entirely;
        those states come from the evidence's own concepts."""
        atoms = {}
        for item in raw.get("atoms") or []:
            if item.get("atom") not in free_ids:
                continue
            ids = [ref_map[r] for r in item.get("evidence") or [] if r in ref_map]
            state = item.get("state")
            if state == "met" and not ids:
                state = "unknown"
            atoms[item["atom"]] = {"state": state, "evidence": ids}
        return {"atoms": atoms, "task": raw.get("task"), "depth": raw.get("depth"),
                "highlight": [ref_map[r] for r in raw.get("highlight") or [] if r in ref_map][:2]}

    @staticmethod
    def _apply_verdict(p: dict, verdict: dict) -> None:
        for atom_id, item in (verdict.get("atoms") or {}).items():
            p["states"][atom_id] = AtomState(item["state"], item.get("evidence") or [])
        p["task"], p["depth"] = verdict.get("task"), verdict.get("depth")
        p["highlight"] = verdict.get("highlight") or []

    def _score(self, prepared: list[dict], criteria) -> list[dict]:
        transferable = bool((self.ctx.get("spec") or {}).get("transferable"))
        scored = []
        for p in prepared:
            if p.get("failed") and self.mode == "recruiter":
                continue  # a recruiter score needs its task/depth assessment
            result = score_candidate(self.mode, criteria, p["states"], task=p.get("task"), depth=p.get("depth"),
                                     transferable=transferable)
            if result is None:
                continue
            evidence_ids = list(dict.fromkeys(
                [*p.get("highlight", []), *[i for s in p["states"].values() if s.state == "met" for i in s.evidence_ids]]
            ))[:6]
            scored.append((order_key(result, p["rank"]), {
                "target": p["target"], "score": result.score, "tier": result.tier, "exact_tier": result.exact_tier,
                "coverage": result.coverage, "components": result.components, "evidence_ids": evidence_ids,
                "projection_hash": p["projection_hash"],
            }))
        scored.sort(key=lambda item: item[0])
        return [item[1] for item in scored[:PUBLISH_LIMIT]]

    async def assess_jobs(self, atoms: list[Atom], candidates: list[dict], member: dict) -> list[dict]:
        """Find opportunities: how well the member's own evidence meets each
        job's requirements. The member's search criteria choose and order
        the jobs; preferences (location, role type) are reported beside the
        score, never inside it (§7, §14.3)."""
        top = candidates[:ASSESS_LIMIT]
        if not top:
            return []
        rows = await self.call("select * from ai_private.exec_candidate_evidence(%s, %s, %s)",
                               (self.id, self.lease, [c["target"] for c in top]), many=True)
        jobs = {str(r["target"]): r for r in rows}
        evidence = list(member.get("evidence") or [])
        substantial = len(evidence) >= 3
        required_search = [a for a in atoms if a.concept and a.required and not a.negated
                           and a.kind in SCORED_KINDS]
        prefs = [a for a in atoms if a.kind in ("location", "role_type")]
        model = self.settings.assessor_models["opportunities"]

        prepared = []
        for rank, cand in enumerate(top):
            job = jobs.get(str(cand["target"]))
            if not job:
                continue
            body = (job["evidence"] or [{}])[0]
            job_concepts = set(body.get("concepts") or [])
            # A required search criterion must be something the job is about.
            if any(not (self.dictionary.expand_broad(a.concept) & job_concepts) for a in required_search):
                continue
            requirements = [Atom.from_json(a) for a in (job["requirements"] or [])]
            if not requirements:
                requirements = [Atom(id=f"j{i + 1}", kind=self.dictionary.concepts[c].kind, concept=c,
                                     free_text=None, required=False)
                                for i, c in enumerate(sorted(job_concepts)[:8]) if c in self.dictionary.concepts]
            requirements = [a for a in requirements if a.kind in SCORED_KINDS]
            states = {a.id: concept_state(a, evidence, self.dictionary, substantial=substantial)
                      for a in requirements if a.concept}
            exact_search = sum(1 for a in atoms if a.concept and not a.negated and a.kind in SCORED_KINDS
                               and self.dictionary.expand_broad(a.concept) & job_concepts)
            prepared.append({"target": str(cand["target"]), "rank": rank, "requirements": requirements,
                             "states": states, "projection_hash": job["projection_hash"],
                             "body": body.get("text") or "", "exact_search": exact_search,
                             "preference": _preference(prefs, member.get("preferences") or {}, body.get("text") or ""),
                             "key": self._cache_key(str(cand["target"]), f"{job['projection_hash']}|{member['projection_hash']}",
                                                    requirements, model)})

        if prepared:
            await self._model_assess_jobs(prepared, evidence, model)

        scored = []
        for p in prepared:
            criteria = criteria_from_atoms(p["requirements"])
            result = score_candidate("opportunities", criteria, p["states"], task=p.get("task"),
                                     depth=p.get("depth"), transferable=False)
            if result is None:
                continue
            result.exact_tier = p["exact_search"]
            result.components["preference"] = p["preference"]
            scored.append((order_key(result, p["rank"]), {
                "target": p["target"], "score": result.score, "tier": result.tier, "exact_tier": result.exact_tier,
                "coverage": result.coverage, "components": result.components, "evidence_ids": [],
                "projection_hash": p["projection_hash"],
            }))
        scored.sort(key=lambda item: item[0])
        return [item[1] for item in scored[:PUBLISH_LIMIT]]

    async def _model_assess_jobs(self, prepared: list[dict], evidence: list[dict], model: str) -> None:
        cached = await self.call("select * from ai_private.exec_assessment_get(%s, %s, %s)",
                                 (self.id, self.lease, [p["key"] for p in prepared]), many=True)
        verdicts = {r["cache_key"]: r["verdict"] for r in cached}
        pending = []
        for p in prepared:
            if p["key"] in verdicts:
                self._apply_verdict(p, verdicts[p["key"]])
            else:
                pending.append(p)
        if not pending:
            return
        await self.stage("assessing")
        ref_map = {f"e{j + 1}": e["id"] for j, e in enumerate(evidence)}
        member_evidence = [{"ref": f"e{j + 1}", "kind": e.get("kind"), "text": e.get("text")}
                           for j, e in enumerate(evidence)]
        batches = [pending[i:i + ASSESS_BATCH] for i in range(0, len(pending), ASSESS_BATCH)][:4]

        async def run(batch: list[dict]) -> None:
            jobs_payload = [{
                "ref": f"j{i + 1}",
                "summary": batch_item["body"][:800],
                "criteria": [{"ref": a.id, "kind": a.kind,
                              "label": self.dictionary.label(a.concept) if a.concept else a.free_text,
                              "required": a.required} for a in batch_item["requirements"]],
            } for i, batch_item in enumerate(batch)]
            value = await self.with_retry(self.metered_json, "assess_jobs", model, "job_assessment", "assess_jobs",
                                          {"member_evidence": member_evidence, "jobs": jobs_payload},
                                          ASSESS_SCHEMA, ASSESS_MAX_OUTPUT)
            by_ref = {c["ref"]: c for c in value["candidates"]}
            for i, p in enumerate(batch):
                raw = by_ref.get(f"j{i + 1}")
                if raw is None:
                    p["failed"] = True
                    self.partial = True
                    continue
                verdict = self._bind(raw, ref_map, {a.id for a in p["requirements"] if not a.concept})
                self._apply_verdict(p, verdict)
                await self.call(
                    "select ai_private.exec_assessment_put(%s, %s, %s, %s, %s, %s, %s, %s)",
                    (self.id, self.lease, p["target"], p["key"], p["projection_hash"], json.dumps(verdict),
                     None, True),
                )

        outcomes = await asyncio.gather(*(run(b) for b in batches), return_exceptions=True)
        for batch, outcome in zip(batches, outcomes):
            if isinstance(outcome, (Stop, LeaseLost)):
                raise outcome
            if isinstance(outcome, BaseException):
                for p in batch:
                    p["failed"] = True
                self.partial = True

    # ─── Stage 4: publish ──────────────────────────────────────────────
    async def publish(self, results: list[dict], revision: int) -> None:
        await self.call(
            "select ai_private.exec_publish(%s, %s, %s, %s, %s, %s)",
            (self.id, self.lease, self.ctx["fence"], revision, json.dumps(results), self.partial),
        )

    async def finish(self, status: str, outcome: str) -> None:
        try:
            await self.call("select ai_private.exec_finish(%s, %s, %s, %s)", (self.id, self.lease, status, outcome))
        except (LeaseLost, Stop):
            pass


def ground_ops(ops: list[dict], message: str, candidates: dict, spec: dict, mode: str, dictionary: Dictionary) -> list[dict]:
    """Keep only operations grounded in this message or the current spec
    (§4: no fuzzy grounding). The database checks again."""
    atom_ids = {a.get("id") for a in spec.get("atoms") or []}
    spec_concepts = {a.get("concept") for a in spec.get("atoms") or [] if a.get("concept")}
    allowed = _ALLOWED_KINDS[mode]
    out: list[dict] = []
    for op in ops[:12]:
        kind = op.get("op")
        if kind == "clear":
            out.append({"op": "clear"})
        elif kind in ("remove", "set_required"):
            if op.get("atom") in atom_ids:
                item = {"op": kind, "atom": op["atom"]}
                if kind == "set_required":
                    item["required"] = bool(op.get("required"))
                out.append(item)
        elif kind == "add":
            concept = op.get("concept")
            if concept:
                if concept not in candidates and concept not in spec_concepts:
                    continue
                ckind = dictionary.concepts[concept].kind if concept in dictionary.concepts else None
                atom_kind = op.get("kind") if op.get("kind") in ("seek", "offer") else ckind
                if atom_kind not in allowed:
                    continue
                out.append({"op": "add", "kind": atom_kind, "concept": concept,
                            "required": bool(op.get("required")), "negated": bool(op.get("negated")),
                            "group": op.get("group")})
            else:
                free = (op.get("free_text") or "").strip()
                start, end = op.get("span_start"), op.get("span_end")
                if (not free or start is None or end is None or message[start:end] != free
                        or len(free) > 80):
                    continue
                atom_kind = op.get("kind") if op.get("kind") in ("seek", "offer") else "free"
                if atom_kind not in allowed:
                    continue
                out.append({"op": "add", "kind": atom_kind, "free_text": free, "span": [start, end],
                            "required": bool(op.get("required")), "negated": bool(op.get("negated")),
                            "group": op.get("group")})
    return out


def _preference(prefs: list[Atom], saved: dict, body: str) -> str:
    """Location and role-type preference against what the job says. Never
    part of the score; unknown stays unknown."""
    wanted_locations = {a.concept for a in prefs if a.kind == "location"} or set(saved.get("location_types") or [])
    if not wanted_locations:
        return "none"
    line = next((ln for ln in body.splitlines() if ln.startswith("Location:")), "")
    value = line.split(":", 1)[1].strip().lower() if ":" in line else ""
    if not value:
        return "unknown"
    return "match" if any(loc in value for loc in wanted_locations) else "mismatch"


async def run_turn(db: Db, provider, settings, dictionary: Dictionary, ctx: dict) -> None:
    turn = Turn(db=db, provider=provider, settings=settings, dictionary=dictionary, ctx=ctx)
    try:
        interpreted = await turn.interpret()
        if interpreted is None:
            return
        atoms, revision = interpreted

        member: dict = {}
        if turn.mode == "opportunities":
            rows = await turn.call("select * from ai_private.exec_self_evidence(%s, %s)", (turn.id, turn.lease),
                                   many=True)
            if not rows:
                raise Stop("no_profile")
            member = rows[0]
        elif not criteria_from_atoms(atoms):
            await turn.apply("clarify", [])
            return

        await turn.stage("searching")
        candidates = await turn.retrieve(atoms, list(member.get("concepts") or []))
        await turn.stage("assessing")
        if turn.mode == "opportunities":
            results = await turn.assess_jobs(atoms, candidates, member)
        else:
            results = await turn.assess_members(atoms, candidates)
        await turn.stage("scoring")
        await turn.publish(results, revision)
    except LeaseLost:
        log.info("turn %s: lease lost, stopping without writing", turn.id)
    except Stop as stop:
        await turn.finish(stop.status, stop.outcome)
    except privacy.OutboundPolicyError as exc:
        log.warning("turn %s: outbound policy refused a payload: %s", turn.id, exc.kinds)
        await turn.finish("failed", "error")
    except ProviderError as exc:
        await turn.finish("failed", "unavailable" if exc.outcome in ("provider_error", "timeout") else "error")
    except Exception:  # noqa: BLE001 — one turn's failure must not take down the runner
        log.exception("turn %s failed", turn.id)
        await turn.finish("failed", "error")
