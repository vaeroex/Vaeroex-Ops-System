import { z } from "zod";

import { BoundedIdentifierSchema, UuidSchema } from "@/lib/integrations/contracts/primitives";
import {
  RuntimeTaskStateSchema,
  RuntimeTerminalTaskStateSchema,
  type RuntimeTaskState
} from "@/lib/integrations/runtime/contracts";

export const ControlledRunQueueStateSchema = z.enum(["RUNNING", "PAUSED"]);

export const ControlledRunTaskSnapshotSchema = z
  .object({
    taskId: UuidSchema,
    state: RuntimeTaskStateSchema
  })
  .strict();

export const ControlledRunSnapshotSchema = z
  .object({
    queueName: BoundedIdentifierSchema,
    queueState: ControlledRunQueueStateSchema,
    tasks: ControlledRunTaskSnapshotSchema.array().min(1).max(1_000)
  })
  .strict();

export type ControlledRunSnapshot = z.infer<typeof ControlledRunSnapshotSchema>;

export type ControlledRunObservation = Readonly<{
  status: "observing" | "finalized";
  terminalTaskCount: number;
  nonTerminalTaskCount: number;
  taskStates: Readonly<Record<RuntimeTaskState, number>>;
  pauseRequested: boolean;
  idempotent: boolean;
}>;

type ControlledRunObserverInput = Readonly<{
  queueName: string;
  expectedTaskIds: readonly string[];
  pauseQueue(queueName: string): Promise<void>;
}>;

function taskStateCounts(tasks: ControlledRunSnapshot["tasks"]) {
  const counts = Object.fromEntries(
    RuntimeTaskStateSchema.options.map((state) => [state, 0])
  ) as Record<RuntimeTaskState, number>;
  for (const task of tasks) counts[task.state] += 1;
  return counts;
}

export class ControlledRunObserver {
  readonly #queueName: string;
  readonly #expectedTaskIds: ReadonlySet<string>;
  readonly #pauseQueue: ControlledRunObserverInput["pauseQueue"];
  #pausePromise: Promise<void> | null = null;
  #finalized = false;

  constructor(input: ControlledRunObserverInput) {
    this.#queueName = BoundedIdentifierSchema.parse(input.queueName);
    const taskIds = input.expectedTaskIds.map((taskId) => UuidSchema.parse(taskId));
    if (taskIds.length === 0 || new Set(taskIds).size !== taskIds.length) {
      throw new Error("controlled_run_expected_task_scope_invalid");
    }
    this.#expectedTaskIds = new Set(taskIds);
    this.#pauseQueue = input.pauseQueue;
  }

  async observe(value: unknown): Promise<ControlledRunObservation> {
    const snapshot = ControlledRunSnapshotSchema.parse(value);
    this.#assertExactScope(snapshot);
    const taskStates = taskStateCounts(snapshot.tasks);
    const terminalTaskCount = snapshot.tasks.filter((task) =>
      RuntimeTerminalTaskStateSchema.safeParse(task.state).success
    ).length;
    const nonTerminalTaskCount = snapshot.tasks.length - terminalTaskCount;

    if (nonTerminalTaskCount > 0) {
      return {
        status: "observing",
        terminalTaskCount,
        nonTerminalTaskCount,
        taskStates,
        pauseRequested: false,
        idempotent: false
      };
    }

    if (this.#finalized || snapshot.queueState === "PAUSED") {
      this.#finalized = true;
      return {
        status: "finalized",
        terminalTaskCount,
        nonTerminalTaskCount,
        taskStates,
        pauseRequested: false,
        idempotent: true
      };
    }

    const pauseRequested = this.#pausePromise === null;
    if (pauseRequested) {
      this.#pausePromise = this.#pauseQueue(this.#queueName)
        .then(() => {
          this.#finalized = true;
        })
        .catch((error: unknown) => {
          this.#pausePromise = null;
          throw error;
        });
    }
    await this.#pausePromise;
    return {
      status: "finalized",
      terminalTaskCount,
      nonTerminalTaskCount,
      taskStates,
      pauseRequested,
      idempotent: !pauseRequested
    };
  }

  #assertExactScope(snapshot: ControlledRunSnapshot) {
    if (snapshot.queueName !== this.#queueName) {
      throw new Error("controlled_run_queue_scope_mismatch");
    }
    const observedTaskIds = new Set(snapshot.tasks.map((task) => task.taskId));
    if (
      observedTaskIds.size !== snapshot.tasks.length ||
      observedTaskIds.size !== this.#expectedTaskIds.size ||
      [...observedTaskIds].some((taskId) => !this.#expectedTaskIds.has(taskId))
    ) {
      throw new Error("controlled_run_task_scope_mismatch");
    }
  }
}

export async function observeControlledRunSnapshots(
  observer: ControlledRunObserver,
  snapshots: AsyncIterable<unknown>
) {
  for await (const snapshot of snapshots) {
    const observation = await observer.observe(snapshot);
    if (observation.status === "finalized") return observation;
  }
  throw new Error("controlled_run_observation_ended_before_settlement");
}
