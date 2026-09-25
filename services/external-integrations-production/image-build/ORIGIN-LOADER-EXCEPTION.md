# Exact-image glibc loader exception (candidate images only)

This exception covers only `CVE-2026-86805` and `CVE-2026-95818` in the two
images below. Artifact Analysis reported both as glibc
`2.41-12+deb13u4` findings with neither `severity` nor
`effectiveSeverity` present; vulnerability discovery was
`FINISHED_SUCCESS`. The exception does **not** assign a severity or permit any
other unscored finding.

| Image | Immutable digest |
| --- | --- |
| `production-bootstrap` | `sha256:d8fa941a4371c08f2d73d9832846dbde32925ffbece1013f3ce7f872e634d205` |
| `square-internal-consent` | `sha256:966b3f0fbe4ac98b11549987df9c57d8f2f0acf98b4e9f10420399dd8991fb44` |

The [Debian advisory for CVE-2026-86805](https://security-tracker.debian.org/tracker/CVE-2026-86805)
requires an installed setuid/setgid program with a `$ORIGIN`-relative
`DT_RPATH` and an attacker-controlled filesystem race. The
[advisory for CVE-2026-95818](https://security-tracker.debian.org/tracker/CVE-2026-95818)
requires a setuid/setgid (`AT_SECURE`) program whose `DT_RPATH` or
`DT_RUNPATH` begins with `$ORIGIN`.

For each **exact digest**, a read-only `docker create` plus `docker export`
inspection of the merged root filesystem used `set -euo pipefail` and counted
1,303 regular bootstrap files and 1,304 regular consent files. The tar mode
metadata showed **zero** files with setuid or setgid bits in either image.
No image process was started. `docker image
inspect` showed a fixed `/nodejs/bin/node` entrypoint, `nonroot` user,
and no declared volumes for both images. Bootstrap starts `server.mjs`;
consent starts `index.js` with the `react-server` condition. The runtime
sources do not invoke `child_process` or create filesystem links; the
consent release contains only its four fingerprinted files. Its
`package-release.cjs` build helper is not in the runtime image.

Thus neither image contains a privileged executable that can reach the
affected loader path, even if a request supplies attacker-controlled input.
This is an image-specific non-reachability finding, not a claim that the
underlying Debian glibc package is fixed. The code gate additionally requires
the exact image digest, the two CVE IDs, the exact glibc version and package,
and the reviewed bootstrap/consent source-integrity predicates. A changed
image digest or any different unknown-severity finding fails closed.

The separate `CVE-2026-85091` zlib exceptions remain unchanged. All images
remain undeployed until normal candidate qualification and a separate
deployment decision.
