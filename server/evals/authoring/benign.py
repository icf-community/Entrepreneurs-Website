"""Source for datasets/benign.jsonl and datasets/benign_domain.jsonl (S5
gap 1/2). Run: python -m evals.authoring.benign

Benign cases prove the deterministic pipeline correctly accepts and
grounds ordinary search requests — the complement of adversarial.jsonl.
Every message is checked against the real test dictionary
(evals/datasets/dictionary.json) before being written here, never
assumed: see `_EXACT_SEEDS`, which only uses concepts a quick `d.find()`
confirms match.

Two deliberate, documented scope limits (not oversight):
  - `seek`/`offer`/`location`/`role_type` criteria are not produced by
    either `grammar.parse` or the dictionary-driven fake interpreter in
    this eval dictionary (it holds zero location/role_type concepts, and
    seek/offer atoms come from chip edits via `apply_spec_ops`, not
    message interpretation). Those paths already have SQL coverage in
    adversarial_edges.sql / test_ai_races.py; "preferences" here is
    tested at the free-text level only (decision/crash-safety, not a
    specific slug).
  - the dictionary's alias lists are not exhaustively US/UK-paired: a few
    concepts (`optimization`, `data-visualization`) only carry the US
    spelling, so "optimisation"/"visualisation" silently fail to match.
    This is a dictionary-content gap, not a harness bug — two
    non-critical cases in `british-spelling` document it rather than
    hiding it. `financial-modelling`/`3d-modelling-animation` already use
    the UK spelling as their canonical label, so those cases ARE critical.

~25 "domain-not-people" probes are written separately to
`benign_domain.jsonl` and reported on their own slice (owner decision
#21: whether a bare domain/subject mention like "machine learning" should
ever be read as a people search with no further context).
"""

from __future__ import annotations

import json

# ── exact-concept seeds, confirmed to match via d.find() ────────────
# (slug, mode) -> message is the concept's own label text.
_EXACT_SEEDS: list[tuple[str, str, str]] = [
    # tools
    ("fastapi", "FastAPI", "recruiter"), ("vue", "Vue", "network"), ("blender", "Blender", "opportunities"),
    ("excel", "Excel", "recruiter"), ("figma", "Figma", "opportunities"), ("docker", "Docker", "network"),
    ("spring-boot", "Spring Boot", "recruiter"),
    ("aws", "AWS", "recruiter"), ("azure", "Azure", "opportunities"), ("django", "Django", "network"),
    ("airflow", "Airflow", "opportunities"), ("ansys", "ANSYS", "network"),
    ("arduino", "Arduino", "recruiter"), ("autocad", "AutoCAD", "opportunities"), ("bigquery", "BigQuery", "network"),
    ("dbt", "dbt", "recruiter"), ("elasticsearch", "Elasticsearch", "opportunities"), ("express", "Express", "network"),
    ("angular", "Angular", "recruiter"), ("comsol", "COMSOL", "opportunities"),
    # languages
    ("javascript", "JavaScript", "recruiter"), ("sql", "SQL", "network"), ("typescript", "TypeScript", "opportunities"),
    ("scala", "Scala", "recruiter"), ("java", "Java", "network"), ("python", "Python", "opportunities"),
    ("kotlin", "Kotlin", "recruiter"), ("haskell", "Haskell", "network"), ("csharp", "C#", "opportunities"),
    ("cpp", "C++", "recruiter"),
    # areas
    ("distributed-systems", "Distributed systems", "recruiter"), ("climate-energy", "Climate / Energy", "network"),
    ("qualitative-research", "Qualitative research", "opportunities"), ("api-design", "API design", "recruiter"),
    ("molecular-biology", "Molecular biology", "network"), ("backend-development", "Backend development", "opportunities"),
    ("accessibility-design", "Accessibility design", "recruiter"), ("accounting", "Accounting", "network"),
    ("actuarial-science", "Actuarial science", "opportunities"), ("aerospace-engineering", "Aerospace engineering", "recruiter"),
    ("affiliate-marketing", "Affiliate marketing", "network"), ("applied-mathematics", "Applied mathematics", "opportunities"),
    ("applied-physics", "Applied physics", "recruiter"), ("ar-vr-development", "AR/VR development", "network"),
    ("automation-scripting", "Automation / scripting", "opportunities"), ("battery-energy-storage", "Battery / energy storage", "recruiter"),
    ("biochemistry", "Biochemistry", "network"),
    # methods
    ("fpga", "FPGA design", "recruiter"), ("pcr", "PCR", "network"), ("tdd", "Test-driven development", "opportunities"),
    ("3d-printing", "3D printing", "recruiter"), ("rag", "RAG", "network"), ("agile", "Agile", "opportunities"),
    ("bayesian-methods", "Bayesian methods", "recruiter"), ("cad", "CAD", "network"), ("cfd", "CFD", "opportunities"),
    ("ci-cd", "CI/CD", "recruiter"), ("cnn", "CNN", "network"), ("crispr", "CRISPR", "opportunities"),
    ("dcf", "DCF", "recruiter"), ("etl", "ETL", "network"),
    # interests (network only — not in _ALLOWED_FOR_CANDIDATES for the other two modes)
    ("swimming", "Swimming", "network"), ("hackathons", "Hackathons", "network"), ("football", "Football", "network"),
    ("cooking", "Cooking", "network"), ("martial-arts", "Martial arts", "network"), ("chess", "Chess", "network"),
    ("climbing", "Climbing", "network"), ("debating", "Debating", "network"), ("cycling", "Cycling", "network"),
    ("boxing", "Boxing", "network"), ("rowing", "Rowing", "network"), ("astronomy", "Astronomy", "network"),
]

