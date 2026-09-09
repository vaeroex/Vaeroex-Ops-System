#!/usr/bin/env python3
"""Actual libpq + synthetic PostgreSQL/TLS wire fixture. Binds loopback only.

No database server, remote network target, PAT, broker credential, or SQL.
Only ephemeral synthetic TLS fixture keys/certificates are generated.
"""
import argparse
import os
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

def checked(command):
    r = subprocess.run(command, capture_output=True, timeout=30)
    if r.returncode:
        raise AssertionError('synthetic fixture build failed')

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

class Fixture:
    def __init__(self, ctx, mode):
        self.ctx, self.mode = ctx, mode
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.bind(('127.0.0.1', 0))
        self.sock.listen(2)
        self.sock.settimeout(.2)
        self.port = self.sock.getsockname()[1]
        self.count = self.passwords = self.queries = 0
        self.failure = None
        self.done = threading.Event()
        self.active = None
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
                    if self.mode == 'ssl_refused':
                        peer.sendall(b'N')
                        continue
                    peer.sendall(b'S')
                    try:
                        peer = self.ctx.wrap_socket(peer, server_side=True)
                    except ssl.SSLError:
                        # Expected when libpq rejects the deliberately wrong name.
                        continue
                    self.active = peer
                    n = struct.unpack('!I', exact(peer, 4))[0]
                    assert 8 <= n <= 4096
                    startup = exact(peer, n-4)
                    assert startup[:4] == struct.pack('!I', 196608)
                    fields = startup[4:].split(b'\0')
                    parsed = dict(zip(fields[0:-1:2], fields[1:-1:2]))
                    assert parsed[b'user'] == USER and parsed[b'database'] == b'postgres'
                    assert parsed[b'options'] == b'-c jit=true -c search_path=pg_catalog'
                    assert parsed[b'application_name'] == b'vaeroex_public_invalid_jit_canary'
                    if self.mode == 'stall':
                        self.done.wait(5)
                        continue
                    if self.mode == 'unsupported_auth':
                        peer.sendall(message(b'R', struct.pack('!I', 7)))  # GSS, forbidden.
                        continue
                    if self.mode == 'no_auth':
                        peer.sendall(message(b'R', struct.pack('!I', 0)))
                        continue
                    peer.sendall(message(b'R', struct.pack('!I', 3)))  # Cleartext over TLS.
                    kind = exact(peer, 1)
                    n = struct.unpack('!I', exact(peer, 4))[0]
                    assert kind == b'p' and 4 <= n <= 4096
                    assert exact(peer, n-4) == PUBLIC+b'\0'
                    self.passwords += 1
                    if self.mode == 'drop':
                        continue
                    if self.mode == 'success':
                        peer.sendall(message(b'R', struct.pack('!I', 0)) +
                                      message(b'K', struct.pack('!II', 123, 456)) +
                                      message(b'Z', b'I'))
                    elif self.mode == 'missing_state':
                        peer.sendall(error(None, b'hostile misleading :  28P01\n'))
                    elif self.mode == 'indistinguishable_missing_state':
                        peer.sendall(error(None, b'28P01'))
                    else:
                        code = b'XX000' if self.mode == 'wrong_state' else b'28P01'
                        # Authenticated protocol message deliberately echoes the public
                        # marker; client must never print notice/error payloads.
                        peer.sendall(error(code, b'HOSTILE_ECHO_' + PUBLIC))
                    try:
                        kind = peer.recv(1)
                        if kind and kind != b'X':
                            self.queries += 1
                    except (socket.timeout, ssl.SSLError):
                        pass
                except (EOFError, ConnectionResetError, BrokenPipeError, ssl.SSLError):
                    pass
                finally:
                    peer.close()
                    self.active = None
        except Exception as e:
            self.failure = type(e).__name__

    def close(self):
        self.done.set()
        self.sock.close()
        if self.active:
            try:
                self.active.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        self.thread.join(4)
        assert not self.thread.is_alive() and self.failure is None
        assert self.queries == 0

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-prefix', type=pathlib.Path, default=DEFAULT_PG)
    args = parser.parse_args()
    prefix = args.pg_prefix.resolve()
    include = prefix/'include'
    if not (include/'libpq-fe.h').is_file():
        include = prefix/'include/postgresql'
    assert (include/'libpq-fe.h').is_file()
    with tempfile.TemporaryDirectory(prefix='vaeroex-native-canary-') as value:
        tmp = pathlib.Path(value)
        assert "'" not in str(tmp)
        ca, key = tmp/'public-local-ca.pem', tmp/'synthetic-local-tls.key'
        checked(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                 '-subj', '/CN='+HOST, '-addext', 'subjectAltName=DNS:'+HOST,
                 '-keyout', str(key), '-out', str(ca)])
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(ca, key)
        base = ['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-O2',
                '-I'+str(include)]
        source = str(ROOT/'native-canary.c')
        blocked = tmp/'blocked'
        checked(base+[source, '-o', str(blocked)])
        r = subprocess.run([str(blocked), 'ignored'], capture_output=True, env=CLEAN)
        assert r.returncode == 78 and r.stdout == b'native_canary_hosted_execution_blocked\n'
        checked(base+['-DJIT_CANARY_APPROVED_SANDBOX_20260908', '-c', source,
                      '-o', str(tmp/'approved-not-executed.o')])
        count = 2
        for mode in ['reject', 'wrong_state', 'missing_state',
                     'indistinguishable_missing_state', 'success', 'drop',
                     'ssl_refused', 'unsupported_auth', 'no_auth', 'stall', 'cancel']:
            fixture = Fixture(ctx, 'stall' if mode == 'cancel' else mode)
            binary = tmp/'canary'
            checked(base+['-DJIT_CANARY_LOCAL_PROTOCOL',
                          '-DJIT_CANARY_LOCAL_PORT="'+str(fixture.port)+'"',
                          '-DJIT_CANARY_LOCAL_CA="'+str(ca)+'"', source,
                          '-L'+str(prefix/'lib'), '-Wl,-rpath,'+str(prefix/'lib'),
                          '-lpq', '-o', str(binary)])
            fixture.thread.start()
            try:
                process = subprocess.Popen([str(binary)], env=CLEAN, stdin=subprocess.DEVNULL,
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                if mode == 'cancel':
                    time.sleep(.3)
                    process.send_signal(signal.SIGTERM)
                output, err = process.communicate(timeout=10)
                assert PUBLIC not in output+err and b'HOSTILE' not in output+err
                assert not err
                if mode in ('reject', 'indistinguishable_missing_state'):
                    assert process.returncode == 0
                    assert b'native_canary_transport_observed_diagnostics_pending' in output
                    assert b'_28P01_hint' in output
                    assert fixture.count == 2 and fixture.passwords == 1
                elif mode == 'success':
                    assert process.returncode != 0 and b'unexpected_authentication' in output
                elif mode == 'cancel':
                    assert process.returncode == 75 and b'cancelled' in output
                else:
                    assert process.returncode != 0
                    assert b'canary_transport_observed' not in output
                    assert fixture.count == 1
            finally:
                fixture.close()
            count += 1
        # No network is started: arguments/environment must reject before DNS/I/O.
        for extra, env in [(['host=remote'], CLEAN), (['real-token-not-accepted'], CLEAN),
                           ([], {**CLEAN, 'PGPASSWORD':'synthetic-rejected'}),
                           ([], {**CLEAN, 'SSLKEYLOGFILE':''}),
                           ([], {**CLEAN, 'OPENSSL_CONF':''}),
                           ([], {**CLEAN, 'LD_PRELOAD':''}),
                           ([], {**CLEAN, 'HTTPS_PROXY':''})]:
            r = subprocess.run([str(binary), *extra], env=env, capture_output=True, timeout=3)
            assert r.returncode == 64 and b'rejected' in r.stdout
            count += 1
        print(f'{count} native-canary focused checks passed; actual libpq, loopback TLS only; no hosted qualification')

if __name__ == '__main__':
    main()
