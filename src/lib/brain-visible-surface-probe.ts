import * as THREE from "three";

import {
  getBrainIntersectionRegionId,
  resolveBrainInteraction,
} from "./brain-interaction-raycast";
import type { RegionId } from "./brain-regions";
import { getRegionInfoCardLayout } from "./region-info-card-layout";
import {
  scheduleRegionLeaderProbeBudget,
  type RegionLeaderProbeQueueName,
  type RegionLeaderProbeScheduleDiagnostics,
  type RegionLeaderScreenRect,
} from "./region-info-leader";

export const VISIBLE_SURFACE_PROBE = {
  interiorGridSize: 5,
  directionalInsetPx: 2,
  maximumRays: 49,
} as const;

export type VisibleSurfaceProbePoint = {
  ndc: { x: number; y: number };
  screen: { x: number; y: number };
  source:
    | "clicked"
    | "previous"
    | "support"
    | "contour"
    | "directional"
    | "fallback"
    | "grid";
  queue: RegionLeaderProbeQueueName;
};

export type VisibleSurfaceProbeHit = {
  mesh: THREE.Mesh;
  componentId: string;
  worldPoint: THREE.Vector3;
  localPoint: THREE.Vector3;
  screenPoint: { x: number; y: number };
  source:
    | "clicked"
    | "previous"
    | "support"
    | "contour"
    | "directional"
    | "fallback"
    | "grid";
  queue: RegionLeaderProbeQueueName;
  confidence: "verified";
};

export type VisibleSurfaceProbeCounts = {
  registeredMeshCount: number;
  directionalProbeCount: number;
  directionalHitCount: number;
  supportGridCount: number;
  raysTested: number;
  visibleHitCount: number;
  rejectedResolutionCount: number;
  rejectedProxyCount: number;
  rejectedInvisibleCount: number;
};

export type VisibleSurfaceProbeResult = {
  hits: VisibleSurfaceProbeHit[];
  reason: "verified" | "visibility-unverified" | "no-registered-meshes";
  counts: VisibleSurfaceProbeCounts;
  scheduleDiagnostics: RegionLeaderProbeScheduleDiagnostics;
  elapsedMilliseconds: number;
};

