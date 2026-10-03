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

## Scroll refinement

The hero-only interaction in commit `927de4b` has been replaced with a persistent native-scroll journey. Open <http://127.0.0.1:3100/> and scroll forward through chapters 01–04, then backward. The chapter links also work with keyboard navigation. The preview itself is the motion deliverable; the stills below are supporting evidence only.

The prior website was inspected at base commit `90982062976ca905095ba68c193c52eddf795f1b`, particularly `components/marketing/spatial/PublicSpatialCanvas.tsx`, `components/marketing/intelligence-systems/IntelligenceSystemsSpatialCanvas.tsx`, their corresponding worlds, and page compositions. The old homepage camera crossed nine waypoints from z=15 to z=-101; the systems page crossed eleven waypoints from z=14 to z=-241. It also opened visibility panels as the narrative advanced. The new scene preserves the idea of a reversible journey through successive visual states, using a coherent machined structure and demand rendering instead of the old permanent frame intervals.

The four Clarity Engine acts are fragmented inputs, information moving through separated layers, organizing context, and a resolved intelligence core. The camera crosses from one side of the structure to the other, layers translate and rotate independently, blue signal elements travel into the assembly, and the core moves forward and brightens. Scroll position is the narrative clock; there is no continuous rotation, wheel interception, forced scroll speed, or scroll trapping.

`ClarityJourney.tsx` renders every chapter as ordinary server-rendered content beside one persistent canvas. `ClarityEngine.tsx` reads actual chapter centers, recalculates their anchors on resize, and coalesces passive scroll updates with requestAnimationFrame. `clarityMotion.ts` supplies pure bounded trajectories. The canvas applies poses imperatively and sleeps when the short smoothing transition settles. Pause freezes the current pose; a paused resize can reframe it once without advancing the sequence.

Product moments replace prior explanatory sections:

- Executive Intelligence: four chapters following sources, context, interpretation, and human decisions, using exploded evidence layers.
- Intelligence Systems: four chapters following information through domain-specific context, using three architectural branches that converge into a common core.
- Drug Discovery Intelligence and Biological Intelligence: three chapters each, with a rotating and separating evidence-layer arrangement. Both remain explicitly planned research environments.

Capable phones render simplified real geometry. Width and touch select compact quality; they do not disable WebGL. Compact uses five layers, fewer fragments/signals, DPR 1, no shadow pass, and brighter frontal lighting. Reduced motion, data saving, severe resource constraints (reported ≤2 cores or ≤2 GB), unavailable WebGL, and rendering failures retain the static image. Portrait phones use a scene above the reading area; short landscape phones place it alongside the copy so it cannot cover the viewport.

### Motion verification

- Final production preview inspected at 1440×900 and 390×844. Development preview additionally checked at 320×800 and 667×375, including transitions between portrait, landscape, and desktop while the scene was running or paused.
- Actual forward scroll samples at y=686, 1445, and 2228.5 yielded progress 0.2952, 0.6382, and 0.9945. Camera positions moved from approximately `[-5.97,1.85,7.91]` through `[5.61,3.35,7.80]` to `[2.87,1.54,8.00]`. Reversing to y=686 returned progress to 0.2952 and the corresponding scene pose; tiny camera variation reflects pointer parallax.
- Native chapter links, Pause/Resume, offscreen inactivity, and normal scrolling beyond the journey exercised. Canvas touch-action remains `auto`.
- Live compact WebGL confirmed after mobile resize. Five immersive routes checked at 320px: no horizontal overflow, one primary heading each, and all chapter copy retained.
- Reduced-motion, failed-WebGL, and low-resource capability overrides each retained the 850px poster with zero canvases. Temporary local verification route removed before the production build.
- No browser console errors in the final preview. Production build, TypeScript, repository lint (57 existing warnings, zero errors), full security regressions, and public policy/rendering checks passed.
- New trajectory regressions cover four variants and both quality levels across 301 samples each, including reverse traversal, input bounds, finite transforms, transition continuity, substantial camera changes, final layer convergence, and geometry limits. Capability tests prevent width-only suppression of mobile 3D. The motion suite runs with `test:public-clarity` in CI.

Motion screenshots and the observed scroll/camera log are in the primary checkout's `outputs/public-revamp/`: `scroll-01-inputs.png`, `scroll-02-depth.png`, `scroll-03-alignment.png`, `scroll-04-core.png`, `scroll-mobile.png`, and `motion-verification.json`.

## Direction and implementation

**The Clarity Engine** turns fragmented information into an ordered, illuminated center. A bespoke layered graphite aperture, blue recessed seams, chamfered metal edges, and a central Vaeroex chevron establish the visual identity. Manrope typography, broad dark space, ruled editorial lists, and restrained transitions carry it through the public site. Concept illustrations and sample data are explicitly labeled.

