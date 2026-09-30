import type { IncomingMessage } from "node:http";

/** Header-only edge callbacks cannot observe HTTP/2 DATA or stream completion. */
export async function requireEmptyQboCallbackBody(request: IncomingMessage): Promise<void> {
  const invalid = () => new Error("qbo_oauth_callback_body_invalid");
  if (request.rawHeaders.length % 2 !== 0) throw invalid();
  let contentLengths = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index].toLowerCase();
    if (name === "transfer-encoding" || name === "expect") throw invalid();
    if (name === "content-length") {
      contentLengths += 1;
      if (contentLengths > 1 || request.rawHeaders[index + 1] !== "0") throw invalid();
    }
  }
  if (request.aborted || request.destroyed) throw invalid();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(fail, 5_000);
    function cleanup() {
      clearTimeout(timer);
      request.off("data", data);
      request.off("end", end);
      request.off("error", fail);
      request.off("aborted", fail);
      request.off("close", fail);
    }
    function fail() {
      cleanup();
      request.destroy();
      reject(invalid());
    }
    function data(chunk: Buffer) {
      const nonempty = chunk.byteLength !== 0;
      chunk.fill(0);
      if (nonempty) fail();
    }
    function end() {
      cleanup();
      if (!request.complete) reject(invalid());
      else resolve();
    }
    request.on("data", data);
    request.once("end", end);
    request.once("error", fail);
    request.once("aborted", fail);
    request.once("close", fail);
    if (request.readableEnded) end();
  });
}