export function isVisibleSurfaceObject(object: THREE.Object3D) {
  // V34 renders one welded cortex while retaining the aligned authored
  // parcels as non-rendered interaction geometry. Those parcels are the
  // semantic surface queried by pointer picking and leader projection, so
  // treat them as surface-visible while still rejecting anything hidden by
  // an ancestor (for example an inactive internal extraction group).
  if (
    !object.visible &&
    !(
      object.userData.auxiliaryRegionHitGeometry === true &&
      object.userData.hitProxy !== true &&
      object.userData.enclosedInternal !== true
    )
  ) {
    return false;
  }
  let current: THREE.Object3D | null = object.parent;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function screenToNdc(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  return {
    x: (x / viewportWidth) * 2 - 1,
    y: 1 - (y / viewportHeight) * 2,
  };
}

export function createVisibleSurfaceProbeGrid(
  selectedBounds: RegionLeaderScreenRect,
  viewportWidth: number,
  viewportHeight: number,
) {
  const width = Math.max(1, selectedBounds.right - selectedBounds.left);
  const height = Math.max(1, selectedBounds.bottom - selectedBounds.top);
  const insetX = Math.min(3, width * 0.08);
  const insetY = Math.min(3, height * 0.08);
  const left = selectedBounds.left + insetX;
  const right = selectedBounds.right - insetX;
  const top = selectedBounds.top + insetY;
  const bottom = selectedBounds.bottom - insetY;
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const points: VisibleSurfaceProbePoint[] = [];
  for (
    let row = 0;
    row < VISIBLE_SURFACE_PROBE.interiorGridSize;
    row += 1
  ) {
    const y =
      top +
      ((bottom - top) * row) /
        (VISIBLE_SURFACE_PROBE.interiorGridSize - 1);
    for (
      let column = 0;
      column < VISIBLE_SURFACE_PROBE.interiorGridSize;
      column += 1
    ) {
      const x =
        right -
        ((right - left) * column) /
          (VISIBLE_SURFACE_PROBE.interiorGridSize - 1);
      points.push({
        ndc: screenToNdc(x, y, viewportWidth, viewportHeight),
        screen: { x, y },
        source: "grid",
        queue: "interior",
      });
    }
  }
  return points
    .sort((first, second) => {
      const firstCardFacing = right - first.screen.x;
      const secondCardFacing = right - second.screen.x;
      const firstCenterDistance =
        Math.abs(first.screen.y - centerY) +
        Math.abs(first.screen.x - centerX) * 0.2;
      const secondCenterDistance =
        Math.abs(second.screen.y - centerY) +
        Math.abs(second.screen.x - centerX) * 0.2;
      return (
        firstCardFacing - secondCardFacing ||
        firstCenterDistance - secondCenterDistance ||
        first.screen.y - second.screen.y
      );
    })
    .slice(0, VISIBLE_SURFACE_PROBE.maximumRays);
}

export function createVisibleSurfaceDirectionalProbes(
  bounds: RegionLeaderScreenRect,
  viewportWidth: number,
  viewportHeight: number,
) {
  const width = Math.max(1, bounds.right - bounds.left);
  const height = Math.max(1, bounds.bottom - bounds.top);
  const insetX = Math.min(
    VISIBLE_SURFACE_PROBE.directionalInsetPx,
    width * 0.2,
  );
  const insetY = Math.min(
    VISIBLE_SURFACE_PROBE.directionalInsetPx,
    height * 0.2,
  );
  const rightX = bounds.right - insetX;
  const topY = bounds.top + insetY;
  const bottomY = bounds.bottom - insetY;
  const layout = getRegionInfoCardLayout(viewportWidth, viewportHeight);
  const sourceY = layout.top + layout.leaderAttachmentOffsetYPx;
  const screenPoints = [
    ...[0.1, 0.25, 0.5, 0.75, 0.9].map((quantile) => ({
      x: rightX,
      y: bounds.top + height * quantile,
    })),
    ...[0.9, 0.75, 0.5].map((quantile) => ({
      x: bounds.left + width * quantile,
      y: topY,
    })),
    ...[0.9, 0.75, 0.5].map((quantile) => ({
      x: bounds.left + width * quantile,
      y: bottomY,
    })),
    {
      x: rightX,
      y: Math.max(bounds.top + insetY, Math.min(bounds.bottom - insetY, sourceY)),
    },
  ];
  const probes: VisibleSurfaceProbePoint[] = [];
  for (const screen of screenPoints) {
    if (
      probes.some(
        (probe) =>
          Math.hypot(
            probe.screen.x - screen.x,
            probe.screen.y - screen.y,
          ) < 0.5,
      )
    ) {
      continue;
    }
    probes.push({
      ndc: screenToNdc(
        screen.x,
        screen.y,
        viewportWidth,
        viewportHeight,
      ),
      screen,
      source: "directional",
      queue: "directional",
    });
  }
  return probes;
}

export function raycastBrainAtNdc({
  ndc,
  camera,
  raycaster,
  meshes,
}: {
  ndc: THREE.Vector2;
  camera: THREE.Camera;
  raycaster: THREE.Raycaster;
  meshes: THREE.Mesh[];
}) {
  raycaster.setFromCamera(ndc, camera);
  (
    raycaster as THREE.Raycaster & {
      firstHitOnly?: boolean;
    }
  ).firstHitOnly = true;
  const intersections = raycaster.intersectObjects(meshes, false);
  return {
    intersections,
    resolvedRegionId: resolveBrainInteraction(intersections),
  };
}

export function probeVisibleRegionSurface({
  regionId,
  selectedBounds,
  viewportWidth,
  viewportHeight,
  camera,
  raycaster,
  foregroundMeshes,
  selectedMeshes,
  clickedPoint,
  previousPoints = [],
  fallbackPoints = [],
  contourPoints = [],
  maximumRays = VISIBLE_SURFACE_PROBE.maximumRays,
  rayBatchStart = 0,
  rayBatchSize = maximumRays,
}: {
  regionId: RegionId;
  selectedBounds: RegionLeaderScreenRect;
  viewportWidth: number;
  viewportHeight: number;
  camera: THREE.Camera;
  raycaster: THREE.Raycaster;
  foregroundMeshes: readonly THREE.Mesh[];
  selectedMeshes: readonly THREE.Mesh[];
  clickedPoint?: { mesh: THREE.Mesh; localPoint: readonly number[] } | null;
  previousPoints?: {
    mesh: THREE.Mesh;
    localPoint: readonly number[];
  }[];
  fallbackPoints?: {
    mesh: THREE.Mesh;
    localPoint: readonly number[];
  }[];
  contourPoints?: { x: number; y: number }[];
  maximumRays?: number;
  rayBatchStart?: number;
  rayBatchSize?: number;
}): VisibleSurfaceProbeResult {
  const startedAt = globalThis.performance?.now() ?? Date.now();
  const visibleForeground = foregroundMeshes.filter(
    isVisibleSurfaceObject,
  );
  const visibleSelected = selectedMeshes.filter(isVisibleSurfaceObject);
  const counts: VisibleSurfaceProbeCounts = {
    registeredMeshCount: selectedMeshes.length,
    directionalProbeCount: 0,
    directionalHitCount: 0,
    supportGridCount: 0,
    raysTested: 0,
    visibleHitCount: 0,
    rejectedResolutionCount: 0,
    rejectedProxyCount: 0,
    rejectedInvisibleCount: 0,
  };
  const queues: Record<
    RegionLeaderProbeQueueName,
    VisibleSurfaceProbePoint[]
  > = {
    click: [],
    support: [],
    directional: [],
    interior: [],
    fallback: [],
  };
  if (!selectedMeshes.length) {
    const schedule = scheduleRegionLeaderProbeBudget(queues);
    return {
      hits: [],
      reason: "no-registered-meshes",
      counts,
      scheduleDiagnostics: schedule.diagnostics,
      elapsedMilliseconds:
        (globalThis.performance?.now() ?? Date.now()) - startedAt,
    };
  }

  const projectedSupportBounds = new Map<string, RegionLeaderScreenRect>();
  const projectedSupportCandidates: {
    preferred: { mesh: THREE.Mesh; localPoint: readonly number[] };
    screen: { x: number; y: number };
  }[] = [];
  for (const fallbackPoint of fallbackPoints) {
    if (!visibleSelected.includes(fallbackPoint.mesh)) continue;
    fallbackPoint.mesh.updateWorldMatrix(true, false);
    const localPoint = new THREE.Vector3().fromArray(
      fallbackPoint.localPoint,
    );
    const projected = localPoint
      .clone()
      .applyMatrix4(fallbackPoint.mesh.matrixWorld)
      .project(camera);
    if (
      ![projected.x, projected.y, projected.z].every(Number.isFinite) ||
      projected.z < -1 ||
      projected.z > 1
    ) {
      continue;
    }
    const screen = {
      x: ((projected.x + 1) * viewportWidth) / 2,
      y: ((1 - projected.y) * viewportHeight) / 2,
    };
    projectedSupportCandidates.push({
      preferred: fallbackPoint,
      screen,
    });
    const side =
      Math.abs(localPoint.x) < 0.0001
        ? "midline"
        : localPoint.x < 0
          ? "left"
          : "right";
    const key = `${fallbackPoint.mesh.uuid}:${side}`;
    const bounds = projectedSupportBounds.get(key);
    if (bounds) {
      bounds.left = Math.min(bounds.left, screen.x);
      bounds.top = Math.min(bounds.top, screen.y);
      bounds.right = Math.max(bounds.right, screen.x);
      bounds.bottom = Math.max(bounds.bottom, screen.y);
    } else {
      projectedSupportBounds.set(key, {
        left: screen.x,
        top: screen.y,
        right: screen.x,
        bottom: screen.y,
      });
    }
  }
  const addPreferredPoint = (
    preferred:
      | { mesh: THREE.Mesh; localPoint: readonly number[] }
      | null
      | undefined,
    source: "clicked" | "previous" | "support" | "fallback",
    queue: RegionLeaderProbeQueueName,
  ) => {
    if (!preferred || !visibleSelected.includes(preferred.mesh)) return;
    preferred.mesh.updateWorldMatrix(true, false);
    const worldPoint = new THREE.Vector3()
      .fromArray(preferred.localPoint)
      .applyMatrix4(preferred.mesh.matrixWorld);
    const projected = worldPoint.clone().project(camera);
    if (
      [projected.x, projected.y, projected.z].every(Number.isFinite) &&
      projected.z >= -1 &&
      projected.z <= 1
    ) {
      const screen = {
        x: ((projected.x + 1) * viewportWidth) / 2,
        y: ((1 - projected.y) * viewportHeight) / 2,
      };
      queues[queue].push({
        ndc: { x: projected.x, y: projected.y },
        screen,
        source,
        queue,
      });
    }
  };
  addPreferredPoint(clickedPoint, "clicked", "click");
  for (const previousPoint of previousPoints) {
    addPreferredPoint(previousPoint, "previous", "fallback");
  }
  const supportCenterY =
    (selectedBounds.top + selectedBounds.bottom) / 2;
  for (const candidate of projectedSupportCandidates
    .sort(
      (first, second) =>
        second.screen.x - first.screen.x ||
        Math.abs(first.screen.y - supportCenterY) -
          Math.abs(second.screen.y - supportCenterY),
    )) {
    addPreferredPoint(candidate.preferred, "support", "support");
  }
  const componentBounds = [...projectedSupportBounds.entries()]
    .filter(
      ([, bounds]) =>
        bounds.right - bounds.left >= 1 &&
        bounds.bottom - bounds.top >= 1,
    )
    .sort(
      ([, first], [, second]) =>
        second.right - first.right ||
        first.top - second.top,
    );
  const hasSeparatedComponents =
    componentBounds.filter(([key]) => /:(left|right)$/.test(key))
      .length > 1;
  const directionalBounds = hasSeparatedComponents
    ? componentBounds.map(([, bounds]) => bounds)
    : [selectedBounds];
  for (const screen of contourPoints) {
    queues.directional.push({
      ndc: screenToNdc(
        screen.x,
        screen.y,
        viewportWidth,
        viewportHeight,
      ),
      screen,
      source: "contour",
      queue: "directional",
    });
  }
  for (const bounds of directionalBounds) {
    for (const probe of createVisibleSurfaceDirectionalProbes(
      bounds,
      viewportWidth,
      viewportHeight,
    )) {
      queues.directional.push(probe);
    }
  }
  const stratifiedFallbackPoints = Array.from(
    { length: Math.min(16, fallbackPoints.length) },
    (_, index) =>
      fallbackPoints[
        Math.min(
          fallbackPoints.length - 1,
          Math.round(
            (index * (fallbackPoints.length - 1)) /
              Math.max(1, Math.min(16, fallbackPoints.length) - 1),
          ),
        )
      ],
  );
  for (const fallbackPoint of stratifiedFallbackPoints) {
    addPreferredPoint(fallbackPoint, "fallback", "fallback");
  }
  const grid = createVisibleSurfaceProbeGrid(
    selectedBounds,
    viewportWidth,
    viewportHeight,
  );
  for (const probe of grid) {
    queues.interior.push(probe);
  }
  const schedule = scheduleRegionLeaderProbeBudget(
    queues,
    maximumRays,
  );
  counts.directionalProbeCount =
    schedule.diagnostics.queues.directional.reserved +
    schedule.diagnostics.queues.directional.borrowed;
  counts.supportGridCount =
    schedule.diagnostics.queues.interior.reserved +
    schedule.diagnostics.queues.interior.borrowed;

  const hits: VisibleSurfaceProbeHit[] = [];
  const probeNdc = new THREE.Vector2();
  for (const scheduledProbe of schedule.scheduled.slice(
    rayBatchStart,
    rayBatchStart + rayBatchSize,
  )) {
    const probe = scheduledProbe.candidate;
    schedule.diagnostics.queues[scheduledProbe.queue].attempted += 1;
    counts.raysTested += 1;
    const result = raycastBrainAtNdc({
      ndc: probeNdc.set(probe.ndc.x, probe.ndc.y),
      camera,
      raycaster,
      meshes: visibleForeground,
    });
    if (result.resolvedRegionId !== regionId) {
      counts.rejectedResolutionCount += 1;
      continue;
    }
    const selectedHit = result.intersections.find(
      (intersection) =>
        getBrainIntersectionRegionId(intersection) === regionId &&
        intersection.object instanceof THREE.Mesh &&
        intersection.object.userData.hitProxy !== true &&
        isVisibleSurfaceObject(intersection.object),
    );
    if (!selectedHit || !(selectedHit.object instanceof THREE.Mesh)) {
      const proxyHit = result.intersections.some(
        (intersection) =>
          getBrainIntersectionRegionId(intersection) === regionId &&
          intersection.object.userData.hitProxy === true,
      );
      if (proxyHit) counts.rejectedProxyCount += 1;
      else counts.rejectedInvisibleCount += 1;
      continue;
    }
    schedule.diagnostics.queues[scheduledProbe.queue].hit += 1;
    const mesh = selectedHit.object;
    const localPoint = mesh.worldToLocal(selectedHit.point.clone());
    const authoredSide =
      typeof mesh.userData.side === "string"
        ? mesh.userData.side
        : null;
    const componentSide =
      authoredSide ??
      (mesh.userData.enclosedInternal === true
        ? localPoint.x < 0
          ? "left"
          : "right"
        : null);
    if (
      hits.some(
        (hit) =>
          hit.mesh === mesh &&
          Math.hypot(
            hit.screenPoint.x - probe.screen.x,
            hit.screenPoint.y - probe.screen.y,
          ) < 1,
      )
    ) {
      continue;
    }
    hits.push({
      mesh,
      componentId: componentSide
        ? `${mesh.uuid}:${componentSide}`
        : mesh.uuid,
      worldPoint: selectedHit.point.clone(),
      localPoint,
      screenPoint: probe.screen,
      source: probe.source,
      queue: scheduledProbe.queue,
      confidence: "verified",
    });
    if (scheduledProbe.queue === "directional") {
      counts.directionalHitCount += 1;
    }
  }
  counts.visibleHitCount = hits.length;
  return {
    hits,
    reason: hits.length ? "verified" : "visibility-unverified",
    counts,
    scheduleDiagnostics: schedule.diagnostics,
    elapsedMilliseconds:
      (globalThis.performance?.now() ?? Date.now()) - startedAt,
  };
}
