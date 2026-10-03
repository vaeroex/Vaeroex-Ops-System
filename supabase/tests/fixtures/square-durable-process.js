/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node qualification child, not application code. */
// Launched only by the verified disposable harness, with configuration over IPC.
const { Client } = require("pg");
process.once("message", async message => {
  let client;
  try {
    if (!/^square_qualification_[a-z0-9_]+$/.test(message.connection.database) ||
        !(message.connection.host.startsWith("/private/tmp/square-qualification-") || message.connection.host.startsWith("/tmp/square-qualification-") || message.connection.host === "127.0.0.1")) throw new Error("target_denied");
    client = new Client({ ...message.connection, ssl: false, statement_timeout: 15000 });
    client.on("error", () => {});
    await client.connect();
    await client.query("begin");
    await client.query("select public.commit_square_ingestion_page_v1($1,$2,$3::jsonb)", message.args);
    if (message.commit) await client.query("commit");
    process.send({ ready: true, committed: Boolean(message.commit) });
    // Parent kills this real process after observing the explicit transaction barrier.
  } catch (error) {
    process.send({ failed: true, code: /^[A-Z0-9]{5}$/.test(error.code) ? error.code : "test_failure" });
    await client?.end().catch(() => {});
    process.exitCode = 1;
  }
});
setTimeout(() => process.exit(2), 20000).unref();
