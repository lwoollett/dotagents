---
name: askj-dev-db-provisioning
description: "Provision the local dev Postgres (askj_dev on :5566) so PrivateAI.API's RlsIsolationTests integration test passes"
---

## Symptom
`dotnet test` in PrivateAI.API fails on `RlsIsolationTests` (Trait Category=Integration) with either:
- connection refused / socket error → dev Postgres not running (port 5566), or
- `28P01: password authentication failed for user "askj_dev"` → container up but askj_dev role/db missing (Postgres masks a missing role as auth failure).

## Fix
1. Start the dev DB:
   ```
   cd PrivateAI.Infrastructure/docker && docker compose -f docker-compose.dev.yml up -d postgres
   ```
   Container `privateai-dev-db` publishes 5566 but only provisions `privateai_dev` user/db — the test needs `askj_dev`.
2. Provision the test identity (superuser so the test can create/drop subject roles):
   ```
   docker exec privateai-dev-db psql -U privateai_dev \
     -c "CREATE ROLE askj_dev LOGIN PASSWORD 'askj_dev_pass' SUPERUSER;" \
     -c "CREATE DATABASE askj_dev OWNER askj_dev;"
   ```
3. Apply EF migrations (AskJDbContextFactory reads DATABASE_URL env var):
   ```
   cd PrivateAI.API && DATABASE_URL="Host=localhost;Port=5566;Database=askj_dev;Username=askj_dev;Password=askj_dev_pass" \
     dotnet ef database update --project AskJ.Api.csproj
   ```
4. Re-run the suite; RLS test seeds/cleans its own rows.

## Notes
- No repo script provisions askj_dev — this env is hand-built; connection string duplicated in `tests/AskJ.Api.Tests/RlsIsolationTests.cs` and `local.settings.example.json`.
- Fresh named volume (`pgdata`) starts empty of askj_dev even if the container has run before.
