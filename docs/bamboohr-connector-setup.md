# BambooHR read-only connector

## Purpose

The first release shows only aggregate staffing signals to a workspace owner: active headcount when the complete roster is readable, and the number of approved time-off requests visible to the authorizing BambooHR account over the next 14 days. BambooHR may return default employee identity fields in its API response, but Vaeroex stores only the resulting counts. It requests no time-off notes and stores no employee records, names, leave types, payroll, protected information, or other personnel data. The time-off count may be incomplete when BambooHR limits the authorizing account's visibility; the UI says so.

## BambooHR developer app

Use the existing **Vaeroex Executive Intelligence** app (application ID 5083) in the BambooHR Developer Portal. Configure exactly this redirect URI:

`https://www.vaeroex.com/api/integrations/bamboohr/callback`

Grant read access for `employee`, `employee:job`, and `time_off`, plus `offline_access` for refresh tokens. The portal also assigns `openid` and `email`; the connector does not use them. Do not grant write, payroll, protected information, employee identification, demographics, or compensation scopes. The authorization URL asks only for the four scopes the connector needs.

## Vaeroex configuration

Apply the migration `20261017040624_bamboohr_read_only_connection.sql`. Add the BambooHR app's client ID and secret to server-only environment variables. Generate an independent base64 AES-256 key for `BAMBOOHR_TOKEN_ENCRYPTION_KEY` and set the exact redirect URI. Set `BAMBOOHR_ENABLED=true` only after the portal callback and migration are live. Never use `NEXT_PUBLIC_` names for secrets.

The customer enters the subdomain from their BambooHR URL, for example `example` from `https://example.bamboohr.com`. The server accepts only a strict subdomain label and sends requests exclusively to the corresponding `*.bamboohr.com` host. The authorization state is random, hashed at rest, single-use, and bound to the initiating workspace owner. Tokens are encrypted with authenticated encryption and bound to the workspace and connection IDs. Only aggregate counts are saved. Disconnect clears tokens and counts.

## Release gate

On October 16, 2026, a private provider-level smoke test with Vaeroex's seven-day BambooHR trial completed OAuth with read-only scopes, fetched the demo roster and approved time-off requests, and repeated the same aggregate snapshot after refreshing the token. The provider returned time-off statuses as nested objects, which the parser now accepts. This test used a temporary callback and a local script; it did not exercise the Vaeroex application's connect, sync, or disconnect screens or write to its database.

Before calling this production verified, test the application's complete connect, sync, and disconnect flow with a BambooHR test company, including an account with restricted employee and time-off permissions. Keep `BAMBOOHR_ENABLED=false` until those checks pass and the production migration and server-only configuration are in place. The trial is temporary and does not imply a paid BambooHR subscription.

References: [BambooHR OAuth](https://documentation.bamboohr.com/docs/getting-started), [employee list and partial-permission warning](https://documentation.bamboohr.com/reference/list-employees), [time-off requests and visibility warning](https://documentation.bamboohr.com/reference/list-time-off-requests).
