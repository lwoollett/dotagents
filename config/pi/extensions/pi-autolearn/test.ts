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
  execute: (toolCallId: string, params: never) => Promise<ToolResult>;
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
await assert.rejects(() => runManage({ action: "delete", name: "no-such" }), /does not exist/);
await runManage({ action: "delete", name: "test-skill" });
assert.ok(!fs.existsSync(skillFile), "skill dir removed");

// --- 4. controller: threshold, tools restriction, restore, no re-trigger ---
const nudgeCount = () => sentMessages.filter((s) => s.msg.customType === "autolearn-nudge").length;
for (let i = 0; i < 4; i++) fire("tool_execution_end");
fire("agent_settled", {}, tui);
assert.equal(nudgeCount(), 0, "below threshold: no nudge");

for (let i = 0; i < 5; i++) fire("tool_execution_end");
fire("agent_settled", {}, tui);
assert.equal(nudgeCount(), 1, "nudge sent at threshold");
const nudge = sentMessages[sentMessages.length - 1];
assert.ok(nudge.msg.content.includes("Automated capture turn"));
assert.equal(nudge.msg.display, false);
assert.deepEqual(nudge.opts, { triggerTurn: true, deliverAs: "followUp" });
assert.deepEqual(setActiveCalls[setActiveCalls.length - 1], ["learn", "manage_skill"]);

fire("agent_end", { messages: [] });
assert.deepEqual(activeTools, ["read", "bash", "edit", "write", "learn", "manage_skill"], "tools restored");
fire("agent_settled", {}, tui);
assert.equal(nudgeCount(), 1, "capture settle does not re-trigger");

// print mode: no auto-capture
for (let i = 0; i < 5; i++) fire("tool_execution_end");
fire("agent_settled", {}, { mode: "print", cwd: "/tmp/fake-project" });
assert.equal(nudgeCount(), 1, "print mode: no nudge");

// aborted run: no capture
fire("message_end", { message: { role: "assistant", stopReason: "aborted" } });
for (let i = 0; i < 5; i++) fire("tool_execution_end");
fire("agent_settled", {}, tui);
assert.equal(nudgeCount(), 1, "aborted: no nudge");

// disabled via live config re-check
fs.writeFileSync(process.env.PI_AUTOLEARN_CONFIG!, JSON.stringify({ enabled: true, autoContinue: false, minToolCalls: 5 }));
for (let i = 0; i < 5; i++) fire("tool_execution_end");
fire("agent_settled", {}, tui);
assert.equal(nudgeCount(), 1, "autoContinue=false: no nudge");
fs.writeFileSync(process.env.PI_AUTOLEARN_CONFIG!, JSON.stringify({ enabled: true, autoContinue: true, minToolCalls: 5 }));

// user input resets the counter
for (let i = 0; i < 3; i++) fire("tool_execution_end");
fire("input", { text: "hello", source: "interactive" });
for (let i = 0; i < 3; i++) fire("tool_execution_end");
fire("agent_settled", {}, tui);
assert.equal(nudgeCount(), 1, "input resets counter: 3+3 < 5 each");

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