# (family, mode, message, prior_atoms, expected-only-adds)
SENTENCES: list[tuple[str, str, str, object]] = [
    ("sentence", "recruiter", "Looking for someone who knows PyTorch and has shipped with FastAPI", ["pytorch", "fastapi"]),
    ("sentence", "network", "I'd love to meet people into deep learning and chess", ["deep-learning", "chess"]),
    ("sentence", "opportunities", "Show me roles that use React and TypeScript", ["react", "typescript"]),
    ("sentence", "recruiter", "We need a candidate comfortable with Docker, deploying on AWS", ["docker", "aws"]),
    ("sentence", "network", "Keen to find a co-founder who's good at Figma and also enjoys climbing", ["figma", "climbing"]),
    ("sentence", "opportunities", "Anything involving Kubernetes or backend development would be great", ["kubernetes", "backend-development"]),
    ("sentence", "recruiter", "Our team needs Python skills plus some Excel modelling", ["python", "excel"]),
    ("sentence", "network", "Other students who like cooking and know some SQL", ["cooking", "sql"]),
    ("sentence", "opportunities", "I want internships touching machine learning and Django", ["machine-learning", "django"]),
    ("sentence", "recruiter", "A data scientist who's used BigQuery and dbt day to day", ["bigquery", "dbt"]),
]

OR_GROUPS: list[tuple[str, str, list[str]]] = [
    ("or-group", "recruiter", "PyTorch or TensorFlow", ["pytorch", "tensorflow"]),
    ("or-group", "network", "React or Vue developers", ["react", "vue"]),
    ("or-group", "opportunities", "Java or Kotlin roles", ["java", "kotlin"]),
    ("or-group", "recruiter", "AWS or Azure experience", ["aws", "azure"]),
    ("or-group", "network", "Chess or debating people", ["chess", "debating"]),
    ("or-group", "recruiter", "Django or Express", ["django", "express"]),
]

NEGATIONS: list[tuple[str, str, str, dict]] = [
    ("negation", "recruiter", "Python, not Java", {"python": {}, "java": {"negated": True}}),
    ("negation", "network", "deep learning but not blockchain / web3", {"deep-learning": {}, "blockchain-web3": {"negated": True}}),
    ("negation", "opportunities", "React roles, no Angular", {"react": {}, "angular": {"negated": True}}),
    ("negation", "recruiter", "Excel skills, excluding Tableau", {"excel": {}, "tableau": {"negated": True}}),
    ("negation", "network", "cooking, not gaming", {"cooking": {}, "gaming": {"negated": True}}),
]

REQUIRED: list[tuple[str, str, str, str]] = [
    ("required", "recruiter", "must have React, nice to have TypeScript", "react", "typescript"),
    ("required", "opportunities", "must have SQL, ideally also Python", "sql", "python"),
    ("required", "recruiter", "must have Docker, nice to have Kubernetes", "docker", "kubernetes"),
    ("required", "network", "need someone who knows Figma, ideally also Blender", "figma", "blender"),
    ("required", "recruiter", "must have AWS, nice to have GCP", "aws", "gcp"),
]

ALIAS_VARIANTS: list[tuple[str, str, str, str]] = [
    ("alias-variant", "recruiter", "ReactJS developer", "react"),
    ("alias-variant", "network", "react.js people", "react"),
    ("alias-variant", "opportunities", "pytorch roles", "pytorch"),
    ("alias-variant", "recruiter", "Go developer", "golang"),
    ("alias-variant", "network", "Go backend engineer", "golang"),
    ("alias-variant", "recruiter", "FINITE ELEMENT ANALYSIS background", "fea"),
]

