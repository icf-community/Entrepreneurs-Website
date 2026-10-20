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
    r.add_argument("--split", choices=["heldout"])
    r.add_argument("--release", action="store_true")
    r.add_argument("--cache", type=Path, help="record/resume: case-id-keyed JSON file of live model answers")
    r.add_argument("--replay", action="store_true",
                   help="offline: read --cache only, no API key or network, a missing case is a hard error")
    r.add_argument("--repeats", type=int, default=1, help="live only: rerun each case N times, report pass frequency")
    c = sub.add_parser("compare")
    c.add_argument("a", type=Path)
    c.add_argument("b", type=Path)
    e = sub.add_parser("export-dictionary")
    e.add_argument("--dsn", required=True)
    rs = sub.add_parser("review-sheet")
    rs.add_argument("--out", type=Path)
    rm = sub.add_parser("review-merge")
    rm.add_argument("--reviewer", action="append", nargs=2, metavar=("NAME", "CSV"), required=True)
    rt = sub.add_parser("retrieval")
    rt.add_argument("--dsn", required=True)
    rt.add_argument("--size", default="2k")
    rt.add_argument("--seed", type=int, default=0)
    rt.add_argument("--out", type=Path, default=Path("evals/reports/retrieval.json"))
    rt.add_argument("--cleanup", action="store_true",
                    help="delete any corpus-tagged rows left by a run that didn't reach its own cleanup "
                         "(a killed process), then exit without building or querying anything")
    mb = sub.add_parser("memory-bench")
    mb.add_argument("--dsn", required=True)
    mb.add_argument("--out", type=Path, default=Path("evals/reports/memory_bench.json"))
    args = parser.parse_args()

    if args.cmd == "export-dictionary":
        from .dictionary import export
        print(f"exported {export(args.dsn)} concepts")
        return
    if args.cmd == "compare":
        print(runner.compare(json.loads(args.a.read_text()), json.loads(args.b.read_text())), end="")
        return
    if args.cmd == "review-sheet":
        from .review import write_review_sheet
        path = write_review_sheet(args.out)
        print(f"wrote {path}")
        return
    if args.cmd == "review-merge":
        from .review import merge_reviews
        by_suite = merge_reviews({name: Path(csv_path) for name, csv_path in args.reviewer})
        for suite, entries in by_suite.items():
            disputed = sum(1 for v in entries.values() if v["verdict"] == "disputed")
            print(f"datasets/reviews/{suite}.json: {len(entries)} cases, {disputed} disputed")
        return
    if args.cmd == "retrieval":
        if args.cleanup:
            from .corpus import cleanup_orphans
            print(f"deleted {cleanup_orphans(args.dsn)} orphaned corpus member(s)")
            return
        from .corpus import run as run_retrieval
        sizes = {"2k": 2000, "10k": 10000}
        size = sizes.get(args.size, None)
        if size is None:
            try:
                size = int(args.size)
            except ValueError:
                sys.exit("--size must be 2k, 10k, or an integer")
        report = run_retrieval(args.dsn, size, seed_value=args.seed, out=args.out)
        for mode, s in report["summary"].items():
            print(f"{mode}: recall@200 min {s['recall_at_200_min']:.3f}, nDCG@10 mean {s['ndcg_at_10_mean']:.3f}, "
                  f"ineligible hits {s['ineligible_hits']}, grade3 lost {s['grade3_lost']} — "
                  f"{'PASS' if s['gate_pass'] else 'FAIL'}")
        for name, lat in report.get("db_latency_ms", {}).items():
            print(f"{name}: p50 {lat['p50']}ms, p95 {lat['p95']}ms, max {lat['max']}ms (n={lat['n']})")
        print(f"verdict: {report['verdict'].upper()} · report: {args.out}")
        sys.exit(0 if report["verdict"] == "pass" else 1)
    if args.cmd == "memory-bench":
        from .memory_bench import run as run_memory_bench
        report = run_memory_bench(args.dsn, out=args.out)
        r, c = report["recall"], report["cost"]
        print(f"keyword recall {r['keyword_recall']}, hybrid recall {r['hybrid_recall']}, "
              f"hybrid distractor precision {r['hybrid_distractor_precision']}")
        print(f"memory overhead: {c['mean_memory_overhead_tokens']} tokens/turn mean "
              f"({c['mean_tokens_memory_on']} on vs {c['mean_tokens_memory_off']} off, n={c['n']})")
        print(f"report: {args.out}")
        return

    if args.split == "heldout" and not args.release:
        sys.exit("--split heldout needs --release — held-out cases are never run by accident")
    if args.replay and not args.cache:
        sys.exit("--replay needs --cache PATH (the fixture file to replay from)")
    if args.repeats > 1 and not args.live:
        sys.exit("--repeats > 1 is only meaningful for --live (the fake provider is already deterministic)")
    suites = args.suite or list(SUITES)
    model, state = None, None
    if args.replay:
        from .fixtures import CachedModel
        model = CachedModel(args.cache, live_model=None, strict=True)
    elif args.live:
        if not (args.model and args.max_cases and args.max_spend_usd):
            sys.exit("live mode needs --model, --max-cases and --max-spend-usd")
        model, state = _live_model(args)
        if args.cache:
            from .fixtures import CachedModel
            model = CachedModel(args.cache, live_model=model, strict=False)

    provider = "replay:" + str(args.cache) if args.replay else ("openai:" + args.model if args.live else "fake")
    if args.repeats > 1:
        reports = [runner.run(suites, provider=provider, model=model,
                              live_cost=round(state["spent"], 4) if state else None, split=args.split)
                  for _ in range(args.repeats)]
        report = runner.aggregate_repeats(reports)
    else:
        report = runner.run(suites, provider=provider, model=model,
                            live_cost=round(state["spent"], 4) if state else None, split=args.split)
    if args.release:
        from .review import unconfirmed_critical
        unresolved = unconfirmed_critical(suites)
        if unresolved:
            report["verdict"] = "fail"
            report["critical_failures"] = sorted(set(report["critical_failures"]) | set(unresolved))
            print(f"--release blocked: {len(unresolved)} critical case(s) not confirmed by review: {unresolved}")
    runner.write(report, args.out)
    o = report["overall"]
    print(f"{report['verdict'].upper()}: {o['passed']}/{o['total']} passed, {o['failed']} failed, {o['errors']} errors"
          f" · critical failures: {len(report['critical_failures'])} · report: {args.out}")
    sys.exit(0 if report["verdict"] == "pass" else 1)


if __name__ == "__main__":
    main()
