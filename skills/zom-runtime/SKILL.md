---
name: "zom-runtime"
description: "Build an app on the zom Managed Object Runtime at ~/repos/zom (Zig 0.17, v0.4.0) — consumer scaffold, model declarations (explicit + auto_ids), auto-increment properties, relationships/inverses/member-key dicts, transactions, collections, freeze/thaw, remote clients (protocol v2), HTTP servers, concurrency, Zig 0.17 traps, testing"
---

---
name: "zom-runtime"
description: "Build an app on the zom Managed Object Runtime at ~/repos/zom (Zig 0.17, v0.4.0) — consumer scaffold, model declarations (explicit + auto_ids), auto-increment properties, relationships/inverses/member-key dicts, transactions, collections, freeze/thaw, remote clients (protocol v2), HTTP servers, concurrency, Zig 0.17 traps, testing"
---

# Working with the zom Managed Object Runtime (Zig 0.17)

Build apps on zom — models, transactions, collections, roots, refs,
freeze/thaw, remote clients, HTTP servers, tests. The runtime lives at
`~/repos/zom` (pinned Zig 0.17.0, vendored SQLite 3.45.3, zero external
package deps, so a path dependency just works). For extending the
runtime itself, read the repo's own `AGENTS.md` (extension procedure,
hard design rules, Zig/SQLite gotchas) — it is the authoritative
in-repo guide.

## Runtime facts (v0.4.0)

- Version: `build.zig.zon` `.version` and `zom.version` ("0.4.0");
  wire compatibility is gated by `zom.protocol.protocol_version` (2 —
  `create_object` responses carry assigned auto-increment pairs).
  Commands: `zig build test`, `zig build -Doptimize=ReleaseSafe test`,
  `zig build run` (embedded demo), `zig build bench`, `zig build
  examples`.
- Key exports from `src/root.zig`: `Database`, `Session`,
  `Transaction`, `Mode`, `Ref`, `Oid`, `SetRef`/`DictRef`/`SeqRef`,
  `Server`, `Client`, `protocol`, `net` (TCP + HTTP helpers), `Mutex`,
  `wallClockMillis`, `monotonicNanos`, `fillRandomBytes`, `auto_id`,
  `AssignedProp`/`RawCreateResult`, `Inspection`, `MigrationPlan`.
- In-repo examples worth copying: `examples/kanban-web` (threaded HTTP
  server + JSON API, sentinel-root persistence pattern),
  `examples/todo-tui` (auto_ids, relationships, cascade delete),
  `examples/auction-house` (auto_increment per-house lot numbering,
  freeze-at-birth bids, embedded + remote + HTTP in one system),
  `examples/remote-monitor` (client, change stream).

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

Explicit ids (default):

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

Or opt into comptime-derived ids (`auto_ids`, T-31): every field
becomes a property; `property_ids` becomes a partial-override hatch;
explicit values always win:

```zig
const Note = struct {
    pub const zom = .{
        .auto_ids = true,               // class/property/rel ids from names
        .layout_version = 1,
        .relationships = .{ .owner = .{ .on_delete = .cascade } },
    };
    text: []const u8,
    owner: ?Ref(User) = null,           // rel id derived (global scope)
};
```

Renaming a class/field changes its derived id — a schema change (bump
`layout_version`). Classes without `auto_ids` are byte-identical to
the explicit rules.

- Persistent field types: `bool`, `i8`..`i64`, `u8`..`u64`, `f32`,
  `f64`, `[]const u8`, `Ref(T)`/`?Ref(T)`, optionals of those. Narrow
  ints encode in one canonical 8-byte form; `f32` widens to `f64`
  (exact round trip). Dict KEYS stay `i64`/`u64`/`[]const u8`.
- Every Ref field needs BOTH a property entry and a
  `.relationships` entry (the rel id is global — under `auto_ids` it
  derives from `@typeName(T) ++ "." ++ field`).
- `one_to_one` enforces uniqueness on BOTH sides (two sources pointing
  at one target = `duplicate_key` at commit). For "many children point
  at one shared parent", use plain one_to_many refs.
- Persisted u64 ids must fit a positive i64 (commit binds signed
  INTEGERs); derived class ids are already 63-bit masked.