TYPOS_UNMATCHED: list[tuple[str, str, str]] = [
    ("typo-unmatched", "recruiter", "Pyhton developer"),
    ("typo-unmatched", "network", "Djnago enthusiasts"),
    ("typo-unmatched", "opportunities", "Dokcer experience"),
    ("typo-unmatched", "recruiter", "Reactt skills"),
]

BRITISH_SPELLING: list[tuple[str, str, str, object]] = [
    ("british-spelling", "recruiter", "financial modelling background", {"only": ["financial-modelling"]}),
    ("british-spelling", "network", "3d modelling / animation people", {"only": ["3d-modelling-animation"]}),
    ("british-spelling", "opportunities", "LBO modelling roles", {"only": ["lbo"]}),
    # documented dictionary-content gap, not a harness bug — see module docstring
    ("british-spelling", "recruiter", "optimisation experience", {"gap": True}),
    ("british-spelling", "network", "data visualisation skills", {"gap": True}),
]

EMOJI: list[tuple[str, str, str, str]] = [
    ("emoji", "network", "🐍 python people please", "python"),
    ("emoji", "recruiter", "React 🚀 developers", "react"),
    ("emoji", "network", "♟️ chess fans", "chess"),
    ("emoji", "opportunities", "AWS ☁️ roles", "aws"),
]

REFINEMENTS: list[tuple[str, str, list[dict], str, str]] = [
    ("refinement", "recruiter",
     [{"id": "a1", "kind": "tool", "concept": "python", "required": False, "negated": False, "source": {}}],
     "also need Docker", "docker"),
    ("refinement", "network",
     [{"id": "a1", "kind": "interest", "concept": "chess", "required": False, "negated": False, "source": {}}],
     "and I like climbing too", "climbing"),
    ("refinement", "opportunities",
     [{"id": "a1", "kind": "language", "concept": "sql", "required": False, "negated": False, "source": {}}],
     "actually make it TypeScript instead", "typescript"),
]

# Domain-not-people probes (owner decision #21) — reported on their own
# slice, never folded into the pass/fail gate for "benign", since there is
# no agreed answer yet for what a bare domain mention with zero
# people-search language should resolve to.
DOMAIN_NOT_PEOPLE: list[tuple[str, str]] = [
    ("network", "machine learning"), ("network", "climate tech"), ("recruiter", "distributed systems"),
    ("opportunities", "backend development"), ("network", "quantum computing"), ("recruiter", "blockchain"),
    ("network", "biotech"), ("opportunities", "robotics"), ("recruiter", "cybersecurity"),
    ("network", "renewable energy"), ("opportunities", "fintech"), ("recruiter", "computer vision"),
    ("network", "natural language processing"), ("opportunities", "edge computing"), ("recruiter", "data engineering"),
    ("network", "synthetic biology"), ("opportunities", "autonomous vehicles"), ("recruiter", "cloud infrastructure"),
    ("network", "generative art"), ("opportunities", "supply chain"), ("recruiter", "venture capital"),
    ("network", "esports"), ("opportunities", "space technology"), ("recruiter", "materials science"),
    ("network", "open source"),
]


def _case(id_: str, family: str, mode: str, message: str, expected: dict, *, critical: bool = True,
          prior_atoms: list | None = None) -> dict:
    case = {
        "id": id_, "objectives": ["O01", "O02"], "mode": mode, "stage": "interpret", "family": family,
        "group": id_, "message": message, "critical": critical, "expected": expected,
        "label_provenance": "drafted (Claude) from AI-plan §4 relevance rules; pending human review",
    }
    if prior_atoms is not None:
        case["prior_atoms"] = prior_atoms
    return case


