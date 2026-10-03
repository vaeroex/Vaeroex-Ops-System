# Public scientific illustrations: provenance and interpretation

These assets support the public Drug Discovery Intelligence and Biological Intelligence pages. Both products remain in development. The scenes are explanatory illustrations; they do not demonstrate a released research product or produce scientific results.

## Observed molecular structure

The molecular scene uses **human carbonic anhydrase I, PDB 1AZM**, not carbonic anhydrase II. The structure was determined by X-ray diffraction at **2.00 Å** resolution. The retained chain A has 258 modeled Cα positions and 2,019 protein atoms; the illustrated bound acetazolamide has 13 heavy atoms. A zinc ion is present in the deposited structure. [RCSB structure record](https://www.rcsb.org/structure/1AZM), [PDB DOI](https://doi.org/10.2210/pdb1AZM/pdb).

Original depositors: S. Chakravarty and K. K. Kannan. The primary publication is their 1994 *Journal of Molecular Biology* study of three sulfonamide complexes of human carbonic anhydrase I. [Publication DOI](https://doi.org/10.1006/jmbi.1994.1655).

The source files were retrieved directly from official RCSB endpoints on 2026-10-02 and are archived in `scripts/science-sources/`. RCSB identifies PDB archive files and its programmatic API data as **CC0 1.0**. Attribution is retained here and in the scene. No RCSB web illustration or third-party DrugBank prose was copied into these assets. [RCSB usage policy](https://www.rcsb.org/pages/usage-policy).

| Source file | Official download | SHA-256 |
| --- | --- | --- |
| 1AZM.pdb | [PDB coordinates](https://files.rcsb.org/download/1AZM.pdb) | `cfe92653bb7633f9fb87fd92f0c4a8e8ad3f9405449c0dc8ca3191d6c2c9c6ea` |
| AZM.cif | [CCD AZM](https://files.rcsb.org/ligands/download/AZM.cif) | `9afddb10dce8ffc0a481c46ee659eae0adfc75e42eb92388a5d4165d49ec7445` |
| MZM.cif | [CCD MZM](https://files.rcsb.org/ligands/download/MZM.cif) | `1b3a2e38b5de3301512d566c10d2ab0cc0fd674ceef6f2239f7f38dfb0bd9acb` |
| EZL.cif | [CCD EZL](https://files.rcsb.org/ligands/download/EZL.cif) | `85b79b0da7a9e585829cc9908d5d51150c51462924510cc6839cad9dac4a826c` |

## Molecular representations

- The backbone follows deposited Cα coordinates. Ribbon orientation can use the retained backbone carbonyl oxygen positions. HELIX and SHEET records determine the secondary-structure categories; coil means neither category was assigned in those records. These categories are not a new secondary-structure prediction.
- The **bound AZM** atoms use their observed 1AZM coordinates. Chemical bond connectivity and orders come from the CCD AZM record. Hydrogen atoms and crystallographic water are omitted for clarity.
- The comparison retains the observed [acetazolamide (AZM)](https://www.rcsb.org/ligand/AZM) conformer under a rigid presentation transform. [Methazolamide (MZM)](https://www.rcsb.org/ligand/MZM) and [ethoxzolamide (EZL)](https://www.rcsb.org/ligand/EZL) use independently centered CCD **ideal coordinates**. The asset also archives an ideal AZM conformer for reproducibility. The identifiers matter: EZA is a different chemical component and is not used. These ideal conformers are curated reference depictions, not measured poses in this protein or ranked candidates.
- The zinc guide connects the nearest observed ligand atom, AZM N1, to the observed zinc position. Their deposited-coordinate separation is 2.012 Å. It is a coordination annotation, not an inferred covalent bond or newly calculated binding result.
- At scroll progress 0.75, the protein and bound ligand have identity transforms, preserving the observed relative coordinates. All approach paths, rotations, comparison layouts, fades, and camera paths are authored choreography. They do not represent molecular dynamics, a docking trajectory, affinity, selectivity, safety, efficacy, or a successful experimental outcome.

The rigid coordinate transform centers the bound ligand centroid at the origin, aligns the protein-to-ligand direction with +Z, and scales every observed coordinate by 0.14 scene units per Å. The right-handed orthonormal transform preserves distances, relative positioning, and molecular chirality. It is recorded in the generated asset.

## Precomputed surface and delivery

`node scripts/science-build-assets.mjs` rebuilds `public/brand/science/carbonic-anhydrase-1azm.json` from the archived files. It requires only the project's existing Three.js dependency and Node built-ins. There is no network request during rebuilding or runtime surface generation.

The surface is an **approximate Gaussian atom envelope** around protein atoms. Each atom contributes `exp(-d²/(2σ²))`, with σ equal to 0.65 times its illustrative van der Waals radius; the isovalue is 0.25. The chosen radii are C 1.70 Å, N 1.55 Å, O 1.52 Å, and S 1.80 Å. Three.js marching cubes samples grids of 88³ and 48³ for desktop and compact geometry, respectively. The moderately broadened field and finer grid reduce coarse, atom-scale interior cavities in the close view. This illustrative envelope is not an exact solvent-excluded surface, solvent-accessible surface, electron-density map, electrostatic map, or validated binding-pocket prediction. The pocket highlight is an illustrative focus near the observed ligand.

The indexed meshes contain 62,630 and 17,696 nondegenerate triangles after quantization. Surface positions are encoded as signed little-endian 16-bit integers at 0.001 scene-unit precision; area-weighted vertex normals are recomputed from the final quantized facets and use signed 8-bit values divided by 127; indices use unsigned little-endian 16-bit integers. The combined local JSON, including both surfaces, observed atoms, backbone, and three comparison references, is 1,326,843 bytes before transfer compression and 728,273 bytes with gzip. `dataLoader.ts` decodes the buffers and shares a cached loading promise, resetting the cache after a rejected request.

The runtime uses normal-based lighting on these meshes. Any visual color or light emphasis is explanatory art direction and must not be described as computed charge, activity, binding energy, or probability.

## Generic cellular illustration

The cell scene is original procedural geometry representing a **generic eukaryotic cell**. It is not a reconstruction of a sampled cell, a particular species, a measured tissue, or a named molecular complex. Cell-to-organelle-to-protein scales and timing are composed for legibility and are **not to scale**.

The authored forms use canonical relationships: a lipid bilayer containing membrane-spanning proteins, internal membrane compartments, a nucleus, and mitochondria with inner-membrane folds. The conceptual membrane protein, vesicle path, relay signals, and neighboring-cell arrangement do not establish a specific transport mechanism, signaling pathway, or tissue behavior. Background morphology references include [Cooper, Structure of the Plasma Membrane](https://www.ncbi.nlm.nih.gov/books/NBK9898/), [Alberts et al., Membrane Structure](https://www.ncbi.nlm.nih.gov/books/NBK21055/), and the [NLM mitochondria definition](https://www.ncbi.nlm.nih.gov/mesh/68008928). No figures or prose from those references are reproduced.

## Verification

`pnpm test:science` checks the archived protein hash, rigid-coordinate preservation, chirality, bound ligand alignment, coordination distance, connected chemical graphs, finite mesh data and valid indices, normalized surface normals, area-weighted normal agreement, consistent adjacent winding, absence of collapsed triangles, compact geometry reduction, cached-load recovery, deterministic forward/reverse five-stage trajectories, and visible molecular bounding-box containment across 801 progress samples for both quality levels and four viewport aspect ratios. The public rendering suite separately checks all five scientific chapters, native links, accurate isoform/source labels, conceptual disclosures, server-rendered fallback images, and unchanged research availability.

These tests verify data handling and presentation contracts. They do not validate the scene as a scientific simulation.

## Static alternatives and review recordings

The two WebP posters are frames from the actual procedural scene, used by the server-rendered hero and the reduced-motion/unavailable-WebGL fallback. They are not generated concept artwork. The original Clarity Engine material asset, typography, and non-research journeys remain in place.

Local review recordings capture the live browser WebGL canvas while native document scroll is advanced through each section, with the server-rendered chapter copy re-presented as readable video captions. Each approximately 49-second recording includes five forward acts and a reverse return. A temporary local capture control generated these files and was removed before the final build. The production site has no automatic tour, scroll interception, or forced pacing.
