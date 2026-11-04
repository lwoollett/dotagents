/**
 * Throwaway verification harness for pi-autolearn (run with bun).
 * Drives the extension with a structural fake of the ExtensionAPI surface it uses;
 * asserts tool behavior, file formats, and the auto-capture controller state machine.
 */
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// --- structural surface of ExtensionAPI used by the extension ---
type Handler = (event: unknown, ctx: unknown) => unknown;
interface ToolResult {
  content: Array<{ type: string; text: string }>;
}
interface ToolShape {
  name: string;
  // test seam: ToolDefinition.execute params are Static<TParams>; generic erased here.
  // Optional trailing args mirror the real execute(toolCallId, params, signal, onUpdate, ctx) surface.
  execute: (toolCallId: string, params: never, signal?: unknown, onUpdate?: unknown, ctx?: unknown) => Promise<ToolResult>;
}
interface PiSurface {
  registerTool: (tool: ToolShape) => void;
  on: (event: string, handler: Handler) => void;
  getActiveTools: () => string[];
  setActiveTools: (names: string[]) => void;
  sendMessage: (msg: { customType: string; content: string; display: boolean }, opts: { triggerTurn?: boolean; deliverAs?: string } | undefined) => void;
}
interface LearnParams {
  memory: string;
  context?: string;
  skill?: { action: "create" | "update"; name: string; description: string; body: string };
}
interface ManageParams {
  action: "create" | "update" | "delete";
  name: string;
  description?: string;
  body?: string;
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), "autolearn-run-"));
process.env.PI_AUTOLEARN_SKILLS_DIR = path.join(base, "skills");
process.env.PI_AUTOLEARN_MEMORIES_DIR = path.join(base, "memories");
process.env.PI_AUTOLEARN_CONFIG = path.join(base, "autolearn.json");

// Dynamic import is required: the module reads PI_AUTOLEARN_* env at import time,
// so the overrides above must be set before it loads. Static import cannot do that.
const extPath = path.join(import.meta.dirname, "index.ts");
// SAFETY: the dynamically imported module is this extension's own index.ts (checked in
// alongside this harness); its default export is the ExtensionAPI factory, which this
// harness exercises only through the structural PiSurface subset above — a deliberate
// narrowing the real ExtensionAPI type can't express.
const { default: factory } = (await import(extPath)) as unknown as { default: (pi: PiSurface) => void };

// --- fake ExtensionAPI ---
const handlers = new Map<string, Handler[]>(); // dynamic event registry
const tools = new Map<string, ToolShape>(); // dynamic tool registry
const sentMessages: Array<{ msg: { customType: string; content: string; display: boolean }; opts: { triggerTurn?: boolean; deliverAs?: string } | undefined }> = [];
const setActiveCalls: string[][] = [];
let activeTools = ["read", "bash", "edit", "write", "learn", "manage_skill"];
const pi: PiSurface = {
  registerTool: (tool) => tools.set(tool.name, tool),
  on: (event, handler) => {
    const list = handlers.get(event) ?? [];
    list.push(handler);
    handlers.set(event, list);
  },
  getActiveTools: () => [...activeTools],
  setActiveTools: (names) => {
    activeTools = [...names];
    setActiveCalls.push([...names]);
  },
  sendMessage: (msg, opts) => sentMessages.push({ msg, opts }),
};
const fire = (event: string, payload?: unknown, ctx?: unknown): unknown[] =>
  (handlers.get(event) ?? []).map((h) => h(payload, ctx));

factory(pi);

const tui = { mode: "tui" as const, cwd: "/tmp/fake-project" };
const memDir = path.join(process.env.PI_AUTOLEARN_MEMORIES_DIR!, "--tmp-fake-project--");
const learnedFile = path.join(memDir, "learned.md");
const learn = tools.get("learn");
const manage = tools.get("manage_skill");
assert.ok(learn, "learn tool registered");
assert.ok(manage, "manage_skill tool registered");
const runLearn = (params: LearnParams) => learn!.execute("id", params as never, undefined, undefined, tui);
const runManage = (params: ManageParams) => manage!.execute("id", params as never, undefined, undefined, tui);

// --- 1. learn: format, newest-first, dedupe, redaction ---
await runLearn({ memory: "lesson one", context: "ctx one" });
assert.match(fs.readFileSync(learnedFile, "utf8"), /^- lesson one _\(context: ctx one\)_\n$/);

await runLearn({ memory: "lesson zero" });
const lines = fs.readFileSync(learnedFile, "utf8").split("\n");
assert.equal(lines[0], "- lesson zero");
assert.equal(lines[1], "- lesson one _(context: ctx one)_");

