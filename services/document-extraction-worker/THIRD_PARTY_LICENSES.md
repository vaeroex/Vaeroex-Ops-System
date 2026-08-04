# Document Extraction Worker License Inventory

This inventory covers the exact Python 3.12 environment described by
`requirements.lock` and `build-requirements.lock`. `pip` is build/install tooling;
all other entries are part of the disabled worker runtime dependency graph.
The CycloneDX inventory is committed separately as `sbom.cdx.json`.

| Package | Version | Scope | Declared license |
| --- | --- | --- | --- |
| annotated-types | 0.8.0 | Runtime | MIT |
| anyio | 4.14.2 | Runtime | MIT |
| cbor2 | 6.1.4 | Runtime | MIT |
| certifi | 2026.7.22 | Runtime | MPL-2.0 |
| cffi | 2.1.1 | Runtime | MIT-0 |
| cryptography | 50.0.0 | Runtime | Apache-2.0 OR BSD-3-Clause |
| h11 | 0.16.0 | Runtime | MIT |
| h2 | 4.4.1 | Runtime | MIT |
| hpack | 4.2.0 | Runtime | MIT |
| httpcore | 1.0.9 | Runtime | BSD-3-Clause |
| httpx | 0.28.1 | Runtime | BSD-3-Clause |
| hyperframe | 6.1.0 | Runtime | MIT |
| idna | 3.18 | Runtime | BSD-3-Clause |
| pillow | 12.3.0 | Runtime | MIT-CMU |
| pip | 26.2 | Build tool | MIT |
| pycparser | 3.0 | Runtime | BSD-3-Clause |
| pydantic | 2.13.4 | Runtime | MIT |
| pydantic-core | 2.46.4 | Runtime | MIT |
| pypdfium2 | 5.12.1 | Runtime | BSD-3-Clause, Apache-2.0, bundled dependency licenses |
| python-dotenv | 1.2.2 | Runtime | BSD-3-Clause |
| python-multipart | 0.0.32 | Runtime | Apache-2.0 |
| typing-extensions | 4.16.0 | Runtime | PSF-2.0 |
| typing-inspection | 0.4.2 | Runtime | MIT |
| vercel | 0.8.1 | Runtime | MIT |
| vercel-cache | 0.7.1 | Runtime | MIT |
| vercel-headers | 0.7.1 | Runtime | MIT |
| vercel-internal-core | 0.1.1 | Runtime | MIT |
| vercel-internal-telemetry | 0.7.1 | Runtime | MIT |
| vercel-oidc | 0.7.1 | Runtime | MIT |
| vercel-queue | 0.7.2 | Runtime | MIT |
| vercel-sandbox | 0.3.0 | Runtime | MIT |
| websockets | 16.1.1 | Runtime | BSD-3-Clause |

License identifiers are taken from installed distribution metadata. The
`pypdfium2` distribution bundles PDFium and retains its upstream third-party
license notices; those notices remain part of the installed package.
