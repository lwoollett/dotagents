---
name: "zig-0-17"
description: "Write and debug Zig 0.17 code — API removals and replacements (std.Thread.Mutex, clocks, crypto random, dupeZ, intToEnum, b.args), comptime discipline (comptime-return fns, eval-branch quota, comptime-var escapes), build-system traps that silently skip tests (addTest without addRunArtifact, missing .optimize), error-union/anytype idioms, ArrayList unmanaged API. Use when writing/building/testing any Zig code, porting older Zig snippets, or when a compile error names an API that no longer exists."
---

---
name: "zig-0-17"
description: "Write and debug Zig 0.17 code — API removals and replacements (std.Thread.Mutex, clocks, crypto random, dupeZ, intToEnum, b.args), comptime discipline (comptime-return fns, eval-branch quota, comptime-var escapes), build-system traps that silently skip tests (addTest without addRunArtifact, missing .optimize), error-union/anytype idioms, ArrayList unmanaged API. Use when writing/building/testing any Zig code, porting older Zig snippets, or when a compile error names an API that no longer exists."
---

# Zig 0.17 usage — removals, traps, idioms

Every trap below is symptom → cause → fix, from real hits (zom, zmk,
consumer apps). Zig 0.17.0; pin the version per project.

## Standard-library removals (symptom: "not found" / no such field)

1. **`std.Thread.Mutex` / `std.Thread.Futex` gone** → mutexes are
   `std.Io.Mutex` and take an `Io` parameter. In libraries that don't
   want an Io in the public API, roll a tiny pthread/OS mutex (zom's
   `src/runtime/mutex.zig` pattern) or take an `Io` param explicitly.
2. **No clock in `std.time`, no `std.Thread.sleep`, no
   `std.crypto.random` without an `Io`** → libc directly:
   `extern fn clock_gettime(clock_id: c_int, tp: *timespec) c_int;`
   (with per-OS `CLOCK_MONOTONIC`), `usleep(useconds_t)`,
   `arc4random_buf(buf, n)` (macOS/BSD) / `getrandom(buf, n, 0)`
   (Linux). For unbiased bounded draws: `arc4random_uniform(upper)`.
   If a dependency already exports it (zom: `zom.fillRandomBytes`),
   use that instead of re-declaring externs.
3. **`Allocator.dupeZ` and `fmt.allocPrintZ` gone** →
   `alloc.dupe(u8, x)` stays; for NUL-terminated use
   `std.fmt.allocPrintSentinel(alloc, fmt, args, 0)`.
4. **`std.meta.intToEnum` gone** → range-check then cast:
   check the int against the enum's `@intFromEnum` bounds (or
   `@typeInfo(E).@"enum".fields` values), then `@enumFromInt(int)`.
5. **`std.builtin.mode` gone** → `@import("builtin").mode`.
6. **`b.args` gone from Build** → `run_cmd.addPassthruArgs()`.
7. **`std.testing.*` is compile-gated to test builds** — non-test
   executables need their own expect/fail helpers; don't import
   std.testing outside `test` blocks.
8. **Array repetition `[_]u8{0} ** 15` removed** →
   `var a: [15]u8 = @splat(0);` (error message misleadingly complains
   about whitespace around `*`).
9. **`std.Io.Dir` has no `realpathAlloc`** — tmp-dir test paths:
   `std.fmt.allocPrintSentinel(alloc, ".zig-cache/tmp/{s}/t.db", .{tmp.sub_path}, 0)`
   from `std.testing.tmpDir(.{})`; read files with
   `std.Io.Dir.cwd().readFile(std.testing.io, path, &buf)`.

## Language traps

1. **`@typeInfo(T).@"struct"` uses parallel arrays**: `field_names`,
   `field_types`, `field_attrs` — defaults come from
   `field_attrs[i].defaultValue(FT)` (a function call), NOT a
   `default_value` field. Enums: `field_names`/`field_values`.
2. **`try x catch …` double-handling is a compile error** — one or the
   other.
3. **`var arr: [N]SomeStruct = undefined` skips field default
   initializers** — use `@splat(SomeStruct{})` or fill explicitly.
