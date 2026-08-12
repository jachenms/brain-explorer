import * as THREE from "three";

import type { RegionId } from "./brain-regions";

export const SURFACE_PORTAL_BASE_RADIUS_MM = 2.7;
export const SURFACE_PORTAL_SEGMENTS = {
  width: 12,
  height: 8,
} as const;

// The bundled atlas is authored in display RAS: +X right, +Y superior,
// +Z anterior. These normalized targets select actual temporal-pial vertices,
// rather than storing camera/screen coordinates: hippocampus uses a
// posterior-medial and moderately superior temporal access point; amygdala
// uses a distinctly anterior, inferior temporal-pole access point.
const temporalPortalZones = {
  hippocampus: {
    regionId: "hippocampus",
    x: 0.52,
    y: 0.46,
    z: 0.3,
  },
  amygdala: {
    regionId: "amygdala",
    x: 0.74,
    y: 0.16,
    z: 0.8,
  },
} as const;

type PortalSide = "left" | "right" | "midline";

export type SurfacePortalComponent = {
  regionId: RegionId;
  side: PortalSide;
  sourceRegionId: RegionId;
  sourceSurfacePoint: readonly [number, number, number];
  center: readonly [number, number, number];
  baseRadiusMillimeters: number;
  effectiveRadiusMillimeters: number;
  triangles: number;
  mesh: THREE.Mesh;
};

export type SurfacePortalInstallation = {
  components: SurfacePortalComponent[];
  replacedGeometries: THREE.BufferGeometry[];
  addedMeshes: THREE.Mesh[];
};

type SurfaceVertex = {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  sourceRegionId: RegionId;
};

function regionMeshes(root: THREE.Object3D, regionId: RegionId) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      object.userData.regionId === regionId &&
      object.userData.hitProxy !== true
    ) {
      meshes.push(object);
    }
  });
  return meshes;
}

function proxyMesh(root: THREE.Object3D, regionId: RegionId) {
  let result: THREE.Mesh | null = null;
  root.traverse((object) => {
    if (
      !result &&
      object instanceof THREE.Mesh &&
      object.userData.regionId === regionId &&
      object.userData.hitProxy === true
    ) {
      result = object;
    }
  });
  return result;
}

function surfaceVertices(meshes: readonly THREE.Mesh[]) {
  const result: SurfaceVertex[] = [];
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (const mesh of meshes) {
    const sourceRegionId = mesh.userData.regionId as RegionId;
    const positions = mesh.geometry.getAttribute("position");
    const normals = mesh.geometry.getAttribute("normal");
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);

    for (let index = 0; index < positions.count; index += 1) {
      point
        .set(
          positions.getX(index),
          positions.getY(index),
          positions.getZ(index),
        )
        .applyMatrix4(mesh.matrixWorld);
      if (normals) {
        normal
          .set(
            normals.getX(index),
            normals.getY(index),
            normals.getZ(index),
          )
          .applyNormalMatrix(normalMatrix)
          .normalize();
      } else {
        normal.copy(point).normalize();
      }
      result.push({
        point: point.clone(),
        normal: normal.clone(),
        sourceRegionId,
      });
    }
  }

  return result;
}

function boundsForVertices(vertices: readonly SurfaceVertex[]) {
  const bounds = new THREE.Box3();
  vertices.forEach((vertex) => bounds.expandByPoint(vertex.point));
  return bounds;
}

function normalized(value: number, min: number, max: number) {
  return (value - min) / Math.max(max - min, 0.001);
}

function deriveTemporalAnchor(
  vertices: readonly SurfaceVertex[],
  side: -1 | 1,
  zone: (typeof temporalPortalZones)[keyof typeof temporalPortalZones],
) {
  const bounds = boundsForVertices(vertices);
  const maxAbsX = Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x));
  let best: SurfaceVertex | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const vertex of vertices) {
    if (Math.sign(vertex.point.x) !== side) continue;
    const x = Math.abs(vertex.point.x) / Math.max(maxAbsX, 0.001);
    const y = normalized(vertex.point.y, bounds.min.y, bounds.max.y);
    const z = normalized(vertex.point.z, bounds.min.z, bounds.max.z);
    const lateralFacing = Math.max(vertex.normal.x * side, 0);
    const score =
      (x - zone.x) ** 2 * 1.2 +
      (y - zone.y) ** 2 * 1.5 +
      (z - zone.z) ** 2 +
      (1 - lateralFacing) ** 2 * 0.35;
    if (score < bestScore) {
      best = vertex;
      bestScore = score;
    }
  }

  if (!best) {
    throw new Error(`No temporal surface anchor for ${zone.regionId}`);
  }
  return best;
}

function deriveCallosalAnchor(vertices: readonly SurfaceVertex[]) {
  const bounds = boundsForVertices(vertices);
  const maxAbsX = Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x));
  let best: SurfaceVertex | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const vertex of vertices) {
    const x = Math.abs(vertex.point.x) / Math.max(maxAbsX, 0.001);
    const y = normalized(vertex.point.y, bounds.min.y, bounds.max.y);
    const z = normalized(vertex.point.z, bounds.min.z, bounds.max.z);
    const fissureFacing = Math.max(
      -Math.sign(vertex.point.x) * vertex.normal.x,
      0,
    );
    // Favor a real frontal/parietal pial vertex in the superior longitudinal
    // fissure: near the midline, upper crown, and central anterior/posterior.
    const score =
      x ** 2 * 3.5 +
      (y - 0.76) ** 2 * 1.4 +
      (z - 0.48) ** 2 +
      (1 - fissureFacing) ** 2 * 0.25;
    if (score < bestScore) {
      best = vertex;
      bestScore = score;
    }
  }

  if (!best) throw new Error("No superior-midline cortical anchor");
  return best;
}

