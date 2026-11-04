---
name: "jade-to-zom"
description: "Port a JADE/Orb example app (JADE-Orb-Examples .scm schema + Orb templates) to a single-binary Zig app on zom at ~/repos/zom — schema mapping table, Orb route/template/session conversion, JADE quirk checklist, verification bar"
---

# Converting a JADE/Orb example app to zom

Port apps from https://github.com/jadesoftwarenz/JADE-Orb-Examples
(JADE `.scm` schema + Orb HTML templates) to single-binary Zig apps on
zom (`~/repos/zom`). Reference implementation: DealerApp →
`~/repos/zomorbdemo/dealer-app` (zom 0.3.1, Zig 0.17, 13 tests, full
game cycle smoke-verified). Remaining examples: JVSummitApp,
JadeStudio, AnyList.

## Procedure

1. **Read the source fully before writing anything.**
   `<App>/<App>Schema.scm`: `typeHeaders` (class list),
   `membershipDefinitions`, `memberKeyDefinitions`,
   `inverseDefinitions`, `databaseDefinitions` (ignore),
   `typeSources` (method bodies — the actual behavior spec, incl.
   `OLD`/`OLD1` dead variants you can drop). Plus the app README and
   the template directory (`new/*.html`, `style.css`).
2. **Scaffold the consumer app** (`~/repos/zomorbdemo/<app>/`):
   `build.zig.zon` with `.name` in underscores and a path dep
   `.zom = .{ .path = "../../zom" }` (fabricate a fingerprint, then
   paste the value zig's error suggests); `build.zig` wiring
   `dependency("zom").module("zom")` into app + test modules
   (`src/tests.zig` root registering `*_test.zig` files); run steps
   with `addPassthruArgs()`.
3. **Map the schema** to `src/model.zig` (table below). Preserve the
   source's constants (state numbers, blinds, category values) so the
   port is diffable against the original.
4. **Port method sources** into an engine module (`game.zig`-style):
   all functions take `tx: *zom.Transaction` (+ an arena for scratch
   slices) and NEVER commit — the caller owns the transaction. Pure
   logic (evaluators, scoring) goes in its own module with unit tests.
5. **Web layer**: templates as real files in `src/web/`, a small
   binder, routes + cookie sessions in `src/main.zig`.
6. **Tests per module** + one engine-level suite against a real zom db
   (`std.testing.tmpDir(.{})`, path
   `".zig-cache/tmp/{s}/t.db"` with `tmp.sub_path`, `registerClass`
   every class, `.event_log = .off`).
7. **curl smoke test** driving the full user flow with cookie jars —
   fresh jars per db wipe, and keep each curl batch inside any turn
   deadline (timeout auto-fold will otherwise fire mid-verification).
8. **README**: mapping table + deliberate divergences (below).

## Schema → zom mapping

| JADE | zom |
|---|---|
| class in `typeHeaders` | struct with `pub const zom = .{ .class_id, .layout_version, .property_ids, .relationships }` |
| `constantDefinitions` | `pub const` on the struct (same values) |
| attribute fields | plain fields (ints/floats/bool/`[]const u8`/optionals; **`u8` is rejected — use `i32`**) |
| `referenceDefinitions` + `inverseDefinitions` | `?Ref(T)` field + `.relationships` entry (`.id`, `.cardinality`, `.on_delete`) |
| `Array` subclasses (`implicitMemberInverse`, e.g. `CardArray`) | `tx.createSeq(T)`, serial stored as an i64 property field, rebuilt via `SeqRef(T).fromOid(.{ .database_id = tx.db.db_id, .serial = @intCast(v) })`; `_ = try tx.seqAppend(...)` (returns a position) |
| `MemberKeyDictionary` subclasses | `tx.createDict(T, K)` / `createDictMulti` — or drop entirely if the app only ever used it as a lookup the port can do with a named root or an in-tx slice |
| `Felt.firstInstance` / per-app singletons | named root: `tx.getRoot(T, "felt")` / `tx.setRoot` |
| `beginTransaction`…`commitTransaction` around each step | ONE `session.begin(.read_write)` tx per request/op; engine never commits |
| transient objects (`create X transient`, e.g. `PlayerHand`) | plain stack values / arena slices in the engine — nothing persisted |
| `beginTimer(n, Timer_OneShot, tag)` + `timerEvent` | `deadline_ms` i64 field checked by a `tick(tx, felt, now_ms)` invoked on every request; the poll cadence is the clock. Thread ONE `now_ms` through all advancement — never call `zom.wallClockMillis()` deep inside (mixed clocks make timers expire instantly) |
| `app.generateUuid` | 8 `arc4random_buf` bytes → 16 hex chars (declare the externs; `std.crypto.random` is gone in 0.17) |
| `GameUtils@uniformRandom` (crypto rejection sampling) | `extern fn arc4random_uniform(upper: u32) u32` |
| `sendMsg` cross-thread poke | direct function call (single-threaded engine under a mutex) |
| `app.doWindowEvents(ms)` pacing | delete |
| `protected` / `readonly` modifiers | enforce in engine code, not the model |
| `instances.purge` cleanup scripts | cascade delete from the root, or document a db wipe |

## Orb web layer → zom HTTP

- **Routes**: `Orb@addRoute("GET", "/", MainRoute)` etc. → same
  method+path dispatch in `src/main.zig` (copy the kanban-web HTTP
  plumbing: `readUntilHeaders`, body read via Content-Length,
  `respond` with an optional Set-Cookie header). Illegal actions render
  current state and LOG the error — never swallow silently.
- **Sessions**: `Orb@sessionData`/`sessionStart` → a cookie
  `dzp=<gameid>.<serial>` where gameid is the root object's random id.
  The gameid binds the session to one db generation — after a
  wipe+recreate, serial allocation restarts and a bare `<serial>`
  cookie silently aliases a DIFFERENT player (hit during the DealerApp
  smoke test: host cookie became "Player 4", `/startgame` swallowed
  NotYourTurn).
- **Templates**: keep as real files in `src/web/` with Orb's directive
  syntax intact, embedded via `@embedFile`, bound by a one-pass binder
  (replace directives with values keyed by trimmed inner text;
  includes are pre-rendered values keyed by the full directive text).
  Directive placement rules that keep files valid HTML:
  - text position → comment-wrap: `<!--@@ pot @@-->`, `<!--%% face %%-->`, `<!--$$ cards $$-->`
  - inside quoted attribute VALUES → keep raw Orb form: `min="<%% callMinimum %%>"`, `class="player <%% status %%>"`
  - NEVER substitute into a `style=` attribute (lint CSS parser breaks on `%%`) → emit a `data-*` attribute and apply it in JS
  - in BOTH binder branches copy the text between the previous
    position and the directive (`template[i..lt]`) — forgetting one
    drops prefixes (`Pot: ` vanished) and leaves stray `<`
- **Dynamic templates** (classes implementing `IOrbTemplate` whose
  `render` picks a variant) → selection logic in a snapshot builder:
  one `buildSnapshot(tx, alloc, root, viewer, now_ms)` copying all
  display state out of the tx (strings must not outlive it), then pure
  render functions.
- **Live update** (`data-orb-live`, `Orb@liveUpdate`) → poll a
  fragment endpoint (`/felt`) every ~1.2 s; client uses
  `DOMParser` + `replaceChildren` (innerHTML trips XSS lints) and
  binds `data-orb-trigger`/`data-orb-submit` attributes to POSTs —
  Orb's own client contract, polling edition.
- CSS animations restarted by innerHTML replacement (e.g. countdown
  bars) → server-computed widths in `data-` attributes.

## JADE quirks to check for in every port

Found in DealerApp — look for the same classes of bug rather than
porting them faithfully:

1. Blinds seeded the "has acted" set, robbing the small blind of its
   pre-flop option (forced bets must not count as actions).
2. Showdown filtered on `stack > 0`, silently excluding all-in players
   whose stack hit 0 mid-hand.
3. `bestCandidate` picked a single winner on exact ties with
   slot-based scoring on pair hands → split pots, rank-based scores.
4. Upstream typos in identifiers (e.g. `StartDyanamicTemplate`) — keep
   verbatim when QUOTING the original, but don't propagate into new
   names; spell-checkers will flag the accurate quotes (accepted).

Document every deliberate divergence in the port's README.

## Verification bar

- `zig build test` — all suites pass (evaluator + engine + module tests).
- `zig build` clean.
- Live curl smoke test of the full user flow (setup → core loop →
  completion), including a restart to prove persistence.
- Engine invariants asserted in tests (e.g. chip conservation across a
  full hand: sum of stacks constant).
