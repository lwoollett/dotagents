---
name: "ado-wiki"
description: "Use when reading, publishing, or editing Azure DevOps wiki pages (AskJ.wiki in JadeSoftware/AskJ): page tree/content reads, new-page creation via az CLI, content edits via the wikiMaster git repo, GFM table gotchas, and the Security Reviews page conventions."
---

# ADO Wiki (AskJ.wiki) — read, publish, edit

Read/list wiki pages and publish/edit content on the JadeSoftware/AskJ project wiki. Reads are free; page creation via az CLI; **content edits via wiki-git push** (the update CLI path is broken — see below).

## Context (hard-coded)
- Org `JadeSoftware` · Project `AskJ` · single project wiki **`AskJ.wiki`**.
- Once per session: `az devops configure --defaults organization=https://dev.azure.com/JadeSoftware project=AskJ` (silences git-remote autodetect warnings).

## Reading
- **Page tree:** `az devops wiki page list` does NOT exist. Use:
  `az devops invoke --area wiki --resource pages --route-parameters project=AskJ wikiIdentifier=AskJ.wiki --query-parameters api-version=7.1 recursionLevel=Full` → walk `subPages` recursively.
- **Page content:** `az devops wiki page show --wiki AskJ.wiki --path "/…" --include-content` — `--include-content` is **mandatory**, otherwise `content` comes back empty (do not misread as a failed publish).
- Page JSON exposes `id`/`path`/`remoteUrl` but **no eTag/version**.

## Writing — new pages (az CLI works)
- `az devops wiki page create --wiki AskJ.wiki --path "/Parent/Child" --content "$(cat file.md)" -o none`
- **Ancestor pages must already exist** — create the parent first; `page create` never auto-creates ancestors (error: "One or more ancestor pages … does not exist").
- Long markdown via `--content "$(cat …)"` is fine (13KB+ verified).
- Deleting: `az devops wiki page delete --wiki AskJ.wiki --path "/…" --yes` (delete children before parents).

## Writing — editing existing pages (CLI is broken; use wiki git)
1. `page update` requires `--version <eTag>` that `page show` never returns → effectively unusable.
2. `az devops invoke --http-method PATCH --area wiki --resource pages …` → ERROR "The requested resource does not support http method 'PATCH'".
3. **Reliable path — push to the wiki git repo:**
   - `git clone git@ssh.dev.azure.com:v3/JadeSoftware/AskJ/AskJ.wiki` (same SSH auth as code repos)
   - Default branch is **`wikiMaster`** (not master/main) — `git push origin wikiMaster`
   - **File naming is percent-encoded:** spaces → `-`, `-` → `%2D`. E.g. page `/Security Reviews/2026-10-09 Full-Stack Red-Team` → file `Security-Reviews/2026%2D10%2D09-Full%2DStack-Red%2DTeam.md`; parens stay literal (`Live-Check-(Dev).md`). `ls` after cloning to confirm names.
   - `.order` files (one filename per line) control sibling page ordering in the tree.
   - After push, verify with `page show --include-content` (allow a few seconds for render).

## Markdown gotchas (ADO wiki ≈ GFM)
- **Table separator rows must match the header's cell count exactly.** When appending a column to an existing table, regenerate the separator as `|` + `---|` × ncols — a short/merged separator (e.g. `|---|---|------|` after naive string-append) silently breaks the table.
- Don't `tee` CLI output that will later be JSON-parsed (HTTP status lines contaminate the stream — parse failures, not real API errors).

## House conventions
- Security reports live under `/Security Reviews/`: an index page links each campaign; each campaign is one dated parent page (`/Security Reviews/YYYY-MM-DD <Name>`) holding the combined executive report plus one child page per phase (e.g. `Static Analysis`, `Live Check (Dev)`). Findings tables carry a Ticket column linking work items.
- **Check the actual system date (`date`) before naming dated pages** — never trust a date recalled from memory.
