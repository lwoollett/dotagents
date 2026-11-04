---
name: "zom-runtime"
description: "Build an app on the zom Managed Object Runtime at ~/repos/zom (Zig 0.17) — consumer scaffold, model declarations, transactions, collections, roots, refs, HTTP servers, concurrency, Zig 0.17 traps, testing"
---

# Working with the zom Managed Object Runtime (Zig 0.17)

Build apps on zom — models, transactions, collections, roots, refs,
HTTP servers, remote clients, tests. The runtime lives at `~/repos/zom`
(pinned Zig 0.17.0, vendored SQLite 3.45.3, zero external package deps,
so a path dependency just works). For extending the runtime itself
(src/ file layout, comptime model-layer gotchas), see the separate
`jom-mor-extension-pass` skill.

## Runtime facts

- Version: read `build.zig.zon`'s `.version` field (0.3.1 at time of
  writing). Commands: `zig build test`, `zig build -Doptimize=ReleaseSafe
  test`, `zig build run` (embedded demo), `zig build bench`.
- Key exports from `src/root.zig`: `Database`, `Session`,
  `Transaction`, `Mode`, `Ref`, `Oid`, `SetRef`/`DictRef`/`SeqRef`,
  `Server`, `Client`, `net` (TCP + HTTP helpers), `Mutex`,
  `wallClockMillis`, `auto_id`, `Inspection`, `MigrationPlan`.
- In-repo examples worth copying: `examples/kanban-web` (threaded HTTP
  server + JSON API), `examples/todo-tui` (relationships, dicts,
  cascade delete), `examples/auction-house` (embedded + remote + HTTP
  in one system), `examples/remote-monitor` (client, change stream).

## Consumer app scaffold

1. `build.zig.zon`: `.name` must use underscores (ZON identifiers
   reject `-`); put any fingerprint, then paste the value zig's error
   message suggests on first build. Dependency:
   `.zom = .{ .path = "../../zom" }` — verify the relative depth from
   the app dir (a `../zom` vs `../../zom` mistake surfaces as
   `failed to open "../zom": FileNotFound`).
2. `build.zig`: `b.dependency("zom", .{...})` → `.module("zom")` →
   pass as an import to the app module AND to a separate test module
   rooted at `src/tests.zig`. Run steps use `run_cmd.addPassthruArgs()`
   (`b.args` no longer exists in 0.17).
3. Tests live in `src/<module>_test.zig`, registered in `src/tests.zig`:
   `test { _ = @import("hand_eval_test.zig"); }`.
4. Static assets (HTML/CSS/JS) as real files under `src/web/`,
   embedded with `@embedFile("web/style.css")` — never build markup
   from Zig multiline string literals (they mangle; one stray brace
   cost a debugging round).

## Model declarations

```zig
const Task = struct {
    pub const zom = .{
        .class_id = 20002,
        .layout_version = 1,
        .property_ids = .{ .title = 1, .priority = 2, .project = 3 },
        .relationships = .{ .project = .{
            .id = 100,
            .cardinality = .one_to_many,   // or .one_to_one
            .on_delete = .cascade,          // or .restrict / .nullify
        } },
    };
    title: []const u8,
    priority: i64,
    project: ?Ref(Project) = null,
};
```

- Persistent field types: ints, floats, bool, `[]const u8`, optionals.
  **`u8` is rejected** — symptom: comptime
  `unsupported persistent field type for Card.suit: u8` → use `i32`.
- Every Ref field needs BOTH a `property_ids` entry and a
  `.relationships` entry.
- Explicit stable class/property ids; persisted u64 ids must fit a
  positive i64 (commit binds signed INTEGERs).

## Sessions and transactions

```zig
db = try zom.Database.open(std.heap.page_allocator, path, .{ .event_log = .default });
try db.registerClass(Task);            // EVERY class, before first use
session = db.session();
var tx = try session.begin(.read_write);
defer tx.deinit();
const t = try tx.create(Task, .{ .title = "x", .priority = 1 });
try tx.set(t, .priority, 2);
const p = try tx.get(t, .priority);     // value directly; ?Ref for ref fields
_ = tx.commit() catch |e| std.debug.print("commit lost: {s}\n", .{@errorName(e)});
```

