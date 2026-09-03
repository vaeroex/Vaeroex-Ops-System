# Security CI and Dependency Review

## Isolated authorization behavior

The `security-database` CI job starts a fresh local Supabase stack, applies the repository migrations, and runs the pgTAP authorization suite. It requires only the GitHub-hosted runner's Docker runtime; it uses no Preview or Production credentials.

The suite verifies entitlement write denial, Viewer mutation denial, Admin-to-Owner escalation denial, cross-workspace isolation, anonymous direct-write denial, legitimate service workflows, quota boundaries, and concurrent atomic quota consumption. The Supabase CLI and every GitHub Action are pinned to immutable reviewed versions.

Vaeroex Production predates Supabase's opt-in Data API grant default, while a current fresh local stack starts without those legacy object grants. The pgTAP transaction therefore grants only the specific columns and operations needed for its synthetic attacker and legitimate-user statements to reach RLS. These test-only grants are created after fixture setup, never include a table-wide `workspaces` grant, and are rolled back with all synthetic rows. Application migrations and deployed role authority are unchanged.

ESLint 9 is restored through a flat configuration. This hardening pass removed one React dependency warning and three unsafe or stale type warnings, reducing the accepted ceiling from 63 to 59. Lint errors or growth beyond that baseline fail CI. The remaining warnings are 56 maintainability/style items, two JSX text-escaping items, and one repository-owned image performance warning; none is an identified authorization or data-integrity defect.

## Production dependency advisories

| Package | Previous | Resolution | Reachability and decision |
| --- | --- | --- | --- |
| `@supabase/auth-js` | 2.65.0 | 2.70.0 | Authentication is reachable. The patched published release is pinned through the existing Supabase client without changing its public API. |
| `nanoid` | 3.3.12 | 3.3.18 | Transitive PostCSS build tooling could loop on invalid size input. Vaeroex does not call it directly; the compatible patch is pinned. |
| `postcss` | 8.4.31 and 8.5.15 | 8.5.23 | Vaeroex processes repository-owned CSS at build time, not customer CSS. The compatible patched release is pinned across the graph. |
| `sharp` / libvips | 0.34.5 / 8.17.3 (`@img/sharp-libvips` 1.2.4) | Deferred | GHSA-f88m-g3jw-g9cj covers CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, and CVE-2026-35591. The patched Sharp line is 0.35.x (current advisory guidance: 0.35.3/libvips 8.18.3). Next.js 15.5.21 declares `sharp ^0.34.3`, so forcing 0.35 would violate its dependency range. Vaeroex uses `next/image` only for repository-owned brand logos, defines no remote image patterns, and exposes no customer image transformation path; practical reachability is low. Take the fix through a separately tested Next-compatible upgrade. |

Run `pnpm audit --prod` on every dependency update. The accepted Sharp advisory remains non-blocking only while image optimization is limited to repository-owned assets.

## Three.js clock deprecation

Vaeroex application components consume React Three Fiber's frame-state `clock`; they do not instantiate `THREE.Clock`. The warning is emitted by `@react-three/fiber` 9.7.0, which creates the clock internally, against Three.js 0.185.1. React Three Fiber's maintainers have identified the `THREE.Timer` move as a next-major concern because the current stable package supports Three versions older than `Timer`.

Do not hide the warning, patch `node_modules`, downgrade Three, or adopt a pre-release renderer solely to remove it. Upgrade when a stable React Three Fiber release owns the Timer transition, then rerun desktop, mobile, reduced-motion, and non-WebGL visual checks.

## Repository review protection

`.github/CODEOWNERS` assigns the verified repository owner `@vaeroex` to database, authentication, administrator, billing, security, workflow, deployment, and document-extraction paths. Remote repository settings were not changed. Protect `main` with required `verify` and `security-database` checks, at least one approving code-owner review, stale-approval dismissal, latest-push approval, conversation resolution, and no direct or force pushes. CODEOWNERS requests review but cannot enforce it without the corresponding branch rule.
