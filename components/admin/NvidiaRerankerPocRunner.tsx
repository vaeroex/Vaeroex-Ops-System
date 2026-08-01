"use client";

import { useState } from "react";

type RunnerState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "failed"; message: string }
  | { status: "completed"; report: unknown };

export function NvidiaRerankerPocRunner() {
  const [state, setState] = useState<RunnerState>({ status: "idle" });

  async function runBenchmark() {
    if (state.status === "running" || state.status === "completed") return;
    setState({ status: "running" });
    try {
      const response = await fetch("/api/internal/nvidia-reranker-poc", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "run-synthetic-nvidia-reranker-poc-v1" })
      });
      const payload = await response.json() as { ok?: boolean; error?: string; report?: unknown };
      if (!response.ok || !payload.ok || !payload.report) {
        setState({ status: "failed", message: payload.error || "The benchmark could not be completed." });
        return;
      }
      setState({ status: "completed", report: payload.report });
    } catch {
      setState({ status: "failed", message: "The benchmark request could not be completed." });
    }
  }

  return (
    <section className="space-y-4" aria-busy={state.status === "running"}>
      <div>
        <h1 className="text-xl font-semibold text-white">NVIDIA reranker shadow POC</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">
          Runs the committed synthetic benchmark in Preview only. No customer evidence or active retrieval output is used.
        </p>
      </div>
      <button
        type="button"
        onClick={runBenchmark}
        disabled={state.status === "running" || state.status === "completed"}
        className="rounded-md bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {state.status === "running" ? "Running benchmark..." : state.status === "completed" ? "Benchmark completed" : "Run synthetic benchmark once"}
      </button>
      {state.status === "failed" ? <p role="alert" className="text-sm text-red-300">{state.message}</p> : null}
      {state.status === "completed" ? (
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-4 text-xs text-slate-200">
          {JSON.stringify(state.report, null, 2)}
        </pre>
      ) : null}
    </section>
  );
}
