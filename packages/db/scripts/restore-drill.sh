#!/bin/sh
# Restore drill (phase B12): dump the database, restore the dump into a scratch database, compare every
# table's row count, then drop the scratch database. Needs psql, pg_dump and pg_restore of the server's
# major version (the postgres:18-alpine image has them).
#
#   DATABASE_URL=postgres://… sh packages/db/scripts/restore-drill.sh
#
# RESTORE_URL picks where to restore (default: a database named restore_drill on the same server, created
# and dropped by the drill). Counts are taken after the dump, so a table written to meanwhile can differ;
# run it while the app is quiet, or read a small difference on a busy table (pg-boss jobs) as that.
set -eu

SRC="${DATABASE_URL:?set DATABASE_URL}"
SCRATCH=""
if [ -z "${RESTORE_URL:-}" ]; then
  SCRATCH="restore_drill"
  RESTORE_URL="${SRC%/*}/$SCRATCH"
fi
DUMP="${DUMP_FILE:-/tmp/restore-drill.dump}"
log() { echo "drill: $*"; }

log "start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "server $(psql "$SRC" -Atc 'show server_version')"
log "client $(pg_dump --version)"
log "database size $(psql "$SRC" -Atc 'select pg_size_pretty(pg_database_size(current_database()))')"

if [ -n "$SCRATCH" ]; then
  psql "$SRC" -qc "drop database if exists $SCRATCH" -c "create database $SCRATCH"
fi

t0=$(date +%s)
pg_dump --format=custom --no-owner --no-acl --file="$DUMP" "$SRC"
t1=$(date +%s)
log "dump $((t1 - t0))s, $(wc -c < "$DUMP") bytes"
pg_restore --no-owner --no-acl --exit-on-error --dbname="$RESTORE_URL" "$DUMP"
t2=$(date +%s)
log "restore $((t2 - t1))s"

tables=$(psql "$SRC" -Atc "select quote_ident(schemaname) || '.' || quote_ident(tablename) from pg_tables where schemaname in ('public', 'drizzle', 'pgboss') order by 1")
mismatches=0
for t in $tables; do
  a=$(psql "$SRC" -Atc "select count(*) from $t")
  b=$(psql "$RESTORE_URL" -Atc "select count(*) from $t")
  if [ "$a" = "$b" ]; then log "ok       $t $a"; else log "MISMATCH $t source=$a restored=$b"; mismatches=$((mismatches + 1)); fi
done
log "latest migration $(psql "$RESTORE_URL" -Atc 'select hash from drizzle.__drizzle_migrations order by created_at desc limit 1')"

if [ -n "$SCRATCH" ]; then
  psql "$SRC" -qc "drop database $SCRATCH"
fi
rm -f "$DUMP"
log "done in $(( $(date +%s) - t0 ))s, $mismatches table(s) differ"
