import { createHash } from "node:crypto";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { fetchBoundedJson, getMetadataAccessToken, POLICY } from "./verify-trigger-context.mjs";

const IMAGE_POLICY = Object.freeze({
  callback: "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/square-callback-edge",
  bootstrap: "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/production-bootstrap",
  consent: "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/square-internal-consent",
  buildBucket: "vaeroex-integrations-prod-build",
  bootstrapException: "CVE-2026-85091",
  consentException: "CVE-2026-85091",
  consentZlibPackageVersion: "1:1.3.dfsg+really1.3.1-1",
  originLoaderCves: Object.freeze(["CVE-2026-86805", "CVE-2026-95818"]),
  originLoaderGlibcVersion: "2.41-12+deb13u4",
  originLoaderImages: Object.freeze({
    bootstrap: "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/production-bootstrap@sha256:d8fa941a4371c08f2d73d9832846dbde32925ffbece1013f3ce7f872e634d205",
    consent: "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/square-internal-consent@sha256:966b3f0fbe4ac98b11549987df9c57d8f2f0acf98b4e9f10420399dd8991fb44",
  }),
  consentDockerfileSha256: "ea2009a1babf8d22eb60bebb73901a0fa44cdcff8ff9d876208173cea45c4c8b",
  consentReleaseFiles: Object.freeze({
    "index.js": "af6d149b9fa445de4569fdc468791dafe93e7d43bfd05a6f3285b48e7dc84725",
    "node_modules/server-only/empty.js": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "node_modules/server-only/index.js": "2c4720b71eb03e5f75a83d43e6fd83c0446aa172a58a4d6ffbd74ecad72ba7b5",
    "node_modules/server-only/package.json": "e4b0cc01e2e0349c51c694fa97d8a642eb8322521ca1444b20bd1842594b4339",
  }),
  bootstrapDockerignoreSha256: "1cff3c6b71037eee721261556878d3c6a819175a98ed4336ca8b96d3fc291b44",
  bootstrapDockerfileSha256: "a94896fde4c3a4f423b5b09cb7b899809089bd5ee9f8f25ea73e70a022ac8867",
  bootstrapServerSha256: "9df82e10ee028ccb895ec4b95452d1a0b635013135821f444f1e7a2fd2f582f0",
  bootstrapCallbackBoundarySha256: "b3005de72ff5f1d2fa46851462ce458bda5752624c77d5e496a6b244dbbac5bf",
  vulnerabilityDiscoveryNote: "projects/goog-analysis/locations/us-west1/notes/PACKAGE_VULNERABILITY",
  vulnerabilityNotePrefix: "projects/goog-vulnz/notes/",
  requiredStableScanReads: 3,
  scanPollMilliseconds: 10_000,
  scanTimeoutMilliseconds: 10 * 60_000,
});

function reject(code) {
  throw new Error(code);
}

function isExactOccurrenceName(value) {
  return /^projects\/vaeroex-integrations-prod\/locations\/us-west1\/occurrences\/[A-Za-z0-9._~-]{1,256}$/.test(value ?? "");
}

export function parseDigestReference(value, repository) {
  const pattern = new RegExp(`^${repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@sha256:([a-f0-9]{64})$`);
  const match = pattern.exec(value);
  if (!match) reject("image_digest_invalid");
  return Object.freeze({ reference: value, digest: match[1], resourceUrl: `https://${value}` });
}

function vulnerabilityIdentifier(occurrence) {
  const candidates = [
    occurrence.noteName,
    occurrence.vulnerability?.shortDescription,
    ...(occurrence.vulnerability?.relatedUrls ?? []).map((entry) => entry?.url),
  ].filter((entry) => typeof entry === "string");
  for (const candidate of candidates) {
    const match = candidate.match(/CVE-\d{4}-\d+/i);
    if (match) return match[0].toUpperCase();
  }
  return null;
}

