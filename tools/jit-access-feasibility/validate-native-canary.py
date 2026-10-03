#!/usr/bin/env python3
"""Actual libpq + synthetic PostgreSQL/TLS wire fixture. Binds loopback only.

No database server, remote network target, PAT, broker credential, or SQL.
Only ephemeral synthetic TLS fixture keys/certificates are generated.
"""
import argparse
import hashlib
import pathlib
import signal
import socket
import ssl
import struct
import subprocess
import tempfile
import threading
import time

ROOT = pathlib.Path(__file__).resolve().parent
DEFAULT_PG = pathlib.Path('/private/tmp/vaeroex-square-pg176.ArIWfz/install')
PUBLIC = b'sbp_fcPUBLIC_INVALID_CANARY_20260908_NEVER_ISSUED'
HOST = 'aws-0-us-west-2.pooler.supabase.com'
USER = b'vaeroex_jit_feasibility_20260908.oysjpoondtcrqpghhrbd'
CLEAN = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}
FIELDS = {
    'completion': {'connect_failed', 'authenticated', 'timeout', 'cancelled',
                   'io_failed', 'socket_unavailable', 'allocation_failed', 'unknown'},
    'polling': {'not_polled', 'reading', 'writing', 'active', 'failed', 'ok', 'unknown'},
    'timeout': {'yes', 'no', 'unknown'},
    'tls_observed': {'yes', 'unknown'},
    'password_used': {'yes', 'no', 'unknown'},
    'rejection_hint': {'28P01', '28000', 'XX000', 'unclassified', 'unknown'},
    'expected_rejection_hint': {'yes', 'no', 'unknown'},
    'hostname_mismatch_hint': {'yes', 'no', 'unknown'},
}
LABELS = {
    'native_canary_hosted_execution_blocked', 'native_canary_unsupported_host',
    'native_canary_arguments_rejected', 'native_canary_environment_rejected',
    'native_canary_privacy_preflight_failed', 'native_canary_capability_failed',
    'native_canary_dns_failed', 'native_canary_window_exhausted',
    'native_canary_verified_tls_password_exchange_failure_28P01_hint',
    'native_canary_cancelled', 'native_canary_unexpected_authentication',
    'native_canary_auth_rejection_inconclusive', 'native_canary_tls_negative_inconclusive',
    'native_canary_tls_name_rejection_before_password',
    'native_canary_transport_observed_diagnostics_pending',
}
MODES = (
    'reject_28p01', 'prechallenge_28000', 'prechallenge_xx000',
    'postchallenge_28000', 'postchallenge_xx000', 'wrong_state', 'missing_state',
    'indistinguishable_missing_state', 'oversized_missing_state', 'success',
    'drop_before_password', 'drop_after_password', 'ssl_refused',
    'unsupported_auth', 'no_auth', 'unlistened_port',
    'timeout_before_password', 'timeout_after_password',
    'cancel_before_password', 'cancel_after_password',
    'alarm_before_password', 'alarm_after_password',
    'timeout_negative', 'cancel_negative', 'alarm_negative',
)


def checked(command, label):
    result = subprocess.run(command, capture_output=True, timeout=30)
    if result.returncode:
        # Name the failing synthetic build stage without exporting captured text.
        raise AssertionError(f'{label} failed with exit {result.returncode}')


def exact(sock, count):
    out = bytearray()
    while len(out) < count:
        data = sock.recv(count-len(out))
        if not data:
            raise EOFError()
        out.extend(data)
    return bytes(out)


def message(kind, payload):
    return kind + struct.pack('!I', len(payload)+4) + payload


def error(code, primary):
    fields = b'SFATAL\x00VFATAL\x00'
    if code is not None:
        fields += b'C' + code + b'\x00'
    return message(b'E', fields + b'M' + primary + b'\x00\x00')


