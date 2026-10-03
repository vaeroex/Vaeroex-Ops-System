const denied = () => new Error("native_private_entry_denied");
const heldInputs = new WeakMap();
export function releasePrivateAdministratorInput(input = process.stdin) {
  const sink = heldInputs.get(input);
  if (!sink) return;
  heldInputs.delete(input); input.removeListener("data", sink); input.pause();
  try { input.setRawMode(false); } catch { /* Process is exiting; no credential diagnostic. */ }
}

// Invoke only after nonsecret preflight in an exec-replaced, private SSH/TTY.
// Bytes never become a JS string, terminal echo, line history or diagnostic.
export function readPrivateAdministrator({ input = process.stdin, output = process.stdout, timeoutMs = 300000, signal } = {}) {
  if (!input?.isTTY || heldInputs.has(input) || typeof input.setRawMode !== "function" || !output?.isTTY ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000 ||
      signal !== undefined && !(signal instanceof AbortSignal)) return Promise.reject(denied());
  return new Promise((resolve, reject) => {
    const bytes = Buffer.alloc(510);
    let used = 0, done = false, timer;
    const finish = success => {
      if (done) return;
      done = true; clearTimeout(timer);
      signal?.removeEventListener("abort", fail);
      input.removeListener("data", receive); input.removeListener("end", fail); input.removeListener("error", fail);
      // Keep echo off after entry too: later input is discarded, never returned
      // to a shell or echoed while maintenance is still running. The exec-owned
      // supervisor releases this sink only as it exits. Single-line private
      // paste is supported; no universal paste-detection claim is made.
      const sink = chunk => { if (Buffer.isBuffer(chunk)) chunk.fill(0); };
      heldInputs.set(input, sink); input.on("data", sink);
      try { output.write("\n"); } catch { success = false; }
      if (success) { const result = Buffer.alloc(used); bytes.copy(result, 0, 0, used); bytes.fill(0); resolve(result); }
      else { bytes.fill(0); reject(denied()); }
    };
    const fail = () => finish(false);
    const receive = chunk => {
      try {
        if (!Buffer.isBuffer(chunk)) { fail(); return; }
        for (let index = 0; index < chunk.length; index++) {
          const value = chunk[index];
          if (value === 10 || value === 13) {
            // A single line only; reject trailing bytes instead of sending them
            // to a shell or interpreting another command.
            const trailing = chunk.subarray(index + 1);
            finish(used > 0 && (trailing.length === 0 || value === 13 && trailing.length === 1 && trailing[0] === 10));
            return;
          }
          if (value === 8 || value === 127) { if (used) bytes[--used] = 0; continue; }
          if (value < 32 || value > 126 || used === bytes.length) { fail(); return; }
          bytes[used++] = value;
        }
      } finally { if (Buffer.isBuffer(chunk)) chunk.fill(0); }
    };
    try {
      input.setRawMode(true);
      input.on("data", receive); input.once("end", fail); input.once("error", fail);
      signal?.addEventListener("abort", fail, { once: true });
      if (signal?.aborted) { fail(); return; }
      output.write("native_private_administrator_entry_300_seconds\n");
      timer = setTimeout(fail, timeoutMs); input.resume();
    } catch { fail(); }
  });
}
