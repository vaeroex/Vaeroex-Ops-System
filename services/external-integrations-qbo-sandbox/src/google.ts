import "server-only";

const METADATA_ORIGIN = "http://metadata.google.internal";
const GOOGLE_API_TIMEOUT_MS = 20_000;

async function metadata(path: string) {
  const response = await fetch(`${METADATA_ORIGIN}${path}`, {
    headers: { "metadata-flavor": "Google" },
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) throw new Error("phase8b_google_metadata_failed");
  return response.text();
}

async function accessToken() {
  const raw = await metadata(
    "/computeMetadata/v1/instance/service-accounts/default/token"
  );
  const parsed = JSON.parse(raw) as { access_token?: unknown };
  if (typeof parsed.access_token !== "string" || parsed.access_token.length < 16) {
    throw new Error("phase8b_google_access_token_failed");
  }
  return parsed.access_token;
}

async function googleJson(url: string, init: RequestInit) {
  const token = await accessToken();
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(GOOGLE_API_TIMEOUT_MS),
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers
    }
  });
  if (!response.ok) throw new Error("phase8b_google_api_failed");
  return response.json() as Promise<Record<string, unknown>>;
}

export async function googleCreateCloudTask(input: {
  queueResource: string;
  taskId: string;
  targetUrl: string;
  oidcServiceAccountEmail: string;
  oidcAudience: string;
  payload: Readonly<Record<string, unknown>>;
}) {
  if (
    !/^projects\/[a-z][a-z0-9-]{0,62}\/locations\/[a-z][a-z0-9-]{0,62}\/queues\/[a-z][a-z0-9-]{0,62}$/.test(
      input.queueResource
    ) ||
    !/^[a-f0-9]{64}$/.test(input.taskId) ||
    !/^[a-z][a-z0-9-]{4,28}@[a-z][a-z0-9-]{0,62}\.iam\.gserviceaccount\.com$/.test(
      input.oidcServiceAccountEmail
    )
  ) {
    throw new Error("phase8b_cloud_task_configuration_invalid");
  }
  const target = new URL(input.targetUrl);
  const audience = new URL(input.oidcAudience);
  if (
    target.protocol !== "https:" ||
    target.pathname !== "/tasks/execute" ||
    target.search ||
    target.hash ||
    audience.protocol !== "https:" ||
    audience.pathname !== "/" ||
    audience.search ||
    audience.hash ||
    target.origin !== audience.origin
  ) {
    throw new Error("phase8b_cloud_task_target_invalid");
  }

  const taskName = `${input.queueResource}/tasks/${input.taskId}`;
  const token = await accessToken();
  const response = await fetch(
    `https://cloudtasks.googleapis.com/v2/${input.queueResource}/tasks`,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(GOOGLE_API_TIMEOUT_MS),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        task: {
          name: taskName,
          scheduleTime: new Date(Date.now() + 5_000).toISOString(),
          httpRequest: {
            httpMethod: "POST",
            url: target.toString(),
            headers: { "content-type": "application/json" },
            body: Buffer.from(JSON.stringify(input.payload), "utf8").toString("base64"),
            oidcToken: {
              serviceAccountEmail: input.oidcServiceAccountEmail,
              audience: audience.origin
            }
          }
        }
      })
    }
  );
  if (response.status === 409) {
    return { taskId: input.taskId, created: false as const };
  }
  if (!response.ok) throw new Error("phase8b_cloud_task_create_failed");
  const result = await response.json() as { name?: unknown };
  if (result.name !== taskName) {
    throw new Error("phase8b_cloud_task_create_response_invalid");
  }
  return { taskId: input.taskId, created: true as const };
}

export const googleCloudKmsTransport = {
  async encrypt(request: {
    name: string;
    plaintext: string;
    additionalAuthenticatedData: string;
  }) {
    const result = await googleJson(
      `https://cloudkms.googleapis.com/v1/${request.name}:encrypt`,
      {
        method: "POST",
        body: JSON.stringify({
          plaintext: request.plaintext,
          additionalAuthenticatedData: request.additionalAuthenticatedData
        })
      }
    );
    return { ciphertext: result.ciphertext as string | undefined };
  },
  async decrypt(request: {
    name: string;
    ciphertext: string;
    additionalAuthenticatedData: string;
  }) {
    const result = await googleJson(
      `https://cloudkms.googleapis.com/v1/${request.name}:decrypt`,
      {
        method: "POST",
        body: JSON.stringify({
          ciphertext: request.ciphertext,
          additionalAuthenticatedData: request.additionalAuthenticatedData
        })
      }
    );
    return { plaintext: result.plaintext as string | undefined };
  }
};

export const googleSecretManagerTransport = {
  async accessSecretVersion(request: { name: string }) {
    const result = await googleJson(
      `https://secretmanager.googleapis.com/v1/${request.name}:access`,
      { method: "GET" }
    );
    const payload = result.payload as { data?: string } | undefined;
    return { payload: payload ? { data: payload.data } : null };
  }
};

export async function googleIdentityToken(audience: string) {
  const checked = new URL(audience);
  if (checked.protocol !== "https:" || checked.username || checked.password) {
    throw new Error("phase8b_google_identity_audience_invalid");
  }
  const token = await metadata(
    `/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(
      checked.toString()
    )}&format=full`
  );
  if (token.split(".").length !== 3) {
    throw new Error("phase8b_google_identity_token_failed");
  }
  return token;
}
