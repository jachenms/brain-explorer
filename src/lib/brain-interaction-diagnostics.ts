import * as THREE from "three";

import {
  getProjectedBounds,
  ndcPointToScreen,
  type Point2Tuple,
} from "./brain-interaction";
import type { RegionId } from "./brain-regions";

type Point3Tuple = readonly [number, number, number];

export type InteractionTargetDiagnostic = {
  regionId: RegionId;
  hitProxy: boolean;
  enclosed: boolean;
  visible: boolean;
  raycastScale: number;
  portalComponent: string | null;
  portalSourceRegionId: RegionId | null;
  worldBounds: {
    min: Point3Tuple;
    max: Point3Tuple;
    center: Point3Tuple;
  };
  projection: {
    ndcCenter: Point3Tuple;
    ndcBounds: { min: Point2Tuple; max: Point2Tuple };
    screenCenter: Point2Tuple;
    screenBounds: { min: Point2Tuple; max: Point2Tuple };
  };
};

function compact(value: number) {
  return Number(value.toFixed(6));
}

function point2(x: number, y: number): Point2Tuple {
  return [compact(x), compact(y)];
}

function point3(vector: THREE.Vector3): Point3Tuple {
  return [compact(vector.x), compact(vector.y), compact(vector.z)];
}

function worldBoundsForMesh(mesh: THREE.Mesh) {
  const positions = mesh.geometry.getAttribute("position");
  if (!positions || positions.count === 0) return null;
  const localBounds = mesh.geometry.boundingBox?.clone() ?? new THREE.Box3();

  if (!mesh.geometry.boundingBox) {
    const point = new THREE.Vector3();
    for (let index = 0; index < positions.count; index += 1) {
      point.set(
        positions.getX(index),
        positions.getY(index),
        positions.getZ(index),
      );
      localBounds.expandByPoint(point);
    }
  }

  return localBounds.applyMatrix4(mesh.matrixWorld);
}

export function buildInteractionTargetDiagnostic(
  mesh: THREE.Mesh,
  regionId: RegionId,
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number,
): InteractionTargetDiagnostic | null {
  const worldBounds = worldBoundsForMesh(mesh);
  if (!worldBounds || worldBounds.isEmpty()) return null;

  const worldCenter = worldBounds.getCenter(new THREE.Vector3());
  const ndcCenterVector = worldCenter.clone().project(camera);
  const ndcCorners: Point2Tuple[] = [];

  for (const x of [worldBounds.min.x, worldBounds.max.x]) {
    for (const y of [worldBounds.min.y, worldBounds.max.y]) {
      for (const z of [worldBounds.min.z, worldBounds.max.z]) {
        const projected = new THREE.Vector3(x, y, z).project(camera);
        ndcCorners.push([projected.x, projected.y]);
      }
    }
  }

  const ndcBounds = getProjectedBounds(ndcCorners);
  if (!ndcBounds) return null;

  const screenCenter = ndcPointToScreen(
    [ndcCenterVector.x, ndcCenterVector.y],
    viewportWidth,
    viewportHeight,
  );
  const screenMin = ndcPointToScreen(
    [ndcBounds.min[0], ndcBounds.max[1]],
    viewportWidth,
    viewportHeight,
  );
  const screenMax = ndcPointToScreen(
    [ndcBounds.max[0], ndcBounds.min[1]],
    viewportWidth,
    viewportHeight,
  );

  return {
    regionId,
    hitProxy: mesh.userData.hitProxy === true,
    enclosed: mesh.userData.enclosedInternal === true,
    visible: mesh.visible,
    raycastScale:
      typeof mesh.userData.raycastScale === "number"
        ? mesh.userData.raycastScale
        : 1,
    portalComponent:
      typeof mesh.userData.portalComponent === "string"
        ? mesh.userData.portalComponent
        : null,
    portalSourceRegionId:
      typeof mesh.userData.portalSourceRegionId === "string"
        ? (mesh.userData.portalSourceRegionId as RegionId)
        : null,
    worldBounds: {
      min: point3(worldBounds.min),
      max: point3(worldBounds.max),
      center: point3(worldCenter),
    },
    projection: {
      ndcCenter: point3(ndcCenterVector),
      ndcBounds: {
        min: point2(...ndcBounds.min),
        max: point2(...ndcBounds.max),
      },
      screenCenter: point2(...screenCenter),
      screenBounds: {
        min: point2(...screenMin),
        max: point2(...screenMax),
      },
    },
  };
}
