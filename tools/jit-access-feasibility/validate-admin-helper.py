#!/usr/bin/env python3
"""Offline fake-libcurl and private PTY tests. No sockets, tokens or provider calls."""
import argparse
import os
import pathlib
import pty
import select
import signal
import subprocess
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent
SENTINEL = b'sbp_fcADMIN_SYNTHETIC_SENTINEL_ONLY_' * 5
END = '1788883600'
ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}

def tty_run(binary, case='success', cues=b'i\nr\nt\nx\nf\nx\nq\n', payload=SENTINEL+b'\n', cancel=False):
    pid, fd = pty.fork()
    if pid == 0:
        os.execve(str(binary), [str(binary), END], {**ENV, 'JIT_ADMIN_MOCK_CASE':case})
    output = bytearray()
    entered = prompted = False
    status = None
    until = time.monotonic()+8
    try:
        while time.monotonic()<until:
            if select.select([fd], [], [], .02)[0]:
                try: chunk=os.read(fd,65536)
                except OSError: chunk=b''
                output.extend(chunk)
            if not entered and b'jit_admin_private_token_entry' in output:
                # The actual native TTY has disabled echo before this label.
                os.write(fd,payload)
                entered=True
                if cancel: os.kill(pid,signal.SIGTERM)
            if not prompted and b'jit_admin_ready_' in output:
                os.write(fd,cues)
                prompted=True
            found,result=os.waitpid(pid,os.WNOHANG)
            if found:
                status=result
                while select.select([fd], [], [], .02)[0]:
                    try: chunk=os.read(fd,65536)
                    except OSError: break
                    if not chunk: break
                    output.extend(chunk)
                break
        if status is None:
            os.kill(pid,signal.SIGKILL)
            os.waitpid(pid,0)
            raise AssertionError('bounded synthetic fixture timed out')
    finally:
        os.close(fd)
    assert SENTINEL not in output and b'ADMIN_SYNTHETIC_SENTINEL' not in output, 'synthetic credential leaked'
    assert not os.WIFSIGNALED(status), output.decode(errors='replace')
    return bytes(output),os.WEXITSTATUS(status)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sanitize',action='store_true',help='Also instrument this new local mock executable with AddressSanitizer/UBSan')
    parser.add_argument('--ubsan',action='store_true',help='Instrument with UBSan alone when platform AddressSanitizer cannot initialize')
    args=parser.parse_args()
    if args.sanitize and args.ubsan: parser.error('choose one sanitizer profile')
    count=0
    with tempfile.TemporaryDirectory(prefix='jit-admin-offline-') as tmp:
        tmp=pathlib.Path(tmp)
        blocked,local=tmp/'blocked',tmp/'local'
        cc=['cc','-std=c11','-Wall','-Wextra','-Werror']
        subprocess.run(cc+[str(ROOT/'admin-helper.c'),'-o',str(blocked)],check=True)
        subprocess.run(cc+['-DJIT_ADMIN_APPROVED_SANDBOX_20260909','-c',str(ROOT/'admin-helper.c'),'-o',str(tmp/'approved.o')],check=True)
        extra=['-fsanitize='+('address,undefined' if args.sanitize else 'undefined'),'-fno-omit-frame-pointer'] if args.sanitize or args.ubsan else []
        subprocess.run(cc+extra+['-DJIT_ADMIN_LOCAL_MOCK',str(ROOT/'admin-helper.c'),str(ROOT/'fake-admin-curl.c'),'-o',str(local)],check=True)
        p=subprocess.run([str(blocked)],capture_output=True)
        assert p.returncode==78 and p.stdout==b'jit_admin_hosted_execution_blocked\n'
        count+=1
        for cmd,env,label in [
            ([str(local),END,SENTINEL.decode()],ENV,'arguments_rejected'),
            ([str(local),'https://remote.invalid'],ENV,'arguments_rejected'),
            ([str(local),'1788880500'],ENV,'window_rejected'),
            ([str(local),'1788883601'],ENV,'window_rejected'),
            ([str(local),END],{**ENV,'SUPABASE_ACCESS_TOKEN':SENTINEL.decode()},'environment_rejected'),
            ([str(local),END],ENV,'private_input_rejected'),
        ]:
            p=subprocess.run(cmd,env=env,input=SENTINEL+b'\n',capture_output=True)
            assert label.encode() in p.stdout and SENTINEL not in p.stdout+p.stderr,(label,p.returncode,(p.stdout+p.stderr).replace(SENTINEL,b'[synthetic-redacted]'))
            count+=1
        for key in ['LD_PRELOAD','DYLD_INSERT_LIBRARIES','HTTP_PROXY','http_proxy','HTTPS_PROXY','https_proxy',
                    'ALL_PROXY','NO_PROXY','SSLKEYLOGFILE','GNUTLS_KEYLOGFILE','CURL_CA_BUNDLE','SSL_CERT_FILE',
                    'SSL_CERT_DIR','OPENSSL_CONF','OPENSSL_MODULES','OPENSSL_ENGINES','OPENSSL_TRACE','PGPASSFILE']:
            p=subprocess.run([str(local),END],env={**ENV,key:''},capture_output=True)
            assert p.stdout==b'jit_admin_environment_rejected\n',(key,p.stdout)
            count+=1
        output,status=tty_run(local)
        assert status==0 and output.count(b'grant_and_readback_confirmed')==3 and output.count(b'cleanup_absence_confirmed')==3,output
        assert b'jit_admin_bound_user 11111111-1111-4111-8111-111111111111' in output
        count+=1
        for case in ['preexisting','hostile_echo','unknown_key','duplicate_key','truncated','wrong_type','escaped_key',
                     'embedded_nul','boundary_truncated','pagination_header','range_header','oversized_body','oversized_header',
                     'tls_failure','timeout','redirect','forbidden','rate_limit','server_error','option_failure','cancel_http']:
            output,status=tty_run(local,case=case)
            assert status!=0 and b'jit_admin_ready_' not in output,(case,output)
            count+=1
        for case in ['old_curl','no_tls']:
            output,status=tty_run(local,case=case)
            assert status!=0 and b'private_token_entry' not in output
            count+=1
        # Previously different failures collapsed into one scope/acknowledgement label.
        # Exercise actual main with fake HTTP only; no provider payload is diagnostic.
        for case,label in [
            ('tls_failure','tls_verification_failed'),
            ('tls_handshake_failure','tls_handshake_failed'),
            ('dns_failure','dns_resolution_failed'),
            ('connect_failure','connection_failed'),
            ('send_failure','send_failed'),
            ('receive_failure','receive_failed'),
            ('other_transport_failure','transport_failure_unclassified'),
            ('timeout','transport_timeout'),
            ('option_failure','setup_failed'),
            ('http_info_failure','http_status_unavailable'),
            ('http_status_out_of_range','http_status_rejected'),
            ('pagination_header','pagination_rejected'),
            ('oversized_header','header_limit_rejected'),
            ('oversized_body','body_limit_rejected'),
        ]:
            output,status=tty_run(local,case=case)
            assert status!=0 and b'jit_admin_ready_' not in output,(case,output)
            assert b'jit_admin_request_operation_list' in output and ('jit_admin_request_'+label).encode() in output,(case,output)
            assert b'987654321' not in output and b'Authorization:' not in output
            if case not in ['pagination_header','oversized_header','oversized_body']:
                assert b'jit_admin_http_status_unknown' in output,(case,output)
            count+=1
        for case,http_status in [
            ('invite_bad_request',400),('invite_forbidden',403),('invite_conflict',409),
            ('invite_rate_limit',429),('invite_server_error',500),('invite_unexpected_success',201),
        ]:
            output,status=tty_run(local,case=case,cues=b'i\nx\nq\n')
            assert status!=0 and b'jit_admin_ready_' in output,(case,output)
            assert b'jit_admin_request_operation_invite' in output
            assert b'jit_admin_request_http_status_rejected' in output
            assert f'jit_admin_http_status_{http_status}'.encode() in output
            assert b'jit_admin_mutation_readback_absent' in output
            assert b'jit_admin_absent_but_ack_uncertain' in output
            assert b'grant_and_readback_confirmed' not in output and b'Authorization:' not in output
            count+=1
        for case,label in [
            ('invite_timeout_before_commit','jit_admin_request_transport_timeout'),
            ('invite_readback_absent','jit_admin_mutation_readback_absent'),
            ('missing_invite_id','jit_admin_invite_response_contract_rejected'),
            ('unknown_key','jit_admin_list_response_contract_rejected'),
        ]:
            output,status=tty_run(local,case=case,cues=b'i\nx\nq\n')
            assert status!=0 and label.encode() in output,(case,output)
            assert b'grant_and_readback_confirmed' not in output
            count+=1
        for case in ['foreign_role','foreign_email','wide_network','branches','string_boolean','ipv6','changed_user']:
            output,status=tty_run(local,case=case,cues=b'i\nr\nt\nx\nq\n')
            assert status!=0 and b'cleanup_unknown_independent_owner_required' in output,(case,output)
            count+=1
        for case in ['lost_invite_ack','missing_invite_id','lost_update_ack','missing_user_id','lost_delete_ack']:
            output,status=tty_run(local,case=case,cues=b'i\nr\nt\nx\nf\nq\n')
            assert status!=0 and b'uncertain' in output and b'cleanup_unknown_independent_owner_required' in output,(case,output)
            count+=1
        output,status=tty_run(local,case='pending',cues=b'i\nx\nq\n')
        assert status==0 and b'cleanup_absence_confirmed' in output
        count+=1
        output,status=tty_run(local,cues=b'r\n'*80+b'q\n')
        assert status!=0 and b'readback_unavailable_or_scope_changed' in output
        count+=1
        for case,cues in [
            ('scope_flip_read',b'i\nr\nt\nx\nq\n'),
            ('scope_flip_grant',b'i\nr\nt\nt\nx\nq\n'),
            ('scope_flip_cleanup',b'i\nr\nx\nt\nx\nq\n'),
            ('malformed_then_restored',b'i\nr\nt\nx\nq\n'),
        ]:
            output,status=tty_run(local,case=case,cues=cues)
            assert status!=0 and b'grant_precondition_failed' in output and b'cleanup_unknown_independent_owner_required' in output,(case,output)
            count+=1
        output,status=tty_run(local,cues=b'i\ni\nt\nf\nx\nq\n')
        assert status==0 and b'phase_precondition_failed' in output
        count+=1
        for payload in [b'sbp_fc\n',b'sbp_fcBAD SPACE\n',b'sbp_fc'+b'X'*4091+b'\n',b'not_a_token\n']:
            output,status=tty_run(local,payload=payload)
            assert status!=0 and b'private_input_rejected' in output
            count+=1
        output,status=tty_run(local,payload=b'sbp_fcx\n',cues=b'q\n')
        assert status==0 # Prefix sanity is not invented minimum-length authentication.
        count+=1
        output,status=tty_run(local,payload=SENTINEL[:20],cancel=True)
        assert status!=0 and b'cancelled_no_mutation' in output
        count+=1
        print(f'{count} admin helper offline checks PASS; no network, hosted authentication or real credentials tested')

if __name__=='__main__':
    main()
