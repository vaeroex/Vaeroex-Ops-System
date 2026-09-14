import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { fetchBoundedJson, getMetadataAccessToken, POLICY } from "./verify-trigger-context.mjs";

const IMAGE_POLICY = Object.freeze({
  callback: "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/square-callback-edge",
  bootstrap: "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/production-bootstrap",
  buildBucket: "vaeroex-integrations-prod-build",
  bootstrapException: "CVE-2026-85091",
  bootstrapDockerfileSha256: "628ac2a6fd58b0ac33ca95c1af9a5717f2c3b26f6bf353853c0d56a6ca57e35f",
  bootstrapServerSha256: "c724529d24e8338bdfff14b51557a72cedb332abddc6d705a0cecca07e08c110",
});

function reject(code) {
  throw new Error(code);
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

export function evaluateScanOccurrences(kind, occurrences, sourceIntegrity) {
  if (kind !== "callback" && kind !== "bootstrap") reject("image_kind");
  if (!Array.isArray(occurrences)) reject("scan_shape");
  if (occurrences.some((entry) => !entry || typeof entry !== "object")) reject("scan_shape");

  const discovery = occurrences.filter((entry) => entry.kind === "DISCOVERY");
  if (discovery.length === 0) reject("scan_not_observed");
  const statuses = discovery.map((entry) => entry.discovery?.analysisStatus);
  if (statuses.some((status) => status !== "FINISHED_SUCCESS")) reject("scan_not_complete");
  if (occurrences.some((entry) => entry.kind === "SECRET")) reject("secret_finding");

  const vulnerabilities = occurrences.filter((entry) => entry.kind === "VULNERABILITY");
  const severityCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, MINIMAL: 0, SEVERITY_UNSPECIFIED: 0 };
  const acceptedExceptions = [];
  for (const occurrence of vulnerabilities) {
    const severity = occurrence.vulnerability?.effectiveSeverity ?? occurrence.vulnerability?.severity ?? "UNSPECIFIED";
    if (!(severity in severityCounts)) reject("scan_severity_unknown");
    severityCounts[severity] += 1;
    if (severity === "CRITICAL") reject("critical_vulnerability");
    if (severity === "HIGH") {
      const identifier = vulnerabilityIdentifier(occurrence);
      const exceptionAllowed = kind === "bootstrap" &&
        identifier === IMAGE_POLICY.bootstrapException &&
        sourceIntegrity?.bootstrapFingerprintsVerified === true &&
        sourceIntegrity?.runtimeDependenciesEmpty === true &&
        sourceIntegrity?.compressionPathAbsent === true;
      if (!exceptionAllowed) reject("high_vulnerability");
      acceptedExceptions.push(identifier);
    }
  }
  if (acceptedExceptions.length > 1) reject("duplicate_vulnerability_exception");

  return Object.freeze({
    discoveryCount: discovery.length,
    vulnerabilityCount: vulnerabilities.length,
    severityCounts: Object.freeze(severityCounts),
    acceptedExceptions: Object.freeze(acceptedExceptions),
  });
}

export function buildCandidateManifest({ buildId, sourceCommit, callback, bootstrap, callbackScan, bootstrapScan }) {
  if (!/^[a-f0-9-]{16,64}$/.test(buildId ?? "")) reject("build_id");
  if (!/^[a-f0-9]{40}$/.test(sourceCommit ?? "")) reject("source_commit");
  return Object.freeze({
    schemaVersion: 1,
    source: Object.freeze({ repository: POLICY.repositoryFullName, branch: POLICY.branchName, commit: sourceCommit }),
    build: Object.freeze({ id: buildId, trigger: POLICY.triggerName, approved: true }),
    images: Object.freeze({ callback: callback.reference, bootstrap: bootstrap.reference }),
    scans: Object.freeze({ callback: callbackScan, bootstrap: bootstrapScan }),
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

async function verifyBootstrapSource() {
  const base = "/workspace/services/external-integrations-production/bootstrap-runtime";
  const [dockerfile, server, packageText] = await Promise.all([
    readSmallFile(`${base}/Dockerfile`, 4096),
    readSmallFile(`${base}/server.mjs`, 16_384),
    readSmallFile(`${base}/package.json`, 4096),
  ]);
  const sha256 = (value) => createHash("sha256").update(value).digest("hex");
  if (sha256(dockerfile) !== IMAGE_POLICY.bootstrapDockerfileSha256) reject("bootstrap_dockerfile_changed");
  if (sha256(server) !== IMAGE_POLICY.bootstrapServerSha256) reject("bootstrap_server_changed");
  let manifest;
  try {
    manifest = JSON.parse(packageText);
  } catch {
    reject("bootstrap_package_invalid");
  }
  if (Object.keys(manifest.dependencies ?? {}).length !== 0 || Object.keys(manifest.optionalDependencies ?? {}).length !== 0) {
    reject("bootstrap_runtime_dependencies");
  }
  if (/\b(zlib|gzip|deflate|createGzip|createDeflate)\b/i.test(server)) reject("bootstrap_compression_reachable");
  return Object.freeze({
    bootstrapFingerprintsVerified: true,
    runtimeDependenciesEmpty: true,
    compressionPathAbsent: true,
  });
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

async function waitForCompletedScan(kind, image, sourceIntegrity, accessToken, fetchImpl = fetch) {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const occurrences = await listOccurrences(image.resourceUrl, accessToken, fetchImpl);
    try {
      return evaluateScanOccurrences(kind, occurrences, sourceIntegrity);
    } catch (error) {
      if (!(error instanceof Error) || (error.message !== "scan_not_observed" && error.message !== "scan_not_complete")) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
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
  const [callbackText, bootstrapText, sourceIntegrity, accessToken] = await Promise.all([
    readDigestFile("/workspace/callback-edge.digest"),
    readDigestFile("/workspace/bootstrap-runtime.digest"),
    verifyBootstrapSource(),
    getMetadataAccessToken(fetchImpl),
  ]);
  const callback = parseDigestReference(callbackText, IMAGE_POLICY.callback);
  const bootstrap = parseDigestReference(bootstrapText, IMAGE_POLICY.bootstrap);
  const [callbackScan, bootstrapScan] = await Promise.all([
    waitForCompletedScan("callback", callback, null, accessToken, fetchImpl),
    waitForCompletedScan("bootstrap", bootstrap, sourceIntegrity, accessToken, fetchImpl),
  ]);
  const manifest = buildCandidateManifest({ buildId, sourceCommit, callback, bootstrap, callbackScan, bootstrapScan });
  const candidate = await uploadCandidate(manifest, accessToken, fetchImpl);
  return Object.freeze({ callback: callback.reference, bootstrap: bootstrap.reference, candidate });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  qualifyPublishedImages({ buildId: process.env.BUILD_ID, sourceCommit: process.env.COMMIT_SHA }).then(
    (result) => {
      process.stdout.write(`production_image_scans_qualified\ncallback_digest=${result.callback}\nbootstrap_digest=${result.bootstrap}\ncandidate=${result.candidate}\n`);
    },
    () => {
      process.stderr.write("production_image_scans_rejected\n");
      process.exitCode = 1;
    },
  );
}

export { IMAGE_POLICY };
