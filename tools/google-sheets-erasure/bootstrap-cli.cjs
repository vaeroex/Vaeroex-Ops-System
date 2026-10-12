#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Explicit private operator initialization only. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { generateJournalKey, publicKeyFingerprint } = require('./journal.cjs');
const { genesisBytes } = require('./witness.cjs');
const { privateJson } = require('./operator-cli.cjs');
const fail = code => { throw Error(`sheets_bootstrap_${code}`); };
function writeExact(filename, bytes) {
  let fd;
  try { fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.nlink !== 1 || (stat.mode & 0o7777) !== 0o600 ||
        !fs.readFileSync(filename).equals(bytes)) fail('existing_file_conflict');
    return;
  }
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function preparePackage(input) {
  if (!input || Object.keys(input).sort().join(',') !== 'bucket,datasetId,gcloudPath,journalDirectory,outputDirectory,pinnedFingerprint,primaryEndpointHash,publicKey,serviceAccount,version' || input.version !== 1) fail('configuration');
  if (publicKeyFingerprint(input.publicKey) !== input.pinnedFingerprint) fail('key_pin');
  const directory = input.outputDirectory;
  if (!path.isAbsolute(directory) || fs.realpathSync(directory) !== directory) fail('directory');
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o700) fail('directory');
  const genesis = genesisBytes(input), genesisDigest = crypto.createHash('sha256').update(genesis).digest('hex');
  const config = { version: 1, purpose: 'support', databaseEndpointHash: input.primaryEndpointHash,
    primaryEndpointHash: input.primaryEndpointHash, journalDirectory: input.journalDirectory,
    publicKey: input.publicKey, pinnedFingerprint: input.pinnedFingerprint, gcloudPath: input.gcloudPath,
    witness: { bucket: input.bucket, serviceAccount: input.serviceAccount, datasetId: input.datasetId, genesisDigest, minimumRetentionSeconds: 0 } };
  const prefix = `google-sheets-erasure/${input.datasetId}/genesis.json`;
  const pins = { version: 1, bucket: input.bucket, serviceAccount: input.serviceAccount, datasetId: input.datasetId,
    primaryEndpointHash: input.primaryEndpointHash, publicKey: input.publicKey, pinnedFingerprint: input.pinnedFingerprint, genesisDigest, genesisObject: prefix };
  writeExact(path.join(directory, 'genesis.json'), genesis);
  writeExact(path.join(directory, 'support-config.json'), Buffer.from(JSON.stringify(config, null, 2) + '\n'));
  writeExact(path.join(directory, 'independent-pins.json'), Buffer.from(JSON.stringify(pins, null, 2) + '\n'));
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return { state: 'private-bootstrap-package-ready', directory, genesisDigest, genesisObject: prefix,
    provisioned: false, nextStep: 'independently-retain-pins-then-reviewed-create-only-genesis-upload' };
}
if (require.main === module) {
  try {
    const [command, argument, ...extra] = process.argv.slice(2);
    if (extra.length) fail('arguments');
    const result = command === 'key' ? generateJournalKey({ directory: argument }) :
      command === 'package' ? preparePackage(privateJson(argument)) : fail('usage_key_or_package');
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    const code = /^(sheets_(bootstrap|journal|operator|witness)_[a-z0-9_]+)$/.test(error?.message ?? '') ? error.message : 'sheets_bootstrap_failed_review_required';
    process.stderr.write(JSON.stringify({ ok: false, code }) + '\n'); process.exitCode = 1;
  }
}
module.exports = { preparePackage };
