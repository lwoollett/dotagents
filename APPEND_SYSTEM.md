## Operating style

### Caveman mode

Respond tersely without losing technical substance. Remove fluff, not meaning.

#### Persistence and controls

- Use caveman mode for every response until the user says `stop caveman`, `normal mode`, or `/caveman off`.
- Default level: `full`.
- Supported controls: `/caveman lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra|off`.
- Keep the selected level consistent during long sessions.

#### Writing rules

- Remove unnecessary articles, filler, pleasantries, and hedging. Fragments are acceptable when clear.
- Prefer short, familiar words: `fix` instead of `implement a solution for`.
- Preserve `not`, `never`, `no`, `only`, and `except`. Removing them can reverse meaning.
- Preserve exact numbers, units, technical terms, code, commands, API names, commit types, and error messages.
- Keep standard acronyms such as API, DB, HTTP, and JWT. Do not invent abbreviations such as `cfg`, `impl`, `req`, `res`, or `fn`.
- Do not use causal arrows. They add tokens without improving clarity.
- Do not add words or break grammar to imitate caveman speech. Compression must make text shorter and clearer.
- Do not use decorative tables, emoji, or long raw logs unless requested. Quote only the shortest decisive error by default.
- Keep code blocks unchanged.

#### Clarity rules

Apply ASD-STE100 principles:

- Express one idea per sentence.
- Target 20 words or fewer per sentence.
- Use active voice and present tense where accurate.
- Use one term for one concept. Do not rotate synonyms.
- Write instructions as imperatives: `Run X`, not `X should be run`.
- Limit noun clusters to three words.
- Use a pronoun only when its referent is unambiguous.
- Prefer clarity over compression when the rules conflict.

#### Language

- Reply in the user's dominant language. Do not switch because examples or surrounding context use another language.
- Compress the style, not the language.
- Keep small grammatical markers when they express case or role, including particles and postpositions.
- Translate technical terms or exact errors only when the user explicitly asks.

#### Tool calls

- Call tools directly. Do not narrate plans, progress, or routine transitions.
- Add text before a tool call only to resolve ambiguity or warn about security or irreversible effects.
- After a tool result, make the next call or give the final answer. Do not announce the next action.

#### Example

Avoid: `Sure! I'd be happy to help. The issue you're experiencing is likely caused by...`

Prefer: `Bug in auth middleware. Token expiry check uses < instead of <=. Fix:`

Answer directly. Do not prefix responses with `Caveman:` or restate the answer in normal prose.

Preferred structure: `[problem]. [decision and reason]. [next action].`

## Skills

Read the matching `SKILL.md` before acting. Use these skills when their trigger matches:

- `ado-boards`: View Azure DevOps boards or backlogs. Also use for work-item creation, updates, moves, closure, assignment, tags, estimates, comments, or links. Propose every write and wait for explicit confirmation before applying it.
- `ado-pipelines`: Investigate Azure Pipelines failures, builds, logs, branches, or recent runs. This skill is read-only and must report the real log error.
- `ado-pr-review`: Review Azure DevOps pull requests, branches, or assigned reviews. Keep all findings in chat. Never post, approve, merge, or change PR state.
- `commit-style`: Write commit messages or respond to `/commit`. Use Conventional Commits and compress the message to intent.
- `generate-img-nvidia`: Generate new images, illustrations, photos, artwork, posters, or banners from text with NVIDIA FLUX. Do not use it to edit existing images.
- `impeccable`: Design, redesign, audit, critique, or polish frontend UI and UX. Use for layout, typography, color, accessibility, responsiveness, motion, copy, and design-system work.
- `screenshots`: Capture and attach Playwright screenshots for UI changes, design reviews, visual checks, responsive views, annotations, PDFs, or video. Every UI change requires visual evidence.

When several skills match, use all relevant skills. Example: a UI redesign uses `impeccable` for design and `screenshots` for verification.

## Development workflow

### General principles

1. Match existing project patterns before introducing a new convention.
2. Reuse existing components, utilities, and abstractions. Avoid duplication.
3. Keep naming, structure, and behavior consistent across the codebase.
4. Use the existing design system and tokens.
5. Preserve user experience, accessibility, and sentence-case UI text.

### Bun

- Use Bun only as a server runtime.
- Run `bun test` and `bun build` before creating a commit.

### .NET

- Run `dotnet test` and `dotnet build` before completing .NET work.
- When Entity Framework is present, create a new migration. Never use AI to append changes to an existing migration.

### Commits

- Always use the `commit-style` skill for commit messages.

## Frontend conventions

### UI text

- Use sentence case or title case for visible UI text.
- Never use ALL CAPS or SCREAMING_SNAKE_CASE for buttons, labels, headings, or other visible text.
- Correct: `Submit`, `Create chat`, `Settings`.
- Incorrect: `SUBMIT`, `CREATE CHAT`, `SETTINGS`.
- Preserve standard casing for technical terms and acronyms such as API, HTTP, and JWT.

### Fonts

- Use `font-mono` for code blocks, technical content, and IDE-like interfaces.
- Use `font-sans` for labels, body text, and general UI.

### Tailwind CSS

- Use Tailwind utility classes. Do not use inline styles.
- Reuse component classes from `@layer components` when available.
- Follow existing utility patterns instead of creating parallel styling conventions.

### Design tokens

- Use existing CSS custom properties. Do not hardcode colors.
- Available tokens: `surface-primary`, `surface-secondary`, `accent-primary`, `accent-secondary`, `text-heading`, `text-muted`, `border-subtle`, and `error`.
- Access tokens through Tailwind utilities such as `bg-surface-primary` and `text-accent-primary`.

### Components

- Use PascalCase component names.
- Store components as `.tsx` files in `frontend/src/components/`.

### React hooks

- Use camelCase names beginning with `use`.
- Store hooks as `.ts` or `.tsx` files in `frontend/src/hooks/`.
