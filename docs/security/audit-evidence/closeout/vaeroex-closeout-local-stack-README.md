# Disposable native Supabase assembly helper

The maintained helper is `scripts/workspace-closeout-local-stack.cjs`; its guard/parser tests are `scripts/workspace-closeout-local-stack-tests.cjs`. It defaults to a read-only dry plan. **The maintained assembly helper executed successfully** into `/tmp/vaeroex-closeout-assembly-final` after the earlier native stacks were stopped. It initially applied all129 then-current canonical migrations and verified the owned local database and exact ledger. The guarded local forward upgrade subsequently applied `20261005070311_worksheet_import_publication_heads.sql`, producing130 applied canonical migrations; see `native-stack-forward-upgrade.json`. A fresh assembly from the final reviewed checkout includes all130 directly. Sanitized execution evidence is `native-stack-assembly.json`; private credentials remain outside the repository.

Inspected executable: `/tmp/vaeroex-closeout-cli/supabase`, version2.119.0, Darwin arm64 SHA256 `460ed2c417614cc9dfb21f11049b887316349cbc46159bc0469b24ed50613f62`. This is the executable hash, not the downloaded archive hash. Supply a separately verified platform executable/hash on another host; the helper requires an exact match and then verifies version before bootstrap. The current platform's CLI help was inspected for native start, init, local migration, status and scoped stop. It uses `status --output-format json`, whose complete object has `identity.project_root`, `identity.id`, `runtime` and `env` connection fields. It refuses missing/unrecognized/remote exports.

From the authorized repository:

```sh
node scripts/workspace-closeout-local-stack-tests.cjs
node scripts/workspace-closeout-local-stack.cjs \
  --cli /tmp/vaeroex-closeout-cli/supabase \
  --cli-sha256 460ed2c417614cc9dfb21f11049b887316349cbc46159bc0469b24ed50613f62 \
  --source /Users/isaacvizcarra/.codex/worktrees/workspace-audit-fixes/Vaeroex \
  --output /tmp/vaeroex-closeout-assembly-new-run
```

The dry run does not create the output directory, execute the CLI, start services, migrate or capture credentials. It verifies the executable hash, snapshots every canonical SQL migration filename/version/size/hash, rejects duplicate versions/symlinks/linked sources, and emits the exact command plan. Current dry run captured129 migrations. Use a fresh output name; the helper will never attach to an existing output root.

When separately ready to provision this isolated test stack, append `--execute` to the same helper command. It creates private `/tmp/vaeroex-closeout-assembly-new-run/{project,home}` directories, preserving the user's HOME and using only the new SUPABASE_HOME. The child environment is an explicit allowlist: no inherited provider keys, hosted database URLs, Supabase access token, CLI profile or NODE_OPTIONS. It initializes a new project; copies only hashed SQL files; starts native database/Auth/REST/Storage with realtime, functions, studio, mail, analytics and pooler excluded; disables automatic migration and seed during bootstrap; then runs **`migration up --local`**. It checks the database is loopback and its real data directory is beneath this owned home, verifies the exact applied migration version inventory and detects source changes. No hosted/project-ref/db-url migration option exists in the wrapper.

Public runtime dependency downloads may be required by the CLI's native runtime. They are not application/provider traffic. No worker/provider credentials are installed, and no paid service is provisioned. This helper does not implement an OS-wide egress sandbox for arbitrary SQL; it applies the repository's inspected migrations to its owned native stack. The current migration inventory contains no cron.schedule/net.http invocation.

Credentials remain only in a newly created **mode0600** `private-e2e-config.json` inside the private output directory. It has the exact E2E fields `mode`, `runId`, `apiUrl`, `dbUrl`, `anonKey`, `serviceKey`, plus `stackId`, `ownedSupabaseHome`, `ownedProjectRoot` and `assemblyManifest`. It extracts only API_URL, DB_URL, ANON_KEY and SERVICE_ROLE_KEY from the CLI's env export; raw CLI stdout/stderr and other credentials are never printed or saved into public evidence. Do not cat, upload, commit or copy that private file into audit documentation. Pass its path directly to the E2E driver:

```sh
node scripts/workspace-closeout-e2e.cjs \
  /tmp/vaeroex-closeout-assembly-new-run/private-e2e-config.json \
  /tmp/vaeroex-closeout-e2e-new-run
```

The maintained E2E driver uses `ownedSupabaseHome` for its verified data-directory containment test and rejects unknown fixture workspaces. A successful assembly is not an E2E pass or a capacity qualification.

CLI calls have bounded output and timeouts. Timeout/output-stop waits for actual CLI process exit before attempting a scoped stop. On failure, the helper stops only this project's stack using its isolated home, preserves the private directory and records a sanitized blocked assembly manifest; failed stop is marked unverified. It never uses `stop --all`, deletes a stack, mutates an existing main stack or erases fixtures. On successful completion, use the scoped stop command/environment in `assembly.json` to stop services while preserving data. No automatic resume after a partially failed assembly is provided: inspect the owned directory and use a fresh output root for another qualified run.

Verification:12 guard/parser self-tests, exact129-migration dry plan, script syntax, targeted ESLint and successful actual assembly. The runtime provides real GoTrue Auth, PostgREST, Storage and pgvector0.8.2 on PostgreSQL17.11 with max_connections100. The inspected production metadata reported PostgreSQL17.6.1.127 and max_connections60. Canonical application parity and a separate exact production-ledger SQL rehearsal do not establish production hardware, network, concurrency, pooler or worker equivalence. See the persistent audit closeout for the separate browser workflow results and remaining capacity gates.
