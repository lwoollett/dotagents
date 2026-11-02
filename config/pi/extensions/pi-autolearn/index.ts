/**
 * pi-autolearn — Auto-Learn for pi (experimental).
 *
 * Tools `learn` + `manage_skill`, writing markdown skills and memories into the
 * canonical shared directories so every pi session reads one brain:
 *   skills   → ~/.agents/skills/<name>/SKILL.md        (discovered natively via config/pi/skills)
 *   memories → ~/.agents/memories/<encoded-cwd>/       (learned.md lessons + memory_summary.md read-path)
 *
 * Auto-capture: after a user-initiated run (`before_agent_start` messageType "user")
 * with ≥ minToolCalls non-capture tool executions (interactive TUI mode only), fire a
 * hidden `autolearn-nudge` follow-up turn. The capture run starts with tools restricted
 * to learn/manage_skill plus a hard per-run capture budget, and its settle can never
 * re-nudge — the AutoLearnController pattern on pi's native events.
 *
 * Loop hardening from the 2026-10-30 / 2026-11-02 postmortem (nudge storms on subagent
 * wakes, 19-call capture spirals, meta-lessons polluting learned.md):
 *   - nudges fire only after user-initiated runs; custom-triggered runs (subagent
 *     wakes, queued sendMessage turns) never nudge;
 *   - counters reset at before_agent_start (per run) — `input` alone missed non-user
 *     runs, letting counts accumulate across runs;
 *   - learn/manage_skill executions never count toward minToolCalls (capture activity
 *     must not re-arm the capture threshold) and are capped per capture run.
 *
 * Deliberately absent: SQLite-backed consolidation pipeline (pi-vcc covers pi memory),
 * mnemopi/hindsight backends, authored-skill shadow refusal (single shared skills dir).
 *
 * Paths are env-overridable for testing:
 *   PI_AUTOLEARN_CONFIG, PI_AUTOLEARN_SKILLS_DIR, PI_AUTOLEARN_MEMORIES_DIR
 */
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// --- constants ------------------------------------------------------------------

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_SKILL_BYTES = 64_000;
const MAX_LESSONS = 100;
const MAX_LESSON_CHARS = 2000;
const MAX_CONTEXT_CHARS = 400;
const MAX_MEMORY_PROMPT_CHARS = 12_000;
const MAX_PROMPT_LESSONS = 30;
const CAPTURE_BUDGET = 2;

const CONFIG_PATH =
  process.env.PI_AUTOLEARN_CONFIG ?? path.join(os.homedir(), ".pi", "agent", "autolearn.json");
const SKILLS_DIR =
  process.env.PI_AUTOLEARN_SKILLS_DIR ?? path.join(os.homedir(), ".agents", "skills");
const MEMORIES_DIR =
  process.env.PI_AUTOLEARN_MEMORIES_DIR ?? path.join(os.homedir(), ".agents", "memories");

const NUDGE = [
  "Automated capture turn — not a user reply.",
  "Review the work just completed in this session.",
  "If it revealed a repeatable procedure worth codifying, call manage_skill (create or update).",
  "If it revealed a durable fact worth remembering, call learn.",
  "Hard limits: at most one learn call and one manage_skill call in total, and never a lesson about the capture process itself.",
  "If nothing is worth keeping, do nothing — capture sparingly.",
  "Then stop: no questions, no further work.",
].join(" ");

// --- config ------------------------------------------------------------------

interface AutolearnConfig {
  enabled: boolean;
  autoContinue: boolean;
  minToolCalls: number;
}

const DEFAULT_CONFIG: AutolearnConfig = {
  enabled: true,
  autoContinue: true,
  minToolCalls: 5,
};

function loadConfig(): AutolearnConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AutolearnConfig>;
    return {
      enabled: parsed.enabled ?? DEFAULT_CONFIG.enabled,
      autoContinue: parsed.autoContinue ?? DEFAULT_CONFIG.autoContinue,
      minToolCalls: Math.max(1, Number(parsed.minToolCalls) || DEFAULT_CONFIG.minToolCalls),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function scaffoldConfig(): void {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", "utf8");
    }
  } catch {
    // config scaffold is best-effort; defaults apply on failure
  }
}

// --- sanitization ------------------------------------------------------------------

