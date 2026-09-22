/**
 * pi-autolearn — port of omp's Auto-Learn (experimental) for pi.
 *
 * Tools `learn` + `manage_skill`, writing omp-compatible formats into the canonical
 * shared directories so both harnesses read one brain:
 *   skills   → ~/.agents/skills/<name>/SKILL.md        (pi discovers natively; omp via managed-skills symlink)
 *   memories → ~/.agents/memories/<encoded-cwd>/       (learned.md lessons + memory_summary.md read-path)
 *
 * Auto-capture: after `agent_settled` with ≥ minToolCalls tool executions in the run
 * (interactive TUI mode only), fire a hidden `autolearn-nudge` follow-up turn with
 * tools restricted to learn/manage_skill, restored when the capture run ends — omp's
 * AutoLearnController pattern on pi's native events.
 *
 * Not ported from omp: SQLite-backed consolidation pipeline (pi-vcc covers pi memory),
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

// --- constants (omp parity) -------------------------------------------------

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_SKILL_BYTES = 64_000;
const MAX_LESSONS = 100;
const MAX_LESSON_CHARS = 2000;
const MAX_CONTEXT_CHARS = 400;
const MAX_MEMORY_PROMPT_CHARS = 12_000;
const MAX_PROMPT_LESSONS = 30;

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

// --- sanitization (omp parity) ------------------------------------------------

// omp: secret-redacted + injection-neutralized (control chars, <>, backticks stripped).
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

/** omp encodeProjectPath: cwd minus leading slash, [/\\:] → '-', wrapped in '--'. */
export function encodeProjectPath(cwd: string): string {
  return "--" + cwd.replace(/^\//, "").replace(/[/\\:]/g, "-") + "--";
}


/**
 * Append a lesson to learned.md, omp-format: `- lesson` / `- lesson _(context: ctx)_`,
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

  if (lines.some((l) => l === lesson)) return "lesson already recorded (deduplicated)";

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
    "## Project memory (shared with omp; lives in ~/.agents/memories)\n\n" + parts.join("\n\n");
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
  let toolCallCount = 0;
  let capturing = false;
  let suppressSettle = false;
  let lastRunAborted = false;
  let savedTools: string[] | null = null;

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
      const content = sanitizeText(params.memory).slice(0, MAX_LESSON_CHARS);
      if (!content) throw new Error("lesson empty after sanitization");
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
              params.skill.action,
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
      "surfaced to future sessions of both pi and omp like other skills. Use for repeatable " +
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
      if (params.action !== "delete" && (!params.description || !params.body)) {
        throw new Error(
          'used with both "description" and "body" for "create" and "update"',
        );
      }
      const msg =
        params.action === "delete"
          ? deleteSkill(params.name)
          : writeSkillFile(params.name, params.description!, params.body!, params.action);
      return {
        content: [{ type: "text", text: msg }],
        details: { action: params.action, name: params.name },
      };
    },
  });

  // -- memory read-path: inject summary + recent lessons into the system prompt --
  pi.on("before_agent_start", (event, ctx) => {
    const block = buildMemoryBlock(ctx.cwd ?? process.cwd());
    if (!block) return;
    return { systemPrompt: event.systemPrompt + "\n\n" + block };
  });

  // -- auto-capture controller --
  pi.on("input", () => {
    toolCallCount = 0;
    suppressSettle = false;
  });

  pi.on("message_end", (event) => {
    const m = event.message as { role?: string; stopReason?: string };
    if (m?.role === "assistant" && m.stopReason === "aborted") lastRunAborted = true;
  });

  pi.on("tool_execution_end", () => {
    toolCallCount++;
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (suppressSettle) {
      suppressSettle = false;
      return;
    }
    if (capturing) return;
    const count = toolCallCount;
    toolCallCount = 0;
    const aborted = lastRunAborted;
    lastRunAborted = false;
    if (aborted) return;

    cfg = loadConfig(); // live re-check, omp parity
    if (!cfg.enabled || !cfg.autoContinue) return;
    if (ctx.mode !== "tui") return; // interactive sessions only
    if (count < cfg.minToolCalls) return;

    savedTools = pi.getActiveTools();
    capturing = true;
    pi.setActiveTools(["learn", "manage_skill"]);
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
      suppressSettle = true; // capture run's settle must not re-trigger
    }
  });
}
