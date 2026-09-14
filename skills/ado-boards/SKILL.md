---
name: ado-boards
description: Pull and manage Azure DevOps Boards (Kanban) for a team. Read actions are free; any creative/destructive action is proposed as a diff and only executed after the user explicitly confirms in chat. Renders a team's board grouped by Kanban column; supports create/update/move/close/comment/link with optional filters by team, board level (Stories/Features/Epics/Tasks), work-item type, assignee, iteration, tags, or state. Use when the user asks to view/pull/show a board or backlog, list stories/features/bugs for a team, OR to create/move/close/reassign/tag/estimate/comment-on/link work items — e.g. "show the PrivateAI Release board", "move #4720 to done", "create a story", "close the bug", "assign #4711 to <name>", "add a comment".
version: 2.0.0
user-invocable: true
argument-hint: "[team] [board level: stories|features|epics|tasks]"
---

# Azure DevOps Boards (team-filtered, confirmation-gated writes)

Render a team's Kanban **board** from the `JadeSoftware` / `AskJ` project, and mutate work items **only after explicit user confirmation** of each proposed change.

## HARD CONSTRAINTS (non-negotiable)

1. **CONFIRMATION GATE — the single most important rule.** Every creative/destructive action (anything that mutates ADO) MUST be proposed in chat as a **Proposed Change** block, then **executed only after the user gives an explicit, unambiguous confirmation** (e.g. "yes", "do it", "confirmed"). Reads are never gated.
2. **One logical change per confirmation.** Never sneak extra edits into a confirmed batch. A batch is allowed only if every line is the *same kind* of change and each row is individually visible/vetoable; otherwise confirm them separately.
3. **No silent writes.** If intent is ambiguous, propose the most likely interpretation in the Proposed Change block and ask — do not guess and fire. An absent/unclear "yes" means **do not write**.
4. **Verify after writing.** Immediately re-read the affected work item(s) and report the new state. The user's confirmation + your verification is the proof.
5. **Idempotent, surgical writes.** Change only the fields requested. Prefer `update` with explicit `/fields/...` paths over re-creating. Never overwrite a field to the same value.

## CONFIRMATION PROTOCOL (follow exactly for every write)

```
1. INTENT  → parse what the user wants; gather missing IDs/values via READS (free, ungated).
2. PROPOSE → emit a "Proposed Change" block (see OUTPUT FORMAT): exact tool, target item(s),
             old → new per field, and the blast radius (1 item? N items? team-wide?).
3. STOP    → do NOT call any _write tool. Wait for the user's explicit confirmation.
4. EXECUTE → only on an unambiguous "yes": call the write tool with the agreed params.
5. VERIFY  → re-read (get/get_batch) the touched item(s); emit "Applied" with the new values.
```

- Reads needed to build an accurate proposal (`get`, `get_batch`, list teams/levels) are **always allowed** — do them freely, no confirmation.
- If the user's request spans multiple independent writes, propose them as a numbered list in ONE Proposed Change block and require a single confirmation for the set — but allow per-line veto ("yes to 1 and 3, skip 2").

## CREATIVE/DESTRUCTIVE ACTIONS (all gated — none may run without confirmation)

| Action | Tool + `action` | Notes |
|---|---|---|
| Create work item | `ado_wit_work_item_write` `create` | needs `workItemType` + `fields` |
| Create child items | `ado_wit_work_item_write` `add_child` | under `parentId` |
| Update fields (move card, state, assign, points, tag, iteration) | `ado_wit_work_item_write` `update` | `/fields/...` paths, `op: Add\|Replace\|Remove` |
| Update many items | `ado_wit_work_item_write` `update_batch` | one row per item |
| Add / edit comment | `ado_wit_work_item_comment_write` `add\|update` | Markdown default |
| Link / unlink / PR-link / artifact-link | `ado_wit_work_item_link_write` `link\|unlink\|link_to_pull_request\|add_artifact_link` | see types below |

> **Risk envelope:** these tools cannot hard-delete work items (no delete action exists). "Destructive" here = **close** (`System.State=Closed`), **unlink**, or **remove** a field value — all reversible. Closing is the most consequential; call it out explicitly in the proposal. Irreversible deletion is not supported and should be refused with that explanation.

## PROJECT CONTEXT (hard-coded — don't re-derive)

- **Org:** `JadeSoftware` · **Project:** `AskJ` (process: **Agile**; User Story/Feature/Task/Bug states: `New → Active → Resolved → Closed`).
- **Teams** (resolve aliases/fuzzy to these):
  | Team | Notes |
  |---|---|
  | `AskJ Team` | Default project team |
  | `PrivateAI Release` | Release board for PrivateAI |
- **Board levels → `backlogId`** (process constants; identical across both teams; `Epics` hidden by default):
  | Level | `backlogId` | Work item types | Default for |
  |---|---|---|---|
  | Stories | `Microsoft.RequirementCategory` | User Story | "board" with no level given |
  | Features | `Microsoft.FeatureCategory` | Feature | "features"/portfolio |
  | Epics | `Microsoft.EpicCategory` | Epic | "epics" (may be hidden per team) |
  | Tasks | `Microsoft.TaskCategory` | Task, Bug | "tasks"/"sprint board"/"bugs" |
