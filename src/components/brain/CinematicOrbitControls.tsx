"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
} from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import {
  advanceRestoreCooldown,
  advanceSphericalCameraPose,
  CAMERA_FOCUS_PROFILES,
  cameraDampingRate,
  cameraFocusSafeAreaFromInsets,
  cameraMaximumDistanceForAspect,
  createPackedFramingPointCloud,
  CINEMATIC_CAMERA,
  DEFAULT_CAMERA_POSE,
  hasPerspectiveProjectionChanged,
  isCameraPoseSettled,
  refreshPointerAfterCameraSettle,
  reduceCameraTransition,
  resolveRestorePose,
  shouldAutoRotateCamera,
  solveFrustumSafeCameraPose,
  solveFrustumSafeFocusPose,
  solveBottomAnchoredCameraPose,
  type BrainSelectionFocusIntent,
  type CameraPose,
  type CameraTransitionState,
  type CameraTransitionPhase,
  type PackedFramingPointCloud,
  type Point3Tuple,
} from "@/lib/brain-camera";
import type { BrainCameraGestureSignal } from "@/lib/brain-gesture";
import type { BrainExtractionPlanRegistry } from "@/lib/brain-extraction";
import { ENCLOSED_REGION_IDS } from "@/lib/brain-interaction";
import { BRAIN_REGION_BY_ID, type RegionId } from "@/lib/brain-regions";
import type { RegionLeaderWorldAnchor } from "@/lib/region-info-leader";
import {
  beginBrainTransitionScenario,
  clearBrainTransitionScenario,
  recordBrainTransitionFrame,
  recordBrainTransitionOperation,
} from "@/lib/brain-transition-performance";
import {
  lockSpecimenMotion,
  releaseSpecimenMotion,
  type SpecimenMotionState,
} from "@/lib/brain-specimen-motion";

type CinematicOrbitControlsProps = {
  mobilePresentation: boolean;
  compactLandscape: boolean;
  hoveredRegionId: RegionId | null;
  selectedRegionId: RegionId | null;
  selectionFocusIntent: BrainSelectionFocusIntent | null;
  prefersReducedMotion: boolean;
  onInteraction: () => void;
  phaseRef: MutableRefObject<CameraTransitionPhase>;
  diagnosticTargetRef: MutableRefObject<THREE.Vector3>;
  gestureSignalRef: MutableRefObject<BrainCameraGestureSignal>;
  onHoverRefresh: () => void;
  extractionPlanRef: MutableRefObject<BrainExtractionPlanRegistry>;
  specimenRef: MutableRefObject<THREE.Group | null>;
  specimenMotionRef: MutableRefObject<SpecimenMotionState>;
  savedCameraPoseRef: MutableRefObject<CameraPose | null>;
  leaderFocusAnchorRef: MutableRefObject<RegionLeaderWorldAnchor>;
  reservedLeftPx: number;
  reservedRightPx: number;
  cameraRefitRevision: number;
};

type RegionFocusEntry = {
  mesh: THREE.Mesh;
  localBounds: THREE.Box3;
  enclosed: boolean;
};

type RegionFocusRegistry = Map<RegionId, RegionFocusEntry[]>;
type FramingPointCloudCache = {
  signature: string;
  full: PackedFramingPointCloud;
  regions: Map<RegionId, PackedFramingPointCloud>;
};
type CachedFocusPose = Readonly<{
  pose: CameraPose;
  focus: Point3Tuple;
}>;
const MAX_EXACT_FRAMING_POINTS = 48_000;

const initialTransitionState: CameraTransitionState = {
  phase: "idle",
  activeRegionId: null,
  hasRestorePose: false,
};

function capturePose(
  camera: THREE.Camera,
  controls: OrbitControlsImpl,
): CameraPose {
  return {
    position: [
      camera.position.x,
      camera.position.y,
      camera.position.z,
    ],
    target: [
      controls.target.x,
      controls.target.y,
      controls.target.z,
    ],
  };
}

function collectRegionFocusRegistry(scene: THREE.Scene) {
  const registry: RegionFocusRegistry = new Map();
  scene.traverse((object) => {
    if (
      !(object instanceof THREE.Mesh) ||
      object.userData.hitProxy === true
    ) {
      return;
    }
    const regionId = object.userData.regionId;
    if (
      typeof regionId !== "string" ||
      !BRAIN_REGION_BY_ID.has(regionId as RegionId)
    ) {
      return;
    }
    if (!object.geometry.boundingBox) {
      object.geometry.computeBoundingBox();
    }
    const localBounds = object.geometry.boundingBox?.clone();
    if (!localBounds || localBounds.isEmpty()) return;
    const entries = registry.get(regionId as RegionId) ?? [];
    entries.push({
      mesh: object,
      localBounds,
      enclosed: object.userData.enclosedInternal === true,
    });
    registry.set(regionId as RegionId, entries);
  });
  return registry;
}

