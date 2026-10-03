import "server-only";

import { isProxy } from "node:util/types";
import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import {
  squareIngestionScopeFingerprint,
  type SquareAtomicPageCommit, type SquarePageBinding, type SquarePageCompleteness,
  type SquarePageLease, type SquarePageRepository, type SquarePrivateCursor,
  type SquareProviderOrdering, type SquareStoredSource
} from "@/lib/integrations/providers/square/ingestion-contracts";
import {
  assertSquarePendingSource, compareSquareProviderRevision, materializeSquarePendingSource
} from "@/lib/integrations/providers/square/ingestion-mapping";

/**
 * Synthetic, process-local recovery model only. There is no database, network,
 * registry authorization, scheduler, credential lookup, or crash durability here.
 *
 * A durable implementation must fence the tenant/query/generation and lease/CAS,
 * allocate immutable source versions, retain replay receipts, and advance the
 * private cursor in ONE transaction. Committing either half independently is not
 * equivalent to this interface. Reconnect requires a new scan; old scan bindings
 * and receipts are immutable. Resource versions deduplicate across scans.
 */
export const SQUARE_SYNTHETIC_REPOSITORY_LIMITS = Object.freeze({
  scans: 32, pagesPerScan: 100, sourceVersions: 10_000, sourcesPerPage: 3_000,
  retainedBytes: 64 * 1_024 * 1_024, retainedContainers: 500_000,
  commandBytes: 64 * 1_024 * 1_024, commandContainers: 66_000,
  commandValues: 7_200_000, depth: 64, properties: 64, stringLength: 4_096,
  attempts: 3, leaseMs: 30_000, cursorTtlMs: 3_600_000, retryAfterMs: 60_000
});
const LIMITS = SQUARE_SYNTHETIC_REPOSITORY_LIMITS;
const HASH = /^sha256:[a-f0-9]{64}$/;
const CURSOR = /^[A-Za-z0-9._~:+-]{1,4096}={0,2}$/;
const REASONS = new Set([
  "partial_page_sequence", "history_unknown", "economic_fields_omitted",
  "references_unresolved", "returns_unknown", "eventual_consistency",
  "overlapping_representations", "inventory_optional", "unsupported_page",
  "interrupted_scan", "unordered_provider_revision"
]);
export type SquareSyntheticRepositoryFault = "before_stage" | "during_stage" | "after_commit";
export type SquareSyntheticRepositoryOptions = Readonly<{
  currentGenerations?: readonly Readonly<{ scopeFingerprint: string; generation: number }>[];
  maximumScans?: number;
  maximumPagesPerScan?: number;
  maximumSourceVersions?: number;
  maximumSourcesPerPage?: number;
  maximumRetainedBytes?: number;
  maximumRetainedContainers?: number;
  leaseMs?: number;
}>;
type Metrics = Readonly<{ bytes: number; containers: number }>;
type Receipt = Readonly<{ lease: SquarePageLease; commandFingerprint: string; pageId: string }>;
type Resource = Readonly<{ observedVersionKey: string; currentVersionKey: string; versionCount: number }>;
type Scan = Readonly<{
  binding: SquarePageBinding;
  status: "ready" | "leased" | "finished" | "blocked" | "expired";
  lease: SquarePageLease | null;
  cursor: SquarePrivateCursor | null;
  checkpointVersion: number;
  attempt: number;
  notBefore: number;
  lastNow: number;
  stream: string | null;
  completeness: SquarePageCompleteness | null;
  receipts: ReadonlyMap<string, Receipt>;
}>;
type Entry<T> = Readonly<{ value: T; metrics: Metrics }>;
type State = Readonly<{
  generations: ReadonlyMap<string, number>;
  scans: ReadonlyMap<string, Entry<Scan>>;
  sources: ReadonlyMap<string, Entry<SquareStoredSource>>;
  resources: ReadonlyMap<string, Entry<Resource>>;
  metrics: Metrics;
  leaseSerial: number;
}>;

