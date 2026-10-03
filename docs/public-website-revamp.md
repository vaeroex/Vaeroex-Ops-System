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

## Signature journeys — current refinement

The Intelligence landing page (`/`) now owns the **Signal Atlas**, while Executive Intelligence owns a separate **Business Landscape**. The existing Vaeroex Approach (`/intelligence-systems`) retains its original Clarity Engine sequence. Scientific pages retain their molecular and cellular worlds from `e625f1f`.

Both new worlds use actual authored geometry, five reversible stages, independent camera trajectories, and their own compact geometry. They are conceptual visualizations, not product screenshots or claims about private technical architecture. Normal document scrolling drives their progress. Page-specific classes in `SignatureJourney.module.css` apply only to the new variants; no Approach or scientific stylesheet was changed.

| Act | Signal Atlas                                            | Executive Intelligence                                            |
| --- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| 01  | Engraved source fragments suspended in depth            | Operational records spread across a machined business terrain     |
| 02  | Three shingled channels connect the information         | Connected ledger terraces reveal financial relationships          |
| 03  | An exploded relationship atlas exposes its layers       | A divergent measure separates and receives an amber emphasis      |
| 04  | Three distinct domain structures emerge                 | A finding opens into source, measure, and interpretation layers   |
| 05  | Fragments resolve into a cohesive intelligence landmark | Evidence consolidates beside a priority briefing for human review |

Executive copy is limited to existing Business Health, KPIs and confirmed targets, prioritized intelligence, Explain Finding, Evidence, Saved Analyses, and eligible on-demand Weekly/Monthly Briefings. The geometry contains no invented live financial values, guaranteed forecasts, or autonomous actions.

The home page’s “Clarity you can look into” section replaces the material photo with an accessible evidence diagram. Its clearly labeled synthetic figures show revenue of $100,000 → $112,000 (+12%) and listed costs of $70,000 → $82,600 (+18%). The displayed formula yields illustrative margins of 30% → 26.25%, a reduction of 3.75 percentage points. Undated periods, incomplete cost coverage, and unknown freshness are visible limitations. It is a teaching illustration, not a product result or customer data.

The material-study asset remains archived in the repository; it is no longer used in this section. Original scientific data, source archives, geometry, product copy, and posters remain intact.

### Current assets and motion deliverables

All new scene meshes, engraved details, connections, procedural material maps, and reflection studios are authored in this repository. Executive’s object labels use a local system font drawn to small CanvasTextures; no external font, HDR, image, or model service is requested. The main structures are actual 3D geometry.

`public/brand/signature/landing-poster.webp` and `business-poster.webp` are optimized 900×663 captures of their own rendered worlds, approximately 28KB and 15KB. There are no placeholder images in the finished implementation. Abstract forms and illustrated business relationships are deliberate conceptual representations.

Review recordings are saved in the primary checkout’s ignored `outputs/intelligence-journeys/` folder:

- `landing-journey.mp4`: the complete five-act Signal Atlas and reverse traversal.
- `executive-journey.mp4`: the complete business landscape and reverse traversal.

These are recordings of the live browser canvas, composed with the actual page’s chapter captions at 1440×900/30fps; they are not full-window screen captures. A temporary localhost capture control scrolled the ordinary document through the five chapter centers and back. It did not inject scene poses. Background capture temporarily kept its local canvas active. The control and capture override were removed before the final build; ordinary hidden-tab/offscreen pausing remains enabled. Original WebM captures and contact sheets accompany the MP4s. The initial idle frames before the landing canvas first produced a video frame were trimmed; every stage and the complete reversal remain.

### Current verification

- Both new worlds inspected in actual forward and backward browser scrolling. Five stages remain native document chapters with keyboard-accessible anchor navigation.
- Portrait viewport 390×844 renders real compact geometry with no horizontal overflow. Landscape 844×390 retains a scene alongside the copy. These are desktop-browser viewport checks, not physical-device benchmarks.
- Pause/Resume and offscreen inactivity exercised. Reduced-motion/resource policy regressions cover retained poster fallbacks and ensure small screens alone cannot disable 3D.
- Signature regression tests sample 801 poses in full and compact quality, verify continuous/reversible motion and distinct camera paths, validate real geometry budgets/stable curve buffers, and derive the diagram’s arithmetic from its rendered table.
- The original Approach world/motion/styles/page, both scientific worlds/pages, and their source assets match commit `e625f1f`. Only the new variants receive the signature renderer and layout.
- Final production build and all five public suites passed. Lint passed with zero errors and 57 existing warnings. Full security regressions passed. The final local build reloaded Approach, Molecular, and Cellular WebGL successfully with no recorded console errors.