const before = fs.readFileSync(learnedFile, "utf8");
const dedupe = await runLearn({ memory: "lesson zero" });
assert.match(dedupe.content[0].text, /deduplicated/);
assert.equal(fs.readFileSync(learnedFile, "utf8"), before);

await runLearn({ memory: "key sk-abcdefghijklmnop12345 and `bt` <tag> here" });
const redacted = fs.readFileSync(learnedFile, "utf8");
assert.ok(redacted.includes("[REDACTED]"), "secret redacted");
assert.ok(!redacted.includes("sk-abcdefghijklmnop12345"), "raw secret absent");
assert.ok(!redacted.includes("`") && !redacted.includes("<tag>"), "injection chars stripped");

// --- 2. skill minting via learn.skill ---
const minted = await runLearn({
  memory: "m",
  skill: { action: "create", name: "Test-Skill", description: "Does `things` <carefully>", body: "# Body\n\ncontent\n" },
});
assert.match(minted.content[0].text, /created/);
const skillFile = path.join(process.env.PI_AUTOLEARN_SKILLS_DIR!, "test-skill", "SKILL.md");
assert.equal(
  fs.readFileSync(skillFile, "utf8"),
  '---\nname: "test-skill"\ndescription: "Does things carefully"\n---\n\n# Body\n\ncontent\n',
);

// --- 3. manage_skill semantics ---
await assert.rejects(() => runManage({ action: "create", name: "test-skill", description: "d", body: "b" }), /already exists/);
await assert.rejects(() => runManage({ action: "update", name: "no-such", description: "d", body: "b" }), /does not exist/);
await assert.rejects(() => runManage({ action: "create", name: "Bad_Name", description: "d", body: "b" }), /invalid skill name/);
await assert.rejects(() => runManage({ action: "create", name: "x-skill", description: "d" }), /both "description" and "body"/);
const upd = await runManage({ action: "update", name: "test-skill", description: "New desc", body: "# New\n" });
assert.match(upd.content[0].text, /updated/);
assert.ok(fs.readFileSync(skillFile, "utf8").includes("# New"));
// no-op guard: byte-identical update rejected as error (duplicate-call loop breaker)
await assert.rejects(
  () => runManage({ action: "update", name: "test-skill", description: "New desc", body: "# New\n" }),
  /no-op/,
);
assert.ok(fs.readFileSync(skillFile, "utf8").includes("# New"), "file untouched by rejected no-op");
// divergent payload still allowed (e.g. deliberate revert)
const revert = await runManage({ action: "update", name: "test-skill", description: "New desc", body: "# Body\n\ncontent\n" });
assert.match(revert.content[0].text, /updated/);
// re-sending the now-current state again is a no-op again
await assert.rejects(
  () => runManage({ action: "update", name: "test-skill", description: "New desc", body: "# Body\n\ncontent\n" }),
  /no-op/,
);
await assert.rejects(() => runManage({ action: "delete", name: "no-such" }), /does not exist/);
await runManage({ action: "delete", name: "test-skill" });
assert.ok(!fs.existsSync(skillFile), "skill dir removed");

// --- 4. controller: user-run gate, threshold, capture-run restriction, restore, budget ---
const nudgeCount = () => sentMessages.filter((s) => s.msg.customType === "autolearn-nudge").length;
const ALL_TOOLS = ["read", "bash", "edit", "write", "learn", "manage_skill"];
const toolEnd = (toolName: string) => fire("tool_execution_end", { type: "tool_execution_end", toolName, isError: false, result: null });
const startUserRun = () => fire("before_agent_start", { type: "before_agent_start", messageType: "user", systemPrompt: "SP" }, tui);
const startCustomRun = (customType: string) =>
  fire("before_agent_start", { type: "before_agent_start", messageType: "custom", message: { customType }, systemPrompt: "SP" }, tui);
const startCaptureRun = () => startCustomRun("autolearn-nudge");
const settle = (aborted = false) => fire("agent_settled", { type: "agent_settled", aborted }, tui);
const endRun = () => fire("agent_end", { type: "agent_end", messages: [] });

startUserRun();
for (let i = 0; i < 4; i++) toolEnd("bash");
settle();
assert.equal(nudgeCount(), 0, "below threshold: no nudge");

