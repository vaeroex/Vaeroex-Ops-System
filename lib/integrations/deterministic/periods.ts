import { IsoDateSchema } from "@/lib/integrations/contracts/primitives";
import type {
  DeterministicNodeScope,
  DependencyRegistry
} from "@/lib/integrations/deterministic/contracts";

type DependencyWindow = DependencyRegistry["kpis"][number]["dependencyWindow"];

function utcDate(value: string) {
  const parsed = IsoDateSchema.parse(value);
  const [year, month, day] = parsed.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== parsed) {
    throw new Error("deterministic_economic_date_invalid");
  }
  return date;
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function endOfMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0));
}

export function periodScopeForDate(
  economicDate: string,
  granularity: "day" | "month" | "all_time",
  scope: Omit<DeterministicNodeScope, "periodStart" | "periodEnd">
): DeterministicNodeScope {
  const date = utcDate(economicDate);
  if (granularity === "all_time") {
    return { ...scope, periodStart: null, periodEnd: null };
  }
  if (granularity === "day") {
    return { ...scope, periodStart: isoDate(date), periodEnd: isoDate(date) };
  }
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  return {
    ...scope,
    periodStart: isoDate(start),
    periodEnd: isoDate(endOfMonth(date.getUTCFullYear(), date.getUTCMonth()))
  };
}

function scopeGranularity(scope: DeterministicNodeScope) {
  if (scope.periodStart === null || scope.periodEnd === null) return "all_time" as const;
  if (scope.periodStart === scope.periodEnd) return "day" as const;
  const start = utcDate(scope.periodStart);
  const expectedEnd = isoDate(endOfMonth(start.getUTCFullYear(), start.getUTCMonth()));
  if (start.getUTCDate() === 1 && expectedEnd === scope.periodEnd) return "month" as const;
  throw new Error("deterministic_period_scope_unsupported");
}

export function shiftPeriodScope(scope: DeterministicNodeScope, amount: number) {
  if (!Number.isInteger(amount)) throw new Error("deterministic_period_shift_invalid");
  const granularity = scopeGranularity(scope);
  if (granularity === "all_time") {
    if (amount !== 0) throw new Error("deterministic_all_time_period_cannot_shift");
    return scope;
  }

  const start = utcDate(scope.periodStart as string);
  if (granularity === "day") {
    start.setUTCDate(start.getUTCDate() + amount);
    const value = isoDate(start);
    return { ...scope, periodStart: value, periodEnd: value };
  }

  start.setUTCMonth(start.getUTCMonth() + amount);
  return {
    ...scope,
    periodStart: isoDate(start),
    periodEnd: isoDate(endOfMonth(start.getUTCFullYear(), start.getUTCMonth()))
  };
}

function assertMonthly(scope: DeterministicNodeScope) {
  if (scopeGranularity(scope) !== "month") {
    throw new Error("deterministic_calendar_window_requires_monthly_periods");
  }
  return utcDate(scope.periodStart as string);
}

function shifts(scope: DeterministicNodeScope, from: number, through: number) {
  return Array.from({ length: through - from + 1 }, (_, index) =>
    shiftPeriodScope(scope, from + index)
  );
}

export function affectedOutputScopes(
  changedInputScope: DeterministicNodeScope,
  window: DependencyWindow
) {
  if (window.kind === "same_period") return [changedInputScope];
  if (window.kind === "trailing_periods" || window.kind === "trend_periods") {
    return shifts(changedInputScope, 0, window.count - 1);
  }
  if (window.kind === "prior_period_comparison") {
    return [changedInputScope, shiftPeriodScope(changedInputScope, 1)];
  }
  if (window.kind === "year_over_year_comparison") {
    assertMonthly(changedInputScope);
    return [changedInputScope, shiftPeriodScope(changedInputScope, 12)];
  }

  const start = assertMonthly(changedInputScope);
  const finalMonth = window.kind === "quarter_to_date"
    ? Math.floor(start.getUTCMonth() / 3) * 3 + 2
    : 11;
  return shifts(changedInputScope, 0, finalMonth - start.getUTCMonth());
}

export function dependencyInputScopes(
  outputScope: DeterministicNodeScope,
  window: DependencyWindow
) {
  if (window.kind === "same_period") return [outputScope];
  if (window.kind === "trailing_periods" || window.kind === "trend_periods") {
    return shifts(outputScope, -(window.count - 1), 0).reverse();
  }
  if (window.kind === "prior_period_comparison") {
    return [outputScope, shiftPeriodScope(outputScope, -1)];
  }
  if (window.kind === "year_over_year_comparison") {
    assertMonthly(outputScope);
    return [outputScope, shiftPeriodScope(outputScope, -12)];
  }

  const end = assertMonthly(outputScope);
  const firstMonth = window.kind === "quarter_to_date"
    ? Math.floor(end.getUTCMonth() / 3) * 3
    : 0;
  return shifts(outputScope, -(end.getUTCMonth() - firstMonth), 0).reverse();
}

export function scopeBeginsOnOrBefore(scope: DeterministicNodeScope, asOfDate: string) {
  IsoDateSchema.parse(asOfDate);
  return scope.periodStart === null || scope.periodStart <= asOfDate;
}
