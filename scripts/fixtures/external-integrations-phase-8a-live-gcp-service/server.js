const { createHash } = require("node:crypto");
const http = require("node:http");

const PORT = Number.parseInt(process.env.PORT || "8080", 10);
const PROTOCOL_VERSION = "integration_cloud_task_protocol_v1";
const EXPECTED_QUEUE_NAME = required("EXPECTED_QUEUE_NAME");
const MAX_REQUEST_BYTES = 8 * 1024;

const effects = new Set();
const observations = {
  deliveries: 0,
  duplicates: 0,
  retryAttempts: [],
  pacedStarts: [],
  pacedEnds: [],
  active: 0,
  maximumActive: 0
};

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing_configuration:${name}`);
  return value;
}

function fingerprint(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function safeLog(event, fields = {}) {
  console.log(JSON.stringify({
    component: "phase8a_live_transport_fixture",
    event,
    ...fields
  }));
}

function response(res, statusCode, body = null) {
  const value = body === null ? "" : JSON.stringify(body);
  res.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(value)
  });
  res.end(value);
}

async function requestBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("request_body_too_large");
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  try {
    return JSON.parse(body.toString("utf8"));
  } finally {
    body.fill(0);
    for (const chunk of chunks) chunk.fill(0);
  }
}

function taskEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("task_envelope_invalid");
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "protocolVersion" ||
    keys[1] !== "taskId" ||
    value.protocolVersion !== PROTOCOL_VERSION ||
    typeof value.taskId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.taskId)
  ) {
    throw new Error("task_envelope_invalid");
  }
  return value;
}

function deliveryMetadata(req) {
  const queueName = req.headers["x-cloudtasks-queuename"];
  const taskName = req.headers["x-cloudtasks-taskname"];
  const retryHeader = req.headers["x-cloudtasks-taskretrycount"];
  const executionHeader = req.headers["x-cloudtasks-taskexecutioncount"];
  const retryCount = Number.parseInt(retryHeader, 10);
  const executionCount = Number.parseInt(executionHeader, 10);
  if (
    queueName !== EXPECTED_QUEUE_NAME ||
    typeof taskName !== "string" ||
    !/^[0-9a-f]{64}$/.test(taskName) ||
    typeof retryHeader !== "string" ||
    typeof executionHeader !== "string" ||
    !Number.isInteger(retryCount) || retryCount < 0 ||
    !Number.isInteger(executionCount) || executionCount < 0
  ) {
    throw new Error("cloud_task_delivery_metadata_invalid");
  }
  return { queueName, taskName, retryCount, executionCount };
}

async function handleTask(req, res, route) {
  const envelope = taskEnvelope(await requestBody(req));
  const delivery = deliveryMetadata(req);
  const taskFingerprint = fingerprint(envelope.taskId);
  const expectedTaskName = taskFingerprint.slice("sha256:".length);
  if (delivery.taskName !== expectedTaskName) {
    throw new Error("cloud_task_name_invalid");
  }
  observations.deliveries += 1;

  if (route === "/retry") {
    observations.retryAttempts.push({
      at: new Date().toISOString(),
      retryCount: delivery.retryCount,
      executionCount: delivery.executionCount
    });
    safeLog("retry_delivery", {
      taskFingerprint,
      retryCount: delivery.retryCount,
      executionCount: delivery.executionCount
    });
    return response(res, delivery.retryCount < 2 ? 503 : 204);
  }

  if (route === "/paced") {
    observations.active += 1;
    observations.maximumActive = Math.max(observations.maximumActive, observations.active);
    observations.pacedStarts.push(new Date().toISOString());
    safeLog("paced_delivery_started", { taskFingerprint, active: observations.active });
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    observations.pacedEnds.push(new Date().toISOString());
    observations.active -= 1;
    safeLog("paced_delivery_completed", { taskFingerprint, active: observations.active });
    return response(res, 204);
  }

  const duplicate = effects.has(taskFingerprint);
  if (duplicate) observations.duplicates += 1;
  else effects.add(taskFingerprint);
  safeLog("task_delivery", {
    taskFingerprint,
    duplicate,
    retryCount: delivery.retryCount,
    executionCount: delivery.executionCount
  });
  if (route === "/duplicate" && !duplicate) return response(res, 503);
  return response(res, 204);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://phase8a.invalid");
    if (req.method === "GET" && url.pathname === "/health") {
      return response(res, 200, {
        status: "ok",
        protocolVersion: PROTOCOL_VERSION,
        fixtureOnly: true
      });
    }
    if (req.method === "GET" && url.pathname === "/metrics") {
      return response(res, 200, {
        ...observations,
        uniqueEffects: effects.size,
        fixtureOnly: true,
        correctnessAuthority: "phase6_supabase_runtime_ledger"
      });
    }
    if (
      req.method === "POST" &&
      ["/task", "/duplicate", "/retry", "/paced"].includes(url.pathname)
    ) {
      return await handleTask(req, res, url.pathname);
    }
    return response(res, 404, { code: "not_found" });
  } catch (error) {
    safeLog("request_rejected", {
      code: error instanceof Error ? error.message : "unknown_error"
    });
    return response(res, 400, { code: "request_rejected" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  safeLog("service_started", { port: PORT });
});