4. **Declarations between struct fields are a compile error**
   ("declarations are not allowed between container fields") — keep
   fields contiguous.
5. **Renaming an `extern fn` to dodge a name shadow BREAKS symbol
   binding** — use the `@extern` namespace pattern (see zom
   `transport/net.zig`).
6. **Extern-struct u32 fields store native endianness** — network-order
   fields need `std.mem.nativeToBig` (the `sockaddr_in.addr` trap).
7. **`switch (expr catch {})` fails** when the success type is
   non-void ("operand is void"): bind first, then switch. Same class:
   field access on an error union — parenthesize
   `(try f()).field`, never `try f().field`.
8. **`@intCast` needs a known result type** — through `anytype`
   parameters the inference is lost: write `@as(i64, @intCast(x))`.
9. **A struct's `pub const zom`-style decl shadows a module import of
   the same name inside that struct** — alias at file scope
   (`const Ref = zom.Ref;`) and never reference the import by name
   inside the declaring struct.

## Comptime discipline

1. **A function whose body is `comptime { ... return ...; }` is
   comptime-call-only.** Symptom: "function called at runtime cannot
   return value at comptime". Fix call sites with
   `const def = comptime f(T);`.
2. **Comptime-local storage cannot cross into runtime.** Symptom:
   "runtime value contains reference to comptime var". Anything built
   into a comptime-local array and returned by slice must stay in
   comptime contexts (`comptime { ... @compileError/assert ... }`);
   for runtime use, re-materialize the values (scalars are fine).
3. **Heavy comptime loops blow the default 1000 eval-branch quota.**
   Symptom: "evaluation exceeded 1000 backwards branches". Fix:
   `@setEvalBranchQuota(1_000_000);` at the top of EACH heavy fn —
   nested comptime calls do NOT inherit the caller's quota.
4. `comptime` blocks can `break :label` values; `inline for` over
   comptime slices keeps per-iteration comptime facts (`if (comptime
   std.mem.eql(...))` prunes branches).

## Build system — traps that LIE GREEN

1. **`test_step.dependOn(&the_test_compile.step)` without
   `b.addRunArtifact(the_test)` makes the step a COMPILE CHECK ONLY**
   (`-fno-emit-bin` appears in `--verbose`): zero tests execute, the
   build reports success. Every `addTest` needs its own
   `addRunArtifact` dependency. Recipe when a suite is suspiciously
   green: append `try std.testing.expect(false)` — if the build still
   passes, tests aren't running.
2. **`b.createModule` without `.optimize = optimize` silently compiles
   that module's test step in Debug under `-Doptimize=ReleaseSafe`** —
   set `.optimize` on test root modules explicitly.
3. **A crashed test binary hangs `zig build test`'s listen-mode runner
   forever.** Bisect with `zig build test -Dtest-filter=<substring>`,
   or run the cached binary directly: `.zig-cache/o/*/test`.
4. **Same-length single-token edits (4→99) can falsely hit the compile
   cache** when sabotaging a test to verify it runs — change content
   length or clear `.zig-cache/h`.

## Idioms that changed shape

- **ArrayList is unmanaged by default**: `var list: std.ArrayList(T) = .empty;`
  and every method takes the allocator (`list.append(alloc, x)`).
  Same for hash maps: `std.AutoHashMapUnmanaged(K,V) = .empty`.
- **Multiline string literals**: `zig fmt` DELETES blank continuation
  lines inside `\` strings — never store served bytes (embedded HTML!)
  in them; use `@embedFile` and real asset files.
- **fmt/print**: `std.fmt.comptimePrint` works in comptime error
  messages; `std.debug.print` for runtime tracing.
- **ZON (`build.zig.zon`)**: `.name` must be underscores (no `-`);
  fingerprints: paste any value, then replace with the one zig's error
  suggests; `.version` is the package version — keep it in sync with
  any `pub const version` in the root source.

## Cross-references

- zom-specific patterns (models, transactions, remote, protocol):
  `zom-runtime` skill.
- Keyboard firmware Zig: `zmk` skill; Godot GDExtension C++/Zig builds:
  `godot` skill.
