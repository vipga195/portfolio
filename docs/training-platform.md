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

## Public API (phase 3a)

Everything is OFF unless the web app runs with `TRAINING_ENABLED=true`. While off, every route answers `404 {"error":"training_disabled"}` before any database access, so deploying the code without the tables is harmless. The owner enables the flag only after applying `003_training.sql` (and `004_training_created_at_index.sql`) and starting the trainer. The compose env of the `portfolio` service is not changed by this work.

| Endpoint | Purpose |
|---|---|
| `POST /api/training/runs` | body `{game, algorithm, episodes, params?}` (no other keys); 201 `{id}` |
| `GET /api/training/runs?limit=N` | newest first, default 20, 1..50 (otherwise 400); public fields plus `eval.overall` when succeeded |
| `GET /api/training/runs/[id]` | public fields, params, evaluation, up to 100 evenly thinned metric rows; id must match `^[1-9][0-9]{0,15}$` else 404 |
| `GET /api/training/runs/[id]/brain` | the brain JSON; 404 unless the run succeeded; cached as immutable for a year |

POST status codes: 201 created; 400 `invalid_body` / `invalid_field` (+`field`); 403 foreign `Origin`; 404 disabled; 413 body over 4096 bytes (checked on `Content-Length` and on the bytes actually read); 415 not `application/json`; 429 `rate_limited` / `queue_full` / `client_limit` / `global_limit` (with `retryAfterSeconds` and `Retry-After`); 500 `server_error` (details only in the server log). The `Origin` check only stops cross-site browser abuse of an anonymous API, not direct callers. List and detail send `Cache-Control: public, max-age=2, s-maxage=2, stale-while-revalidate=5`.

Quotas are enforced atomically in one transaction under an advisory lock (`enqueueWithQuota`). Checked in this order: global, client, queue.

| Limit | Env | Default | Range |
|---|---|---|---|
| Queued runs | `TRAINING_MAX_QUEUED` | 5 | 1..50 |
| Queued + running runs | `TRAINING_MAX_ACTIVE` | 6 | 1..100 |
| Runs per client, rolling 24h | `TRAINING_PER_CLIENT_DAILY` | 3 | 1..100 |
| Public runs overall, rolling 24h | `TRAINING_GLOBAL_DAILY` | 100 | 1..10000 |
| Episodes | - | q-learning 20 000, dqn 5 000 | fixed per algorithm |

Out-of-range values are rejected (500 with a log line), never clamped. `TRAINING_IP_SALT` (optional) is mixed into the client hash.

**Client identity and its limits.** The client key is the `cf-connecting-ip` header only (a single valid IPv4/IPv6 literal; anything else counts as `unknown`, one shared bucket). `x-forwarded-for` is ignored because clients control it. The stored `ip_hash` is SHA-256 of the key: unsalted, an IPv4 hash is brute-forceable (2^32 inputs), so set `TRAINING_IP_SALT` if that matters. Compose publishes port 1995 on all interfaces, so a direct caller can send any `cf-connecting-ip` value and dodge the per-client limit. The per-client limit is therefore NOT sufficient alone; the global budgets and the queue caps are the real protection. 

**Request budgets** (`src/lib/training/limiter.ts`, a bounded fixed-window limiter in process memory: key cap 10 000, O(1) per call, oldest key evicted first; it does not use `src/lib/rateLimit.ts`). Exceeding one gives `429 {"error":"rate_limited","retryAfterSeconds":N}` with `Retry-After`. HEAD requests hit the same GET handlers, so they are covered.

| Budget | Per client | Global (all clients) |
|---|---|---|
| POST create | 5 / 10 min (`TRAINING_POST_PER_CLIENT_10MIN`) | 60 / min (`TRAINING_POST_GLOBAL_PER_MIN`) |
| GET list + detail | 60 / min (`TRAINING_READ_PER_CLIENT_PER_MIN`) | 600 / min (`TRAINING_READ_GLOBAL_PER_MIN`) |
| GET brain | 20 / min (`TRAINING_BRAIN_PER_CLIENT_PER_MIN`) | 120 / min (`TRAINING_BRAIN_GLOBAL_PER_MIN`) |

