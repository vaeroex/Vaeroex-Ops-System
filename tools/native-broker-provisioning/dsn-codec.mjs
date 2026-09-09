const project = "oysjpoondtcrqpghhrbd";
const host = "aws-0-us-west-2.pooler.supabase.com";
const denied = () => new Error("native_broker_dsn_denied");
const isCredentialByte = byte => (byte >= 48 && byte <= 57) || (byte >= 97 && byte <= 102);

/**
 * Private secret-store wire format, not a general connection-string parser.
 * Only the fixed isolated session pooler and one configured broker role exist.
 * Credentials remain Buffers; no URL parser, string conversion, diagnostics or
 * I/O receives their bytes. Returned Buffers are independent, caller-owned and
 * must be wiped after use. Inputs remain owned by their caller.
 *
 * The existing callback rejects sslrootcert query parameters and supplies its
 * CA separately using SQUARE_SANDBOX_DATABASE_CA_PEM with rejectUnauthorized.
 * Keep that contract: this codec cannot attest installed CA/host configuration.
 * The maintenance launcher separately pins the public CA file and its digest.
 */
export function createManagedSupabaseDsnCodec({ role } = {}) {
  if (typeof role !== "string" || !/^square_sandbox_[a-z_]{1,40}$/.test(role) ||
      /qbo|password/.test(role)) throw denied();
  // These strings contain configuration only, never credential material.
  const prefix = Buffer.from(`postgresql://${role}.${project}:`, "ascii");
  const suffix = Buffer.from(`@${host}:5432/postgres?sslmode=verify-full`, "ascii");
  const size = prefix.length + 128 + suffix.length;
  const isBuffer = value => Buffer.isBuffer(value) && !(value.buffer instanceof SharedArrayBuffer);
  const isCredential = value => isBuffer(value) && value.length === 128 && value.every(isCredentialByte);

  return Object.freeze({
    encode(credential) {
      let output;
      try {
        if (!isCredential(credential)) throw denied();
        output = Buffer.alloc(size);
        prefix.copy(output);
        credential.copy(output, prefix.length);
        suffix.copy(output, prefix.length + 128);
        return output;
      } catch {
        output?.fill(0);
        throw denied();
      }
    },
    decode(payload) {
      let credential;
      try {
        if (!isBuffer(payload) || payload.length !== size ||
            !payload.subarray(0, prefix.length).equals(prefix) ||
            !payload.subarray(prefix.length + 128).equals(suffix)) throw denied();
        credential = Buffer.alloc(128);
        payload.copy(credential, 0, prefix.length, prefix.length + 128);
        if (!isCredential(credential)) throw denied();
        return credential;
      } catch {
        credential?.fill(0);
        throw denied();
      }
    },
  });
}
