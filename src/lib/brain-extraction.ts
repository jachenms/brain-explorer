import type {
  CameraFocusSafeArea,
  CameraPose,
  PerspectiveProjection,
  Point3Tuple,
} from "./brain-camera";
import type { RegionId } from "./brain-regions";

export type ExtractionPhase = "idle" | "extracting" | "settled" | "retracting";

export type BrainExtractionState = {
  activeRegionId: RegionId | null;
  phase: ExtractionPhase;
  progress: number;
  rawProgress: number;
  timelineSeconds: number;
};

export type ProjectedExtractionBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type BrainExtractionPlan = {
  regionId: RegionId;
  scale: number;
  worldOffset: Point3Tuple;
  originalCentroid: Point3Tuple;
  finalCentroid: Point3Tuple;
  originalBounds: ProjectedExtractionBounds;
  finalTargetBounds: ProjectedExtractionBounds;
  finalBrainBounds: ProjectedExtractionBounds;
  finalUnionBounds: ProjectedExtractionBounds;
  screenGapPixels: number;
  brainHeightPixels: number;
  targetWidthPixels: number;
  targetHeightPixels: number;
  pose: CameraPose;
  transformedPoints: Float32Array;
};

export type BrainExtractionPlanRegistry = {
  requestedRegionId: RegionId | null;
  plans: Map<RegionId, BrainExtractionPlan>;
};

export const INITIAL_BRAIN_EXTRACTION_STATE: BrainExtractionState = {
  activeRegionId: null,
  phase: "idle",
  progress: 0,
  rawProgress: 0,
  timelineSeconds: 0,
};

export const BRAIN_EXTRACTION = {
  transitionRate: 6.5,
  reducedMotionTransitionRate: 30,
  settleEpsilon: 0.002,
  openingDwellSeconds: 0.07,
  openingDurationSeconds: 1.18,
  openingTimeExponent: 0.68,
  contextRecession: 0.15,
  safeNdcX: 0.933,
  safeNdcY: 0.881,
  cardLaneSolveGuardNdc: 0.002,
  targetGapPixels: 64,
  targetRenderOrder: 0,
  mobileOverlayDepthWorld: 2.6,
  mobileOverlayLateralWorld: 0.45,
  mobileOverlayVerticalWorld: 0.25,
  mobileOverlayScale: 0.68,
  profiles: {
    hippocampus: {
      scale: 1.1,
      targetWidthPixels: 340,
      verticalOffsetWorld: 0.38,
    },
    amygdala: {
      scale: 1.12,
      targetWidthPixels: 300,
      verticalOffsetWorld: -0.12,
    },
    "corpus-callosum": {
      scale: 1.06,
      targetWidthPixels: 380,
      verticalOffsetWorld: 0.24,
    },
  },
} as const;

export function createBrainExtractionPlanRegistry(): BrainExtractionPlanRegistry {
  return {
    requestedRegionId: null,
    plans: new Map(),
  };
}

export function easeExtractionProgress(progress: number) {
  const value = Number.isFinite(progress)
    ? Math.min(1, Math.max(0, progress))
    : 0;
  return value * value * (3 - 2 * value);
}

function smootherstep(value: number) {
  const clamped = Math.min(1, Math.max(0, value));
  return (
    clamped *
    clamped *
    clamped *
    (clamped * (clamped * 6 - 15) + 10)
  );
}

export function extractionOpeningTimeline(elapsedSeconds: number) {
  const elapsed =
    Number.isFinite(elapsedSeconds) && elapsedSeconds > 0
      ? elapsedSeconds
      : 0;
  if (elapsed <= BRAIN_EXTRACTION.openingDwellSeconds) {
    return { rawProgress: 0, easedProgress: 0 };
  }
  if (elapsed >= BRAIN_EXTRACTION.openingDurationSeconds) {
    return { rawProgress: 1, easedProgress: 1 };
  }
  const rawProgress =
    (elapsed - BRAIN_EXTRACTION.openingDwellSeconds) /
    (BRAIN_EXTRACTION.openingDurationSeconds -
      BRAIN_EXTRACTION.openingDwellSeconds);
  const timeWarpedProgress =
    rawProgress ** BRAIN_EXTRACTION.openingTimeExponent;
  return {
    rawProgress,
    easedProgress: smootherstep(timeWarpedProgress),
  };
}

