import http from "node:http";
import { sandboxMaintenance as pin } from "./sandbox-profile.mjs";

const denied = () => new Error("maintenance_identity_denied");
// Native GCE metadata trust boundary: only this dedicated, privately administered
// instance may host the provisioner. No key file, user ADC, Owner PAT, inherited
// runtime identity or arbitrary metadata path fallback. This SA is distinct from
// the callback reader and must be provisioned/attached explicitly before use.
export function createGceMaintenanceIdentity({ request = http.request } = {}) {
  if (typeof request !== "function") throw denied();
  let verified = false, active = false;
  async function get(path, maximum = 4096) {
    return new Promise((resolve, reject) => {
      let req, res, done = false, used = 0, timer;
      const chunks = [];
      const clear = () => { clearTimeout(timer); for (const b of chunks) b.fill(0); chunks.length = 0; };
      const fail = () => { if (done) return; done = true; clear(); res?.destroy(); req?.destroy(); reject(denied()); };
      try {
        req = request({ hostname: "169.254.169.254", port: 80, method: "GET", agent: false,
          path: `/computeMetadata/v1/${path}`, headers: { "Metadata-Flavor": "Google" } }, response => {
          res = response;
          if (res.statusCode !== 200 || res.headers["metadata-flavor"] !== "Google") { fail(); return; }
          res.on("error", fail); res.on("aborted", fail);
          res.on("data", bytes => {
            if (done) { bytes.fill(0); return; }
            used += bytes.length;
            if (used > maximum || chunks.length >= 64) { bytes.fill(0); fail(); return; }
            chunks.push(bytes);
          });
          res.on("end", () => { if (done) return; done = true; const bytes = Buffer.concat(chunks); clear(); resolve(bytes); });
        });
        req.on("error", fail); timer = setTimeout(fail, 3000); req.end();
      } catch { fail(); }
    });
  }
  async function verify() {
    const checks = [["project/project-id", pin.projectId], ["project/numeric-project-id", pin.projectNumber],
      ["instance/id", pin.instanceId], ["instance/zone", `projects/${pin.projectNumber}/zones/${pin.zone}`],
      ["instance/service-accounts/default/email", pin.serviceAccount]];
    verified = false;
    for (const [path, expected] of checks) {
      const bytes = await get(path);
      try { if (!bytes.equals(Buffer.from(expected))) throw denied(); }
      finally { bytes.fill(0); }
    }
    verified = true;
    return Object.freeze({ ack: true });
  }
  return Object.freeze({ verify, async withAccessToken(consume) {
    if (!verified || active || typeof consume !== "function") throw denied();
    active = true;
    let bytes, token;
    try {
      // Recheck the attached identity; a prior native host inspection is not a
      // permanent authorization for a different service account.
      await verify();
      bytes = await get(`instance/service-accounts/${pin.serviceAccount}/token`, 16384);
      const value = JSON.parse(bytes.toString("utf8"));
      if (value?.token_type !== "Bearer" || typeof value.access_token !== "string" ||
          value.access_token.length < 16 || value.access_token.length > 8192 ||
          !/^[\x21-\x7e]+$/.test(value.access_token) || !Number.isInteger(value.expires_in) || value.expires_in < 60) throw denied();
      token = Buffer.from(value.access_token, "ascii");
      value.access_token = undefined;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(denied()), 10000);
        Promise.resolve().then(() => consume(token)).then(resolve, () => reject(denied())).finally(() => clearTimeout(timer));
      });
      return Object.freeze({ ack: true });
    } catch { throw denied(); }
    finally { token?.fill(0); bytes?.fill(0); active = false; }
  } });
}