- **Known identities** (for assignment): `Luke Woollett <lwoollett@jadeworld.com>` For others, resolve via `ado_core_get_identity_ids` before proposing an assignment.

## KEY MECHANICS (verified — read before acting)

1. **Teams own their boards.** The backlog API (`ado_wit_backlog`) is **team-scoped by design**: `list_work_items { project, team, backlogId }` returns only that team's board items (server resolves the team's area paths). Authoritative team filter.
2. **`list_work_items` returns IDs only** (`[].target.id`). MUST follow with `ado_wit_work_item { action:"get_batch" }` to hydrate.
3. **Board columns are a real field.** `System.BoardColumn` (Kanban column) + `System.BoardLane` (swimlane) hydrate via `get_batch`/WIQL — group the board by `System.BoardColumn` for a true Kanban view. **To move a card, set `System.BoardColumn`** (and `System.BoardColumnDone:true`/`false` when the column is split into doing/done).
4. **Do NOT infer team from area path** for filtering — names don't map 1:1 here (`AskJ\AskJ Release`). Use the team-scoped backlog API.
5. **Batch cap:** `get_batch` ≤200 IDs/call; `update_batch` one row per item.

## INPUT PARSING

Resolve, in order; ask once only if still ambiguous.

- **Team** — fuzzy-match arg/body to the two teams. Aliases: "release"/"privateai" → `PrivateAI Release`; "default"/"main"/"us" → `AskJ Team`. **No team given → Workflow A first**, default `AskJ Team` unless user picks.
- **Board level** — `stories|story|board|backlog`→Stories; `features|feature|portfolio`→Features; `epics|epic`→Epics; `tasks|task|sprint|bugs|bug`→Tasks. **Default Stories.**
- **Work-item ids** — parse `#4720` / `4720` / "the SSO story"; resolve titles to IDs via a quick WIQL or `get` when needed.
- **Mutation intent** — verbs: create/move/close/reassign/assign/tag/estimate/point/comment/note/link/parent/split/iterate. Map to the gated-actions table.

## READ WORKFLOWS (ungated)

### A — Discover teams (no/unknown team)
`ado_core_list_project_teams { project:"AskJ", top:100 }` → present `Team | description` (`mine:true` for "my teams"). Default to `AskJ Team` then continue.

### B — Pull a team's board (MAIN READ PATH)
```
ado_wit_backlog { action:"list_work_items", project:"AskJ", team:<team>, backlogId:<level> }
ado_wit_work_item { action:"get_batch", project:"AskJ", ids:[...target.id], fields:[
  "System.Id","System.WorkItemType","System.Title","System.State","System.AssignedTo",
  "System.BoardColumn","System.BoardLane","System.IterationPath","System.Tags",
  "Microsoft.VSTS.Scheduling.StoryPoints","Microsoft.VSTS.Scheduling.Effort","Microsoft.VSTS.Scheduling.RemainingWork"] }
```
Optionally `ado_wit_backlog { action:"list", project, team }` to confirm levels/hidden Epics first. Render per OUTPUT FORMAT.

### C — Custom query (WIQL)
For cross-team / by-assignee / by-iteration / by-tags cuts. Returns IDs only → hydrate via B-step-2. Pass `team` for correct `System.BoardColumn` context.
```
ado_wit_query { action:"wiql", project:"AskJ", team:<team>, top:200, wiql:
  "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject]='AskJ'
   AND [System.WorkItemType] IN ('User Story','Bug') AND [System.State] <> 'Closed'
   AND [System.AreaPath] UNDER 'AskJ\\<team-area>' ORDER BY [System.BoardColumn]" }
```
Fragments: assignee `AND [System.AssignedTo] = @me` · iteration `AND [System.IterationPath] = @currentIteration('[AskJ]\\My Team')` · type `= 'Bug'` · state `= 'Active'` · tags `CONTAINS 'x'`.

### D — My work items
`ado_wit_work_item { action:"my", project:"AskJ", type:"assignedtome", includeCompleted:false }`.

## WRITE WORKFLOWS (ALL gated — propose, confirm, then execute + verify)

For every workflow below: **read first to capture current values (for the old→new diff), emit the Proposed Change block, STOP, then execute only on confirmation, then re-read to verify.**

### W1 — Move card / change state
Set `System.BoardColumn` (move on Kanban) and/or `System.State`. Confirm column split direction via `System.BoardColumnDone` when relevant.
```
ado_wit_work_item_write { action:"update", project:"AskJ", id:<id>, updates:[
  { op:"Replace", path:"/fields/System.BoardColumn", value:"Done" } ] }
```
State values: `New`/`Active`/`Resolved`/`Closed`. Closing = `System.State:"Closed"` (flag as most-consequential in proposal).