export function createSquareSyntheticPageRepository(options: SquareSyntheticRepositoryOptions = {}) {
  const configuration = jsonCopy(options).value as SquareSyntheticRepositoryOptions;
  exactKeys(configuration, ["currentGenerations", "maximumScans", "maximumPagesPerScan", "maximumSourceVersions", "maximumSourcesPerPage", "maximumRetainedBytes", "maximumRetainedContainers", "leaseMs"], false);
  const maximumScans = option(configuration.maximumScans, LIMITS.scans);
  const maximumPages = option(configuration.maximumPagesPerScan, LIMITS.pagesPerScan);
  const maximumVersions = option(configuration.maximumSourceVersions, LIMITS.sourceVersions);
  const maximumSources = option(configuration.maximumSourcesPerPage, LIMITS.sourcesPerPage);
  const maximumBytes = option(configuration.maximumRetainedBytes, LIMITS.retainedBytes);
  const maximumContainers = option(configuration.maximumRetainedContainers, LIMITS.retainedContainers);
  const leaseMs = option(configuration.leaseMs, LIMITS.leaseMs);
  let state: State = { generations: new Map(), scans: new Map(), sources: new Map(), resources: new Map(), metrics: { bytes: 2, containers: 5 }, leaseSerial: 0 };
  let nextFault: SquareSyntheticRepositoryFault | null = null;

  function withinCapacity(candidate: State) {
    return candidate.metrics.bytes <= maximumBytes && candidate.metrics.containers <= maximumContainers &&
      candidate.sources.size <= maximumVersions && candidate.scans.size <= maximumScans;
  }
  if (!withinCapacity(state)) invalid();
  function setCurrentGeneration(scopeFingerprint: string, generation: number) {
    if (!hash(scopeFingerprint) || !integer(generation) || generation < 1 || generation < (state.generations.get(scopeFingerprint) ?? 1)) invalid();
    if (!state.generations.has(scopeFingerprint) && state.generations.size >= maximumScans) invalid();
    const generations = new Map(state.generations);
    const prior = generations.get(scopeFingerprint);
    generations.set(scopeFingerprint, generation);
    const metrics = adjustMetrics(state.metrics, prior === undefined ? null : measure({ scopeFingerprint, generation: prior }), measure({ scopeFingerprint, generation }));
    const candidate = { ...state, generations, metrics };
    if (!withinCapacity(candidate)) invalid();
    state = candidate;
  }
  if (configuration.currentGenerations !== undefined) {
    if (!Array.isArray(configuration.currentGenerations) || configuration.currentGenerations.length > maximumScans) invalid();
    for (const entry of configuration.currentGenerations) {
      exactKeys(entry, ["scopeFingerprint", "generation"]);
      if (!hash(entry.scopeFingerprint) || !integer(entry.generation)) invalid();
      if (state.generations.has(entry.scopeFingerprint)) invalid();
      setCurrentGeneration(entry.scopeFingerprint, entry.generation);
    }
  }
  function scanState(candidate: State, scan: Scan): State {
    const scans = new Map(candidate.scans);
    const previous = scans.get(scan.binding.scanKey);
    const metrics = measure({ ...scan, receipts: [...scan.receipts.values()] });
    scans.set(scan.binding.scanKey, { value: scan, metrics });
    return { ...candidate, scans, metrics: adjustMetrics(candidate.metrics, previous?.metrics ?? null, metrics) };
  }
  function publishScan(scan: Scan) {
    const candidate = scanState(state, scan);
    if (!withinCapacity(candidate)) return false;
    state = candidate;
    return true;
  }
  function current(binding: SquarePageBinding) {
    return state.generations.get(binding.scopeFingerprint) === binding.generation;
  }
  function leaseMatches(scan: Scan, lease: SquarePageLease, now: number) {
    return current(lease.binding) && sameBinding(scan.binding, lease.binding) && scan.status === "leased" &&
      scan.lease !== null && contractSha256(scan.lease) === contractSha256(lease) &&
      now >= scan.lastNow && now < lease.expiresAt && lease.checkpointVersion === scan.checkpointVersion &&
      (scan.cursor === null || now < scan.cursor.expiresAt);
  }
  function fault(point: SquareSyntheticRepositoryFault) {
    if (nextFault !== point) return;
    nextFault = null;
    throw new Error(point === "after_commit" ? "square_synthetic_commit_ack_lost" : "square_synthetic_commit_interrupted");
  }
  function terminal(outcome: "finished" | "conflict" | "expired" | "blocked" | "deferred", scan?: Scan, now = 0) {
    return frozen({ outcome, completeness: scan?.completeness ?? null,
      retryAfterMs: outcome === "deferred" && scan ? Math.max(0, Math.min(LIMITS.retryAfterMs, scan.notBefore - now)) : null });
  }
  function commitResult(outcome: "committed" | "replayed" | "conflict", scan?: Scan, now = 0) {
    return frozen({ outcome, completeness: scan?.completeness ?? null,
      continuation: outcome !== "conflict" && scan?.status === "ready" && scan.cursor !== null && now < scan.cursor.expiresAt });
  }
  const repository: SquarePageRepository = Object.freeze({
    async acquire(rawBinding: SquarePageBinding, now: number) {
      let binding: SquarePageBinding;
      try { binding = bindingValue(jsonCopy(rawBinding).value); } catch { return terminal("conflict"); }
      if (!integer(now) || !current(binding) || now > Number.MAX_SAFE_INTEGER - leaseMs) return terminal("conflict");
      let scan = state.scans.get(binding.scanKey)?.value;
      if (scan && (!sameBinding(scan.binding, binding) || now < scan.lastNow)) return terminal("conflict");
      if (!scan) {
        if (state.scans.size >= maximumScans) return terminal("blocked");
        scan = { binding, status: "ready", lease: null, cursor: null, checkpointVersion: 0, attempt: 0, notBefore: now, lastNow: now, stream: null, completeness: null, receipts: new Map() };
      }
      if (scan.status === "finished") return terminal("finished", scan);
      if (scan.status === "expired") return terminal("expired", scan);
      if (scan.status === "blocked") return terminal("blocked", scan);
      if (scan.cursor !== null && scan.cursor.expiresAt <= now) {
        scan = { ...scan, status: "expired", lease: null, lastNow: now, completeness: interrupted(scan.completeness, true) };
        publishScan(scan);
        return terminal("expired", scan);
      }
      if (scan.lease !== null && scan.lease.expiresAt > now) return terminal("conflict", scan);
      if (scan.notBefore > now) return terminal("deferred", scan, now);
      if (scan.attempt >= LIMITS.attempts || scan.checkpointVersion >= maximumPages) {
        scan = { ...scan, status: "blocked", lease: null, lastNow: now, completeness: interrupted(scan.completeness, true) };
        publishScan(scan);
        return terminal("blocked", scan);
      }
      const attempt = scan.attempt + 1;
      const serial = state.leaseSerial + 1;
      const lease = frozen({ binding, leaseId: contractSha256({ purpose: "square_synthetic_page_lease_v1", binding, checkpointVersion: scan.checkpointVersion, attempt, serial }), expiresAt: now + leaseMs, checkpointVersion: scan.checkpointVersion, cursor: scan.cursor, attempt, pageNumber: scan.checkpointVersion + 1 }) as SquarePageLease;
      const candidate = scanState({ ...state, leaseSerial: serial }, { ...scan, status: "leased", lease, attempt, lastNow: now });
      if (!withinCapacity(candidate)) return terminal("blocked", scan);
      state = candidate;
      return { outcome: "leased" as const, lease };
    },
    async commitPage(rawCommand: SquareAtomicPageCommit) {
      let command: SquareAtomicPageCommit;
      try {
        command = jsonCopy(rawCommand).value as SquareAtomicPageCommit;
        exactKeys(command, ["lease", "pageId", "sources", "completeness", "nextCursor", "now"]);
        leaseValue(command.lease);
        completenessValue(command.completeness);
        if (!hash(command.pageId) || !integer(command.now) || !Array.isArray(command.sources) || command.sources.length > maximumSources) return commitResult("conflict");
        cursorValue(command.nextCursor);
      } catch { return commitResult("conflict"); }
      const scan = state.scans.get(command.lease.binding.scanKey)?.value;
      if (!scan || !current(command.lease.binding) || !sameBinding(scan.binding, command.lease.binding)) return commitResult("conflict");
      let sources;
      try {
        sources = command.sources.map((source) => assertSquarePendingSource(source));
        if (sources.some((source) => source.scope.generation !== command.lease.binding.generation || squareIngestionScopeFingerprint(source.scope) !== command.lease.binding.scopeFingerprint)) return commitResult("conflict", scan);
        if (new Set(sources.map((source) => source.stream)).size > 1 || sources.some((source) => scan.stream !== null && scan.stream !== source.stream)) return commitResult("conflict", scan);
      } catch { return commitResult("conflict", scan); }
      const commandFingerprint = contractSha256({
        purpose: "square_synthetic_atomic_page_v1", lease: command.lease,
        pageId: command.pageId, versionKeys: [...new Set(sources.map((source) => source.versionKey))].sort(),
        completeness: command.completeness, nextCursor: command.nextCursor
      });
      const receipt = scan.receipts.get(command.pageId);
      if (receipt) return commitResult(receipt.commandFingerprint === commandFingerprint ? "replayed" : "conflict", scan, command.now);
      if (!leaseMatches(scan, command.lease, command.now) || command.completeness.pageSequence === "blocked") return commitResult("conflict", scan);
      if ((command.nextCursor === null) !== (command.completeness.pageSequence === "finished")) return commitResult("conflict", scan);
      if (command.nextCursor !== null && (command.nextCursor.expiresAt <= command.now || command.nextCursor.expiresAt - command.now > LIMITS.cursorTtlMs || command.nextCursor.value === scan.cursor?.value)) return commitResult("conflict", scan);
      // Page receipts are bounded separately; a terminal page may use the final
      // slot, but a continuation cannot imply that another page will fit.
      if (scan.checkpointVersion >= maximumPages) return commitResult("conflict", scan);
      fault("before_stage");
      const storedSources = new Map(state.sources);
      const resources = new Map(state.resources);
      let metrics = state.metrics;
      let unordered = false;
      const sorted = [...sources].sort((a, b) => compareText(a.resourceKey, b.resourceKey) || compareText(a.versionKey, b.versionKey));
      for (const pending of sorted) {
        if (storedSources.has(pending.versionKey)) continue;
        const priorResource = resources.get(pending.resourceKey);
        const priorObserved = priorResource ? storedSources.get(priorResource.value.observedVersionKey)!.value : null;
        const priorCurrent = priorResource ? storedSources.get(priorResource.value.currentVersionKey)!.value : null;
        let ordering: SquareProviderOrdering = priorCurrent === null ? "newer" : compareSquareProviderRevision(priorCurrent.pending.providerRevision, pending.providerRevision);
        if (ordering === "same") ordering = "conflict"; // Same immutable versionKey already deduplicated above.
        if (ordering === "unordered" || ordering === "conflict") unordered = true;
        const ordinal = (priorResource?.value.versionCount ?? 0) + 1;
        const version = materializeSquarePendingSource(pending, ordinal, priorObserved?.version.id ?? null);
        const stored = frozen({ pending, version, ordering }) as SquareStoredSource;
        const sourceMetrics = measure({ versionKey: pending.versionKey, stored });
        storedSources.set(pending.versionKey, { value: stored, metrics: sourceMetrics });
        metrics = adjustMetrics(metrics, null, sourceMetrics);
        const resource = frozen({ observedVersionKey: pending.versionKey, currentVersionKey: ordering === "newer" || priorResource === undefined ? pending.versionKey : priorResource.value.currentVersionKey, versionCount: ordinal });
        const resourceMetrics = measure({ resourceKey: pending.resourceKey, resource });
        resources.set(pending.resourceKey, { value: resource, metrics: resourceMetrics });
        metrics = adjustMetrics(metrics, priorResource?.metrics ?? null, resourceMetrics);
        fault("during_stage");
      }
      fault("during_stage");
      const receipts = new Map(scan.receipts);
      receipts.set(command.pageId, frozen({ lease: command.lease, commandFingerprint, pageId: command.pageId }));
      const pageLimited = command.nextCursor !== null && scan.checkpointVersion + 1 >= maximumPages;
      const reasons = [...new Set([
        ...(scan.completeness?.reasons ?? []).filter((reason) => reason !== "partial_page_sequence"),
        ...command.completeness.reasons, ...(unordered ? ["unordered_provider_revision" as const] : [])
      ])].sort();
      const pageCompleteness: SquarePageCompleteness = frozen({ ...command.completeness, reasons });
      const completeness = pageLimited ? interrupted(pageCompleteness, true) : pageCompleteness;
      const advanced = { ...scan, receipts, checkpointVersion: scan.checkpointVersion + 1, cursor: frozen(command.nextCursor), lease: null, attempt: 0, notBefore: command.now, lastNow: command.now, stream: scan.stream ?? sources[0]?.stream ?? null, completeness,
        status: command.nextCursor === null ? "finished" as const : pageLimited ? "blocked" as const : "ready" as const };
      const candidate = scanState({ ...state, sources: storedSources, resources, metrics }, advanced);
      if (!withinCapacity(candidate)) {
        const blockedScan: Scan = { ...scan, status: "blocked", lease: null, lastNow: command.now, completeness: interrupted(scan.completeness, true) };
        publishScan(blockedScan);
        return commitResult("conflict", blockedScan);
      }
      // Only publication point for source versions + resource candidates + receipt
      // + checkpoint. A thrown lost acknowledgement happens strictly AFTER it.
      state = candidate;
      fault("after_commit");
      return commitResult("committed", advanced, command.now);
    },
    async release(rawLease: SquarePageLease, rawInput: Readonly<{ now: number; retryAfterMs: number | null; blocked: boolean; completeness?: SquarePageCompleteness }>) {
      let lease: SquarePageLease, input: typeof rawInput;
      try {
        lease = leaseValue(jsonCopy(rawLease).value);
        input = jsonCopy(rawInput).value as typeof rawInput;
        exactKeys(input, ["now", "retryAfterMs", "blocked", "completeness"], false);
        if (!integer(input.now) || typeof input.blocked !== "boolean" || input.retryAfterMs !== null && !integer(input.retryAfterMs)) return;
        if (input.completeness !== undefined) completenessValue(input.completeness);
      } catch { return; }
      const scan = state.scans.get(lease.binding.scanKey)?.value;
      if (!scan || !leaseMatches(scan, lease, input.now)) return;
      const blocked = input.blocked || lease.attempt >= LIMITS.attempts;
      const delay = Math.min(input.retryAfterMs ?? 1_000 * 2 ** (lease.attempt - 1), LIMITS.retryAfterMs);
      if (input.now > Number.MAX_SAFE_INTEGER - delay) return;
      const prior = input.completeness === undefined ? scan.completeness : {
        ...input.completeness, reasons: [...new Set([...(scan.completeness?.reasons ?? []), ...input.completeness.reasons])].sort()
      };
      publishScan({ ...scan, lease: null, status: blocked ? "blocked" : "ready", notBefore: input.now + delay, lastNow: input.now, completeness: interrupted(prior, blocked) });
    }
  });
  return Object.freeze({
    repository,
    setCurrentGeneration,
    injectFault(point: SquareSyntheticRepositoryFault) {
      if (!["before_stage", "during_stage", "after_commit"].includes(point)) invalid();
      nextFault = point;
    },
    /** Private cursors require an explicit test-only inspection opt-in. */
    inspect(inspection: Readonly<{ includePrivateCursors?: boolean }> = {}) {
      const parsed = jsonCopy(inspection).value as typeof inspection;
      exactKeys(parsed, ["includePrivateCursors"], false);
      if (parsed.includePrivateCursors !== undefined && typeof parsed.includePrivateCursors !== "boolean") invalid();
      return frozen({
        retainedBytes: state.metrics.bytes, retainedContainers: state.metrics.containers,
        sourceVersionCount: state.sources.size,
        sources: [...state.sources.values()].map((entry) => entry.value),
        resources: [...state.resources].map(([resourceKey, entry]) => ({ resourceKey, ...entry.value })),
        scans: [...state.scans.values()].map(({ value: scan }) => ({
          binding: scan.binding, status: scan.status, checkpointVersion: scan.checkpointVersion,
          pageNumber: scan.checkpointVersion + 1, attempt: scan.attempt, notBefore: scan.notBefore,
          completeness: scan.completeness, committedPageCount: scan.receipts.size,
          cursor: scan.cursor === null ? null : parsed.includePrivateCursors === true ? scan.cursor : {
            responseFingerprint: scan.cursor.responseFingerprint, expiresAt: scan.cursor.expiresAt
          }
        }))
      });
    }
  });
}

