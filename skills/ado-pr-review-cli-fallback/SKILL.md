---
name: ado-pr-review-cli-fallback
description: "Review an Azure DevOps PR read-only when ADO MCP tools are not mounted, using az CLI + REST + local git"
---

# ADO PR Review — CLI Fallback (MCP tools absent)

Use when the `ado-pr-review` skill applies but `xd://mcp__ado_repo_*` devices are not mounted. Stay READ-ONLY: never vote, comment, merge, or push.

## 1. PR metadata
```bash
az extension add --name azure-devops --yes
az repos pr show --id <N> --org https://dev.azure.com/JadeSoftware \
  --query '{title:title,status:status,source:sourceRefName,target:targetRefName,merge:mergeStatus,draft:isDraft,creator:createdBy.displayName,lastSource:lastMergeSourceCommit.commitId,reviewers:reviewers[].{name:displayName,vote:vote}}'
```

## 2. Existing threads (REST)
Token: `az account get-access-token --query accessToken -o tsv`. Use the DEFAULT token — do NOT pass `--resource 499b84ac-…` (fails AADSTS500011 in this tenant).
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://dev.azure.com/JadeSoftware/AskJ/_apis/git/repositories/<repo>/pullRequests/<N>/threads?api-version=7.1"
```
Route MUST include `/repositories/<repo>/` — omitting it returns an HTML 404. Parse with jq: `.value[] | select(.status!="unknown")`, comments under `.comments[]`.

## 3. Diff
Prefer a local checkout (`ls ~/repos`, e.g. Evaluation → ~/repos/Evaluation):
```bash
git -C <path> fetch origin <source-sans-refs/heads/>
git -C <path> diff <target>...origin/<source> --stat
git -C <path> diff <target>...origin/<source> -- ':!*.lock' > /tmp/pr.diff   # exclude lockfiles
```
Branch source files without checkout: `git show origin/<source>:<path>`.

## 4. CI (optional)
`.../_apis/build/builds?branchName=refs/heads/<source>&$top=5&api-version=7.1` with same bearer token.

## 5. Verify claims before flagging
Grep the branch source (dead code, caching, docstring drift, extra= policy) with `git grep -n <pat> origin/<source> -- <paths>`; don't rely on diff hunks alone. Then apply the ado-pr-review checklist and output format; deliver in chat only.
