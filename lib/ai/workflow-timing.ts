export type WorkflowStageTimings = Record<string, number>;

export type WorkflowStageLogger = (stage: string, durationMs: number) => void;

export type WorkflowStageRecorder = {
  measure<T>(stage: string, task: () => Promise<T>): Promise<T>;
  measureSync<T>(stage: string, task: () => T): T;
  record(stage: string, durationMs: number): void;
  snapshot(): WorkflowStageTimings;
  elapsedMs(): number;
};

export function createWorkflowStageRecorder({
  startedAtMs = Date.now(),
  now = Date.now,
  onStage
}: {
  startedAtMs?: number;
  now?: () => number;
  onStage?: WorkflowStageLogger;
} = {}): WorkflowStageRecorder {
  const timings: WorkflowStageTimings = {};

  function record(stage: string, durationMs: number) {
    const boundedDuration = Math.max(0, Math.round(durationMs));
    timings[stage] = (timings[stage] || 0) + boundedDuration;
    onStage?.(stage, boundedDuration);
  }

  return {
    async measure<T>(stage: string, task: () => Promise<T>) {
      const stageStartedAt = now();
      try {
        return await task();
      } finally {
        record(stage, now() - stageStartedAt);
      }
    },
    measureSync<T>(stage: string, task: () => T) {
      const stageStartedAt = now();
      try {
        return task();
      } finally {
        record(stage, now() - stageStartedAt);
      }
    },
    record,
    snapshot() {
      return { ...timings };
    },
    elapsedMs() {
      return Math.max(0, Math.round(now() - startedAtMs));
    }
  };
}
