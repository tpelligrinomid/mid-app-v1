#!/usr/bin/env bash
# Timed data restore into the new Supabase project (runbook §5 step 2 / §6 step 4).
#
# The Supabase session pooler ignores PGOPTIONS, so session_replication_role
# can't be passed at connect time. Instead pg_restore writes SQL to stdout and
# each stream is piped into psql after a SET that skips FK checks and user
# triggers (audit logs, the Slack notifier) for that session.
#
# Three parallel streams: pulse_tasks (largest), compass_knowledge (embeddings),
# everything else. Materialized views are refreshed at the end.
#
# Usage: bash scripts/migration/restore-data.sh <export.backup> [--big-only]
#   --big-only  load only pulse_tasks and compass_knowledge (resume after a
#               failed run once the other tables and auth are already in)
set -uo pipefail

DUMP="$1"
MODE="${2:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="$HOME/scoop/apps/postgresql/current/bin"
LOGDIR="$(dirname "$DUMP")"
DB="$(grep -m1 '^SPOOLER_CONNECT' "$ROOT/migration_from_lovable.env" | cut -c17- | tr -d '\r' | sed -e 's/^ *//' -e 's/^["'\'']//' -e 's/["'\'']$//')"

list="$LOGDIR/toc.list"
"$BIN/pg_restore" -l "$DUMP" > "$list"

# One TOC list per stream: table data plus sequence values, no matview data.
grep -E '; [0-9]+ [0-9]+ (TABLE DATA|SEQUENCE SET) public ' "$list" > "$LOGDIR/public.list"
grep -E ' TABLE DATA public pulse_tasks ' "$LOGDIR/public.list" > "$LOGDIR/s1.list"
grep -E ' TABLE DATA public compass_knowledge ' "$LOGDIR/public.list" > "$LOGDIR/s2.list"
grep -vE ' TABLE DATA public (pulse_tasks|compass_knowledge) ' "$LOGDIR/public.list" > "$LOGDIR/s3.list"

stream() { # name list
  local start=$SECONDS
  { echo "SET session_replication_role = replica; SET statement_timeout = 0;"
    "$BIN/pg_restore" -a -L "$2" -f - "$DUMP"
  } | "$BIN/psql" "$DB" -w -q -v ON_ERROR_STOP=1 > "$LOGDIR/$1.log" 2>&1
  local rc=$?
  echo "$1: $((SECONDS - start))s (exit $rc)"
  return $rc
}

total=$SECONDS
failed=0

if [ "$MODE" != "--big-only" ]; then
  grep -E ' TABLE DATA auth (users|identities) ' "$list" > "$LOGDIR/auth.list"
  stream auth "$LOGDIR/auth.list" || failed=1
fi

stream pulse_tasks "$LOGDIR/s1.list" & p1=$!
stream compass_knowledge "$LOGDIR/s2.list" & p2=$!
if [ "$MODE" != "--big-only" ]; then
  stream other_tables "$LOGDIR/s3.list" & p3=$!
  wait $p3 || failed=1
fi
wait $p1 || failed=1
wait $p2 || failed=1

start=$SECONDS
"$BIN/psql" "$DB" -w -q -v ON_ERROR_STOP=1 -c 'select public.refresh_contract_views();' -c 'analyze;' \
  > "$LOGDIR/refresh.log" 2>&1 || failed=1
echo "refresh views + analyze: $((SECONDS - start))s"
echo "total: $((SECONDS - total))s"
exit $failed