- **Strings decoded by `tx.get` live in the transaction arena** — copy
  (dupe/fmt) before `tx.deinit()`; build response bytes inside the tx
  scope.
- Commit conflicts are VALUES (`CommitResult.conflict`); log them —
  never swallow `catch {}` silently in real apps.
- Read-your-writes works inside one tx; never reuse a committed tx.
- Named singletons: `tx.getRoot(T, "name")` → `?Ref(T)` /
  `tx.setRoot("name", ref)`.
- Every commit appends a structured event log next to the db file
  (`.off` in tests).

## Collections

- Create: `tx.createSeq(T)`, `tx.createSet(T)`, `tx.createDict(T, K)`
  (unique keys) / `tx.createDictMulti(T, K)` (duplicates allowed).
- Collections are persistent, addressed by serial. Store the serial as
  an i64 property field; rebuild the typed handle:
  `zom.SeqRef(T).fromOid(.{ .database_id = tx.db.db_id, .serial = @intCast(v) })`.
- `_ = try tx.seqAppend(seq, member)` — it RETURNS a position; an
  undiscarded result is a compile error ("value of type 'u64' ignored").
- Positions are 0-based: `seqGet(seq, n - 1)` before
  `seqRemoveAt(seq, n - 1)` to pop from the end; `seqIter(seq)` yields
  `.{ .position, .member }`; clear by looping `seqRemoveAt(seq, 0)`.
- Dicts: `dictPut` / `dictGet` / `dictRemove` / `dictIter`
  (`entry.key`, `entry.member`).

## Concurrency and HTTP

- Thread-per-connection HTTP is fine (copy `examples/kanban-web`:
  `net.Listener.open(port)` → `accept()` loop → `std.Thread.spawn` +
  `detach`, `Conn.sendAll/recvAll/close`, a `readUntilHeaders` helper,
  per-request arena). But serialize mutations yourself with a global
  mutex — **`std.Thread.Mutex` is gone in 0.17**; use `zom.Mutex`
  (`var m: zom.Mutex = .{}` then `.lock()/.unlock()`).
- Remote face: `zom.Server.start(alloc, db, password)` +
  `zom.Client.connect(alloc, host, port, password)` when an app needs
  multiple processes sharing one database.

## Zig 0.17 traps (symptom → fix)

1. `[_]u8{0} ** 15` → error "binary operator '*' has whitespace on one
   side…" — array repetition is REMOVED; write `var a: [15]u8 = @splat(0);`.
2. `std.crypto.random` missing → declare
   `extern fn arc4random_buf(buf: *anyopaque, n: usize) void;` and
   `extern fn arc4random_uniform(upper_bound: u32) u32;` (macOS/BSD)
   for crypto bytes and unbiased bounded draws.
3. `b.args` missing from Build → `run_cmd.addPassthruArgs()`.
4. `Io.Dir` has no `realpathAlloc` → test db path is
   `std.fmt.allocPrintSentinel(alloc, ".zig-cache/tmp/{s}/t.db", .{tmp.sub_path}, 0)`
   from `std.testing.tmpDir(.{})`.
5. Test determinism: thread ONE `now_ms` parameter through any
   state machine that stamps deadlines; calling `zom.wallClockMillis()`
   deep inside mixes clocks and makes timers expire instantly under
   test (hit: turn auto-fold firing during a live smoke test).

## Testing an app

- Per-module `*_test.zig` + one engine-level suite against a real db
  (tmpDir pattern above, `registerClass` on the test db too).
- A crashed test binary hangs `zig build test` — bisect with
  `-Dtest-filter=<substring>`.
- Finish with a curl smoke test driving the full user flow; for apps
  with turn/timeout semantics, keep each curl batch inside the
  deadline window or the timeout logic will (correctly) fire
  mid-verification.
