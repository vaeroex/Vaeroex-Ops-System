import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { promisify } from "node:util";
import {
  buildCandidateManifest,
  evaluateScanOccurrences,
  IMAGE_POLICY,
  listOccurrences,
  parseDigestReference,
  scanEvidenceFingerprint,
  waitForCompletedScan,
  verifyBootstrapSourceContent,
  verifyConsentReleaseContent,
} from "./qualify-image-scans.mjs";
import { POLICY } from "./verify-trigger-context.mjs";

const callbackReference = `${IMAGE_POLICY.callback}@sha256:${"a".repeat(64)}`;
const bootstrapReference = `${IMAGE_POLICY.bootstrap}@sha256:${"b".repeat(64)}`;
const callback = parseDigestReference(callbackReference, IMAGE_POLICY.callback);
const bootstrap = parseDigestReference(bootstrapReference, IMAGE_POLICY.bootstrap);
const integrity = Object.freeze({
  bootstrapFingerprintsVerified: true,
  runtimeDependenciesEmpty: true,
  compressionPathAbsent: true,
});
const consentIntegrity = Object.freeze({
  consentDockerfilePinned: true,
  consentReleasePinned: true,
  debianLibzCallPathAbsent: true,
});

test("fingerprints every executable bootstrap module and keeps compression unreachable", async () => {
  const base = new URL("../bootstrap-runtime/", import.meta.url);
  const [dockerignore, dockerfile, server, callbackBoundary, packageText] = await Promise.all(
    [".dockerignore", "Dockerfile", "server.mjs", "callback-boundary.mjs", "package.json"]
      .map((name) => readFile(new URL(name, base), "utf8")),
  );
  const sources = { dockerignore, dockerfile, server, callbackBoundary, packageText };
  assert.deepEqual(verifyBootstrapSourceContent(sources), integrity);
  for (const [field, reason] of [
    ["dockerignore", /bootstrap_dockerignore_changed/],
    ["dockerfile", /bootstrap_dockerfile_changed/],
    ["server", /bootstrap_server_changed/],
    ["callbackBoundary", /bootstrap_callback_boundary_changed/],
  ]) assert.throws(() => verifyBootstrapSourceContent({ ...sources, [field]: sources[field] + "\n" }), reason);
  assert.throws(() => verifyBootstrapSourceContent({
    ...sources,
    packageText: JSON.stringify({ dependencies: { zlib: "1.0.0" } }),
  }), /bootstrap_runtime_dependencies/);
});
let occurrenceSequence = 0;
const occurrence = (kind, details = {}, resourceUri = callback.resourceUrl) => ({
  name: `projects/vaeroex-integrations-prod/locations/us-west1/occurrences/test-${++occurrenceSequence}`,
  kind,
  resourceUri,
  noteName: `projects/goog-${kind.toLowerCase()}/notes/test`,
  updateTime: "2026-09-14T12:00:00Z",
  ...details,
});
const discovery = (resourceUri = callback.resourceUrl, details = {}) => occurrence("DISCOVERY", {
  noteName: IMAGE_POLICY.vulnerabilityDiscoveryNote,
  discovery: { analysisStatus: "FINISHED_SUCCESS", lastScanTime: "2026-09-14T12:00:00Z" },
  ...details,
}, resourceUri);
const vulnerability = (severity, identifier, resourceUri = callback.resourceUrl) => occurrence("VULNERABILITY", {
  noteName: `projects/goog-vulnz/notes/${identifier}`,
  vulnerability: { effectiveSeverity: severity },
}, resourceUri);
const consentZlibHigh = (resourceUri) => occurrence("VULNERABILITY", {
  noteName: `projects/goog-vulnz/notes/${IMAGE_POLICY.consentException}`,
  vulnerability: {
    effectiveSeverity: "HIGH",
    packageIssue: [{ affectedPackage: "zlib", affectedVersion: { fullName: IMAGE_POLICY.consentZlibPackageVersion } }],
  },
}, resourceUri);

