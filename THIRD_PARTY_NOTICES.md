# Third-Party Notices

## `public/models/brain-atlas.glb`

The bundled anatomical atlas is derived from subject `sub-01` of OpenNeuro
dataset **ds006128**, “Data for ‘Modeling 2D Spatio-Tactile Population
Receptive Fields of the Fingertip in Human Primary Somatosensory Cortex’”:

- Repository: https://github.com/OpenNeuroDatasets/ds006128
- Snapshot: `1.0.11`
- Snapshot DOI: https://doi.org/10.18112/openneuro.ds006128.v1.0.11
- License: CC0 1.0 Universal
  (https://creativecommons.org/publicdomain/zero/1.0/)
- Inputs: bilateral FreeSurfer `lh.pial.T1`/`rh.pial.T1` surfaces,
  matching `lh.white`/`rh.white` topology references,
  `lh.curv`/`rh.curv` morphometry, `lh.aparc.annot`/`rh.aparc.annot`,
  and `aseg.mgz`
- Changes: Desikan-Killiany annotations were grouped into five cortical
  regions; selected aseg labels were converted to surfaces in FreeSurfer
  surface RAS/TKR coordinates; tiny disconnected voxel fragments were removed;
  the cerebellum received a conservative closed signed-distance envelope and
  the brain stem a clean unclosed signed-distance envelope; cortical decimation
  rejected non-manifold edge collapses and deterministically averaged native
  curvature through accepted collapses; geometry was reoriented for Three.js
  and packaged as GLB with `_CURVATURE` vertex attributes and invisible
  cortical hit proxies for enclosed structures. Enclosed internal meshes remain
  packaged for future reveal but are hidden at runtime to prevent pial-fissure
  bleed.

Exact source URLs, git-annex SHA-256 checksums, label mappings, coordinate
transforms, triangle counts, and generated-asset checksum are recorded in
`public/models/brain-atlas.provenance.json`. The reproducible transformation is
implemented by `tools/generate-brain-atlas.py`.
