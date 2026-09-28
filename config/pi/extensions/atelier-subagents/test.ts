/**
 * Throwaway verification harness for atelier-subagents (run with bun).
 * Drives the extension against a structural fake of the pi event bus with a
 * fake pi-subagents RPC v1 server; asserts panel protocol emission, RPC
 * request shape, row rendering, discover replay, and poller lifecycle.
 */
import * as assert from "node:assert";
import {
	createFleetBridge,
	formatElapsed,
	formatTokens,
	renderRows,
	sanitizeGoalText,
	default as registerExtension,
} from "./index.ts";

// --- structural fake of the pi event bus ---
type Handler = (data: unknown) => void;
function createFakeBus() {
	const handlers = new Map<string, Set<Handler>>();
	const bus = {
		on(event: string, handler: Handler): () => void {
			const set = handlers.get(event) ?? new Set<Handler>();
			set.add(handler);
			handlers.set(event, set);
			return () => set.delete(handler);
		},
		emit(event: string, data: unknown): void {
			for (const handler of [...(handlers.get(event) ?? [])]) handler(data);
		},
	};
	return { bus, handlers };
}

const ATELIER_CHANNEL = "pi-atelier:sidebar-panels";
const RPC_REQUEST_EVENT = "subagents:rpc:v1:request";
const RPC_REPLY_PREFIX = "subagents:rpc:v1:reply:";
const RPC_READY_EVENT = "subagents:rpc:v1:ready";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface PanelEvent {
	version: number;
	type: string;
	source: string;
	revision: number;
	panel?: { id: string; title: string; rows: Array<{ text: string; role?: string }> };
	requestId?: string;
	id?: string;
}

function fleetEntry(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		key: "k1",
		agent: "scout",
		startedAt: Date.now() - 252_000,
		tokens: { input: 9_000, output: 3_400, total: 12_400 },
		goal: "map   the\nrepo layout",
		...overrides,
	};
}

// --- formatting helpers ---
assert.equal(formatElapsed(Date.now() - 42_000), "42s");
assert.equal(formatElapsed(Date.now() - 252_000), "4m12s");
assert.equal(formatElapsed(Date.now() - 3_780_000), "1h03m");
assert.equal(formatTokens(0), "0");
assert.equal(formatTokens(731), "731");
assert.equal(formatTokens(12_400), "12.4k");
assert.equal(formatTokens(2_500_000), "2.50M");
assert.equal(sanitizeGoalText("map   the\nrepo layout"), "map the repo layout");
assert.equal(sanitizeGoalText("x".repeat(80)).length, 64);
assert.equal(sanitizeGoalText(undefined), "");

// --- renderRows ---
assert.deepEqual(renderRows(null), [{ text: "fleet status unavailable", role: "muted" }]);
assert.deepEqual(renderRows({
	version: 1,
	entries: [],
	totalActive: 0,
	topLevelAsyncCapacity: { used: 0, limit: 4 },
	omitted: 0,
}), [{ text: "no active subagents", role: "dim" }]);

const busyFleet = {
	version: 1 as const,
	entries: [
		fleetEntry(),
		fleetEntry({ key: "k2", agent: "visual", startedAt: Date.now() - 38_000, tokens: { input: 1_500, output: 600, total: 2_100 }, goal: "" }),
	],
	totalActive: 5,
	topLevelAsyncCapacity: { used: 2, limit: 4 },
	omitted: 3,
};
const busyRows = renderRows(busyFleet);
assert.equal(busyRows[0]?.text, "5 active · async 2/4");
assert.equal(busyRows[0]?.role, "working");
assert.ok(busyRows[1]?.text.startsWith("scout          "));
assert.ok(busyRows[1]?.text.includes("4m12s"));
assert.ok(busyRows[1]?.text.includes("12.4k"));
assert.equal(busyRows[2]?.text, "  map the repo layout");
assert.equal(busyRows[2]?.role, "muted");
assert.equal(busyRows.at(-1)?.text, "… +3 more");

// goal lines dropped when the fleet is large; entries capped at 10
const crowded = {
	version: 1 as const,
	entries: Array.from({ length: 12 }, (_, i) => fleetEntry({ key: `k${i}`, agent: `agent${i}` })),
	totalActive: 12,
	topLevelAsyncCapacity: { used: 12, limit: 12 },
	omitted: 0,
};
const crowdedRows = renderRows(crowded);
assert.equal(crowdedRows.length, 1 + 10 + 1);
assert.ok(crowdedRows.every((row) => !row.text.startsWith("  ")));
assert.equal(crowdedRows.at(-1)?.text, "… +2 more");

// --- bridge against a fake RPC server ---
const { bus } = createFakeBus();
const panelEvents: PanelEvent[] = [];
bus.on(ATELIER_CHANNEL, (data) => panelEvents.push(data as PanelEvent));