startUserRun();
for (let i = 0; i < 5; i++) toolEnd("bash");
settle();
assert.equal(nudgeCount(), 1, "nudge sent at threshold for a user run");
const nudge = sentMessages[sentMessages.length - 1];
assert.ok(nudge.msg.content.includes("Automated capture turn"));
assert.ok(nudge.msg.content.includes("at most one learn call"), "nudge states the call caps");
assert.equal(nudge.msg.display, false);
assert.deepEqual(nudge.opts, { triggerTurn: true, deliverAs: "followUp" });
// restriction happens at capture-run start, not at settle time — the old design
// restored the set at agent_end before the queued nudge turn ever started
assert.deepEqual(activeTools, ALL_TOOLS, "tools not yet restricted at settle");

// non-user runs (subagent wakes, queued sendMessage turns) never nudge — even above threshold
startCustomRun("subagent_wake");
for (let i = 0; i < 9; i++) toolEnd("bash");
settle();
assert.equal(nudgeCount(), 1, "custom-run settle never nudges");
endRun();

// capture tools never count toward the threshold
startUserRun();
for (let i = 0; i < 9; i++) toolEnd("learn");
toolEnd("manage_skill");
settle();
assert.equal(nudgeCount(), 1, "capture tools excluded from counter");
endRun();

// aborted user run: no nudge (abort read from AgentSettledEvent.aborted)
startUserRun();
for (let i = 0; i < 5; i++) toolEnd("bash");
settle(true);
assert.equal(nudgeCount(), 1, "aborted: no nudge");
endRun();

// print mode: no auto-capture
startUserRun();
for (let i = 0; i < 5; i++) toolEnd("bash");
fire("agent_settled", { type: "agent_settled", aborted: false }, { mode: "print", cwd: "/tmp/fake-project" });
assert.equal(nudgeCount(), 1, "print mode: no nudge");
endRun();

// disabled via live config re-check
fs.writeFileSync(process.env.PI_AUTOLEARN_CONFIG!, JSON.stringify({ enabled: true, autoContinue: false, minToolCalls: 5 }));
startUserRun();
for (let i = 0; i < 5; i++) toolEnd("bash");
settle();
assert.equal(nudgeCount(), 1, "autoContinue=false: no nudge");
endRun();
fs.writeFileSync(process.env.PI_AUTOLEARN_CONFIG!, JSON.stringify({ enabled: true, autoContinue: true, minToolCalls: 5, captureCooldownMin: 0, maxCapturesPerSession: 99 }));

// per-run reset at before_agent_start (replaces the old input-only reset)
startUserRun();
for (let i = 0; i < 3; i++) toolEnd("bash");
startUserRun();
for (let i = 0; i < 3; i++) toolEnd("bash");
settle();
assert.equal(nudgeCount(), 1, "run start resets counter: 3+3 < 5 each");
endRun();

// --- 4b. capture-run lifecycle: restriction, budget, no re-nudge, restore ---
startUserRun();
for (let i = 0; i < 5; i++) toolEnd("bash");
settle();
assert.equal(nudgeCount(), 2, "nudge queued for capture");
endRun();

startCaptureRun();
assert.deepEqual(setActiveCalls[setActiveCalls.length - 1], ["learn", "manage_skill"], "tools restricted at capture-run start");

const c1 = await runLearn({ memory: "capture lesson one" });
assert.match(c1.content[0].text, /recorded|deduplicated/);
const c2 = await runLearn({ memory: "capture lesson two" });
assert.match(c2.content[0].text, /recorded|deduplicated/);
// third capture call in the same capture run is budget-blocked (success-shaped, no write)
const c3 = await runLearn({ memory: "capture lesson three" });
assert.match(c3.content[0].text, /Capture budget exhausted/);
assert.ok(!fs.readFileSync(learnedFile, "utf8").includes("capture lesson three"), "no write past budget");
const c4 = await runManage({ action: "create", name: "budget-skill", description: "d", body: "b" });
assert.match(c4.content[0].text, /Capture budget exhausted/);
assert.ok(!fs.existsSync(path.join(process.env.PI_AUTOLEARN_SKILLS_DIR!, "budget-skill")), "no skill minted past budget");

// capture-run settle never re-nudges, even above threshold
for (let i = 0; i < 5; i++) toolEnd("bash");
settle();
assert.equal(nudgeCount(), 2, "capture settle does not re-trigger");

endRun();
assert.deepEqual(activeTools, ALL_TOOLS, "tools restored after capture run");

// budget applies only to capture runs — normal turns are unlimited
const n1 = await runLearn({ memory: "normal turn lesson one" });
assert.match(n1.content[0].text, /recorded|deduplicated/);
const n2 = await runLearn({ memory: "normal turn lesson two" });
assert.match(n2.content[0].text, /recorded|deduplicated/);
const n3 = await runLearn({ memory: "normal turn lesson three" });
assert.match(n3.content[0].text, /recorded|deduplicated/);

