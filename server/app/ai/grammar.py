"""A small, fully consumed grammar for criteria written in known terms
(AI-plan §4: replaces the token/stopword "fast path").

"PyTorch and FastAPI", "must have React, nice to have TypeScript",
"Deep learning or computer vision, not finance", "also likes chess":
when every word is a dictionary concept, an operator or a filler word, the
message becomes typed operations with no model call. Anything else, one
unknown word included, returns None and the interpreter decides. It never
guesses: an unconsumed word is the signal that a human sentence needs a
real reading.
"""

from __future__ import annotations

import re

from ..concepts import Dictionary

_ALLOWED = {
    "recruiter": {"tool", "method", "area", "language"},
    "network": {"tool", "method", "area", "language", "interest"},
    "opportunities": {"tool", "method", "area", "language"},
}

# Every word the grammar may consume without meaning a criterion.
_FILLER = {
    "find", "show", "search", "for", "me", "people", "person", "someone", "somebody", "anyone", "members",
    "member", "candidates", "candidate", "who", "that", "with", "in", "of", "a", "an", "the", "knows", "know",
    "knowing", "experience", "experienced", "skills", "skill", "background", "using", "uses", "use", "good",
    "at", "strong", "proficient", "plus", "also", "too", "as", "well", "jobs", "job", "roles", "role",
    "internships", "internship", "opportunities", "opportunity", "please", "i", "want", "looking", "need",
    "needs", "is", "are", "and", "into", "likes", "like", "enjoys", "enjoy", "loves", "love", "interested",
    "who's", "whos", "can", "do", "does", "work", "working", "works", "on", "developer", "developers",
    "engineer", "engineers", "expert", "experts", "or", "not", "no", "without", "excluding", "except",
    "must", "required", "essential", "only", "have", "has", "nice", "to", "ideally", "preferably",
    "preferred", "bonus", "optional",
}
_REQUIRED_WORDS = {"must", "required", "essential", "only", "need", "needs"}
_PREFERRED_WORDS = {"nice", "ideally", "preferably", "preferred", "bonus", "optional", "plus"}
_NEGATION_WORDS = {"not", "no", "without", "excluding", "except"}
_TOKEN = re.compile(r"[a-z0-9+#.]+(?:['-][a-z0-9+#]+)*")


def parse(message: str, mode: str, d: Dictionary) -> list[dict] | None:
    lower = message.lower()
    mentions = d.find(message)
    allowed = _ALLOWED[mode]
    covered = [False] * len(lower)
    chosen = []
    for m in mentions:
        if d.concepts[m.slug].kind not in allowed:
            return None
        if any(covered[m.start:m.end]):
            continue
        for i in range(m.start, m.end):
            covered[i] = True
        chosen.append(m)
    if not chosen:
        return None

    # Every remaining word must be an operator or filler.
    for token in _TOKEN.finditer(lower):
        if any(covered[token.start():token.end()]):
            continue
        if token.group(0).strip(".") not in _FILLER:
            return None

    ops: list[dict] = []
    group_index = 0
    previous_end = 0
    current_group: str | None = None
    required = False
    preferred = False
    for i, m in enumerate(chosen):
        between = set(_TOKEN.findall(lower[previous_end:m.start]))
        if between & _REQUIRED_WORDS:
            required, preferred = True, False
        if between & _PREFERRED_WORDS:
            required, preferred = False, True
        negated = bool(between & _NEGATION_WORDS)
        # "X or Y": Y joins X's group. A new group starts at the first "or".
        if i > 0 and "or" in between and not negated:
            if current_group is None:
                if group_index >= 4:
                    return None
                group_index += 1
                current_group = f"g{group_index}"
                ops[-1]["group"] = current_group
            group = current_group
        else:
            current_group = None
            group = None
        ops.append({
            "op": "add",
            "kind": d.concepts[m.slug].kind,
            "concept": m.slug,
            "required": (required and not preferred) or negated,
            "negated": negated,
            "group": None if negated else group,
        })
        previous_end = m.end
    return ops