const requests: Array<Record<string, unknown>> = [];
bus.on(RPC_REQUEST_EVENT, (data) => {
	const request = data as Record<string, unknown>;
	requests.push(request);
	if (request.method === "status") {
		bus.emit(`${RPC_REPLY_PREFIX}${request.requestId}`, {
			version: 1,
			requestId: request.requestId,
			method: "status",
			success: true,
			data: { fleet: busyFleet },
		});
	}
});

const bridge = createFleetBridge({ events: bus, on: () => () => undefined });

// initial registration emitted immediately, before any session
const initial = panelEvents.find((event) => event.type === "register");
assert.ok(initial);
assert.equal(initial.version, 1);
assert.equal(initial.source, "atelier-subagents");
assert.equal(initial.panel?.id, "subagents:fleet");
assert.equal(initial.panel?.title, "Subagents");
assert.deepEqual(initial.panel?.rows, [{ text: "fleet status unavailable", role: "muted" }]);

// discover replay echoes the correlation token
bus.emit(ATELIER_CHANNEL, { version: 1, type: "discover", requestId: "corr-7" });
const replay = panelEvents.filter((event) => event.type === "register").at(-1);
assert.equal(replay?.requestId, "corr-7");

// tick: RPC request shape + live rows
await bridge.tick();
assert.equal(requests.length, 1);
assert.equal(requests[0]?.version, 1);
assert.equal(requests[0]?.method, "status");
assert.deepEqual(requests[0]?.source, { extension: "atelier-subagents" });
const updated = panelEvents.filter((event) => event.type === "register").at(-1);
assert.equal(updated?.panel?.rows[0]?.text, "5 active · async 2/4");
assert.ok((updated?.revision ?? 0) > (initial.revision ?? 0));

const errorBus = createFakeBus();
errorBus.bus.on(RPC_REQUEST_EVENT, (data) => {
	const request = data as Record<string, unknown>;
	errorBus.bus.emit(`${RPC_REPLY_PREFIX}${request.requestId}`, {
		version: 1,
		requestId: request.requestId,
		success: false,
		error: { code: "no_active_session", message: "no session" },
	});
});
const errorBridge = createFleetBridge({ events: errorBus.bus, on: () => () => undefined });
await errorBridge.tick();
const errorPanels: PanelEvent[] = [];
errorBus.bus.on(ATELIER_CHANNEL, (data) => errorPanels.push(data as PanelEvent));
await errorBridge.tick();
assert.deepEqual(
	errorPanels.filter((event) => event.type === "register").at(-1)?.panel?.rows,
	[{ text: "no active subagents", role: "dim" }],
);
errorBridge.dispose();
const unregistered = errorPanels.filter((event) => event.type === "unregister").at(-1);
assert.equal(unregistered?.id, "subagents:fleet");

// rpc ready triggers a fresh request
const readyBefore = requests.length;
bus.emit(RPC_READY_EVENT, {});
await sleep(10);
assert.equal(requests.length, readyBefore + 1);

// timeouts: 3 consecutive misses flip the panel to unavailable, recovery restores rows
const timeoutBus = createFakeBus();
const timeoutPanels: PanelEvent[] = [];
timeoutBus.bus.on(ATELIER_CHANNEL, (data) => timeoutPanels.push(data as PanelEvent));
const timeoutBridge = createFleetBridge({ events: timeoutBus.bus, on: () => () => undefined });
await Promise.all([timeoutBridge.tick(), timeoutBridge.tick(), timeoutBridge.tick()]);
await sleep(1550);
const flipped = timeoutPanels.filter((event) => event.type === "register").at(-1);
assert.deepEqual(flipped?.panel?.rows, [{ text: "fleet status unavailable", role: "muted" }]);

// start/stop lifecycle via the default export
const lifecycleBus = createFakeBus();
const lifecycleRequests: Array<Record<string, unknown>> = [];
lifecycleBus.bus.on(RPC_REQUEST_EVENT, (data) => {
	const request = data as Record<string, unknown>;
	lifecycleRequests.push(request);
	lifecycleBus.bus.emit(`${RPC_REPLY_PREFIX}${request.requestId}`, {
		version: 1,
		requestId: request.requestId,
		success: true,
		data: { fleet: busyFleet },
	});
});
const sessionHandlers = new Map<string, Array<() => void>>();
registerExtension({
	events: lifecycleBus.bus,
	on: (event: string, handler: () => void) => {
		const list = sessionHandlers.get(event) ?? [];
		list.push(handler);
		sessionHandlers.set(event, list);
		return () => undefined;
	},
});
assert.ok(sessionHandlers.has("session_start"));
assert.ok(sessionHandlers.has("session_shutdown"));
sessionHandlers.get("session_start")?.forEach((handler) => handler());
assert.equal(lifecycleRequests.length, 1); // immediate tick on start
sessionHandlers.get("session_shutdown")?.forEach((handler) => handler());
await sleep(1100);
assert.equal(lifecycleRequests.length, 1); // poller cancelled

console.log("atelier-subagents: all harness assertions passed");
