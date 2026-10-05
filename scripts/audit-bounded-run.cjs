/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS regression harness loads actual source functions. */
// Executes one reviewed local synthetic harness with measured hard bounds.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const [scriptName, outFile, ...args] = process.argv.slice(2);
if (!scriptName || !outFile || !/^audit-[a-z0-9-]+\.cjs$/.test(scriptName)) throw new Error('Usage: audit-bounded-run.cjs audit-script.cjs new-result.json [args]');
if (fs.existsSync(outFile)) throw new Error('Result already exists');
const rss = pid => Number(execFileSync('/bin/ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8', timeout: 1000 }).trim()) * 1024;
if (!(rss(process.pid) > 0)) throw new Error('RSS watchdog unavailable');
const began = Date.now();
const child = spawn(process.execPath, ['--max-old-space-size=256', path.join(__dirname, scriptName), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '', observedRssBytes = 0, stopReason = null;
const stop = reason => { stopReason ||= reason; child.kill('SIGKILL'); };
child.stdout.on('data', data => { stdout += data; if (stdout.length > 1000000) stop('output limit'); });
child.stderr.on('data', data => { stderr += data; if (stderr.length > 1000000) stop('output limit'); });
const watcher = setInterval(() => { try { observedRssBytes = Math.max(observedRssBytes, rss(child.pid)); if (observedRssBytes > 512 * 1024 * 1024) stop('RSS limit'); } catch (error) { if (error.status !== 1) stop('RSS watchdog failed'); } }, 100);
const deadline = setTimeout(() => stop('wall time limit'), 60000);
child.on('error', () => stop('child spawn failed'));
child.on('close', (code, signal) => {
  clearInterval(watcher); clearTimeout(deadline);
  let output = null; try { output = JSON.parse(stdout); } catch {}
  const result = { script: scriptName, args, bounds: { heapMiB: 256, maxRssBytes: 512 * 1024 * 1024, wallMs: 60000, sampleMs: 100 }, code, signal, stopReason, elapsedMs: Date.now() - began, observedRssBytes, output, stderr: stderr.slice(0, 10000) };
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ script: scriptName, code, stopReason, elapsedMs: result.elapsedMs, observedRssBytes, checks: output?.checks, status: output?.status }));
  if (code !== 0 || stopReason || !output || output.status !== 'passed') process.exitCode = 1;
});
