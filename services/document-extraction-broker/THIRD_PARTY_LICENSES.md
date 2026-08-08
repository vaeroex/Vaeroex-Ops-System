# Document Extraction Broker Third-Party Licenses

The Cloud Run broker is built as one `@vercel/ncc` bundle. The build emits the
complete license text as `dist/licenses.txt`, and that file is copied into the
runtime image beside `index.js`. The runtime inventory is committed separately
as `sbom.cdx.json`.

| Package | Version | Scope | License |
| --- | --- | --- | --- |
| `gcr.io/distroless/nodejs22-debian12` | sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e | Runtime base | Image notices included in pinned image |
| `@supabase/auth-js` | 2.65.0 | Runtime bundle | MIT |
| `@supabase/functions-js` | 2.4.1 | Runtime bundle | MIT |
| `@supabase/node-fetch` | 2.6.15 | Runtime bundle | MIT |
| `@supabase/postgrest-js` | 1.16.1 | Runtime bundle | MIT |
| `@supabase/realtime-js` | 2.10.2 | Runtime bundle | MIT |
| `@supabase/storage-js` | 2.7.0 | Runtime bundle | MIT |
| `@supabase/supabase-js` | 2.45.4 | Runtime bundle | MIT |
| `server-only` | 0.0.1 | Runtime sentinel | MIT |
| `tr46` | 0.0.3 | Runtime bundle | MIT |
| `webidl-conversions` | 3.0.1 | Runtime bundle | BSD-2-Clause |
| `whatwg-url` | 5.0.0 | Runtime bundle | MIT |
| `ws` | 8.21.2 | Runtime bundle | MIT |
| `zod` | 3.25.76 | Runtime bundle | MIT |
| `@vercel/ncc` | 0.44.1 | Build only | MIT |

The final runtime is the non-root Google distroless Node 22 Debian 12 image
pinned in `Dockerfile` by SHA-256 digest. The image digest, Artifact Analysis
scan, and immutable application-image digest are recorded during the bounded
Preview qualification.
