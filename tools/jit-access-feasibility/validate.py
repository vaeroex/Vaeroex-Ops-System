#!/usr/bin/env python3
"""Local fake-library/PTY tests only. Never connects to a database/API or reads a PAT."""
import os
import argparse
import pathlib
import pty
import select
import signal
import subprocess
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent
INCLUDE = pathlib.Path('/private/tmp/vaeroex-square-pg176.ArIWfz/install/include')
SENTINEL = b'sbp_fc' + b'LOCAL_SYNTHETIC_ONLY_' * 8
assert 128 <= len(SENTINEL) <= 4096

def run_tty(binary, case='success', payload=SENTINEL+b'\n', mode='probe', after=b'', cancel=False):
    pid, fd = pty.fork()
    if pid == 0:
        os.execve(str(binary), [str(binary), mode, '12345'], {'PATH':'/usr/bin:/bin', 'JIT_MOCK_CASE':case})
    output = bytearray()
    sent = False
    after_sent = False
    until = time.monotonic()+10
    status = None
    try:
        while time.monotonic()<until:
            if select.select([fd], [], [], .05)[0]:
                try:
                    chunk = os.read(fd, 16384)
                except OSError:
                    chunk = b''
                if chunk:
                    output.extend(chunk)
            if not sent and b'private_token_entry' in output:
                # Input is sent only after the native process disabled echo.
                os.write(fd, payload)
                sent = True
                if cancel:
                    os.kill(pid, signal.SIGTERM)
            if after and not after_sent and b'observe_ready' in output:
                os.write(fd, after)
                after_sent = True
            found, result = os.waitpid(pid, os.WNOHANG)
            if found:
                status = result
                # Drain final finite labels, if any.
                while select.select([fd], [], [], .02)[0]:
                    try: chunk=os.read(fd, 16384)
                    except OSError: break
                    if not chunk: break
                    output.extend(chunk)
                break
        if status is None:
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid,0)
            raise AssertionError('bounded fixture timed out')
    finally:
        os.close(fd)
    assert SENTINEL not in output, ('synthetic credential leaked', bytes(output).replace(SENTINEL,b'[REDACTED_SYNTHETIC]'))
    assert b'LOCAL_SYNTHETIC_ONLY' not in output, 'synthetic credential fragment leaked'
    assert not os.WIFSIGNALED(status), output.decode(errors='replace')
    return bytes(output), os.WEXITSTATUS(status)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--include',type=pathlib.Path,default=INCLUDE,help='Nonsecret libpq include directory for the local compile only')
    include=parser.parse_args().include
    with tempfile.TemporaryDirectory(prefix='jit-local-mock-') as temp:
        temp=pathlib.Path(temp)
        blocked=temp/'blocked'
        local=temp/'local'
        args=['cc','-std=c11','-Wall','-Wextra','-Werror','-I'+str(include)]
        subprocess.run(args+[str(ROOT/'runner.c'),'-o',str(blocked)],check=True)
        subprocess.run(args+['-DJIT_LOCAL_MOCK',str(ROOT/'runner.c'),str(ROOT/'fake_libpq.c'),str(ROOT/'fake_curl.c'),'-o',str(local)],check=True)
        # Compile the approved profile against real headers; never execute it here.
        subprocess.run(args+['-DJIT_APPROVED_SANDBOX_20260908','-c',str(ROOT/'runner.c'),'-o',str(temp/'hosted.o')],check=True)
        p=subprocess.run([str(blocked)],capture_output=True,check=False)
        assert p.returncode==78 and p.stdout==b'hosted_execution_blocked\n'
        for label, args, env in [
            ('arguments_rejected',[str(local),'probe','12345',SENTINEL.decode()],{}),
            ('arguments_rejected',[str(local),'probe','host=remote'],{}),
            ('environment_rejected',[str(local),'probe','12345'],{'PGPASSWORD':SENTINEL.decode()}),
            ('environment_rejected',[str(local),'probe','12345'],{'SUPABASE_ACCESS_TOKEN':SENTINEL.decode()}),
            ('private_input_rejected',[str(local),'probe','12345'],{}),
        ]:
            p=subprocess.run(args,env={'PATH':'/usr/bin:/bin',**env},input=SENTINEL+b'\n',capture_output=True)
            assert label.encode() in p.stdout and SENTINEL not in p.stdout+p.stderr
        for key in ['LD_PRELOAD','DYLD_INSERT_LIBRARIES','HTTP_PROXY','http_proxy',
                    'HTTPS_PROXY','https_proxy','ALL_PROXY','all_proxy','NO_PROXY','no_proxy',
                    'SSLKEYLOGFILE','GNUTLS_KEYLOGFILE','CURL_CA_BUNDLE','SSL_CERT_FILE','SSL_CERT_DIR',
                    'OPENSSL_CONF','OPENSSL_MODULES','OPENSSL_ENGINES','OPENSSL_TRACE']:
            p=subprocess.run([str(local),'probe','12345'],env={'PATH':'/usr/bin:/bin',key:''},capture_output=True)
            assert p.stdout==b'environment_rejected\n', (key,p.stdout)
        for case, label in [
            ('success','probe_pass'),('connection_failure','connection_rejected'),
            ('tls_mismatch','connection_rejected'),('tls_absent','connection_rejected'),
            ('wrong_identity','scope_assertion_failed'),('row_leak','scope_assertion_failed'),
            ('wrong_database','scope_assertion_failed'),('unexpected_membership','scope_assertion_failed'),
            ('excess_privilege','scope_assertion_failed'),('reconnect_failure','reconnection_failed'),
        ]:
            output, status=run_tty(local,case=case)
            assert label.encode() in output, (case,output)
            assert (status==0)==(case=='success'),(case,status)
        output,status=run_tty(local,case='pq1615')
        assert b'probe_pass' in output and status==0
        for case in ['pq1614','pq1519','pq1806','pq_missing_sslcertmode',
                     'pq_missing_auth','pq_wrong_auth','pq_parse_failure']:
            output,status=run_tty(local,case=case)
            assert b'transport_preflight_failed' in output and b'private_token_entry' not in output and status!=0
        output,status=run_tty(local,case='unsupported_auth_method')
        assert b'connection_rejected' in output and status!=0
        for case in ['http_redirect','http_permitted','http_second_permitted','http_server_error',
                     'http_unauthorized','http_not_found','http_tls_failure','http_timeout',
                     'http_oversized_body','http_oversized_headers','http_option_failure']:
            output,status=run_tty(local,case=case)
            assert b'api_scope_failed' in output and status!=0
        output,status=run_tty(local,case='http_cancel')
        assert b'cancelled' in output and status!=0
        for payload in [b'sbp_fc\n',b'wrong'+SENTINEL+b'\n',SENTINEL+b'!bad\n',SENTINEL+b'A'*4097+b'\n']:
            output,status=run_tty(local,payload=payload)
            assert b'private_input_rejected' in output and status!=0
        for size in [7,128,4096]:
            output,status=run_tty(local,payload=b'sbp_fc'+b'A'*(size-6)+b'\n')
            assert b'probe_pass' in output and status==0
        output,status=run_tty(local,payload=SENTINEL[:32],cancel=True)
        assert b'cancelled' in output and status!=0
        for case, existing in [('revoked','existing_session_usable'),('fenced','existing_session_unusable')]:
            output,status=run_tty(local,case=case,mode='observe',after=b'r\ns\nq\n')
            assert b'new_session_rejected' in output and existing.encode() in output and status==0
        for cue,label in [(b'r','new_session_accepted'),(b's','existing_session_usable')]:
            output,status=run_tty(local,mode='observe',after=(cue+b'\n')*59)
            assert output.count(label.encode())==58 and b'attempt_budget_exhausted' in output and status==75
        output,status=run_tty(local,mode='observe',after=b'n\ns\nq\n')
        assert b'held_session_replaced' in output and b'existing_session_usable' in output and status==0
    print('PASS: 69 local gate/input/version/capability/TLS/API/identity/scope/reconnect/observation cases; no hosted authentication tested')

if __name__=='__main__': main()
