/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS fixture transpiles the isolated TypeScript configuration. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'services/external-integrations-qbo/src/database-config.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exported = {};
vm.runInNewContext(compiled, { exports: exported, require, URL });
const configure = exported.qboDatabaseConfiguration;
const ca = fs.readFileSync(path.join(root, 'tools/jit-access-feasibility/supabase-root-2021.crt'), 'utf8');
const url = 'postgresql://synthetic.synthetic:fixture-password@aws-0-us-west-2.pooler.supabase.com:5432/postgres';
let assertions = 0;
for (const mode of ['', '?sslmode=require', '?sslmode=verify-ca', '?sslmode=verify-full']) {
  const value = configure(url + mode, ca);
  assert.equal(value.ssl.rejectUnauthorized, true); assertions++;
  assert.equal(value.ssl.ca, ca); assertions++;
  assert.equal(new URL(value.connectionString).searchParams.has('sslmode'), false); assertions++;
}
for (const bad of ['?sslmode=disable','?sslmode=prefer','?sslmode=no-verify','?sslmode=require&sslmode=disable',
  '?sslrootcert=/tmp/other','?sslcert=x','?sslkey=x','?ssl=false', '#fragment']) {
  assert.throws(() => configure(url + bad, ca), /tls_configuration_denied/); assertions++;
}
for (const bad of [url.replace(':5432/', ':6543/'),url.replace('.pooler.supabase.com', '.evil.example'),
  url.replace('/postgres', '/other'),url.replace('postgresql:', 'https:'), 'not-a-url']) {
  assert.throws(() => configure(bad, ca), /tls_configuration_denied/); assertions++;
}
for (const bad of ['',ca.replace('CERTIFICATE', 'CHANGED'),`${ca}\n`,undefined]) {
  assert.throws(() => configure(url, bad), /tls_configuration_denied/); assertions++;
}
console.log(`QBO database TLS: ${assertions} assertions passed; no database or provider calls.`);