Both budgets of a request are checked together and atomically (`consume`): it passes only if the per-client and the global budget allow it, then both are charged; a denied request charges nothing and inserts no key. Per-client counters live in a map capped at 10 000 keys (oldest evicted first), so a flood of unique spoofed keys can evict a real client's counter. The global budgets live in a separate small map that is never evicted (at most 32 names), so such a flood cannot reset them: they are the real protection against header spoofing. A clock that moves backwards starts a new window.

Honest limits: (i) the global budgets cap total resource use, they do not guarantee fairness. An attacker with many IPv6 /64s (a single /48 has 65 536) can use up a global budget and cause loss of availability for everyone else. (ii) Binding port 1995 to `127.0.0.1` only removes direct `cf-connecting-ip` spoofing; it does not stop that. (iii) All counters live in the memory of one process (single standalone container); several instances would each have their own.

**Client key canonicalization.** IPv4 as is; IPv4-mapped IPv6 (`::ffff:a.b.c.d`) becomes the IPv4; other IPv6 is reduced to its /64 (zone ids stripped), because one subscriber controls a whole /64.

**Trusted runs are not public.** Runs created with `--trusted` (owner/CLI) never appear in the list, and detail and brain answer them with the same 404 as a missing id.

**Brain download.** The stored JSON text is served as is (`SELECT data::text`), without parsing or re-serializing on the request path.

**Database pool.** The API uses its own pool (max 3, 3 s connect timeout, 5 s `statement_timeout`), created lazily and only when the flag is on, so it cannot starve the contact form's pool. (The contact route still uses `src/lib/rateLimit.ts`, whose pruning scans the whole map once it holds more than 1000 keys; that pre-existing behaviour is untouched.)

**Cloudflare caching.** The brain endpoint sends `Cache-Control: public, max-age=31536000, immutable`. Whether Cloudflare caches `/api/training/runs/*/brain` is an OWNER decision (a cache rule is needed; [ASSUMED, not verified] that Cloudflare does not cache JSON by default). The origin must not rely on it: the limiter and caps above protect it either way.

**Owner decisions**
- Bind port 1995 to `127.0.0.1` in compose if cloudflared runs on the same host, so the header cannot be spoofed by direct callers (not changed here).
- Set `TRAINING_ENABLED=true` on the `portfolio` service only after the migration is applied and the trainer image is running.
- Decide whether to set `TRAINING_IP_SALT`.

## Deploy checklist (prod host)

The trainer shares CPU and RAM with jellyfin, qbittorrent and the other services on this host: keep the compose limits.

1. **Schema (manual, run by the OWNER, never by an agent).** Two additive, idempotent files (`CREATE ... IF NOT EXISTS`, new tables and one new index; `contact_messages` is not touched by either):

   ```sh
   docker exec -i portfolio-db psql -U portfolio -d portfolio -v ON_ERROR_STOP=1 < db/migrations/003_training.sql
   docker exec -i portfolio-db psql -U portfolio -d portfolio -v ON_ERROR_STOP=1 < db/migrations/004_training_created_at_index.sql
   ```

   `scripts/migrate.ts` is for fresh or dev databases and for later use from the trainer image. Do not use it for the first prod run: 001 and 002 (`ALTER TABLE contact_messages ... IF NOT EXISTS`) briefly take a lock on `contact_messages` even when nothing changes.
2. **CI follow-up (required before the image exists).** Add a second `docker/build-push-action` step to the workflow with `target: trainer`, pushing `ghcr.io/vipga195/portfolio-trainer`. The existing job must keep building the default stage (`runner`), which is why `runner` stays last in the Dockerfile. The trainer stage has not been built yet.
3. **Start (after the image is pushed):**

   ```sh
   docker compose --profile trainer pull trainer && docker compose --profile trainer up -d trainer
   ```
4. The public API (see above) stays OFF until the owner sets `TRAINING_ENABLED=true` on the `portfolio` service, after steps 1 to 3. The UI is a separate step.