- In a struct that declares `pub const zom`, the name `zom` shadows the
  module import — alias at file scope: `const Ref = zom.Ref;`.

## Auto-increment properties (T-32)

```zig
const Lot = struct {
    pub const zom = .{
        .auto_ids = true,
        .layout_version = 1,
        .relationships = .{
            .house = .{
                .on_delete = .restrict,
                .member_key = .{ .field = .lot_no, .unique = true },
            },
        },
        .auto_increment = .{
            .lot_no = .{ .per = .house },   // per-owner counter (Ref field)
            .qty = .{},                     // global per-(class, prop)
        },
    };
    lot_no: i64 = 0,   // 0 at create = "assign me"
    qty: i64 = 0,
    house: Ref(House),
};

const lot = try tx.create(Lot, .{ .house = house });   // assigns lot_no=1, qty=1
try std.testing.expectEqual(@as(i64, 1), try tx.get(lot, .lot_no)); // read-your-writes
```

- Counters are strictly monotone per scope starting at 1, NEVER reused
  (aborted creates burn values; restarts resume above the durable
  mark — gaps are legal, density is NOT guaranteed).
- A non-zero value at create is an explicit import: accepted verbatim,
  and the counter's durable mark advances past it first (the migration
  path; `db.primeAutoIdCounter(class_id, prop_id, owner_serial, v)`
  primes without creating). Negative `i64` imports pass untouched.
- Immutable after create: `tx.set` → `AutoIdImmutable` (deterministic
  error, not a conflict); `updateRaw` passes only an unchanged value.
- Missing/null `.per` scope at create → `AutoIdScopeRequired`.
- Unique member keys keyed by the auto value give free
  per-owner numbering (auction-house pattern above).

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

- **registerClass contract:** payload-only classes work unregistered,
  but register every persistent class — relationships (inverses,
  member-key dicts), deletion policies, inheritance casts, and
  commit-time reference validation resolve through the registry; an
  unregistered relationship field fails the commit with
  `InvalidReference`. Subclasses need ancestors registered first.
- **Strings decoded by `tx.get` live in the transaction arena** — copy
  (dupe/fmt) before `tx.deinit()`; build response bytes inside the tx
  scope.
- Commit conflicts are VALUES (`CommitResult.conflict`); log them —
  never swallow `catch {}` silently in real apps.
- Read-your-writes works inside one tx; never reuse a committed tx.
- Named singletons: `tx.getRoot(T, "name")` → `?Ref(T)` /
  `tx.setRoot("name", ref)` — the kanban pattern stores a dict's serial
  on a sentinel root object so boards survive restarts.
- Every commit appends a structured event log next to the db file
  (`.off` in tests).

## Relationships: inverses and member-key dictionaries

```zig
// Derived state, computed from authoritative edges:
var it = try tx.inverseOf(customer, Order, .customer);   // committed + staged
while (it.next()) |member| { ... }
try tx.inverseCount(customer, Order, .customer);
try tx.inverseContains(customer, order, Order, .customer);

// Member-key dictionary (declared via .member_key = .{ .field = ..., .unique = ... }):
const o = try tx.mkGet(customer, Order, .customer, order_number);   // ?Ref(Order)
var mk = try tx.mkIter(customer, Order, .customer);                 // entries .key/.member
```

Conditional relationships: `.condition = .{ .field = .status, .equals = 1 }`
filters inverse membership through a comptime predicate.

## Freeze / thaw / deletion

- `try tx.freeze(obj)` (or `tx.freezeSerial(s)`; remote `tx.freeze(s)`)
  — often in the SAME txn that creates the object (freeze-at-birth
  audit trail). Reads still work; mutation and deletion →
  `ImmutableViolation`.
- Thaw is authority-level, its own immediate transaction:
  `db.thaw(serial)` embedded, `client.thaw(serial)` remote.
- Deletion policies apply to INCOMING refs: `.restrict` blocks,
  `.nullify` clears optional refs, `.cascade` deletes children
  atomically. **Cascade refuses frozen children** (uniform with
  direct delete / nullify): pre-thaw the cascade set, then delete the
  root — the auction-house `removeLot` pattern:

```zig
const bid_serials = try tx.inverseOf(rel_lot_bids, lot_serial); // payload-level
for (bid_serials) |s| try client.thaw(s);
try client.thaw(lot_serial);
try tx.delete(lot_serial);
```

