"""The Foundry AI executor (AI-plan §4, §9, §10).

A separate process with its own login (ai_service), its own OpenAI key and
no storage, GitHub or worker credentials. It has no ingress: it claims
queued turns from Postgres, runs the fixed pipeline (interpret → retrieve
→ assess → score → publish) and writes results back through lease-checked
functions in the ai_private schema. See runner.py.
"""
