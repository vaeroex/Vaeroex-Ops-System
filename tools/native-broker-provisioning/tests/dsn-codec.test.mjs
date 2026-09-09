import assert from "node:assert/strict";
import { test } from "node:test";
import { createManagedSupabaseDsnCodec } from "../dsn-codec.mjs";

const role = "square_sandbox_synthetic_broker";
const codec = createManagedSupabaseDsnCodec({ role });
const prefix = Buffer.from(`postgresql://${role}.oysjpoondtcrqpghhrbd:`, "ascii");
const suffix = Buffer.from("@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=verify-full", "ascii");
const credential = () => Buffer.from("0123456789abcdef".repeat(8), "ascii"); // Public synthetic fixture only.
const payload = () => Buffer.concat([prefix, credential(), suffix]);
const rejects = action => assert.throws(action, error => error.constructor === Error &&
  error.message === "native_broker_dsn_denied" && error.cause === undefined);

test("exact fixed wire format; round-trip and fresh independent ownership", () => {
  const input = credential();
  const encoded = codec.encode(input);
  assert.deepEqual(encoded, payload());
  const decoded = codec.decode(encoded);
  assert.deepEqual(decoded, input);
  assert.notStrictEqual(decoded.buffer, encoded.buffer);
  assert.notStrictEqual(encoded.buffer, input.buffer);
  input.fill(0);
  assert.deepEqual(decoded, credential());
  encoded.fill(0);
  assert.deepEqual(decoded, credential());
  decoded.fill(0);
});

test("only valid bounded Sandbox broker names; no broader configuration", () => {
  for (const name of [undefined, null, 1, "", "postgres", "square_sandbox_", "square_sandbox_qbo",
    "square_sandbox_password", "square_sandbox_a1", "square_sandbox_A", "square_sandbox_a@other",
    "square_sandbox_a:secret", "square_sandbox_a\n", `square_sandbox_${"a".repeat(41)}`]) {
    rejects(() => createManagedSupabaseDsnCodec({ role: name }));
  }
  assert.ok(createManagedSupabaseDsnCodec({ role: `square_sandbox_${"a".repeat(40)}` }));
  assert.ok(Object.isFrozen(codec));
});

test("encoding accepts exactly 128 lowercase hex bytes, never coercing input", () => {
  for (const value of [undefined, null, "a".repeat(128), new Uint8Array(128), Buffer.alloc(127, 97),
    Buffer.alloc(129, 97), { toString() { throw new Error("must_not_coerce"); } }]) rejects(() => codec.encode(value));
  for (let byte = 0; byte <= 255; byte++) {
    const allowed = byte >= 48 && byte <= 57 || byte >= 97 && byte <= 102;
    const value = Buffer.alloc(128, byte);
    if (allowed) codec.encode(value).fill(0);
    else rejects(() => codec.encode(value));
  }
});

test("every altered envelope byte is rejected, including role, project, host and TLS", () => {
  const original = payload();
  for (let index = 0; index < original.length; index++) {
    if (index >= prefix.length && index < prefix.length + 128) continue;
    const changed = Buffer.from(original);
    changed[index] ^= 1;
    rejects(() => codec.decode(changed));
  }
  const otherRole = createManagedSupabaseDsnCodec({ role: "square_sandbox_another_broker" });
  rejects(() => otherRole.decode(original));
});

test("decode rejects malformed credentials without exposing input or changing it", () => {
  for (const byte of [0, 10, 32, 37, 58, 64, 65, 70, 103, 127, 255]) {
    const changed = payload();
    changed[prefix.length + 64] = byte;
    const snapshot = Buffer.from(changed);
    rejects(() => codec.decode(changed));
    assert.deepEqual(changed, snapshot);
  }
});

test("no alternative forms, duplicate options, URI fragments or trailing bytes", () => {
  const original = payload();
  for (const value of [null, undefined, new Uint8Array(original), original.toString("ascii"),
    original.subarray(1), original.subarray(0, -1), Buffer.alloc(65536),
    Buffer.concat([original, Buffer.from("\n")]), Buffer.concat([original, Buffer.from("#extra")]),
    Buffer.concat([original, Buffer.from("&sslmode=disable")]),
    Buffer.concat([original, Buffer.from("&sslrootcert=/arbitrary/path")])]) rejects(() => codec.decode(value));
});

test("secret bytes never require JavaScript strings or a URL parser", () => {
  const input = credential();
  const unexpected = () => { throw new Error("secret_string_conversion_forbidden"); };
  input.toString = unexpected;
  const savedUrl = globalThis.URL;
  try {
    globalThis.URL = unexpected;
    const encoded = codec.encode(input);
    encoded.toString = unexpected;
    const decoded = codec.decode(encoded);
    assert.ok(decoded.equals(credential()));
    decoded.fill(0); encoded.fill(0);
  } finally { globalThis.URL = savedUrl; input.fill(0); }
});

test("shared backing memory cannot race validation and copying", () => {
  const sharedCredential = Buffer.from(new SharedArrayBuffer(128));
  sharedCredential.fill(97);
  rejects(() => codec.encode(sharedCredential));
  const original = payload();
  const sharedPayload = Buffer.from(new SharedArrayBuffer(original.length));
  original.copy(sharedPayload);
  rejects(() => codec.decode(sharedPayload));
});