def finite_output(output, err):
    assert not err, 'unexpected canary stderr or sanitizer finding'
    assert len(output) <= 8192 and output.endswith(b'\n'), 'unbounded/incomplete output'
    assert PUBLIC not in output and b'HOSTILE' not in output, 'hostile payload escaped'
    result = {'labels': set(), 'primary': {}, 'hostname_negative': {}}
    for line in output.decode('ascii').splitlines():
        if line in LABELS:
            assert line not in result['labels'], 'duplicate aggregate label'
            result['labels'].add(line)
            continue
        assert line.count('=') == 1, 'non-allowlisted canary output'
        key, value = line.split('=')
        if key == 'native_canary_hostname_negative_ran':
            assert value in {'yes', 'no'} and 'negative_ran' not in result
            result['negative_ran'] = value
            continue
        if key == 'native_canary_current_attempt_observations':
            assert value == 'unknown' and 'alarm_observations' not in result
            result['alarm_observations'] = value
            continue
        matched = False
        for phase in ('primary', 'hostname_negative'):
            prefix = 'native_canary_' + phase + '_'
            if key.startswith(prefix):
                field = key[len(prefix):]
                assert field in FIELDS and value in FIELDS[field], 'unknown field/value'
                assert field not in result[phase], 'duplicate observation field'
                result[phase][field] = value
                matched = True
                break
        assert matched, 'non-allowlisted observation key'
    for phase in ('primary', 'hostname_negative'):
        assert not result[phase] or result[phase].keys() == FIELDS.keys(), 'partial record'
    return result


def expect(record, field, value, mode):
    choices = value if isinstance(value, set) else {value}
    assert record[field] in choices, (mode, field, record[field], sorted(choices))


class Fixture:
    def __init__(self, ctx, mode):
        self.ctx, self.mode = ctx, mode
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.bind(('127.0.0.1', 0))
        self.port = self.sock.getsockname()[1]
        self.count = self.passwords = self.queries = 0
        self.failure = None
        self.done = threading.Event()
        self.before_password = threading.Event()
        self.after_password = threading.Event()
        self.negative_inflight = threading.Event()
        self.active = None
        self.thread = None
        if mode != 'unlistened_port':
            self.sock.listen(2)
            self.sock.settimeout(.2)
            self.thread = threading.Thread(target=self.serve, daemon=True)

    def serve(self):
        try:
            while not self.done.is_set():
                try:
                    peer, address = self.sock.accept()
                except socket.timeout:
                    continue
                except OSError:
                    break
                assert address[0] == '127.0.0.1'
                self.count += 1
                assert self.count <= 2
                peer.settimeout(3)
                self.active = peer
                try:
                    assert exact(peer, 8) == struct.pack('!II', 8, 80877103)
                    if self.count == 2 and self.mode.endswith('_negative'):
                        self.negative_inflight.set()
                        self.done.wait(5)
                        continue
                    if self.mode == 'ssl_refused':
                        peer.sendall(b'N')
                        continue
                    peer.sendall(b'S')
                    try:
                        peer = self.ctx.wrap_socket(peer, server_side=True)
                    except ssl.SSLError:
                        # The independent negative rejects this same endpoint's name.
                        continue
                    self.active = peer
                    size = struct.unpack('!I', exact(peer, 4))[0]
                    assert 8 <= size <= 4096
                    startup = exact(peer, size-4)
                    assert startup[:4] == struct.pack('!I', 196608)
                    fields = startup[4:].split(b'\0')
                    parsed = dict(zip(fields[0:-1:2], fields[1:-1:2]))
                    assert parsed[b'user'] == USER and parsed[b'database'] == b'postgres'
                    assert parsed[b'options'] == b'-c jit=true -c search_path=pg_catalog'
                    assert parsed[b'application_name'] == b'vaeroex_public_invalid_jit_canary'
                    self.before_password.set()
                    if self.mode.endswith('_before_password'):
                        if not self.mode.startswith('drop_'):
                            self.done.wait(5)
                        continue
                    if self.mode.startswith('prechallenge_'):
                        code = b'28000' if self.mode.endswith('28000') else b'XX000'
                        peer.sendall(error(code, b'HOSTILE_PREAUTH_' + PUBLIC))
                    elif self.mode == 'unsupported_auth':
                        peer.sendall(message(b'R', struct.pack('!I', 7)))  # GSS forbidden.
                    elif self.mode == 'no_auth':
                        peer.sendall(message(b'R', struct.pack('!I', 0)))
                    else:
                        peer.sendall(message(b'R', struct.pack('!I', 3)))  # Password over TLS.
                        kind = exact(peer, 1)
                        size = struct.unpack('!I', exact(peer, 4))[0]
                        assert kind == b'p' and 4 <= size <= 4096
                        assert exact(peer, size-4) == PUBLIC+b'\0'
                        self.passwords += 1
                        self.after_password.set()
                        if self.mode.endswith('_after_password'):
                            if not self.mode.startswith('drop_'):
                                self.done.wait(5)
                            continue
                        if self.mode == 'success':
                            peer.sendall(message(b'R', struct.pack('!I', 0)) +
                                         message(b'K', struct.pack('!II', 123, 456)) +
                                         message(b'Z', b'I'))
                        else:
                            code, primary = b'28P01', b'HOSTILE_ECHO_' + PUBLIC
                            if self.mode == 'postchallenge_28000':
                                code = b'28000'
                            elif self.mode == 'postchallenge_xx000':
                                code = b'XX000'
                            elif self.mode == 'wrong_state':
                                code = b'42501'
                            elif self.mode == 'missing_state':
                                code, primary = None, b'HOSTILE misleading :  28P01\n'
                            elif self.mode == 'indistinguishable_missing_state':
                                code, primary = None, b'28P01'
                            elif self.mode == 'oversized_missing_state':
                                code, primary = None, b'HOSTILE_' + PUBLIC + b'x'*17000
                            peer.sendall(error(code, primary))
                    try:
                        kind = peer.recv(1)
                        if kind:
                            assert kind == b'X', 'unexpected frontend message'
                            assert exact(peer, 4) == struct.pack('!I', 4)
                    except (socket.timeout, ssl.SSLError):
                        pass
                except (EOFError, ConnectionResetError, BrokenPipeError, ssl.SSLError):
                    pass
                except AssertionError:
                    self.queries += 1
                    raise
                finally:
                    peer.close()
                    self.active = None
        except Exception as exc:
            self.failure = type(exc).__name__

    def start(self):
        if self.thread:
            self.thread.start()

    def close(self):
        self.done.set()
        self.sock.close()
        active = self.active
        if active:
            try:
                active.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        if self.thread:
            self.thread.join(4)
            assert not self.thread.is_alive()
        assert self.failure is None and self.queries == 0, (self.mode, self.failure)


