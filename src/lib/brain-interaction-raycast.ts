import type * as THREE from "three";

import {
  resolveRegionIntersection,
  type RegionIntersectionReader,
} from "./brain-interaction";
import {
  BRAIN_REGION_BY_ID,
  type RegionId,
} from "./brain-regions";

export type BrainRayIntersection = THREE.Intersection<THREE.Object3D>;

function intersectionRegionId(
  intersection: BrainRayIntersection,
): RegionId | null {
  const value = intersection.object.userData.regionId;
  return typeof value === "string" &&
    BRAIN_REGION_BY_ID.has(value as RegionId)
    ? (value as RegionId)
    : null;
}

export const BRAIN_INTERSECTION_READER: RegionIntersectionReader<BrainRayIntersection> =
  {
    getDistance: (intersection) => intersection.distance,
    getRegionId: intersectionRegionId,
    isHitProxy: (intersection) =>
      intersection.object.userData.hitProxy === true,
    isVisible: (intersection) =>
      intersection.object.visible ||
      intersection.object.userData.auxiliaryRegionHitGeometry === true,
  };

export function resolveBrainInteraction(
  intersections: readonly BrainRayIntersection[],
) {
  return resolveRegionIntersection(intersections, BRAIN_INTERSECTION_READER);
}

export function getBrainIntersectionRegionId(
  intersection: BrainRayIntersection,
) {
  return intersectionRegionId(intersection);
}
