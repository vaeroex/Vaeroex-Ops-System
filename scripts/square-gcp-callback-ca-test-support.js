/* Public synthetic CA/loopback TLS only. No remote DNS, account or credential. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const tls = require("node:tls");
const { createHash, X509Certificate } = require("node:crypto");
const { execFileSync, spawn } = require("node:child_process");
const hostname = "aws-0-us-west-2.pooler.supabase.com";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function createSyntheticCallbackCa() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "square-callback-public-ca-"));
  fs.chmodSync(root, 0o700);
  const write = (name, value) => fs.writeFileSync(path.join(root, name), value, { mode: 0o600 });
  const openssl = args => execFileSync("openssl", args, { cwd: root, stdio: "ignore", timeout: 10000 });
  const read = name => fs.readFileSync(path.join(root, name));
  const close = () => fs.rmSync(root, { recursive: true, force: true }); // This public synthetic fixture only.
  try {
    write("root.cnf", "[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=PUBLIC SYNTHETIC CA\n[ext]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n");
    for (const name of ["ca", "other"]) openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-config", "root.cnf", "-days", "1", "-keyout", name + ".key", "-out", name + ".pem"]);
    for (const [name, host] of [["leaf", hostname], ["wrong-host", "wrong.synthetic.invalid"]]) {
      write(name + ".cnf", `[req]\nprompt=no\ndistinguished_name=dn\n[dn]\nCN=${host}\n[ext]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${host}\n`);
      openssl(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-config", name + ".cnf", "-keyout", name + ".key", "-out", name + ".csr"]);
      openssl(["x509", "-req", "-in", name + ".csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-days", "1", "-extfile", name + ".cnf", "-extensions", "ext", "-out", name + ".pem"]);
    }
    return { ca: read("ca.pem").toString(), other: read("other.pem").toString(),
      leaf: read("leaf.pem"), key: read("leaf.key"), wrongLeaf: read("wrong-host.pem"), wrongKey: read("wrong-host.key"), close };
  } catch { close(); throw new Error("synthetic_ca_fixture_failed"); }
}

async function qualifyCallbackDatabaseCa() {
  const { checkedPortalConfig } = require("../services/square-sandbox-callback/src/config.ts");
  const { checkedPortalDatabaseCa, runSquareSandboxPortalCommand } = require("../services/square-sandbox-callback/src/server.ts");
  const runtimeModule = require("../services/square-sandbox-callback/src/runtime.ts");
  const { createNativeSquareSandboxPortal } = runtimeModule;
  const { checkedSquareGcpCallbackDatabaseCa, openSquareGcpCallbackDatabase } = require("../lib/integrations/control-plane/square-gcp-callback-database.ts");
  const { SQUARE_REMOTE_SANDBOX: constants } = require("../lib/integrations/control-plane/square-remote-sandbox-contracts.ts");
  const fixture = createSyntheticCallbackCa(), pg = require("pg"), OriginalClient = pg.Client;
  const original = { env: process.env, argv: process.argv, execArgv: process.execArgv, lstat: fs.lstatSync, read: fs.readFileSync,
    network: global.fetch, connect: net.Socket.prototype.connect };
  let assertions = 0;
  const equal = (a, b, label) => { assertions++; assert.deepEqual(a, b, label); };
  const rejects = async run => { assertions++; await assert.rejects(run); };
  const denies = run => { assertions++; assert.throws(run); };
  const caBytes = Buffer.from(fixture.ca), sha = digest(caBytes);
  const binding = { contractVersion: "square_gcp_callback_binding_v1", projectRef: constants.projectRef,
    applicationOrigin: constants.applicationOrigin, environment: "sandbox", applicationId: constants.applicationId, apiVersion: constants.apiVersion,
    gcpProjectId: "vaeroex-square-sandbox", gcpProjectNumber: "123456789012", gcpZone: "us-west1-a", gcpInstanceId: "9876543210987654321", gcpInstanceName: "square-sandbox-callback",
    serviceAccountEmail: "synthetic-broker@vaeroex-square-sandbox.iam.gserviceaccount.com", serviceAccountSubject: "123456789012345678901", identityAudience: constants.applicationOrigin + "/_identity/square-callback",
    operatorId: "11111111-1111-4111-8111-111111111111", workspaceId: "22222222-2222-4222-8222-222222222222", businessEntityId: "33333333-3333-4333-8333-333333333333", operatorRole: "owner", brokerLogin: "square_sandbox_broker",
    approvalExpiresAt: new Date(Date.now() + 3600000).toISOString(), enabled: true, providerCallsEnabled: false, policyVersion: "synthetic_ca_v1", policyFingerprint: "sha256:" + "1".repeat(64),
    kmsKeyResource: "projects/vaeroex-square-sandbox/locations/us-west1/keyRings/synthetic/cryptoKeys/synthetic", appSecretVersionResource: "projects/vaeroex-square-sandbox/secrets/synthetic-app/versions/1", databaseSecretVersionResource: "projects/vaeroex-square-sandbox/secrets/square-sandbox-callback-db/versions/1" };
  const disabled = JSON.parse(fs.readFileSync(path.join(__dirname, "../services/square-sandbox-callback/config.example.json"), "utf8"));
  const config = { ...disabled, enabled: true, binding, supabasePublishableKey: "sb_publishable_synthetic_public", databaseCaPath: "/etc/vaeroex-square-callback/supabase-root-2021.crt", databaseCaSha256: sha };
  try {
    equal(checkedPortalDatabaseCa(caBytes, sha), fixture.ca);
    equal(checkedPortalConfig(config).databaseCaSha256, sha);
    const legacy = { ...disabled };delete legacy.databaseCaPath;delete legacy.databaseCaSha256;
    equal(checkedPortalConfig(legacy).databaseCaPath, null, "disabled old configs remain dormant without CA IO");
    for (const change of [{ databaseCaPath: null }, { databaseCaSha256: null }, { databaseCaPath: "/tmp/other" }, { databaseCaSha256: "bad" }]) denies(() => checkedPortalConfig({ ...config, ...change }));
    denies(() => checkedPortalConfig({ ...disabled, databaseCaPath: config.databaseCaPath, databaseCaSha256: sha }));
    for (const value of [undefined, "", "malformed", "x".repeat(16385), fixture.leaf.toString(), fixture.ca + fixture.ca, fixture.ca + "PRIVATE EXTRA"]) {
      denies(() => checkedSquareGcpCallbackDatabaseCa(value));
      let calls = 0;
      denies(() => createNativeSquareSandboxPortal({ binding, publishableKey: config.supabasePublishableKey, databaseCa: value, network: async () => { calls++;throw new Error(); } }));
      equal(calls, 0, "invalid CA fails before metadata/Secret Manager");
    }
    const x509 = new X509Certificate(fixture.ca);
    denies(() => checkedSquareGcpCallbackDatabaseCa(fixture.ca, Date.parse(x509.validFrom) - 1));
    denies(() => checkedSquareGcpCallbackDatabaseCa(fixture.ca, Date.parse(x509.validTo)));
    denies(() => checkedPortalDatabaseCa(Buffer.from(fixture.other), sha));
    denies(() => checkedPortalDatabaseCa(caBytes, "0".repeat(64)));
    denies(() => checkedPortalDatabaseCa(Buffer.from("malformed"), digest("malformed")));
    denies(() => checkedPortalDatabaseCa(Buffer.alloc(16385), digest(Buffer.alloc(16385))));

    // Actual enabled preflight with intercepted fixed filesystem only; no real
    // host path is opened and any network/secret attempt is a test failure.
    let reads = 0, network = 0, mode = "valid";
    process.argv = [process.execPath, "synthetic-entry", "--preflight", "--config", "/etc/vaeroex-square-callback/config.json"];
    process.execArgv = ["--conditions=react-server"];process.env = {};
    global.fetch = async () => { network++;throw new Error("synthetic_network_forbidden"); };
    fs.lstatSync = filename => {
      if (![process.argv[4], config.databaseCaPath].includes(filename)) throw new Error("unexpected_fixture_path");
      if (filename === config.databaseCaPath && mode === "missing") throw new Error("synthetic_missing_ca");
      return { isFile: () => true, isSymbolicLink: () => mode === "symlink" && filename === config.databaseCaPath,
        uid: mode === "owner" && filename === config.databaseCaPath ? 1 : 0, mode: mode === "writable" && filename === config.databaseCaPath ? 0o666 : 0o644, size: filename === config.databaseCaPath ? caBytes.length : 8192 };
    };
    fs.readFileSync = filename => { reads++;return Buffer.from(filename === config.databaseCaPath ? mode === "digest" ? fixture.other : fixture.ca : JSON.stringify(config)); };
    await runSquareSandboxPortalCommand();equal(reads, 2, "enabled preflight checks explicit CA before serving");
    for (mode of ["missing", "symlink", "owner", "writable", "digest"]) await rejects(runSquareSandboxPortalCommand);
    equal(network, 0, "CA preflight never accesses a secret or network");
    mode = "valid";reads = 0;process.env = { SQUARE_SANDBOX_DATABASE_CA_PEM: fixture.other };
    await rejects(runSquareSandboxPortalCommand);equal(reads, 0, "ambient CA remains rejected before file reads");
    const originalProbe = runtimeModule.checkNativeSquareSandboxPortalBinding, originalWrite = process.stdout.write;
    let probes = 0, probeSignal, output = "";
    try {
      const artifact = Buffer.from("PUBLIC_SYNTHETIC_CALLBACK_ARTIFACT");
      const policy = { schemaVersion: 1, approvedUntil: new Date(Date.now()+300000).toISOString(), operator: "synthetic",
        configurationEvidenceId: "synthetic", budgetDeliveryEvidenceId: "synthetic", nodeVersion: process.version,
        artifactSha256: digest(artifact), hostConfigurationReviewed: true, syntheticPrivacyPassed: true };
      process.env = {};process.argv[2] = "--check-binding";
      fs.lstatSync = filename => {
        if (![process.argv[4], config.databaseCaPath, config.hostPolicyPath, process.argv[1]].includes(filename)) throw new Error("unexpected_probe_file");
        return { isFile: () => true, isSymbolicLink: () => false, uid: 0, mode: 0o644, size: 8192 };
      };
      fs.readFileSync = filename => filename === process.argv[4] ? Buffer.from(JSON.stringify(config)) :
        filename === config.databaseCaPath ? caBytes : filename === config.hostPolicyPath ? Buffer.from(JSON.stringify(policy)) : artifact;
      runtimeModule.checkNativeSquareSandboxPortalBinding = async (input, signal) => {
        probes++;probeSignal = signal;equal(input.databaseCa, fixture.ca);equal(input.binding.providerCallsEnabled, false);
        if (mode === "probe_failure") throw new Error("synthetic_probe_failure");return { checked: true };
      };
      process.stdout.write = bytes => { output += String(bytes);return true; };
      await runSquareSandboxPortalCommand();equal(output, "square_portal_binding_checked\n");equal(probeSignal.aborted, true);
      policy.approvedUntil = new Date(Date.now()-1).toISOString();await rejects(runSquareSandboxPortalCommand);equal(probes, 1, "expired policy stops before DB-secret probe");
      equal(network, 0, "binding command creates no listener or other network path");
    } finally { runtimeModule.checkNativeSquareSandboxPortalBinding = originalProbe;process.stdout.write = originalWrite; }
    fs.lstatSync = original.lstat;fs.readFileSync = original.read;global.fetch = original.network;
    process.argv = original.argv;process.execArgv = original.execArgv;

    const dsn = `postgresql://square_sandbox_broker.oysjpoondtcrqpghhrbd:public-synthetic-not-real@${hostname}:5432/postgres?sslmode=verify-full`;
    let constructions = 0;
    pg.Client = class { constructor() { constructions++;throw new Error("synthetic_constructor"); } };
    await rejects(() => openSquareGcpCallbackDatabase(dsn, undefined));equal(constructions, 0, "missing CA cannot create a pg client");
    pg.Client = OriginalClient;
    // Binding-only runtime uses the established identity/DB-secret interfaces,
    // not application credentials, OAuth, KMS, user Auth or a listener.
    const dbModule = require("../lib/integrations/control-plane/square-gcp-callback-database.ts");
    const mappedDbModule = require("../lib/integrations/control-plane/square-gcp-mapped-database.ts");
    const identities = require("../lib/integrations/control-plane/square-gcp-callback-identity.ts");
    const credentials = require("../lib/integrations/control-plane/square-gcp-callback-credentials.ts");
    const saved = { open: dbModule.openSquareGcpCallbackDatabase, mappedOpen: mappedDbModule.openSquareGcpMappedDatabase, identity: identities.createSquareGcpCallbackIdentity,
      secret: credentials.readSquareGcpCallbackDatabaseSecret, credentials: credentials.createSquareGcpCallbackCredentials };
    try {
      for (const mode of ["success", "identity", "binding", "recheck", "abort"]) {
        let identitiesDisposed = 0, closed = 0, secrets = 0, applications = 0, network = 0, rechecked = 0;
        const controller = new AbortController();
        identities.createSquareGcpCallbackIdentity = () => ({
          verify: async () => { if (mode === "identity") throw new Error("synthetic_identity");if (mode === "abort") controller.abort(); },
          dispose: () => { identitiesDisposed++; }
        });
        credentials.readSquareGcpCallbackDatabaseSecret = async input => { secrets++;input.identity.dispose();return dsn; };
        credentials.createSquareGcpCallbackCredentials = () => { applications++;throw new Error("unexpected_application_credential"); };
        dbModule.openSquareGcpCallbackDatabase = async (value, ca, signal) => {
          equal(value, dsn);equal(ca, fixture.ca);equal(signal, controller.signal);
          return { binding: mode === "binding" ? { ...binding, providerCallsEnabled: true } : binding,
            recheckBinding: async () => { rechecked++;if (mode === "recheck") throw new Error("synthetic_recheck");return binding; },
            close: async () => { closed++; } };
        };
        const run = () => runtimeModule.checkNativeSquareSandboxPortalBinding({ binding, publishableKey: config.supabasePublishableKey,
          databaseCa: fixture.ca, network: async () => { network++;throw new Error("unexpected_network"); } }, controller.signal);
        if (mode === "success") equal(await run(), { checked: true });else await rejects(run);
        equal(closed, 1, "binding probe closes DB on success/failure");equal(identitiesDisposed, 2, "both identities disposed");
        equal(secrets, 1);equal(applications, 0);equal(network, 0);
        equal(rechecked, mode === "success" || mode === "recheck" ? 1 : 0);
      }
      const mappedBinding = { ...binding, contractVersion: "square_gcp_mapped_runtime_binding_v1", capability: "broker",
        enrollerLogin: "square_sandbox_enroller", runtimeLogin: "square_sandbox_runtime",
        connectionId: "44444444-4444-4444-8444-444444444444", connectionGeneration: 4,
        operatorSessionId: "55555555-5555-4555-8555-555555555555", defaultLocationId: "LOC_SYNTHETIC",
        discoveryFingerprint: "sha256:" + "2".repeat(64), mappedProviderCallsEnabled: false,
        mappedApprovalExpiresAt: binding.approvalExpiresAt,
        enrollerDatabaseSecretVersionResource: "projects/vaeroex-square-sandbox/secrets/square-sandbox-enroller-db/versions/1",
        runtimeDatabaseSecretVersionResource: "projects/vaeroex-square-sandbox/secrets/square-sandbox-runtime-db/versions/1" };
      // Exercise the actual CLI dispatcher in isolated children. Native work is
      // replaced only at its exported boundary; failure exits cannot kill this
      // test runner and no listener/network or real credential is available.
      for (const [command, mode, expectedCode, expectedOutput] of [
        ["--confirm-mapping", "valid", 0, "square_mapped_location_confirmed\n"],
        ["--confirm-mapping", "missing_binding", 79, ""], ["--confirm-mapping", "runtime_failure", 78, ""],
        ["--enroll-mapped", "valid", 0, "square_mapped_connection_enrolled\n"],
        ["--enroll-task", "valid", 0, "square_mapped_task_enrolled\n"],
        ["--run-page", "valid", 0, "square_mapped_page_committed\n"],
        ["--run-page", "extra_task_field", 78, ""], ["--run-page", "task_owner", 78, ""],
        ["--enroll-task", "task_symlink", 78, ""], ["--run-page", "unknown_outcome", 78, ""],
        ["--enroll-mapped", "runtime_failure", 78, ""], ["--enroll-mapped", "missing_binding", 79, ""],
        ["--enroll-mapped", "expired_window", 79, ""], ["--enroll-mapped", "bounded_hang", 78, ""]
      ]) {
        const child = `
require(${JSON.stringify(path.join(__dirname, "square-account-browser-test-support.js"))}).loadSquareBrowserModules();
const fs=require('node:fs'),https=require('node:https'),http=require('node:http');
const mapped=require(${JSON.stringify(path.join(__dirname, "../lib/integrations/control-plane/square-gcp-mapped-runtime.ts"))});
const {runSquareSandboxPortalCommand}=require(${JSON.stringify(path.join(__dirname, "../services/square-sandbox-callback/src/server.ts"))});
const mode=${JSON.stringify(mode)},command=${JSON.stringify(command)},config=${JSON.stringify({ ...config, mappedBinding })};
if(mode==='missing_binding')delete config.mappedBinding;
const ca=Buffer.from(${JSON.stringify(fixture.ca)}),artifact=Buffer.from('SYNTHETIC MAPPED CLI');
const policy={schemaVersion:1,approvedUntil:new Date(Date.now()+(mode==='expired_window'?4000:mode==='bounded_hang'?6000:60000)).toISOString(),operator:'synthetic',configurationEvidenceId:'synthetic',budgetDeliveryEvidenceId:'synthetic',nodeVersion:process.version,artifactSha256:require('node:crypto').createHash('sha256').update(artifact).digest('hex'),hostConfigurationReviewed:true,syntheticPrivacyPassed:true};
const task={taskId:'44444444-4444-4444-8444-444444444444',leaseOwnerFingerprint:'sha256:'+'3'.repeat(64)};
if(mode==='extra_task_field')task.extra='forbidden';
process.argv=[process.execPath,'synthetic-mapped-cli',command,'--config','/etc/vaeroex-square-callback/config.json'];process.execArgv=['--conditions=react-server'];
const taskPath='/etc/vaeroex-square-callback/mapped-task.json';let calls=0;
fs.lstatSync=p=>{if(![process.argv[4],config.databaseCaPath,config.hostPolicyPath,process.argv[1],taskPath].includes(p))throw Error('unexpected_path');return {isFile:()=>true,isSymbolicLink:()=>mode==='task_symlink'&&p===taskPath,uid:mode==='task_owner'&&p===taskPath?1:0,mode:420,size:8192};};
fs.readFileSync=p=>p===process.argv[4]?Buffer.from(JSON.stringify(config)):p===config.databaseCaPath?ca:p===config.hostPolicyPath?Buffer.from(JSON.stringify(policy)):p===taskPath?Buffer.from(JSON.stringify(task)):artifact;
global.fetch=async()=>{throw Error('unexpected_network');};https.createServer=http.createServer=()=>{throw Error('unexpected_listener');};
const run=async(input,value,signal)=>{calls++;if(input.binding.connectionGeneration!==4||input.databaseCa!==ca.toString()||signal.aborted)throw Error('wrong_bound_input');if(!['--enroll-mapped','--confirm-mapping'].includes(command)&&JSON.stringify(value)!==JSON.stringify(task))throw Error('wrong_task');if(mode==='runtime_failure')throw Error('SYNTHETIC PRIVATE FAILURE');if(mode==='bounded_hang')return new Promise(()=>{});return {outcome:mode==='unknown_outcome'?'SYNTHETIC PRIVATE FAILURE':'committed'};};
mapped.confirmNativeSquareGcpMappedLocation=(input,signal)=>run(input,null,signal);
mapped.enrollNativeSquareGcpMappedConnection=(input,signal)=>run(input,null,signal);
mapped.enrollNativeSquareGcpMappedTask=run;mapped.runNativeSquareGcpMappedPage=run;
process.env={};runSquareSandboxPortalCommand().then(()=>{if(calls!==1)process.exit(80);}).catch(()=>process.exit(79));
`;
        const result = require("node:child_process").spawnSync(process.execPath, ["-e", child], { encoding: "utf8", timeout: 10000 });
        equal(result.status, expectedCode, command + " " + mode); equal(result.stdout, expectedOutput);
        equal(result.stderr, "", "mapped commands expose no diagnostic/private runtime payload");
      }
      for (const mode of ["valid", "missing", "stale", "recheck", "absent"]) {
        let closed = 0, mappedClosed = 0, mappedOpened = 0, mappedRechecked = 0, applications = 0;
        const controller = new AbortController();
        identities.createSquareGcpCallbackIdentity = () => ({ verify: async () => {}, dispose: () => {} });
        credentials.readSquareGcpCallbackDatabaseSecret = async input => { input.identity.dispose(); return dsn; };
        credentials.createSquareGcpCallbackCredentials = () => { applications++; throw new Error("unexpected_application_credential"); };
        dbModule.openSquareGcpCallbackDatabase = async () => ({ binding, recheckBinding: async () => binding, close: async () => { closed++; } });
        mappedDbModule.openSquareGcpMappedDatabase = async (role, value, ca, signal) => {
          mappedOpened++; equal(role, "broker"); equal(value, dsn); equal(ca, fixture.ca); equal(signal, controller.signal);
          if (mode === "missing") throw new Error("synthetic_missing_mapped_getter");
          return { binding: mode === "stale" ? { ...mappedBinding, connectionGeneration: 3 } : mappedBinding,
            recheckBinding: async () => { mappedRechecked++; if (mode === "recheck") throw new Error("synthetic_mapped_recheck_denied"); return mappedBinding; },
            close: async () => { mappedClosed++; } };
        };
        const run = () => runtimeModule.checkNativeSquareSandboxPortalBinding({ binding,
          ...(mode === "absent" ? {} : { mappedBinding }), publishableKey: config.supabasePublishableKey,
          databaseCa: fixture.ca, network: async () => { throw new Error("unexpected_network"); } }, controller.signal);
        if (mode === "valid" || mode === "absent") equal(await run(), { checked: true }); else await rejects(run);
        equal(closed, 1); equal(mappedOpened, mode === "absent" ? 0 : 1);
        equal(mappedClosed, mode === "absent" || mode === "missing" ? 0 : 1);
        equal(mappedRechecked, mode === "valid" || mode === "recheck" ? 1 : 0);
        equal(applications, 0, "mapping binding probe never constructs application credential capability");
      }
    } finally {
      dbModule.openSquareGcpCallbackDatabase = saved.open;identities.createSquareGcpCallbackIdentity = saved.identity;
      mappedDbModule.openSquareGcpMappedDatabase = saved.mappedOpen;
      credentials.readSquareGcpCallbackDatabaseSecret = saved.secret;credentials.createSquareGcpCallbackCredentials = saved.credentials;
    }
    // Direct DB construction also cannot replace its explicit root from this
    // ambient value; standalone startup rejects the variable altogether.
    process.env = { SQUARE_SANDBOX_DATABASE_CA_PEM: fixture.other };
    // Actual pg SSLRequest/TLS handshakes. Intercept only the exact approved
    // synthetic host connect to owned loopback; pg retains its original hostname
    // for built-in identity verification. No authentication request is sent.
    for (const [name, ca, cert, key, expectedStartup] of [
      ["accepted", fixture.ca, fixture.leaf, fixture.key, 1],
      ["wrong_ca", fixture.other, fixture.leaf, fixture.key, 0],
      ["wrong_hostname", fixture.ca, fixture.wrongLeaf, fixture.wrongKey, 0],
    ]) {
      let startup = 0, acceptedOptions = 0;
      const sockets = new Set(), context = tls.createSecureContext({ cert, key });
      const server = net.createServer(socket => {
        sockets.add(socket);socket.on("close", () => sockets.delete(socket));socket.on("error", () => {});
        socket.once("data", bytes => {
          if (!bytes.equals(Buffer.from([0,0,0,8,4,210,22,47]))) { socket.destroy();return; }
          socket.write("S");
          const secured = new tls.TLSSocket(socket, { isServer: true, secureContext: context });
          sockets.add(secured);secured.on("close", () => sockets.delete(secured));secured.on("error", () => {});
          secured.once("data", () => { startup++;secured.destroy(); });
        });
      });
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      net.Socket.prototype.connect = function(port, host, ...rest) {
        if (port !== 5432 || host !== hostname) throw new Error("nonlocal_test_connection_denied");
        return original.connect.call(this, server.address().port, "127.0.0.1", ...rest);
      };
      pg.Client = class extends OriginalClient {
        constructor(options) {
          equal(options.ssl, { rejectUnauthorized: true, ca }, "explicit CA and unchanged native hostname verification");
          equal(new URL(options.connectionString).search, "", "DSN SSL options cannot overwrite explicit trust");
          acceptedOptions++;super(options);
        }
      };
      try {
        await rejects(() => openSquareGcpCallbackDatabase(dsn, ca)); // Deliberately stop before PostgreSQL authentication.
        equal(acceptedOptions, 1);equal(startup, expectedStartup, name + " actual TLS boundary");
      } finally {
        pg.Client = OriginalClient;net.Socket.prototype.connect = original.connect;
        for (const socket of sockets) socket.destroy();
        await new Promise(resolve => server.close(resolve));
      }
    }
    // Real child process, actual command/policy/timers. The synthetic binding
    // probe reaches finally after completed read-only work, then models the
    // independently reproduced pg.end() half-open-peer wait. No test timer
    // overrides or caller-selected production deadlines are introduced.
    for (const [expiryMs, bound] of [[60000, 30000], [1000, 1000]]) {
      const source = `
require(${JSON.stringify(path.join(__dirname, "square-account-browser-test-support.js"))}).loadSquareBrowserModules();
const fs=require('node:fs'),crypto=require('node:crypto');
const runtime=require(${JSON.stringify(path.join(__dirname, "../services/square-sandbox-callback/src/runtime.ts"))});
const {runSquareSandboxPortalCommand}=require(${JSON.stringify(path.join(__dirname, "../services/square-sandbox-callback/src/server.ts"))});
const config=${JSON.stringify(config)},ca=Buffer.from(${JSON.stringify(fixture.ca)}),artifact=Buffer.from('PUBLIC CHILD ARTIFACT');
const policy={schemaVersion:1,approvedUntil:new Date(Date.now()+${expiryMs}).toISOString(),operator:'synthetic',configurationEvidenceId:'synthetic',budgetDeliveryEvidenceId:'synthetic',nodeVersion:process.version,artifactSha256:crypto.createHash('sha256').update(artifact).digest('hex'),hostConfigurationReviewed:true,syntheticPrivacyPassed:true};
process.argv=[process.execPath,'synthetic-child-entry','--check-binding','--config','/etc/vaeroex-square-callback/config.json'];process.execArgv=['--conditions=react-server'];
fs.lstatSync=p=>{if(![process.argv[4],config.databaseCaPath,config.hostPolicyPath,process.argv[1]].includes(p))throw new Error('denied');return {isFile:()=>true,isSymbolicLink:()=>false,uid:0,mode:420,size:8192};};
fs.readFileSync=p=>p===process.argv[4]?Buffer.from(JSON.stringify(config)):p===config.databaseCaPath?ca:p===config.hostPolicyPath?Buffer.from(JSON.stringify(policy)):artifact;
runtime.checkNativeSquareSandboxPortalBinding=async(_input,signal)=>{
 signal.addEventListener('abort',()=>fs.writeSync(3,'aborted'),{once:true});
 try{return {checked:true};}finally{await new Promise(()=>{});}
};
runSquareSandboxPortalCommand().then(()=>process.exit(79),()=>process.exit(79));
`;
      const started = Date.now();
      const child = spawn(process.execPath, ["-e", source], { env: { PATH: process.env.PATH || "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe", "pipe"] });
      let stdout = "", stderr = "", control = "";
      const collect = setter => bytes => { if (bytes.length > 256) { child.kill("SIGKILL");return; }setter(bytes.toString()); };
      child.stdout.on("data", collect(value => { stdout += value; }));child.stderr.on("data", collect(value => { stderr += value; }));
      child.stdio[3].on("data", collect(value => { control += value; }));
      const watchdog = setTimeout(() => child.kill("SIGKILL"), bound + 10000);
      try {
        const result = await new Promise((resolve, reject) => { child.once("error", reject);child.once("close", (code, signal) => resolve({ code, signal })); });
        equal(result, { code: 78, signal: null }, "stalled cleanup hits real process deadline");
        equal(stdout, "", "no checked-success label on hard termination");equal(stderr, "", "hard termination is silent");equal(control, "aborted", "cooperative abort precedes exit");
        assertions++;assert.ok(Date.now()-started >= bound-100 && Date.now()-started < bound+10000, "finite maximum or approval-expiry bound");
      } finally { clearTimeout(watchdog);if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
    }
    // Actual callback DB close guard + real half-open loopback sockets. Abort
    // starts the first detached close; the runtime's second close returns while
    // that socket still waits for EOF. Only the new command catch is removed in
    // memory for the counterfactual; no repository file or production hook changes.
    const failureExit = `    catch {
      // An abort may already have started a detached close whose idempotent
      // second call returns before pg.end() settles. A rejected read-only probe
      // must terminate its process, not disarm the deadline and retain sockets.
      controller.abort();process.exit(78);
    }
`;
    for (const counterfactual of [false, true]) {
      const source = `
(async()=>{
const fs=require('node:fs'),net=require('node:net'),crypto=require('node:crypto'),{EventEmitter}=require('node:events');
require(${JSON.stringify(path.join(__dirname, "square-account-browser-test-support.js"))}).loadSquareBrowserModules();
const serverPath=${JSON.stringify(path.join(__dirname, "../services/square-sandbox-callback/src/server.ts"))};
const read=fs.readFileSync;
fs.readFileSync=(p,...args)=>{const value=read(p,...args);if(${counterfactual}&&p===serverPath){const fragment=${JSON.stringify(failureExit)};if(typeof value!=='string'||value.split(fragment).length!==2)process.exit(80);return value.replace(fragment,'');}return value;};
const {runSquareSandboxPortalCommand}=require(serverPath);fs.readFileSync=read;
const ids=require(${JSON.stringify(path.join(__dirname, "../lib/integrations/control-plane/square-gcp-callback-identity.ts"))});
const secrets=require(${JSON.stringify(path.join(__dirname, "../lib/integrations/control-plane/square-gcp-callback-credentials.ts"))});
const db=require(${JSON.stringify(path.join(__dirname, "../lib/integrations/control-plane/square-gcp-callback-database.ts"))});
const pg=require('pg'),config=${JSON.stringify(config)},ca=Buffer.from(${JSON.stringify(fixture.ca)}),artifact=Buffer.from('PUBLIC DETACHED CLOSE ARTIFACT');
const peer=net.createServer({allowHalfOpen:true},socket=>{socket.unref();socket.on('error',()=>{});socket.on('end',()=>{});});
await new Promise(resolve=>peer.listen(0,'127.0.0.1',resolve));peer.unref();
pg.Client=class extends EventEmitter {
 async connect(){this.socket=net.createConnection({host:'127.0.0.1',port:peer.address().port});await new Promise((resolve,reject)=>{this.socket.once('connect',resolve);this.socket.once('error',reject);});}
 async query(sql){if(sql!=='select public.get_square_gcp_callback_binding_v1()::text as value')throw new Error('unexpected_synthetic_query');return {rows:[{value:JSON.stringify(config.binding)}]};}
 async end(){fs.writeSync(3,'end_started;');this.socket.end();await new Promise(resolve=>this.socket.once('close',resolve));fs.writeSync(3,'end_resolved;');}
};
ids.createSquareGcpCallbackIdentity=({signal})=>({verify:async()=>{await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));},dispose(){}});
secrets.readSquareGcpCallbackDatabaseSecret=async({identity})=>{identity.dispose();return ${JSON.stringify(dsn)};};
const open=db.openSquareGcpCallbackDatabase;
db.openSquareGcpCallbackDatabase=async(...args)=>{const value=await open(...args);return {...value,close:async()=>{await value.close();fs.writeSync(3,'second_returned;');}};};
const policy={schemaVersion:1,approvedUntil:new Date(Date.now()+2500).toISOString(),operator:'synthetic',configurationEvidenceId:'synthetic',budgetDeliveryEvidenceId:'synthetic',nodeVersion:process.version,artifactSha256:crypto.createHash('sha256').update(artifact).digest('hex'),hostConfigurationReviewed:true,syntheticPrivacyPassed:true};
process.argv=[process.execPath,'synthetic-child-entry','--check-binding','--config','/etc/vaeroex-square-callback/config.json'];process.execArgv=['--conditions=react-server'];
fs.lstatSync=p=>{if(![process.argv[4],config.databaseCaPath,config.hostPolicyPath,process.argv[1]].includes(p))throw new Error('denied');return {isFile:()=>true,isSymbolicLink:()=>false,uid:0,mode:420,size:8192};};
fs.readFileSync=p=>p===process.argv[4]?Buffer.from(JSON.stringify(config)):p===config.databaseCaPath?ca:p===config.hostPolicyPath?Buffer.from(JSON.stringify(policy)):artifact;
await runSquareSandboxPortalCommand().then(()=>process.exit(79),()=>{fs.writeSync(3,'rejected_returned;');process.exitCode=78;});
})().catch(()=>process.exit(79));
`;
      const child = spawn(process.execPath, ["-e", source], { env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe", "pipe"] });
      let stdout = "", stderr = "", control = "", watched = false;
      const collect = setter => bytes => { if (bytes.length>256) {child.kill("SIGKILL");return;}setter(bytes.toString()); };
      child.stdout.on("data",collect(value=>{stdout+=value;}));child.stderr.on("data",collect(value=>{stderr+=value;}));child.stdio[3].on("data",collect(value=>{control+=value;}));
      const watchdog=setTimeout(()=>{watched=true;child.kill("SIGKILL");},5000);
      try {
        const result=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",(code,signal)=>resolve({code,signal}));});
        equal(result,counterfactual?{code:null,signal:"SIGKILL"}:{code:78,signal:null},"detached cleanup correction/counterfactual process result");
        equal(watched,counterfactual,"only original command survives beyond its deadline");equal(stdout,"");equal(stderr,"");
        equal(control,"end_started;second_returned;"+(counterfactual?"rejected_returned;":""),"first close pending when second close returns");
      } finally {clearTimeout(watchdog);if(child.exitCode===null&&child.signalCode===null)child.kill("SIGKILL");}
    }
    return assertions;
  } finally {
    pg.Client = OriginalClient;process.env = original.env;process.argv = original.argv;process.execArgv = original.execArgv;
    fs.lstatSync = original.lstat;fs.readFileSync = original.read;global.fetch = original.network;net.Socket.prototype.connect = original.connect;
    fixture.close();
  }
}
module.exports = { createSyntheticCallbackCa, qualifyCallbackDatabaseCa };
