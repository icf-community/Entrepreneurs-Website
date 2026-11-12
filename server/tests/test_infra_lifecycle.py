"""Guards the Azure storage lifecycle rule in infra/azure/provision.sh.

A blob in the avatar or CV container is written once and never rewritten, so a "delete 30 days after last
modification" rule on those containers deletes every member's live avatar and CV a month after they upload it
while their profile still points at it. The rule may cover post images only.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

PROVISION = Path(__file__).resolve().parents[2] / "infra" / "azure" / "provision.sh"


def _policy() -> dict:
    text = PROVISION.read_text()
    match = re.search(r"cat > \"\$POLICY\" <<JSON\n(.*?)\nJSON\n", text, re.S)
    assert match, "the lifecycle policy heredoc moved; update this test"
    return json.loads(match.group(1))


def test_the_lifecycle_rule_covers_post_images_only():
    for rule in _policy()["rules"]:
        prefixes = rule["definition"]["filters"]["prefixMatch"]
        assert prefixes == ["$CONTAINER/"], (
            f"lifecycle rule {rule['name']!r} matches {prefixes}: it must not reach the avatar or CV containers"
        )


def test_the_avatar_and_cv_containers_are_never_named_in_a_delete_rule():
    delete_rules = [r for r in _policy()["rules"] if "delete" in r["definition"]["actions"]["baseBlob"]]
    assert delete_rules, "expected the post-image sweep to exist"
    for rule in delete_rules:
        assert not any("AVATAR" in p or "CV" in p for p in rule["definition"]["filters"]["prefixMatch"])