### W2 — Create work item
```
ado_wit_work_item_write { action:"create", project:"AskJ", workItemType:"User Story", fields:[
  { name:"System.Title", value:"..." },
  { name:"System.Description", value:"...", format:"Markdown" },
  { name:"System.AreaPath", value:"AskJ\\<team-area>" },     // only if scoping to a team area
  { name:"System.IterationPath", value:"AskJ" },
  { name:"Microsoft.VSTS.Scheduling.StoryPoints", value:"3" } ] }
```
Proposal must state type, title, area/iteration, points, and which team's board it will land on. Result returns the new `id` — verify with `get`.

### W3 — Add child items (split a story)
```
ado_wit_work_item_write { action:"add_child", project:"AskJ", parentId:<id>, items:[
  { title:"...", description:"...", format:"Markdown" } ] }
```
Confirm each child's title + parent before running.

### W4 — Comment
```
ado_wit_work_item_comment_write { action:"add", project:"AskJ", workItemId:<id>, text:"...", format:"Markdown" }
```
Show the verbatim comment text in the proposal (user is approving these exact words). `update` needs `commentId`.

### W5 — Link / parent / unlink
```
ado_wit_work_item_link_write { action:"link", project:"AskJ", updates:[
  { id:<a>, linkToId:<b>, type:"parent" } ] }   // parent|child|related|duplicate|successor|predecessor|tests|…
```
`unlink { id, type, url? }` is destructive (removes link) — call it out. PR/commit links: `link_to_pull_request` / `add_artifact_link` (needs `projectId` GUID; repo/PR/commit/build ids).

### W6 — Reassign / tag / estimate / iterate (generic field update)
```
ado_wit_work_item_write { action:"update", project:"AskJ", id:<id>, updates:[
  { op:"Replace", path:"/fields/System.AssignedTo", value:"Name <email>" },
  { op:"Add",      path:"/fields/System.Tags", value:"blocked" },            // Add appends a tag
  { op:"Replace", path:"/fields/Microsoft.VSTS.Scheduling.StoryPoints", value:"5" },
  { op:"Replace", path:"/fields/System.IterationPath", value:"AskJ\\Sprint 3" } ] }
```
Writable fields quick-ref: `System.Title`, `System.Description`, `System.State`, `System.AssignedTo` (`Name <email>`), `System.Tags` (semicolon-delimited; `Add`/`Remove`), `System.AreaPath`, `System.IterationPath`, `System.BoardColumn`, `Microsoft.VSTS.Scheduling.StoryPoints|Effort|RemainingWork`, `Microsoft.VSTS.Common.Priority|BusinessValue`.

### W7 — Batch (same change, many items)
`update_batch` — one `batchUpdates` row per id. Propose as a table (id | change). Same-rule-only batches; otherwise split into per-change confirmations.

## OUTPUT FORMAT — board snapshot (reads)

```markdown
# <Team> — <Level> board  (<n> items · <Active> active · <Blocked> blocked · snapshot <date>)
**Filters:** <none | assignee=… · iteration=… · tag=…>
## 📋 New  (<k>)
- **#4720** SSO tested for RLS and Separate ORG DB — *Active* · @lwoollett · 3pt · `auth,rls`
## 🔨 Active  (<k>)
- …
## ✅ Closed  (<k>)
- …
---
**Summary**  New n · Active n · Resolved n · Closed n  |  By assignee: @lwoollett x · unassigned x  |  Blocked: <#ids or none>
```
One bullet per item: `**#id** Title — *State* · @assignee(or unassigned) · points(if any) · \`tags\``. Link `https://dev.azure.com/JadeSoftware/AskJ/_workitems/edit/<id>`. If `System.BoardColumn` blank, group by `System.State` and note the fallback.

## OUTPUT FORMAT — Proposed Change (writes — STOP here, await confirmation)

```markdown
## ⚠️ Proposed change  ·  <team> <level>
**Tool:** ado_wit_work_item_write `update`
| # | Field | Old → New |
|---|---|---|
| 4720 | System.BoardColumn | Active → Done |
| 4720 | System.State | Active → Resolved |
**Blast radius:** 1 item. Reversible.
Reply **yes** to apply, or tell me what to change.
```
- Always show **old → new** (read current values first). For creates, show the full new field set; for comments, the verbatim text.
- Always state **blast radius** (item count, team scope) and **reversibility**. Flag closes/unlinks as more-consequential.
- Then **stop**. Do not call the write tool.

## OUTPUT FORMAT — Applied (after confirmation + execution)

```markdown
## ✅ Applied
- #4720: BoardColumn Active→Done · State Active→Resolved  (verified)
```
Always include the verification (re-read confirms the new values). If a write partially failed, report exactly which rows applied and which didn't.

## DO NOT
- Do not call any `_write` tool without an explicit user confirmation received **after** the Proposed Change block. No confirmation = no write.
- Do not fold unrelated edits into one confirmed call, or quietly add fields the user didn't ask for.
- Do not render `list_work_items` directly — IDs only; always hydrate with `get_batch`.
- Do not guess team→area-path, assignee identity, or backlog IDs — resolve via `list_project_teams` / `get_identity_ids` / `ado_wit_backlog list`.
- Do not fetch more than needed: request only fields you'll show or set; reuse known project/team from prior context.
- Do not claim a write succeeded without re-reading to verify.
