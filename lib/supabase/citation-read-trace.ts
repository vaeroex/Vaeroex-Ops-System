import "server-only";

type Phase = "read_entry" | "session_call_pending" | "session_call_settled" | "session_call_rejected" |
  "refresh_fetch_invoked" | "refresh_headers_received" | "refresh_body_read" | "refresh_body_complete" |
  "refresh_fetch_rejected" | "refresh_body_rejected" | "rpc_fetch_invoked" | "rpc_headers_received" |
  "rpc_body_read" | "rpc_body_complete" | "rpc_fetch_rejected" | "rpc_body_rejected" | "client_complete";
type StatusClass = "not_observed" | "2xx" | "3xx" | "4xx" | "5xx" | "other";
type Outcome = "completed" | "failed" | "deadline";
type Snapshot = Readonly<{ outcome: Outcome; phase: Phase; elapsedMs: number;
  milestones: Readonly<Partial<Record<Phase, number>>>; rpcStatus: StatusClass; refreshStatus: StatusClass }>;

/** Request-local observation only. No request/session/result contents enter this state. */
export class SharedCitationReadTrace {
  #started: number | undefined;
  #phase: Phase = "read_entry";
  #milestones: Partial<Record<Phase, number>> = {};
  #rpcStatus: StatusClass = "not_observed";
  #refreshStatus: StatusClass = "not_observed";
  #closed: Snapshot | undefined;

  #elapsed() { return this.#started === undefined ? 0 : Math.min(60_000, Math.max(0, Math.round(performance.now() - this.#started))); }
  #active() { return this.#started !== undefined && !this.#closed; }
  #mark(phase: Phase) {
    if (!this.#active()) return;
    this.#phase = phase;
    this.#milestones[phase] ??= this.#elapsed();
  }
  begin() {
    if (this.#started !== undefined || this.#closed) return;
    this.#started = performance.now();
    this.#mark("read_entry");
  }
  clientComplete() { this.#mark("client_complete"); }
  finish(outcome: Outcome): Snapshot {
    // Freeze before abort; later callbacks must not turn a deadline into a transport rejection.
    this.#closed ??= Object.freeze({ outcome: outcome === "completed" || outcome === "deadline" ? outcome : "failed",
      phase: this.#phase, elapsedMs: this.#elapsed(), milestones: Object.freeze({ ...this.#milestones }),
      rpcStatus: this.#rpcStatus, refreshStatus: this.#refreshStatus });
    return this.#closed;
  }

  /** Observe the existing public SDK call, without adding a session read or inspecting its result. */
  wrapSession<T>(read: () => Promise<T>): () => Promise<T> {
    return () => {
      if (!this.#active()) return read();
      this.#mark("session_call_pending");
      let result: Promise<T>;
      try { result = read(); }
      catch (error) { this.#mark("session_call_rejected"); throw error; }
      // Preserve the original promise/result/error; observers never inspect a session.
      void result.then(() => { this.#mark("session_call_settled"); }, () => { this.#mark("session_call_rejected"); });
      return result;
    };
  }

  /** Supported SDK fetch hook. Invocation is not proof of socket dispatch or service receipt. */
  wrapFetch(fetcher: typeof fetch, origin: string): typeof fetch {
    return async (input, init) => {
      let kind: "refresh" | "rpc" | undefined;
      if (this.#active()) {
        try {
          const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
          if (url.origin === origin) {
            if (url.pathname === "/auth/v1/token") kind = "refresh";
            else if (url.pathname === "/rest/v1/rpc/reopen_shared_evidence_target_v1" ||
              url.pathname === "/rest/v1/rpc/reopen_shared_evidence_artifact_v1") kind = "rpc";
          }
        } catch { /* Unrecognized inputs pass through unchanged, without observation. */ }
      }
      if (!kind) return fetcher(input, init);
      this.#mark(kind === "rpc" ? "rpc_fetch_invoked" : "refresh_fetch_invoked");
      let response: Response;
      try { response = await fetcher(input, init); }
      catch (error) { this.#mark(kind === "rpc" ? "rpc_fetch_rejected" : "refresh_fetch_rejected"); throw error; }
      if (!this.#active()) return response;
      const status: StatusClass = response.status >= 200 && response.status < 300 ? "2xx" :
        response.status >= 300 && response.status < 400 ? "3xx" : response.status >= 400 && response.status < 500 ? "4xx" :
        response.status >= 500 && response.status < 600 ? "5xx" : "other";
      if (kind === "rpc") this.#rpcStatus = status; else this.#refreshStatus = status;
      this.#mark(kind === "rpc" ? "rpc_headers_received" : "refresh_headers_received");
      // Do not clone, tee, consume or parse a body. Observe only the SDK's existing read.
      // Bind all Response methods to their real receiver to preserve native brand checks.
      return new Proxy(response, { get: (target, property) => {
        const value = Reflect.get(target, property, target);
        if ((property === "text" || property === "json") && typeof value === "function") {
          return async (...args: unknown[]) => {
            this.#mark(kind === "rpc" ? "rpc_body_read" : "refresh_body_read");
            try {
              const result = await Reflect.apply(value, target, args);
              this.#mark(kind === "rpc" ? "rpc_body_complete" : "refresh_body_complete");
              return result;
            } catch (error) { this.#mark(kind === "rpc" ? "rpc_body_rejected" : "refresh_body_rejected"); throw error; }
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      } });
    };
  }
}