test("consent exception binds the exact pinned base and four-file release, with no native path", async () => {
  const base = new URL("../internal-consent/", import.meta.url);
  const dockerfile = await readFile(new URL("Dockerfile", base), "utf8");
  const release = await mkdtemp(join(tmpdir(), "square-consent-scan-test-"));
  try {
    await promisify(execFile)("pnpm", ["exec", "ncc", "build", new URL("entry.ts", base).pathname,
      "-o", release, "--no-cache", "--transpile-only", "--external", "server-only"]);
    const serverOnly = dirname(createRequire(import.meta.url).resolve("server-only"));
    const files = {};
    for (const name of Object.keys(IMAGE_POLICY.consentReleaseFiles)) {
      files[name] = await readFile(name === "index.js" ? join(release, name) : join(serverOnly, name.split("/").at(-1)));
    }
    assert.deepEqual(verifyConsentReleaseContent({ dockerfile, files }), consentIntegrity);
    assert.throws(() => verifyConsentReleaseContent({ dockerfile: dockerfile + "\n", files }), /consent_base_changed/);
    assert.throws(() => verifyConsentReleaseContent({ dockerfile, files: { ...files, "extra.node": Buffer.alloc(0) } }), /consent_release_files_changed/);
    assert.throws(() => verifyConsentReleaseContent({ dockerfile, files: Object.fromEntries([...Object.entries(files), ["__proto__", Buffer.alloc(0)]]) }), /consent_release_files_changed/);
    assert.throws(() => verifyConsentReleaseContent({ dockerfile, files: { ...files, "index.js": Buffer.concat([files["index.js"], Buffer.from(" ")]) } }), /consent_release_bytes_changed/);
  } finally {
    await rm(release, { recursive: true, force: true });
  }
});

test("accepts only exact immutable image references", () => {
  assert.deepEqual(callback, {
    reference: callbackReference,
    digest: "a".repeat(64),
    resourceUrl: `https://${callbackReference}`,
  });
  for (const bad of [
    `${IMAGE_POLICY.callback}:latest`,
    `${IMAGE_POLICY.callback}@sha256:${"A".repeat(64)}`,
    `${IMAGE_POLICY.bootstrap}@sha256:${"a".repeat(64)}`,
    `${callbackReference}extra`,
  ]) assert.throws(() => parseDigestReference(bad, IMAGE_POLICY.callback), /image_digest_invalid/);
});

test("requires a completed scan and rejects secrets, criticals and callback highs", () => {
  assert.deepEqual(evaluateScanOccurrences("callback", [discovery()], null).severityCounts, {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    MINIMAL: 0,
    SEVERITY_UNSPECIFIED: 0,
  });
  assert.throws(() => evaluateScanOccurrences("callback", [], null), /scan_not_observed/);
  assert.throws(() => evaluateScanOccurrences("callback", [discovery(callback.resourceUrl, { discovery: { analysisStatus: "SCANNING" } })], null), /scan_not_complete/);
  assert.throws(() => evaluateScanOccurrences("callback", [discovery(), occurrence("SECRET")], null), /secret_finding/);
  assert.throws(() => evaluateScanOccurrences("callback", [discovery(), vulnerability("CRITICAL", "CVE-2099-1")], null), /critical_vulnerability/);
  assert.throws(() => evaluateScanOccurrences("callback", [discovery(), vulnerability("HIGH", IMAGE_POLICY.bootstrapException)], null), /high_vulnerability/);
  assert.throws(() => evaluateScanOccurrences("consent", [discovery(), vulnerability("HIGH", IMAGE_POLICY.bootstrapException)], {
    bootstrapFingerprintsVerified: true, runtimeDependenciesEmpty: true, compressionPathAbsent: true
  }), /high_vulnerability/, "internal consent can never borrow the bootstrap compression exception");
  assert.throws(() => evaluateScanOccurrences("consent", [discovery(), occurrence("SECRET")], null), /secret_finding/);
});

test("consent permits only its independently pinned Debian zlib finding", () => {
  const consent = parseDigestReference(`${IMAGE_POLICY.consent}@sha256:${"d".repeat(64)}`, IMAGE_POLICY.consent);
  const completed = discovery(consent.resourceUrl);
  const high = consentZlibHigh(consent.resourceUrl);
  assert.deepEqual(evaluateScanOccurrences("consent", [completed, high], consentIntegrity).acceptedExceptions, [IMAGE_POLICY.consentException]);
  for (const badIntegrity of [null, integrity, {}, { ...consentIntegrity, debianLibzCallPathAbsent: false }]) {
    assert.throws(() => evaluateScanOccurrences("consent", [completed, high], badIntegrity), /high_vulnerability/);
  }
  for (const bad of [
    vulnerability("HIGH", "CVE-2099-2", consent.resourceUrl),
    { ...high, vulnerability: { ...high.vulnerability, packageIssue: [{ affectedPackage: "not-zlib", affectedVersion: { fullName: IMAGE_POLICY.consentZlibPackageVersion } }] } },
    { ...high, vulnerability: { ...high.vulnerability, packageIssue: [{ affectedPackage: "zlib", affectedVersion: { fullName: "changed" } }] } },
  ]) assert.throws(() => evaluateScanOccurrences("consent", [completed, bad], consentIntegrity), /high_vulnerability/);
  assert.throws(() => evaluateScanOccurrences("consent", [completed, high, high], consentIntegrity), /duplicate_vulnerability_exception/);
  assert.throws(() => evaluateScanOccurrences("consent", [completed, high, vulnerability("HIGH", "CVE-2099-4", consent.resourceUrl)], consentIntegrity), /high_vulnerability/);
  assert.throws(() => evaluateScanOccurrences("consent", [completed, high, occurrence("SECRET", {}, consent.resourceUrl)], consentIntegrity), /secret_finding/);
  assert.throws(() => evaluateScanOccurrences("consent", [completed, high, vulnerability("CRITICAL", "CVE-2099-3", consent.resourceUrl)], consentIntegrity), /critical_vulnerability/);
});

