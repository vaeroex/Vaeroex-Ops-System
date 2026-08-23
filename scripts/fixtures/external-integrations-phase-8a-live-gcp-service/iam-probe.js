const { randomBytes } = require("node:crypto");

const KMS_KEY_RESOURCE = required("KMS_KEY_RESOURCE");
const SECRET_VERSION_RESOURCE = required("SECRET_VERSION_RESOURCE");
const EXPECTED_RESULT = required("EXPECTED_RESULT");

if (!["allowed", "denied"].includes(EXPECTED_RESULT)) {
  throw new Error("expected_result_invalid");
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing_configuration:${name}`);
  return value;
}

async function metadataAccessToken() {
  const result = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "metadata-flavor": "Google" } }
  );
  if (!result.ok) throw new Error("metadata_token_unavailable");
  const value = await result.json();
  if (typeof value.access_token !== "string") throw new Error("metadata_token_unavailable");
  return value.access_token;
}

async function googleRequest(url, token, init = {}) {
  const result = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {})
    }
  });
  return { status: result.status, body: result.ok ? await result.json() : null };
}

async function main() {
  const token = await metadataAccessToken();
  const plaintext = randomBytes(64);
  const aad = randomBytes(64);
  const encrypt = await googleRequest(
    `https://cloudkms.googleapis.com/v1/${KMS_KEY_RESOURCE}:encrypt`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        plaintext: plaintext.toString("base64"),
        additionalAuthenticatedData: aad.toString("base64")
      })
    }
  );

  let decryptStatus = null;
  if (typeof encrypt.body?.ciphertext === "string") {
    const decrypt = await googleRequest(
      `https://cloudkms.googleapis.com/v1/${KMS_KEY_RESOURCE}:decrypt`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          ciphertext: encrypt.body.ciphertext,
          additionalAuthenticatedData: aad.toString("base64")
        })
      }
    );
    decryptStatus = decrypt.status;
    if (typeof decrypt.body?.plaintext === "string") {
      const decrypted = Buffer.from(decrypt.body.plaintext, "base64");
      decrypted.fill(0);
    }
  }

  const secret = await googleRequest(
    `https://secretmanager.googleapis.com/v1/${SECRET_VERSION_RESOURCE}:access`,
    token,
    { method: "GET" }
  );
  if (typeof secret.body?.payload?.data === "string") {
    const value = Buffer.from(secret.body.payload.data, "base64");
    value.fill(0);
  }

  plaintext.fill(0);
  aad.fill(0);

  const allowed = encrypt.status === 200 && decryptStatus === 200 && secret.status === 200;
  const denied = [encrypt.status, secret.status].every((status) => status === 403);
  console.log(JSON.stringify({
    component: "phase8a_live_iam_probe",
    expectedResult: EXPECTED_RESULT,
    kmsEncryptStatus: encrypt.status,
    kmsDecryptStatus: decryptStatus,
    secretAccessStatus: secret.status,
    passed: EXPECTED_RESULT === "allowed" ? allowed : denied
  }));
  if (EXPECTED_RESULT === "allowed" ? !allowed : !denied) process.exitCode = 1;
}

main().catch(() => {
  process.stderr.write("phase8a_live_iam_probe_failed\n");
  process.exit(1);
});
