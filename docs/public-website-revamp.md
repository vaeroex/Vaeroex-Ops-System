# Public website revamp — The Clarity Engine

## Review

Branch: `codex/vaeroex-public-revamp`

Base: `90982062976ca905095ba68c193c52eddf795f1b`

Local production preview: <http://127.0.0.1:3100/>

Production deployment is intentionally on hold pending approval.

Run with the repository's pinned pnpm 9.15.4 and Node 24:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm exec next start --hostname 127.0.0.1 --port 3100
```

No production environment file was copied into this isolated worktree. The primary checkout's unrelated integration work was preserved.

## Direction and implementation

**The Clarity Engine** turns fragmented information into an ordered, illuminated center. A bespoke layered graphite aperture, blue recessed seams, chamfered metal edges, and a central Vaeroex chevron establish the visual identity. Manrope typography, broad dark space, ruled editorial lists, and restrained transitions carry it through the public site. Concept illustrations and sample data are explicitly labeled.

The homepage now moves from a plain-language value proposition through an interactive signal-to-decision explanation, product capabilities, a material-led evidence section, and clearly separated product availability. Executive Intelligence, the system directory, research-domain pages, and pricing have distinct editorial layouts. Shared navigation, footer, supporting-page heroes, request forms, help, and public policy pages use the same visual language.

- `app/page.tsx` and `app/public-home.module.css`: homepage composition.
- `components/marketing/SignalSequence.*`: three-step, keyboard-operable conceptual explanation; arrow, Home, and End navigation.
- `components/marketing/clarity/*`: real Three.js / React Three Fiber geometry, capability selection, static fallback, rendering lifecycle, and materials.
- `components/marketing/PublicNavigation.tsx`: desktop disclosures and mobile navigation, Escape and outside-click dismissal.
- `components/marketing/public-design.css`: public-only typography, color, focus, forms, and utility styles. It does not alter the authenticated application theme.
- `components/marketing/IntelligencePages.module.css`: shared product and pricing composition.

The available product remains Executive Intelligence at **$500/month**, sourced from existing product and billing definitions. Subscription calls to action retain `/checkout/legal`. Drug Discovery Intelligence and Biological Intelligence remain in development with pricing not announced and no checkout. The existing product walkthrough remains visibly marked as a sample.

No authenticated application, API, integration, billing implementation, security control, database policy, form action, middleware, or dependency lockfile changed. The request form's change is presentation only. Existing legal/company details, brand icon, and NVIDIA Inception membership attribution remain intact.

## Rendering and performance

The interactive hero is actual modeled geometry, not a flat image. The static image is a render of that exact geometry and is labeled as a concept render when used. The separate material study is also explicitly illustrative.

- Geometry: 12,238 triangles, 78 meshes, 20 shared geometries, 9 materials.
- Procedural roughness texture: 64 × 64, approximately 16 KiB; no downloaded environment map.
- Local studio lighting/PMREM, pixel ratio capped at 1.5, 2048-pixel shadow map.
- Dynamic canvas import deferred until idle and near the viewport; readable server-rendered text and poster precede it.
- Demand rendering settles when motion stops; offscreen and hidden-tab animation pause. A visible Pause/Resume control is available.
- Reduced motion, compact/touch devices, data saving, reported low device resources, failed WebGL, and rendering errors retain the static artwork.
- No scroll hijacking or perpetual rotation. Pointer and scroll changes affect the sculpture subtly.
- Production build initial JavaScript: homepage 119 kB, Executive Intelligence 117 kB, pricing/research pages about 115 kB; shared 103 kB. These are Next.js build estimates, not network or field-performance measurements. The interactive Three.js payload is separate and deferred.

## Assets and provenance

| Asset | Source | Delivery |
| --- | --- | --- |
| `public/brand/clarity-engine-poster.webp` | Screenshot render of the custom project geometry, composed in a temporary local studio route; route removed after capture | 850 × 850, about 78 kB |
| `public/brand/clarity-material.webp` | Original image created with the built-in image generation tool, inspected visually and resized/compressed | 1920 × 960, about 132 kB |
| `public/fonts/manrope/Manrope.ttf` | Official Google Fonts repository, Manrope variable font | Approximately 161 kB; local delivery, `font-display: swap` |
| `public/fonts/manrope/OFL.txt` | Upstream SIL Open Font License | Included with font |

Original generated image on the commissioning machine: `/Users/isaacvizcarra/.codex/generated_images/01a0fef8-b24e-70d1-b0b3-1c2d51e39c6c/exec-be493e22-ebfa-4547-8a69-2f0713b69a9c.png`.

Exact material-study generation prompt:

> Use case: stylized-concept
> Asset type: commissioned landscape 2:1 brand material study for a premium creative and technical operations website.
> Primary request: create an exceptionally sophisticated, understated, physically believable macro architectural product render that expresses fragmented business information resolved into clear decisions.
> Scene/backdrop: black seamless studio space, near-black graphite background.
> Subject: an extreme close-up of precision CNC-milled graphite metal layered lamellae and rectangular nested frames. Closely aligned parallel polished chamfered edges and carefully cut channels. A single very narrow electric royal-blue luminous seam passes through the aligned layers. Architectural scale and monumental engineering aesthetic, without suggesting any specific product.
> Style/medium: premium photorealistic PBR industrial material rendering, museum-quality product-art campaign, carefully controlled physically plausible reflections.
> Composition/framing: landscape 2:1; asymmetric, low oblique macro camera angle; large cropped graphite structure dominates lower right and right edge, long aligned edges sweep from the foreground into the frame; generous truly dark negative space in upper left; powerful simple geometry, selective crisp detail, subtle optical depth.
> Lighting/mood: very soft white studio strip highlights precisely trace chamfers. Controlled electric royal-blue bounce near the single luminous seam. Deep blacks with subtle readable charcoal midtones; quiet, rigorous, expensive, no dramatic fantasy lighting.
> Color palette: graphite black, charcoal, subtle cool silver edge highlights and a single disciplined electric royal-blue accent.
> Materials/textures: finely bead-blasted anodized graphite metal and black ceramic, real microscopic machined grain, perfectly engineered edge finishing, plausible weight and surface roughness.
> Text: none.
> Constraints: no text, typography, logos, UI, watermark, literal business objects, cubes, spheres, stars, random particles, floating debris, holograms, hexagons, circuit-board patterns, excessive blue glow or multicolored light. This is a single conceptual material illustration, not a UI mockup.

## Verification

Completed October 2, 2026 against the isolated worktree:

- Production `next build`, including type checking and generation of 73 static pages, passed. Standalone TypeScript checking also passed.
- Repository lint passed with zero errors and 57 existing warnings within the configured limit; changed components have no new lint warnings.
- Full `security:check` passed, including existing billing and legal-acceptance protections.
- New rendered public-page contracts and retained public-policy regressions passed; `test:public-clarity` is now in CI. Legacy public test command aliases invoke these current suites rather than obsolete art-direction source assertions.
- Existing responsive, Executive Intelligence branding, billing-policy, legal-readiness, pre-checkout legal acceptance, and customer billing remediation suites passed.
- `git diff --check` passed.
- Actual desktop production renders inspected at 1280 and 1440 pixels; phone layouts inspected at 390 and 320 pixels. Fourteen representative public routes had no horizontal overflow or missing primary heading.
- Mobile menu open/dismiss/navigation, keyboard signal tabs, preserved sample walkthrough tabs, subscription disclosures, and checkout legal-gate routing exercised.
- Pause/resume and offscreen rendering behavior checked. Production component fallback paths exercised with controlled browser capability overrides: reduced motion, unavailable WebGL, low power, and compact device. Each retained the 850-pixel poster without a canvas. Temporary verification route removed.
- Contact required-field validation checked. A synthetic submission in the local environment reached the existing safe server error path because production credentials were absent. No live request record was created.

Screenshots are stored outside the commit at `outputs/public-revamp/` in the primary checkout: desktop homepage, mobile homepage, material section, mobile pricing, and the preserved product walkthrough.

## Remaining limits

Live public-form delivery and paid checkout were not executed. The production legal gate was preserved and inspected locally, without accepting terms. Browser viewport checks are not physical-device GPU benchmarks or a field Core Web Vitals report. One non-failing `THREE.Clock` deprecation warning originates in the existing rendering dependency stack. Go, Terraform, and live database CI jobs were not rerun locally because those systems are unchanged. Production deployment still requires approval of this preview.
