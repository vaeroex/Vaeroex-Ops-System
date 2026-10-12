# Stage 4 internal-form pending evidence

Copy this directory intact into the persistent audit evidence directory. `manifest.json` lists every included artifact by relative path, size, and SHA-256. Generated JavaScript/CSS bundles and temporary diagnostic programs are intentionally excluded. Raw logs/traces/screenshots are unchanged; references in report/verification are made relative to this directory.

- [Report and limits](report.md)
- [Final results, exact source hashes, and commands/log references](verification.json)
- [First final browser run](browser/run-1/result.json) and [second run](browser/run-2/result.json): each 36 scenario groups, six synthetic POSTs (five successful including explicit recovery, one intentional 503), zero unexpected browser errors.
- [Workflow contracts](logs/workflow-contracts.log): 36 passed. [Interaction feedback](logs/interaction-feedback.log): 9 passed. Empty lint/typecheck logs correspond to exit-0 outcomes captured in verification.json.
- [Pre-fix Next-runtime trace](before/next-runtime-failure.json), [request trace](before/request-timeline-failure.json), and [single-click trace](before/single-click-failure.json) preserve the held-request/premature-unlock observations. The source-level React explanation remains an inference, not a deployed-backend claim.

Only synthetic fixtures were used. Included text was checked for common credential/private-key/JWT patterns; none were found. All 10 unique image contents across the 16 screenshots were visually reviewed and contain synthetic labels/blank fields, without customer records or credentials. This is a bounded artifact review, not an automated OCR or general secret-scan certification. Raw logs retain local source paths for provenance.

The server-reference adapter preserves posting structure; real authenticated no-JavaScript submission was not executed. Error recovery uses a fixture-only boundary with explicit reset/remount; real Next redirect handling and backend-error input retention remain unqualified. Only the changed internal submission flow receives authoritative action pending state; other generic forms and durable server idempotency remain open.
