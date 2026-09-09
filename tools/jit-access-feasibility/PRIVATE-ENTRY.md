# Private credential-entry handoff

Applies to both isolated JIT clients, not to Production provisioning. No real
credential belongs in chat, tool input, arguments, environment variables, files,
clipboard history, logs or screenshots. Use the operator's own nonrecorded
Terminal, never an assistant-captured PTY. A test PAT is a real credential.

## Prepare before issuing a credential

1. Complete all nonsecret pre-token gates, exact executable/CA/host verification,
   independent review and Linux synthetic checks. Keep the fixed window deadline,
   admission cutoff and cleanup reserve; do not reset them to fit entry.
2. Prepare the exact provider token form privately, without generating it. Check
   the approved identity, target-only permissions, name and expiry. Prepare the
   coordinator's hash-pinned, nonsecret launch command in a **new disposable
   Terminal window** with automatic shell restart disabled. No recording or
   synchronization may capture this window. Do not launch yet.
3. Use an **outer `exec /bin/sh`** to invoke the reviewed private-window launcher,
   not `sh` alone. This replaces the interactive parent shell; the launcher's own
   `exec gcloud` cannot replace an already-waiting parent shell. The fixed remote
   command must also exec its bounded supervisor/client, not start an interactive
   remote shell. The coordinator supplies the real path and fixed end timestamp;
   do not invent either or enter a token into the launch command.
4. Only when ready, generate the approved token privately, immediately launch,
   and manually enter it at the **new** native `private_token_entry` prompt.
   Press Return to submit. Do not wait for a chat reply after starting the prompt.
   If transcription cannot comfortably fit the displayed allowance, stop rather
   than rushing or weakening the privacy controls.

## Bound and failure behavior

Both native readers allow at most **300 seconds total**, or the original process
deadline if earlier. The allowance is monotonic, not renewed by keystrokes. The
runner's 1,800-second process cap and external cleanup reserve remain unchanged;
the administrative helper still uses the original absolute window. No token
creation or restart extends those deadlines.

The native reader disables echo before printing its prompt. Timeout, invalid
input and cancellation fail closed before credential-bearing API/DB operations;
regular exit flushes queued input, restores the TTY and wipes owned memory.
Timeout labels distinguish elapsed allowance from invalid input without printing
input, length, raw errors or credential fragments. They cannot establish whether
zero, partial or complete bytes without Return reached the process.

Stop typing immediately on any failure/timeout/cancellation or process exit.
The disposable outer exec prevents late input from becoming a command in a
waiting interactive shell. It does **not** prove that a terminal emulator, SSH
or an external recorder cannot echo or retain late keystrokes. It does not cover
automatic shell restart. SIGKILL cannot execute native TTY or memory cleanup;
no-swap/no-dump controls and external deadline/host cleanup remain required.

If receipt or private confinement is uncertain, privately revoke **only that
attempt's PAT** on the provider screen before creating a replacement. Do not
inspect/export shell history or search diagnostics for its value. Report only
finite labels and whether typing continued after exit. A source-proven failure
before the first authenticated call is not proof that no input reached memory.
Complete exact grant/role/session/network/VM cleanup independently; token
revocation alone is not evidence of existing-session fencing.

## Focused synthetic evidence

`validate-private-entry.py` exercises the real native readers and main flow using
only fake APIs, synthetic bytes, a private PTY and deterministic test clocks.
It covers later-than-60-second entry, the fixed 300-second boundary, an earlier
process deadline, partial input, cancellation, invalid input, wiping, no-echo and
no credential-bearing calls after input failure. The disposable-shell test checks
no parent-shell continuation, not universal terminal nonrecording. Test clock
substitution belongs only to the offline test translation unit; approved builds
have no clock-override runtime input. These tests are not hosted authentication.