test("ignores foreign discovery completion and rejects ambiguous or foreign vulnerability evidence", () => {
  const legacyGlobalDiscovery = occurrence("DISCOVERY", {
    noteName: "projects/goog-analysis/notes/PACKAGE_VULNERABILITY",
    discovery: { analysisStatus: "FINISHED_SUCCESS" },
  });
  const foreignDiscovery = occurrence("DISCOVERY", {
    noteName: "projects/foreign-analysis/notes/PACKAGE_VULNERABILITY",
    discovery: { analysisStatus: "FINISHED_SUCCESS" },
  });
  assert.throws(() => evaluateScanOccurrences("callback", [legacyGlobalDiscovery], null), /scan_discovery_foreign/);
  assert.throws(() => evaluateScanOccurrences("callback", [foreignDiscovery], null), /scan_discovery_foreign/);
  assert.throws(
    () => evaluateScanOccurrences("callback", [discovery(), legacyGlobalDiscovery], null),
    /scan_discovery_foreign/,
  );
  assert.throws(
    () => evaluateScanOccurrences("callback", [discovery(), foreignDiscovery], null),
    /scan_discovery_foreign/,
  );
  assert.throws(
    () => evaluateScanOccurrences("callback", [{
      ...discovery(),
      name: "projects/vaeroex-integrations-prod/locations/us-east1/occurrences/foreign-region",
    }], null),
    /scan_discovery_foreign/,
  );
  assert.throws(() => evaluateScanOccurrences("callback", [discovery(), discovery()], null), /scan_discovery_ambiguous/);
  assert.throws(
    () => evaluateScanOccurrences("callback", [discovery(), occurrence("VULNERABILITY", {
      noteName: "projects/foreign-vulnz/notes/CVE-2099-4",
      vulnerability: { effectiveSeverity: "LOW" },
    })], null),
    /vulnerability_source_invalid/,
  );
});

test("requires a stable completed vulnerability result set and rechecks before qualification", async () => {
  const completed = discovery();
  const low = vulnerability("LOW", "CVE-2099-5");
  const responses = [
    { occurrences: [completed] },
    { occurrences: [completed, low] },
    { occurrences: [completed, low] },
    { occurrences: [completed, low] },
  ];
  let clock = 0;
  let reads = 0;
  const result = await waitForCompletedScan("callback", callback, null, "synthetic-token", async () => {
    reads += 1;
    return new Response(JSON.stringify(responses.shift()), { status: 200 });
  }, {
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
  });
  assert.equal(reads, 4);
  assert.equal(result.stableReadCount, IMAGE_POLICY.requiredStableScanReads);
  assert.equal(result.vulnerabilityCount, 1);
  assert.equal(result.vulnerabilityDiscoveryNote, IMAGE_POLICY.vulnerabilityDiscoveryNote);
  assert.match(result.evidenceFingerprint, /^[a-f0-9]{64}$/);
});

test("fails when a critical finding appears during the post-completion stability reads", async () => {
  const completed = discovery();
  const responses = [
    { occurrences: [completed] },
    { occurrences: [completed, vulnerability("CRITICAL", "CVE-2099-6")] },
  ];
  let clock = 0;
  await assert.rejects(
    waitForCompletedScan("callback", callback, null, "synthetic-token", async () =>
      new Response(JSON.stringify(responses.shift()), { status: 200 }), {
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; },
    }),
    /critical_vulnerability/,
  );
});