function portalGeometry(
  proxy: THREE.Mesh,
  anchor: SurfaceVertex,
  raycastScale: number,
) {
  const effectiveRadius = SURFACE_PORTAL_BASE_RADIUS_MM * raycastScale;
  const center = anchor.point
    .clone()
    .addScaledVector(anchor.normal, effectiveRadius * 0.55);
  const localCenter = center
    .clone()
    .applyMatrix4(proxy.matrixWorld.clone().invert());
  const geometry = new THREE.SphereGeometry(
    SURFACE_PORTAL_BASE_RADIUS_MM,
    SURFACE_PORTAL_SEGMENTS.width,
    SURFACE_PORTAL_SEGMENTS.height,
  );
  geometry.translate(localCenter.x, localCenter.y, localCenter.z);
  const localBounds = new THREE.Box3().setFromObject(
    new THREE.Mesh(geometry),
  );
  const boundsCenter = localBounds.getCenter(new THREE.Vector3());
  geometry.translate(-boundsCenter.x, -boundsCenter.y, -boundsCenter.z);
  geometry.scale(raycastScale, raycastScale, raycastScale);
  geometry.translate(boundsCenter.x, boundsCenter.y, boundsCenter.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return { geometry, center, effectiveRadius };
}

function installComponents(
  proxy: THREE.Mesh,
  anchors: readonly {
    anchor: SurfaceVertex;
    side: PortalSide;
    sourceRegionId: RegionId;
  }[],
  raycastScale: number,
  result: SurfacePortalInstallation,
) {
  const parent = proxy.parent;
  if (!parent) throw new Error(`Detached proxy ${proxy.name}`);

  anchors.forEach(({ anchor, side, sourceRegionId }, index) => {
    const mesh = index === 0 ? proxy : proxy.clone(false);
    if (index !== 0) {
      parent.add(mesh);
      result.addedMeshes.push(mesh);
    }
    mesh.updateWorldMatrix(true, false);
    const portal = portalGeometry(mesh, anchor, raycastScale);
    if (index === 0) {
      result.replacedGeometries.push(mesh.geometry);
    }

    mesh.geometry = portal.geometry;
    mesh.name = `hit-proxy--${mesh.userData.regionId}--${side}`;
    mesh.visible = false;
    mesh.userData = {
      ...mesh.userData,
      portalComponent: side,
      portalSourceRegionId: sourceRegionId,
      raycastScale,
    };

    result.components.push({
      regionId: mesh.userData.regionId as RegionId,
      side,
      sourceRegionId,
      sourceSurfacePoint: [
        anchor.point.x,
        anchor.point.y,
        anchor.point.z,
      ],
      center: [portal.center.x, portal.center.y, portal.center.z],
      baseRadiusMillimeters: SURFACE_PORTAL_BASE_RADIUS_MM,
      effectiveRadiusMillimeters: portal.effectiveRadius,
      triangles: portal.geometry.index
        ? portal.geometry.index.count / 3
        : portal.geometry.getAttribute("position").count / 3,
      mesh,
    });
  });
}

export function installBundledSurfaceAccessPortals(
  root: THREE.Object3D,
  raycastScale: number,
): SurfacePortalInstallation {
  root.updateMatrixWorld(true);
  const temporalVertices = surfaceVertices(
    regionMeshes(root, "temporal-lobe"),
  );
  const midlineVertices = surfaceVertices([
    ...regionMeshes(root, "frontal-lobe"),
    ...regionMeshes(root, "parietal-lobe"),
  ]);
  const result: SurfacePortalInstallation = {
    components: [],
    replacedGeometries: [],
    addedMeshes: [],
  };

  for (const zone of Object.values(temporalPortalZones)) {
    const proxy = proxyMesh(root, zone.regionId);
    if (!proxy) throw new Error(`Missing bundled proxy ${zone.regionId}`);
    installComponents(
      proxy,
      [
        {
          anchor: deriveTemporalAnchor(temporalVertices, -1, zone),
          side: "left",
          sourceRegionId: "temporal-lobe",
        },
        {
          anchor: deriveTemporalAnchor(temporalVertices, 1, zone),
          side: "right",
          sourceRegionId: "temporal-lobe",
        },
      ],
      raycastScale,
      result,
    );
  }

  const callosalProxy = proxyMesh(root, "corpus-callosum");
  if (!callosalProxy) throw new Error("Missing bundled corpus-callosum proxy");
  const callosalAnchor = deriveCallosalAnchor(midlineVertices);
  installComponents(
    callosalProxy,
    [
      {
        anchor: callosalAnchor,
        side: "midline",
        sourceRegionId: callosalAnchor.sourceRegionId,
      },
    ],
    raycastScale,
    result,
  );

  root.updateMatrixWorld(true);
  return result;
}
