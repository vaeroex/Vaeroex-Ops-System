# Release-preparation access recovery

Use the existing project/account. No credential, MFA code, bearer token, OAuth code or environment secret should be pasted into chat. Login restores access only; release holds and all pending business proposals remain.

## Vercel

1. Sign in to [the existing project's Environment Variables page](https://vercel.com/vaeroex-2167s-projects/vaeroex-ops-system/settings/environment-variables) as the existing owner/authorized administrator. Confirm team `vaeroex-2167s-projects`, project `vaeroex-ops-system`, ID `prj_J810bZ9ECoN4CyLKujUoEEH8N6ja`, and Production scope. Inspect the list without revealing secret values.
2. If the list is denied in the browser too, the team owner uses **team Settings → Members → Manage Role** for the affected existing account. Prefer using the already authorized owner account for preparation rather than creating a paid seat or broadly promoting another user. Where the current plan supports project roles, project read access is sufficient for inspection; Project Viewer can inspect environment variables. Developer plus **Environment Variable Manager** or Project Administrator/Owner also has production configuration capabilities but is broader than read-only. Do not upgrade the plan or grant deployment access merely to resolve this read. See [role definitions](https://vercel.com/docs/rbac/access-roles) and [exact dashboard navigation](https://vercel.com/docs/rbac/managing-team-members).
3. If the browser can view the list, refresh CLI authentication with the **same** account using `vercel login` (or `npx --yes vercel@62.4.0 login` where Node/npm is installed). Complete Vercel's browser flow. A pinned local62.4.0 CLI and private launcher are prepared under ignored `outputs/private-release-preparation/reauthenticate-vercel.command` for this machine, so installing global software is unnecessary. No login was executed for you. [Official login command](https://vercel.com/docs/cli/login).
4. The connected Vercel app has a separate session. Reconnect/reauthorize it through the host's connected-app controls with that same account/team if needed. CLI access alone is a sufficient read-only fallback; no credentials need to be shared. The observed connector403 and locally saved credential403 did not establish which account role or token scope caused denial. Do not repeatedly add permissions if the browser already has access.
5. Verification is a scoped `GET /v10/projects/prj_J810bZ9ECoN4CyLKujUoEEH8N6ja/env?decrypt=false&teamId=team_uORtrMvad77Qz6HikOgD4cnp`. The expected result is200 metadata. We will filter the response to approved nonsecret settings/presence; `decrypt=false` is not treated as a promise that every plain variable is secret-free. CLI alternative after login: `vercel env ls production --project prj_J810bZ9ECoN4CyLKujUoEEH8N6ja --scope vaeroex-2167s-projects`. Even the human CLI listing can display plain Config values; capture/filter it rather than assuming it lists names only. Do not use JSON output, pull/export, debug or token arguments to show values in chat.

A sensitive/write-only variable cannot be recovered merely by granting additional read access. Verify its presence/identity through the owner's existing secret store and approved runtime qualification; do not replace it to make it readable. The actual `VAEROEX_ADMIN_EMAILS` value stays in the private operator artifact. [Sensitive variable behavior](https://vercel.com/docs/environment-variables/sensitive-environment-variables).

If owner browser access and refreshed CLI still return403, retain only the endpoint/resource/action, team/project IDs, timestamp and provider request ID in a Vercel support case. No token, env values or customer data. That is a provider permission/token issue requiring resolution, not permission to change production settings.

## Google Cloud

Run these in your normal Terminal, completing browser sign-in and MFA locally:

```sh
VAEROEX_GCLOUD_ACCOUNT="$("/Users/isaacvizcarra/google-cloud-sdk/bin/gcloud" config get-value account)"
"/Users/isaacvizcarra/google-cloud-sdk/bin/gcloud" auth login "$VAEROEX_GCLOUD_ACCOUNT" --force --no-activate
```

A guarded private launcher is also prepared at `outputs/private-release-preparation/reauthenticate-google-cloud.command`. It stops if no existing account is selected. `--force` reruns browser authorization and `--no-activate` preserves active-account selection. Do not run application-default login, create a service-account key, change the configured project or paste an OAuth code/token into chat. [Google command reference](https://docs.cloud.google.com/sdk/gcloud/reference/auth/login).

After login, a safe explicit-target verification is:

```sh
"/Users/isaacvizcarra/google-cloud-sdk/bin/gcloud" run services list \
  --project=vaeroex-qbo-prod-20260827 --region=us-central1 \
  --format='table(metadata.name,status.latestReadyRevisionName)'
```

We will then read the exact services/revisions, image metadata, queue configuration and three scheduler jobs. The existing failure was **reauthentication required**, before IAM evaluation; no IAM denial is established yet. If the renewed identity receives PERMISSION_DENIED, request only the exact denied read permission listed in the technical runbook, scoped to the existing resource. No new service, API activation or project purchase is necessary merely to inspect it. Cloud Console login alone does not refresh the local gcloud credential.

## Existing customer limits versus earlier suggestions

Both accepted production-source `d91be079` and proposed stack `5ff62601` contain these defaults. Deployed overrides remain unknown until Vercel access is restored.

| Setting | Existing source default | Earlier proposal, not applied |
|---|---:|---:|
| Per-user provider requests /600s |60|10|
| Per-workspace provider requests /600s |240|20|
| Monthly workspace token preflight |2,000,000|500,000|
| Single-request token preflight |120,000|20,000|
| Generic same-provider retry count |1|0|

The rate/token controls already exist; the smaller numbers were new recommendations. They are withdrawn from the customer release configuration. Preserve actual customer limits and per-workflow retry/fallback policy; do not alter them to make a proposed$25 allowance look sufficient. Rate checks are atomic; token accounting is not an atomic dollar reservation. A synthetic paid qualification may use its own bounded isolated profile after budget approval without changing customer settings.

The$5 qualification, $25 first-month pilot allowance, private administrator exemption, customer cohort and maintenance window all remain proposals. The administrator proposal concerns one identified internal operator's billing/file/run-quota bypass in workspaces they already legitimately belong to; it grants no new membership, customer access, role or free provider usage. Metadata-based admin navigation alone does not establish the current email-configured billing bypass. Its exact identity and evidence remain in the private review file.

## Verified after owner reauthentication — 2026-10-05

Both local sessions work. Vercel metadata returns200 and scoped nonsecret QBO reads return200; gcloud reads services, schedules, queue, IAM and image metadata. The connected Vercel app still has its separate403, but reconnecting it is optional because CLI access suffices. Do not repeat login or broaden roles to retrieve write-only Secrets.

Observed Sheets/QBO enablement is true. No project entries override existing60/240-per600s,2,000,000/month or120,000/request source defaults. The conversational selector is absent and must be added only as approved release configuration for new Executive Analysis. Four other workflow selectors, AI provider, Square enablement and the admin-email roster are write-only; verify them in the original owner-managed configuration. No values or limits were changed.

Google Auth Platform’s existing Chrome account separately requests “Verify it’s you”; owner browser re-verification is needed before Audience/Data Access/Clients/Verification Center can be read. OpenAI’s accessible Personal/Default project is not attributed to the application, and Limits did not render; NVIDIA is signed out. Use existing owner sessions or protected nonsecret configuration/billing exports. Do not send API keys, credentials or MFA codes.