export function evaluateScanOccurrences(kind, occurrences, sourceIntegrity, image = null) {
  if (!["callback", "bootstrap", "consent"].includes(kind)) reject("image_kind");
  if (!Array.isArray(occurrences)) reject("scan_shape");
  if (occurrences.some((entry) => !entry || typeof entry !== "object")) reject("scan_shape");
  if (occurrences.some(
    (entry) => entry.kind === "DISCOVERY" &&
      (entry.noteName !== IMAGE_POLICY.vulnerabilityDiscoveryNote || !isExactOccurrenceName(entry.name)),
  )) reject("scan_discovery_foreign");

  const discovery = occurrences.filter(
    (entry) => entry.kind === "DISCOVERY" && entry.noteName === IMAGE_POLICY.vulnerabilityDiscoveryNote,
  );
  if (discovery.length === 0) reject("scan_not_observed");
  if (discovery.length !== 1) reject("scan_discovery_ambiguous");
  const statuses = discovery.map((entry) => entry.discovery?.analysisStatus);
  if (statuses.some((status) => status !== "FINISHED_SUCCESS")) reject("scan_not_complete");
  if (occurrences.some((entry) => entry.kind === "SECRET")) reject("secret_finding");

  const vulnerabilities = occurrences.filter((entry) => entry.kind === "VULNERABILITY");
  const severityCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, MINIMAL: 0, SEVERITY_UNSPECIFIED: 0 };
  const acceptedExceptions = [];
  for (const occurrence of vulnerabilities) {
    if (typeof occurrence.noteName !== "string" || !occurrence.noteName.startsWith(IMAGE_POLICY.vulnerabilityNotePrefix)) {
      reject("vulnerability_source_invalid");
    }
    const severity = occurrence.vulnerability?.effectiveSeverity ?? occurrence.vulnerability?.severity ?? null;
    if (severity === null || severity === "SEVERITY_UNSPECIFIED" || severity === "UNSPECIFIED") {
      const identifier = vulnerabilityIdentifier(occurrence);
      const packageIssues = occurrence.vulnerability?.packageIssue;
      const sourcePinned = kind === "bootstrap"
        ? sourceIntegrity?.bootstrapFingerprintsVerified === true &&
          sourceIntegrity?.runtimeDependenciesEmpty === true &&
          sourceIntegrity?.compressionPathAbsent === true
        : kind === "consent" &&
          sourceIntegrity?.consentDockerfilePinned === true &&
          sourceIntegrity?.consentReleasePinned === true &&
          sourceIntegrity?.debianLibzCallPathAbsent === true;
      const exactOriginLoaderFinding = severity === null &&
        image?.reference === IMAGE_POLICY.originLoaderImages[kind] &&
        image?.resourceUrl === `https://${image.reference}` &&
        IMAGE_POLICY.originLoaderCves.includes(identifier) && sourcePinned &&
        occurrence.noteName === `projects/goog-vulnz/notes/${identifier}` &&
        Array.isArray(packageIssues) && packageIssues.length === 1 &&
        packageIssues[0]?.affectedPackage === "glibc" &&
        packageIssues[0]?.affectedVersion?.fullName === IMAGE_POLICY.originLoaderGlibcVersion &&
        packageIssues[0]?.effectiveSeverity == null;
      if (!exactOriginLoaderFinding) reject("scan_severity_unknown");
      severityCounts.SEVERITY_UNSPECIFIED += 1;
      acceptedExceptions.push(identifier);
      continue;
    }
    if (!Object.hasOwn(severityCounts, severity)) reject("scan_severity_unknown");
    severityCounts[severity] += 1;
    if (severity === "CRITICAL") reject("critical_vulnerability");
    if (severity === "HIGH") {
      const identifier = vulnerabilityIdentifier(occurrence);
      const bootstrapExceptionAllowed = kind === "bootstrap" &&
        identifier === IMAGE_POLICY.bootstrapException &&
        sourceIntegrity?.bootstrapFingerprintsVerified === true &&
        sourceIntegrity?.runtimeDependenciesEmpty === true &&
        sourceIntegrity?.compressionPathAbsent === true;
      const packageIssues = occurrence.vulnerability?.packageIssue;
      const consentExceptionAllowed = kind === "consent" &&
        identifier === IMAGE_POLICY.consentException &&
        sourceIntegrity?.consentDockerfilePinned === true &&
        sourceIntegrity?.consentReleasePinned === true &&
        sourceIntegrity?.debianLibzCallPathAbsent === true &&
        Array.isArray(packageIssues) && packageIssues.length === 1 &&
        packageIssues[0]?.affectedPackage === "zlib" &&
        packageIssues[0]?.affectedVersion?.fullName === IMAGE_POLICY.consentZlibPackageVersion;
      if (!bootstrapExceptionAllowed && !consentExceptionAllowed) reject("high_vulnerability");
      acceptedExceptions.push(identifier);
    }
  }
  if (acceptedExceptions.length !== new Set(acceptedExceptions).size) reject("duplicate_vulnerability_exception");

  return Object.freeze({
    discoveryCount: discovery.length,
    vulnerabilityCount: vulnerabilities.length,
    severityCounts: Object.freeze(severityCounts),
    acceptedExceptions: Object.freeze(acceptedExceptions),
  });
}