// secret-redacted + injection-neutralized (control chars, <>, backticks stripped).
const SECRET_PATTERNS =
  /(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|nvapi-[A-Za-z0-9_-]{10,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|Bearer\s+[A-Za-z0-9._-]{20,})/gi;

export function sanitizeText(raw: string): string {
  return raw
    .replace(SECRET_PATTERNS, "[REDACTED]")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029]/g, "")
    .replace(/[<>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeSkillName(raw: string): string {
  return raw.trim().toLowerCase();
}

// --- managed skills (~/.agents/skills) ----------------------------------------

/** Double-quoted YAML scalar — valid YAML, safe for any sanitized one-line string. */
function yamlScalar(s: string): string {
  return JSON.stringify(s);
}

export function toSkillFrontmatter(name: string, description: string): string {
  return `---\nname: ${yamlScalar(name)}\ndescription: ${yamlScalar(description)}\n---\n`;
}


export function writeSkillFile(
  name: string,
  description: string,
  body: string,
  mode: "create" | "update",
): string {
  const n = sanitizeSkillName(name);
  if (!SKILL_NAME_PATTERN.test(n)) {
    throw new Error(
      `invalid skill name '${n}': must be 1-64 chars, lowercase alphanumerics and hyphens, starting alphanumeric`,
    );
  }
  const d = sanitizeText(description);
  if (!d) throw new Error("description empty after sanitization");
  const b = body.trim();
  if (!b) throw new Error("body empty");

  const full = toSkillFrontmatter(n, d) + "\n" + b + "\n";
  if (Buffer.byteLength(full, "utf8") > MAX_SKILL_BYTES) {
    throw new Error(`skill exceeds ${MAX_SKILL_BYTES} bytes`);
  }

  const dir = path.join(SKILLS_DIR, n);
  const file = path.join(dir, "SKILL.md");
  if (mode === "create" && fs.existsSync(file)) {
    throw new Error(`skill '${n}' already exists — use action:'update'`);
  }
  if (mode === "update" && !fs.existsSync(file)) {
    throw new Error(`skill '${n}' does not exist — use action:'create'`);
  }
  // No-op guard: byte-identical content already on disk. Re-issuing a succeeded
  // identical call is a known agent loop hazard (2026-10-06 ×10, 2026-10-10 ×4);
  // surface it as an error so the loop gets corrective feedback instead of success.
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === full) {
    throw new Error(
      `skill '${n}' already contains exactly this content — ${mode} is a no-op, nothing written. ` +
        `Rule: ONE manage_skill call per intended final state. If the file needs changing, ` +
        `the payload must differ; if it is already correct, stop.`,
    );
  }
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.SKILL.md.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, full, "utf8");
  fs.renameSync(tmp, file);
  return `Skill '${n}' ${mode === "create" ? "created" : "updated"} at ${file}. Visible to new sessions; /reload refreshes the current one.`;
}

export function deleteSkill(name: string): string {
  const n = sanitizeSkillName(name);
  if (!SKILL_NAME_PATTERN.test(n)) throw new Error(`invalid skill name '${n}'`);
  const dir = path.join(SKILLS_DIR, n);
  const file = path.join(dir, "SKILL.md");
  if (!fs.existsSync(file)) throw new Error(`skill '${n}' does not exist`);
  fs.rmSync(dir, { recursive: true, force: true });
  return `Skill '${n}' deleted.`;
}

// --- memories (~/.agents/memories/<encoded-cwd>) -------------------------------

/** encodeProjectPath: cwd minus leading slash, [/\\:] → '-', wrapped in '--'. */
export function encodeProjectPath(cwd: string): string {
  return "--" + cwd.replace(/^\//, "").replace(/[/\\:]/g, "-") + "--";
}

// Lessons about the capture process itself ("no further lessons this turn",
// "terminating the capture loop") are loop exhaust, not knowledge — observed
// polluting learned.md newest-first during the 2026-10-30 / 2026-11-02 spirals.
const CAPTURE_META_PATTERN =
  /\b(no further (?:lessons?|captures?|capture calls?)|no more (?:lessons?|learn calls?|captures?)|terminat\w*\s+(?:the\s+)?(?:self[- ])?capture|\bcapture (?:loops?|spirals?|budget|turns?)|last entry this turn|terminal note|stop (?:capturing|using (?:the )?(?:learn|manage[- ]?skill)))\b/i;

export function isCaptureMetaLesson(content: string): boolean {
  return CAPTURE_META_PATTERN.test(content);
}


/**
 * Append a lesson to learned.md, format: `- lesson` / `- lesson _(context: ctx)_`,
 * newest-first (inserted before the first bullet), exact-line dedupe, cap 100 bullets,
 * hand-edited non-bullet lines preserved.
 */
export function saveLearnedLesson(cwd: string, content: string, context?: string): string {
  const lesson = context ? `- ${content} _(context: ${context})_` : `- ${content}`;
  const root = path.join(MEMORIES_DIR, encodeProjectPath(cwd));
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, "learned.md");

  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const lines = text.length ? text.split("\n") : [];
  while (lines.length && lines[lines.length - 1] === "") lines.pop();

  if (lines.some((l) => l === lesson || l.startsWith(`- ${content} _(`)))
    return "lesson already recorded (deduplicated)";

  const firstBullet = lines.findIndex((l) => l.startsWith("- "));
  if (firstBullet === -1) lines.push(lesson);
  else lines.splice(firstBullet, 0, lesson);

  // cap: drop oldest bullets (last ones) beyond MAX_LESSONS
  let bulletIdx = lines.map((l, i) => (l.startsWith("- ") ? i : -1)).filter((i) => i >= 0);
  while (bulletIdx.length > MAX_LESSONS) {
    const drop = bulletIdx[bulletIdx.length - 1];
    lines.splice(drop, 1);
    bulletIdx.pop();
  }

  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
  return "lesson recorded";
}

