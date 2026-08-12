<div align="center">

# Cerebrum

### 3D Brain Explorer

A tactile, museum-style journey through the regions of the human brain.

[![Next.js 16.3](https://img.shields.io/badge/Next.js-16.3-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![React 19.2](https://img.shields.io/badge/React-19.2-61DAFB?logo=react&logoColor=06131a)](https://react.dev/)
[![Three.js r185](https://img.shields.io/badge/Three.js-r185-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![TypeScript 5](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![pnpm 10.18](https://img.shields.io/badge/pnpm-10.18-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)

</div>

![Cerebrum's resting 3D brain specimen](docs/images/cerebrum-hero.webp)

Cerebrum is an interactive human-brain exhibit for the browser. Orbit an
anatomically derived specimen, choose one of ten regions, and follow a cinematic
camera into a plain-language explanation. The experience is deliberately closer
to a premium museum installation than a textbook, dashboard, or clinical viewer.

**Read the [original build brief](PROMPT.md).**

## Live demo

**[Explore Cerebrum on the web](https://3d-brain-explorer.vercel.app/)** — no
installation required.

## Highlights

- **Ten explorable regions** spanning the cerebral lobes, cerebellum, brain
  stem, and selected internal structures.
- **Direct 3D interaction** with hover feedback, selection locking, background
  dismissal, and a synchronized region index.
- **Cinematic focus transitions** that preserve the visitor's previous orbit
  and return to it on deselection.
- **V34 continuous exterior** built from one bilateral pial render surface,
  while hidden semantic meshes retain precise picking and annotation geometry.
- **V33 internal X-ray locator** for the hippocampus, amygdala, and corpus
  callosum.
- **Responsive exhibit UI** with a desktop placard and region navigator, plus a
  touch-first bottom sheet for portrait, tablet, and compact-landscape layouts.
- **Reproducible anatomy pipeline** with checksum-locked OpenNeuro inputs,
  deterministic transforms, and machine-readable provenance.

![Temporal lobe selected on the continuous cortical surface](docs/images/region-selection.webp)

## Interaction and controls

**Desktop**

- Drag to orbit the specimen.
- Scroll to zoom.
- Hover a visible region or its index entry to preview its accent.
- Click the brain or a region name to select and focus it.
- Click the selected region again, click the background, press `Escape`, or use
  the placard close button to return.

**Touch**

- Drag to orbit and pinch to zoom.
- Tap the specimen or a region name to select it.
- Use the bottom sheet to move between the region index and the active detail.

**Keyboard**

- `Tab` enters the region navigator.
- `Arrow Up` / `Arrow Down`, `Home`, and `End` move through regions.
- `Enter` or `Space` selects the focused region.
- `Escape` dismisses the current selection.

## Inside the brain

The production presentation combines the **V34 exterior** with the
`volume-v33` internal mode. External selections are semantic responses on a
continuous PBR cortex. Selecting the hippocampus, amygdala, or corpus callosum
instead keeps the structure in its atlas-authored position and introduces three
coordinated layers:

1. a coherent, translucent whole-brain context shell;
2. a bounded, atlas-aligned MRI reference plane; and
3. a structure-specific 3D target surface derived from the same subject.

This is an intentionally stylized spatial locator—not a radiology viewer. Older
`volume-v23` through `volume-v32` modes remain in the codebase for development
comparison; V33 is the default internal renderer.

![Corpus callosum shown in the V33 internal X-ray locator](docs/images/internal-xray.webp)

## Anatomical provenance

The bundled atlas comes from subject `sub-01` in OpenNeuro dataset
[ds006128, snapshot `1.0.11`](https://openneuro.org/datasets/ds006128/versions/1.0.11).
The source dataset is released under
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).

The generation pipeline groups FreeSurfer Desikan–Killiany cortical
annotations into five surface regions and derives the cerebellum, brain stem,
hippocampus, amygdala, and corpus callosum from `aseg` labels. Source URLs,
checksums, transforms, label mappings, topology checks, and output geometry
counts are recorded in:

- [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)
- [`public/models/brain-atlas.provenance.json`](public/models/brain-atlas.provenance.json)
- [`public/textures/brain-volume-v24/manifest.json`](public/textures/brain-volume-v24/manifest.json)
- [`public/textures/brain-sections/manifest.json`](public/textures/brain-sections/manifest.json)

> [!IMPORTANT]
> Cerebrum is an educational visualization, not a medical device or diagnostic
> tool. Region boundaries and one-sentence descriptions are intentionally
> simplified for a general audience. Do not use this project for diagnosis,
> treatment, surgical planning, or clinical interpretation.

## Tech stack

- **Next.js 16 App Router** and **React 19**
- **TypeScript 5**
- **Tailwind CSS 4**
- **React Three Fiber** and **Drei**
- **Three.js r185**
- **React Three Postprocessing**
- **three-mesh-bvh** for accelerated raycasting
- **Playwright** for browser verification and capture tooling
- **pnpm 10**

## Architecture

The exhibit keeps rendering, interaction, presentation, and data generation
separate:

- `BrainExperience` owns selection state, loading/error presentation,
  responsive layout, semantic status updates, and desktop/mobile UI handoff.
- `BrainScene` configures the R3F canvas, gallery lighting, post-processing,
  pointer gesture guards, cinematic controls, and render diagnostics.
- `BrainModel` maps the atlas into ten semantic targets, builds BVHs, renders
  the unified V34 cortex, and coordinates external and internal selection states.
- `CinematicOrbitControls` computes focus framing, respects user gestures, and
  restores the saved camera/specimen pose.
- `brain-volume-*` and `brain-extraction` load and compose the V33 shell, MRI
  plane, and atlas-derived target surfaces.
- `src/lib/` contains the pure interaction, camera, layout, geometry, and
  accessibility logic exercised by the verification scripts.
- `tools/` contains reproducible asset generators, static verifiers,
  Playwright capture programs, and performance probes.

## Performance facts

The latest V34 desktop evidence was captured at **1920 × 1080, DPR 1**:

- 150,256 triangles in the rendered unified cortex.
- 10.7 MB bundled atlas GLB; semantic interaction meshes remain non-rendering.
- 1.898 ms normalized median GPU time and 2.542 ms normalized p95, against a
  6.5 ms capture budget.
- 0.300 ms p95 application work for both warm selection and region switching.
- 14.8 MiB declared GPU payload for the native-detail volume textures.

The runtime also builds BVHs for dense picking geometry, limits desktop DPR to
1.6, limits mobile DPR to 1.15 (1.1 in compact landscape), and disables desktop
shadows and post-processing in the mobile presentation. These are measured
project evidence rather than universal frame-rate guarantees; results vary by
GPU, browser, viewport, and thermal state.

## Getting started

Prerequisites:

- Node.js `20.9.0` or newer
- pnpm `10.18.x` (the repository pins `pnpm@10.18.3`)

```bash
git clone https://github.com/StarKnightt/brain-explorer.git
cd brain-explorer
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The production path is:

```bash
pnpm build
pnpm start
```

The checked-in atlas is ready to use. Set `NEXT_PUBLIC_BRAIN_MODEL_URL` at build
time only when testing a compatible replacement GLB.

## Verification

The most useful checks are:

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm build

pnpm verify:interaction       # picking, robustness, portals, BVH lifecycle
pnpm verify:camera            # cinematic framing and return behavior
pnpm verify:card              # desktop placard behavior and layout
pnpm verify:navigator         # region index behavior and keyboard model
pnpm verify:leader-navigation # selected-region leader geometry
pnpm verify:mobile            # responsive/touch presentation invariants
pnpm verify:hover-label       # fine-pointer label behavior
pnpm verify:material          # tissue palette and shader contract
pnpm verify:origin-trace      # internal atlas-coordinate preservation
pnpm verify:volume            # native volume assets and renderer contract
pnpm verify:system8           # final polish integration gate
pnpm benchmark:raycast        # baseline versus BVH ray-query benchmark
```

Capture programs under `tools/` write review evidence to the untracked
`artifacts/` workspace. That directory is development output and should not be
committed wholesale.

## Regenerating the anatomical assets

Asset generation is optional for normal development. The pipeline was validated
with CPython 3.13 and downloads only checksum-locked source files:

```bash
python -m venv .brain-atlas-venv

# Activate the environment using your shell, then:
python -m pip install -r tools/requirements-brain-atlas.txt
python tools/generate-brain-atlas.py
python tools/generate-brain-sections.py
python tools/generate-brain-volume.py
```

Downloaded MGZ and FreeSurfer inputs stay in the ignored
`.brain-atlas-cache/`; generated browser assets and their manifests are written
under `public/`. `generate-brain-atlas.py --offline` prohibits downloads, and
`--verify-only` validates an existing GLB without rebuilding it.

## Project structure

```text
src/app/                      App Router entry, metadata, global exhibit styles
src/components/brain/         3D scene, model, controls, cards, navigator, sheets
src/lib/                      Interaction, camera, layout, volume, and geometry
public/models/                Bundled atlas GLB and complete provenance record
public/textures/              MRI sections and compressed native volume payloads
tools/                        Generators, verifiers, benchmarks, and capture tools
docs/images/                  Optimized README screenshots
```

## Accessibility, responsiveness, and current limits

The desktop navigator uses real buttons with roving keyboard focus and pressed
state, selection changes are announced through an ARIA live region, dismissal
controls return focus, and `prefers-reduced-motion` disables idle/cinematic
motion where appropriate. Touch layouts provide 44 px minimum targets and
dedicated portrait, tablet, and compact-landscape presentations.

The project has not received a formal WCAG audit. Direct canvas exploration
still depends on WebGL, while the region navigator provides the semantic
alternative. The final V34 visual pass targeted the desktop exterior; mobile
layout and interaction invariants pass the repository verifier, but a dedicated
final mobile visual-polish pass remains deferred. Internal X-ray rendering also
requires a modern browser with 3D textures and `DecompressionStream` support.

## Contributing and licensing

Focused issues and pull requests are welcome. Keep anatomy provenance intact,
avoid checking in local caches or the full `artifacts/` tree, and run the
relevant verification commands before opening a change.

This repository currently does **not** declare a project-wide software license.
The CC0 terms documented above apply to the OpenNeuro source data; they do not
automatically license the application code. See
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for asset attribution.