export function scanEvidenceFingerprint(occurrences) {
  if (!Array.isArray(occurrences)) reject("scan_shape");
  const evidence = occurrences
    .filter((entry) =>
      (entry.kind === "DISCOVERY" && entry.noteName === IMAGE_POLICY.vulnerabilityDiscoveryNote) ||
      entry.kind === "VULNERABILITY" ||
      entry.kind === "SECRET")
    .map((entry) => {
      if (!entry || typeof entry !== "object" ||
          !isExactOccurrenceName(entry.name) ||
          typeof entry.updateTime !== "string" || !Number.isFinite(Date.parse(entry.updateTime)) ||
          typeof entry.noteName !== "string") {
        reject("scan_evidence_identity_invalid");
      }
      return Object.freeze({
        name: entry.name,
        kind: entry.kind,
        noteName: entry.noteName,
        updateTime: entry.updateTime,
        analysisStatus: entry.discovery?.analysisStatus ?? null,
        lastScanTime: entry.discovery?.lastScanTime ?? null,
        severity: entry.vulnerability?.effectiveSeverity ?? entry.vulnerability?.severity ?? null,
      });
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  return createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
}

export function buildCandidateManifest({ buildId, sourceCommit, callback, bootstrap, consent, callbackScan, bootstrapScan, consentScan }) {
  if (!/^[a-f0-9-]{16,64}$/.test(buildId ?? "")) reject("build_id");
  if (!/^[a-f0-9]{40}$/.test(sourceCommit ?? "")) reject("source_commit");
  if (!consent || !consentScan) reject("consent_scan_required");
  parseDigestReference(consent.reference, IMAGE_POLICY.consent);
  return Object.freeze({
    schemaVersion: 1,
    source: Object.freeze({ repository: POLICY.repositoryFullName, branch: POLICY.branchName, commit: sourceCommit }),
    build: Object.freeze({ id: buildId, trigger: POLICY.triggerName, approved: true }),
    images: Object.freeze({ callback: callback.reference, bootstrap: bootstrap.reference, consent: consent.reference }),
    scans: Object.freeze({ callback: callbackScan, bootstrap: bootstrapScan, consent: consentScan }),
    secretAnalysisQualified: false,
    secretAnalysisRequiredBeforeEligibility: true,
    deploymentEligible: false,
    requiresReviewedDigestPin: true,
    automaticRuntimeRollout: false,
  });
}

async function readSmallFile(path, maximum = 1024) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > maximum) reject("local_input_invalid");
  return readFile(path, "utf8");
}

async function readDigestFile(path) {
  const text = await readSmallFile(path);
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n") || /\r|\s/.test(text.slice(0, -1))) {
    reject("image_digest_file_invalid");
  }
  return text.slice(0, -1);
}

export function verifyBootstrapSourceContent({ dockerignore, dockerfile, server, callbackBoundary, packageText }) {
  if ([dockerignore, dockerfile, server, callbackBoundary, packageText].some((value) => typeof value !== "string")) reject("bootstrap_source_invalid");
  const sha256 = (value) => createHash("sha256").update(value).digest("hex");
  if (sha256(dockerignore) !== IMAGE_POLICY.bootstrapDockerignoreSha256) reject("bootstrap_dockerignore_changed");
  if (sha256(dockerfile) !== IMAGE_POLICY.bootstrapDockerfileSha256) reject("bootstrap_dockerfile_changed");
  if (sha256(server) !== IMAGE_POLICY.bootstrapServerSha256) reject("bootstrap_server_changed");
  if (sha256(callbackBoundary) !== IMAGE_POLICY.bootstrapCallbackBoundarySha256) reject("bootstrap_callback_boundary_changed");
  let manifest;
  try {
    manifest = JSON.parse(packageText);
  } catch {
    reject("bootstrap_package_invalid");
  }
  if (Object.keys(manifest.dependencies ?? {}).length !== 0 || Object.keys(manifest.optionalDependencies ?? {}).length !== 0) {
    reject("bootstrap_runtime_dependencies");
  }
  if (/\b(zlib|gzip|deflate|createGzip|createDeflate)\b/i.test(server + "\n" + callbackBoundary)) reject("bootstrap_compression_reachable");
  return Object.freeze({
    bootstrapFingerprintsVerified: true,
    runtimeDependenciesEmpty: true,
    compressionPathAbsent: true,
  });
}

