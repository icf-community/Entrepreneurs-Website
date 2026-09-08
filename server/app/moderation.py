"""CV moderation — ingest pipeline step 3b.

cv-matchmaker-spec.md: "One call on the sanitised text. Free. If it flags,
set status = flagged and queue for human review rather than
auto-rejecting — false positives on legitimate CVs are possible and a
member shouldn't be silently excluded from search."

Nothing here calls an LLM in the completion sense — the moderation
endpoint is a dedicated, free classification call, and like
cv_sanitise.py this module has no database access: the worker persists
the result.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .openai_client import client

MODERATION_MODEL = "omni-moderation-latest"


@dataclass(frozen=True)
class ModerationResult:
    flagged: bool
    categories: list[str] = field(default_factory=list)


def moderate_cv(text: str) -> ModerationResult:
    response = client().moderations.create(model=MODERATION_MODEL, input=text)
    result = response.results[0]
    categories = [name for name, flagged in result.categories.model_dump().items() if flagged]
    return ModerationResult(flagged=result.flagged, categories=categories)
