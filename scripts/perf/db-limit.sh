#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# Foundry · Size the LOCAL database container like Supabase Medium (E1c, M4)
#
#   scripts/perf/db-limit.sh          # 2 CPUs, 4 GB (Medium's size)
#   scripts/perf/db-limit.sh --reset  # remove the limits
#
# Medium is 2 SHARED, burstable cores. Two full cores here is therefore
# the optimistic bound (scalability-audit.md §3): short spikes look like
# this, sustained load gets less. Treat a pass here as necessary, not
# sufficient; the pre-launch prod run on real Medium is the confirmation.
# Local only: touches the supabase_db_* container and nothing else.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail
container=$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)
[[ -n "$container" ]] || { echo "No local supabase_db_* container is running." >&2; exit 1; }
if [[ "${1:-}" == "--reset" ]]; then
  docker update --cpus 0 --memory 0 --memory-swap -1 "$container" >/dev/null
  echo "$container: limits removed."
else
  docker update --cpus 2 --memory 4g --memory-swap 4g "$container" >/dev/null
  echo "$container: 2 CPUs, 4 GB (Supabase Medium's size)."
fi
