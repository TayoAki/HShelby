# Operations runbook

What to do when something has to be restored, checked or load tested. The services, variables and Railway layout are in [`BACKEND_PLAN.md`](BACKEND_PLAN.md) (Status).

---

## Backups

Two layers, both on Railway's Postgres service (Postgres tab → Backups):

| | What it gives you | Turn on |
|---|---|---|
| **Scheduled volume backups** | Snapshots of the whole database volume. Daily (kept 6 days), weekly (kept a month), monthly (kept 3 months); pick any combination. Incremental, billed per GB like the volume. | Postgres service → Backups → schedule. Daily + weekly on production at least. |
| **Point-in-time recovery** | Every WAL segment archived to a Railway bucket with pgBackRest (weekly full, daily differential base backups, 4 fulls kept: about 4 weeks). Restores to any second in that window. | Postgres service → Backups → Point-in-time recovery (it creates the bucket and sets the `WAL_ARCHIVE_*` variables). Production only. |

Photos live in the `photos` bucket, not in Postgres. A database restore doesn't bring back deleted objects: rows restored from before a purge or a user's deletion can point at objects that are gone, and those photos show as missing.

Secrets (`ENC_KEYS`, `BETTER_AUTH_SECRET`) must match the data: a database restored next to a different `ENC_KEYS` can't decrypt APNs keys, Telegram tokens or provider secrets. Keep the old key in `ENC_KEYS` (it takes a list) when rotating.

## Restore after an incident

1. **Stop the writers** so nothing lands on the data you're about to replace: scale `api` and `worker` to zero replicas (or remove their deployments) in the affected environment. The dashboard can stay; it only proxies to the API.
2. **Pick the point.** A bad deploy or a wrong `DELETE` at a known time → point-in-time recovery to just before it. A lost or corrupted volume → the latest volume backup.
3. **Restore.**
   - Volume backup: Postgres → Backups → the snapshot → Restore. Railway stages a new volume (named after the snapshot's date) at the same mount path and keeps the old one unmounted; review the staged change and Deploy.
   - Point in time: Postgres → Backups → Point-in-time recovery → pick the timestamp (and the WAL history, if it asks) → Restore, then Deploy the staged change.
4. **Check it** before letting traffic back: run the restore drill's row counts by hand (`psql "$DATABASE_URL" -c "select count(*) from messages"` and the other big tables), and `select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1` against the migrations in `packages/db/migrations` (an older snapshot can be behind the code: the API's pre-deploy `migrate` brings it forward).
5. **Start the writers** again (`api` first, its pre-deploy step migrates; then `worker`). pg-boss picks up the jobs that were queued at the restore point; jobs queued after it are lost (pushes and Telegram posts for those messages, which are lost too).
6. Re-enable point-in-time recovery if Railway turned it off, so the restored database starts a new WAL history.
7. Write down what happened, the restore point and what was lost.

## Monthly restore drill

Proves a dump can be taken and restored, how long it takes, and that nothing is missing. `packages/db/scripts/restore-drill.sh` dumps the database (`pg_dump --format=custom`), restores it into a scratch database on the same server, compares every table's row count (`public`, `drizzle`, `pgboss`), prints the latest migration and drops the scratch database.

On Railway, without exposing the database:

1. Create a service from the image `postgres:18-alpine` (the server's major version; `pg_dump` refuses a newer server) named `restore-drill`, in the environment to drill.
2. Variable `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`.
3. Start command: `sh -c "echo <base64 of restore-drill.sh> | base64 -d | sh; sleep 3600"` (`base64 -w0 packages/db/scripts/restore-drill.sh` gives it; base64 avoids quoting the script, and `sleep` keeps the container from restarting in a loop). Restart policy: never.
4. Read its deploy logs (every line starts with `drill:`), then delete the service.

Locally: `DATABASE_URL=postgres://… sh packages/db/scripts/restore-drill.sh` with Postgres 18 client tools.

Pass: every table `ok`, the latest migration matches the newest file in `packages/db/migrations`, restore time noted below. A `MISMATCH` on a table that was being written during the drill (pg-boss's `job` table) is expected; anywhere else it's a failure to investigate.

| Date | Environment | Size | Dump | Restore | Result |
|---|---|---|---|---|---|
| 2026-10-29 | staging | 20 MB (dump 849 KB) | 1 s | 1 s | Pass: 45 tables `ok`, latest migration `0011_ai`, 4 s in all |

## Load test

`apps/api/scripts/load-test.ts` signs up a throwaway workspace and app through the dashboard, registers devices, has every device poll `GET /v1/unread` every few seconds (the SDK with the chat closed) while random devices send messages at a steady rate, prints latency percentiles per endpoint as the client saw them, and deletes the app (the worker purges its rows).

```
npx tsx apps/api/scripts/load-test.ts --api <api url> --dashboard <dashboard url> \
  --devices 1000 --poll 5 --rate 50 --duration 180
```

One machine registering 1,000 devices trips the per-address registration limit (30 per 10 minutes) and the per-device send limit doesn't fit 50 messages/s over 1,000 devices for long, so set `RATE_LIMIT_SCALE=100` on the api for the run and remove it afterwards. Client numbers include the network; the server's own latency is in Railway's HTTP metrics for the api (p95 per path).

| Date | Environment | Load | Server p95 | Client p95 (unread / send) | Notes |
|---|---|---|---|---|---|
| 2026-10-29 | staging | 1,000 devices polling every 5 s + 50 msg/s, 3 min | 42–47 ms (82 ms while registering) | 93 / 131 ms | 0 failed of 45,997; api peak 0.44 vCPU / 225 MB, Postgres 0.43 vCPU; `RATE_LIMIT_SCALE=100` during the run |

## Rate limits

Per API process, fixed windows (`apps/api/src/rate-limit.ts`). A client over a limit gets `429 rate_limited` with `Retry-After`. `RATE_LIMIT_SCALE` multiplies every limit (`0` turns them off; tests use it). With several api replicas each counts its own share, so the effective limit is replicas × limit; moving the counters to Postgres or Redis is a change to that one file.
