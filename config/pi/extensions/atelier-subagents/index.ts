/**
 * atelier-subagents — bridges pi-subagents fleet status into a Pi Atelier
 * sidebar panel.
 *
 * Data source: pi-subagents RPC v1 (`status`) over the pi event bus — the same
 * bridge FleetView uses. UI sink: Pi Atelier's public sidebar-panel
 * contribution protocol (channel `pi-atelier:sidebar-panels`, version 1),
 * emitted as raw events so no cross-package import is needed. Panel id:
 * `subagents:fleet`; enable it in ~/.pi/agent/pi-atelier.json
 * (sidebarPanelLayout) or via /atelier Settings → Sidebar.
 *
 * The row UX follows pi-subagent-monitor's list view (agent, elapsed, tokens,
 * goal) minus its SQLite layer, which no generator on this machine writes.
 */

// --- Pi Atelier sidebar-panel protocol (v1) wire constants ---
const ATELIER_CHANNEL = "pi-atelier:sidebar-panels";
const ATELIER_PROTOCOL_VERSION = 1;
const PANEL_ID = "subagents:fleet";
const PANEL_TITLE = "Subagents";
const PANEL_SOURCE = "atelier-subagents";

// --- pi-subagents RPC v1 wire constants ---
const RPC_REQUEST_EVENT = "subagents:rpc:v1:request";
const RPC_READY_EVENT = "subagents:rpc:v1:ready";
const RPC_REPLY_PREFIX = "subagents:rpc:v1:reply:";

const POLL_MS = 1000;
const RPC_TIMEOUT_MS = 1500;
/** Atelier caps contributed panels at 24 rows; stay well under at sidebar width. */
const MAX_ENTRY_ROWS = 10;
const NAME_COLS = 14;
const ROW_CHAR_CAP = 96;

/** Owns the interval handle so its concrete timer type never leaks into contracts. */
interface PollHandle {
	cancel(): void;
}

function startInterval(fn: () => void, ms: number): PollHandle {
	const id = setInterval(fn, ms);
	return { cancel: () => clearInterval(id) };
}

interface EventBus {
	on(event: string, handler: (data: unknown) => void): () => void;
	emit(event: string, data: unknown): void;
}

interface PiSurface {
	events: EventBus;
	on(event: string, handler: (event: unknown, ctx: unknown) => void): void;
}

interface TokenUsage {
	input: number;
	output: number;
	total: number;
}

interface FleetEntry {
	key: string;
	agent: string;
	role?: string;
	model?: string;
	effort?: string;
	startedAt: number;
	tokens: TokenUsage;
	goal?: string;
}

interface FleetStatus {
	version: 1;
	entries: FleetEntry[];
	totalActive: number;
	topLevelAsyncCapacity: { used: number; limit: number };
	omitted: number;
}

interface PanelRow {
	text: string;
	role?: string;
}

interface PanelContribution {
	id: string;
	title: string;
	rows: PanelRow[];
}

// --- formatting helpers (exported for the verification harness) ---

