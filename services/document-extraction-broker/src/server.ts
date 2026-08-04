import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { handleCloudRunBrokerWebRequest } from "./adapter";

const MAX_TRANSPORT_BODY_BYTES = 8_500_000;

function boundedResponse(response: ServerResponse, status: number, body: string) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(body);
}

async function readBoundedBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const candidate of request) {
    const chunk = Buffer.isBuffer(candidate) ? candidate : Buffer.from(candidate);
    total += chunk.byteLength;
    if (total > MAX_TRANSPORT_BODY_BYTES) {
      throw new Error("broker_transport_body_too_large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

function requestHeaders(request: IncomingMessage) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

export async function handleCloudRunBrokerRequest(
  incoming: IncomingMessage,
  outgoing: ServerResponse
) {
  try {
    const method = (incoming.method || "").toUpperCase();
    const parsedTarget = new URL(incoming.url || "/", "https://broker.invalid");
    const body = method === "POST" ? await readBoundedBody(incoming) : undefined;
    const request = new Request(`https://broker.invalid${parsedTarget.pathname}${parsedTarget.search}`, {
      method,
      headers: requestHeaders(incoming),
      body
    });
    const response = await handleCloudRunBrokerWebRequest(request);
    outgoing.statusCode = response.status;
    response.headers.forEach((value, name) => outgoing.setHeader(name, value));
    const responseBody = Buffer.from(await response.arrayBuffer());
    outgoing.end(responseBody);
  } catch (error) {
    boundedResponse(
      outgoing,
      error instanceof Error && error.message === "broker_transport_body_too_large" ? 413 : 503,
      '{"ok":false,"error":"The broker operation failed closed."}'
    );
  }
}

function port() {
  const value = Number(process.env.PORT || "8080");
  if (!Number.isInteger(value) || value < 1_024 || value > 65_535) {
    throw new Error("broker_port_invalid");
  }
  return value;
}

const server = createServer((request, response) => {
  void handleCloudRunBrokerRequest(request, response);
});
server.on("clientError", (_error, socket) => {
  socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});
server.listen(port(), "0.0.0.0");

process.once("SIGTERM", () => server.close());
process.once("SIGINT", () => server.close());
