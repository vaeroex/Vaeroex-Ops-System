/* eslint-disable @typescript-eslint/no-require-imports -- Runs only the disabled bundle on loopback. */
const assert = require("node:assert/strict");
const path = require("node:path");
const net = require("node:net");
const http = require("node:http");
const { spawn } = require("node:child_process");

if (process.argv[2] === "--child") {
  const Module = require("node:module");
  const original = Module._load;
  Module._load = function(name, ...rest) {
    if (/\.index\.js$/.test(name) || /^(pg|https|node:https|tls|node:tls|dns|node:dns|child_process|node:child_process)$/.test(name)) {
      throw new Error("bootstrap_operational_dependency_loaded");
    }
    return original.call(this, name, ...rest);
  };
  net.Socket.prototype.connect = () => { throw new Error("bootstrap_outbound_denied"); };
  global.fetch = () => { throw new Error("bootstrap_outbound_denied"); };
  http.request = () => { throw new Error("bootstrap_outbound_denied"); };
  http.get = () => { throw new Error("bootstrap_outbound_denied"); };
  require(path.resolve(__dirname, "../services/external-integrations-qbo/dist/index.js"));
} else {
  (async () => {
    const reserve = net.createServer();
    await new Promise(resolve => reserve.listen(0, "127.0.0.1", resolve));
    const port = reserve.address().port;
    await new Promise(resolve => reserve.close(resolve));
    const child = spawn(process.execPath, [__filename, "--child"], {
      env: { PATH: process.env.PATH, PORT: String(port), QBO_SERVICE_MODE: "oauth_ingress",
        QBO_INGRESS_BOOTSTRAP_ONLY: "true", QBO_SOURCE_COMMIT: "c1b1982efbf5956ee6053edaefbbed3728eb08c2" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", value => { output += value; });
    child.stderr.on("data", value => { output += value; });
    const exit = new Promise(resolve => child.once("exit", resolve));
    const request = (method, target, body) => new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: target, method, timeout: 2000,
        headers: { "intuit-signature": "synthetic-do-not-log", "x-vaeroex-oauth-code": "synthetic-do-not-log" } }, response => {
        let value = "";
        response.on("data", chunk => { value += chunk; });
        response.on("end", () => resolve({ status: response.statusCode, body: value }));
      });
      req.on("error", reject);
      req.on("timeout", () => req.destroy(Error("timeout")));
      req.end(body);
    });
    try {
      let healthy = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        if (child.exitCode !== null) throw Error("bootstrap exited: " + output);
        try {
          const result = await request("GET", "/health");
          assert.equal(result.status, 200);
          assert.equal(JSON.parse(result.body).readyForProviderProcessing, false);
          healthy = true;
          break;
        } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
      }
      assert.ok(healthy, "bootstrap liveness");
      for (const [method, target, body] of [
        ["GET", "/oauth/callback?code=synthetic-do-not-log&state=synthetic-do-not-log&realmId=synthetic-do-not-log"],
        ["POST", "/webhooks/qbo", '{"secret":"synthetic-do-not-log"}'],
        ["POST", "/tasks/execute", "synthetic-do-not-log"],
        ["POST", "/oauth/complete", "synthetic-do-not-log"]
      ]) {
        const result = await request(method, target, body);
        assert.equal(result.status, 503);
        assert.equal(result.body, '{"error":"qbo_production_processing_disabled"}');
      }
      assert.equal(output, "", "no request material or errors logged");
      console.log("QBO bootstrap bundle smoke: 12 assertions passed; 4 disabled routes; operational chunks and outbound access forbidden.");
    } finally {
      child.kill("SIGTERM");
      await exit;
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