function framingRegistrySignature(registry: RegionFocusRegistry) {
  let signature = "";
  for (const entries of registry.values()) {
    for (const entry of entries) {
      entry.mesh.updateWorldMatrix(true, false);
      const position = entry.mesh.geometry.getAttribute("position");
      const positionVersion =
        "version" in position ? position.version : position.data.version;
      signature += `${entry.mesh.uuid}:${entry.mesh.geometry.uuid}:${positionVersion}:${position.count}:`;
      const elements = entry.mesh.matrixWorld.elements;
      if (!entry.enclosed) {
        for (let index = 0; index < 16; index += 1) {
          signature += `${elements[index].toPrecision(12)},`;
        }
      }
    }
  }
  return signature;
}

function buildWorldPointCloud(
  entries: readonly RegionFocusEntry[],
  fallbackCorners: readonly Point3Tuple[],
) {
  let pointCount = 0;
  for (const entry of entries) {
    pointCount += entry.mesh.geometry.getAttribute("position").count;
  }
  // Very large external atlases retain the conservative AABB path instead of
  // silently sampling vertices and claiming exact framing.
  if (pointCount > MAX_EXACT_FRAMING_POINTS) {
    return createPackedFramingPointCloud(
      new Float32Array(0),
      fallbackCorners,
    );
  }
  const points = new Float32Array(pointCount * 3);
  let outputOffset = 0;
  for (const entry of entries) {
    const position = entry.mesh.geometry.getAttribute("position");
    const matrix = entry.mesh.matrixWorld.elements;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      const z = position.getZ(index);
      points[outputOffset] =
        matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
      points[outputOffset + 1] =
        matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
      points[outputOffset + 2] =
        matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
      outputOffset += 3;
    }
  }
  return createPackedFramingPointCloud(points, fallbackCorners);
}

function packedPointCloudCenter(
  cloud: PackedFramingPointCloud,
  output: THREE.Vector3,
) {
  if (cloud.center) return output.fromArray(cloud.center);
  const points = cloud.points;
  if (points.length < 3) return output.set(0, 0, 0);
  let x = 0;
  let y = 0;
  let z = 0;
  const count = points.length / 3;
  for (let offset = 0; offset + 2 < points.length; offset += 3) {
    x += points[offset];
    y += points[offset + 1];
    z += points[offset + 2];
  }
  return output.set(x / count, y / count, z / count);
}

function resolveFramingPointClouds(
  registry: RegionFocusRegistry,
  regionId: RegionId,
  atlasFallbackCorners: readonly Point3Tuple[],
  regionFallbackCorners: readonly Point3Tuple[],
  cacheRef: MutableRefObject<FramingPointCloudCache | null>,
) {
  const signature = framingRegistrySignature(registry);
  let cache = cacheRef.current;
  if (!cache || cache.signature !== signature) {
    const visibleEntries: RegionFocusEntry[] = [];
    for (const entries of registry.values()) {
      for (const entry of entries) {
        if (!entry.enclosed) visibleEntries.push(entry);
      }
    }
    cache = {
      signature,
      full: buildWorldPointCloud(visibleEntries, atlasFallbackCorners),
      regions: new Map(),
    };
    cacheRef.current = cache;
  }
  let selected = cache.regions.get(regionId);
  if (!selected) {
    selected = buildWorldPointCloud(
      registry.get(regionId) ?? [],
      regionFallbackCorners,
    );
    cache.regions.set(regionId, selected);
  }
  return { full: cache.full, selected };
}

function resolveRegionWorldFocus(
  registry: RegionFocusRegistry,
  regionId: RegionId,
  intent: BrainSelectionFocusIntent | null,
  output: THREE.Vector3,
  worldBounds: THREE.Box3,
  transformedBounds: THREE.Box3,
  hitPoint: THREE.Vector3,
) {
  const entries = registry.get(regionId);
  if (!entries?.length) return false;

  worldBounds.makeEmpty();
  for (const entry of entries) {
    entry.mesh.updateWorldMatrix(true, false);
    transformedBounds
      .copy(entry.localBounds)
      .applyMatrix4(entry.mesh.matrixWorld);
    worldBounds.union(transformedBounds);
  }
  if (worldBounds.isEmpty()) return false;
  worldBounds.getCenter(output);

  if (
    intent?.regionId === regionId &&
    intent.objectUuid &&
    intent.localPoint
  ) {
    const hitEntry = entries.find(
      (entry) => entry.mesh.uuid === intent.objectUuid,
    );
    if (hitEntry) {
      hitPoint
        .fromArray(intent.localPoint)
        .applyMatrix4(hitEntry.mesh.matrixWorld);
      // Keep authored region mass as the primary composition anchor while
      // respecting the user's real surface click.
      output.lerp(hitPoint, 0.35);
    }
  }
  return true;
}

