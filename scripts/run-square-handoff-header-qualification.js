/* Actual optimized Next wire headers; synthetic responses only, no installed
 * route capabilities, browser consent, credentials, database or provider calls.
 * Optional SQUARE_HEADER_QUALIFICATION_NODE_MODULES selects existing local deps.
 * --browser requires installed Playwright Chromium (or an explicit local
 * SQUARE_QUALIFICATION_BROWSER_EXECUTABLE) and permits only loopback requests.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { createHash } = require("node:crypto");
const vm = require("node:vm");
const handoffPolicy = require("../lib/integrations/control-plane/square-customer-handoff-policy.json");
const verifyBrowser = process.argv.includes("--browser");
assert.ok(process.argv.slice(2).every(argument => argument === "--browser"), "only the explicit --browser option is supported");
const browserOrigin = "http://127.0.0.1:31999";
const browserTarget = browserOrigin + "/__square_synthetic_provider/authorize?marker=%22%3E%3Cscript%3EINERT_BROWSER_CANARY%3C%2Fscript%3E&check=1";

const root = path.resolve(__dirname, "..");
const dependencyRoot = path.resolve(process.env.SQUARE_HEADER_QUALIFICATION_NODE_MODULES || path.join(root, "node_modules"));
const dependencies = createRequire(path.join(dependencyRoot, "square-header-qualification.cjs"));
const nextPackage = dependencies("next/package.json");
assert.equal(nextPackage.version, JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).dependencies.next, "use the repository's pinned Next version");
const nextCli = dependencies.resolve("next/dist/bin/next");
const handoffs = ["connect", "reauthorize", "callback"];
const origin = "https://square-sandbox.vaeroex.com";
const prefix = "/api/integrations/square/";
const syntheticCode = "SQUARE_NON_SECRET_HEADER_CANARY";
const syntheticState = "S".repeat(43);
const denyCsp = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const redirectActions = ["mapping", "disconnect"];
const controls = [
  ...handoffs.map(action => "/api/integrations/qbo/" + action),
  prefix + "status", "/sw.js",
  ...handoffs.flatMap(action => [prefix + action + "-extra", prefix + action + "/nested", "/other" + prefix + action])
];
const caseControls = handoffs.flatMap(action => [prefix + action.toUpperCase(), "/API/integrations/square/" + action, "/api/integrations/Square/" + action]);
let assertions = 0;
let stage = "synthetic_response_setup";
const equal = (actual, expected, label) => { assertions++; assert.deepEqual(actual, expected, label); };
const ok = (value, label) => { assertions++; assert.ok(value, label); };

// Parent configuration is never inherited by build/server children. In
// particular, this list contains no cloud, DB, provider or authentication key.
function environment(enforce) {
  return {
    PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
    NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", CI: "1",
    NEXT_PUBLIC_SUPABASE_URL: "https://square-header-db.synthetic.invalid",
    ...(enforce ? { VAEROEX_ENFORCE_CSP: "true" } : {})
  };
}

async function responses() {
  const { loadSquareBrowserModules } = require("./square-account-browser-test-support.js");
  const modules = loadSquareBrowserModules();
  const { SQUARE_REMOTE_SANDBOX } = require("../lib/integrations/control-plane/square-remote-sandbox-contracts.ts");
  const { SQUARE_OAUTH_SCOPES } = require("../lib/integrations/providers/square/account-connection-oauth.ts");
  const actor = { actorId: "11111111-1111-4111-8111-111111111111", workspaceId: "22222222-2222-4222-8222-222222222222", sessionId: "33333333-3333-4333-8333-333333333333", role: "owner" };
  const businessEntityId = "44444444-4444-4444-8444-444444444444";
  const connectionId = "55555555-5555-4555-8555-555555555555";
  let calls = 0;
  const authorization = new URL(SQUARE_REMOTE_SANDBOX.providerOrigin + "/oauth2/authorize");
  for (const [key, value] of Object.entries({ client_id: SQUARE_REMOTE_SANDBOX.applicationId, redirect_uri: origin + prefix + "callback", scope: SQUARE_OAUTH_SCOPES.join(" "), state: syntheticState, session: "false" })) authorization.searchParams.set(key, value);
  const service = {
    async initiate() { calls++; return { authorizationUrl: authorization.toString() }; },
    async complete() { calls++; },
    async snapshot() { throw new Error("synthetic_unused_snapshot"); },
    async confirmMapping() { calls++; },
    async disconnect() { calls++; }
  };
  const create = enabled => modules.createSquareRemoteSandboxCustomerHandlers({
    enabled: async () => enabled,
    authenticate: async () => { calls++; return actor; }, service,
    notify: async () => { throw new Error("synthetic_unused_webhook"); }
  });
  const open = create(true), closed = create(false);
  const snapshot = async response => ({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  const output = { open: {}, closed: {}, failed: {}, redirects: {} };
  const hash = createHash("sha256").update(handoffPolicy.script).digest("base64");
  equal(handoffPolicy.csp, `default-src 'none'; script-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, "shared script/hash drift guard");
  for (const action of handoffs) {
    const request = () => action === "callback"
      ? new Request(origin + prefix + action + "?" + new URLSearchParams({code:syntheticCode,state:syntheticState}))
      : new Request(origin + prefix + action, {method:"POST",headers:{origin,"content-type":"application/x-www-form-urlencoded","sec-fetch-site":"same-origin"},body:new URLSearchParams({businessEntityId,...(action === "reauthorize" ? {connectionId} : {})})});
    output.open[action] = await snapshot(await open.handle(action, request()));
    equal(output.open[action].status, 200, "actual handoff produced by synthetic injected service");
    const html = output.open[action].body;
    equal([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]), [handoffPolicy.script], "one constant script, with no interpolated input");
    const decode = value => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const attributes = /<p id="square-handoff" data-target="([^"]*)" data-clean-path="([^"]*)">/.exec(html);
    ok(attributes, "navigation is confined to quoted inert attributes");
    const target = action === "callback" ? modules.SQUARE_CUSTOMER_SETTINGS_PATH : authorization.toString();
    const cleanPath = action === "callback" ? modules.SQUARE_CUSTOMER_CALLBACK_PATH : modules.SQUARE_CUSTOMER_SETTINGS_PATH;
    equal(decode(attributes[1]), target, "escaped target round-trips exactly to the validated navigation");
    equal(decode(attributes[2]), cleanPath, "clean path is fixed, never derived from callback query input");
    if (action !== "callback") ok(attributes[1].includes("&amp;"), "authorization URL separators are attribute-escaped");
    const navigation = [];
    vm.runInNewContext(handoffPolicy.script, {
      document: { getElementById: id => { equal(id, "square-handoff", "script reads only its fixed data element"); return {dataset:{target:decode(attributes[1]),cleanPath:decode(attributes[2])}}; } },
      history: { replaceState: (...args) => navigation.push(["history", ...args]) },
      location: { replace: (...args) => navigation.push(["location", ...args]) }
    }, { timeout: 1000 });
    equal(navigation, [["history",null,"",cleanPath],["location",target]], "constant script retains the exact clean-path then navigation behavior; not a browser history guarantee");
    const before = calls;
    output.closed[action] = await snapshot(await closed.handle(action, request()));
    equal(calls, before, "closed handlers authenticate and invoke no service");
    equal(output.closed[action].status, 404, "closed gate remains 404");
    equal(output.closed[action].headers["content-security-policy"], denyCsp, "closed response owns deny-all CSP");
    const wrongMethod = new Request(origin + prefix + action, {method:action === "callback" ? "POST" : "GET"});
    output.failed[action] = await snapshot(await open.handle(action, wrongMethod));
    equal(output.failed[action].status, 400, "wrong method stays denied");
  }
  for (const action of redirectActions) {
    const body = new URLSearchParams(action === "mapping"
      ? { connectionId, businessEntityId, locationIds: "SYNTHETIC_LOCATION", confirmation: "map" }
      : { connectionId, confirmation: "disconnect" });
    output.redirects[action] = await snapshot(await open.handle(action, new Request(origin + prefix + action, {
      method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "same-origin" }, body
    })));
    equal(output.redirects[action].status, 303, "legitimate synthetic mutation preserves fixed redirect");
    equal(output.redirects[action].headers.location, modules.SQUARE_CUSTOMER_SETTINGS_PATH, "redirect target remains fixed and query-free");
  }
  output.control = await snapshot(modules.squareCustomerConnectionsUnavailableResponse());
  if (verifyBrowser) {
    // This factory installs nothing: only its synthetic response is copied into
    // the static fixture, with an explicitly loopback-only provider destination.
    const local = modules.createSquareCustomerHandlers({ qualification: "disposable_local_synthetic_only", applicationOrigin: browserOrigin,
      authenticate: async () => actor, service, resolveAuthorizationNavigation: () => browserTarget });
    output.browser = {}; output.browserDenied = {};
    for (const action of handoffs) {
      const incoming = action === "callback"
        ? new Request(browserOrigin + prefix + action + "?" + new URLSearchParams({code:syntheticCode,state:syntheticState}))
        : new Request(browserOrigin + prefix + action, {method:"POST",headers:{origin:browserOrigin,"content-type":"application/x-www-form-urlencoded","sec-fetch-site":"same-origin"},body:new URLSearchParams({businessEntityId,...(action === "reauthorize" ? {connectionId} : {})})});
      output.browser[action] = await snapshot(await local.handle(action, incoming));
      equal(output.browser[action].status, 200, "browser uses a real locally qualified handoff with only loopback targets");
      output.browserDenied[action] = {...output.browser[action],body:output.browser[action].body.replace(handoffPolicy.script, 'document.body.dataset.untrusted="INERT_SCRIPT_CANARY";')};
    }
  }
  return output;
}

async function browserChecks(url) {
  stage = "synthetic_browser_launch";
  const { chromium } = dependencies("playwright");
  const executablePath = process.env.SQUARE_QUALIFICATION_BROWSER_EXECUTABLE;
  if (executablePath) ok(path.isAbsolute(executablePath), "browser executable override is an explicit local absolute path");
  const browser = await chromium.launch({ headless:true, ...(executablePath ? {executablePath} : {}), env:environment(false) });
  try {
    for (const action of handoffs) {
      stage = "synthetic_browser_" + action;
      const context = await browser.newContext({serviceWorkers:"block"});
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        const entry = url + prefix + action + "?" + new URLSearchParams({mode:"browser",code:syntheticCode});
        const target = action === "callback" ? url + "/app/settings/integrations/square" : browserTarget;
        let resolveNavigation, rejectDeadline;
        const navigation = new Promise(resolve => {resolveNavigation=resolve;});
        const timedOut = new Promise((resolve,reject) => {rejectDeadline=reject;});
        const deadline = setTimeout(() => rejectDeadline(new Error("synthetic_browser_handoff_timeout")), 5000);
        let resolveDocument;
        const documentEvidence = new Promise(resolve => {resolveDocument=resolve;});
        const observation = Promise.race([Promise.all([navigation,documentEvidence]),timedOut]);
        void observation.catch(() => undefined);
        await page.exposeFunction("__observeSquareHandoff", value => resolveDocument(value));
        await page.addInitScript(() => {
          const replaceState = history.replaceState;
          history.replaceState = function(...args) {
            const result = replaceState.apply(this, args);
            const element = document.getElementById("square-handoff");
            if (element) window.__observeSquareHandoff({target:element.dataset.target,cleanPath:element.dataset.cleanPath,script:document.querySelector("script").textContent,pathname:location.pathname,search:location.search});
            return result;
          };
        });
        let unexpected = 0;
        await context.route("**/*", async route => {
          const request = route.request();
          if (request.url() === entry) return route.continue();
          // No destination request is sent, including the owned synthetic target.
          if (request.isNavigationRequest() && request.url() === target) {
            resolveNavigation({referrer:request.headers().referer});
          } else unexpected++;
          return route.abort();
        });
        try {
          await page.goto(entry, {waitUntil:"commit"}).catch(() => undefined);
          const [observedNavigation, evidence] = await observation;
          equal(evidence.target, action === "callback" ? "/app/settings/integrations/square" : browserTarget, "real DOM decodes only the server-validated inert target");
          equal(evidence.cleanPath, action === "callback" ? prefix + action : "/app/settings/integrations/square", "real DOM decodes the fixed clean path");
          equal(evidence.script, handoffPolicy.script, "actual browser executes only the hash-authorized constant");
          equal(evidence.pathname, evidence.cleanPath, "actual browser performs existing replaceState before navigation; not a global-history guarantee");
          equal(evidence.search, "", "existing script removes query from active document before navigation");
          equal(observedNavigation.referrer, undefined, "actual outgoing synthetic navigation sends no Referer");
          equal(unexpected, 0, "browser attempts no unrelated request");
        } finally {clearTimeout(deadline);}
      } finally {await context.close();}
    }
    const context = await browser.newContext({serviceWorkers:"block"});
    stage = "synthetic_browser_hash_negative_control";
    try {
      const page = await context.newPage();
      const entry = url + prefix + "callback?mode=browserDenied";
      await context.route("**/*", route => route.request().url() === entry ? route.continue() : route.abort());
      await page.addInitScript(() => { window.__squareHashBlocked = false; document.addEventListener("securitypolicyviolation", () => {window.__squareHashBlocked=true;}); });
      await page.goto(entry);
      await page.waitForFunction(() => window.__squareHashBlocked === true, undefined, {timeout:5000});
      equal(await page.evaluate(() => document.body.dataset.untrusted), undefined, "real browser blocks altered executable bytes under the fixed hash policy");
    } finally {await context.close();}
  } finally {await browser.close();}
  console.log("Square handoff headers: isolated Chromium DOM, navigation, referrer and hash-negative-control checks passed.");
}