// --- 4d. rate limiting: cooldown + per-session capture cap (2026-11-04) ---
// nudgeCount is 2 here (capturesThisSession === 2, cooldown disabled in config)
assert.equal(nudgeCount(), 2);
// cooldown blocks the next nudge entirely
fs.writeFileSync(process.env.PI_AUTOLEARN_CONFIG!, JSON.stringify({ enabled: true, autoContinue: true, minToolCalls: 5, captureCooldownMin: 60000, maxCapturesPerSession: 99 }));
startUserRun();
for (let i = 0; i < 5; i++) toolEnd("bash");
settle();
assert.equal(nudgeCount(), 2, "cooldown: no nudge");
endRun();
// cooldown lifted → nudge fires
fs.writeFileSync(process.env.PI_AUTOLEARN_CONFIG!, JSON.stringify({ enabled: true, autoContinue: true, minToolCalls: 5, captureCooldownMin: 0, maxCapturesPerSession: 99 }));
startUserRun();
for (let i = 0; i < 5; i++) toolEnd("bash");
settle();
assert.equal(nudgeCount(), 3, "cooldown lifted: nudge fires");
endRun();
// per-session cap (3 so far) blocks the 4th regardless of cooldown
fs.writeFileSync(process.env.PI_AUTOLEARN_CONFIG!, JSON.stringify({ enabled: true, autoContinue: true, minToolCalls: 5, captureCooldownMin: 0, maxCapturesPerSession: 3 }));
startUserRun();
for (let i = 0; i < 5; i++) toolEnd("bash");
settle();
assert.equal(nudgeCount(), 3, "session cap: no nudge");
endRun();
fs.writeFileSync(process.env.PI_AUTOLEARN_CONFIG!, JSON.stringify({ enabled: true, autoContinue: true, minToolCalls: 5, captureCooldownMin: 0, maxCapturesPerSession: 99 }));

// --- 4e. capture-mode guards: delete refused, per-skill write cap (2026-11-04) ---
startUserRun();
for (let i = 0; i < 5; i++) toolEnd("bash");
settle();
assert.equal(nudgeCount(), 4, "nudge for guard tests");
endRun();
startCaptureRun();
// capture turns never delete (refused BEFORE budget — does not consume a slot)
const delRefused = await runManage({ action: "delete", name: "test-skill" });
assert.match(delRefused.content[0].text, /Refused: automated capture turns never delete skills/);
// delete refusal consumed no budget: one learn + one create still fit the budget of 2
assert.match((await runLearn({ memory: "guard capture lesson" })).content[0].text, /recorded|deduplicated/);
const guardCreate = await runManage({ action: "create", name: "cap-write", description: "d", body: "# v1\n" });
assert.match(guardCreate.content[0].text, /created/);
// budget slot 2 used → next call blocked
const budgetAgain = await runManage({ action: "update", name: "cap-write", description: "d", body: "# v2\n" });
assert.match(budgetAgain.content[0].text, /Capture budget exhausted/);
endRun();
assert.deepEqual(activeTools, ALL_TOOLS, "tools restored after guard capture run");
// second capture run: one more write to cap-write passes (2nd of 2 allowed)
startUserRun();
for (let i = 0; i < 5; i++) toolEnd("bash");
settle();
endRun();
startCaptureRun();
const guardUpdate = await runManage({ action: "update", name: "cap-write", description: "d", body: "# v2\n" });
assert.match(guardUpdate.content[0].text, /updated/);
endRun();
// third capture run: the per-skill session cap (2) refuses further cap-write writes
startUserRun();
for (let i = 0; i < 5; i++) toolEnd("bash");
settle();
endRun();
startCaptureRun();
const guardCapped = await runManage({ action: "update", name: "cap-write", description: "d", body: "# v3\n" });
assert.match(guardCapped.content[0].text, /already been written 2× by automated capture turns/);
assert.ok(fs.readFileSync(path.join(process.env.PI_AUTOLEARN_SKILLS_DIR!, "cap-write", "SKILL.md"), "utf8").includes("# v2"), "capped write did not touch the file");
// per-skill cap is capture-only: a normal turn writes cap-write freely
endRun();
const freeWrite = await runManage({ action: "update", name: "cap-write", description: "d", body: "# v3\n" });
assert.match(freeWrite.content[0].text, /updated/);