function resolveAtlasWorldBounds(
  registry: RegionFocusRegistry,
  output: THREE.Box3,
  transformedBounds: THREE.Box3,
  fitCorners: Point3Tuple[],
) {
  output.makeEmpty();
  fitCorners.length = 0;
  for (const entries of registry.values()) {
    for (const entry of entries) {
      if (entry.enclosed) continue;
      entry.mesh.updateWorldMatrix(true, false);
      transformedBounds
        .copy(entry.localBounds)
        .applyMatrix4(entry.mesh.matrixWorld);
      output.union(transformedBounds);
      fitCorners.push(...boxCorners(transformedBounds));
    }
  }
  return !output.isEmpty();
}

function boxCorners(bounds: THREE.Box3): Point3Tuple[] {
  const { min, max } = bounds;
  return [
    [min.x, min.y, min.z],
    [max.x, min.y, min.z],
    [min.x, max.y, min.z],
    [max.x, max.y, min.z],
    [min.x, min.y, max.z],
    [max.x, min.y, max.z],
    [min.x, max.y, max.z],
    [max.x, max.y, max.z],
  ];
}

function focusPoseCacheKey({
  regionId,
  viewportWidth,
  viewportHeight,
  verticalFovDegrees,
  near,
  reservedLeftPx,
  reservedRightPx,
  mobilePresentation,
  compactLandscape,
  framingSignature,
  restorePose,
  currentPose,
  focusIntent,
}: {
  regionId: RegionId;
  viewportWidth: number;
  viewportHeight: number;
  verticalFovDegrees: number;
  near: number;
  reservedLeftPx: number;
  reservedRightPx: number;
  mobilePresentation: boolean;
  compactLandscape: boolean;
  framingSignature: string;
  restorePose: CameraPose;
  currentPose: CameraPose;
  focusIntent: BrainSelectionFocusIntent | null;
}) {
  const pose = (value: CameraPose) =>
    [...value.position, ...value.target]
      .map((component) => component.toFixed(4))
      .join(",");
  const intent =
    focusIntent?.regionId === regionId
      ? `${focusIntent.objectUuid ?? "mass"}:${focusIntent.localPoint?.map(
          (component) => component.toFixed(3),
        ).join(",") ?? "center"}`
      : "center";
  return [
    regionId,
    `${viewportWidth}x${viewportHeight}`,
    verticalFovDegrees.toFixed(3),
    near.toFixed(3),
    `${Math.round(reservedLeftPx)}:${Math.round(reservedRightPx)}`,
    mobilePresentation ? "mobile" : "desktop",
    compactLandscape ? "compact" : "standard",
    framingSignature,
    pose(restorePose),
    pose(currentPose),
    intent,
  ].join("|");
}