function inverseSmoothstep(progress: number) {
  const target = Math.min(1, Math.max(0, progress));
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 18; iteration += 1) {
    const midpoint = (low + high) / 2;
    if (easeExtractionProgress(midpoint) < target) low = midpoint;
    else high = midpoint;
  }
  return (low + high) / 2;
}

function openingElapsedForProgress(progress: number) {
  const target = Math.min(1, Math.max(0, progress));
  let low: number = BRAIN_EXTRACTION.openingDwellSeconds;
  let high: number = BRAIN_EXTRACTION.openingDurationSeconds;
  for (let iteration = 0; iteration < 18; iteration += 1) {
    const midpoint = (low + high) / 2;
    if (extractionOpeningTimeline(midpoint).easedProgress < target) {
      low = midpoint;
    } else {
      high = midpoint;
    }
  }
  return (low + high) / 2;
}

export function advanceBrainExtraction(
  state: BrainExtractionState,
  requestedRegionId: RegionId | null,
  deltaSeconds: number,
  prefersReducedMotion: boolean,
): BrainExtractionState {
  let activeRegionId = state.activeRegionId;
  let progress = Number.isFinite(state.progress)
    ? Math.min(1, Math.max(0, state.progress))
    : 0;
  let rawProgress = Number.isFinite(state.rawProgress)
    ? Math.min(1, Math.max(0, state.rawProgress))
    : inverseSmoothstep(progress);
  let timelineSeconds =
    Number.isFinite(state.timelineSeconds) && state.timelineSeconds > 0
      ? state.timelineSeconds
      : 0;
  const previousActiveRegionId = activeRegionId;
  if (!activeRegionId && requestedRegionId) {
    activeRegionId = requestedRegionId;
  }
  const extracting =
    activeRegionId !== null && activeRegionId === requestedRegionId;
  const delta =
    Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
  if (extracting) {
    if (prefersReducedMotion) {
      rawProgress =
        1 +
        (rawProgress - 1) *
          Math.exp(
            -BRAIN_EXTRACTION.reducedMotionTransitionRate * delta,
          );
      progress = easeExtractionProgress(rawProgress);
      timelineSeconds += delta;
      if (rawProgress >= 1 - BRAIN_EXTRACTION.settleEpsilon) {
        rawProgress = 1;
        progress = 1;
      }
    } else {
      if (
        state.phase === "retracting" &&
        activeRegionId === previousActiveRegionId
      ) {
        timelineSeconds = openingElapsedForProgress(progress);
      }
      timelineSeconds += delta;
      const opening = extractionOpeningTimeline(timelineSeconds);
      rawProgress = opening.rawProgress;
      progress = opening.easedProgress;
    }
  } else {
    if (state.phase !== "retracting") {
      rawProgress = inverseSmoothstep(progress);
    }
    const retractRate = prefersReducedMotion
      ? BRAIN_EXTRACTION.reducedMotionTransitionRate
      : BRAIN_EXTRACTION.transitionRate;
    rawProgress *= Math.exp(-retractRate * delta);
    progress = easeExtractionProgress(rawProgress);
    timelineSeconds = 0;
    if (rawProgress <= BRAIN_EXTRACTION.settleEpsilon) {
      progress = 0;
      rawProgress = 0;
      activeRegionId = requestedRegionId;
    }
  }
  return {
    activeRegionId,
    progress,
    rawProgress,
    timelineSeconds,
    phase:
      progress === 0
        ? activeRegionId
          ? "extracting"
          : "idle"
        : progress === 1
          ? "settled"
          : extracting
            ? "extracting"
            : "retracting",
  };
}

function subtract(a: Point3Tuple, b: Point3Tuple): Point3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: Point3Tuple, b: Point3Tuple): Point3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scalePoint(value: Point3Tuple, amount: number): Point3Tuple {
  return [value[0] * amount, value[1] * amount, value[2] * amount];
}

