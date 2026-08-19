# Security CI and Dependency Review

## Isolated authorization behavior

The `security-database` CI job starts a fresh local Supabase stack, applies the repository migrations, and runs the pgTAP authorization suite. It requires only the GitHub-hosted runner's Docker runtime; it uses no Preview or Production credentials.

The suite verifies entitlement write denial, Viewer mutation denial, Admin-to-Owner escalation denial, cross-workspace isolation, anonymous direct-write denial, legitimate service workflows, quota boundaries, and concurrent atomic quota consumption. The Supabase CLI and every GitHub Action are pinned to immutable reviewed versions.

ESLint 9 is restored through a flat configuration. Existing style debt is retained as 63 visible warnings, while lint errors or growth beyond that baseline fail CI. CommonJS regression scripts are linted as CommonJS rather than being forced into unrelated module rewrites.

## Production dependency advisories

| Package | Previous | Resolution | Reachability and decision |
| --- | --- | --- | --- |
| `@supabase/auth-js` | 2.65.0 | 2.70.0 | Authentication is reachable. The patched published release is pinned through the existing Supabase client without changing its public API. |
| `nanoid` | 3.3.12 | 3.3.18 | Transitive PostCSS build tooling could loop on invalid size input. Vaeroex does not call it directly; the compatible patch is pinned. |
| `postcss` | 8.4.31 and 8.5.15 | 8.5.23 | Vaeroex processes repository-owned CSS at build time, not customer CSS. The compatible patched release is pinned across the graph. |
| `sharp` / libvips | 0.34.5 / 1.2.4 | Deferred | Next.js supplies Sharp for image optimization. Vaeroex uses `next/image` only for the repository-owned brand logo, so attacker-controlled image input was not found. The advisory requires Sharp 0.35.x, a major upgrade outside Next's current resolved graph; take it through a separately tested Next-compatible upgrade rather than forcing a transitive major override. |

Run `pnpm audit --prod` on every dependency update. The accepted Sharp advisory remains non-blocking only while image optimization is limited to repository-owned assets.
