"""python -m evals {run,compare,export-dictionary} — see evals/__init__.py."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .harness import SUITES
from . import runner


def _live_model(args):
    """Explicit, capped, live interpretation (§2: live mode needs provider
    enablement, a model snapshot, a case cap and a spend ceiling)."""
    import asyncio
    import os
    import uuid

    from app.ai.provider import OpenAIProvider, ProviderError
    from app.ai.schemas import INTERPRET_SCHEMA, prompt

    key = os.environ.get("AI_OPENAI_API_KEY")
    if not key:
        sys.exit("live mode needs AI_OPENAI_API_KEY in the environment (it never reads env files)")
    if args.input_price is None or args.output_price is None:
        sys.exit("live mode needs --input-price and --output-price (USD per million tokens) for the spend ceiling")
    provider = OpenAIProvider(key)
    state = {"spent": 0.0, "calls": 0}

    def model(payload: dict) -> dict:
        if state["calls"] >= args.max_cases:
            raise RuntimeError("case cap reached")
        if state["spent"] >= args.max_spend_usd:
            raise RuntimeError("spend ceiling reached")
        state["calls"] += 1
        result = asyncio.run(provider.json(uuid.uuid4(), model=args.model, name="interpretation",
                                           system=prompt("interpret"), user=json.dumps(payload),
                                           schema=INTERPRET_SCHEMA, max_output_tokens=1500, timeout=30))
        state["spent"] += (result.input_tokens * args.input_price + result.output_tokens * args.output_price) / 1e6
        return result.value

    return model, state


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m evals")
    sub = parser.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--suite", action="append", choices=SUITES)
    r.add_argument("--out", type=Path, default=Path("evals/reports/latest.json"))
    r.add_argument("--live", action="store_true")
    r.add_argument("--model")
    r.add_argument("--max-cases", type=int)
    r.add_argument("--max-spend-usd", type=float)
    r.add_argument("--input-price", type=float)
    r.add_argument("--output-price", type=float)
    c = sub.add_parser("compare")
    c.add_argument("a", type=Path)
    c.add_argument("b", type=Path)
    e = sub.add_parser("export-dictionary")
    e.add_argument("--dsn", required=True)
    args = parser.parse_args()

    if args.cmd == "export-dictionary":
        from .dictionary import export
        print(f"exported {export(args.dsn)} concepts")
        return
    if args.cmd == "compare":
        print(runner.compare(json.loads(args.a.read_text()), json.loads(args.b.read_text())), end="")
        return

    suites = args.suite or list(SUITES)
    model, state = None, None
    if args.live:
        if not (args.model and args.max_cases and args.max_spend_usd):
            sys.exit("live mode needs --model, --max-cases and --max-spend-usd")
        model, state = _live_model(args)
    report = runner.run(suites, provider="openai:" + args.model if args.live else "fake", model=model,
                        live_cost=round(state["spent"], 4) if state else None)
    runner.write(report, args.out)
    o = report["overall"]
    print(f"{report['verdict'].upper()}: {o['passed']}/{o['total']} passed, {o['failed']} failed, {o['errors']} errors"
          f" · critical failures: {len(report['critical_failures'])} · report: {args.out}")
    sys.exit(0 if report["verdict"] == "pass" else 1)


if __name__ == "__main__":
    main()
