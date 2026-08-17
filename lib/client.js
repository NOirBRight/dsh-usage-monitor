window.__ModuleLoader__.load({
	id: "dsh-usage-monitor",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client-contract.ts
		/** Browser-safe constants and JSON decoders shared by Host and Web faces. */
		/** Private Connection RPC channel used by this package's Host and Web faces. */
		const USAGE_RPC_CHANNEL = "/usage-monitor";
		/** Windowed usage snapshot. */
		const USAGE_QUERY_ENDPOINT = "usage/query";
		const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
		const asFinite = (value) => typeof value === "number" && Number.isFinite(value) ? value : void 0;
		const asNonNegInt = (value) => {
			const n = asFinite(value);
			return n !== void 0 && Number.isInteger(n) && n >= 0 ? n : void 0;
		};
		const asString = (value) => typeof value === "string" && value.length > 0 ? value : void 0;
		const decodeEvent = (value) => {
			if (!isRecord(value)) return void 0;
			const time = asFinite(value.time);
			const day = asString(value.day);
			const provider = asString(value.provider);
			const model = asString(value.model);
			const workspaceId = asString(value.workspaceId);
			const workspaceTitle = asString(value.workspaceTitle);
			const requests = asNonNegInt(value.requests);
			const uncachedInputTokens = asNonNegInt(value.uncachedInputTokens);
			const outputTokens = asNonNegInt(value.outputTokens);
			const cacheReadTokens = asNonNegInt(value.cacheReadTokens);
			const cacheWriteTokens = asNonNegInt(value.cacheWriteTokens);
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
			if (!isRecord(value)) return void 0;
			const tokens = asNonNegInt(value.tokens);
			const requests = asNonNegInt(value.requests);
			const outputTokens = asNonNegInt(value.outputTokens);
			const pricedRequests = asNonNegInt(value.pricedRequests);
			const unpricedRequests = asNonNegInt(value.unpricedRequests);
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
		/** Decode a Host usage snapshot. */
		function decodeUsageSnapshot(value) {
			if (!isRecord(value)) return void 0;
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
		//#region src/chart.ts
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
		const startOfDay$1 = (date) => {
			const next = new Date(date);
			next.setHours(0, 0, 0, 0);
			return next;
		};
		const addDays$1 = (date, days) => {
			const next = new Date(date);
			next.setDate(next.getDate() + days);
			return next;
		};
		const startOfWeekMonday = (date) => {
			const start = startOfDay$1(date);
			const weekday = start.getDay();
			const offset = weekday === 0 ? -6 : 1 - weekday;
			return addDays$1(start, offset);
		};
		const differenceInDays = (start, end) => Math.round((startOfDay$1(end).getTime() - startOfDay$1(start).getTime()) / 864e5);
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
			const start = startOfDay$1(span.start);
			const end = startOfDay$1(span.end);
			const formatter = new Intl.DateTimeFormat(locale, {
				month: "numeric",
				day: "numeric"
			});
			if (group === "day") {
				const count = Math.max(1, differenceInDays(start, end) + 1);
				return Array.from({ length: count }, (_, offset) => {
					const bucketStart = addDays$1(start, offset);
					return {
						start: bucketStart,
						endExclusive: addDays$1(bucketStart, 1),
						label: formatter.format(bucketStart)
					};
				});
			}
			const first = startOfWeekMonday(start);
			const last = startOfWeekMonday(end);
			const buckets = [];
			for (let cursor = first; cursor.getTime() <= last.getTime(); cursor = addDays$1(cursor, 7)) {
				const endExclusive = addDays$1(cursor, 7);
				buckets.push({
					start: cursor,
					endExclusive,
					label: `${formatter.format(cursor)}–${formatter.format(addDays$1(endExclusive, -1))}`
				});
			}
			return buckets;
		}
		function formatBucketTooltipDate(bucket, locale) {
			const endInclusive = addDays$1(bucket.endExclusive, -1);
			const formatLong = (date) => new Intl.DateTimeFormat(locale, {
				day: "numeric",
				month: "short",
				year: "numeric"
			}).format(date);
			if (startOfDay$1(bucket.start).getTime() === startOfDay$1(endInclusive).getTime()) return formatLong(bucket.start);
			return `${formatLong(bucket.start)} – ${formatLong(endInclusive)}`;
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
		function visibleSummary(events, summary, breakdown, hidden, topKeys, hideOther) {
			if (hidden.size === 0) return summary;
			let tokens = 0;
			let requests = 0;
			let outputTokens = 0;
			let cacheKnownInput = 0;
			let cacheKnownRead = 0;
			let sawCache = false;
			for (const event of events) {
				const segment = breakdownOf(event, breakdown);
				if (segmentHidden(segment.key, hidden, topKeys, hideOther)) continue;
				tokens += tokensOf(event);
				outputTokens += event.outputTokens;
				requests += event.requests;
				if (event.cacheReadTokens > 0 || event.uncachedInputTokens > 0) {
					sawCache = sawCache || event.cacheReadTokens > 0;
					cacheKnownInput += event.uncachedInputTokens + event.cacheReadTokens;
					cacheKnownRead += event.cacheReadTokens;
				}
			}
			const costScale = summary.tokens === 0 ? 0 : tokens / summary.tokens;
			return {
				tokens,
				requests,
				outputTokens,
				estimatedCostUsd: summary.estimatedCostUsd === null ? null : summary.estimatedCostUsd * costScale,
				cachedInputRate: !sawCache || cacheKnownInput === 0 ? null : cacheKnownRead / cacheKnownInput,
				pricedRequests: summary.pricedRequests,
				unpricedRequests: summary.unpricedRequests
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
		/** Evenly spaced x-axis ticks, always including first and last. */
		function axisTickIndices(count, maxTicks) {
			if (count <= 0) return [];
			const ticks = Math.min(count, Math.max(2, Math.floor(maxTicks)));
			if (count <= ticks) return Array.from({ length: count }, (_, index) => index);
			const indices = [];
			for (let step = 0; step < ticks; step += 1) {
				const index = Math.round(step * (count - 1) / (ticks - 1));
				if (indices.at(-1) !== index) indices.push(index);
			}
			return indices;
		}
		function placeChartTooltip(input) {
			const { cursorX, cursorY, height, hostHeight, hostWidth, width } = input;
			const unclampedLeft = cursorX + width + 16 + 8 > hostWidth ? cursorX - width - 16 : cursorX + 16;
			const left = Math.min(Math.max(12, unclampedLeft), Math.max(12, hostWidth - width - 12));
			const above = cursorY - height - 16;
			if (above >= 12) return {
				left,
				top: above
			};
			const below = Math.min(cursorY + 16, Math.max(12, hostHeight - height - 12));
			return {
				left,
				top: below >= cursorY + 16 - .5 ? below : above
			};
		}
		//#endregion
		//#region src/client/UsageChart.tsx
		/** CodexHub-style stacked area chart: Y-axis, hover tooltips, legend toggle. */
		const STACK_AREA_OPACITY = .24;
		const STACK_SEPARATOR = "rgba(255, 255, 255, 0.78)";
		const TOOLTIP_WIDTH = 250;
		const DAY_TICK_MIN_PX = 44;
		const WEEK_TICK_MIN_PX = 76;
		const shellStyle$1 = {
			display: "grid",
			gridTemplateRows: "minmax(0, 1fr) auto",
			minHeight: 0,
			height: "100%",
			minWidth: 0,
			overflow: "visible",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 14,
			background: "var(--dsw-alias-bg-module-platform)"
		};
		const stackAreaColor = (color) => {
			const hex = /^#([0-9a-f]{6})$/iu.exec(color)?.[1];
			if (hex === void 0) return color;
			return `rgba(${Number.parseInt(hex.slice(0, 2), 16)}, ${Number.parseInt(hex.slice(2, 4), 16)}, ${Number.parseInt(hex.slice(4, 6), 16)}, ${STACK_AREA_OPACITY})`;
		};
		const formatNumber$2 = (value, locale) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
		const formatAxisNumber = (value, locale) => {
			const abs = Math.abs(value);
			if (abs >= 1e6) return `${compact(value / 1e6)}M`;
			if (abs >= 1e3) return `${compact(value / 1e3)}K`;
			return formatNumber$2(value, locale);
		};
		const compact = (value) => {
			if (Math.abs(value) >= 10 || Number.isInteger(value)) return value.toFixed(0);
			return value.toFixed(1).replace(/\.0$/u, "");
		};
		const bucketX = (index, count) => count <= 1 ? 50 : index / (count - 1) * 100;
		const valueToY = (value, maxTotal) => 100 - value / Math.max(1, maxTotal) * 100;
		const nearestBucketIndex = (percent, count) => {
			if (count <= 1) return 0;
			return Math.min(count - 1, Math.max(0, Math.round(percent * (count - 1))));
		};
		const formatPoint = (point) => `${point.x.toFixed(3)} ${point.y.toFixed(3)}`;
		const clampPoint = (point, minX, maxX, minY, maxY) => ({
			x: Math.min(maxX, Math.max(minX, point.x)),
			y: Math.min(maxY, Math.max(minY, point.y))
		});
		const smoothPath = (points, moveToFirst) => {
			if (points.length === 0) return "";
			if (points.length === 1) return `${moveToFirst ? "M" : "L"} ${formatPoint(points[0])}`;
			const commands = [`${moveToFirst ? "M" : "L"} ${formatPoint(points[0])}`];
			for (let index = 0; index < points.length - 1; index += 1) {
				const previous = points[index - 1] ?? points[index];
				const current = points[index];
				const next = points[index + 1];
				const afterNext = points[index + 2] ?? next;
				const minX = Math.min(current.x, next.x);
				const maxX = Math.max(current.x, next.x);
				const minY = Math.min(current.y, next.y);
				const maxY = Math.max(current.y, next.y);
				const c1 = {
					x: current.x + (next.x - previous.x) / 6,
					y: current.y + (next.y - previous.y) / 6
				};
				const c2 = {
					x: next.x - (afterNext.x - current.x) / 6,
					y: next.y - (afterNext.y - current.y) / 6
				};
				commands.push(`C ${formatPoint(clampPoint(c1, minX, maxX, minY, maxY))} ${formatPoint(clampPoint(c2, minX, maxX, minY, maxY))} ${formatPoint(next)}`);
			}
			return commands.join(" ");
		};
		const areaPath = (topPoints, basePoints) => {
			if (topPoints.length === 0 || basePoints.length === 0) return "";
			return `${smoothPath(topPoints, true)} ${smoothPath([...basePoints].reverse(), false)} Z`;
		};
		function UsageChart({ buckets, series, hidden, locale, empty, loading, refreshing = false, group = "day", onToggleSeries }) {
			const [hover, setHover] = (0, react.useState)(null);
			const hostRef = (0, react.useRef)(null);
			const tooltipRef = (0, react.useRef)(null);
			const axisRef = (0, react.useRef)(null);
			const [tooltipHeight, setTooltipHeight] = (0, react.useState)(0);
			const [axisWidth, setAxisWidth] = (0, react.useState)(0);
			const visibleSeries = series.filter((item) => !hidden.has(item.key));
			const visibleBuckets = buckets.map((bucket) => {
				const segments = bucket.segments.filter((segment) => !hidden.has(segment.key));
				return {
					...bucket,
					segments,
					total: segments.reduce((sum, segment) => sum + segment.value, 0)
				};
			});
			const maxTotal = niceMax(Math.max(1, ...visibleBuckets.map((bucket) => bucket.total)));
			const hasData = visibleBuckets.some((bucket) => bucket.total > 0);
			const layers = visibleSeries.map((item, seriesIndex) => {
				const basePoints = [];
				const topPoints = [];
				visibleBuckets.forEach((bucket, bucketIndex) => {
					const valueOf = (key) => bucket.segments.find((segment) => segment.key === key)?.value ?? 0;
					const base = visibleSeries.slice(0, seriesIndex).reduce((sum, prior) => sum + valueOf(prior.key), 0);
					const top = base + valueOf(item.key);
					const x = bucketX(bucketIndex, visibleBuckets.length);
					basePoints.push({
						value: base,
						x,
						y: valueToY(base, maxTotal)
					});
					topPoints.push({
						value: top,
						x,
						y: valueToY(top, maxTotal)
					});
				});
				return {
					...item,
					basePoints,
					topPoints,
					fill: stackAreaColor(item.color)
				};
			});
			const activeIndex = hover?.index ?? Math.max(0, visibleBuckets.findIndex((bucket) => bucket.total > 0));
			const activeBucket = visibleBuckets[activeIndex];
			const activeSegments = (activeBucket?.segments ?? []).filter((segment) => segment.value > 0).map((segment) => ({
				...segment,
				fillColor: visibleSeries.find((item) => item.key === segment.key)?.color ?? segment.key
			})).sort((left, right) => right.value - left.value);
			const tooltipWidth = TOOLTIP_WIDTH;
			const activeSegmentSignature = activeSegments.map((segment) => `${segment.key}:${segment.value}`).join("|");
			const tooltipPlace = hover === null ? {
				left: 0,
				top: 0
			} : placeChartTooltip({
				cursorX: hover.cursorX,
				cursorY: hover.cursorY,
				height: tooltipHeight || 86,
				hostHeight: hover.hostHeight,
				hostWidth: hover.hostWidth,
				width: tooltipWidth
			});
			(0, react.useEffect)(() => {
				setHover(null);
				setTooltipHeight(0);
			}, [
				buckets.length,
				buckets[0]?.start.getTime(),
				series.map((item) => item.key).join("|")
			]);
			(0, react.useLayoutEffect)(() => {
				if (hover === null || tooltipRef.current === null) return;
				const nextHeight = tooltipRef.current.getBoundingClientRect().height;
				setTooltipHeight((current) => Math.abs(current - nextHeight) > .5 ? nextHeight : current);
			}, [
				hover,
				activeBucket?.label,
				activeSegmentSignature
			]);
			(0, react.useLayoutEffect)(() => {
				const node = axisRef.current;
				if (node === null) return;
				const sync = () => {
					const width = node.getBoundingClientRect().width;
					setAxisWidth((current) => Math.abs(current - width) > .5 ? width : current);
				};
				sync();
				const observer = new ResizeObserver(sync);
				observer.observe(node);
				return () => observer.disconnect();
			}, []);
			const handleHover = (event) => {
				if (visibleBuckets.length === 0) return;
				const hostRect = hostRef.current?.getBoundingClientRect();
				if (hostRect === void 0) return;
				const plotRect = event.currentTarget.getBoundingClientRect();
				const percent = Math.min(1, Math.max(0, (event.clientX - plotRect.left) / plotRect.width));
				const index = nearestBucketIndex(percent, visibleBuckets.length);
				setHover({
					cursorX: event.clientX - hostRect.left,
					cursorY: event.clientY - hostRect.top,
					hostHeight: hostRect.height,
					hostWidth: hostRect.width,
					index
				});
			};
			const overlay = !hasData ? refreshing ? loading : empty : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: shellStyle$1,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					ref: hostRef,
					style: {
						position: "relative",
						display: "grid",
						gridTemplateRows: "minmax(0, 1fr)",
						minHeight: 0,
						minWidth: 0,
						overflow: "visible"
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "grid",
							gridTemplateColumns: "40px minmax(0, 1fr)",
							gridTemplateRows: "minmax(0, 1fr) 24px",
							minHeight: 0,
							minWidth: 0,
							overflow: "hidden",
							padding: "10px 10px 6px 6px"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "grid",
									gridTemplateRows: "auto 1fr auto",
									minHeight: 0,
									padding: "0 4px 0 0",
									fontSize: 10,
									fontWeight: 650,
									color: "var(--dsw-alias-label-tertiary)",
									fontVariantNumeric: "tabular-nums",
									textAlign: "right",
									overflow: "hidden"
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										title: formatNumber$2(maxTotal, locale),
										children: formatAxisNumber(maxTotal, locale)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: { alignSelf: "center" },
										title: formatNumber$2(Math.round(maxTotal / 2), locale),
										children: formatAxisNumber(Math.round(maxTotal / 2), locale)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "0" })
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									position: "relative",
									minWidth: 0,
									minHeight: 0,
									overflow: "hidden"
								},
								onMouseMove: handleHover,
								onMouseLeave: () => setHover(null),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
									viewBox: "0 0 100 100",
									preserveAspectRatio: "none",
									role: "img",
									style: {
										position: "absolute",
										inset: 0,
										width: "100%",
										height: "100%",
										display: "block",
										overflow: "hidden"
									},
									children: [
										[
											0,
											25,
											50,
											75,
											100
										].map((y) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
											x1: "0",
											x2: "100",
											y1: y,
											y2: y,
											stroke: "var(--dsw-alias-border-l2)",
											strokeWidth: "0.45",
											vectorEffect: "non-scaling-stroke",
											strokeDasharray: y === 25 || y === 75 ? "3 3" : "0"
										}, y)),
										hasData && layers.map((layer) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
											d: areaPath(layer.topPoints, layer.basePoints),
											fill: layer.fill
										}, `${layer.key}:area`)),
										hasData && layers.map((layer) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
											d: smoothPath(layer.topPoints, true),
											fill: "none",
											stroke: STACK_SEPARATOR,
											strokeWidth: "1.15",
											strokeLinecap: "round",
											strokeLinejoin: "round",
											vectorEffect: "non-scaling-stroke"
										}, `${layer.key}:line`)),
										hasData && hover !== null && activeBucket !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
											x1: bucketX(activeIndex, visibleBuckets.length),
											x2: bucketX(activeIndex, visibleBuckets.length),
											y1: "0",
											y2: "100",
											stroke: "var(--dsw-alias-label-tertiary)",
											strokeWidth: "1",
											strokeDasharray: "4 4",
											vectorEffect: "non-scaling-stroke"
										})
									]
								}), overlay !== void 0 && overlay.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										position: "absolute",
										inset: 0,
										display: "grid",
										placeItems: "center",
										pointerEvents: "none",
										color: "var(--dsw-alias-label-tertiary)",
										fontSize: 13,
										fontWeight: 600
									},
									children: overlay
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								ref: axisRef,
								style: {
									position: "relative",
									minWidth: 0,
									height: 24,
									lineHeight: "16px",
									color: "var(--dsw-alias-label-tertiary)",
									fontSize: 10,
									fontWeight: 650,
									overflow: "hidden"
								},
								children: axisTickIndices(visibleBuckets.length, axisWidth / (group === "week" ? WEEK_TICK_MIN_PX : DAY_TICK_MIN_PX)).map((index) => {
									const bucket = visibleBuckets[index];
									if (bucket === void 0) return null;
									const last = index === visibleBuckets.length - 1;
									const first = index === 0;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											position: "absolute",
											top: 4,
											left: `${bucketX(index, visibleBuckets.length)}%`,
											transform: first ? "none" : last ? "translateX(-100%)" : "translateX(-50%)",
											maxWidth: 48,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap"
										},
										children: bucket.label
									}, `${bucket.start.getTime()}-${bucket.label}`);
								})
							})
						]
					}), hasData && hover !== null && activeBucket !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						ref: tooltipRef,
						style: {
							position: "absolute",
							gridColumn: "1",
							gridRow: "1",
							left: tooltipPlace.left,
							top: tooltipPlace.top,
							width: tooltipWidth,
							zIndex: 20,
							pointerEvents: "none",
							padding: 10,
							borderRadius: 12,
							border: "1px solid var(--dsw-alias-border-l2)",
							background: "var(--dsw-alias-bg-layer-1)",
							boxShadow: "0 12px 32px rgba(15, 23, 42, 0.16)",
							fontSize: 12
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								marginBottom: 8,
								fontWeight: 700
							},
							children: formatBucketTooltipDate(activeBucket, locale)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								display: "grid",
								gap: 6
							},
							children: activeSegments.map((segment) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "grid",
									gridTemplateColumns: "auto minmax(0, 1fr) auto",
									alignItems: "start",
									gap: 8
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: {
										width: 8,
										height: 8,
										marginTop: 4,
										borderRadius: 99,
										background: segment.fillColor
									} }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											minWidth: 0,
											color: "var(--dsw-alias-label-secondary)",
											lineHeight: 1.35
										},
										children: segment.label
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontVariantNumeric: "tabular-nums",
											fontWeight: 700
										},
										children: formatNumber$2(segment.value, locale)
									})
								]
							}, segment.key))
						})]
					})]
				}), series.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						display: "flex",
						flexWrap: "wrap",
						justifyContent: "center",
						alignItems: "center",
						alignContent: "center",
						gap: "0 8px",
						position: "relative",
						zIndex: 1,
						overflow: "hidden",
						padding: "8px 8px 8px",
						background: "var(--dsw-alias-bg-module-platform)",
						borderTop: "1px solid var(--dsw-alias-border-l2)"
					},
					children: series.map((item) => {
						const dimmed = hidden.has(item.key);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							"aria-pressed": !dimmed,
							onClick: () => onToggleSeries(item.key),
							style: {
								display: "inline-flex",
								alignItems: "center",
								gap: 6,
								minHeight: 20,
								padding: "0 4px",
								border: "none",
								borderRadius: 999,
								background: "transparent",
								color: "var(--dsw-alias-label-secondary)",
								opacity: dimmed ? .42 : 1,
								cursor: "pointer",
								fontSize: 11,
								fontWeight: 650,
								textDecoration: dimmed ? "line-through" : "none"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
								width: 8,
								height: 8,
								borderRadius: 99,
								background: item.color,
								flexShrink: 0
							} }), item.label]
						}, item.key);
					})
				})]
			});
		}
		//#endregion
		//#region src/client/UsageTable.tsx
		const shellStyle = {
			display: "grid",
			gridTemplateRows: "auto minmax(0, 1fr)",
			minHeight: 0,
			height: "100%",
			overflow: "hidden",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 14,
			background: "var(--dsw-alias-bg-module-platform)"
		};
		const gridStyle = {
			display: "grid",
			gridTemplateColumns: "minmax(0, 1.5fr) repeat(4, minmax(64px, 0.7fr))",
			gap: 8,
			alignItems: "center",
			padding: "0 12px"
		};
		const headStyle = {
			...gridStyle,
			height: 32,
			borderBottom: "1px solid var(--dsw-alias-border-l2)",
			fontSize: 10,
			fontWeight: 650,
			letterSpacing: "0.06em",
			textTransform: "uppercase",
			color: "var(--dsw-alias-label-tertiary)"
		};
		const bodyStyle = {
			minHeight: 0,
			overflow: "auto"
		};
		const rowStyle = {
			...gridStyle,
			height: 34,
			fontSize: 12,
			borderBottom: "1px solid var(--dsw-alias-border-l2)"
		};
		const numStyle = {
			fontVariantNumeric: "tabular-nums",
			fontWeight: 650,
			textAlign: "right",
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap"
		};
		const formatNumber$1 = (value, locale) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
		const formatRate$1 = (value, unknown) => {
			if (value === null) return unknown;
			return `${(value * 100).toFixed(1)}%`;
		};
		function UsageTable({ rows, nameLabel, tokensLabel, requestsLabel, outputLabel, cachedLabel, pending, unknown, locale, colors }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: shellStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: headStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: nameLabel }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: { textAlign: "right" },
							children: tokensLabel
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: { textAlign: "right" },
							children: requestsLabel
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: { textAlign: "right" },
							children: outputLabel
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: { textAlign: "right" },
							children: cachedLabel
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: bodyStyle,
					children: rows.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							height: 34,
							display: "grid",
							placeItems: "center",
							color: "var(--dsw-alias-label-tertiary)",
							fontSize: 12
						},
						children: pending
					}) : rows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: rowStyle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: 8,
									minWidth: 0
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: {
									width: 8,
									height: 8,
									borderRadius: 99,
									flexShrink: 0,
									background: colors.get(row.key) ?? "var(--dsw-alias-label-tertiary)"
								} }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap"
									},
									children: row.label
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: numStyle,
								children: formatNumber$1(row.tokens, locale)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: numStyle,
								children: formatNumber$1(row.requests, locale)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: numStyle,
								children: formatNumber$1(row.outputTokens, locale)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: numStyle,
								children: formatRate$1(row.cachedInputRate, unknown)
							})
						]
					}, row.key))
				})]
			});
		}
		//#endregion
		//#region src/client/window.ts
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
		function rangeToSpan(range, custom, now = /* @__PURE__ */ new Date()) {
			const today = startOfDay(now);
			if (range === "7d") return {
				start: addDays(today, -6),
				end: today
			};
			if (range === "1m") return {
				start: addDays(today, -29),
				end: today
			};
			return {
				start: startOfDay(custom.start),
				end: startOfDay(custom.end)
			};
		}
		/** Inclusive local-day span → half-open query window. */
		function spanToQuery(span) {
			const start = startOfDay(span.start);
			const end = addDays(startOfDay(span.end), 1);
			return {
				start: start.getTime(),
				end: end.getTime()
			};
		}
		function toDateInput(date) {
			return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
		}
		function fromDateInput(value, fallback) {
			const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
			if (match === null) return fallback;
			const year = Number(match[1]);
			const month = Number(match[2]);
			const day = Number(match[3]);
			const date = new Date(year, month - 1, day);
			return Number.isNaN(date.getTime()) ? fallback : date;
		}
		//#endregion
		//#region src/client/UsageDashboard.tsx
		/** Settings-page usage dashboard: tiles, filters, and a stacked area chart. */
		const snapshotMemo = /* @__PURE__ */ new Map();
		const pageStyle = {
			minWidth: 0,
			minHeight: 0,
			height: "100%",
			color: "var(--dsw-alias-label-primary)"
		};
		const toolbarStyle = {
			minWidth: 0,
			width: "100%"
		};
		const segmentStyle = {
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			height: 32,
			width: "max-content",
			boxSizing: "border-box",
			padding: 3,
			borderRadius: 999,
			background: "var(--dsw-alias-bg-layer-1)",
			boxShadow: "inset 0 0 0 1px var(--dsw-alias-border-l2)"
		};
		const pillStyle = (active) => ({
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			height: "100%",
			margin: 0,
			border: "none",
			borderRadius: 999,
			padding: "0 8px",
			background: active ? "var(--dsw-alias-bg-module-platform)" : "transparent",
			color: active ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-secondary)",
			boxShadow: active ? "0 1px 2px rgba(15, 23, 42, 0.08)" : "none",
			fontSize: 11,
			fontWeight: 650,
			lineHeight: 1,
			cursor: "pointer",
			whiteSpace: "nowrap"
		});
		const dateStyle = {
			height: 32,
			padding: "0 10px",
			border: "none",
			borderRadius: 999,
			background: "var(--dsw-alias-bg-layer-1)",
			color: "var(--dsw-alias-label-primary)",
			boxShadow: "inset 0 0 0 1px var(--dsw-alias-border-l2)",
			fontSize: 11,
			fontWeight: 650
		};
		const tileStyle = {
			minWidth: 0,
			padding: "10px 12px",
			borderRadius: 12,
			background: "var(--dsw-alias-bg-layer-1)",
			boxShadow: "inset 0 0 0 1px var(--dsw-alias-border-l2)"
		};
		const tileLabelStyle = {
			fontSize: 10,
			fontWeight: 650,
			letterSpacing: "0.06em",
			textTransform: "uppercase",
			color: "var(--dsw-alias-label-tertiary)"
		};
		const tileValueStyle = {
			marginTop: 4,
			overflow: "hidden",
			textOverflow: "ellipsis",
			fontSize: 18,
			fontWeight: 700,
			fontVariantNumeric: "tabular-nums",
			letterSpacing: "-0.03em",
			whiteSpace: "nowrap"
		};
		const USAGE_CSS = `
.dsh-um,
.dsh-um * {
  box-sizing: border-box;
}
.dsh-um {
  container-type: inline-size;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}
.dsh-um-tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.dsh-um-toolbar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  min-width: 0;
}
.dsh-um-toolbar-row {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
}
.dsh-um-menu {
  position: relative;
  flex: 0 0 auto;
}
.dsh-um-range {
  flex: 0 0 auto;
  width: max-content;
  height: 32px;
  margin-left: auto;
}
@container (min-width: 560px) {
  .dsh-um-tiles {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
.dsh-um-chart,
.dsh-um-table {
  min-height: 0;
  min-width: 0;
  height: 100%;
}
.dsh-um-chart {
  position: relative;
  z-index: 2;
  overflow: visible;
}
`;
		const formatNumber = (value, locale) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
		const formatRate = (value, unknown) => {
			if (value === null) return unknown;
			return `${(value * 100).toFixed(1)}%`;
		};
		const windowKey = (start, end) => `${start}:${end}`;
		function Chevron() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "12",
				height: "12",
				viewBox: "0 0 12 12",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M3 4.5 6 7.5 9 4.5",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: "1.5",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}
		function Check() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "12",
				height: "12",
				viewBox: "0 0 12 12",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M2.5 6.2 5 8.7 9.5 3.5",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: "1.6",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}
		function UsageDropdown({ label, value, valueLabel, options, open, onToggle, onSelect }) {
			const menuId = `dsh-um-${label.replace(/\s+/gu, "-").toLowerCase()}`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-um-menu",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					"aria-expanded": open,
					"aria-haspopup": "listbox",
					"aria-controls": open ? menuId : void 0,
					"aria-label": `${label} ${valueLabel}`,
					onClick: onToggle,
					style: {
						display: "flex",
						alignItems: "center",
						gap: 4,
						width: "max-content",
						height: 32,
						padding: "0 8px 0 10px",
						border: "none",
						borderRadius: 999,
						background: "var(--dsw-alias-bg-layer-1)",
						color: "var(--dsw-alias-label-secondary)",
						boxShadow: "inset 0 0 0 1px var(--dsw-alias-border-l2)",
						fontSize: 11,
						fontWeight: 650,
						cursor: "pointer",
						whiteSpace: "nowrap"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: { color: "var(--dsw-alias-label-primary)" },
							children: valueLabel
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chevron, {})
					]
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					id: menuId,
					role: "listbox",
					style: {
						position: "absolute",
						left: 0,
						top: "calc(100% + 6px)",
						zIndex: 8,
						minWidth: "100%",
						width: "max-content",
						padding: 4,
						borderRadius: 12,
						background: "var(--dsw-alias-bg-layer-1)",
						boxShadow: "0 10px 28px rgba(15, 23, 42, 0.16), inset 0 0 0 1px var(--dsw-alias-border-l2)"
					},
					children: options.map((option) => {
						const selected = value === option.value;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							role: "option",
							"aria-selected": selected,
							onClick: () => onSelect(option.value),
							style: {
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								width: "100%",
								height: 28,
								padding: "0 10px",
								border: "none",
								borderRadius: 8,
								background: selected ? "var(--dsw-alias-bg-module-platform)" : "transparent",
								color: "var(--dsw-alias-label-primary)",
								fontSize: 11,
								fontWeight: 650,
								cursor: "pointer",
								textAlign: "left"
							},
							children: [option.label, selected && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Check, {})]
						}, option.value);
					})
				})]
			});
		}
		function UsageDashboard(props) {
			const t = props.t;
			const queryUsage = props.queryUsage;
			const locale = typeof navigator === "undefined" ? "en" : navigator.language;
			const pending = t?.("pending") ?? "—";
			const unknown = t?.("unknown") ?? "Unknown";
			const [metric, setMetric] = (0, react.useState)("token");
			const [breakdown, setBreakdown] = (0, react.useState)("provider");
			const [group, setGroup] = (0, react.useState)("day");
			const [range, setRange] = (0, react.useState)("7d");
			const [openMenu, setOpenMenu] = (0, react.useState)(null);
			const [custom, setCustom] = (0, react.useState)(() => {
				const end = /* @__PURE__ */ new Date();
				const start = /* @__PURE__ */ new Date();
				start.setDate(end.getDate() - 6);
				return {
					start,
					end
				};
			});
			const [hidden, setHidden] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [load, setLoad] = (0, react.useState)({ status: "loading" });
			const queryRef = (0, react.useRef)(queryUsage);
			queryRef.current = queryUsage;
			const span = (0, react.useMemo)(() => rangeToSpan(range, custom), [range, custom]);
			const query = (0, react.useMemo)(() => spanToQuery(span), [span]);
			(0, react.useEffect)(() => {
				const close = (event) => {
					if (event.target instanceof Element && event.target.closest("[data-dsh-um-menu]")) return;
					setOpenMenu(null);
				};
				const onKey = (event) => {
					if (event.key === "Escape") setOpenMenu(null);
				};
				document.addEventListener("pointerdown", close);
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("pointerdown", close);
					document.removeEventListener("keydown", onKey);
				};
			}, []);
			(0, react.useEffect)(() => {
				const fetchUsage = queryRef.current;
				if (fetchUsage === void 0) {
					setLoad({ status: "error" });
					return;
				}
				const key = windowKey(query.start, query.end);
				const cached = snapshotMemo.get(key);
				setLoad((current) => {
					if (cached !== void 0) return {
						status: "ready",
						snapshot: cached,
						refreshing: true
					};
					if (current.status === "ready") return {
						...current,
						refreshing: true
					};
					return { status: "loading" };
				});
				let cancelled = false;
				fetchUsage(query.start, query.end).then((snapshot) => {
					snapshotMemo.set(key, snapshot);
					if (!cancelled) setLoad({
						status: "ready",
						snapshot,
						refreshing: false
					});
				}, (error) => {
					if (cancelled) return;
					setLoad((current) => {
						if (current.status === "ready") return {
							...current,
							refreshing: false
						};
						const message = error instanceof Error && error.message.length > 0 ? error.message : void 0;
						return {
							status: "error",
							...message === void 0 ? {} : { message }
						};
					});
				});
				return () => {
					cancelled = true;
				};
			}, [query.start, query.end]);
			const snapshot = load.status === "ready" ? load.snapshot : void 0;
			const stacked = (0, react.useMemo)(() => buildStackedSeries(snapshot?.events ?? [], span, group, metric, breakdown, locale, t?.("other") ?? "Other"), [
				snapshot,
				span,
				group,
				metric,
				breakdown,
				locale,
				t
			]);
			const topKeys = (0, react.useMemo)(() => new Set(stacked.series.filter((item) => item.key !== OTHER_SERIES_KEY).map((item) => item.key)), [stacked.series]);
			const summary = snapshot === void 0 ? void 0 : visibleSummary(snapshot.events, snapshot.summary, breakdown, hidden, topKeys, hidden.has(OTHER_SERIES_KEY));
			const rows = (0, react.useMemo)(() => breakdownRows(snapshot?.events ?? [], breakdown, hidden, topKeys, hidden.has(OTHER_SERIES_KEY)), [
				snapshot,
				breakdown,
				hidden,
				topKeys
			]);
			const rowColors = (0, react.useMemo)(() => {
				const fromSeries = new Map(stacked.series.map((item) => [item.key, item.color]));
				return new Map(rows.map((row, index) => [row.key, fromSeries.get(row.key) ?? SERIES_COLORS[index] ?? "#cbd5e1"]));
			}, [rows, stacked.series]);
			const toggleSeries = (key) => {
				setHidden((current) => {
					const next = new Set(current);
					if (next.has(key)) next.delete(key);
					else next.add(key);
					return next;
				});
			};
			const chartEmpty = load.status === "error" ? load.message ?? t?.("failed") ?? "" : load.status === "loading" ? t?.("loading") ?? "" : t?.("empty") ?? "";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dsh-um",
				style: pageStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: USAGE_CSS }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-um-toolbar",
						style: toolbarStyle,
						"data-dsh-um-menu": true,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-um-toolbar-row",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageDropdown, {
									label: t?.("metric") ?? "Metric",
									value: metric,
									valueLabel: metric === "token" ? t?.("token") ?? "Token" : t?.("request") ?? "Request",
									open: openMenu === "metric",
									options: [{
										value: "token",
										label: t?.("token") ?? "Token"
									}, {
										value: "request",
										label: t?.("request") ?? "Request"
									}],
									onToggle: () => setOpenMenu((current) => current === "metric" ? null : "metric"),
									onSelect: (value) => {
										setMetric(value);
										setOpenMenu(null);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageDropdown, {
									label: t?.("by") ?? "By",
									value: breakdown,
									valueLabel: t?.(breakdown) ?? breakdown,
									open: openMenu === "by",
									options: [
										{
											value: "provider",
											label: t?.("provider") ?? "Provider"
										},
										{
											value: "model",
											label: t?.("model") ?? "Model"
										},
										{
											value: "workspace",
											label: t?.("workspace") ?? "Workspace"
										}
									],
									onToggle: () => setOpenMenu((current) => current === "by" ? null : "by"),
									onSelect: (value) => {
										setBreakdown(value);
										setOpenMenu(null);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageDropdown, {
									label: t?.("group") ?? "Group",
									value: group,
									valueLabel: group === "week" ? t?.("week") ?? "Week" : t?.("day") ?? "Day",
									open: openMenu === "group",
									options: [{
										value: "day",
										label: t?.("day") ?? "Day"
									}, {
										value: "week",
										label: t?.("week") ?? "Week"
									}],
									onToggle: () => setOpenMenu((current) => current === "group" ? null : "group"),
									onSelect: (value) => {
										setGroup(value);
										setOpenMenu(null);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsh-um-range",
									style: segmentStyle,
									children: [
										{
											value: "7d",
											label: t?.("rangeWeek") ?? "Week"
										},
										{
											value: "1m",
											label: t?.("rangeMonth") ?? "Month"
										},
										{
											value: "custom",
											label: t?.("custom") ?? "Custom"
										}
									].map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										"aria-pressed": range === option.value,
										style: pillStyle(range === option.value),
										onClick: () => setRange(option.value),
										children: option.label
									}, option.value))
								})
							]
						}), range === "custom" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "grid",
								gridTemplateColumns: "1fr 1fr",
								gap: 8,
								minWidth: 0
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "date",
								"aria-label": t?.("customStart") ?? "Start date",
								value: toDateInput(custom.start),
								onChange: (event) => setCustom((current) => ({
									...current,
									start: fromDateInput(event.target.value, current.start)
								})),
								style: {
									...dateStyle,
									width: "100%",
									minWidth: 0
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "date",
								"aria-label": t?.("customEnd") ?? "End date",
								value: toDateInput(custom.end),
								onChange: (event) => setCustom((current) => ({
									...current,
									end: fromDateInput(event.target.value, current.end)
								})),
								style: {
									...dateStyle,
									width: "100%",
									minWidth: 0
								}
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-um-tiles",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: tileStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: tileLabelStyle,
									children: t?.("tokens")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: tileValueStyle,
									children: summary ? formatNumber(summary.tokens, locale) : pending
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: tileStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: tileLabelStyle,
									children: t?.("requests")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: tileValueStyle,
									children: summary ? formatNumber(summary.requests, locale) : pending
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: tileStyle,
								title: t?.("outputHint"),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: tileLabelStyle,
									children: t?.("output")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: tileValueStyle,
									children: summary ? formatNumber(summary.outputTokens, locale) : pending
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: tileStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: tileLabelStyle,
									children: t?.("cachedInput")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: tileValueStyle,
									children: summary ? formatRate(summary.cachedInputRate, unknown) : pending
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-um-chart",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageChart, {
							buckets: stacked.buckets,
							series: stacked.series,
							hidden,
							locale,
							empty: chartEmpty,
							loading: t?.("loading"),
							refreshing: load.status === "loading" || load.status === "ready" && load.refreshing,
							group,
							onToggleSeries: toggleSeries
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-um-table",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageTable, {
							rows,
							nameLabel: t?.(breakdown) ?? breakdown,
							tokensLabel: t?.("tokens") ?? "Tokens",
							requestsLabel: t?.("requests") ?? "Requests",
							outputLabel: t?.("output") ?? "Output",
							cachedLabel: t?.("cachedInput") ?? "Cached input",
							pending: load.status === "ready" ? t?.("empty") ?? "" : pending,
							unknown,
							locale,
							colors: rowColors
						})
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** Localized copy for the Usage settings page. */
		const en = {
			nav: "Usage",
			title: "Usage",
			metric: "Metric",
			token: "Token",
			request: "Request",
			by: "By",
			provider: "Provider",
			model: "Model",
			workspace: "Workspace",
			group: "Group",
			day: "Day",
			week: "Week",
			rangeWeek: "Week",
			rangeMonth: "Month",
			custom: "Custom",
			tokens: "Tokens",
			requests: "Requests",
			output: "Output",
			outputHint: "Tokens generated in model replies.",
			cachedInput: "Cached input",
			unknown: "Unknown",
			other: "Other",
			empty: "No usage in this window.",
			loading: "Reading session logs…",
			failed: "Could not read usage.",
			pending: "—",
			customStart: "Start date",
			customEnd: "End date"
		};
		const zh = {
			nav: "用量",
			title: "用量",
			metric: "指标",
			token: "Token",
			request: "请求",
			by: "分组",
			provider: "供应商",
			model: "模型",
			workspace: "工作区",
			group: "粒度",
			day: "按日",
			week: "按周",
			rangeWeek: "近一周",
			rangeMonth: "近一月",
			custom: "自定义",
			tokens: "Tokens",
			requests: "请求",
			output: "输出",
			outputHint: "模型回复里生成的 token。",
			cachedInput: "缓存命中",
			unknown: "未知",
			other: "其他",
			empty: "这个时间范围内没有用量。",
			loading: "正在读取会话日志…",
			failed: "无法读取用量。",
			pending: "—",
			customStart: "开始日期",
			customEnd: "结束日期"
		};
		//#endregion
		//#region src/client/nav-icon.ts
		/** Swap the settings-nav gear for a usage bar-chart glyph. */
		const LABELS = /* @__PURE__ */ new Set(["Usage", "用量"]);
		const MARK = "data-dsh-um-icon";
		const BARS = `
  <rect x="2.2" y="8.2" width="2.8" height="5.6" rx="0.6" fill="currentColor"/>
  <rect x="6.6" y="3.4" width="2.8" height="10.4" rx="0.6" fill="currentColor"/>
  <rect x="11" y="5.8" width="2.8" height="8" rx="0.6" fill="currentColor"/>
`;
		function patch() {
			for (const button of document.querySelectorAll("nav button")) {
				if ([...button.querySelectorAll("span")].find((span) => LABELS.has(span.textContent?.trim() ?? "")) === void 0) continue;
				const svg = button.querySelector("svg");
				if (svg === null || svg.getAttribute(MARK) === "usage") continue;
				svg.setAttribute(MARK, "usage");
				svg.setAttribute("viewBox", "0 0 16 16");
				svg.setAttribute("fill", "none");
				svg.innerHTML = BARS;
			}
		}
		/** Watch the settings nav and keep the Usage glyph in place across re-renders. */
		function installUsageNavIcon() {
			if (typeof document === "undefined" || document.body === null) return () => {};
			let scheduled = false;
			const flush = () => {
				scheduled = false;
				patch();
			};
			const observer = new MutationObserver(() => {
				if (scheduled) return;
				scheduled = true;
				requestAnimationFrame(flush);
			});
			observer.observe(document.body, {
				childList: true,
				subtree: true
			});
			patch();
			return () => observer.disconnect();
		}
		//#endregion
		//#region src/client/index.ts
		const name = "dsh-usage-monitor-client";
		const inject = [
			"slots",
			"locale",
			"connection"
		];
		function apply(ctx) {
			const localeNamespace = "settings.usage-monitor";
			ctx.effect(() => ctx.locale.register(localeNamespace, {
				zh,
				en
			}), "dsh-usage-monitor: Settings page copy");
			const t = ctx.locale.bind(localeNamespace);
			const { rpc } = ctx.get("connection");
			const queryUsage = async (start, end) => {
				const controller = new AbortController();
				const timer = globalThis.setTimeout(() => controller.abort(), 9e4);
				try {
					const result = await rpc.call(USAGE_RPC_CHANNEL, USAGE_QUERY_ENDPOINT, {
						start,
						end
					}, controller.signal);
					if (!result.ok) throw new Error(result.error.message);
					const decoded = decodeUsageSnapshot(result.value);
					if (decoded === void 0) throw new Error(t("failed"));
					return decoded;
				} finally {
					globalThis.clearTimeout(timer);
				}
			};
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "usage-monitor",
				order: 15,
				label: () => t("nav"),
				inject: () => ({
					t,
					queryUsage
				})
			}, UsageDashboard));
			ctx.effect(installUsageNavIcon, "dsh-usage-monitor: settings nav icon");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
