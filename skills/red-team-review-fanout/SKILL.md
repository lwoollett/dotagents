---
name: "red-team-review-fanout"
description: "Use when the user asks for a full/red-team/adversarial security review of one or more whole repos (not a branch diff) or the follow-on live/deployment check: 5-lane parallel reviewer fan-out with claude-red vault methodology, parent spot-verification, live-check tiering, findings→ADO Bugs, and wiki reporting (see ado-wiki skill). Carries the PrivateAI overlay."
---

# Red-Team Review Fan-Out (multi-repo static security review + live check)

Use when the user asks for a full / red-team / adversarial **security review of whole codebases** (not a branch diff — that's `branch-review-parallel`), including the follow-on live/deployment phase. Carries the PrivateAI overlay.

## Preconditions
- Authorization: owner-commissioned review of their own code (claude-red scope rule). Refuse open-ended "test this random host".
- Record each repo's branch/HEAD/`git status --porcelain` vs origin first — findings must cite exact SHAs. Verify today's actual date (`date`) before naming artifacts — never trust a date from memory anchors.

## Lane fan-out (static phase)
One workflow: `runs.all([...])`, agent `reviewer` (read-only enforced), `skill: false`, `cwd` per repo, `timeoutMs: 3600000`, `async: true`. Five disjoint lanes keyed by concern:

| Lane | Scope | Vault methodology (read FIRST, absolute paths) |
|---|---|---|
| api-authz | token validation, per-endpoint privilege matrix, admin gating, tenant/RLS isolation, IDOR | `api/offensive-api-security`, `auth/offensive-jwt`, `auth/offensive-oauth`, `web/offensive-idor` |
| api-abuse | injection/deserialization sinks, business logic + domain rules (TTL/quota), LLM/tool/MCP surface, streaming, secrets | `web/offensive-sqli`, `web/offensive-business-logic`, `web/offensive-race-condition`, `web/offensive-deserialization`, `ai/offensive-ai-security` |
| webui-client | DOM sink hunt, native bridge protocol, token storage, CSP/headers, open redirect, auth flows, build config | `web/offensive-xss`, `web/offensive-open-redirect`, `api/offensive-api-abuse` |
| infra | exposure inventory per resource, platform auth/CORS, secrets + state, identities, config drift | `cloud/offensive-cloud`, `cicd/offensive-cicd-secrets` |
| supply-chain | manifests + lockfiles across ALL repos, lifecycle scripts, CI pipelines, committed creds, version pins | `supply-chain/offensive-supply-chain`, `supply-chain/offensive-dependency-confusion`, `cicd/offensive-cicd-secrets` |

Vault root: `~/.agents/skills-vault/claude-red/Skills/<category>/<skill>/SKILL.md` (restore per the claude-red router if missing).

## Lane-brief anatomy (each task fully self-contained — children are fresh contexts)
1. CONTEXT: system shape, authorization statement, read-only rule.
2. Vault skill paths to read first, then "prefer exhaustive grep sweeps over sampling for sink classes; read the sink before claiming".
3. Strict evidence rules: severity + file:line + verbatim snippet + end-to-end attack path; untraced claims labeled "SUSPECTED — needs live check"; an "explicitly verified good" list so cleared concerns are never re-litigated.
4. DO-NOT-FLAG list of intentional AGENTS.md anti-patterns (else reviewers burn effort on by-design items).
5. PRIOR-FINDINGS table to status FIXED/OPEN/NOT FOUND with evidence — feed from memory of the previous review.
6. Output format: VERDICT / FINDINGS / VERIFIED-GOOD / PRIOR-FINDINGS STATUS / OPEN QUESTIONS FOR LIVE CHECK.
Note: reviewer agents have no web access — supply-chain lane must end with an exact-pinned version table for the parent's online advisory check.

## Parent duties (static phase)
- While children run: quick grounding pass (repo trees, key files) so you can validate claims later.
- After completion: read every artifact in FULL; **spot-verify each lane's top 2-3 claims with direct greps before reporting** (2026-10-09 run: 10/10 verified — keeps subagent overclaims out of the report).
- Merge cross-lane duplicates; recalibrate severity with cross-lane context (e.g. infra "SSO authority common" was downgraded because the api-authz lane proved MSA→Pending + unknown-tenant→Disabled provisioning).
- Deliver: consolidated severity-ranked report (✓-mark parent-verified items) + verified-good summary + prior-findings status + prioritized live-check queue built from the lanes' OPEN QUESTIONS; reference the per-lane artifact paths.
- `learn()` the findings — they become next review's PRIOR-FINDINGS table.

## Live-check phase (run after static, scope via ask_user_question)
Tier the checks; get user approval for scope (envs, throwaway account, control-plane reads, internal hosts):
1. **Passive unauth**: `curl -sI` SWA (headers/CSP), `.js.map`/`.css.map` fetch, fetch main JS chunk → extract `PUBLIC_API_URL` (API host discovery) + enumerate `/api/...` strings; API `/api/health` + `/api/version` (commit disclosure, code-mapping); `http://` vs redirect (httpsOnly); CORS preflight with `Origin: https://evil.example` (expect zero ACA headers).
2. **Control plane (az, read-only)**: `az functionapp show --query httpsOnly`, `config appsettings list` (drift, CORS, log override), `az containerapp list/show` (ingress external?), probe container FQDN paths unauth, `az keyvault network-rule list` (count stale ipRules), `az ad app show --query signInAudience`.
3. **Authenticated tier** (throwaway self-signup — expect pending-approval gate; owner approves): login → decode JWT claims; PoCs per findings; **always run a control request** to isolate causality (e.g. payload probe vs plain stream); IDOR probe (random UUID → 404); JWT tamper (flip role, keep signature → 401); **cleanup via API (delete test chats) + hand owner the account name for deletion**.
4. Publish per the wiki convention below.

Gotchas learned 2026-10-09:
- ADO artifact download via REST: `az devops invoke` lists artifacts but the `artifacts.visualstudio.com` content URL needs its own token; session AAD token may fail (AADSTS500011 tenant quirk) — have the user download via browser session or PAT for the PoC.
- `tee` piping breaks JSON parse (HTTP status line contaminates the file) — save raw response, parse separately.
- Tool-call PoCs need explicit `activeTools:["<plugin>"]` in the stream request, else the model may answer (or fabricate!) without calling — verify via `event: tool_status` frames AND the DB ledger row, not the prose answer.

## Findings → work items (Boards)
- Confirm scope + type with the user (house precedent: Task for ordinary work; **Bug for security findings, chosen 2026-10-09**, severities 2/3/4 = High/Medium/Low).
- Create: `az boards work-item create --type Bug --title "[SEC-<SEV>] …" --fields "System.AreaPath=AskJ\\AskJ Release" "System.Tags=security; R1; <backend|infra|webui>" "Microsoft.VSTS.Common.Severity=2 - High" --description "…"` (agile-process severity values are strings like "2 - High"; tags semicolon-separated, auto-created).
- Group LOW/INFO findings into one hygiene Bug per repo rather than flooding the board (user preference 2026-10-09).
- Then attach `[#NNNN](https://dev.azure.com/JadeSoftware/AskJ/_workitems/edit/NNNN)` links to each finding row/heading in the wiki (Ticket column; annotate deliberate non-tickets as — known/existing/waived).

## Report publishing (ADO wiki)
Follow the **ado-wiki** skill for all wiki mechanics (page create, wikiMaster git edits, tree/content reads, GFM separator gotcha). Review-specific structure: one dated parent page per campaign = `/Security Reviews/YYYY-MM-DD <Name>` holding the combined static+live executive report, plus one child page per phase (`…/Static Analysis`, `…/Live Check (Dev)`); findings tables carry the Ticket column; update the `/Security Reviews` index.

## PrivateAI overlay
- Repo map: `PrivateAI.API` (main), `PrivateAI.WebUI` (main), `PrivateAI.Infrastructure` (master — includes docker/, pipelines/, scripts/, Caddyfile beyond terraform/). Root: `/Users/luke/repos/PrivateAI`.
- Dev env: SWA `https://proud-pebble-03adae500.7.azurestaticapps.net`, API `https://func-privateai-dev-aueast.azurewebsites.net`, rg `rg-privateai-dev-aueast`, KV `kv-privateaidevaueast`, MCP container `ca-askj-mcp-dev-aueast` (public ingress, app-level 401). Wiki: `AskJ.wiki` — reports under `/Security Reviews/`.
- 2026-10-09 tickets: #4887 H1 TTL, #4888 M1 role injection, #4889 M2 payloads, #4890 M3 export audit, #4891 M5 KV ipRules, #4892 M6 token handling, #4893 M7 GB10, #4894 M8 SSO common, #4895 M9 CSP, #4896 M11 build layers, #4897 httpsOnly, #4898/#4899/#4900 hygiene backend/webui/infra. Not ticketed: H2 (known), H3 (existing #4831), M4 (waived), M10 (accepted).
- API shapes for PoCs: `POST /api/chats {"content":...}` → `{chat_uuid}` (NOT title); `POST /api/chats/{id}/messages {"role","content","name"}`; `GET /api/chats/{id}` returns all messages incl. tool ledger rows; `PATCH /api/users/me/config {"toolResultTtlHours":N}`; stream = `POST /api/chats/{id}/stream {"content","activeTools","mcpTools"}`.
- Do-not-flag: no rate limiting; no request-validation middleware; hidden tools always-on with `activeTools` = bare plugin names; TTL'd rows "physically deleted" is the rule (flag violations OF it, not the rule); gitignored `local.settings.json`/`.sisyphus/`; bun CI-pin 1.3.14 vs local 1.2.19 quirk.
- Known-good lists from prior reviews (markdown sanitizer defaults, mermaid strict, shiki, iframe sandbox, VULN-012 double gate, JWT claims re-read from DB) — re-verify briefly, list as verified-good, don't re-litigate.
- Bridge findings: fix direction is the frozen WI #4831 contract at `WebUI/.sisyphus/plans/bridge-security-handshake.md` (don't flag its existence).
- Reviewer artifacts land in `~/.luke/.pi/agent/sessions/--Users-luke-repos-PrivateAI--/subagent-artifacts/<runid>_reviewer_output.md`.