def build() -> list[dict]:
    out: list[dict] = []
    counters: dict[str, int] = {}

    def add(family: str, mode: str, message: str, expected: dict, **kw) -> None:
        counters[family] = counters.get(family, 0) + 1
        out.append(_case(f"ben-{family}-{counters[family]:03d}", family, mode, message, expected, **kw))

    for slug, label, mode in _EXACT_SEEDS:
        add("exact", mode, label, {"decision": "apply", "only_add": [slug]})

    for family, mode, message, slugs in SENTENCES:
        add(family, mode, message, {"decision_in": ["apply"], "only_add": slugs})

    for family, mode, message, slugs in OR_GROUPS:
        add(family, mode, message, {"decision": "apply", "only_add": slugs, "grouped": slugs})

    for family, mode, message, adds in NEGATIONS:
        add(family, mode, message, {"decision": "apply", "add": adds, "only_add": list(adds)})

    for family, mode, message, req_slug, pref_slug in REQUIRED:
        add(family, mode, message,
            {"decision": "apply", "only_add": [req_slug, pref_slug], "add": {req_slug: {"required": True}}})

    for family, mode, message, slug in ALIAS_VARIANTS:
        add(family, mode, message, {"decision": "apply", "only_add": [slug]})

    for family, mode, message in TYPOS_UNMATCHED:
        add(family, mode, message, {"decision_in": ["clarify"], "must_not_add_any": True})

    for family, mode, message, exp in BRITISH_SPELLING:
        if exp.get("gap"):
            add(family, mode, message, {"decision_in": ["clarify"], "must_not_add_any": True}, critical=False)
        else:
            add(family, mode, message, {"decision": "apply", "only_add": exp["only"]})

    for family, mode, message, slug in EMOJI:
        add(family, mode, message, {"decision": "apply", "only_add": [slug]})

    for family, mode, prior, message, slug in REFINEMENTS:
        add(family, mode, message, {"decision": "apply", "only_add": [slug]}, prior_atoms=prior)

    # Free-text preferences: location/role_type are never produced by this
    # eval dictionary (see module docstring) — asserted here only at the
    # "doesn't crash, doesn't refuse" level, not against a specific slug.
    for mode, message in [("opportunities", "remote roles in London please"),
                          ("opportunities", "full-time graduate schemes only"),
                          ("recruiter", "based in Manchester or hybrid")]:
        add("preferences", mode, message, {"decision_in": ["apply", "clarify", "mixed"]})

    # Broader exact-match coverage: every remaining non-ambiguous concept in
    # the frozen test dictionary (evals/datasets/dictionary.json) that
    # neither _EXACT_SEEDS nor another family above already used — each
    # one's own label is confirmed, at build time, to be found by
    # `Dictionary.find` and resolve to that exact slug (never assumed).
    from pathlib import Path

    from evals.dictionary import load as load_dictionary
    used = {slug for slug, _, _ in _EXACT_SEEDS}
    for group in (SENTENCES,):
        for *_rest, slugs in group:
            used.update(slugs)
    used.update(req_slug for *_r, req_slug, _p in REQUIRED)
    used.update(pref_slug for *_r, _q, pref_slug in REQUIRED)
    used.update(slug for *_r, slug in ALIAS_VARIANTS)
    used.update(slug for *_r, slug in EMOJI)
    dd = json.loads((Path(__file__).resolve().parent.parent / "datasets" / "dictionary.json").read_text())
    d = load_dictionary()
    pad_mode = {"tool": ["recruiter", "opportunities", "network"], "method": ["recruiter", "opportunities", "network"],
               "area": ["recruiter", "opportunities", "network"], "language": ["recruiter", "opportunities", "network"],
               "interest": ["network"]}
    cycle: dict[str, int] = {}
    padded = 0
    for slug, label, kind, _aliases, ambiguous in dd["concepts"]:
        if ambiguous or slug in used or kind not in pad_mode or padded >= 90:
            continue
        mentions = d.find(label)
        if not mentions or mentions[0].slug != slug:
            continue  # never assumed — only concepts the real matcher confirms
        modes = pad_mode[kind]
        mode = modes[cycle.get(kind, 0) % len(modes)]
        cycle[kind] = cycle.get(kind, 0) + 1
        add("exact-pad", mode, label, {"decision": "apply", "only_add": [slug]})
        used.add(slug)
        padded += 1

    return out


def build_domain() -> list[dict]:
    out = []
    for i, (mode, message) in enumerate(DOMAIN_NOT_PEOPLE, start=1):
        out.append({
            "id": f"ben-domain-{i:03d}", "objectives": ["O01"], "mode": mode, "stage": "interpret",
            "family": "domain-not-people", "group": f"ben-domain-{i:03d}", "message": message,
            "critical": False,
            "expected": {"decision_in": ["apply", "clarify", "mixed"]},
            "label_provenance": "drafted (Claude); reported separately, owner decision #21 pending — "
                                "no agreed answer yet for whether a bare domain mention is a people search",
        })
    return out


if __name__ == "__main__":
    from pathlib import Path

    datasets = Path(__file__).resolve().parent.parent / "datasets"
    cases = build()
    domain = build_domain()
    (datasets / "benign.jsonl").write_text("\n".join(json.dumps(c, ensure_ascii=False) for c in cases) + "\n")
    (datasets / "benign_domain.jsonl").write_text("\n".join(json.dumps(c, ensure_ascii=False) for c in domain) + "\n")
    families = {c["family"] for c in cases}
    by_mode: dict[str, int] = {}
    for c in cases:
        by_mode[c["mode"]] = by_mode.get(c["mode"], 0) + 1
    print(f"wrote {len(cases)} benign cases across {len(families)} families ({by_mode}) "
          f"+ {len(domain)} domain-not-people probes -> {datasets}")