export function verifyConsentReleaseContent({ dockerfile, files }) {
  if (typeof dockerfile !== "string" || !files || typeof files !== "object" || Array.isArray(files)) reject("consent_release_invalid");
  const sha256 = (value) => createHash("sha256").update(value).digest("hex");
  if (sha256(dockerfile) !== IMAGE_POLICY.consentDockerfileSha256) reject("consent_base_changed");
  const expectedNames = Object.keys(IMAGE_POLICY.consentReleaseFiles).sort();
  if (JSON.stringify(Object.keys(files).sort()) !== JSON.stringify(expectedNames)) reject("consent_release_files_changed");
  for (const name of expectedNames) {
    if (!Buffer.isBuffer(files[name]) || sha256(files[name]) !== IMAGE_POLICY.consentReleaseFiles[name]) {
      reject("consent_release_bytes_changed");
    }
  }
  const bundle = files["index.js"].toString("utf8");
  if (/\b(gzwrite|gzprintf|gzvprintf|gz_vacate|dlopen|ffi-napi|node-ffi|libz\.so|node:zlib|createGzip|createDeflate)\b|\.node\b/i.test(bundle)) {
    reject("consent_native_compression_path");
  }
  return Object.freeze({ consentDockerfilePinned: true, consentReleasePinned: true, debianLibzCallPathAbsent: true });
}

async function verifyConsentRelease() {
  const base = "/workspace/services/external-integrations-production/internal-consent";
  const files = Object.create(null);
  async function walk(directory, prefix = "") {
    for (const entry of await readdir(directory)) {
      const relative = prefix ? `${prefix}/${entry}` : entry;
      const location = `${directory}/${entry}`;
      const metadata = await lstat(location);
      if (metadata.isDirectory()) await walk(location, relative);
      else if (metadata.isFile() && metadata.size <= 1024 * 1024 && Object.keys(files).length < 5) {
        files[relative] = await readFile(location);
      } else reject("consent_release_files_changed");
    }
  }
  if (!(await lstat(`${base}/dist`)).isDirectory()) reject("consent_release_files_changed");
  await walk(`${base}/dist`);
  return verifyConsentReleaseContent({ dockerfile: await readSmallFile(`${base}/Dockerfile`, 4096), files });
}

async function verifyBootstrapSource() {
  const base = "/workspace/services/external-integrations-production/bootstrap-runtime";
  const [dockerignore, dockerfile, server, callbackBoundary, packageText] = await Promise.all([
    readSmallFile(`${base}/.dockerignore`, 4096),
    readSmallFile(`${base}/Dockerfile`, 4096),
    readSmallFile(`${base}/server.mjs`, 16_384),
    readSmallFile(`${base}/callback-boundary.mjs`, 32_768),
    readSmallFile(`${base}/package.json`, 4096),
  ]);
  return verifyBootstrapSourceContent({ dockerignore, dockerfile, server, callbackBoundary, packageText });
}

export async function listOccurrences(resourceUrl, accessToken, fetchImpl) {
  const occurrences = [];
  let pageToken = "";
  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams({ filter: `resourceUrl="${resourceUrl}"`, pageSize: "100" });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await fetchBoundedJson(
      `https://containeranalysis.googleapis.com/v1/projects/${POLICY.projectId}/occurrences?${query}`,
      accessToken,
      fetchImpl,
    );
    if (Array.isArray(response.unreachable) && response.unreachable.length > 0) reject("scan_regions_unreachable");
    if (!Array.isArray(response.occurrences ?? [])) reject("scan_shape");
    if ((response.occurrences ?? []).some((occurrence) => occurrence.resourceUri !== resourceUrl)) {
      reject("scan_resource_mismatch");
    }
    occurrences.push(...(response.occurrences ?? []));
    if (occurrences.length > 10_000) reject("scan_response_oversized");
    pageToken = response.nextPageToken ?? "";
    if (!pageToken) return occurrences;
    if (typeof pageToken !== "string" || pageToken.length > 4096) reject("scan_cursor_invalid");
  }
  reject("scan_page_limit");
}

