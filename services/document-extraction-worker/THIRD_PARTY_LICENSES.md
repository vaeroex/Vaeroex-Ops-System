# Document Extraction Worker License Inventory

This inventory covers the exact Python 3.12 environment described by
`requirements.lock` and `build-requirements.lock`. `pip` is build/install tooling;
all other entries are part of the private REST worker runtime dependency graph.
The reproducible CycloneDX inventory is committed separately as `sbom.cdx.json`.

| Package | Version | Scope | Declared license |
| --- | --- | --- | --- |
| anyio | 4.14.2 | Runtime | MIT |
| certifi | 2026.7.22 | Runtime | MPL-2.0 |
| cffi | 2.1.1 | Runtime | MIT-0 |
| cryptography | 50.0.0 | Runtime | Apache-2.0 OR BSD-3-Clause |
| h11 | 0.16.0 | Runtime | MIT |
| httpcore | 1.0.9 | Runtime | BSD-3-Clause |
| httpx | 0.28.1 | Runtime | BSD-3-Clause |
| idna | 3.18 | Runtime | BSD-3-Clause |
| pillow | 12.3.0 | Runtime | MIT-CMU |
| pip | 26.2 | Build tool | MIT |
| pycparser | 3.0 | Runtime | BSD-3-Clause |
| pypdfium2 | 5.12.1 | Runtime | BSD-3-Clause, Apache-2.0, bundled dependency licenses |
| typing-extensions | 4.16.0 | Runtime | PSF-2.0 |

License identifiers are taken from installed distribution metadata. The
`pypdfium2` distribution bundles PDFium and retains its upstream third-party
license notices; those notices remain part of the installed package.
