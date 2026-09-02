import { randomUUID } from "node:crypto";

import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import {
  DurablePageCommitResultSchema,
  PHASE_6_PROMOTION_AUTHORIZED,
  RUNTIME_CONTRACT_VERSIONS,
  RuntimeCheckpointCommitSchema,
  type CreateRuntimeTaskCommand,
  type DurablePageCommitResult,
  type RuntimeWorkerKind
} from "@/lib/integrations/runtime/contracts";
import {
  SyntheticDurableRuntimeLedger,
  type RuntimeTaskRecord
} from "@/lib/integrations/runtime/ledger";
import {
  SyntheticRuntimeProvider,
  SyntheticRuntimeProviderError,
  type SyntheticRuntimeScenario
} from "@/lib/integrations/runtime/synthetic-provider";

export type DurableSourcePageSink = Readonly<{
  commit(input: {
    task: RuntimeTaskRecord;
    records: readonly unknown[];
  }): PromiseLike<DurablePageCommitResult>;
}>;

export type RuntimeCrashBoundary =
  | "none"
  | "after_lease"
  | "after_provider_before_source_commit"
  | "after_source_commit_before_task_commit"
  | "after_task_commit_before_response";

export class DurableSynchronizationWorker {
  readonly #ledger: SyntheticDurableRuntimeLedger;
  readonly #provider: SyntheticRuntimeProvider;
  readonly #sink: DurableSourcePageSink;
  readonly #clock: () => Date;

  constructor(input: {
    ledger: SyntheticDurableRuntimeLedger;
    provider: SyntheticRuntimeProvider;
    sink: DurableSourcePageSink;
    clock?: () => Date;
  }) {
    this.#ledger = input.ledger;
    this.#provider = input.provider;
    this.#sink = input.sink;
    this.#clock = input.clock ?? (() => new Date());
  }