## Collections

- Create: `tx.createSeq(T)`, `tx.createSet(T)`, `tx.createDict(T, K)`
  (unique keys) / `tx.createDictMulti(T, K)` (duplicates allowed).
- Collections are persistent, addressed by serial. Store the serial as
  an i64 property field and rebuild the typed handle WITHOUT touching
  internals: `tx.collectionFromSerial(zom.SeqRef(T), @intCast(stored))`.
- `tx.seqAppend(seq, member)` returns void (positions via
  `seqCount`; an undiscarded result is no longer an error).
- Positions are 0-based: `seqGet(seq, n - 1)` before
  `seqRemoveAt(seq, n - 1)` to pop from the end; `seqIter(seq)` yields
  `.{ .position, .member }`; clear by looping `seqRemoveAt(seq, 0)`.
- Dicts: `dictPut` / `dictGet` / `dictRemove` / `dictIter`
  (`entry.key`, `entry.member`).

## Remote clients (protocol v2)

```zig
const server = try zom.Server.start(alloc, db, token);
const client = try zom.Client.connect(alloc, "127.0.0.1", server.port(), token);
defer client.close();                   // BEFORE server.stop() — stop waits for conns

const tx = try client.begin(.read_write);
defer tx.abort() catch {};
const res = try tx.create(class_id, layout, payload_bytes);
// res.serial: server-allocated; res.assigned: []const zom.AssignedProp
//             (property_id, value) pairs — auto-increment read-your-writes
for (res.assigned) |ap| { if (ap.property_id == lot_no_prop) lot_no = @intCast(ap.value); }
try tx.update(serial, class_id, layout, payload);
const raw = try tx.read(serial);        // raw.payload bytes
const out = try tx.executeMethod(method_id, &input);
const result = try tx.commit(null) catch |err| return err;   // bind-then-switch
switch (result) { .committed => ..., .conflict => |c| ... }
```

- Payload-level only remotely: build canonical bytes with
  `zom.codec.encode(T, alloc, &value, &buf)` and read back with
  `zom.codec.readProperty(payload, prop_id)`; ref values are
  `zom.Ref(T).fromOid(.{ .database_id = client.database_id, .serial = s })`.
- `create_object` request-time errors include `AutoIdScopeRequired` /
  `AutoIdImmutable` — expect them on the mutating call, not commit.
- Change stream: `client.subscribeChanges()` BEFORE the commit you
  need delivered (cursor snapshots at subscribe; `pollChanges()` with
  no subscription → `PermissionDenied`).
- Retry semantics: a lost create response burns a serial + counter
  value; commit-level request keys give idempotent outcomes.

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
2. Crypto bytes: `std.crypto.random` missing → `zom.fillRandomBytes(buf)`
   (platform fallback inside zom). Unbiased bounded draws still need
   your own `extern fn arc4random_uniform(upper_bound: u32) u32;`.
3. `b.args` missing from Build → `run_cmd.addPassthruArgs()`.
4. `Io.Dir` has no `realpathAlloc` → test db path is
   `std.fmt.allocPrintSentinel(alloc, ".zig-cache/tmp/{s}/t.db", .{tmp.sub_path}, 0)`
   from `std.testing.tmpDir(.{})`.
5. Test determinism: thread ONE `now_ms` parameter through any
   state machine that stamps deadlines; calling `zom.wallClockMillis()`
   deep inside mixes clocks and makes timers expire instantly under
   test (hit: turn auto-fold firing during a live smoke test).
6. `switch (tx.commit(null) catch {})` → compile error (void operand):
   bind first, then switch.

## Testing an app

- Per-module `*_test.zig` + one engine-level suite against a real db
  (tmpDir pattern above, `registerClass` on the test db too).
- A crashed test binary hangs `zig build test` — bisect with
  `-Dtest-filter=<substring>`.
- Auto-increment assertions: predict the next value from your own
  monotone counter advanced AT CREATE TIME (aborts burn), then assert
  `tx.get == predicted` immediately — this catches reissue bugs.
- Finish with a curl smoke test driving the full user flow; for apps
  with turn/timeout semantics, keep each curl batch inside the
  deadline window or the timeout logic will (correctly) fire
  mid-verification.