function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0); }
function hash(value: unknown): value is string { return typeof value === "string" && HASH.test(value); }
function compareText(a: string, b: string) { return a === b ? 0 : a < b ? -1 : 1; }
function invalid(): never { throw new Error("square_synthetic_repository_input_invalid"); }
function option(value: number | undefined, maximum: number) { if (value === undefined) return maximum; if (!integer(value) || value < 1 || value > maximum) invalid(); return value; }
function exactKeys(value: unknown, keys: readonly string[], required = true): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key)) || required && Object.keys(value).length !== keys.length) invalid();
}
function bindingValue(value: unknown): SquarePageBinding {
  exactKeys(value, ["scanKey", "scopeFingerprint", "queryFingerprint", "cursorBindingFingerprint", "generation"]);
  if (![value.scanKey, value.scopeFingerprint, value.queryFingerprint, value.cursorBindingFingerprint].every(hash) || !integer(value.generation) || value.generation < 1) invalid();
  return frozen(value) as SquarePageBinding;
}
function sameBinding(a: SquarePageBinding, b: SquarePageBinding) { return a.scanKey === b.scanKey && a.scopeFingerprint === b.scopeFingerprint && a.queryFingerprint === b.queryFingerprint && a.cursorBindingFingerprint === b.cursorBindingFingerprint && a.generation === b.generation; }
function cursorValue(value: unknown): asserts value is SquarePrivateCursor | null {
  if (value === null) return;
  exactKeys(value, ["value", "responseFingerprint", "expiresAt"]);
  // Unlike the old generic 1,024-character checkpoint type, existing Square
  // response/request contracts permit private cursors up to 4,096 characters.
  if (typeof value.value !== "string" || value.value.length > LIMITS.stringLength || !CURSOR.test(value.value) || !hash(value.responseFingerprint) || !integer(value.expiresAt)) invalid();
}
function leaseValue(value: unknown): SquarePageLease {
  exactKeys(value, ["binding", "leaseId", "expiresAt", "checkpointVersion", "cursor", "attempt", "pageNumber"]);
  bindingValue(value.binding); cursorValue(value.cursor);
  if (!hash(value.leaseId) || !integer(value.expiresAt) || !integer(value.checkpointVersion) || value.checkpointVersion > LIMITS.pagesPerScan || !integer(value.attempt) || value.attempt < 1 || value.attempt > LIMITS.attempts || !integer(value.pageNumber) || value.pageNumber !== value.checkpointVersion + 1) invalid();
  return value as SquarePageLease;
}
function completenessValue(value: unknown): asserts value is SquarePageCompleteness {
  exactKeys(value, ["pageSequence", "historical", "economic", "reasons"]);
  if (!["partial", "finished", "blocked"].includes(value.pageSequence as string) || value.historical !== "unknown" || value.economic !== "blocked" || !Array.isArray(value.reasons) || value.reasons.length > REASONS.size || value.reasons.some((reason) => typeof reason !== "string" || !REASONS.has(reason)) || new Set(value.reasons).size !== value.reasons.length) invalid();
}
function interrupted(prior: SquarePageCompleteness | null, blocked: boolean): SquarePageCompleteness {
  return frozen({ pageSequence: blocked ? "blocked" : "partial", historical: "unknown", economic: "blocked", reasons: [...new Set([...(prior?.reasons ?? []), "history_unknown" as const, "partial_page_sequence" as const, "interrupted_scan" as const])].sort() });
}
function adjustMetrics(total: Metrics, before: Metrics | null, after: Metrics): Metrics {
  return { bytes: total.bytes - (before?.bytes ?? 0) + after.bytes, containers: total.containers - (before?.containers ?? 0) + after.containers };
}
// Logical retained JSON payload accounting, not an assertion about JS heap size.
// Map keys are charged in their entries; counts independently bound metadata.
// A staged source includes its pending projection AND generic source projection:
// permit that bounded duplication while measuring, then explicitly reject the
// entire candidate if total retained payload exceeds the configured 64MiB cap.
function measure(value: unknown): Metrics {
  const measured = jsonCopy(value, false, LIMITS.retainedContainers, 3 * LIMITS.commandBytes, 2 * LIMITS.commandValues + 10_000);
  return { bytes: measured.bytes, containers: measured.containers };
}
function frozen<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) frozen(child);
  return Object.freeze(value);
}
/**
 * All aliases count per occurrence. The mapper's largest projected page is
 * 65,004 containers; 66,000 includes the command, lease and cursor wrappers.
 * 7.2m values covers 60k old schema containers * 64 properties plus 3,000
 * repeated 1,000-location scopes and new wrapper fields. The independent 64MiB
 * JSON budget is an explicit acceptance/capacity limit, not a schema maximum.
 */