function dot(a: Point3Tuple, b: Point3Tuple) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Point3Tuple, b: Point3Tuple): Point3Tuple {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(value: Point3Tuple, fallback: Point3Tuple): Point3Tuple {
  const length = Math.hypot(value[0], value[1], value[2]);
  return Number.isFinite(length) && length > 0.000001
    ? [value[0] / length, value[1] / length, value[2] / length]
    : fallback;
}

function centroid(points: Float32Array | Float64Array): Point3Tuple {
  let x = 0;
  let y = 0;
  let z = 0;
  let count = 0;
  for (let offset = 0; offset + 2 < points.length; offset += 3) {
    const px = points[offset];
    const py = points[offset + 1];
    const pz = points[offset + 2];
    if (![px, py, pz].every(Number.isFinite)) continue;
    x += px;
    y += py;
    z += pz;
    count += 1;
  }
  return count > 0 ? [x / count, y / count, z / count] : [0, 0, 0];
}

function cameraBasis(pose: CameraPose) {
  const forward = normalize(
    subtract(pose.target, pose.position),
    [0, 0, -1],
  );
  const backward = scalePoint(forward, -1);
  const right = normalize(cross([0, 1, 0], backward), [1, 0, 0]);
  const up = normalize(cross(backward, right), [0, 1, 0]);
  return { forward, backward, right, up };
}

function cameraPlaneExtents(
  points: Float32Array | Float64Array,
  origin: Point3Tuple,
  right: Point3Tuple,
  up: Point3Tuple,
) {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let offset = 0; offset + 2 < points.length; offset += 3) {
    const relative: Point3Tuple = [
      points[offset] - origin[0],
      points[offset + 1] - origin[1],
      points[offset + 2] - origin[2],
    ];
    const x = dot(relative, right);
    const y = dot(relative, up);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

export function transformExtractionPoints(
  points: Float32Array | Float64Array,
  center: Point3Tuple,
  worldOffset: Point3Tuple,
  uniformScale: number,
) {
  const transformed = new Float32Array(points.length);
  for (let offset = 0; offset + 2 < points.length; offset += 3) {
    transformed[offset] =
      center[0] +
      (points[offset] - center[0]) * uniformScale +
      worldOffset[0];
    transformed[offset + 1] =
      center[1] +
      (points[offset + 1] - center[1]) * uniformScale +
      worldOffset[1];
    transformed[offset + 2] =
      center[2] +
      (points[offset + 2] - center[2]) * uniformScale +
      worldOffset[2];
  }
  return transformed;
}

export function projectExtractionPoints(
  points: Float32Array | Float64Array,
  pose: CameraPose,
  projection: PerspectiveProjection,
): ProjectedExtractionBounds {
  const { forward, right, up } = cameraBasis(pose);
  const tangent = Math.tan((projection.verticalFovDegrees * Math.PI) / 360);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let offset = 0; offset + 2 < points.length; offset += 3) {
    const relative: Point3Tuple = [
      points[offset] - pose.position[0],
      points[offset + 1] - pose.position[1],
      points[offset + 2] - pose.position[2],
    ];
    const depth = dot(relative, forward);
    if (!Number.isFinite(depth) || depth <= projection.near) {
      return {
        minX: Number.NEGATIVE_INFINITY,
        maxX: Number.POSITIVE_INFINITY,
        minY: Number.NEGATIVE_INFINITY,
        maxY: Number.POSITIVE_INFINITY,
      };
    }
    const x = dot(relative, right) / (depth * tangent * projection.aspect);
    const y = dot(relative, up) / (depth * tangent);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

function unionBounds(
  a: ProjectedExtractionBounds,
  b: ProjectedExtractionBounds,
): ProjectedExtractionBounds {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function translatePose(
  pose: CameraPose,
  translation: Point3Tuple,
): CameraPose {
  return {
    position: add(pose.position, translation),
    target: add(pose.target, translation),
  };
}

function poseAtDistance(
  target: Point3Tuple,
  backward: Point3Tuple,
  distance: number,
): CameraPose {
  return {
    target,
    position: add(target, scalePoint(backward, distance)),
  };
}

export function solveExtractionComposition(
  regionId: RegionId,
  brainPoints: Float32Array | Float64Array,
  targetPoints: Float32Array | Float64Array,
  basePose: CameraPose,
  projection: PerspectiveProjection,
  safeArea?: CameraFocusSafeArea,
  maximumDistance = 10,
): BrainExtractionPlan | null {
  const profile =
    BRAIN_EXTRACTION.profiles[
      regionId as keyof typeof BRAIN_EXTRACTION.profiles
    ];
  if (!profile || brainPoints.length < 3 || targetPoints.length < 3) {
    return null;
  }
  const { forward, backward, right, up } = cameraBasis(basePose);
  const brainCenter = centroid(brainPoints);
  const targetCenter = centroid(targetPoints);
  const brainPlane = cameraPlaneExtents(
    brainPoints,
    brainCenter,
    right,
    up,
  );
  const targetPlane = cameraPlaneExtents(
    targetPoints,
    targetCenter,
    right,
    up,
  );
  const scaledTargetHalfWidth =
    ((targetPlane.maxX - targetPlane.minX) * profile.scale) / 2;
  const brainHalfWidth = (brainPlane.maxX - brainPlane.minX) / 2;
  const tangent = Math.tan((projection.verticalFovDegrees * Math.PI) / 360);
  const safeMaximumDistance =
    Number.isFinite(maximumDistance) && maximumDistance >= 4.5
      ? maximumDistance
      : 10;
  const requestedLeftSafeNdc = safeArea?.leftSafeNdc;
  const requestedRightSafeNdc = safeArea?.rightSafeNdc;
  const safeLeftNdc = Number.isFinite(requestedLeftSafeNdc)
    ? Math.min(
        BRAIN_EXTRACTION.safeNdcX,
        Math.max(
          -BRAIN_EXTRACTION.safeNdcX + 0.05,
          (requestedLeftSafeNdc as number) -
            BRAIN_EXTRACTION.cardLaneSolveGuardNdc,
        ),
      )
    : BRAIN_EXTRACTION.safeNdcX;
  const safeRightNdc = Number.isFinite(requestedRightSafeNdc)
    ? Math.min(
        BRAIN_EXTRACTION.safeNdcX,
        Math.max(
          -safeLeftNdc + 0.05,
          (requestedRightSafeNdc as number) -
            BRAIN_EXTRACTION.cardLaneSolveGuardNdc,
        ),
      )
    : BRAIN_EXTRACTION.safeNdcX;
  const brainHeight = brainPlane.maxY - brainPlane.minY;
  let brainDistance = brainHeight / (1.3 * tangent);
  brainDistance = Math.min(
    safeMaximumDistance,
    Math.max(4.5, brainDistance),
  );
  const targetPhysicalWidth =
    (targetPlane.maxX - targetPlane.minX) * profile.scale;
  const targetDepth =
    targetPhysicalWidth /
    ((profile.targetWidthPixels / 960) * tangent * projection.aspect);
  const gapWorld =
    (BRAIN_EXTRACTION.targetGapPixels / 960) *
    Math.min(brainDistance, targetDepth) *
    tangent *
    projection.aspect;
  const horizontalOffset =
    brainHalfWidth + scaledTargetHalfWidth + gapWorld;
  const depthOffset = targetDepth - brainDistance;
  let worldOffset = add(
    add(
      subtract(brainCenter, targetCenter),
      scalePoint(right, horizontalOffset),
    ),
    add(
      scalePoint(up, profile.verticalOffsetWorld),
      scalePoint(forward, depthOffset),
    ),
  );
  let transformedPoints = transformExtractionPoints(
    targetPoints,
    targetCenter,
    worldOffset,
    profile.scale,
  );
  const finalTargetCenter = add(targetCenter, worldOffset);
  const unionCenterX =
    (brainPlane.minX +
      brainPlane.maxX +
      horizontalOffset * 2) /
    4;
  const lookTarget = add(
    brainCenter,
    add(
      scalePoint(right, unionCenterX),
      scalePoint(up, profile.verticalOffsetWorld * 0.22),
    ),
  );
  let pose = poseAtDistance(lookTarget, backward, brainDistance);
  const solveIterations =
    safeArea?.leftSafeNdc === undefined &&
    safeArea?.rightSafeNdc === undefined
      ? 2
      : 4;
  for (let iteration = 0; iteration < solveIterations; iteration += 1) {
    const brainBounds = projectExtractionPoints(
      brainPoints,
      pose,
      projection,
    );
    const targetBounds = projectExtractionPoints(
      transformedPoints,
      pose,
      projection,
    );
    const gap = targetBounds.minX - brainBounds.maxX;
    const desiredGap = BRAIN_EXTRACTION.targetGapPixels / 960;
    const targetCenterDepth = dot(
      subtract(finalTargetCenter, pose.position),
      forward,
    );
    if (Number.isFinite(gap) && Math.abs(gap - desiredGap) > 0.001) {
      const correction =
        (desiredGap - gap) *
        Math.max(targetCenterDepth, projection.near) *
        tangent *
        projection.aspect;
      worldOffset = add(worldOffset, scalePoint(right, correction));
      transformedPoints = transformExtractionPoints(
        targetPoints,
        targetCenter,
        worldOffset,
        profile.scale,
      );
    }
    const union = unionBounds(
      brainBounds,
      projectExtractionPoints(transformedPoints, pose, projection),
    );
    const centerX = (union.minX + union.maxX) / 2;
    const centerY = (union.minY + union.maxY) / 2;
    const unionWidth = union.maxX - union.minX;
    const horizontalCapacity = safeLeftNdc + safeRightNdc;
    const minimumSceneShift = -safeLeftNdc - union.minX;
    const maximumSceneShift = safeRightNdc - union.maxX;
    const desiredSceneShift =
      unionWidth > horizontalCapacity
        ? (safeRightNdc - safeLeftNdc) / 2 - centerX
        : Math.min(
            maximumSceneShift,
            Math.max(minimumSceneShift, -centerX),
          );
    const centerDepth = Math.max(
      brainDistance,
      dot(subtract(finalTargetCenter, pose.position), forward),
    );
    const translation = add(
      scalePoint(
        right,
        -desiredSceneShift *
          centerDepth *
          tangent *
          projection.aspect,
      ),
      scalePoint(up, centerY * centerDepth * tangent),
    );
    pose = translatePose(pose, translation);
    const centeredUnion = unionBounds(
      projectExtractionPoints(brainPoints, pose, projection),
      projectExtractionPoints(transformedPoints, pose, projection),
    );
    const requiredScale = Math.max(
      (centeredUnion.maxX - centeredUnion.minX) / horizontalCapacity,
      (centeredUnion.maxY - centeredUnion.minY) /
        (BRAIN_EXTRACTION.safeNdcY * 2),
      1,
    );
    if (requiredScale > 1.0001) {
      brainDistance = Math.min(
        safeMaximumDistance,
        brainDistance * requiredScale,
      );
      pose = poseAtDistance(pose.target, backward, brainDistance);
    }
  }
  if (Number.isFinite(requestedLeftSafeNdc)) {
    for (let correction = 0; correction < 6; correction += 1) {
      const brainBounds = projectExtractionPoints(
        brainPoints,
        pose,
        projection,
      );
      const targetBounds = projectExtractionPoints(
        transformedPoints,
        pose,
        projection,
      );
      const leftOverflow =
        -safeLeftNdc - Math.min(brainBounds.minX, targetBounds.minX);
      const rightOverflow =
        Math.max(brainBounds.maxX, targetBounds.maxX) - safeRightNdc;
      if (
        (!Number.isFinite(leftOverflow) &&
          !Number.isFinite(rightOverflow)) ||
        (leftOverflow <= 0.0001 && rightOverflow <= 0.0001)
      ) {
        break;
      }
      const targetDepth = dot(
        subtract(add(targetCenter, worldOffset), pose.position),
        forward,
      );
      const correctionDepth = Math.max(
        brainDistance,
        targetDepth,
        projection.near,
      );
      const correctionNdc =
        rightOverflow > leftOverflow
          ? rightOverflow + 0.0002
          : -(leftOverflow + 0.0002);
      pose = translatePose(
        pose,
        scalePoint(
          right,
          correctionNdc *
            correctionDepth *
            tangent *
            projection.aspect,
        ),
      );
    }
  } else if (Number.isFinite(requestedRightSafeNdc)) {
    for (let correction = 0; correction < 4; correction += 1) {
      const brainBounds = projectExtractionPoints(
        brainPoints,
        pose,
        projection,
      );
      const targetBounds = projectExtractionPoints(
        transformedPoints,
        pose,
        projection,
      );
      const overflow =
        Math.max(brainBounds.maxX, targetBounds.maxX) - safeRightNdc;
      if (!Number.isFinite(overflow) || overflow <= 0.0001) break;
      const targetDepth = dot(
        subtract(add(targetCenter, worldOffset), pose.position),
        forward,
      );
      const correctionDepth = Math.max(
        brainDistance,
        targetDepth,
        projection.near,
      );
      pose = translatePose(
        pose,
        scalePoint(
          right,
          (overflow + 0.0002) *
            correctionDepth *
            tangent *
            projection.aspect,
        ),
      );
    }
  }
  const finalBrainBounds = projectExtractionPoints(
    brainPoints,
    pose,
    projection,
  );
  const finalTargetBounds = projectExtractionPoints(
    transformedPoints,
    pose,
    projection,
  );
  const finalUnionBounds = unionBounds(
    finalBrainBounds,
    finalTargetBounds,
  );
  const finalCentroid = add(targetCenter, worldOffset);
  return {
    regionId,
    scale: profile.scale,
    worldOffset,
    originalCentroid: targetCenter,
    finalCentroid,
    originalBounds: projectExtractionPoints(
      targetPoints,
      basePose,
      projection,
    ),
    finalTargetBounds,
    finalBrainBounds,
    finalUnionBounds,
    screenGapPixels:
      (finalTargetBounds.minX - finalBrainBounds.maxX) * 960,
    brainHeightPixels:
      (finalBrainBounds.maxY - finalBrainBounds.minY) * 540,
    targetWidthPixels:
      (finalTargetBounds.maxX - finalTargetBounds.minX) * 960,
    targetHeightPixels:
      (finalTargetBounds.maxY - finalTargetBounds.minY) * 540,
    pose,
    transformedPoints,
  };
}

export function createMobileOverlayExtractionPlan(
  plan: BrainExtractionPlan,
  brainPoints: Float32Array | Float64Array,
  targetPoints: Float32Array | Float64Array,
  pose: CameraPose,
  projection: PerspectiveProjection,
): BrainExtractionPlan {
  if (brainPoints.length < 3 || targetPoints.length < 3) return plan;
  const { backward, right, up } = cameraBasis(pose);
  const targetCenter = centroid(targetPoints);
  const overlayScale = Math.min(
    plan.scale,
    BRAIN_EXTRACTION.mobileOverlayScale,
  );
  const worldOffset = add(
    scalePoint(
      backward,
      BRAIN_EXTRACTION.mobileOverlayDepthWorld,
    ),
    add(
      scalePoint(
        right,
        BRAIN_EXTRACTION.mobileOverlayLateralWorld,
      ),
      scalePoint(
        up,
        BRAIN_EXTRACTION.mobileOverlayVerticalWorld,
      ),
    ),
  );
  const transformedPoints = transformExtractionPoints(
    targetPoints,
    targetCenter,
    worldOffset,
    overlayScale,
  );
  const finalBrainBounds = projectExtractionPoints(
    brainPoints,
    pose,
    projection,
  );
  const finalTargetBounds = projectExtractionPoints(
    transformedPoints,
    pose,
    projection,
  );
  const finalUnionBounds = unionBounds(
    finalBrainBounds,
    finalTargetBounds,
  );
  return {
    ...plan,
    scale: overlayScale,
    worldOffset,
    originalCentroid: targetCenter,
    finalCentroid: add(targetCenter, worldOffset),
    originalBounds: projectExtractionPoints(
      targetPoints,
      pose,
      projection,
    ),
    finalTargetBounds,
    finalBrainBounds,
    finalUnionBounds,
    screenGapPixels:
      (finalTargetBounds.minX - finalBrainBounds.maxX) * 960,
    brainHeightPixels:
      (finalBrainBounds.maxY - finalBrainBounds.minY) * 540,
    targetWidthPixels:
      (finalTargetBounds.maxX - finalTargetBounds.minX) * 960,
    targetHeightPixels:
      (finalTargetBounds.maxY - finalTargetBounds.minY) * 540,
    pose,
    transformedPoints,
  };
}