## Earlier scroll refinement

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

## Initial direction and implementation

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

## Initial rendering and performance

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

| Asset                                     | Source                                                                                                                    | Delivery                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `public/brand/clarity-engine-poster.webp` | Screenshot render of the custom project geometry, composed in a temporary local studio route; route removed after capture | 850 × 850, about 78 kB                                     |
| `public/brand/clarity-material.webp`      | Original image created with the built-in image generation tool, inspected visually and resized/compressed                 | 1920 × 960, about 132 kB                                   |
| `public/fonts/manrope/Manrope.ttf`        | Official Google Fonts repository, Manrope variable font                                                                   | Approximately 161 kB; local delivery, `font-display: swap` |
| `public/fonts/manrope/OFL.txt`            | Upstream SIL Open Font License                                                                                            | Included with font                                         |

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

## Dedicated scientific journeys — October 2 refinement

The research pages now use separate procedural 3D worlds rather than the shared research aperture. Drug Discovery follows five acts: a deposited protein backbone, an atom-derived surface and pocket, three reference compounds, an authored approach ending at the observed acetazolamide pose, and a named comparison. Biological Intelligence follows a generic cellular environment, a phospholipid/receptor cutaway, the organized cell interior, a vesicle/protein close-up, and a pullback to neighboring cells. Both connect the visual narrative to the intended research products, whose development status and absence of checkout remain unchanged.

The protein/compound geometry uses PDB 1AZM and CCD references with archived official sources and reproducible preprocessing. Scientific source attribution, representation limits, and licensing are detailed in `scientific-assets.md`. The generic cell is original procedural geometry. Neither animation represents a simulation, docking result, therapeutic effect, or released research capability.

The five chapters remain ordinary server-rendered sections. Passive native-scroll measurement drives pure camera/object/material functions through a short settling interpolation. Backward scrolling reverses the same functions. Native chapter links and a Continue exploring link provide direct access. The site has no wheel interception, scroll lock, automatic tour, or forced pacing.

Scientific canvases load near the viewport and render on demand. Offscreen/hidden/paused scenes stop advancing. Compact devices retain 3D with fewer mesh subdivisions, fewer anatomical instances, and DPR 1; desktop DPR is capped at 1.5. Reduced motion, constrained-device policy, unavailable WebGL, loading failures, and context failures retain a local poster and all page text. Readiness-probe animation frames are cancelled when the scientific canvas unmounts.

Two local review recordings show the live rendered canvas with the actual chapter text, five forward acts, and a reverse return. They are review captures with composed captions, rather than offline rendered animation. Static hero/fallback posters were extracted from the actual geometry. The temporary recorder used for the review is removed from the shipping source.

Intentional simplifications: the molecular surface is a smooth approximate Gaussian envelope, not a solvent-excluded surface or density map; water and hydrogens are omitted. Molecular paths are authored. Cell and protein sizes/timing are composed for legibility, neighboring cells have reduced anatomy, and the generic receptor/transport process does not assert a named mechanism. Mobile receives lower geometric detail. No placeholder models remain in either five-act sequence.

Verification for this refinement: `pnpm build` passed including TypeScript and static page generation; `pnpm lint` passed with 0 errors and 57 pre-existing warnings; `pnpm test:public-clarity` passed all public rendering, policy, original Clarity motion, and scientific suites; `pnpm security:check` passed. Browser checks covered every act, forward and reverse scrolling, native chapter navigation, pause/resume, offscreen inactivity, desktop resizing, 390×844 compact rendering, and 844×390 landscape layout. These are browser viewport checks, not claims about a physical phone benchmark. The final local production-mode previews on port 3100 reported no browser errors. Production deployment remains on hold for review.


## Approved merge and production hold

The redesign was approved for merge on October 2, 2026. The current `main` branch was integrated before verification, retaining its integration and workspace changes.

Vercel tracks `main` as Production and automatically assigns production domains. To preserve the requested production hold while merging, `vercel.json` explicitly sets `git.deploymentEnabled.main` to `false`. This pauses automatic Git deployments from `main` for this project; preview branches retain their existing behavior. It does not disable the running site or prevent an explicitly authorized manual deployment.

Release requires separate approval. Once release is approved, remove the `main: false` entry and merge that change to restore automatic deployment, or perform a separately approved manual release. Do not remove the existing Square branch exclusions.