function jsonCopy(root: unknown, copy = true, maximumContainers: number = LIMITS.commandContainers, maximumBytes: number = LIMITS.commandBytes, maximumValues: number = LIMITS.commandValues) {
  let values = 0, containers = 0, bytes = 0;
  const active = new Set<object>();
  function charge(amount: number) { bytes += amount; if (bytes > maximumBytes) invalid(); }
  function visit(value: unknown, depth: number): unknown {
    if (++values > maximumValues || depth > LIMITS.depth) invalid();
    if (value === null || typeof value === "boolean" || typeof value === "number") {
      if (typeof value === "number" && (!Number.isSafeInteger(value) || Object.is(value, -0))) invalid();
      charge(JSON.stringify(value).length); return value;
    }
    if (typeof value === "string") { if (value.length > LIMITS.stringLength) invalid(); charge(Buffer.byteLength(JSON.stringify(value))); return value; }
    if (typeof value !== "object" || isProxy(value) || active.has(value) || ++containers > maximumContainers) invalid();
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value), keys = Reflect.ownKeys(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype) invalid();
    if (array) {
      const length = Object.getOwnPropertyDescriptor(value, "length");
      if (!length || !("value" in length) || !integer(length.value) || length.value > LIMITS.sourcesPerPage || keys.length !== length.value + 1) invalid();
      for (let index = 0; index < length.value; index++) if (!Object.hasOwn(value, String(index))) invalid();
    } else if (keys.length > LIMITS.properties) invalid();
    active.add(value); charge(2);
    const result: unknown[] | Record<string, unknown> = array ? [] : {};
    let count = 0;
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string" || key.length > 128 || ["__proto__", "constructor", "prototype"].includes(key)) invalid();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) invalid();
      if (count++ > 0) charge(1);
      if (!array) charge(Buffer.byteLength(JSON.stringify(key)) + 1);
      const child = visit(descriptor.value, depth + 1);
      if (copy) { if (Array.isArray(result)) result.push(child); else result[key] = child; }
    }
    active.delete(value); return copy ? result : value;
  }
  return { value: visit(root, 0), bytes, containers, values };
}
