import { stat } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
//#region lib/types/client-contract.js
/** Browser-safe constants and JSON decoders shared by Host and Web faces. */
/** Private Connection RPC channel used by this package's Host and Web faces. */
const USAGE_RPC_CHANNEL = "/usage-monitor";
/** Windowed usage snapshot. */
const USAGE_QUERY_ENDPOINT = "usage/query";
const isRecord$2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const asFinite = (value) => typeof value === "number" && Number.isFinite(value) ? value : void 0;
const asNonNegInt$1 = (value) => {
	const n = asFinite(value);
	return n !== void 0 && Number.isInteger(n) && n >= 0 ? n : void 0;
};
const asString$1 = (value) => typeof value === "string" && value.length > 0 ? value : void 0;
const decodeEvent = (value) => {
	if (!isRecord$2(value)) return void 0;
	const time = asFinite(value.time);
	const day = asString$1(value.day);
	const provider = asString$1(value.provider);
	const model = asString$1(value.model);
	const workspaceId = asString$1(value.workspaceId);
	const workspaceTitle = asString$1(value.workspaceTitle);
	const requests = asNonNegInt$1(value.requests);
	const uncachedInputTokens = asNonNegInt$1(value.uncachedInputTokens);
	const outputTokens = asNonNegInt$1(value.outputTokens);
	const cacheReadTokens = asNonNegInt$1(value.cacheReadTokens);
	const cacheWriteTokens = asNonNegInt$1(value.cacheWriteTokens);
	if (time === void 0 || day === void 0 || provider === void 0 || model === void 0 || workspaceId === void 0 || workspaceTitle === void 0 || requests === void 0 || uncachedInputTokens === void 0 || outputTokens === void 0 || cacheReadTokens === void 0 || cacheWriteTokens === void 0) return void 0;
	return {
		time,
		day,
		provider,
		model,
		workspaceId,
		workspaceTitle,
		requests,
		uncachedInputTokens,
		outputTokens,
		cacheReadTokens,
		cacheWriteTokens
	};
};
const decodeSummary = (value) => {
	if (!isRecord$2(value)) return void 0;
	const tokens = asNonNegInt$1(value.tokens);
	const requests = asNonNegInt$1(value.requests);
	const outputTokens = asNonNegInt$1(value.outputTokens);
	const pricedRequests = asNonNegInt$1(value.pricedRequests);
	const unpricedRequests = asNonNegInt$1(value.unpricedRequests);
	const estimatedCostUsd = value.estimatedCostUsd === null ? null : asFinite(value.estimatedCostUsd);
	const cachedInputRate = value.cachedInputRate === null ? null : asFinite(value.cachedInputRate);
	if (tokens === void 0 || requests === void 0 || outputTokens === void 0 || pricedRequests === void 0 || unpricedRequests === void 0 || estimatedCostUsd === void 0 || cachedInputRate === void 0) return void 0;
	return {
		tokens,
		requests,
		outputTokens,
		estimatedCostUsd,
		cachedInputRate,
		pricedRequests,
		unpricedRequests
	};
};
/** Decode a client query payload. Extra fields are rejected. */
function decodeUsageQueryRequest(value) {
	if (!isRecord$2(value)) return void 0;
	if (Object.keys(value).some((key) => key !== "start" && key !== "end")) return void 0;
	const start = asFinite(value.start);
	const end = asFinite(value.end);
	if (start === void 0 || end === void 0 || end < start) return void 0;
	return {
		start,
		end
	};
}
/** Decode a Host usage snapshot. */
function decodeUsageSnapshot(value) {
	if (!isRecord$2(value)) return void 0;
	const summary = decodeSummary(value.summary);
	if (summary === void 0 || !Array.isArray(value.events)) return void 0;
	const events = [];
	for (const item of value.events) {
		const event = decodeEvent(item);
		if (event === void 0) return void 0;
		events.push(event);
	}
	return {
		summary,
		events
	};
}
//#endregion
//#region lib/types/fold.js
/**
* Fold a session log into per-step usage samples.
* Same turn/step replaces the earlier sample instead of double-counting.
*/
const UNKNOWN = "unknown";
const isRecord$1 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const asInt = (value) => typeof value === "number" && Number.isInteger(value) ? value : void 0;
const asNonNegInt = (value) => {
	const n = asInt(value);
	return n !== void 0 && n >= 0 ? n : void 0;
};
const asString = (value) => typeof value === "string" && value.length > 0 ? value : void 0;
const bucketsFrom = (usage) => {
	const inputTokens = asNonNegInt(usage.inputTokens);
	const outputTokens = asNonNegInt(usage.outputTokens);
	if (inputTokens === void 0 || outputTokens === void 0) return void 0;
	return {
		uncachedInputTokens: inputTokens,
		outputTokens,
		cacheReadTokens: asNonNegInt(usage.cacheReadTokens) ?? 0,
		cacheWriteTokens: asNonNegInt(usage.cacheWriteTokens) ?? 0
	};
};
const usageOf = (event) => {
	if (!isRecord$1(event.data)) return void 0;
	const turn = asInt(event.data.turn);
	const step = asInt(event.data.step);
	if (turn === void 0 || step === void 0) return void 0;
	if (event.type === "assistant/chunk") {
		const chunk = event.data.chunk;
		if (!isRecord$1(chunk) || chunk.type !== "usage" || !isRecord$1(chunk.usage)) return void 0;
		const buckets = bucketsFrom(chunk.usage);
		return buckets === void 0 ? void 0 : {
			turn,
			step,
			buckets
		};
	}
	if (event.type === "assistant/message") {
		if (!isRecord$1(event.data.usage)) return void 0;
		const buckets = bucketsFrom(event.data.usage);
		return buckets === void 0 ? void 0 : {
			turn,
			step,
			buckets
		};
	}
};
const routeOf = (event) => {
	if (!isRecord$1(event.data)) return void 0;
	if (event.type === "request/header") {
		const header = event.data.header;
		if (!isRecord$1(header) || !isRecord$1(header.config)) return void 0;
		const provider = asString(header.config.provider);
		const model = asString(header.config.model);
		if (provider === void 0 || model === void 0) return void 0;
		return {
			provider,
			model
		};
	}
	if (event.type === "request/context") {
		const provider = asString(event.data.provider);
		const model = asString(event.data.model);
		if (provider === void 0 || model === void 0) return void 0;
		return {
			provider,
			model
		};
	}
};
const stepKey = (turn, step) => `${turn}:${step}`;
var SessionUsageReducer = class {
	provider = UNKNOWN;
	model = UNKNOWN;
	byStep = /* @__PURE__ */ new Map();
	order = [];
	stamp;
	constructor(stamp) {
		this.stamp = {
			sessionId: stamp.sessionId,
			workspaceId: stamp.workspaceId,
			workspaceTitle: stamp.workspaceTitle
		};
	}
	accept(event) {
		const route = routeOf(event);
		if (route !== void 0) {
			this.provider = route.provider;
			this.model = route.model;
		}
		const usage = usageOf(event);
		if (usage === void 0) return;
		const key = stepKey(usage.turn, usage.step);
		const sample = {
			time: event.time,
			...this.stamp,
			provider: this.provider,
			model: this.model,
			...usage.buckets
		};
		if (!this.byStep.has(key)) this.order.push(key);
		this.byStep.set(key, sample);
	}
	finish() {
		return this.order.map((key) => this.byStep.get(key)).filter((sample) => sample !== void 0);
	}
};
/** Fold one session's events into per-step usage samples. */
function foldSessionUsage(input) {
	const reducer = new SessionUsageReducer(input);
	for (const event of input.events) reducer.accept(event);
	return reducer.finish();
}
/**
* Fold a raw JSONL session without first allocating an event array. Each line
* is parsed and reduced before the scanner advances to the next newline.
*/
function foldRawSessionUsage(input) {
	const reducer = new SessionUsageReducer(input);
	let start = 0;
	while (start <= input.content.length) {
		const newline = input.content.indexOf("\n", start);
		const end = newline === -1 ? input.content.length : newline;
		if (end > start) {
			const event = parseRawFoldableEvent(input.content.slice(start, end));
			if (event !== void 0) reducer.accept(event);
		}
		if (newline === -1) break;
		start = newline + 1;
	}
	return reducer.finish();
}
/** Parse one raw JSONL line when it can participate in usage folding. */
function parseRawFoldableEvent(line) {
	let record;
	try {
		record = JSON.parse(line);
	} catch {
		return;
	}
	if (!isRecord$1(record)) return void 0;
	const { type, time, data } = record;
	if (typeof type !== "string" || typeof time !== "number" || !Number.isFinite(time)) return void 0;
	return {
		type,
		time,
		...data === void 0 ? {} : { data }
	};
}
//#endregion
//#region lib/types/pricing.js
/**
* Local USD estimates. Missing rates stay unknown — never invent a number.
*/
/**
* Published API rates we can stand behind. Subscription / local routes stay
* off this table so the UI can say Unknown instead of guessing.
*/
const BUILTIN_PRICING = Object.freeze({
	"deepseek/deepseek-chat": {
		inputPerMillion: .28,
		cachedInputPerMillion: .028,
		outputPerMillion: .42
	},
	"deepseek/deepseek-reasoner": {
		inputPerMillion: .28,
		cachedInputPerMillion: .028,
		outputPerMillion: .42
	}
});
const aliasesOf = (provider, model) => {
	const trimmedModel = model.trim();
	const trimmedProvider = provider.trim();
	const bare = trimmedModel.includes("/") ? trimmedModel.slice(trimmedModel.lastIndexOf("/") + 1) : trimmedModel;
	return [
		`${trimmedProvider}/${trimmedModel}`,
		`${trimmedProvider}/${bare}`,
		trimmedModel,
		bare
	];
};
/** Look up rates for a provider/model pair. */
function lookupPricing(table, provider, model) {
	for (const key of aliasesOf(provider, model)) {
		const found = table[key];
		if (found !== void 0) return found;
	}
}
/** USD cost for one sample, or null when the model has no rates. */
function estimateCost(buckets, pricing) {
	if (pricing === void 0) return null;
	const cachedRate = pricing.cachedInputPerMillion ?? pricing.inputPerMillion;
	const writeRate = pricing.cacheWritePerMillion ?? pricing.inputPerMillion;
	return (buckets.uncachedInputTokens * pricing.inputPerMillion + buckets.cacheReadTokens * cachedRate + buckets.cacheWriteTokens * writeRate + buckets.outputTokens * pricing.outputPerMillion) / 1e6;
}
/** Providers known to report cache-read tokens when a cache hit occurs. */
const CACHE_CAPABLE_PROVIDERS = /* @__PURE__ */ new Set([
	"deepseek",
	"openai-codex",
	"kimi-coding",
	"official",
	"openai"
]);
function reportsCache(provider, cacheReadTokens) {
	return cacheReadTokens > 0 || CACHE_CAPABLE_PROVIDERS.has(provider);
}
//#endregion
//#region lib/types/query.js
/**
* Window a folded corpus into daily rollups plus summary tiles.
*/
const dayKey = (time) => {
	const date = new Date(time);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const dayStart = (time) => {
	const date = new Date(time);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
};
const rollupKey = (step, day) => `${day}\0${step.provider}\0${step.model}\0${step.workspaceId}`;
const emptyRollup = (step, day, time) => ({
	time,
	day,
	provider: step.provider,
	model: step.model,
	workspaceId: step.workspaceId,
	workspaceTitle: step.workspaceTitle,
	requests: 0,
	uncachedInputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0
});
const addStep = (target, step) => {
	target.requests += 1;
	target.uncachedInputTokens += step.uncachedInputTokens;
	target.outputTokens += step.outputTokens;
	target.cacheReadTokens += step.cacheReadTokens;
	target.cacheWriteTokens += step.cacheWriteTokens;
};
const tokensOf$1 = (step) => step.uncachedInputTokens + step.outputTokens + step.cacheReadTokens + step.cacheWriteTokens;
/** Filter steps to `[start, end)`, roll up by local day, and compute tiles. */
function queryUsage(input) {
	const rollups = /* @__PURE__ */ new Map();
	let tokens = 0;
	let requests = 0;
	let outputTokens = 0;
	let pricedRequests = 0;
	let unpricedRequests = 0;
	let estimatedCostUsd = 0;
	let cacheKnownInput = 0;
	let cacheKnownRead = 0;
	let sawCacheCapable = false;
	for (const step of input.steps) {
		if (step.time < input.start || step.time >= input.end) continue;
		const day = dayKey(step.time);
		const key = rollupKey(step, day);
		const existing = rollups.get(key);
		const rollup = existing ?? emptyRollup(step, day, dayStart(step.time));
		addStep(rollup, step);
		if (existing === void 0) rollups.set(key, rollup);
		tokens += tokensOf$1(step);
		outputTokens += step.outputTokens;
		requests += 1;
		const cost = estimateCost(step, lookupPricing(input.pricing, step.provider, step.model));
		if (cost === null) unpricedRequests += 1;
		else {
			pricedRequests += 1;
			estimatedCostUsd += cost;
		}
		if (reportsCache(step.provider, step.cacheReadTokens)) {
			sawCacheCapable = true;
			cacheKnownInput += step.uncachedInputTokens + step.cacheReadTokens;
			cacheKnownRead += step.cacheReadTokens;
		}
	}
	return {
		summary: {
			tokens,
			requests,
			outputTokens,
			estimatedCostUsd: pricedRequests === 0 ? null : estimatedCostUsd,
			cachedInputRate: !sawCacheCapable || cacheKnownInput === 0 ? null : cacheKnownRead / cacheKnownInput,
			pricedRequests,
			unpricedRequests
		},
		events: [...rollups.values()].sort((left, right) => {
			if (left.time !== right.time) return left.time - right.time;
			if (left.provider !== right.provider) return left.provider.localeCompare(right.provider);
			if (left.model !== right.model) return left.model.localeCompare(right.model);
			return left.workspaceId.localeCompare(right.workspaceId);
		})
	};
}
//#endregion
//#region lib/types/collect.js
/**
* Walk a session corpus, fold each log, and answer a usage window.
*/
const UNKNOWN_WORKSPACE_ID = "unknown";
const UNKNOWN_WORKSPACE_TITLE = "Unknown";
/**
* Cache capacity must cover the whole session working set. A corpus larger
* than the limit evicts entries mid-pass, so every query re-reads and re-folds
* the same tail of full session logs from disk (seconds to minutes on real
* homes). Fold rows are small step aggregates, so sizing for thousands of
* sessions costs little memory.
*/
const FOLD_CACHE_LIMIT = 4096;
/** In-memory fold cache keyed by session id + persistence revision. */
var FoldCache = class {
	limit;
	rows = /* @__PURE__ */ new Map();
	pending = /* @__PURE__ */ new Map();
	constructor(limit = FOLD_CACHE_LIMIT) {
		this.limit = limit;
	}
	get(id, revision) {
		if (revision === void 0) return void 0;
		const row = this.rows.get(id);
		return row !== void 0 && row.revision === revision ? row.steps : void 0;
	}
	set(id, revision, steps) {
		this.rows.delete(id);
		this.rows.set(id, {
			revision,
			steps
		});
		while (this.rows.size > this.limit) {
			const oldest = this.rows.keys().next().value;
			if (oldest === void 0) break;
			this.rows.delete(oldest);
		}
	}
	/**
	* Exact revision hit, else stale-while-revalidate, else load.
	* Failed loads are not stored.
	*/
	getOrLoad(id, revision, load) {
		const cached = this.get(id, revision);
		if (cached !== void 0) return Promise.resolve(cached);
		const key = `${id}:${revision ?? "*"}`;
		let pending = this.pending.get(key);
		if (pending === void 0) {
			pending = load().then((steps) => {
				if (revision !== void 0) this.set(id, revision, steps);
				return steps;
			}).catch(() => this.rows.get(id)?.steps ?? []).finally(() => {
				this.pending.delete(key);
			});
			this.pending.set(key, pending);
		}
		const stale = this.rows.get(id)?.steps;
		if (stale !== void 0) return Promise.resolve(stale);
		return pending;
	}
};
const trimSlash = (path) => path.replace(/[/\\]+$/u, "");
/** Resolve a session to a workspace by membership, then by cwd path / prefix. */
function resolveWorkspace(workspaces, sessionId, cwd) {
	const byMembership = workspaces.find((workspace) => workspace.sessionIds.includes(sessionId));
	if (byMembership !== void 0) return {
		id: byMembership.id,
		title: byMembership.title
	};
	if (cwd !== void 0 && cwd.length > 0) {
		const needle = trimSlash(cwd);
		const byPath = workspaces.filter((workspace) => {
			const root = trimSlash(workspace.path);
			return needle === root || needle.startsWith(`${root}/`) || needle.startsWith(`${root}\\`);
		}).sort((left, right) => trimSlash(right.path).length - trimSlash(left.path).length)[0];
		if (byPath !== void 0) return {
			id: byPath.id,
			title: byPath.title
		};
	}
	return {
		id: UNKNOWN_WORKSPACE_ID,
		title: UNKNOWN_WORKSPACE_TITLE
	};
}
/** Fold one corpus session through its raw-aware adapter when available. */
async function foldCorpusSession(corpus, stamp) {
	if (corpus.foldSession !== void 0) return corpus.foldSession(stamp);
	const events = await corpus.readEvents(stamp.sessionId);
	return foldSessionUsage({
		...stamp,
		events
	});
}
async function mapPool(items, concurrency, fn) {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next;
			next += 1;
			const item = items[index];
			if (item === void 0) continue;
			results[index] = await fn(item);
		}
	};
	await Promise.all(Array.from({ length: limit }, () => worker()));
	return results;
}
/** Fold every session and return the windowed snapshot. */
async function collectUsage(input) {
	const sessions = await input.corpus.listSessions();
	const workspaces = input.workspaces.list();
	const inWindow = sessions.filter((session) => session.createdAt === void 0 || session.createdAt < input.query.end);
	const foldOne = async (session) => {
		const workspace = resolveWorkspace(workspaces, session.id, session.cwd);
		return foldCorpusSession(input.corpus, {
			sessionId: session.id,
			workspaceId: workspace.id,
			workspaceTitle: workspace.title
		});
	};
	return queryUsage({
		steps: (await mapPool(inWindow, input.concurrency ?? 1, async (session) => {
			try {
				if (input.cache === void 0) return await foldOne(session);
				return await input.cache.getOrLoad(session.id, session.revision, () => foldOne(session));
			} catch {
				return [];
			}
		})).flat(),
		start: input.query.start,
		end: input.query.end,
		pricing: input.pricing ?? BUILTIN_PRICING
	});
}
//#endregion
//#region lib/types/projection.js
/**
* Durable, revision-aware final-usage projection for exact range queries.
*
* Source logs remain authoritative. The SQLite sidecar stores only complete
* folds for the current projection version; changed sessions are replaced in
* bounded transactions and failed replacements are made visibly incomplete.
*/
const PROJECTION_VERSION = 1;
const BUSY_TIMEOUT_MS = 5e3;
/** Default plugin-owned sidecar path for the active DSH home. */
function defaultUsageProjectionPath() {
	const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	return join(home, "storages", "dsh-usage-monitor.sqlite");
}
/**
* Reconcile source revisions through one shared worker, then answer windows
* only from complete rows. Disposal rejects new work and waits for active
* queries before closing SQLite.
*/
var UsageProjection = class {
	db;
	workerPromise;
	nextTicket = 0;
	pendingTickets = /* @__PURE__ */ new Map();
	accepting = true;
	activeWork = 0;
	idleWaiters = [];
	closePromise;
	checkpointNeeded;
	constructor(path) {
		mkdirSync(dirname(path), { recursive: true });
		this.db = new DatabaseSync(path);
		this.db.exec([
			"PRAGMA journal_mode = WAL",
			"PRAGMA synchronous = NORMAL",
			`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`,
			"CREATE TABLE IF NOT EXISTS usage_projection_sessions (id TEXT PRIMARY KEY, revision TEXT NOT NULL, projection_version INTEGER NOT NULL, complete INTEGER NOT NULL CHECK (complete IN (0, 1))) STRICT",
			"CREATE TABLE IF NOT EXISTS usage_projection_steps (session_id TEXT NOT NULL, ordinal INTEGER NOT NULL, time INTEGER NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, workspace_id TEXT NOT NULL, workspace_title TEXT NOT NULL, uncached_input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL, cache_write_tokens INTEGER NOT NULL, PRIMARY KEY (session_id, ordinal)) STRICT",
			"CREATE INDEX IF NOT EXISTS usage_projection_steps_time ON usage_projection_steps (time)"
		].join(";"));
		const row = this.db.prepare("SELECT COUNT(*) AS count FROM usage_projection_sessions WHERE projection_version = ? AND complete = 1").get(PROJECTION_VERSION);
		this.checkpointNeeded = row.count === 0;
	}
	/**
	* Reconcile every potentially relevant session before returning the range.
	* @param input - Source, workspace view, requested range, and optional bounds.
	* @returns The exact usage snapshot for `input.query`.
	*/
	async query(input) {
		this.beginWork();
		try {
			const snapshot = await this.enqueueReconcile({
				corpus: input.corpus,
				workspaces: input.workspaces,
				end: input.query.end,
				readConcurrency: input.readConcurrency ?? 1,
				transactionBatchSize: input.transactionBatchSize ?? 8
			});
			return queryUsage({
				steps: this.readIndexedSteps(input.query, input.workspaces.list(), snapshot),
				start: input.query.start,
				end: input.query.end,
				pricing: input.pricing ?? BUILTIN_PRICING
			});
		} finally {
			this.finishWork();
		}
	}
	/**
	* Join the shared reconciliation worker. A request arriving during a pass is
	* assigned a later ticket, which forces a follow-up source listing.
	* @param request - Source and bounded reconciliation settings.
	* @returns Nothing after the request's stable epoch completes.
	*/
	async reconcile(request) {
		this.beginWork();
		try {
			await this.enqueueReconcile(request);
		} finally {
			this.finishWork();
		}
	}
	enqueueReconcile(request) {
		const id = ++this.nextTicket;
		const result = new Promise((resolve, reject) => {
			this.pendingTickets.set(id, {
				id,
				request,
				resolve,
				reject
			});
		});
		this.ensureWorker();
		return result;
	}
	ensureWorker() {
		if (this.workerPromise === void 0) {
			const worker = this.runWorker();
			this.workerPromise = worker;
			worker.finally(() => {
				if (this.workerPromise !== worker) return;
				this.workerPromise = void 0;
				if (this.pendingTickets.size > 0) this.ensureWorker();
			}).catch(() => void 0);
		}
	}
	/**
	* Stop accepting work and close SQLite after every active operation settles.
	* @returns A promise that resolves after the database closes.
	*/
	close() {
		if (this.closePromise !== void 0) return this.closePromise;
		this.accepting = false;
		this.closePromise = (async () => {
			if (this.activeWork > 0) await new Promise((resolve) => this.idleWaiters.push(resolve));
			this.db.close();
		})();
		return this.closePromise;
	}
	async runWorker() {
		while (this.pendingTickets.size > 0) {
			const head = this.pendingTickets.values().next().value;
			if (head === void 0) return;
			const corpus = head.request.corpus;
			try {
				while (true) {
					const cohort = [...this.pendingTickets.values()].filter((ticket) => ticket.request.corpus === corpus);
					const epoch = Math.max(...cohort.map((ticket) => ticket.id));
					const request = {
						corpus,
						workspaces: cohort[0]?.request.workspaces ?? head.request.workspaces,
						end: Math.max(...cohort.map((ticket) => ticket.request.end)),
						readConcurrency: Math.min(...cohort.map((ticket) => ticket.request.readConcurrency)),
						transactionBatchSize: Math.min(...cohort.map((ticket) => ticket.request.transactionBatchSize))
					};
					const snapshot = await this.reconcileUntilStable(request);
					if ([...this.pendingTickets.values()].some((ticket) => ticket.request.corpus === corpus && ticket.id > epoch)) continue;
					for (const ticket of cohort) {
						this.pendingTickets.delete(ticket.id);
						ticket.resolve(snapshot);
					}
					break;
				}
			} catch (error) {
				const failed = [...this.pendingTickets.values()].filter((ticket) => ticket.request.corpus === corpus);
				for (const ticket of failed) {
					this.pendingTickets.delete(ticket.id);
					ticket.reject(error);
				}
			}
		}
	}
	async reconcileUntilStable(request) {
		let sessions = await request.corpus.listSessions();
		let signature = this.sessionSignature(sessions);
		let outcome = await this.reconcileListing(sessions, request);
		let rebuilt = outcome.rebuilt;
		while (true) {
			const verified = await request.corpus.listSessions();
			const verifiedSignature = this.sessionSignature(verified);
			if (verifiedSignature === signature) {
				if (this.checkpointNeeded && rebuilt) {
					this.db.prepare("PRAGMA wal_checkpoint(PASSIVE)").all();
					this.checkpointNeeded = false;
				}
				return {
					sessions: new Map(verified.map((session) => [session.id, session])),
					volatile: outcome.volatile
				};
			}
			sessions = verified;
			signature = verifiedSignature;
			outcome = await this.reconcileListing(sessions, request);
			rebuilt ||= outcome.rebuilt;
		}
	}
	beginWork() {
		if (!this.accepting) throw new Error("usage projection is closing");
		this.activeWork += 1;
	}
	finishWork() {
		this.activeWork -= 1;
		if (this.activeWork !== 0) return;
		const waiters = this.idleWaiters;
		this.idleWaiters = [];
		for (const resolve of waiters) resolve();
	}
	sessionSignature(sessions) {
		return JSON.stringify([...sessions].map((session) => [
			session.id,
			session.revision ?? null,
			session.createdAt ?? null,
			session.cwd ?? null
		]).sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
	}
	async reconcileListing(sessions, request) {
		const indexed = /* @__PURE__ */ new Map();
		for (const row of this.db.prepare("SELECT id, revision FROM usage_projection_sessions WHERE projection_version = ? AND complete = 1").all(PROJECTION_VERSION)) indexed.set(row.id, row.revision);
		this.removeDeletedSessions(sessions);
		const rebuild = sessions.filter((session) => (session.createdAt === void 0 || session.createdAt < request.end) && (session.revision === void 0 || indexed.get(session.id) !== session.revision));
		const volatile = /* @__PURE__ */ new Map();
		const batchSize = Math.max(1, Math.floor(request.transactionBatchSize));
		for (let offset = 0; offset < rebuild.length; offset += batchSize) {
			const batch = rebuild.slice(offset, offset + batchSize);
			const results = await mapPool(batch, Math.max(1, Math.floor(request.readConcurrency)), async (session) => {
				try {
					const workspace = resolveWorkspace(request.workspaces.list(), session.id, session.cwd);
					return {
						session,
						steps: await foldCorpusSession(request.corpus, {
							sessionId: session.id,
							workspaceId: workspace.id,
							workspaceTitle: workspace.title
						})
					};
				} catch (error) {
					return {
						session,
						error
					};
				}
			});
			let firstError;
			try {
				this.commitBatch(results);
			} catch (error) {
				firstError = error;
				this.markBatchStale(results.map((result) => result.session));
			}
			for (const result of results) {
				if (result.session.revision === void 0 && result.steps !== void 0) volatile.set(result.session.id, result.steps);
				if (firstError === void 0 && result.error !== void 0) firstError = result.error;
				result.steps = void 0;
				result.error = void 0;
			}
			results.length = 0;
			batch.length = 0;
			if (firstError !== void 0) throw firstError;
		}
		return {
			volatile,
			rebuilt: rebuild.length > 0
		};
	}
	removeDeletedSessions(sessions) {
		const current = new Set(sessions.map((session) => session.id));
		const deleted = this.db.prepare("SELECT id FROM usage_projection_sessions").all().filter((row) => !current.has(row.id));
		if (deleted.length === 0) return;
		const deleteSteps = this.db.prepare("DELETE FROM usage_projection_steps WHERE session_id = ?");
		const deleteSession = this.db.prepare("DELETE FROM usage_projection_sessions WHERE id = ?");
		this.db.exec("BEGIN");
		try {
			for (const row of deleted) {
				deleteSteps.run(row.id);
				deleteSession.run(row.id);
			}
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}
	commitBatch(results) {
		const replace = this.db.prepare("INSERT INTO usage_projection_sessions (id, revision, projection_version, complete) VALUES (?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, projection_version = excluded.projection_version, complete = 1");
		const markStale = this.db.prepare("INSERT INTO usage_projection_sessions (id, revision, projection_version, complete) VALUES (?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, projection_version = excluded.projection_version, complete = 0");
		const deleteSteps = this.db.prepare("DELETE FROM usage_projection_steps WHERE session_id = ?");
		const deleteSession = this.db.prepare("DELETE FROM usage_projection_sessions WHERE id = ?");
		const insertStep = this.db.prepare("INSERT INTO usage_projection_steps (session_id, ordinal, time, provider, model, workspace_id, workspace_title, uncached_input_tokens, output_tokens, cache_read_tokens, cache_write_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
		this.db.exec("BEGIN");
		try {
			for (const result of results) {
				const { session, steps, error } = result;
				if (session.revision === void 0) {
					deleteSteps.run(session.id);
					deleteSession.run(session.id);
					continue;
				}
				deleteSteps.run(session.id);
				if (error !== void 0 || steps === void 0) {
					markStale.run(session.id, session.revision, PROJECTION_VERSION);
					continue;
				}
				replace.run(session.id, session.revision, PROJECTION_VERSION);
				for (let ordinal = 0; ordinal < steps.length; ordinal += 1) {
					const step = steps[ordinal];
					if (step === void 0) continue;
					insertStep.run(session.id, ordinal, step.time, step.provider, step.model, step.workspaceId, step.workspaceTitle, step.uncachedInputTokens, step.outputTokens, step.cacheReadTokens, step.cacheWriteTokens);
				}
			}
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}
	markBatchStale(sessions) {
		const markStale = this.db.prepare("INSERT INTO usage_projection_sessions (id, revision, projection_version, complete) VALUES (?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, projection_version = excluded.projection_version, complete = 0");
		const deleteSteps = this.db.prepare("DELETE FROM usage_projection_steps WHERE session_id = ?");
		const deleteSession = this.db.prepare("DELETE FROM usage_projection_sessions WHERE id = ?");
		this.db.exec("BEGIN");
		try {
			for (const session of sessions) {
				deleteSteps.run(session.id);
				if (session.revision === void 0) deleteSession.run(session.id);
				else markStale.run(session.id, session.revision, PROJECTION_VERSION);
			}
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}
	readIndexedSteps(query, workspaces, snapshot) {
		const rows = this.db.prepare([
			"SELECT p.session_id, p.time, p.provider, p.model, p.workspace_id, p.workspace_title,",
			"p.uncached_input_tokens, p.output_tokens, p.cache_read_tokens, p.cache_write_tokens",
			"FROM usage_projection_steps AS p",
			"JOIN usage_projection_sessions AS s ON s.id = p.session_id",
			"WHERE p.time >= ? AND p.time < ? AND s.projection_version = ? AND s.complete = 1",
			"ORDER BY p.time, p.session_id, p.ordinal"
		].join(" ")).all(query.start, query.end, PROJECTION_VERSION);
		const steps = [];
		for (const row of rows) {
			const session = snapshot.sessions.get(String(row.session_id));
			if (!this.sessionCanContribute(session, query.end)) continue;
			steps.push(this.restoreStep(row, workspaces, snapshot.sessions));
		}
		for (const [sessionId, volatileSteps] of snapshot.volatile) {
			const session = snapshot.sessions.get(sessionId);
			if (!this.sessionCanContribute(session, query.end)) continue;
			const workspace = resolveWorkspace(workspaces, session.id, session.cwd);
			for (const step of volatileSteps) {
				if (step.time < query.start || step.time >= query.end) continue;
				steps.push({
					...step,
					workspaceId: workspace.id,
					workspaceTitle: workspace.title
				});
			}
		}
		return steps;
	}
	sessionCanContribute(session, end) {
		return session !== void 0 && (session.createdAt === void 0 || session.createdAt < end);
	}
	restoreStep(row, workspaces, sessions) {
		const sessionId = String(row.session_id);
		const session = sessions.get(sessionId);
		const workspace = session === void 0 ? {
			id: String(row.workspace_id),
			title: String(row.workspace_title)
		} : resolveWorkspace(workspaces, session.id, session.cwd);
		return {
			time: Number(row.time),
			sessionId,
			workspaceId: workspace.id,
			workspaceTitle: workspace.title,
			provider: String(row.provider),
			model: String(row.model),
			uncachedInputTokens: Number(row.uncached_input_tokens),
			outputTokens: Number(row.output_tokens),
			cacheReadTokens: Number(row.cache_read_tokens),
			cacheWriteTokens: Number(row.cache_write_tokens)
		};
	}
};
//#endregion
//#region lib/types/chart.js
/**
* Client-side stacked aggregation: Metric × By × Group over daily rollups.
*/
const OTHER_SERIES_KEY = "other";
const TOP_SERIES = 6;
const SERIES_COLORS = [
	"#3941ff",
	"#00a8a8",
	"#7c3aed",
	"#0ea5e9",
	"#b1a7ff",
	"#10b981"
];
const OTHER_SERIES_COLOR = "#cbd5e1";
const startOfDay = (date) => {
	const next = new Date(date);
	next.setHours(0, 0, 0, 0);
	return next;
};
const addDays = (date, days) => {
	const next = new Date(date);
	next.setDate(next.getDate() + days);
	return next;
};
const startOfWeekMonday = (date) => {
	const start = startOfDay(date);
	const weekday = start.getDay();
	const offset = weekday === 0 ? -6 : 1 - weekday;
	return addDays(start, offset);
};
const differenceInDays = (start, end) => Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / 864e5);
const tokensOf = (event) => event.uncachedInputTokens + event.outputTokens + event.cacheReadTokens + event.cacheWriteTokens;
const segmentHidden = (key, hidden, topKeys, hideOther) => topKeys.has(key) ? hidden.has(key) : hideOther;
const metricValue = (event, metric) => metric === "request" ? event.requests : tokensOf(event);
function breakdownOf(event, breakdown) {
	if (breakdown === "model") return {
		key: `model:${event.provider}:${event.model}`,
		label: `${event.provider} / ${event.model}`
	};
	if (breakdown === "workspace") return {
		key: `workspace:${event.workspaceId}`,
		label: event.workspaceTitle
	};
	return {
		key: `provider:${event.provider}`,
		label: event.provider
	};
}
function bucketSpecs(span, group, locale) {
	const start = startOfDay(span.start);
	const end = startOfDay(span.end);
	const formatter = new Intl.DateTimeFormat(locale, {
		month: "numeric",
		day: "numeric"
	});
	if (group === "day") {
		const count = Math.max(1, differenceInDays(start, end) + 1);
		return Array.from({ length: count }, (_, offset) => {
			const bucketStart = addDays(start, offset);
			return {
				start: bucketStart,
				endExclusive: addDays(bucketStart, 1),
				label: formatter.format(bucketStart)
			};
		});
	}
	const first = startOfWeekMonday(start);
	const last = startOfWeekMonday(end);
	const buckets = [];
	for (let cursor = first; cursor.getTime() <= last.getTime(); cursor = addDays(cursor, 7)) {
		const endExclusive = addDays(cursor, 7);
		buckets.push({
			start: cursor,
			endExclusive,
			label: `${formatter.format(cursor)}–${formatter.format(addDays(endExclusive, -1))}`
		});
	}
	return buckets;
}
function buildStackedSeries(events, span, group, metric, breakdown, locale, otherLabel) {
	const raw = bucketSpecs(span, group, locale).map((spec) => ({
		...spec,
		totals: /* @__PURE__ */ new Map()
	}));
	const labels = /* @__PURE__ */ new Map();
	const seriesTotals = /* @__PURE__ */ new Map();
	for (const event of events) {
		const value = metricValue(event, metric);
		if (value <= 0) continue;
		const bucket = raw.find((candidate) => event.time >= candidate.start.getTime() && event.time < candidate.endExclusive.getTime());
		if (bucket === void 0) continue;
		const segment = breakdownOf(event, breakdown);
		labels.set(segment.key, segment.label);
		bucket.totals.set(segment.key, (bucket.totals.get(segment.key) ?? 0) + value);
		seriesTotals.set(segment.key, (seriesTotals.get(segment.key) ?? 0) + value);
	}
	const ranked = [...seriesTotals.entries()].sort((left, right) => right[1] - left[1]);
	const topKeys = ranked.slice(0, TOP_SERIES).map(([key]) => key);
	const topSet = new Set(topKeys);
	const hasOther = ranked.length > TOP_SERIES;
	const colorAt = (index) => SERIES_COLORS[index] ?? "#cbd5e1";
	const series = topKeys.map((key, index) => ({
		key,
		label: labels.get(key) ?? key,
		total: seriesTotals.get(key) ?? 0,
		color: colorAt(index)
	}));
	if (hasOther) {
		const otherTotal = ranked.slice(TOP_SERIES).reduce((sum, [, value]) => sum + value, 0);
		series.push({
			key: OTHER_SERIES_KEY,
			label: otherLabel,
			total: otherTotal,
			color: OTHER_SERIES_COLOR
		});
	}
	return {
		buckets: raw.map((spec) => {
			const segments = [];
			let otherValue = 0;
			for (const [key, value] of spec.totals) if (topSet.has(key)) segments.push({
				key,
				label: labels.get(key) ?? key,
				value
			});
			else otherValue += value;
			if (hasOther && otherValue > 0) segments.push({
				key: OTHER_SERIES_KEY,
				label: otherLabel,
				value: otherValue
			});
			const ordered = series.map((item) => segments.find((segment) => segment.key === item.key) ?? {
				key: item.key,
				label: item.label,
				value: 0
			});
			return {
				start: spec.start,
				endExclusive: spec.endExclusive,
				label: spec.label,
				segments: ordered,
				total: ordered.reduce((sum, segment) => sum + segment.value, 0)
			};
		}),
		series,
		hasData: series.some((item) => item.total > 0)
	};
}
/** One row per By-group, same four numbers as the summary tiles. */
function breakdownRows(events, breakdown, hidden, topKeys, hideOther) {
	const rows = /* @__PURE__ */ new Map();
	for (const event of events) {
		const segment = breakdownOf(event, breakdown);
		if (segmentHidden(segment.key, hidden, topKeys, hideOther)) continue;
		const row = rows.get(segment.key) ?? {
			label: segment.label,
			tokens: 0,
			requests: 0,
			outputTokens: 0,
			cacheKnownInput: 0,
			cacheKnownRead: 0,
			sawCache: false
		};
		row.tokens += tokensOf(event);
		row.requests += event.requests;
		row.outputTokens += event.outputTokens;
		if (event.cacheReadTokens > 0 || event.uncachedInputTokens > 0) {
			row.sawCache = row.sawCache || event.cacheReadTokens > 0;
			row.cacheKnownInput += event.uncachedInputTokens + event.cacheReadTokens;
			row.cacheKnownRead += event.cacheReadTokens;
		}
		rows.set(segment.key, row);
	}
	return [...rows.entries()].map(([key, row]) => ({
		key,
		label: row.label,
		tokens: row.tokens,
		requests: row.requests,
		outputTokens: row.outputTokens,
		cachedInputRate: !row.sawCache || row.cacheKnownInput === 0 ? null : row.cacheKnownRead / row.cacheKnownInput
	})).sort((left, right) => right.tokens - left.tokens || left.label.localeCompare(right.label));
}
/** Round a chart max up to 1 / 2 / 5 × 10^n so the Y-axis stays readable. */
function niceMax(value) {
	if (value <= 1) return 1;
	const magnitude = 10 ** Math.floor(Math.log10(value));
	const normalized = value / magnitude;
	return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
}
//#endregion
//#region lib/types/index.js
/**
* Host face: fold session logs and serve a loopback usage snapshot RPC.
* @module dsh-usage-monitor
*/
const name = "dsh-usage-monitor";
const inject = [
	"sessionQuery",
	"workspaceRegistry",
	"sessionPersistence"
];
const READ_BUDGET_MS = 2e4;
const DEFAULT_CONFIG = {
	projectionWarmup: "on-demand",
	projectionReadConcurrency: 1,
	projectionTransactionBatchSize: 8
};
const configIssue = (message, key) => ({
	message,
	...key === void 0 ? {} : { path: [key] }
});
/** Standard Schema validator that accepts an omitted plugin config and applies bounded on-demand defaults. */
const Config = { "~standard": {
	version: 1,
	vendor: "dsh-usage-monitor",
	validate(value) {
		if (value === void 0) value = {};
		if (!isRecord(value)) return { issues: [configIssue("expected an object")] };
		const projectionWarmup = value.projectionWarmup ?? DEFAULT_CONFIG.projectionWarmup;
		const projectionReadConcurrency = value.projectionReadConcurrency ?? DEFAULT_CONFIG.projectionReadConcurrency;
		const projectionTransactionBatchSize = value.projectionTransactionBatchSize ?? DEFAULT_CONFIG.projectionTransactionBatchSize;
		const issues = [];
		if (projectionWarmup !== "on-demand") issues.push(configIssue("must be 'on-demand'", "projectionWarmup"));
		if (!Number.isSafeInteger(projectionReadConcurrency) || Number(projectionReadConcurrency) < 1) issues.push(configIssue("must be a positive safe integer", "projectionReadConcurrency"));
		if (!Number.isSafeInteger(projectionTransactionBatchSize) || Number(projectionTransactionBatchSize) < 1) issues.push(configIssue("must be a positive safe integer", "projectionTransactionBatchSize"));
		if (issues.length > 0) return { issues };
		return { value: {
			projectionWarmup: "on-demand",
			projectionReadConcurrency: Number(projectionReadConcurrency),
			projectionTransactionBatchSize: Number(projectionTransactionBatchSize)
		} };
	}
} };
function internalError(message) {
	return {
		ok: false,
		error: {
			code: "internal",
			message,
			details: {}
		}
	};
}
const abortAsError = (signal) => new Promise((_, reject) => {
	if (signal.aborted) {
		reject(/* @__PURE__ */ new Error("aborted"));
		return;
	}
	signal.addEventListener("abort", () => reject(/* @__PURE__ */ new Error("aborted")), { once: true });
});
async function withBudget(budgetMs, run, timedOut) {
	const controller = new AbortController();
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => {
			controller.abort();
			reject(new Error(timedOut));
		}, budgetMs);
	});
	const work = run(controller.signal);
	work.catch(() => void 0);
	timeout.catch(() => void 0);
	try {
		return await Promise.race([work, timeout]);
	} finally {
		if (timer !== void 0) clearTimeout(timer);
	}
}
/** Dispatch the usage-monitor RPC. */
function createUsageRpcHandler(deps) {
	return async (endpoint, payload, signal) => {
		if (endpoint !== "usage/query") return internalError(`unknown usage endpoint: ${endpoint}`);
		const query = decodeUsageQueryRequest(payload);
		if (query === void 0) return internalError("invalid usage query");
		try {
			const work = deps.collect(query);
			work.catch(() => void 0);
			const cancelled = abortAsError(signal);
			cancelled.catch(() => void 0);
			return {
				ok: true,
				value: await Promise.race([work, cancelled])
			};
		} catch {
			return internalError(signal.aborted ? "usage query cancelled" : "usage query failed");
		}
	};
}
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
/**
* Parse one raw artifact's text into foldable events. The backend hands back
* the stored bytes verbatim — including the header line and event types this
* host does not validate — so every line must fend for itself: unparseable
* lines and records without a string `type` plus finite numeric `time` are
* skipped rather than rejected.
*/
function parseRawEvents(content) {
	const events = [];
	let start = 0;
	while (start <= content.length) {
		const newline = content.indexOf("\n", start);
		const end = newline === -1 ? content.length : newline;
		if (end > start) {
			const event = parseRawFoldableEvent(content.slice(start, end));
			if (event !== void 0) events.push(event);
		}
		if (newline === -1) break;
		start = newline + 1;
	}
	return events;
}
const findLive = (sessions, sessionId) => sessions?.list()?.find((session) => String(session.id) === sessionId) ?? sessions?.get(sessionId);
/**
* Read one persisted session's events. The raw-artifact path comes first: it
* skips the host's strict event validation, so sessions carrying event types
* unknown to this build still fold instead of failing their read outright —
* a failed read is never cached and would be retried on every single query.
*/
async function readPersistedEvents(persistence, sessionId) {
	return withBudget(READ_BUDGET_MS, async (signal) => {
		if (persistence.readRaw !== void 0) {
			const raw = await persistence.readRaw(sessionId, signal);
			if (raw !== void 0) return parseRawEvents(raw.content);
		}
		if (persistence.readFrom !== void 0) return (await persistence.readFrom(sessionId, 0, signal)).events;
		if (persistence.inspect !== void 0) return (await persistence.inspect(sessionId, signal)).events;
		return [];
	}, "session read timed out");
}
async function foldPersistedSession(persistence, stamp) {
	return withBudget(READ_BUDGET_MS, async (signal) => {
		if (persistence.readRaw !== void 0) {
			const raw = await persistence.readRaw(stamp.sessionId, signal);
			if (raw !== void 0) return foldRawSessionUsage({
				...stamp,
				content: raw.content
			});
		}
		if (persistence.readFrom !== void 0) {
			const events = (await persistence.readFrom(stamp.sessionId, 0, signal)).events;
			return foldSessionUsage({
				...stamp,
				events
			});
		}
		if (persistence.inspect !== void 0) {
			const events = (await persistence.inspect(stamp.sessionId, signal)).events;
			return foldSessionUsage({
				...stamp,
				events
			});
		}
		return [];
	}, "session read timed out");
}
/**
* Build the session-id → cache-revision index. The backend's own snapshot
* listing wins; when that rejects — one malformed artifact poisons the whole
* listing — fall back to stat-ing each located artifact so unchanged sessions
* keep hitting the fold cache.
*/
async function resolveRevisionIndex(persistence, records, signal) {
	if (persistence.listSnapshots !== void 0) {
		const snapshots = await persistence.listSnapshots(signal).catch(() => void 0);
		if (snapshots !== void 0) return new Map(snapshots.map((snapshot) => [String(snapshot.header.id), String(snapshot.revision)]));
	}
	const revisions = /* @__PURE__ */ new Map();
	if (persistence.locate === void 0) return revisions;
	for (const record of records) {
		signal.throwIfAborted();
		try {
			const location = persistence.locate(record.header);
			if (location === void 0) continue;
			const info = await stat(location.path, { bigint: true });
			revisions.set(String(record.header.id), `${info.size}:${info.mtimeNs}`);
		} catch {}
	}
	return revisions;
}
function corpusFrom(sessionQuery, persistence, sessions) {
	const getSessions = typeof sessions === "function" ? sessions : () => sessions;
	return {
		async listSessions() {
			const store = getSessions();
			return withBudget(READ_BUDGET_MS, async (signal) => {
				const records = await sessionQuery.listSessions(signal);
				const revisionById = await resolveRevisionIndex(persistence, records, signal);
				return records.map((record) => {
					const id = String(record.header.id);
					const live = record.live === true ? findLive(store, id) : void 0;
					const revision = live !== void 0 ? `live:${live.seq}` : revisionById.get(id);
					return {
						id,
						...record.header.cwd === void 0 ? {} : { cwd: record.header.cwd },
						...record.header.createdAt === void 0 ? {} : { createdAt: record.header.createdAt },
						...revision === void 0 ? {} : { revision }
					};
				});
			}, "session list timed out");
		},
		async readEvents(sessionId) {
			const live = findLive(getSessions(), sessionId);
			if (live !== void 0) return live.events;
			return readPersistedEvents(persistence, sessionId);
		},
		async foldSession(stamp) {
			const live = findLive(getSessions(), stamp.sessionId);
			if (live !== void 0) return foldSessionUsage({
				...stamp,
				events: live.events
			});
			return foldPersistedSession(persistence, stamp);
		}
	};
}
function workspacesFrom(registry) {
	return { list: () => registry.list().map((workspace) => ({
		id: String(workspace.id),
		title: workspace.title,
		path: workspace.path,
		sessionIds: workspace.sessionIds.map((id) => String(id))
	})) };
}
/** Register the loopback `/usage-monitor` channel without reading history. */
function apply(ctx, config = DEFAULT_CONFIG) {
	const sessionQuery = ctx.get("sessionQuery");
	const workspaceRegistry = ctx.get("workspaceRegistry");
	const corpus = corpusFrom(sessionQuery, ctx.get("sessionPersistence"), () => ctx.get("sessions"));
	const workspaces = workspacesFrom(workspaceRegistry);
	const projection = new UsageProjection(defaultUsageProjectionPath());
	ctx.effect(() => async () => projection.close(), "dsh-usage-monitor: close usage projection");
	const inflight = /* @__PURE__ */ new Map();
	const collect = (query) => {
		const key = `${query.start}:${query.end}`;
		const pending = inflight.get(key);
		if (pending !== void 0) return pending;
		const next = projection.query({
			corpus,
			workspaces,
			query,
			readConcurrency: config.projectionReadConcurrency,
			transactionBatchSize: config.projectionTransactionBatchSize
		}).finally(() => {
			inflight.delete(key);
		});
		inflight.set(key, next);
		return next;
	};
	ctx.inject(["connection"], (connectionCtx) => {
		connectionCtx.connection.rpc.handle(USAGE_RPC_CHANNEL, createUsageRpcHandler({ collect }), { authority: "loopback" });
	});
}
//#endregion
export { BUILTIN_PRICING, Config, FoldCache, READ_BUDGET_MS, USAGE_QUERY_ENDPOINT, USAGE_RPC_CHANNEL, UsageProjection, apply, breakdownOf, breakdownRows, buildStackedSeries, collectUsage, corpusFrom, createUsageRpcHandler, decodeUsageQueryRequest, decodeUsageSnapshot, defaultUsageProjectionPath, estimateCost, foldRawSessionUsage, foldSessionUsage, inject, lookupPricing, name, niceMax, parseRawEvents, queryUsage, resolveWorkspace, workspacesFrom };