def check_case(mode, fixture, result, returncode):
    labels, primary, negative = result['labels'], result['primary'], result['hostname_negative']
    if mode.startswith('alarm_'):
        assert returncode == 75 and result.get('alarm_observations') == 'unknown'
        assert 'native_canary_window_exhausted' in labels
        assert result['negative_ran'] == ('yes' if mode.endswith('_negative') else 'no')
        assert bool(primary) == mode.endswith('_negative') and not negative
        assert fixture.count == (2 if mode.endswith('_negative') else 1)
        return
    assert 'alarm_observations' not in result and primary
    completion = ('authenticated' if mode == 'success' else
                  'timeout' if mode.startswith('timeout_') and not mode.endswith('_negative') else
                  'cancelled' if mode.startswith('cancel_') and not mode.endswith('_negative') else
                  'connect_failed')
    if mode == 'unlistened_port':
        # Keep the ephemeral port reserved so another local service cannot take
        # it. A bound but unlistened TCP port can refuse or stall by platform.
        expect(primary, 'completion', {'connect_failed', 'timeout'}, mode)
        completion = primary['completion']
    expect(primary, 'completion', completion, mode)
    expect(primary, 'timeout', 'yes' if completion == 'timeout' else
           'unknown' if completion == 'cancelled' else 'no', mode)
    if completion in ('timeout', 'cancelled'):
        expect(primary, 'polling', {'not_polled', 'reading', 'writing', 'active'}
               if mode == 'unlistened_port' else {'reading', 'writing', 'active'}, mode)
    else:
        expect(primary, 'polling', 'ok' if mode == 'success' else 'failed', mode)
    password_used = not (mode.startswith('prechallenge_') or mode.endswith('_before_password') or
                        mode in ('ssl_refused', 'unsupported_auth', 'no_auth', 'unlistened_port'))
    expect(primary, 'password_used', 'yes' if password_used else 'no', mode)
    expect(primary, 'tls_observed', 'unknown' if mode in ('ssl_refused', 'unlistened_port')
           else 'yes', mode)
    if completion == 'connect_failed':
        hint = ('28000' if mode.endswith('28000') else
                'XX000' if mode.endswith('xx000') else
                'unknown' if mode == 'oversized_missing_state' else
                '28P01' if mode in ('reject_28p01', 'indistinguishable_missing_state') or
                mode.endswith('_negative') else 'unclassified')
        expect(primary, 'rejection_hint', hint, mode)
        expect(primary, 'expected_rejection_hint', 'yes' if hint == '28P01' else
               'unknown' if hint == 'unknown' else 'no', mode)
        expect(primary, 'hostname_mismatch_hint', 'unknown' if hint == 'unknown' else 'no', mode)
    else:
        for field in ('rejection_hint', 'expected_rejection_hint', 'hostname_mismatch_hint'):
            expect(primary, field, 'unknown', mode)
    negative_ran = completion == 'connect_failed' and mode not in ('ssl_refused', 'unlistened_port')
    assert result['negative_ran'] == ('yes' if negative_ran else 'no'), mode
    assert bool(negative) == negative_ran, mode
    assert fixture.count == (0 if mode == 'unlistened_port' else 2 if negative_ran else 1), mode
    assert fixture.passwords == int(password_used), mode
    if negative_ran:
        ending = ('timeout' if mode == 'timeout_negative' else
                  'cancelled' if mode == 'cancel_negative' else 'connect_failed')
        expect(negative, 'completion', ending, mode)
        expect(negative, 'timeout', 'yes' if ending == 'timeout' else
               'unknown' if ending == 'cancelled' else 'no', mode)
        expect(negative, 'password_used', 'no', mode)
        # A failed name check can still expose TLS-in-use during polling.
        # The deliberately stalled negative never receives the SSL acceptance.
        expect(negative, 'tls_observed', {'yes', 'unknown'} if ending == 'connect_failed'
               else 'unknown', mode)
        expect(negative, 'polling', 'failed' if ending == 'connect_failed' else
               {'reading', 'writing', 'active'}, mode)
        expect(negative, 'hostname_mismatch_hint', 'yes' if ending == 'connect_failed' else 'unknown', mode)
        expect(negative, 'rejection_hint', 'unclassified' if ending == 'connect_failed' else 'unknown', mode)
        expect(negative, 'expected_rejection_hint', 'no' if ending == 'connect_failed' else 'unknown', mode)
    strong = mode in ('reject_28p01', 'indistinguishable_missing_state') or mode.endswith('_negative')
    assert ('native_canary_verified_tls_password_exchange_failure_28P01_hint' in labels) == strong
    passed = mode in ('reject_28p01', 'indistinguishable_missing_state')
    assert ('native_canary_transport_observed_diagnostics_pending' in labels) == passed
    assert ('native_canary_tls_name_rejection_before_password' in labels) == passed
    assert returncode == (0 if passed else 75 if mode.startswith('cancel_') else 1), mode
    if not passed:
        label = ('native_canary_cancelled' if mode.startswith('cancel_') else
                 'native_canary_unexpected_authentication' if mode == 'success' else
                 'native_canary_tls_negative_inconclusive' if mode == 'timeout_negative' else
                 'native_canary_auth_rejection_inconclusive')
        assert label in labels, mode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-prefix', type=pathlib.Path, default=DEFAULT_PG)
    instrument = parser.add_mutually_exclusive_group()
    instrument.add_argument('--ubsan', action='store_true', help='Instrument with UBSan')
    instrument.add_argument('--sanitize', action='store_true', help='Instrument with ASan and UBSan')
    args = parser.parse_args()
    prefix = args.pg_prefix.resolve()
    include = prefix/'include'
    if not (include/'libpq-fe.h').is_file():
        include = prefix/'include/postgresql'
    assert (include/'libpq-fe.h').is_file()
    assert hashlib.sha256((ROOT/'supabase-root-2021.crt').read_bytes()).hexdigest() == '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7'
    assert '#define CANARY_CA "/etc/vaeroex-jit/supabase-root-2021.crt"' in (ROOT/'native-canary.c').read_text()
    with tempfile.TemporaryDirectory(prefix='vaeroex-native-canary-') as value:
        tmp = pathlib.Path(value)
        assert "'" not in str(tmp)
        ca, key = tmp/'public-local-ca.pem', tmp/'synthetic-local-tls.key'
        checked(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                 '-subj', '/CN='+HOST, '-addext', 'subjectAltName=DNS:'+HOST,
                 '-keyout', str(key), '-out', str(ca)], 'loopback TLS fixture generation')
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(ca, key)
        base = ['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-O2', '-I'+str(include)]
        if args.ubsan or args.sanitize:
            base += ['-fsanitize='+('address,undefined' if args.sanitize else 'undefined'),
                     '-fno-omit-frame-pointer']
        source = str(ROOT/'native-canary.c')
        blocked = tmp/'blocked'
        checked(base+[source, '-o', str(blocked)], 'ordinary-profile compile')
        result = subprocess.run([str(blocked), 'ignored'], capture_output=True, env=CLEAN)
        finite_output(result.stdout, result.stderr)
        assert result.returncode == 78 and result.stdout == b'native_canary_hosted_execution_blocked\n'
        checked(base+['-DJIT_CANARY_APPROVED_SANDBOX_20260908', '-c', source,
                      '-o', str(tmp/'approved-not-executed.o')], 'approved-profile compile only')
        count = 2
        # Reproduce the hosted trust failure with an independent, untrusted CA.
        # Both failures must stop before any password/SQL; no system-root fallback.
        wrong_ca = tmp/'untrusted-local-ca.pem'
        checked(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                 '-subj', '/CN=unrelated-local-root', '-keyout', str(tmp/'unrelated.key'),
                 '-out', str(wrong_ca)], 'unrelated synthetic trust root')
        for trust in (wrong_ca, tmp/'missing-ca.pem'):
            fixture = Fixture(ctx, 'reject_28p01')
            binary = tmp/'trust-negative'
            checked(base+['-DJIT_CANARY_LOCAL_PROTOCOL',
                          '-DJIT_CANARY_LOCAL_PORT="'+str(fixture.port)+'"',
                          '-DJIT_CANARY_LOCAL_CA="'+str(trust)+'"', source,
                          '-L'+str(prefix/'lib'), '-Wl,-rpath,'+str(prefix/'lib'),
                          '-lpq', '-o', str(binary)], 'untrusted/missing CA compile')
            fixture.start()
            try:
                result = subprocess.run([str(binary)], env=CLEAN, stdin=subprocess.DEVNULL,
                                        capture_output=True, timeout=10)
                parsed = finite_output(result.stdout, result.stderr)
                assert result.returncode == 1
                assert parsed['primary']['completion'] == 'connect_failed'
                assert parsed['primary']['password_used'] == 'no'
                assert 'native_canary_transport_observed_diagnostics_pending' not in parsed['labels']
                assert fixture.passwords == 0 and fixture.queries == 0
            finally:
                fixture.close()
            count += 1
        for mode in MODES:
            fixture = Fixture(ctx, mode)
            binary = tmp/'canary'
            checked(base+['-DJIT_CANARY_LOCAL_PROTOCOL',
                          '-DJIT_CANARY_LOCAL_PORT="'+str(fixture.port)+'"',
                          '-DJIT_CANARY_LOCAL_CA="'+str(ca)+'"', source,
                          '-L'+str(prefix/'lib'), '-Wl,-rpath,'+str(prefix/'lib'),
                          '-lpq', '-o', str(binary)], 'loopback-profile compile for '+mode)
            fixture.start()
            process = None
            try:
                process = subprocess.Popen([str(binary)], env=CLEAN, stdin=subprocess.DEVNULL,
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                if mode.startswith(('cancel_', 'alarm_')):
                    ready = (fixture.negative_inflight if mode.endswith('_negative') else
                             fixture.after_password if mode.endswith('_after_password') else
                             fixture.before_password)
                    assert ready.wait(3), (mode, 'fixture phase not reached')
                    time.sleep(.03)
                    process.send_signal(signal.SIGALRM if mode.startswith('alarm_') else signal.SIGTERM)
                output, err = process.communicate(timeout=10)
                check_case(mode, fixture, finite_output(output, err), process.returncode)
            finally:
                if process is not None and process.poll() is None:
                    process.kill()
                    process.communicate(timeout=3)
                fixture.close()
            count += 1
        # No listener is started: arguments/environment must reject before DNS/I/O.
        for extra, env in [(['host=remote'], CLEAN), (['real-token-not-accepted'], CLEAN),
                           ([], {**CLEAN, 'PGPASSWORD':'synthetic-rejected'}),
                           ([], {**CLEAN, 'SSLKEYLOGFILE':''}),
                           ([], {**CLEAN, 'OPENSSL_CONF':''}),
                           ([], {**CLEAN, 'LD_PRELOAD':''}),
                           ([], {**CLEAN, 'HTTPS_PROXY':''})]:
            result = subprocess.run([str(binary), *extra], env=env, capture_output=True, timeout=3)
            parsed = finite_output(result.stdout, result.stderr)
            assert result.returncode == 64 and not parsed['primary'] and not parsed['hostname_negative']
            expected = 'native_canary_arguments_rejected' if extra else 'native_canary_environment_rejected'
            assert parsed['labels'] == {expected} and 'negative_ran' not in parsed
            count += 1
        print(f'{count} native-canary focused checks passed; actual libpq, loopback TLS only; no hosted qualification')


if __name__ == '__main__':
    main()
