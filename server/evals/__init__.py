"""Foundry AI evaluation harness (AI-evaluation-plan.md).

Offline by default: no network, no environment files, the real grammar,
privacy boundary, scoring and fake provider. Live model evaluation needs
--live, an explicit model, a case cap and a spend ceiling, and refuses
without all four.

    python -m evals run [--suite NAME] [--out evals/reports/run.json]
    python -m evals compare RUN_A.json RUN_B.json
"""
