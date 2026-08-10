# Spatial Workspace Extension Contract

The authenticated workspace uses one persistent, presentation-only WebGL environment behind authoritative DOM routes.

The browser-local `workspaceExperience` preference selects either `intel3d` or `simple`. Intel 3D mounts this environment when the existing capability check passes. Simple renders the same routed DOM application without the global canvas, camera handoff, route frame, or spatial motion. This preference is independent from color theme, never changes routes or authoritative data, and requires no database state.

To add a major destination:

1. Register its canonical route, world region, camera position/target/FOV, curve bias, surface inset/alignment, arrival pose, and presentation accent in `spatial-destinations.ts`.
2. Add a destination-specific assembly in `SpatialWorkspaceCanvas.tsx`. The assembly may visualize structure and ambient continuity, but it must not derive new business facts or describe private processing architecture.
3. Keep readable information, forms, controls, citations, and accessibility semantics in the routed DOM page. WebGL owns only environment, depth, route camera, ambient presentation, and explicitly bounded analytical views.
4. Add route, capability-tier, interaction, and mobile-fallback coverage to `scripts/spatial-ui-regression-tests.js` and the browser verification pass.

The global camera and DOM route plane read only the destination registry. Distance-aware travel timing is computed by `spatialTravelPlan`; individual routes must not invent separate transition constants. The camera publishes a mutable, presentation-only travel intensity to the shared environment so signal velocity and rim lighting can respond without React frame-state churn. Foreground fin banks, layered compute substrates, open bus portals, signal conduits, and depth frames must remain reusable procedural assets placed around real camera paths; they may not become literal data-flow claims or obscure the settled reading plane.

The premium world grammar lives in `SpatialEnvironmentAssets.tsx`. New compositions should reuse `ComputationalWall`, `SignalCorridor`, `SiliconArray`, `DataConduit`, `ArchitecturalFrame`, `MemoryStructure`, `PrecisionAperture`, `SubstrateLayer`, and `DestinationDock` with the shared anodized-metal, satin-graphite, ceramic, polished-silicon, smoked-glass, and conductive-signal materials. Prefer a few large architectural structures with foreground, interface, midground, far, and deep-space roles over collections of small primitives.

Each route owns a distinct hero composition in `DestinationArchitecture`. Inactive destinations retain a restrained recognizable threshold so the next place becomes legible before arrival. Transition passages may partially occlude the reading plane while the camera is moving, but the settled destination must restore a clear authoritative DOM surface. Lighting is art directed from shared area, key, localized destination, and travel-rim sources; do not add bloom or decorative particles to compensate for weak form.

New destinations must occupy a materially distinct world region, reveal a recognizable silhouette before arrival, and settle without ambient camera drift. They must not add free-flight controls or fork the application navigation model. Local analytical canvases may use bounded controls inside their own intentional interaction region.

The former Intelligence-only Cards/Spatial visualization has been retired. `/app/intelligence` always renders the authoritative Intelligence cards inside whichever global workspace experience the user selected. Shared low-level WebGL utilities remain available to the global workspace and the optional KPI-specific 3D chart.