export function formatElapsed(ms: number, now = Date.now()): string {
	const seconds = Math.max(0, Math.floor((now - ms) / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatTokens(total: number): string {
	if (!Number.isFinite(total) || total <= 0) return "0";
	if (total < 1000) return String(Math.floor(total));
	if (total < 1_000_000) return `${(total / 1000).toFixed(1)}k`;
	return `${(total / 1_000_000).toFixed(2)}M`;
}

/** Atelier collapses whitespace and strips control characters; pre-trim goals so clipping is deliberate. */
export function sanitizeGoalText(value: unknown, cap = 64): string {
	if (typeof value !== "string") return "";
	const flat = value.replace(/\s+/g, " ").trim();
	return flat.length <= cap ? flat : `${flat.slice(0, cap - 1).trimEnd()}…`;
}

export function renderRows(fleet: FleetStatus | null, now = Date.now()): PanelRow[] {
	if (!fleet) {
		return [{ text: "fleet status unavailable", role: "muted" }];
	}
	const { totalActive, topLevelAsyncCapacity, entries, omitted } = fleet;
	if (totalActive === 0 && entries.length === 0) {
		return [{ text: "no active subagents", role: "dim" }];
	}
	const rows: PanelRow[] = [
		{
			text: `${totalActive} active · async ${topLevelAsyncCapacity.used}/${topLevelAsyncCapacity.limit}`,
			role: totalActive > 0 ? "working" : "dim",
		},
	];
	const showGoals = entries.length <= 4;
	for (const entry of entries.slice(0, MAX_ENTRY_ROWS)) {
		const name = entry.agent.slice(0, NAME_COLS).padEnd(NAME_COLS);
		const elapsed = formatElapsed(entry.startedAt, now).padStart(6);
		const tokens = formatTokens(entry.tokens?.total ?? 0).padStart(7);
		rows.push({
			text: capRow(`${name}${elapsed} ${tokens}`),
			role: "working",
		});
		if (showGoals) {
			const goal = sanitizeGoalText(entry.goal);
			if (goal) rows.push({ text: capRow(`  ${goal}`), role: "muted" });
		}
	}
	if (omitted > 0 || entries.length > MAX_ENTRY_ROWS) {
		const extra = Math.max(omitted, entries.length - MAX_ENTRY_ROWS);
		rows.push({ text: `… +${extra} more`, role: "muted" });
	}
	return rows.slice(0, 24);
}

function capRow(text: string): string {
	return text.length <= ROW_CHAR_CAP ? text : `${text.slice(0, ROW_CHAR_CAP - 1)}…`;
}

// --- Atelier publisher: raw v1 register events + discover replay ---

export function createPanelPublisher(events: EventBus) {
	let revision = 0;
	let current: PanelContribution = { id: PANEL_ID, title: PANEL_TITLE, rows: renderRows(null) };
	const publish = (requestId?: string): void => {
		revision += 1;
		events.emit(ATELIER_CHANNEL, {
			version: ATELIER_PROTOCOL_VERSION,
			type: "register",
			source: PANEL_SOURCE,
			revision,
			panel: current,
			...(requestId !== undefined ? { requestId } : {}),
		});
	};
	const unsubscribe = events.on(ATELIER_CHANNEL, (data) => {
		if (!isDiscoverEvent(data)) return;
		publish(data.requestId);
	});
	publish();
	return {
		update(rows: PanelRow[]): void {
			current = { id: PANEL_ID, title: PANEL_TITLE, rows };
			publish();
		},
		dispose(): void {
			unsubscribe();
			revision += 1;
			events.emit(ATELIER_CHANNEL, {
				version: ATELIER_PROTOCOL_VERSION,
				type: "unregister",
				source: PANEL_SOURCE,
				revision,
				id: PANEL_ID,
			});
		},
	};
}

function isDiscoverEvent(data: unknown): data is { version: number; type: "discover"; requestId: string } {
	if (typeof data !== "object" || data === null) return false;
	const record = data as Record<string, unknown>;
	return (
		record.version === ATELIER_PROTOCOL_VERSION &&
		record.type === "discover" &&
		typeof record.requestId === "string" &&
		record.requestId.length > 0
	);
}

// --- pi-subagents RPC v1 client ---

function isFleetStatus(value: unknown): value is FleetStatus {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return Array.isArray(record.entries) && typeof record.totalActive === "number";
}

function extractFleet(data: unknown): FleetStatus | null {
	if (typeof data !== "object" || data === null) return null;
	const record = data as Record<string, unknown>;
	if (!isFleetStatus(record.fleet)) return null;
	return record.fleet;
}

function idleFleet(): FleetStatus {
	return { version: 1, entries: [], totalActive: 0, topLevelAsyncCapacity: { used: 0, limit: 0 }, omitted: 0 };
}

function requestFleetStatus(events: EventBus, requestId: string): Promise<FleetStatus | null> {
	const { promise, resolve } = Promise.withResolvers<FleetStatus | null>();
	let settled = false;
	const finish = (value: FleetStatus | null): void => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		unsubscribe();
		resolve(value);
	};
	const unsubscribe = events.on(`${RPC_REPLY_PREFIX}${requestId}`, (data) => {
		if (typeof data !== "object" || data === null) return finish(null);
		const record = data as Record<string, unknown>;
		// Error replies (e.g. no_active_session) and malformed payloads mean
		// "no fleet to show" — the bridge itself is alive, so render idle.
		if (record.success !== true) return finish(idleFleet());
		finish(extractFleet(record.data));
	});
	const timer = setTimeout(() => finish(null), RPC_TIMEOUT_MS);
	events.emit(RPC_REQUEST_EVENT, {
		version: 1,
		requestId,
		method: "status",
		source: { extension: PANEL_SOURCE },
	});
	return promise;
}

// --- bridge controller (exported for the verification harness) ---

export function createFleetBridge(pi: PiSurface) {
	const publisher = createPanelPublisher(pi.events);
	let poller: PollHandle | undefined;
	let requestSeq = 0;
	let consecutiveTimeouts = 0;

	const tick = async (): Promise<void> => {
		requestSeq += 1;
		const fleet = await requestFleetStatus(pi.events, `${PANEL_SOURCE}:${requestSeq}`);
		if (fleet === null) {
			consecutiveTimeouts += 1;
			if (consecutiveTimeouts >= 3) publisher.update(renderRows(null));
			return;
		}
		consecutiveTimeouts = 0;
		publisher.update(renderRows(fleet));
	};

	const unsubscribeReady = pi.events.on(RPC_READY_EVENT, () => void tick());

	return {
		tick,
		start(): void {
			if (poller !== undefined) return;
			void tick();
			poller = startInterval(() => void tick(), POLL_MS);
		},
		stop(): void {
			poller?.cancel();
			poller = undefined;
		},
		dispose(): void {
			this.stop();
			unsubscribeReady();
			publisher.dispose();
		},
	};
}

export default function registerAtelierSubagentsExtension(pi: PiSurface): void {
	const bridge = createFleetBridge(pi);
	pi.on("session_start", () => bridge.start());
	pi.on("session_shutdown", () => bridge.stop());
}
