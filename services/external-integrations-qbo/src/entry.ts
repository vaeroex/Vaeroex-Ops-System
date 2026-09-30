import { startDisabledQboIngress } from "./ingress-bootstrap";

// Select the non-operational path before importing any credential/database code.
async function start() {
  const bootstrap = process.env.QBO_INGRESS_BOOTSTRAP_ONLY;
  if (bootstrap === "true") {
    startDisabledQboIngress(process.env);
    return;
  }
  if (bootstrap !== undefined && bootstrap !== "false") {
    throw new Error("qbo_bootstrap_configuration_invalid");
  }
  await import("./server");
}

void start().catch(() => {
  process.stderr.write("qbo_runtime_startup_failed\n");
  process.exitCode = 1;
});
