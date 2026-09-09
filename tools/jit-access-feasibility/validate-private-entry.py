#!/usr/bin/env python3
"""Focused fake-library/PTY clock tests; no sockets, hosted calls or real tokens."""
import argparse
import os
import pathlib
import pty
import select
import subprocess
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent
SENTINEL = b'sbp_fcPRIVATE_ENTRY_SYNTHETIC_ONLY_' * 5
ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}


def run_pty(command, payload=SENTINEL + b'\n', admin=False):
    pid, fd = pty.fork()
    if pid == 0:
        os.execve(str(command[0]), list(map(str, command)), ENV)
    output = bytearray()
    entered = cued = False
    status = None
    until = time.monotonic() + 8
    try:
        while time.monotonic() < until:
            if select.select([fd], [], [], .02)[0]:
                try:
                    chunk = os.read(fd, 65536)
                except OSError:
                    chunk = b''
                output.extend(chunk)
            if not entered and b'private_token_entry' in output:
                os.write(fd, payload)
                entered = True
            if admin and not cued and b'jit_admin_ready_' in output:
                os.write(fd, b'q\n')
                cued = True
            found, value = os.waitpid(pid, os.WNOHANG)
            if found:
                status = value
                while select.select([fd], [], [], .02)[0]:
                    try:
                        chunk = os.read(fd, 65536)
                    except OSError:
                        break
                    if not chunk:
                        break
                    output.extend(chunk)
                break
        if status is None:
            os.kill(pid, 9)
            os.waitpid(pid, 0)
            raise AssertionError(('bounded synthetic fixture timed out', str(command[0].name),
                                  str(command[-1]), entered, cued,
                                  b'jit_admin_ready_' in output, b'initial_scope_pass' in output))
    finally:
        os.close(fd)
    assert b'PRIVATE_ENTRY_SYNTHETIC_ONLY' not in output, 'synthetic input echoed'
    assert not os.WIFSIGNALED(status), bytes(output)
    return bytes(output), os.WEXITSTATUS(status)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--include', type=pathlib.Path, required=True,
                        help='Explicit local libpq header directory (no machine-specific default)')
    parser.add_argument('--ubsan', action='store_true')
    parser.add_argument('--sanitize', action='store_true')
    args = parser.parse_args()
    if args.ubsan and args.sanitize:
        parser.error('choose one sanitizer profile')
    flags = ['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-I' + str(args.include)]
    if args.ubsan or args.sanitize:
        flags += ['-fsanitize=' + ('address,undefined' if args.sanitize else 'undefined'),
                  '-fno-omit-frame-pointer']
    count = 0
    with tempfile.TemporaryDirectory(prefix='jit-private-entry-offline-') as name:
        temp = pathlib.Path(name)
        for admin in (True, False):
            source = ROOT / ('admin-helper.c' if admin else 'runner.c')
            profile = ['-DENTRY_ADMIN', '-DJIT_ADMIN_LOCAL_MOCK'] if admin else ['-DJIT_LOCAL_MOCK']
            mocks = [ROOT / 'fake-admin-curl.c'] if admin else [ROOT / 'fake_libpq.c', ROOT / 'fake_curl.c']

            def build(actual, binary):
                subprocess.run(flags + profile + ['-DENTRY_SOURCE="' + str(actual) + '"',
                               str(ROOT / 'private-entry-clock-test.c')] + list(map(str, mocks)) +
                               ['-o', str(binary)], check=True)

            binary = temp / ('admin' if admin else 'runner')
            build(source, binary)
            for case in ('after_sixty', 'before_limit', 'at_limit', 'ready_at_limit',
                         'ready_after_deadline', 'earlier_deadline', 'partial_timeout',
                         'rolling_input', 'cancel_partial', 'invalid_input'):
                payload = b'sbp_fcBAD SPACE\n' if case == 'invalid_input' else SENTINEL + b'\n'
                output, status = run_pty([binary, case], payload, admin)
                assert b'entry_test_wipe_tty_and_call_boundary_pass' in output, (case, output)
                if case in ('after_sixty', 'before_limit'):
                    assert status == 0, (case, output)
                elif case in ('at_limit', 'ready_at_limit', 'ready_after_deadline',
                              'earlier_deadline', 'partial_timeout', 'rolling_input'):
                    assert status != 0 and b'private_input_timed_out' in output, (case, output)
                elif case == 'cancel_partial':
                    assert status != 0 and b'cancelled' in output, (case, output)
                else:
                    assert status != 0 and b'private_input_rejected' in output, (case, output)
                count += 1

            # Restore only the former entry budget in an isolated synthetic copy.
            original = source.read_text()
            assert original.count('PRIVATE_ENTRY_SECONDS = 300') == 1
            old = temp / source.name
            old.write_text(original.replace('PRIVATE_ENTRY_SECONDS = 300', 'PRIVATE_ENTRY_SECONDS = 60'))
            old_binary = temp / ('old-admin' if admin else 'old-runner')
            build(old, old_binary)
            output, status = run_pty([old_binary, 'after_sixty'], admin=admin)
            assert status != 0 and b'private_input_timed_out' in output
            count += 1

        # A disposable outer shell is replaced, not left waiting for the child.
        # Queued bytes cannot execute its following command. This is not a claim
        # about terminal-emulator recording, echo after exit or automatic restart.
        child = temp / 'disposable-child.py'
        child.write_text("import os,termios,time\na=termios.tcgetattr(0)\na[3]&=~(termios.ECHO|termios.ECHONL|termios.ICANON)\ntermios.tcsetattr(0,termios.TCSAFLUSH,a)\nprint('private_token_entry',flush=True)\ntime.sleep(.1)\nos._exit(0)\n")
        python = os.path.realpath(os.sys.executable)
        command = ['/bin/sh', '-c', 'exec "$1" -I -S "$2"; printf SHELL_CONTINUATION',
                   'disposable-test', python, str(child)]
        output, status = run_pty(command, b'printf LATE_INPUT_EXECUTED\n')
        assert status == 0 and b'SHELL_CONTINUATION' not in output and b'LATE_INPUT_EXECUTED' not in output
        count += 1
    print(f'{count} private-entry clock/PTY checks PASS; no hosted credentials or calls')


if __name__ == '__main__':
    main()
