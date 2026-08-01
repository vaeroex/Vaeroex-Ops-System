export const BUSINESS_HEALTH_PERFORMANCE_BASELINE = 50 as const;
export const BUSINESS_HEALTH_POSITIVE_CAP = 50 as const;
export const BUSINESS_HEALTH_NEGATIVE_CAP = 50 as const;

export type BusinessHealthPerformanceSignal = Readonly<{
  identity: string;
  findingId: string;
  points: number;
}>;

export type IntelligenceReadinessInput = Readonly<{
  hasWorkspaceProfile: boolean;
  hasOriginalFiles: boolean;
  hasCanonicalKpis: boolean;
  hasTraceableCustomerOrOperationalRecords: boolean;
  independentSourceIdentityCount: number;
  sourceTypeCount: number;
  canonicalKpiCount: number;
  kpisWithHistoricalDepth: number;
  freshKpiCount: number;
}>;

export type IntelligenceReadinessResult = Readonly<{
  score: number;
  confidence: "High" | "Medium" | "Low";
  label: "Strong" | "Developing" | "Limited";
  components: Readonly<{
    authoritativeCompleteness: number;
    independentSourceDiversity: number;
    kpiHistoricalDepth: number;
    kpiFreshness: number;
  }>;
}>;

function boundedCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function strongestDistinctSignals(signals: readonly BusinessHealthPerformanceSignal[]) {
  const strongest = new Map<string, BusinessHealthPerformanceSignal>();

  for (const signal of signals) {
    if (!signal.identity || !signal.findingId || !Number.isFinite(signal.points) || signal.points <= 0) continue;
    const current = strongest.get(signal.identity);
    if (!current || signal.points > current.points || (signal.points === current.points && signal.findingId < current.findingId)) {
      strongest.set(signal.identity, signal);
    }
  }

  return [...strongest.values()].sort((left, right) => right.points - left.points || left.identity.localeCompare(right.identity));
}

function applyCap(signals: readonly BusinessHealthPerformanceSignal[], cap: number) {
  const impacts: Array<BusinessHealthPerformanceSignal & { appliedPoints: number }> = [];
  let remaining = cap;

  for (const signal of strongestDistinctSignals(signals)) {
    const appliedPoints = Math.min(signal.points, remaining);
    if (appliedPoints <= 0) break;
    impacts.push({ ...signal, appliedPoints });
    remaining -= appliedPoints;
  }

  return impacts;
}

export function calculateIntelligenceReadiness(input: IntelligenceReadinessInput): IntelligenceReadinessResult {
  const authoritativeCompleteness =
    (input.hasWorkspaceProfile ? 10 : 0)
    + (input.hasOriginalFiles ? 15 : 0)
    + (input.hasCanonicalKpis ? 25 : 0)
    + (input.hasTraceableCustomerOrOperationalRecords ? 10 : 0);
  const independentIdentitiesBeyondFirst = Math.min(4, Math.max(0, boundedCount(input.independentSourceIdentityCount) - 1));
  const sourceTypesBeyondFirst = Math.min(3, Math.max(0, boundedCount(input.sourceTypeCount) - 1));
  const independentSourceDiversity = Math.round((independentIdentitiesBeyondFirst * 2.5) + (sourceTypesBeyondFirst * (10 / 3)));
  const canonicalKpiCount = boundedCount(input.canonicalKpiCount);
  const kpiHistoricalDepth = canonicalKpiCount
    ? Math.round(10 * Math.min(canonicalKpiCount, boundedCount(input.kpisWithHistoricalDepth)) / canonicalKpiCount)
    : 0;
  const kpiFreshness = canonicalKpiCount
    ? Math.round(10 * Math.min(canonicalKpiCount, boundedCount(input.freshKpiCount)) / canonicalKpiCount)
    : 0;
  const score = clamp(authoritativeCompleteness + independentSourceDiversity + kpiHistoricalDepth + kpiFreshness, 0, 100);
  const confidence = score >= 80 ? "High" as const : score >= 50 ? "Medium" as const : "Low" as const;

  return {
    score,
    confidence,
    label: score >= 80 ? "Strong" : score >= 50 ? "Developing" : "Limited",
    components: {
      authoritativeCompleteness,
      independentSourceDiversity,
      kpiHistoricalDepth,
      kpiFreshness
    }
  };
}

export function calculateBusinessHealthPerformance({
  evidenceEligible,
  positiveSignals,
  negativeSignals
}: {
  evidenceEligible: boolean;
  positiveSignals: readonly BusinessHealthPerformanceSignal[];
  negativeSignals: readonly BusinessHealthPerformanceSignal[];
}) {
  const positive = applyCap(positiveSignals, BUSINESS_HEALTH_POSITIVE_CAP);
  const negative = applyCap(negativeSignals, BUSINESS_HEALTH_NEGATIVE_CAP);
  const positivePerformance = positive.reduce((total, signal) => total + signal.appliedPoints, 0);
  const negativePerformance = negative.reduce((total, signal) => total + signal.appliedPoints, 0);
  const hasEvaluableOutcome = positivePerformance > 0 || negativePerformance > 0;
  const available = evidenceEligible && hasEvaluableOutcome;
  const score = available
    ? clamp(BUSINESS_HEALTH_PERFORMANCE_BASELINE + positivePerformance - negativePerformance, 0, 100)
    : 0;
  const status = !available ? "Insufficient Data" as const : score >= 80 ? "Strong" as const : score >= 50 ? "Watch" as const : "At Risk" as const;
  const driverImpacts = [
    ...negative.map((signal) => ({ findingId: signal.findingId, kind: "risk" as const, scoreImpact: -signal.appliedPoints })),
    ...positive.map((signal) => ({ findingId: signal.findingId, kind: "opportunity" as const, scoreImpact: signal.appliedPoints }))
  ];

  return {
    available,
    hasEvaluableOutcome,
    score,
    status,
    components: {
      // Retained field names keep V1 artifacts readable; V2 fixes this value at the performance baseline.
      dataQualityBase: BUSINESS_HEALTH_PERFORMANCE_BASELINE,
      riskPenalty: negativePerformance,
      opportunityAdjustment: positivePerformance,
      driverImpacts
    }
  };
}