export function CinematicOrbitControls({
  mobilePresentation,
  compactLandscape,
  hoveredRegionId,
  selectedRegionId,
  selectionFocusIntent,
  prefersReducedMotion,
  onInteraction,
  phaseRef,
  diagnosticTargetRef,
  gestureSignalRef,
  onHoverRefresh,
  extractionPlanRef,
  specimenRef,
  specimenMotionRef,
  savedCameraPoseRef: restorePoseRef,
  leaderFocusAnchorRef,
  reservedLeftPx,
  reservedRightPx,
  cameraRefitRevision,
}: CinematicOrbitControlsProps) {
  const { camera, events, scene, size } = useThree();
  const maximumDistance = Math.min(
    cameraMaximumDistanceForAspect(
      size.width / Math.max(1, size.height),
      selectedRegionId !== null && reservedRightPx > 0,
      reservedLeftPx / Math.max(1, size.width),
    ),
    mobilePresentation ? 13.5 : Number.POSITIVE_INFINITY,
  );
  const cameraRef = useRef(camera);
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const transitionRef = useRef<CameraTransitionState>(
    initialTransitionState,
  );
  const focusIntentRef = useRef(selectionFocusIntent);
  const focusRegistryRef = useRef<RegionFocusRegistry | null>(null);
  const framingPointCloudCacheRef =
    useRef<FramingPointCloudCache | null>(null);
  const pendingFocusPoseRef = useRef(false);
  const pendingIdleSafePoseRef = useRef(reservedLeftPx > 0);
  const pendingFocusReasonRef =
    useRef<"selection" | "resize" | "ui-inset">("selection");
  const focusPoseCacheRef = useRef(new Map<string, CachedFocusPose>());
  const warmedRegionIdsRef = useRef(new Set<RegionId>());
  const selectedRegionHistoryRef = useRef(new Set<RegionId>());
  const previousSelectedRegionRef = useRef<RegionId | null>(null);
  const selectionInsetRefitCountRef = useRef(0);
  const renderedSelectedRegionRef = useRef<RegionId | null>(
    selectedRegionId,
  );
  const userInteractingRef = useRef(false);
  const lastInterruptRevisionRef = useRef(0);
  const projectionSignatureRef = useRef({
    viewportWidth: 0,
    viewportHeight: 0,
    aspect: Number.NaN,
    verticalFovDegrees: Number.NaN,
    near: Number.NaN,
  });
  const restoreCooldownRemainingRef = useRef(0);
  const uiInsetSignatureRef = useRef(
    `${reservedLeftPx}:${reservedRightPx}:${cameraRefitRevision}`,
  );
  const desiredPosition = useRef(new THREE.Vector3());
  const desiredTarget = useRef(new THREE.Vector3());
  const currentFocus = useRef(new THREE.Vector3());
  const worldBounds = useRef(new THREE.Box3());
  const atlasWorldBounds = useRef(new THREE.Box3());
  const atlasFitCorners = useRef<Point3Tuple[]>([]);
  const regionFitCorners = useRef<Point3Tuple[]>([]);
  const transformedBounds = useRef(new THREE.Box3());
  const hitPoint = useRef(new THREE.Vector3());
  const prewarmConfigurationRef = useRef({
    maximumDistance,
    reservedLeftPx,
    reservedRightPx,
    viewportWidth: size.width,
  });

  useLayoutEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useLayoutEffect(() => {
    prewarmConfigurationRef.current = {
      maximumDistance,
      reservedLeftPx,
      reservedRightPx,
      viewportWidth: size.width,
    };
  }, [
    maximumDistance,
    reservedLeftPx,
    reservedRightPx,
    size.width,
  ]);

  useLayoutEffect(() => {
    if (renderedSelectedRegionRef.current === selectedRegionId) return;
    renderedSelectedRegionRef.current = selectedRegionId;
    selectionInsetRefitCountRef.current = 0;
  }, [selectedRegionId]);

  useEffect(() => {
    let cancelled = false;
    let idleHandle: number | null = null;
    const browserWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const regionQueue = [...BRAIN_REGION_BY_ID.keys()];
    let solverPrewarmed = false;
    const schedule = (work: (timeRemaining: () => number) => void) => {
      if (browserWindow.requestIdleCallback) {
        idleHandle = browserWindow.requestIdleCallback(
          (deadline) => work(() => deadline.timeRemaining()),
          { timeout: 120 },
        );
      } else {
        idleHandle = globalThis.setTimeout(
          () => work(() => 4),
          0,
        ) as unknown as number;
      }
    };
    schedule((timeRemaining) => {
      if (cancelled) return;
      const registryStartedAt = performance.now();
      scene.updateMatrixWorld(true);
      focusRegistryRef.current ??= collectRegionFocusRegistry(scene);
      resolveAtlasWorldBounds(
        focusRegistryRef.current,
        atlasWorldBounds.current,
        transformedBounds.current,
        atlasFitCorners.current,
      );
      recordBrainTransitionOperation(
        "focus-registry-prewarm",
        performance.now() - registryStartedAt,
      );
      const stageRegion = (remaining: () => number) => {
        if (cancelled || !focusRegistryRef.current) return;
        while (regionQueue.length && remaining() > 1.5) {
          const regionId = regionQueue.shift();
          if (!regionId) break;
          const startedAt = performance.now();
          resolveRegionWorldFocus(
            focusRegistryRef.current,
            regionId,
            null,
            currentFocus.current,
            worldBounds.current,
            transformedBounds.current,
            hitPoint.current,
          );
          regionFitCorners.current = boxCorners(worldBounds.current);
          const framingPointClouds = resolveFramingPointClouds(
            focusRegistryRef.current,
            regionId,
            atlasFitCorners.current,
            regionFitCorners.current,
            framingPointCloudCacheRef,
          );
          const controls = controlsRef.current;
          const activeCamera = cameraRef.current;
          if (
            !solverPrewarmed &&
            controls &&
            activeCamera instanceof THREE.PerspectiveCamera
          ) {
            const solverStartedAt = performance.now();
            const pose = capturePose(activeCamera, controls);
            const prewarmConfiguration =
              prewarmConfigurationRef.current;
            solveFrustumSafeFocusPose(
              pose,
              pose,
              currentFocus.current.toArray(),
              CAMERA_FOCUS_PROFILES.exterior,
              framingPointClouds.full,
              {
                verticalFovDegrees: activeCamera.fov,
                aspect: activeCamera.aspect,
                near: activeCamera.near,
              },
              CINEMATIC_CAMERA.minDistance,
              prewarmConfiguration.maximumDistance,
              framingPointClouds.selected,
              cameraFocusSafeAreaFromInsets(
                prewarmConfiguration.viewportWidth,
                prewarmConfiguration.reservedLeftPx,
                prewarmConfiguration.reservedRightPx,
              ),
            );
            solverPrewarmed = true;
            recordBrainTransitionOperation(
              "focus-solver-prewarm",
              performance.now() - solverStartedAt,
              regionId,
            );
          }
          warmedRegionIdsRef.current.add(regionId);
          recordBrainTransitionOperation(
            "focus-point-cloud-prewarm",
            performance.now() - startedAt,
            regionId,
          );
        }
        if (regionQueue.length) schedule(stageRegion);
      };
      stageRegion(timeRemaining);
    });
    return () => {
      cancelled = true;
      if (idleHandle === null) return;
      if (browserWindow.cancelIdleCallback) {
        browserWindow.cancelIdleCallback(idleHandle);
      } else {
        globalThis.clearTimeout(idleHandle);
      }
    };
  }, [scene]);

  useEffect(() => {
    leaderFocusAnchorRef.current.regionId = null;
    leaderFocusAnchorRef.current.reliable = false;
    focusIntentRef.current = selectionFocusIntent;
    const controls = controlsRef.current;
    const previous = transitionRef.current;
    const previousRegionId = previousSelectedRegionRef.current;
    if (previousRegionId === selectedRegionId) return;
    const next = reduceCameraTransition(previous, {
      type: "selection-change",
      regionId: selectedRegionId,
    });

    if (selectedRegionId) {
      const scenario = ENCLOSED_REGION_IDS.has(selectedRegionId)
        ? "internal-select"
        : previousRegionId && previousRegionId !== selectedRegionId
          ? "region-switch"
          : selectionFocusIntent?.source === "canvas"
            ? selectedRegionHistoryRef.current.has(selectedRegionId)
              ? "warm-click"
              : "cold-click"
            : "navigator-select";
      selectedRegionHistoryRef.current.add(selectedRegionId);
      beginBrainTransitionScenario(scenario, selectedRegionId);
      restoreCooldownRemainingRef.current = 0;
      if (!previous.hasRestorePose) {
        restorePoseRef.current = controls
          ? capturePose(camera, controls)
          : DEFAULT_CAMERA_POSE;
        const specimen = specimenRef.current;
        if (specimen) {
          specimen.updateMatrix();
          lockSpecimenMotion(specimenMotionRef.current, {
            position: specimen.position.toArray(),
            quaternion: specimen.quaternion.toArray(),
            scale: specimen.scale.toArray(),
            matrix: specimen.matrix.toArray(),
            idleElapsedSeconds:
              specimenMotionRef.current.idleElapsedSeconds,
          });
        }
      }
      pendingFocusPoseRef.current = true;
      pendingFocusReasonRef.current = "selection";
    } else if (next.phase === "returning") {
      clearBrainTransitionScenario();
      const restorePose = resolveRestorePose(restorePoseRef.current);
      desiredPosition.current.fromArray(restorePose.position);
      desiredTarget.current.fromArray(restorePose.target);
      pendingFocusPoseRef.current = false;
    }
    previousSelectedRegionRef.current = selectedRegionId;
    extractionPlanRef.current.plans.clear();
    extractionPlanRef.current.requestedRegionId =
      selectedRegionId &&
      ENCLOSED_REGION_IDS.has(selectedRegionId)
        ? selectedRegionId
        : null;
    transitionRef.current = next;
    phaseRef.current = next.phase;
  }, [
    camera,
    extractionPlanRef,
    leaderFocusAnchorRef,
    mobilePresentation,
    phaseRef,
    restorePoseRef,
    selectedRegionId,
    selectionFocusIntent,
    specimenMotionRef,
    specimenRef,
  ]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (
      controls &&
      !shouldAutoRotateCamera(
        prefersReducedMotion,
        hoveredRegionId,
        selectedRegionId,
        transitionRef.current.phase,
        userInteractingRef.current,
      )
    ) {
      controls.autoRotate = false;
    }
  }, [
    hoveredRegionId,
    prefersReducedMotion,
    selectedRegionId,
  ]);

  useLayoutEffect(() => {
    const nextSignature = `${reservedLeftPx}:${reservedRightPx}:${cameraRefitRevision}`;
    if (
      uiInsetSignatureRef.current !== nextSignature &&
      selectedRegionId &&
      selectionInsetRefitCountRef.current < 1
    ) {
      selectionInsetRefitCountRef.current += 1;
      recordBrainTransitionOperation(
        "camera-inset-refit",
        0,
        `${Math.round(reservedLeftPx)}:${Math.round(reservedRightPx)}`,
      );
      pendingFocusReasonRef.current = "ui-inset";
      pendingFocusPoseRef.current = true;
      transitionRef.current = {
        ...transitionRef.current,
        phase: "focusing",
      };
      phaseRef.current = "focusing";
    } else if (uiInsetSignatureRef.current !== nextSignature) {
      pendingIdleSafePoseRef.current = reservedLeftPx > 0;
    }
    uiInsetSignatureRef.current = nextSignature;
  }, [
    cameraRefitRevision,
    phaseRef,
    reservedLeftPx,
    reservedRightPx,
    selectedRegionId,
  ]);

  const interruptForCameraGesture = useCallback(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = false;
    }
    transitionRef.current = reduceCameraTransition(
      transitionRef.current,
      { type: "user-start" },
    );
    phaseRef.current = transitionRef.current.phase;
    if (!selectedRegionId) {
      restorePoseRef.current = null;
      pendingFocusPoseRef.current = false;
      restoreCooldownRemainingRef.current = 0;
    }
    onInteraction();
  }, [onInteraction, phaseRef, restorePoseRef, selectedRegionId]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const frameWorkStartedAt = performance.now();
    const activeCamera = cameraRef.current;
    let transition = transitionRef.current;
    diagnosticTargetRef.current.copy(controls.target);
    userInteractingRef.current =
      gestureSignalRef.current.activePointerCount > 0;

    if (
      gestureSignalRef.current.interruptRevision !==
      lastInterruptRevisionRef.current
    ) {
      lastInterruptRevisionRef.current =
        gestureSignalRef.current.interruptRevision;
      interruptForCameraGesture();
      transition = transitionRef.current;
    }

    if (activeCamera instanceof THREE.PerspectiveCamera) {
      const signature = projectionSignatureRef.current;
      const nextSignature = {
        viewportWidth: size.width,
        viewportHeight: size.height,
        aspect: activeCamera.aspect,
        verticalFovDegrees: activeCamera.fov,
        near: activeCamera.near,
      };
      const projectionChanged = hasPerspectiveProjectionChanged(
        signature,
        nextSignature,
      );
      projectionSignatureRef.current = nextSignature;
      if (
        projectionChanged &&
        selectedRegionId &&
        (transition.phase === "focusing" ||
          transition.phase === "focused")
      ) {
        if (!pendingFocusPoseRef.current) {
          pendingFocusReasonRef.current = "resize";
        }
        pendingFocusPoseRef.current = true;
        transition = {
          ...transition,
          phase: "focusing",
        };
        transitionRef.current = transition;
        phaseRef.current = "focusing";
      } else if (
        projectionChanged &&
        !selectedRegionId &&
        reservedLeftPx > 0 &&
        transition.phase === "idle"
      ) {
        pendingIdleSafePoseRef.current = true;
      }
    }

    if (
      !selectedRegionId &&
      pendingIdleSafePoseRef.current &&
      transition.phase === "idle" &&
      !userInteractingRef.current &&
      activeCamera instanceof THREE.PerspectiveCamera
    ) {
      focusRegistryRef.current ??=
        collectRegionFocusRegistry(scene);
      const hasAtlasBounds = resolveAtlasWorldBounds(
        focusRegistryRef.current,
        atlasWorldBounds.current,
        transformedBounds.current,
        atlasFitCorners.current,
      );
      if (hasAtlasBounds) {
        const framingPointClouds = resolveFramingPointClouds(
          focusRegistryRef.current,
          "frontal-lobe",
          atlasFitCorners.current,
          [],
          framingPointCloudCacheRef,
        );
        const idlePose = capturePose(activeCamera, controls);
        const safeIdle = solveFrustumSafeCameraPose(
          idlePose,
          framingPointClouds.full,
          {
            verticalFovDegrees: activeCamera.fov,
            aspect: activeCamera.aspect,
            near: activeCamera.near,
          },
          cameraFocusSafeAreaFromInsets(
            size.width,
            reservedLeftPx,
            0,
          ),
          CAMERA_FOCUS_PROFILES.exterior.safeNdcX,
          CAMERA_FOCUS_PROFILES.exterior.safeNdcY,
          maximumDistance,
        );
        activeCamera.position.fromArray(safeIdle.pose.position);
        controls.target.fromArray(safeIdle.pose.target);
        controls.update();
        diagnosticTargetRef.current.copy(controls.target);
        pendingIdleSafePoseRef.current = false;
      }
    }

    if (transition.phase === "cooldown") {
      restoreCooldownRemainingRef.current = advanceRestoreCooldown(
        restoreCooldownRemainingRef.current,
        delta,
      );
      if (restoreCooldownRemainingRef.current === 0) {
        transitionRef.current = reduceCameraTransition(transition, {
          type: "cooldown-complete",
        });
        transition = transitionRef.current;
        phaseRef.current = transition.phase;
        releaseSpecimenMotion(specimenMotionRef.current);
      }
      if (transition.phase === "cooldown") {
        activeCamera.position.copy(desiredPosition.current);
        controls.target.copy(desiredTarget.current);
        activeCamera.lookAt(controls.target);
        activeCamera.updateMatrixWorld(true);
        diagnosticTargetRef.current.copy(controls.target);
      }
    }

    controls.autoRotate = shouldAutoRotateCamera(
      prefersReducedMotion,
      hoveredRegionId,
      selectedRegionId,
      transition.phase,
      userInteractingRef.current,
    );

    if (selectedRegionId && pendingFocusPoseRef.current) {
      focusRegistryRef.current ??=
        collectRegionFocusRegistry(scene);
      const hasFocus = resolveRegionWorldFocus(
        focusRegistryRef.current,
        selectedRegionId,
        focusIntentRef.current,
        currentFocus.current,
        worldBounds.current,
        transformedBounds.current,
        hitPoint.current,
      );
      const hasAtlasBounds = resolveAtlasWorldBounds(
        focusRegistryRef.current,
        atlasWorldBounds.current,
        transformedBounds.current,
        atlasFitCorners.current,
      );
      if (
        hasFocus &&
        hasAtlasBounds &&
        activeCamera instanceof THREE.PerspectiveCamera
      ) {
        let restorePose = resolveRestorePose(
          restorePoseRef.current,
        );
        regionFitCorners.current = boxCorners(worldBounds.current);
        const framingPointClouds = resolveFramingPointClouds(
          focusRegistryRef.current,
          selectedRegionId,
          atlasFitCorners.current,
          regionFitCorners.current,
          framingPointCloudCacheRef,
        );
        if (
          pendingFocusReasonRef.current === "resize" &&
          reservedLeftPx > 0
        ) {
          restorePose = solveFrustumSafeCameraPose(
            restorePose,
            framingPointClouds.full,
            {
              verticalFovDegrees: activeCamera.fov,
              aspect: activeCamera.aspect,
              near: activeCamera.near,
            },
            cameraFocusSafeAreaFromInsets(
              size.width,
              reservedLeftPx,
              0,
            ),
            CAMERA_FOCUS_PROFILES.exterior.safeNdcX,
            CAMERA_FOCUS_PROFILES.exterior.safeNdcY,
            maximumDistance,
          ).pose;
          restorePoseRef.current = restorePose;
        }
        if (
          ENCLOSED_REGION_IDS.has(selectedRegionId) &&
          !mobilePresentation
        ) {
          packedPointCloudCenter(
            framingPointClouds.selected,
            currentFocus.current,
          );
        }
        const leaderFocusAnchor = leaderFocusAnchorRef.current;
        leaderFocusAnchor.regionId = selectedRegionId;
        leaderFocusAnchor.point[0] = currentFocus.current.x;
        leaderFocusAnchor.point[1] = currentFocus.current.y;
        leaderFocusAnchor.point[2] = currentFocus.current.z;
        leaderFocusAnchor.reliable = true;
        const focusSafeArea = cameraFocusSafeAreaFromInsets(
          size.width,
          reservedLeftPx,
          reservedRightPx,
        );
        const focusProfile =
          selectedRegionId === "corpus-callosum"
            ? CAMERA_FOCUS_PROFILES.callosum
            : selectedRegionId === "hippocampus"
              ? CAMERA_FOCUS_PROFILES.hippocampus
              : selectedRegionId === "amygdala"
                ? CAMERA_FOCUS_PROFILES.amygdala
            : selectedRegionId === "temporal-lobe"
              ? CAMERA_FOCUS_PROFILES.temporal
            : ENCLOSED_REGION_IDS.has(selectedRegionId)
              ? CAMERA_FOCUS_PROFILES.internal
              : selectedRegionId === "brain-stem"
                ? CAMERA_FOCUS_PROFILES.brainStem
                : selectedRegionId === "frontal-lobe"
                  ? CAMERA_FOCUS_PROFILES.largeExterior
                  : selectedRegionId === "prefrontal-cortex"
                    ? CAMERA_FOCUS_PROFILES.prefrontal
                    : CAMERA_FOCUS_PROFILES.exterior;
        const responsiveFocusProfile = mobilePresentation
          ? {
              ...focusProfile,
              distanceScale: Math.max(
                compactLandscape ? 0.9 : 0.88,
                focusProfile.distanceScale,
              ),
              extremeDistanceScaleBoost: 0,
              selectedSafeNdcX: Math.max(
                0.86,
                focusProfile.selectedSafeNdcX,
              ),
              selectedSafeNdcY: Math.max(
                0.82,
                focusProfile.selectedSafeNdcY,
              ),
              ...(ENCLOSED_REGION_IDS.has(selectedRegionId) &&
              selectedRegionId !== "corpus-callosum"
                ? {
                    viewDirectionBlend: 0.18,
                    backsideViewBoost: 0.08,
                    maxViewDirectionBlend: 0.28,
                    maxViewAngleDegrees: 24,
                  }
                : {}),
            }
          : focusProfile;
        const currentPose =
          pendingFocusReasonRef.current === "ui-inset"
            ? restorePose
            : capturePose(activeCamera, controls);
        const cacheKey = focusPoseCacheKey({
          regionId: selectedRegionId,
          viewportWidth: size.width,
          viewportHeight: size.height,
          verticalFovDegrees: activeCamera.fov,
          near: activeCamera.near,
          reservedLeftPx,
          reservedRightPx,
          mobilePresentation,
          compactLandscape,
          framingSignature:
            framingPointCloudCacheRef.current?.signature ?? "pending",
          restorePose,
          currentPose,
          focusIntent: focusIntentRef.current,
        });
        const focusSolveStartedAt = performance.now();
        const cachedFocus = focusPoseCacheRef.current.get(cacheKey);
        let desiredPose: CameraPose;
        if (cachedFocus) {
          desiredPose = cachedFocus.pose;
          currentFocus.current.fromArray(cachedFocus.focus);
        } else {
          desiredPose = solveFrustumSafeFocusPose(
            restorePose,
            currentPose,
            currentFocus.current.toArray(),
            responsiveFocusProfile,
            framingPointClouds.full,
            {
              verticalFovDegrees: activeCamera.fov,
              aspect: activeCamera.aspect,
              near: activeCamera.near,
            },
            CINEMATIC_CAMERA.minDistance,
            maximumDistance,
            framingPointClouds.selected,
            focusSafeArea,
          ).pose;
        }
        const mobileFramingGeometry = framingPointClouds.full;
        if (
          mobilePresentation &&
          ENCLOSED_REGION_IDS.has(selectedRegionId)
        ) {
          desiredPose = solveFrustumSafeCameraPose(
            desiredPose,
            framingPointClouds.full,
            {
              verticalFovDegrees: activeCamera.fov,
              aspect: activeCamera.aspect,
              near: activeCamera.near,
            },
            focusSafeArea,
            compactLandscape ? 0.98 : 0.9,
            compactLandscape ? 0.97 : 0.84,
            maximumDistance,
          ).pose;
        }
        if (
          mobilePresentation &&
          !compactLandscape &&
          size.width < 600 &&
          size.height > size.width
        ) {
          desiredPose = solveBottomAnchoredCameraPose(
            desiredPose,
            mobileFramingGeometry,
            {
              verticalFovDegrees: activeCamera.fov,
              aspect: activeCamera.aspect,
              near: activeCamera.near,
            },
            size.height,
            1.075,
            ENCLOSED_REGION_IDS.has(selectedRegionId) ? 180 : 168,
          ).pose;
        }
        if (!cachedFocus) {
          focusPoseCacheRef.current.set(cacheKey, {
            pose: desiredPose,
            focus: currentFocus.current.toArray(),
          });
        }
        recordBrainTransitionOperation(
          cachedFocus ? "focus-solve-cache-hit" : "focus-solve",
          performance.now() - focusSolveStartedAt,
          pendingFocusReasonRef.current,
        );
        desiredPosition.current.fromArray(desiredPose.position);
        desiredTarget.current.fromArray(desiredPose.target);
        pendingFocusPoseRef.current = false;
      }
    }

    if (
      (transition.phase !== "focusing" &&
        transition.phase !== "focused" &&
        transition.phase !== "returning") ||
      pendingFocusPoseRef.current
    ) {
      recordBrainTransitionFrame(
        delta * 1000,
        performance.now() - frameWorkStartedAt,
        transition.phase,
      );
      return;
    }

    const damping = cameraDampingRate(
      prefersReducedMotion,
      transition.phase,
    );
    const nextPose = advanceSphericalCameraPose(
      capturePose(activeCamera, controls),
      {
        position: desiredPosition.current.toArray(),
        target: desiredTarget.current.toArray(),
      },
      damping,
      delta,
    );
    controls.target.fromArray(nextPose.target);
    activeCamera.position.fromArray(nextPose.position);
    controls.update();
    diagnosticTargetRef.current.copy(controls.target);

    if (
      isCameraPoseSettled(capturePose(activeCamera, controls), {
        position: desiredPosition.current.toArray(),
        target: desiredTarget.current.toArray(),
      })
    ) {
      activeCamera.position.copy(desiredPosition.current);
      controls.target.copy(desiredTarget.current);
      controls.update();
      activeCamera.position.copy(desiredPosition.current);
      controls.target.copy(desiredTarget.current);
      activeCamera.lookAt(controls.target);
      activeCamera.updateMatrixWorld(true);
      transitionRef.current = reduceCameraTransition(
        transitionRef.current,
        { type: "settled" },
      );
      phaseRef.current = transitionRef.current.phase;
      if (transition.phase === "returning") {
        restoreCooldownRemainingRef.current =
          CINEMATIC_CAMERA.restoreCooldownSeconds;
      }
      refreshPointerAfterCameraSettle(
        (events as { update?: () => void }).update,
        onHoverRefresh,
      );
    }
    recordBrainTransitionFrame(
      delta * 1000,
      performance.now() - frameWorkStartedAt,
      transitionRef.current.phase,
    );
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      target={[0, compactLandscape ? 0.2 : 0, 0]}
      enablePan={false}
      enableDamping
      dampingFactor={0.055}
      minDistance={CINEMATIC_CAMERA.minDistance}
      maxDistance={maximumDistance}
      minPolarAngle={Math.PI * 0.28}
      maxPolarAngle={Math.PI * 0.72}
      rotateSpeed={0.52}
      zoomSpeed={0.56}
      touches={{
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_ROTATE,
      }}
      autoRotate={false}
      autoRotateSpeed={0.24}
    />
  );
}
