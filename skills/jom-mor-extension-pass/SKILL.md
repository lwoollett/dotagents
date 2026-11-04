---
name: "jom-mor-extension-pass"
description: "Extending/refactoring the zom Managed Object Runtime: extension procedure, two-face tx API, file-split layout since v0.3.1, wire/cert gotchas, embedded-UI fmt trap, model-layer comptime + persisted-id rules (auto-ids pass), commit-time planner writer-read discipline (freeze/cascade pass)"
---

# zom (formerly jom) Managed Object Runtime — extension procedure + design rules + gotchas

(Existing body retained; add this section.)

## Big-file split recipe (0.17, validated v0.3.1)

- Move private methods to package-internal files as file-level `pub fn f(tx: *T)`: file-level pub is invisible to module consumers (only root.zig re-exports are public API); pub methods on a re-exported type DO widen the API. Fields are always file-accessible (privacy covers declarations, not fields).
- Keep every `pub fn` METHOD on the original struct (delegates where needed) so external call sites and root.zig re-exports never change.
- Current split layout: transaction/{transaction,types,staging,commit,iterators}.zig; runtime/{database,schema,migration}.zig (BOTH DDL sites live in schema.zig initOrRecover); transport/{server,dispatch,client,client_changes}.zig; tests/ is its own module (tests/all.zig) importing `zom` like a consumer; -Dtest-filter covers it.
- Chunker traps: 1-based line numbers vs 0-based arrays (off-by-one drops decl lines and adds stray braces — use lines[i-1] consistently); after self→tx rename, intra-group calls still read `tx.foo(...)` and need rewriting to `foo(tx, ...)`; blank continuation lines inside `\` multiline strings are DELETED by zig fmt — never run repo-wide `zig fmt .` (it mangled serve.zig's embedded HTML bytes once; reverted).
- Session-tooling trap: bash cwd resets between calls — `cd` in the same command as any relative-path script.

## Model-layer comptime gotchas (auto-ids pass, 2026-11)

- **Persisted u64 ids must fit positive i64.** `commit.zig` binds ids via `@intCast` into signed SQLite INTEGERs — any full-range u64 (hashes!) traps at commit (~half of values). If deriving u64 ids (or adding counters/serials in Feature B's `auto_id_counters`), mask to 63 bits (`& 0x7fff…`) and pin golden vectors on the MASKED values. Same discipline as serial allocation.
- **Never hash via std.hash for persisted ids** — own FNV-1a 64 + splitmix64 in `src/model/auto_id.zig`; a std implementation change across Zig releases silently renumbers databases. Pin with golden-vector tests (`zig test` module hook lives in root.zig's test block, codec.zig pattern).
- **`schema.classDefOf` is comptime-call-only** (body is `comptime { return … }` — a runtime call is "function called at runtime cannot return value at comptime"). Prefix test/assert call sites with `comptime`. Additionally SUBCLASS `ClassDef`s cannot cross into runtime at all: their `props` slice points into a comptime-local `merged` array — passing one to a runtime fn is "runtime value contains reference to comptime var". Assert subclass descriptors inside `comptime { … @compileError … }` blocks; root-class defs are fine at runtime.
- **Anything reading `rel.id`/ids straight out of a `zom` decl breaks when derivation omits them.** `registry.relIdOf` and `transaction.memberKeyInfo` both had to resolve through `mergedRelDescs`/descriptors — grep raw decl reads before making any zom decl field omittable.
- **auto_ids subclasses adopt inherited property ids** for redeclared same-name/same-type fields (incl. base overrides) — otherwise a base override double-encodes the field under two ids. Derived ids of 0 must be compile errors: 0 means root class / unkeyed member-key / dynamic-reference rel namespace.
- **`@setEvalBranchQuota(1_000_000)` belongs in EVERY heavy comptime fn** — ownRelDescs, mergedRelDescs, ownAutoProps, mergedAutoProps, and classDefOf (Erewhon-scale graphs, ~14 classes/24 rels, blow the default 1000). When adding a new comptime descriptor builder with per-field prop scans, add the quota in the same shape.
- **Test-code shadowing:** inside a struct declaring `pub const zom = .{…}`, the name `zom` refers to that decl, not the module import — hoist values like `const widget_id = zom.auto_id.hash64(@typeName(Widget));` to file scope (extends the AGENTS.md `const Ref = zom.Ref;` aliasing rule).
- Typed tx reads: non-optional fields return the value directly from `tx.get(ref, .field)` (no `.?`); optional Ref fields return `?Ref`. Iterator methods (`inverseOf`) return non-error optionals but need `var it = try …; it.next()` — not chained `.next()` on the error union.

## Commit-time planner reads (freeze/cascade pass, 2026-11)

- **Planner checks in commit.zig MUST read authoritative state on the WRITER connection (`tx.db.writer.prepare(…)`), never `staging.resolveSerial` (txn snapshot).** Mid-transaction authority-level ops — e.g. `Client`/`Database.thaw` during an open remote txn — commit independently and must be visible to the planner even though the txn snapshot predates them. Trap: an embedded test (thaw before `begin()`) passes with snapshot-resolve while the REMOTE example test (thaw mid-txn) fails; planDeletions' committed-edge scan already follows this (AGENTS rule 3) — new checks must too.
- **Cascade + frozen rule (as shipped):** planDeletions' `.cascade` branch checks flags on the writer before staging each child deletion — frozen child ⇒ whole deletion fails `ImmutableViolation` at mutation time; same-txn-frozen creations also reject; `updated`-staged objects are exempt (committed frozen objects reject updates, so only the current txn could have frozen them). Sanctioned destroy-frozen-history path = authority thaw first (`client.thaw`/`db.thaw` per cascade member, then delete the root).
- When a library rule change breaks an example app's flow, the example test IS the integration test: the auction-house `removeLot` fix (thaw each bid via `tx.inverseOf(rel_lot_bids, lot)` + `client.thaw`, then delete the lot) both satisfies and demonstrates the sanctioned pattern — keep examples aligned with new rules rather than relaxing rules for examples.