The homepage now moves from a plain-language value proposition through an interactive signal-to-decision explanation, product capabilities, a material-led evidence section, and clearly separated product availability. Executive Intelligence, the system directory, research-domain pages, and pricing have distinct editorial layouts. Shared navigation, footer, supporting-page heroes, request forms, help, and public policy pages use the same visual language.

- `app/page.tsx` and `app/public-home.module.css`: homepage composition.
- `components/marketing/clarity/ClarityJourney.*`: multi-section composition with ordinary chapter links and responsive sticky artwork.
- `components/marketing/clarity/*`: real Three.js / React Three Fiber geometry, capability selection, static fallback, rendering lifecycle, and materials.
- `components/marketing/PublicNavigation.tsx`: desktop disclosures and mobile navigation, Escape and outside-click dismissal.
- `components/marketing/public-design.css`: public-only typography, color, focus, forms, and utility styles. It does not alter the authenticated application theme.
- `components/marketing/IntelligencePages.module.css`: shared product and pricing composition.

The available product remains Executive Intelligence at **$500/month**, sourced from existing product and billing definitions. Subscription calls to action retain `/checkout/legal`. Drug Discovery Intelligence and Biological Intelligence remain in development with pricing not announced and no checkout. The existing product walkthrough remains visibly marked as a sample.

No authenticated application, API, integration, billing implementation, security control, database policy, form action, middleware, or dependency lockfile changed. The request form's change is presentation only. Existing legal/company details, brand icon, and NVIDIA Inception membership attribution remain intact.

## Rendering and performance

The interactive journey uses actual modeled geometry. The static image is the previously commissioned resolved render of the same modeled structure and is labeled as a concept render when used. The separate material study is also explicitly illustrative.

- Geometry: approximately 13.5k visible triangles / 92 meshes full, 9.6k / 67 meshes compact; custom buffers and materials are shared.
- Procedural roughness texture: 64 × 64, approximately 16 KiB; no downloaded environment map.
- Local studio lighting/PMREM, pixel ratio capped at 1.5, 2048-pixel shadow map.
- Dynamic canvas import deferred until idle and near the viewport; readable server-rendered text and poster precede it.
- Demand rendering settles when motion stops; offscreen and hidden-tab animation pause. A visible Pause/Resume control is available.
- Compact/touch devices retain simplified interactive geometry. Reduced motion, data saving, severely constrained device resources, failed WebGL, and rendering errors retain the static artwork.
- No scroll hijacking or perpetual rotation. Large scroll-driven camera/layer transformations follow the chapter sequence; pointer parallax remains subtle.
- Production build initial JavaScript: homepage 118 kB, Executive Intelligence 121 kB, research/systems pages 118 kB, pricing 115 kB; shared 103 kB. These are Next.js build estimates, not network or field-performance measurements. The interactive Three.js payload is separate and deferred.

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

Initial redesign verification completed October 2, 2026 against the isolated worktree; the subsequent motion pass is recorded above:

- Production `next build`, including type checking and generation of 73 static pages, passed. Standalone TypeScript checking also passed.
- Repository lint passed with zero errors and 57 existing warnings within the configured limit; changed components have no new lint warnings.
- Full `security:check` passed, including existing billing and legal-acceptance protections.
- New rendered public-page contracts and retained public-policy regressions passed; `test:public-clarity` is now in CI. Legacy public test command aliases invoke these current suites rather than obsolete art-direction source assertions.
- Existing responsive, Executive Intelligence branding, billing-policy, legal-readiness, pre-checkout legal acceptance, and customer billing remediation suites passed.
- `git diff --check` passed.
- Actual desktop production renders inspected at 1280 and 1440 pixels; phone layouts inspected at 390 and 320 pixels. Fourteen representative public routes had no horizontal overflow or missing primary heading.
- Mobile menu open/dismiss/navigation, keyboard signal tabs, preserved sample walkthrough tabs, subscription disclosures, and checkout legal-gate routing exercised.
- Pause/resume and offscreen rendering behavior checked. Production component fallback paths exercised with controlled browser capability overrides: reduced motion, unavailable WebGL, and low power. Each retained the 850-pixel poster without a canvas. The subsequent motion pass replaces the original compact-device fallback with a lighter interactive scene. Temporary verification route removed.
- Contact required-field validation checked. A synthetic submission in the local environment reached the existing safe server error path because production credentials were absent. No live request record was created.

Screenshots are stored outside the commit at `outputs/public-revamp/` in the primary checkout: desktop homepage, mobile homepage, material section, mobile pricing, and the preserved product walkthrough.

## Remaining limits

Live public-form delivery and paid checkout were not executed. The production legal gate was preserved and inspected locally, without accepting terms. Browser viewport checks are not physical-device GPU benchmarks or a field Core Web Vitals report. One non-failing `THREE.Clock` deprecation warning originates in the existing rendering dependency stack. Go, Terraform, and live database CI jobs were not rerun locally because those systems are unchanged. Production deployment still requires approval of this preview.
