# Training platform (phase 2): job queue and trainer worker

Queue of training runs in Postgres, drained by a separate trainer process. Public API and quotas are phase 3 and not part of this change.

## Architecture

```
enqueue-job.ts --> training_runs (queued) --> trainer.ts (claimNext, 1 at a time)
                                                |  runJob: validate, then spawn worker thread (train-worker.ts)
                                                |  progress -> training_metrics, heartbeat every 5s, cancel poll every 2s
                                                v
                                  brains (JSONB) + training_runs (succeeded / failed / cancelled)
```

- `src/lib/training/jobs.ts`: `JobStore` (`PgJobStore`, `MemoryJobStore` for tests). `claimNext` takes an advisory lock and `FOR UPDATE SKIP LOCKED`.
- `src/lib/training/runner.ts` + `train-worker.ts`: validation in the main thread, training in a `worker_threads` Worker with a heap limit, wall-clock limit, cancel, shutdown abort.
- `src/lib/training/migrations.ts`: shared by `scripts/migrate.ts` and the Postgres tests.
- Stale runs (no heartbeat for `TRAINER_STALE_MS`) become `failed` with "worker lost"; they are never requeued (no poison-job loops).

## Env vars

| Var | Default | Used by |
|---|---|---|
| `DATABASE_URL` | - | all scripts; wins over `PG*` when set |
| `PGHOST`, `PGPORT` (5432), `PGUSER`, `PGPASSWORD`, `PGDATABASE` | - | all scripts, used when `DATABASE_URL` is unset. Preferred in compose: the password needs no URL-encoding |
| `TRAINER_MAX_RUNTIME_MS` | 600000 | trainer: wall-clock limit per run (1000..86400000) |
| `TRAINER_POLL_MS` | 2000 | trainer: sleep when the queue is empty (100..60000) |
| `TRAINER_STALE_MS` | 60000 | trainer: heartbeat age that marks a run lost (30000..86400000; heartbeat is every 5s) |
| `TRAINER_WORKER_MB` | 512 | trainer: worker heap limit (64..4096) |
| `TEST_DATABASE_URL` | unset | `test/lib/training/pg-job-store.test.ts` (see below) |

Out-of-range trainer values are rejected at start-up (exit 1), never clamped.

## Run locally against a throwaway database

```sh
docker run -d --rm --name trainer-dev-pg -e POSTGRES_PASSWORD=<pick one> -p 127.0.0.1::5432 postgres:17-alpine
docker port trainer-dev-pg                  # note the host port
export DATABASE_URL=postgres://postgres:<password>@127.0.0.1:<port>/postgres

node scripts/migrate.ts --dry-run && node scripts/migrate.ts
node scripts/enqueue-job.ts snake q-learning 1000 [--params '{"alpha":0.2}'] [--trusted]
node scripts/trainer.ts --once              # or without --once for the daemon
node scripts/job-status.ts <id>

TEST_DATABASE_URL=$DATABASE_URL node --test test/lib/training/pg-job-store.test.ts
docker rm -f trainer-dev-pg
```

`--trusted` lifts the public episode cap (q-learning 20 000, dqn 5 000) up to 1 000 000.

### The Postgres test guard

`pg-job-store.test.ts` TRUNCATEs the training tables. It refuses to run (the suite fails loudly) unless `TEST_DATABASE_URL` points at a loopback host (127.0.0.1, ::1, localhost), a port other than 5432, and a database not named `portfolio`. Without `TEST_DATABASE_URL` one placeholder test is reported as skipped. Use the throwaway container above, never a real database.

## Compose service

`trainer` in `docker-compose.yml` uses the image `ghcr.io/vipga195/portfolio-trainer:latest` (Dockerfile stage `trainer`) and sits behind the compose profile `trainer`, so a plain `docker compose pull` or `docker compose up -d` ignores it until the image exists and you opt in with `--profile trainer`. Limits: 1 CPU, 1 GB RAM, 128 pids, read-only filesystem with a `/tmp` tmpfs, `no-new-privileges`, no published ports, no `env_file` (it gets only the `PG*` variables, not the SMTP secrets). `stop_grace_period: 40s` covers the trainer's 30 s shutdown grace.

**Dockerfile rule:** `runner` must stay the LAST stage. CI builds the default (last) target as the website image and has no `target:`; a stage added after `runner` would silently become the site image.

## Deploy checklist (prod host)

The trainer shares CPU and RAM with jellyfin, qbittorrent and the other services on this host: keep the compose limits.

1. **Schema (manual, run by the OWNER, never by an agent).** Additive and idempotent (`CREATE ... IF NOT EXISTS`, new tables only, `contact_messages` is not touched by this file):

   ```sh
   docker exec -i portfolio-db psql -U portfolio -d portfolio -v ON_ERROR_STOP=1 < db/migrations/003_training.sql
   ```

   `scripts/migrate.ts` is for fresh or dev databases and for later use from the trainer image. Do not use it for the first prod run: 001 and 002 (`ALTER TABLE contact_messages ... IF NOT EXISTS`) briefly take a lock on `contact_messages` even when nothing changes.
2. **CI follow-up (required before the image exists).** Add a second `docker/build-push-action` step to the workflow with `target: trainer`, pushing `ghcr.io/vipga195/portfolio-trainer`. The existing job must keep building the default stage (`runner`), which is why `runner` stays last in the Dockerfile. The trainer stage has not been built yet.
3. **Start (after the image is pushed):**

   ```sh
   docker compose --profile trainer pull trainer && docker compose --profile trainer up -d trainer
   ```
4. Public quotas and the public API are phase 3 and not part of this change.