async function port() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const selected = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return selected;
}

function processRun(args, directory, env) {
  const child = spawn(process.execPath, [nextCli, ...args], { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { output = (output + data.toString()).slice(-65536); });
  const finished = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => resolve(code));
  });
  return { child, finished, output: () => output };
}

async function stop(running) {
  if (running.child.exitCode !== null || running.child.signalCode !== null) return;
  running.child.kill("SIGTERM");
  const force = setTimeout(() => running.child.kill("SIGKILL"), 5000);
  try { await running.finished; } finally { clearTimeout(force); }
}

async function qualify(directory, fixtures, variant, enforce) {
  stage = "synthetic_" + variant + (enforce ? "_enforced" : "_report_only");
  const env = environment(enforce);
  const moduleUrl = pathToFileURL(path.join(root, "next.config.mjs")).href;
  const mutation = variant === "legacy" ? "return [{source:'/:path*',headers:rules[0].headers},...rules.filter(rule=>rule.source==='/sw.js')];"
    : variant === "excluded" ? "return [{source:'/:path((?!api/integrations/square/(?:connect|reauthorize|callback)$).*)',headers:rules[0].headers},{source:'/api/integrations/square/:handoff(connect|reauthorize|callback)',headers:rules[1].headers.filter(header=>!['Content-Security-Policy','Content-Security-Policy-Report-Only'].includes(header.key))},...rules.filter(rule=>rule.source==='/sw.js')];"
    : "return rules;";
  fs.writeFileSync(path.join(directory, "next.config.mjs"), `import baseline from ${JSON.stringify(moduleUrl)};\nexport default {...baseline,generateBuildId:async()=> 'square-synthetic-header-qualification',typedRoutes:false,outputFileTracingRoot:${JSON.stringify(directory)},outputFileTracingIncludes:{},async headers(){const rules=await baseline.headers();${mutation}}};\n`);
  const build = processRun(["build"], directory, env);
  const deadline = setTimeout(() => { build.child.kill("SIGKILL"); }, 120000);
  let exit;
  try { exit = await build.finished; } finally { clearTimeout(deadline); }
  equal(exit, 0, "isolated optimized Next build succeeds");
  const selected = await port();
  const server = processRun(["start", "-H", "127.0.0.1", "-p", String(selected)], directory, env);
  const url = "http://127.0.0.1:" + selected;
  try {
    const readyUntil = Date.now() + 15000;
    while (!server.output().includes("Ready in")) {
      if (server.child.exitCode !== null || Date.now() >= readyUntil) throw new Error("synthetic_next_start_failed");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const read = async (pathname, mode = "open", method = "GET") => {
      const response = await fetch(url + pathname + "?" + new URLSearchParams({mode,code:syntheticCode}), {method,redirect:"manual",signal:AbortSignal.timeout(5000)});
      return {status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()};
    };
    const neighbors = {};
    for (const pathname of controls) {
      const result = await read(pathname);
      equal(result.status, 404, "neighbor/control remains closed");
      neighbors[pathname] = Object.fromEntries(Object.entries(result.headers).filter(([key]) => !["date", "connection", "keep-alive", "transfer-encoding"].includes(key)));
    }
    for (const pathname of caseControls) {
      const actual = await read(pathname);
      equal(actual.status, 404, "case variant is truly not an installed route");
      ok(actual.body.includes("This page could not be found"), "case variant is Next's real not-found response, not a Square fixture response");
      if (variant === "excluded") {
        equal(actual.headers["content-security-policy"], undefined, "prior header exclusion's case-insensitive 404 gap is reproduced");
      } else if (variant === "corrected") {
        equal(actual.headers["content-security-policy"], handoffPolicy.csp, "real case-variant 404 retains strict fixed CSP");
        equal(actual.headers["content-security-policy-report-only"], handoffPolicy.csp, "case-variant 404 has the matching non-reporting policy");
        equal(actual.headers["referrer-policy"], "no-referrer", "case-variant 404 retains no-referrer");
      } else ok(Boolean(actual.headers["content-security-policy"]), "original global policy protected real not-found paths");
    }
    for (const action of redirectActions) {
      const actual = await read(prefix + action, "redirects", "POST");
      const expected = fixtures.redirects[action];
      equal(actual.status, 303, "legitimate redirect status survives on the wire");
      equal(actual.body, expected.body, "redirect remains body-free");
      equal(actual.headers.location, expected.headers.location, "redirect location remains exact and query-free");
      neighbors[prefix + action] = Object.fromEntries(Object.entries(actual.headers).filter(([key]) => !["date", "connection", "keep-alive", "transfer-encoding"].includes(key)));
    }
    for (const action of handoffs) {
      for (const mode of ["open", "closed", "failed"]) {
        const actual = await read(prefix + action, mode, action === "callback" ? "GET" : "POST");
        const expected = fixtures[mode][action];
        equal(actual.status, expected.status, "headers do not change response status");
        equal(actual.body, expected.body, "wire body remains exact actual handler response");
        ok(!actual.body.includes(syntheticCode), "invented callback code is never reflected");
        equal(actual.headers["cache-control"], "no-store, max-age=0", "handoff/error is not cacheable");
        if (variant === "legacy") {
          equal(actual.headers["referrer-policy"], "strict-origin-when-cross-origin", "old global rule reproduces referrer override failure");
          ok(actual.headers["content-security-policy"] !== expected.headers["content-security-policy"], "old global CSP overrides actual hash/deny-all CSP");
          equal(Boolean(actual.headers["content-security-policy-report-only"]), !enforce, "old global report-only presence matches configuration");
        } else if (variant === "corrected") {
          equal(actual.headers["referrer-policy"], "no-referrer", "actual handoff referrer policy survives Next merge");
          equal(actual.headers["content-security-policy"], handoffPolicy.csp, "exact fixed script-hash CSP survives Next merge");
          equal(actual.headers["content-security-policy-report-only"], handoffPolicy.csp, "matching report-only policy cannot interfere and has no reporting destination");
          if (mode === "open") {
            const script = /<script>([\s\S]*?)<\/script>/.exec(actual.body)?.[1];
            equal(script, handoffPolicy.script, "wire script is the exact hash-authorized constant");
            ok(!actual.headers["content-security-policy"].includes("'unsafe-inline'"), "handoff retains hash-only script authorization");
            ok(actual.body.includes("history.replaceState(null,\"\","), "existing handoff cleanup script remains intact; this does not prove history erasure");
            ok(actual.body.includes("location.replace("), "existing handoff navigation remains intact");
          }
        }
      }
    }
    if (verifyBrowser && variant === "corrected" && enforce) await browserChecks(url);
    return neighbors;
  } finally { await stop(server); }
}

async function main() {
  const fixtures = await responses();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vaeroex-square-handoff-headers-"));
  fs.mkdirSync(path.join(directory, "app"), {recursive:true});
  fs.symlinkSync(dependencyRoot, path.join(directory, "node_modules"), "dir");
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({name:"square-synthetic-header-qualification",private:true}));
  fs.writeFileSync(path.join(directory, "responses.json"), JSON.stringify(fixtures));
  fs.writeFileSync(path.join(directory, "app", "layout.js"), "export default function Layout({children}){return <html><body>{children}</body></html>;}\n");
  fs.writeFileSync(path.join(directory, "app", "page.js"), "export default function Page(){return <main>Synthetic header qualification only.</main>;}\n");
  // Exact static routes are essential: a catch-all would hide Next's case-sensitive
  // route / case-insensitive custom-header mismatch behind our private response.
  for (const pathname of [...handoffs, ...redirectActions, "status"].map(action => prefix + action).concat("/sw.js")) {
    const routeDirectory = path.join(directory, "app", pathname.slice(1));
    fs.mkdirSync(routeDirectory, {recursive:true});
    const relative = path.relative(routeDirectory, path.join(directory, "responses.json")).split(path.sep).join("/");
    const action = pathname.split("/").at(-1);
    const selector = [...handoffs, ...redirectActions].includes(action) ? `fixtures[url.searchParams.get('mode')||'open'][${JSON.stringify(action)}]` : "fixtures.control";
    fs.writeFileSync(path.join(routeDirectory, "route.js"), `import fixtures from ${JSON.stringify(relative)};\nexport const runtime='nodejs';export const dynamic='force-dynamic';\nfunction respond(request){const url=new URL(request.url);const selected=${selector};return new Response(selected.body,{status:selected.status,headers:selected.headers});}\nexport const GET=respond;export const POST=respond;\n`);
  }
  const legacy = await qualify(directory, fixtures, "legacy", false);
  console.log("Square handoff headers: original optimized-build failure reproduced.");
  await qualify(directory, fixtures, "excluded", false);
  console.log("Square handoff headers: prior exclusion's real not-found case-variant CSP gap reproduced.");
  const corrected = await qualify(directory, fixtures, "corrected", false);
  equal(corrected, legacy, "all selected non-Square, QBO and neighboring effective headers remain byte-equal");
  console.log("Square handoff headers: corrected report-only-mode wire checks passed.");
  const enforcedLegacy = await qualify(directory, fixtures, "legacy", true);
  const enforcedCorrected = await qualify(directory, fixtures, "corrected", true);
  equal(enforcedCorrected, enforcedLegacy, "non-Square and neighboring effective headers also remain byte-equal with enforced CSP");
  console.log(`Square handoff header qualification passed: ${assertions} assertions, Next ${nextPackage.version}; synthetic optimized builds only.`);
  // Keep the explicitly owned synthetic fixture recoverable for inspection.
  console.log("Synthetic fixture retained: " + directory);
}

main().catch(error => { console.error("Square handoff header qualification failed (" + stage + "): " + (error instanceof assert.AssertionError ? error.message : "synthetic_qualification_error")); process.exitCode = 1; });
