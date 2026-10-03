#!/usr/bin/env python3
"""Local, public-synthetic PTY checks. Never prints captured terminal bytes.

No shell, network client, credential input, or caller-selected module is used.
Echo is checked while the exec-owned process lives; this does not claim to
control terminal echo or operator input after that process exits.
"""
import argparse
import errno
import json
import os
from pathlib import Path
import pty
import select
import shutil
import subprocess
import sys
import termios
import time


FIXTURE = r"""
import { read } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { readPrivateAdministrator, releasePrivateAdministratorInput } =
  await import(pathToFileURL(process.argv[1]).href);
const mode = process.argv[2];
const control = Number(process.argv[3]);
const publicValue = Buffer.from('PUBLIC_SYNTHETIC_NEVER_A_CREDENTIAL');
let passed = false;
try {
  const bytes = await readPrivateAdministrator({
    timeoutMs: mode === 'timeout' ? 300 : 5000,
    signal: mode === 'abort' ? AbortSignal.timeout(300) : undefined,
  });
  passed = mode === 'paste' && bytes.equals(publicValue);
  bytes.fill(0);
} catch (error) {
  passed = mode !== 'paste' && error?.message === 'native_private_entry_denied';
}
publicValue.fill(0);
if (!passed) process.exit(3);
if (mode === 'non_tty') {
  process.stdout.write('fixture_non_tty_denied\n');
  process.exit(0);
}
// Registered after the real held-input sink: observe its wipe, without
// displaying input, and synchronize the parent before releasing echo.
process.stdin.once('data', bytes => {
  if (!Buffer.isBuffer(bytes) || bytes.length !== 32 || !bytes.every(value => value === 0)) process.exit(4);
  process.stdout.write('fixture_late_drained\n');
});
process.stdout.write('fixture_held\n');
const controlBytes = Buffer.alloc(1);
read(control, controlBytes, 0, 1, null, (error, size) => {
  if (error || size !== 1 || controlBytes[0] !== 88) process.exit(5);
  controlBytes.fill(0);
  releasePrivateAdministratorInput();
  if (process.stdin.isRaw) process.exit(6);
  process.stdout.write('fixture_released\n', () => process.exit(0));
});
"""

PROMPT = b"native_private_administrator_entry_300_seconds\n"
PUBLIC = b"PUBLIC_SYNTHETIC_NEVER_A_CREDENTIAL"


def require(condition):
    if not condition:
        raise RuntimeError("synthetic_check_failed")


def drain(fd, captured, until=None, timeout=5):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        normalized = bytes(captured).replace(b"\r\n", b"\n")
        if until is not None and until in normalized:
            return
        ready, _, _ = select.select([fd], [], [], min(0.1, max(0, deadline - time.monotonic())))
        if ready:
            try:
                data = os.read(fd, 4096)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not data:
                break
            captured.extend(data)
            require(len(captured) <= 4096)
    require(until is None or until in bytes(captured).replace(b"\r\n", b"\n"))


def run_pty(node, module, mode):
    master, slave = pty.openpty()
    control_read, control_write = os.pipe()
    child = None
    captured = bytearray()
    try:
        initial = termios.tcgetattr(slave)
        require(initial[3] & termios.ECHO)
        child = subprocess.Popen(
            [node, "--input-type=module", "-e", FIXTURE, str(module), mode, str(control_read)],
            stdin=slave, stdout=slave, stderr=slave, pass_fds=(control_read,),
            env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"},
        )
        os.close(control_read)
        control_read = None
        drain(master, captured, PROMPT)
        require(not termios.tcgetattr(slave)[3] & termios.ECHO)
        if mode == "paste":
            require(os.write(master, PUBLIC + b"\n") == len(PUBLIC) + 1)
        elif mode == "cancel":
            require(os.write(master, PUBLIC + b"\x03") == len(PUBLIC) + 1)
        else:
            require(os.write(master, PUBLIC) == len(PUBLIC))
        drain(master, captured, b"fixture_held\n")
        require(not termios.tcgetattr(slave)[3] & termios.ECHO)
        require(os.write(master, b"L" * 32) == 32)
        drain(master, captured, b"fixture_late_drained\n")
        require(not termios.tcgetattr(slave)[3] & termios.ECHO)
        os.write(control_write, b"X")
        drain(master, captured, b"fixture_released\n")
        require(child.wait(timeout=5) == 0)
        drain(master, captured, timeout=0.1)
        require(termios.tcgetattr(slave) == initial)
        require(bytes(captured).replace(b"\r\n", b"\n") ==
                PROMPT + b"\nfixture_held\nfixture_late_drained\nfixture_released\n")
    finally:
        if child is not None and child.poll() is None:
            child.kill()
            child.wait(timeout=5)
        for fd in (master, slave, control_read, control_write):
            if fd is not None:
                os.close(fd)
        captured[:] = b"\0" * len(captured)


def main():
    class FixedArguments(argparse.ArgumentParser):
        def error(self, message):
            raise RuntimeError("synthetic_arguments_rejected")

    parser = FixedArguments(description=__doc__, add_help=False)
    parser.add_argument("--node")
    args = parser.parse_args()
    node = args.node if args.node is not None else shutil.which("node")
    require(node is not None and os.path.isabs(node) and os.access(node, os.X_OK))
    module = Path(__file__).resolve().parents[1] / "private-entry.mjs"
    require(module.is_file())
    checks = []
    for mode in ("paste", "timeout", "cancel", "abort"):
        run_pty(node, module, mode)
        checks.append(mode + "_no_echo_late_input_wiped_terminal_restored")
    result = subprocess.run(
        [node, "--input-type=module", "-e", FIXTURE, str(module), "non_tty", "-1"],
        input=PUBLIC + b"\n", stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5,
        env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"},
    )
    require(result.returncode == 0 and result.stdout == b"fixture_non_tty_denied\n" and not result.stderr)
    checks.append("non_tty_rejected")
    print(json.dumps({"outcome": "passed", "checks": checks}, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except BaseException:
        # A failing child or PTY must never turn its captured bytes into an
        # assertion traceback, subprocess diagnostic or fixture output.
        print('{"outcome":"private_pty_test_failed"}')
        sys.exit(1)