  async execute(input: {
    taskId: string;
    workerKind: RuntimeWorkerKind;
    expectedConnectionGeneration: number;
    ownerFingerprint: string;
    scenario: SyntheticRuntimeScenario;
    crashAt?: RuntimeCrashBoundary;
    checkpointId: string;
    checkpointVersion: number;
    cursorVersion: number;
    deliveryRetryCount: number;
    deliveryExecutionCount: number;
    deliveryAttemptFingerprint?: string;
    childTaskFactory?: (parent: RuntimeTaskRecord, now: Date) => CreateRuntimeTaskCommand;
  }) {
    const now = this.#clock();
    const leaseId = randomUUID();
    const deliveryDispatchGeneration =
      this.#ledger.task(input.taskId)?.dispatchGeneration ?? 0;
    const leased = this.#ledger.leaseTask({
      taskId: input.taskId,
      workerKind: input.workerKind,
      leaseId,
      ownerFingerprint: input.ownerFingerprint,
      leaseSeconds: 120,
      expectedConnectionGeneration: input.expectedConnectionGeneration,
      deliveryDispatchGeneration,
      deliveryRetryCount: input.deliveryRetryCount,
      deliveryExecutionCount: input.deliveryExecutionCount,
      deliveryAttemptFingerprint: input.deliveryAttemptFingerprint ?? contractSha256({
        fingerprintPurpose: "synthetic_runtime_delivery_attempt",
        fingerprintVersion: "synthetic_runtime_delivery_attempt_fingerprint_v1",
        payload: {
          taskId: input.taskId,
          dispatchGeneration: deliveryDispatchGeneration,
          retryCount: input.deliveryRetryCount,
          executionCount: input.deliveryExecutionCount
        }
      }),
      now
    });
    if (!leased.acquired) return leased;
    if (input.crashAt === "after_lease") {
      throw new Error("synthetic_crash_after_lease");
    }

    try {
      const priorCheckpoint = this.#ledger.checkpoint(input.checkpointId);
      const page = await this.#provider.fetchPage({
        scenario: input.scenario,
        now,
        checkpoint: priorCheckpoint
      });
      if (input.crashAt === "after_provider_before_source_commit") {
        throw new Error("synthetic_crash_after_provider_before_source_commit");
      }
      const sinkResult = DurablePageCommitResultSchema.parse(
        await this.#sink.commit({ task: leased.task, records: page.records })
      );
      if (sinkResult.promotionAuthorized !== PHASE_6_PROMOTION_AUTHORIZED) {
        throw new Error("integration_runtime_promotion_boundary_violated");
      }
      if (input.crashAt === "after_source_commit_before_task_commit") {
        throw new Error("synthetic_crash_after_source_commit_before_task_commit");
      }

      const cursor = page.nextCursor ?? {
        protocolVersion: RUNTIME_CONTRACT_VERSIONS.checkpoint,
        cursorKind: "cursor" as const,
        cursorValue: `synthetic_terminal_${input.cursorVersion}`,
        windowStartAt: leased.task.controlMetadata.windowStartAt,
        windowEndAt: leased.task.controlMetadata.windowEndAt
      };
      const checkpoint = RuntimeCheckpointCommitSchema.parse({
        checkpointId: input.checkpointId,
        expectedCheckpointVersion: input.checkpointVersion,
        streamKey: leased.task.streamKey,
        checkpointKind: cursor.cursorKind,
        cursorVersion: input.cursorVersion,
        cursor,
        cursorFingerprint: contractSha256({
          fingerprintPurpose: "integration_runtime_checkpoint_cursor",
          fingerprintVersion: "integration_runtime_checkpoint_cursor_fingerprint_v1",
          payload: cursor
        }),
        providerWatermarkAt: page.providerWatermarkAt,
        overlapSeconds: 300,
        fullReconciliation: leased.task.taskKind === "full_reconciliation",
        downstreamCommitFingerprint: sinkResult.durableEffectFingerprint
      });
      const childTask = page.nextCursor && input.childTaskFactory
        ? input.childTaskFactory(leased.task, now)
        : null;
      const completed = this.#ledger.complete({
        taskId: leased.task.id,
        leaseId,
        ownerFingerprint: input.ownerFingerprint,
        durableEffectFingerprint: sinkResult.durableEffectFingerprint,
        checkpoint,
        childTask,
        now
      });
      if (input.crashAt === "after_task_commit_before_response") {
        throw new Error("synthetic_crash_after_task_commit_before_response");
      }
      return {
        acquired: true,
        completed,
        pageRecordCount: page.records.length,
        providerWatermarkAt: page.providerWatermarkAt
      } as const;
    } catch (error) {
      if (error instanceof SyntheticRuntimeProviderError) {
        return {
          acquired: true,
          failed: this.#ledger.fail({
            taskId: leased.task.id,
            leaseId,
            ownerFingerprint: input.ownerFingerprint,
            category: error.category,
            safeCode: error.safeCode,
            retryable: error.retryable,
            retryAfterMs: error.retryAfterMs,
            now: this.#clock()
          })
        } as const;
      }
      throw error;
    }
  }
}

export class IdempotentSyntheticPageSink implements DurableSourcePageSink {
  readonly #effects = new Map<string, DurablePageCommitResult>();
  #calls = 0;

  get calls() {
    return this.#calls;
  }

  get economicEffects() {
    return this.#effects.size;
  }

  async commit(input: { task: RuntimeTaskRecord; records: readonly unknown[] }) {
    this.#calls += 1;
    const fingerprint = contractSha256({
      fingerprintPurpose: "integration_runtime_durable_source_page",
      fingerprintVersion: "integration_runtime_durable_source_page_fingerprint_v1",
      payload: {
        taskIdempotencyFingerprint: input.task.idempotencyFingerprint,
        records: input.records
      }
    });
    const existing = this.#effects.get(fingerprint);
    if (existing) return existing;
    const result = DurablePageCommitResultSchema.parse({
      contractVersion: RUNTIME_CONTRACT_VERSIONS.durableCommit,
      durableEffectFingerprint: fingerprint,
      sourceVersionsCommitted: input.records.length,
      factsAccepted: input.records.length,
      contributionsChanged: input.records.length,
      deterministicDirtyNodes: input.records.length === 0 ? 0 : 1,
      promotionAuthorized: false
    });
    this.#effects.set(fingerprint, result);
    return result;
  }
}