export async function waitForCompletedScan(
  kind,
  image,
  sourceIntegrity,
  accessToken,
  fetchImpl = fetch,
  timing = {},
) {
  const now = timing.now ?? Date.now;
  const sleep = timing.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + IMAGE_POLICY.scanTimeoutMilliseconds;
  let previousFingerprint = null;
  let stableReadCount = 0;
  while (now() < deadline) {
    const occurrences = await listOccurrences(image.resourceUrl, accessToken, fetchImpl);
    try {
      const result = evaluateScanOccurrences(kind, occurrences, sourceIntegrity, image);
      const fingerprint = scanEvidenceFingerprint(occurrences);
      if (fingerprint === previousFingerprint) {
        stableReadCount += 1;
      } else {
        previousFingerprint = fingerprint;
        stableReadCount = 1;
      }
      if (stableReadCount >= IMAGE_POLICY.requiredStableScanReads) {
        return Object.freeze({
          ...result,
          vulnerabilityDiscoveryNote: IMAGE_POLICY.vulnerabilityDiscoveryNote,
          stableReadCount,
          evidenceFingerprint: fingerprint,
        });
      }
    } catch (error) {
      if (!(error instanceof Error) || (error.message !== "scan_not_observed" && error.message !== "scan_not_complete")) throw error;
      previousFingerprint = null;
      stableReadCount = 0;
    }
    await sleep(IMAGE_POLICY.scanPollMilliseconds);
  }
  reject("scan_timeout");
}

async function uploadCandidate(manifest, accessToken, fetchImpl = fetch) {
  const objectName = `release-candidates/${manifest.source.commit}/${manifest.build.id}.json`;
  const query = new URLSearchParams({ uploadType: "media", name: objectName, ifGenerationMatch: "0" });
  const body = `${JSON.stringify(manifest)}\n`;
  if (Buffer.byteLength(body, "utf8") > 64 * 1024) reject("candidate_manifest_oversized");
  const response = await fetchImpl(
    `https://storage.googleapis.com/upload/storage/v1/b/${IMAGE_POLICY.buildBucket}/o?${query}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=utf-8" },
      body,
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) reject("candidate_upload_rejected");
  return `gs://${IMAGE_POLICY.buildBucket}/${objectName}`;
}

export async function qualifyPublishedImages({ buildId, sourceCommit, fetchImpl = fetch }) {
  const [callbackText, bootstrapText, consentText, sourceIntegrity, consentIntegrity, accessToken] = await Promise.all([
    readDigestFile("/workspace/callback-edge.digest"),
    readDigestFile("/workspace/bootstrap-runtime.digest"),
    readDigestFile("/workspace/internal-consent.digest"),
    verifyBootstrapSource(),
    verifyConsentRelease(),
    getMetadataAccessToken(fetchImpl),
  ]);
  const callback = parseDigestReference(callbackText, IMAGE_POLICY.callback);
  const bootstrap = parseDigestReference(bootstrapText, IMAGE_POLICY.bootstrap);
  const consent = parseDigestReference(consentText, IMAGE_POLICY.consent);
  const [callbackScan, bootstrapScan, consentScan] = await Promise.all([
    waitForCompletedScan("callback", callback, null, accessToken, fetchImpl),
    waitForCompletedScan("bootstrap", bootstrap, sourceIntegrity, accessToken, fetchImpl),
    waitForCompletedScan("consent", consent, consentIntegrity, accessToken, fetchImpl),
  ]);
  const manifest = buildCandidateManifest({ buildId, sourceCommit, callback, bootstrap, consent, callbackScan, bootstrapScan, consentScan });
  const candidate = await uploadCandidate(manifest, accessToken, fetchImpl);
  return Object.freeze({ callback: callback.reference, bootstrap: bootstrap.reference, consent: consent.reference, candidate });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  qualifyPublishedImages({ buildId: process.env.BUILD_ID, sourceCommit: process.env.COMMIT_SHA }).then(
    (result) => {
      process.stdout.write(`production_image_scans_qualified\ncallback_digest=${result.callback}\nbootstrap_digest=${result.bootstrap}\nconsent_digest=${result.consent}\ncandidate=${result.candidate}\n`);
    },
    () => {
      process.stderr.write("production_image_scans_rejected\n");
      process.exitCode = 1;
    },
  );
}

export { IMAGE_POLICY };