/** memory_summary.md + recent lessons for the system prompt, or null when empty. */
export function buildMemoryBlock(cwd: string): string | null {
  const root = path.join(MEMORIES_DIR, encodeProjectPath(cwd));
  const parts: string[] = [];
  const summaryFile = path.join(root, "memory_summary.md");
  const lessonsFile = path.join(root, "learned.md");
  if (fs.existsSync(summaryFile)) {
    const s = fs.readFileSync(summaryFile, "utf8").trim();
    if (s) parts.push(s);
  }
  if (fs.existsSync(lessonsFile)) {
    const bullets = fs
      .readFileSync(lessonsFile, "utf8")
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .slice(0, MAX_PROMPT_LESSONS);
    if (bullets.length) parts.push("Recent lessons:\n" + bullets.join("\n"));
  }
  if (!parts.length) return null;
  let block =
    "## Project memory (lives in ~/.agents/memories)\n\n" + parts.join("\n\n");
  if (block.length > MAX_MEMORY_PROMPT_CHARS) {
    block = block.slice(0, MAX_MEMORY_PROMPT_CHARS).trimEnd() + "\n…(truncated)";
  }
  return block;
}

// --- extension ----------------------------------------------------------------

export default function piAutolearn(pi: ExtensionAPI): void {
  scaffoldConfig();
  let cfg = loadConfig();

  // -- controller state --
  // Loop hardening (see header): per-run resets keyed off before_agent_start,
  // user-run gate via messageType, capture tools excluded from the threshold,
  // capture budget enforced inside the tool executors.
  let runIsUser = false;
  let capturing = false;
  let captureCallsThisRun = 0;
  let toolCallCount = 0;
  let savedTools: string[] | null = null;

  /** During a capture run: allow up to CAPTURE_BUDGET executions, then return the
   *  stop instruction. Success-shaped on purpose — error results invite retries. */
  const captureBudgetGuard = (): string | null => {
    if (!capturing) return null;
    if (captureCallsThisRun < CAPTURE_BUDGET) {
      captureCallsThisRun++;
      return null;
    }
    return (
      `Capture budget exhausted (${CAPTURE_BUDGET} learn/manage_skill calls this automated capture turn). ` +
      "Do not call learn or manage_skill again. Reply with a one-line summary (or nothing) and stop."
    );
  };

  pi.registerTool({
    name: "learn",
    label: "Learn",
    description:
      "Capture a durable lesson in long-term memory; optionally mint or enhance a managed skill " +
      "in the same call. Use after solving insight likely to pay off again: a non-obvious fix, " +
      "a discovered project convention, or a workflow that worked. Capture sparingly, " +
      "specifically: one strong reusable lesson beats several vague ones.",
    promptSnippet:
      "learn: capture reusable lessons in long-term memory (optionally minting a managed skill)",
    promptGuidelines: [
      "Capture lessons sparingly and specifically — one strong reusable lesson beats several vague ones.",
    ],
    parameters: Type.Object({
      memory: Type.String({
        description: "the durable, self-contained lesson to remember (what, when, why)",
      }),
      context: Type.Optional(
        Type.String({ description: "optional source context for the lesson" }),
      ),
      skill: Type.Optional(
        Type.Object(
          {
            action: StringEnum(["create", "update"], {
              description: "also create or enhance a managed skill",
            }),
            name: Type.String({ description: "kebab-case skill name" }),
            description: Type.String({
              description: "one-line description of when to use the skill",
            }),
            body: Type.String({
              description: "the SKILL.md body in markdown (no frontmatter)",
            }),
          },
          { description: "also create or enhance a managed skill in the same call" },
        ),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const capped = captureBudgetGuard();
      if (capped)
        return {
          content: [{ type: "text", text: capped }],
          details: { captureBudgetExhausted: true },
        };
      const content = sanitizeText(params.memory).slice(0, MAX_LESSON_CHARS);
      if (!content) throw new Error("lesson empty after sanitization");
      if (isCaptureMetaLesson(content))
        throw new Error(
          "rejected: this lesson is about the capture process itself, not the work — " +
            "capture lessons describe the work; if capture is misbehaving, say so in chat instead",
        );
      const context = params.context
        ? sanitizeText(params.context).slice(0, MAX_CONTEXT_CHARS)
        : undefined;
      const cwd = ctx.cwd ?? process.cwd();
      const stored = saveLearnedLesson(cwd, content, context);

      let skillMsg = "";
      if (params.skill) {
        try {
          skillMsg =
            "\n" +
            writeSkillFile(
              params.skill.name,
              params.skill.description,
              params.skill.body,
              params.skill.action as "create" | "update",
            );
        } catch (e) {
          return {
            content: [
              {
                type: "text",
                text: `Lesson stored (${stored}), but skill ${params.skill.action} failed: ${(e as Error).message}`,
              },
            ],
            details: { stored: true, skillError: String((e as Error).message) },
          };
        }
      }
      return {
        content: [{ type: "text", text: `Lesson recorded: ${stored}${skillMsg}` }],
        details: { stored: true },
      };
    },
  });

  pi.registerTool({
    name: "manage_skill",
    label: "Manage Skill",
    description:
      "Managed skills: SKILL.md files in the shared skills directory (~/.agents/skills), " +
      "surfaced to future sessions like other skills. Use for repeatable " +
      "procedures worth codifying — setup sequences, debugging recipes, project-specific " +
      "workflows. Prefer enhancing an existing managed skill to creating a near-duplicate.",
    promptSnippet: "manage_skill: mint reusable procedure skills (create/update/delete)",
    promptGuidelines: [
      "Skill requires reuse; prefer enhancing an existing managed skill to creating a near-duplicate.",
    ],
    parameters: Type.Object({
      action: StringEnum(["create", "update", "delete"], {
        description: "operation to perform",
      }),
      name: Type.String({ description: "kebab-case skill name" }),
      description: Type.Optional(
        Type.String({
          description:
            "one-line description of when to use the skill (required for create/update)",
        }),
      ),
      body: Type.Optional(
        Type.String({
          description:
            "the SKILL.md body in markdown, no frontmatter (required for create/update)",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const capped = captureBudgetGuard();
      if (capped)
        return {
          content: [{ type: "text", text: capped }],
          details: { captureBudgetExhausted: true, action: params.action, name: params.name },
        };
      if (params.action !== "delete" && (!params.description || !params.body)) {
        throw new Error(
          'used with both "description" and "body" for "create" and "update"',
        );
      }
      const msg =
        params.action === "delete"
          ? deleteSkill(params.name)
          : writeSkillFile(params.name, params.description!, params.body!, params.action as "create" | "update");
      return {
        content: [{ type: "text", text: msg }],
        details: { captureBudgetExhausted: false, action: params.action, name: params.name },
      };
    },
  });

  // -- memory read-path + per-run controller reset --
  pi.on("before_agent_start", (event, ctx) => {
    // Per-run reset for EVERY run kind (user, custom, queued, wake): the old
    // `input`-only reset missed non-user runs, so counts accumulated and nudges
    // fired on subagent wakes / queued-message runs (2026-10-30 nudge storm).
    toolCallCount = 0;
    runIsUser = event.messageType === "user";
    capturing =
      event.messageType === "custom" && event.message.customType === "autolearn-nudge";
    if (capturing) {
      captureCallsThisRun = 0;
      savedTools = pi.getActiveTools();
      pi.setActiveTools(["learn", "manage_skill"]);
    }
    const block = buildMemoryBlock(ctx.cwd ?? process.cwd());
    if (!block) return;
    return { systemPrompt: event.systemPrompt + "\n\n" + block };
  });

  // -- auto-capture controller --
  pi.on("tool_execution_end", (event) => {
    // capture tools never count toward minToolCalls — capture must not re-arm itself
    if (event.toolName === "learn" || event.toolName === "manage_skill") return;
    toolCallCount++;
  });

  pi.on("agent_settled", (event, ctx) => {
    if (capturing) return; // capture runs never re-nudge
    if (!runIsUser) return; // subagent wakes / queued-message runs get no capture pass
    if (event.aborted) return;

    cfg = loadConfig(); // live re-check
    if (!cfg.enabled || !cfg.autoContinue) return;
    if (ctx.mode !== "tui") return; // interactive sessions only
    if (toolCallCount < cfg.minToolCalls) return;

    pi.sendMessage(
      { customType: "autolearn-nudge", content: NUDGE, display: false },
      { triggerTurn: true, deliverAs: "followUp" },
    );
  });

  pi.on("agent_end", () => {
    if (capturing) {
      if (savedTools) pi.setActiveTools(savedTools);
      savedTools = null;
      capturing = false;
      captureCallsThisRun = 0;
    }
  });
}