test("scan stability fingerprints require immutable occurrence identity and update time", () => {
  const completed = discovery();
  assert.equal(scanEvidenceFingerprint([completed]), scanEvidenceFingerprint([completed]));
  assert.notEqual(
    scanEvidenceFingerprint([completed]),
    scanEvidenceFingerprint([{ ...completed, updateTime: "2026-09-14T12:01:00Z" }]),
  );
  assert.throws(() => scanEvidenceFingerprint([{ ...completed, name: undefined }]), /scan_evidence_identity_invalid/);
  assert.throws(
    () => scanEvidenceFingerprint([{ ...completed, name: completed.name.replace("/locations/us-west1", "") }]),
    /scan_evidence_identity_invalid/,
  );
  assert.throws(
    () => scanEvidenceFingerprint([{ ...completed, name: completed.name.replace("/us-west1/", "/us-east1/") }]),
    /scan_evidence_identity_invalid/,
  );
});

test("permits only the exact reviewed bootstrap high-severity exception", () => {
  const bootstrapDiscovery = discovery(bootstrap.resourceUrl);
  const accepted = vulnerability("HIGH", IMAGE_POLICY.bootstrapException, bootstrap.resourceUrl);
  assert.deepEqual(
    evaluateScanOccurrences("bootstrap", [bootstrapDiscovery, accepted], integrity).acceptedExceptions,
    [IMAGE_POLICY.bootstrapException],
  );
  for (const badIntegrity of [null, {}, { ...integrity, runtimeDependenciesEmpty: false }, { ...integrity, compressionPathAbsent: false }]) {
    assert.throws(() => evaluateScanOccurrences("bootstrap", [bootstrapDiscovery, accepted], badIntegrity), /high_vulnerability/);
  }
  assert.throws(
    () => evaluateScanOccurrences("bootstrap", [bootstrapDiscovery, vulnerability("HIGH", "CVE-2099-2", bootstrap.resourceUrl)], integrity),
    /high_vulnerability/,
  );
  assert.throws(
    () => evaluateScanOccurrences("bootstrap", [bootstrapDiscovery, accepted, accepted], integrity),
    /duplicate_vulnerability_exception/,
  );
});

test("paginates bounded scan evidence and rejects a mismatched resource or unreachable region", async () => {
  const pages = [
    { occurrences: [discovery()], nextPageToken: "next" },
    { occurrences: [vulnerability("LOW", "CVE-2099-3")] },
  ];
  const urls = [];
  const fetched = await listOccurrences(callback.resourceUrl, "synthetic-token", async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify(pages.shift()), { status: 200 });
  });
  assert.equal(fetched.length, 2);
  assert.match(urls[0], /pageSize=100/);
  assert.match(urls[1], /pageToken=next/);

  await assert.rejects(
    listOccurrences(callback.resourceUrl, "synthetic-token", async () => new Response(JSON.stringify({ occurrences: [discovery("https://foreign.invalid/image@sha256:" + "c".repeat(64))] }))),
    /scan_resource_mismatch/,
  );
  await assert.rejects(
    listOccurrences(callback.resourceUrl, "synthetic-token", async () => new Response(JSON.stringify({ occurrences: [], unreachable: ["us-east1"] }))),
    /scan_regions_unreachable/,
  );
});

test("candidate records remain immutable-review inputs and never deployment authority", () => {
  const clean = evaluateScanOccurrences("callback", [discovery()], null);
  const manifest = buildCandidateManifest({
    buildId: "01234567-89ab-cdef-0123-456789abcdef",
    sourceCommit: "c".repeat(40),
    callback,
    bootstrap,
    consent: parseDigestReference(`${IMAGE_POLICY.consent}@sha256:${"d".repeat(64)}`, IMAGE_POLICY.consent),
    callbackScan: clean,
    bootstrapScan: clean,
    consentScan: clean,
  });
  assert.equal(manifest.source.repository, POLICY.repositoryFullName);
  assert.equal(manifest.source.branch, "main");
  assert.equal(manifest.secretAnalysisQualified, false);
  assert.equal(manifest.secretAnalysisRequiredBeforeEligibility, true);
  assert.equal(manifest.deploymentEligible, false);
  assert.equal(manifest.requiresReviewedDigestPin, true);
  assert.equal(manifest.automaticRuntimeRollout, false);
  assert.match(manifest.images.callback, /@sha256:[a-f0-9]{64}$/);
  assert.match(manifest.images.bootstrap, /@sha256:[a-f0-9]{64}$/);
  assert.match(manifest.images.consent, /square-internal-consent@sha256:[a-f0-9]{64}$/);
  assert.throws(() => buildCandidateManifest({ buildId: manifest.build.id, sourceCommit: manifest.source.commit,
    callback, bootstrap, callbackScan: clean, bootstrapScan: clean }), /consent_scan_required/);
});
