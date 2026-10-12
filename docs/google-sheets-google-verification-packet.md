# Google Sheets verification submission packet

Updated October12,2026. Resume PRs #457 (packet) and #458 (implementation), based on current deployed main `002c2536583ce455f2ce8ee1bc58b430c3da3b74`. Earlier October2 drafts are superseded by this packet and the completed implementation release receipt. This is not a Google approval or a submitted application.

## Current facts

| Item | Verified state |
| --- | --- |
| Google project | `vaeroex-integrations-prod` / Vaeroex Prod Integrations |
| OAuth app | Vaeroex Executive Intelligence |
| Callback | `https://www.vaeroex.com/api/integrations/google-sheets/callback` |
| Scope | Only `https://www.googleapis.com/auth/spreadsheets.readonly`; no Drive scope |
| Audience/review | External / Testing; Verification Center reports no verification required while Testing; not submitted |
| Branding | Existing Vaeroex app logo saved October12. Homepage, privacy, terms populated. `vaeroex.com` ownership automatically verified from existing DNS in Search Console under isaac@vaeroex.com on October12 |
| Contact | Google support/developer contact isaac@vaeroex.com; deletion help support@vaeroex.com, monitored daily by Isaac |
| Application | Current-main paths reconciled in #458; Production deployment hold until exact release approval |
| Demo | Not recorded/uploaded; authenticated real consent required after deployment |

## Scope justification for the application

Vaeroex Executive Intelligence imports business metrics from a spreadsheet chosen by an authorized workspace owner. The owner pastes a spreadsheet URL, selects one worksheet/header row, previews selected columns and explicitly approves a field mapping before sync. Vaeroex reads spreadsheet/tab metadata and mapped business values to validate observations and support Performance, Business Health and requested Intelligence features. Manual Sync now and optional15-minute refresh read that approved source. The app never writes to the spreadsheet. The read-only Sheets scope supplies these capabilities without broad Drive access. Although Google grants access to spreadsheets the account can access, Vaeroex reads the configured spreadsheet and selected/approved data. The demo shows the entire consent, selection, approval, sync and result flow.

## Approved retention and deletion behavior

- Connected history: up to13calendar months from first import; no clock reset on refresh, copy or reconnect.
- Disconnect: up to30days, capped by the earlier first-import deadline.
- Exact expiry removes ordinary access immediately; physical purge runs the next business day (explicit owner choice).
- Identified copies inherit the earliest source deadline. Mixed/legacy records need exact review; preserve unrelated sources and original files when only derived analysis is removed.
- support@vaeroex.com is monitored each business day by isaac@vaeroex.com. Acknowledge within2businessdays; target active-system deletion within30calendar days of receipt after verifying authority; explain blockers promptly.
- Backup and processor retention are separate. Independently retained signed instructions must be replayed into an isolated restored environment before any access/workers resume.

These periods are business choices, not Google-prescribed or approved periods. Mapping consent separately confirms content ownership or permission from the content owner to store the approved metric/history/source-reference records and create the disclosed analyses. This is the permission basis under Google API Terms section5(e); finite retention alone is not asserted as an exception to copy/cache restrictions. Final public text is maintained in the application’s privacy/data-retention documents and adjacent consent UI in #458. Do not publish an older generic-provider or indefinite-history draft.

## Processor provenance

The existing Vercel Production model key is unreadable and its issuing project is unproven. One controlled replacement is planned: owner creates and privately stores a Production key for the verified OpenAI organization/project, records non-secret provenance and sets the two project pins. Google-derived requests must use that project, force Responses store:false, and cannot fall back to NVIDIA. Sharing disabled +store:false is not ZDR. OpenAI’s standard abuse-monitoring and prompt-cache retention must remain disclosed. Deployment/submission is blocked until private replacement and verification are complete.

## Authentic English demonstration

Use the existing signed-in Vaeroex account/workspace, a named synthetic test connection/entity, and only fake business metrics. Do not create or sign another workspace agreement. Keep unrelated workspace lists out of the recording.

1. Show the public app identity, Google-specific privacy/retention/deletion help and pre-consent disclosure.
2. Start recording only after accounts are signed in. Show Connect Google Sheets and the actual Google consent screen in English, with Vaeroex app identity and read-only permission. Pause/redact around any password, OTP or authorization-code URL. The owner completes any required security grant.
3. Return to Vaeroex; enter the non-sensitive test spreadsheet URL, select the tab/header, preview columns, map stable row ID/date/metrics and approve source plus retention. Show the optional15-minute cadence.
4. Use Sync now. Show success and synthetic validated metrics/provenance with unrelated records hidden.
5. Show disconnect/deletion instructions. No live customer erasure is part of the demonstration.
6. Review the entire recording and redact secrets, codes, unrelated workspace information and private account material. Upload the finished video to the authorized YouTube account as **Unlisted**; verify playback in a signed-out browser context.

Suggested narration: “This is Vaeroex Executive Intelligence. I am connecting a synthetic business spreadsheet using read-only access. I select its tab and approve the exact metric mapping and retention policy before importing. Sync validates the metrics and makes them available for reporting and requested analysis. Automatic refresh checks every15minutes. Disconnect stops refresh; retained history expires under the displayed policy, and support can handle an earlier verified deletion request.”

## Final Google submission gates

1. Exact code/migrations and private operational provisioning approved and live, focused checks passed, disclosure behavior verified.
2. Proven Production processor identity/settings; monitored support; accurate Limited Use and retention commitments.
3. Homepage/privacy/terms available publicly; authorized domain ownership and branding checks complete.
4. Authentic Unlisted demo accessible without sign-in; add its URL and scope justification.
5. Review actual Console publishing/verification screens. Obtain any required owner action for binding attestations or materially expanded access at that time. Keep callback/project/scope unchanged.
6. Submit only when the form’s required confirmations are satisfied. Record UTC submission timestamp, request/app identity and actual Google status. Submission is not approval; do not promise a review date.

## Official references

- [Google sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Google Workspace user-data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)
- [Supabase backups](https://supabase.com/docs/guides/platform/backups)