// --- 4f. interactive input cancels a live capture run (erewhon 2026-11-04) ---
startUserRun();
for (let i = 0; i < 5; i++) toolEnd("bash");
settle();
endRun();
startCaptureRun();
assert.deepEqual(setActiveCalls[setActiveCalls.length - 1], ["learn", "manage_skill"], "restricted before input");
fire("input", { type: "input", text: "modernise the admin please", source: "interactive", streamingBehavior: "steer" });
assert.deepEqual(activeTools, ALL_TOOLS, "interactive input restores the full toolset mid-capture");
const cancelNote = sentMessages.find((s) => s.msg.customType === "autolearn-capture-cancelled");
assert.ok(cancelNote, "cancellation steer note sent");
assert.equal(cancelNote!.opts!.deliverAs, "steer");
// capture mode is fully off: budget no longer applies
const free1 = await runLearn({ memory: "post-cancel lesson one" });
const free2 = await runLearn({ memory: "post-cancel lesson two" });
const free3 = await runLearn({ memory: "post-cancel lesson three" });
for (const r of [free1, free2, free3]) assert.match(r.content[0].text, /recorded|deduplicated/);
endRun();
// non-interactive input (e.g. extension-originated) must NOT cancel capture mode
startUserRun();
for (let i = 0; i < 5; i++) toolEnd("bash");
settle();
endRun();
startCaptureRun();
fire("input", { type: "input", text: "internal", source: "extension" });
assert.deepEqual(activeTools, ["learn", "manage_skill"], "extension input does not cancel capture");
assert.match((await runLearn({ memory: "still capturing lesson" })).content[0].text, /recorded|deduplicated/);
assert.match((await runLearn({ memory: "still capturing lesson two" })).content[0].text, /recorded|deduplicated/);
assert.match((await runLearn({ memory: "still capturing lesson three" })).content[0].text, /Capture budget exhausted/);
endRun();
assert.deepEqual(activeTools, ALL_TOOLS, "tools restored after non-cancelled capture run");

// --- 4c. meta-lesson rejection is capture-only + content dedupe across contexts ---
// capture turns reject loop-exhaust meta-lessons (budget allows 2 per run)
startUserRun();
for (let i = 0; i < 5; i++) toolEnd("bash");
settle();
endRun();
startCaptureRun();
await assert.rejects(() => runLearn({ memory: "No further lessons this turn." }), /capture process itself/);
await assert.rejects(() => runLearn({ memory: "Terminating self-capture loop definitively." }), /capture process itself/);
endRun();
startUserRun();
for (let i = 0; i < 5; i++) toolEnd("bash");
settle();
endRun();
startCaptureRun();
await assert.rejects(() => runLearn({ memory: "TERMINAL NOTE - no further capture calls this session" }), /capture process itself/);
endRun();
// user-driven turns MAY record lessons about the capture process itself —
// postmortem lessons are deliberate work, not loop exhaust (2026-11-04 regression fix)
const metaOk = await runLearn({ memory: "capture-loop root cause: typed input steers live capture runs" });
assert.match(metaOk.content[0].text, /recorded|deduplicated/);
await runLearn({ memory: "dup content lesson", context: "ctx A" });
const dupCtx = await runLearn({ memory: "dup content lesson", context: "ctx B" });
assert.match(dupCtx.content[0].text, /deduplicated/);

// --- 5. before_agent_start memory injection ---
const emptyCtx = { mode: "tui" as const, cwd: "/tmp/other-project" };
assert.equal(fire("before_agent_start", { systemPrompt: "SP" }, emptyCtx)[0], undefined, "no memory files: no injection");
const inj = fire("before_agent_start", { systemPrompt: "SP" }, tui)[0] as { systemPrompt: string };
assert.match(inj.systemPrompt, /^SP\n\n## Project memory/);
assert.ok(inj.systemPrompt.includes("Recent lessons:"), "lessons injected without summary");
assert.ok(inj.systemPrompt.includes("- lesson zero"));
fs.writeFileSync(path.join(memDir, "memory_summary.md"), "SUM.");
const inj2 = fire("before_agent_start", { systemPrompt: "SP" }, tui)[0] as { systemPrompt: string };
assert.ok(inj2.systemPrompt.includes("SUM."), "summary injected once written");

// --- 6. lesson cap ---
for (let i = 0; i < 105; i++) await runLearn({ memory: `cap lesson ${i}` });
const bullets = fs.readFileSync(learnedFile, "utf8").split("\n").filter((l: string) => l.startsWith("- "));
assert.equal(bullets.length, 100, "capped at 100 bullets");
assert.ok(bullets.some((l: string) => l.includes("cap lesson 104")), "newest kept");
assert.ok(!bullets.some((l: string) => l.includes("cap lesson 0")), "oldest dropped");

console.log("ALL AUTOLEARN TESTS PASSED");
