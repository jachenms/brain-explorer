import type { RegionId } from "./brain-regions";

export type Point3Tuple = readonly [number, number, number];
export type PackedFramingPointCloud = {
  points: Float32Array | Float64Array;
  supportPoints?: Float32Array | Float64Array;
  fallbackCorners?: readonly Point3Tuple[];
  center?: Point3Tuple;
};
export type FramingGeometry =
  | readonly Point3Tuple[]
  | PackedFramingPointCloud;

export type CameraPose = {
  position: Point3Tuple;
  target: Point3Tuple;
};

export type BrainSelectionFocusIntent = {
  regionId: RegionId;
  source?: "canvas" | "navigator";
  objectUuid?: string;
  localPoint?: Point3Tuple;
};

export type CameraTransitionPhase =
  | "idle"
  | "focusing"
  | "focused"
  | "returning"
  | "cooldown"
  | "interrupted";

export function getIdleSpecimenTransform(elapsedSeconds: number) {
  const elapsed = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
  return {
    position: [0, Math.sin(elapsed * 0.48) * 0.035, 0] as Point3Tuple,
    rotation: [
      Math.sin(elapsed * 0.27) * 0.006,
      Math.sin(elapsed * 0.22) * 0.01,
      Math.sin(elapsed * 0.31) * 0.018,
    ] as Point3Tuple,
  };
}

export type CameraTransitionState = {
  phase: CameraTransitionPhase;
  activeRegionId: RegionId | null;
  hasRestorePose: boolean;
};

export type CameraTransitionEvent =
  | { type: "selection-change"; regionId: RegionId | null }
  | { type: "user-start" }
  | { type: "settled" }
  | { type: "cooldown-complete" };

export type CameraTransitionArmReason =
  | "selection"
  | "resize"
  | "ui-inset";

export function armCameraTransitionFrameHold(
  _reason: CameraTransitionArmReason,
) {
  void _reason;
  return 0;
}

export function advanceCameraTransitionFrameHold(
  remainingFrames: number,
) {
  return Math.max(0, Math.floor(remainingFrames) - 1);
}

export type PerspectiveProjection = {
  verticalFovDegrees: number;
  aspect: number;
  near: number;
};

export type PerspectiveProjectionSignature = PerspectiveProjection & {
  viewportWidth: number;
  viewportHeight: number;
};

export type ProjectedNdcBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type FrustumSafeFocusSolution = {
  pose: CameraPose;
  projectedBounds: ProjectedNdcBounds;
  selectedProjectedBounds?: ProjectedNdcBounds;
  distanceScale: number;
  targetOffsetScale: number;
  dynamicallyRelaxed: boolean;
  viewDirectionBlend: number;
};

export type FrustumSafeCameraSolution = {
  pose: CameraPose;
  projectedBounds: ProjectedNdcBounds;
  distanceScale: number;
};

export type BottomAnchoredCameraSolution = {
  pose: CameraPose;
  projectedBounds: ProjectedNdcBounds;
  requestedScale: number;
  bottomGapPx: number;
};

export type CameraFocusSafeArea = {
  leftSafeNdc?: number;
  rightSafeNdc?: number;
};

export const CAMERA_UI_SAFE_INSET_GUARD_PX = 1;

export function cameraFocusSafeAreaFromInsets(
  viewportWidth: number,
  reservedLeftPx: number,
  reservedRightPx: number,
): CameraFocusSafeArea {
  const width =
    Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 0;
  const left =
    Number.isFinite(reservedLeftPx) && reservedLeftPx > 0
      ? reservedLeftPx
      : 0;
  const right =
    Number.isFinite(reservedRightPx) && reservedRightPx > 0
      ? reservedRightPx
      : 0;

  if (width === 0) {
    return {};
  }

  return {
    ...(left > 0
      ? {
          leftSafeNdc:
            1 -
            ((left + CAMERA_UI_SAFE_INSET_GUARD_PX) * 2) / width,
        }
      : {}),
    ...(right > 0
      ? {
          rightSafeNdc:
            1 -
            ((right + CAMERA_UI_SAFE_INSET_GUARD_PX) * 2) / width,
        }
      : {}),
  };
}

export type CameraFocusProfile = {
  distanceScale: number;
  extremeDistanceScaleBoost: number;
  horizontalFocusBlend: number;
  verticalFocusBlend: number;
  depthFocusBlend: number;
  safeNdcX: number;
  safeNdcY: number;
  safeNdcTop?: number;
  safeNdcLeft?: number;
  selectedSafeNdcX: number;
  selectedSafeNdcY: number;
  lateralTargetNdc: number;
  viewDirectionBlend: number;
  backsideViewBoost: number;
  maxViewDirectionBlend: number;
  maxViewAngleDegrees: number;
  azimuthBiasDegrees?: number;
  absoluteAzimuthDegrees?: number;
  absoluteElevationDegrees?: number;
  maxElevationChangeDegrees?: number;
  fixedLateralSign?: -1 | 1;
  verticalTargetNdc?: number;
};

export const DEFAULT_CAMERA_POSE: CameraPose = {
  position: [3.35, 1.1, 7.2],
  target: [0, 0.05, 0],
};

export const CINEMATIC_CAMERA = {
  solveDistanceSteps: 40,
  solveOffsetSteps: 40,
  focusDamping: 8.2,
  returnDamping: 6.2,
  reducedMotionDamping: 36,
  distanceDampingMultiplier: 3,
  positionSettleTolerance: 0.008,
  targetSettleTolerance: 0.004,
  restoreCooldownSeconds: 0.8,
  minDistance: 4.5,
  maxDistance: 10,
} as const;

export const FRAMING_PROJECTION_GUARD_NDC = 0.015;
const FRAMING_SOLVE_NDC_EPSILON = 0.0005;

export const CAMERA_FOCUS_PROFILES: Readonly<{
  exterior: CameraFocusProfile;
  temporal: CameraFocusProfile;
  prefrontal: CameraFocusProfile;
  largeExterior: CameraFocusProfile;
  brainStem: CameraFocusProfile;
  internal: CameraFocusProfile;
  hippocampus: CameraFocusProfile;
  amygdala: CameraFocusProfile;
  callosum: CameraFocusProfile;
}> = {
  exterior: {
    distanceScale: 0.83,
    extremeDistanceScaleBoost: 0.07,
    horizontalFocusBlend: 0.7,
    verticalFocusBlend: 0.2,
    depthFocusBlend: 0.08,
    safeNdcX: 0.94,
    safeNdcY: 0.94,
    selectedSafeNdcX: 0.9,
    selectedSafeNdcY: 0.91,
    lateralTargetNdc: 0.22,
    viewDirectionBlend: 0.3,
    backsideViewBoost: 0.34,
    maxViewDirectionBlend: 0.6,
    maxViewAngleDegrees: 72,
  },
  temporal: {
    distanceScale: 0.84,
    extremeDistanceScaleBoost: 0.03,
    horizontalFocusBlend: 0.68,
    verticalFocusBlend: 0.2,
    depthFocusBlend: 0.08,
    safeNdcX: 0.94,
    safeNdcY: 0.94,
    selectedSafeNdcX: 0.9,
    selectedSafeNdcY: 0.91,
    lateralTargetNdc: 0.2,
    viewDirectionBlend: 0,
    backsideViewBoost: 0,
    maxViewDirectionBlend: 0,
    maxViewAngleDegrees: 100,
    absoluteAzimuthDegrees: 82,
    absoluteElevationDegrees: 7,
    maxElevationChangeDegrees: 35,
    fixedLateralSign: 1,
  },
  prefrontal: {
    distanceScale: 0.83,
    extremeDistanceScaleBoost: 0.07,
    horizontalFocusBlend: 0.7,
    verticalFocusBlend: 0.2,
    depthFocusBlend: 0.08,
    safeNdcX: 0.94,
    safeNdcY: 0.94,
    selectedSafeNdcX: 0.9,
    selectedSafeNdcY: 0.91,
    lateralTargetNdc: 0.22,
    viewDirectionBlend: 0.3,
    backsideViewBoost: 0.34,
    maxViewDirectionBlend: 0.6,
    maxViewAngleDegrees: 16,
    azimuthBiasDegrees: -20,
  },
  largeExterior: {
    distanceScale: 0.88,
    extremeDistanceScaleBoost: 0.05,
    horizontalFocusBlend: 0.66,
    verticalFocusBlend: 0.18,
    depthFocusBlend: 0.08,
    safeNdcX: 0.94,
    safeNdcY: 0.94,
    selectedSafeNdcX: 0.92,
    selectedSafeNdcY: 0.91,
    lateralTargetNdc: 0.205,
    viewDirectionBlend: 0.3,
    backsideViewBoost: 0.32,
    maxViewDirectionBlend: 0.6,
    maxViewAngleDegrees: 68,
  },
  brainStem: {
    distanceScale: 0.82,
    extremeDistanceScaleBoost: 0.04,
    horizontalFocusBlend: 0.72,
    verticalFocusBlend: 0.68,
    depthFocusBlend: 0.1,
    safeNdcX: 0.933,
    safeNdcY: 0.881,
    safeNdcTop: 0.881,
    safeNdcLeft: 0.933,
    selectedSafeNdcX: 0.88,
    selectedSafeNdcY: 0.84,
    lateralTargetNdc: 0.16,
    verticalTargetNdc: -0.2,
    viewDirectionBlend: 0,
    backsideViewBoost: 0,
    maxViewDirectionBlend: 0,
    maxViewAngleDegrees: 28,
    absoluteAzimuthDegrees: 10,
    absoluteElevationDegrees: -20,
    maxElevationChangeDegrees: 30,
    fixedLateralSign: 1,
  },
  internal: {
    distanceScale: 0.7,
    extremeDistanceScaleBoost: 0.04,
    horizontalFocusBlend: 0.78,
    verticalFocusBlend: 0.22,
    depthFocusBlend: 0.15,
    safeNdcX: 0.933,
    safeNdcY: 0.881,
    safeNdcTop: 0.881,
    safeNdcLeft: 0.933,
    selectedSafeNdcX: 0.76,
    selectedSafeNdcY: 0.74,
    lateralTargetNdc: 0.16,
    viewDirectionBlend: 0.32,
    backsideViewBoost: 0.18,
    maxViewDirectionBlend: 0.46,
    maxViewAngleDegrees: 35,
    fixedLateralSign: 1,
  },
  hippocampus: {
    distanceScale: 0.7,
    extremeDistanceScaleBoost: 0,
    horizontalFocusBlend: 0.72,
    verticalFocusBlend: 0.2,
    depthFocusBlend: 0.12,
    safeNdcX: 0.93,
    safeNdcY: 0.88,
    safeNdcTop: 0.88,
    safeNdcLeft: 0.93,
    selectedSafeNdcX: 0.8,
    selectedSafeNdcY: 0.78,
    lateralTargetNdc: 0.16,
    verticalTargetNdc: -0.15,
    viewDirectionBlend: 0,
    backsideViewBoost: 0,
    maxViewDirectionBlend: 0,
    maxViewAngleDegrees: 110,
    absoluteAzimuthDegrees: -20,
    absoluteElevationDegrees: 12,
    maxElevationChangeDegrees: 35,
    fixedLateralSign: 1,
  },
  amygdala: {
    distanceScale: 0.74,
    extremeDistanceScaleBoost: 0,
    horizontalFocusBlend: 0.72,
    verticalFocusBlend: 0.28,
    depthFocusBlend: 0.12,
    safeNdcX: 0.93,
    safeNdcY: 0.88,
    safeNdcTop: 0.88,
    safeNdcLeft: 0.93,
    selectedSafeNdcX: 0.8,
    selectedSafeNdcY: 0.78,
    lateralTargetNdc: 0.12,
    verticalTargetNdc: -0.14,
    viewDirectionBlend: 0,
    backsideViewBoost: 0,
    maxViewDirectionBlend: 0,
    maxViewAngleDegrees: 110,
    absoluteAzimuthDegrees: 20,
    absoluteElevationDegrees: 12,
    maxElevationChangeDegrees: 35,
    fixedLateralSign: 1,
  },
  callosum: {
    distanceScale: 0.84,
    extremeDistanceScaleBoost: 0,
    horizontalFocusBlend: 0.78,
    verticalFocusBlend: 0.22,
    depthFocusBlend: 0.15,
    safeNdcX: 1.1,
    safeNdcY: 1.1,
    safeNdcTop: 0.94,
    safeNdcLeft: 0.96,
    selectedSafeNdcX: 0.76,
    selectedSafeNdcY: 0.74,
    lateralTargetNdc: 0.2,
    verticalTargetNdc: -0.1,
    viewDirectionBlend: 0.32,
    backsideViewBoost: 0.18,
    maxViewDirectionBlend: 0.46,
    maxViewAngleDegrees: 100,
    absoluteAzimuthDegrees: -76,
    absoluteElevationDegrees: 10,
    maxElevationChangeDegrees: 35,
    fixedLateralSign: 1,
  },
};

function finitePoint(point: Point3Tuple) {
  return point.every(Number.isFinite);
}

function subtract(a: Point3Tuple, b: Point3Tuple): Point3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: Point3Tuple, b: Point3Tuple): Point3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(point: Point3Tuple, amount: number): Point3Tuple {
  return [point[0] * amount, point[1] * amount, point[2] * amount];
}

function length(point: Point3Tuple) {
  return Math.hypot(point[0], point[1], point[2]);
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

function normalize(
  point: Point3Tuple,
  fallback: Point3Tuple,
): Point3Tuple {
  const magnitude = length(point);
  if (!Number.isFinite(magnitude) || magnitude < 0.000001) {
    return fallback;
  }
  return scale(point, 1 / magnitude);
}

export function cameraPoseDistance(pose: CameraPose) {
  return length(subtract(pose.position, pose.target));
}

export function interpolateUnitDirection(
  from: Point3Tuple,
  to: Point3Tuple,
  progress: number,
): Point3Tuple {
  const start = normalize(from, [0, 0, 1]);
  const end = normalize(to, start);
  const amount = Math.min(1, Math.max(0, progress));
  const cosine = Math.min(1, Math.max(-1, dot(start, end)));
  if (cosine > 0.9995) {
    return normalize(
      add(scale(start, 1 - amount), scale(end, amount)),
      start,
    );
  }
  if (cosine < -0.9995) {
    const absolute = start.map(Math.abs);
    const basis: Point3Tuple =
      absolute[0] <= absolute[1] && absolute[0] <= absolute[2]
        ? [1, 0, 0]
        : absolute[1] <= absolute[2]
          ? [0, 1, 0]
          : [0, 0, 1];
    const axis = normalize(cross(start, basis), [0, 1, 0]);
    const angle = Math.PI * amount;
    return normalize(
      add(
        scale(start, Math.cos(angle)),
        scale(cross(axis, start), Math.sin(angle)),
      ),
      start,
    );
  }
  const angle = Math.acos(cosine);
  const inverseSine = 1 / Math.sin(angle);
  return normalize(
    add(
      scale(start, Math.sin((1 - amount) * angle) * inverseSine),
      scale(end, Math.sin(amount * angle) * inverseSine),
    ),
    start,
  );
}

export function advanceSphericalCameraPose(
  currentPose: CameraPose,
  desiredPose: CameraPose,
  dampingRate: number,
  deltaSeconds: number,
): CameraPose {
  const amount =
    Number.isFinite(dampingRate) &&
    Number.isFinite(deltaSeconds) &&
    dampingRate > 0 &&
    deltaSeconds > 0
      ? 1 - Math.exp(-dampingRate * deltaSeconds)
      : 0;
  const distanceAmount =
    Number.isFinite(dampingRate) &&
    Number.isFinite(deltaSeconds) &&
    dampingRate > 0 &&
    deltaSeconds > 0
      ? 1 -
        Math.exp(
          -dampingRate *
            CINEMATIC_CAMERA.distanceDampingMultiplier *
            deltaSeconds,
        )
      : 0;
  const target = add(
    currentPose.target,
    scale(subtract(desiredPose.target, currentPose.target), amount),
  );
  const currentOffset = subtract(
    currentPose.position,
    currentPose.target,
  );
  const desiredOffset = subtract(
    desiredPose.position,
    desiredPose.target,
  );
  const currentDistance = length(currentOffset);
  const desiredDistance = length(desiredOffset);
  const distance =
    currentDistance +
    (desiredDistance - currentDistance) * distanceAmount;
  const direction = interpolateUnitDirection(
    currentOffset,
    desiredOffset,
    amount,
  );
  return {
    target,
    position: add(target, scale(direction, distance)),
  };
}

function cameraBasis(pose: CameraPose) {
  const backward = normalize(
    subtract(pose.position, pose.target),
    [0, 0, 1],
  );
  let right = normalize(cross([0, 1, 0], backward), [1, 0, 0]);
  if (Math.abs(dot(right, backward)) > 0.001) {
    right = normalize(cross([0, 0, 1], backward), [1, 0, 0]);
  }
  const up = normalize(cross(backward, right), [0, 1, 0]);
  return { backward, right, up };
}

function isPackedFramingPointCloud(
  geometry: FramingGeometry,
): geometry is PackedFramingPointCloud {
  return !Array.isArray(geometry);
}

export function createPackedFramingPointCloud(
  points: Float32Array | Float64Array,
  fallbackCorners?: readonly Point3Tuple[],
): PackedFramingPointCloud {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const corner of fallbackCorners ?? []) {
    if (!finitePoint(corner)) continue;
    minX = Math.min(minX, corner[0]);
    minY = Math.min(minY, corner[1]);
    minZ = Math.min(minZ, corner[2]);
    maxX = Math.max(maxX, corner[0]);
    maxY = Math.max(maxY, corner[1]);
    maxZ = Math.max(maxZ, corner[2]);
  }
  const center = Number.isFinite(minX)
    ? ([
        (minX + maxX) * 0.5,
        (minY + maxY) * 0.5,
        (minZ + maxZ) * 0.5,
      ] as Point3Tuple)
    : undefined;
  return { points, fallbackCorners, center };
}

export function framingGeometryPointCount(geometry: FramingGeometry) {
  if (!isPackedFramingPointCloud(geometry)) return geometry.length;
  const pointCount = Math.floor(geometry.points.length / 3);
  return pointCount > 0
    ? pointCount
    : geometry.fallbackCorners?.length ?? 0;
}

function projectPackedPointsToNdc(
  pose: CameraPose,
  points: Float32Array | Float64Array,
  projection: PerspectiveProjection,
): ProjectedNdcBounds {
  const safePose =
    finitePoint(pose.position) && finitePoint(pose.target)
      ? pose
      : DEFAULT_CAMERA_POSE;
  const { backward, right, up } = cameraBasis(safePose);
  const tanHalfFov = Math.tan(
    (projection.verticalFovDegrees * Math.PI) / 360,
  );
  const aspect =
    Number.isFinite(projection.aspect) && projection.aspect > 0
      ? projection.aspect
      : 16 / 9;
  const near =
    Number.isFinite(projection.near) && projection.near > 0
      ? projection.near
      : 0.1;
  const positionX = safePose.position[0];
  const positionY = safePose.position[1];
  const positionZ = safePose.position[2];
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let offset = 0; offset + 2 < points.length; offset += 3) {
    const x = points[offset] - positionX;
    const y = points[offset + 1] - positionY;
    const z = points[offset + 2] - positionZ;
    const depth = -(x * backward[0] + y * backward[1] + z * backward[2]);
    if (depth <= near || !Number.isFinite(depth)) {
      return {
        minX: Number.NEGATIVE_INFINITY,
        maxX: Number.POSITIVE_INFINITY,
        minY: Number.NEGATIVE_INFINITY,
        maxY: Number.POSITIVE_INFINITY,
      };
    }
    const denominator = depth * tanHalfFov;
    const projectedX =
      (x * right[0] + y * right[1] + z * right[2]) /
      (denominator * aspect);
    const projectedY =
      (x * up[0] + y * up[1] + z * up[2]) / denominator;
    minX = Math.min(minX, projectedX);
    maxX = Math.max(maxX, projectedX);
    minY = Math.min(minY, projectedY);
    maxY = Math.max(maxY, projectedY);
  }
  return { minX, maxX, minY, maxY };
}

export function projectBoundsToNdc(
  pose: CameraPose,
  boundsCorners: readonly Point3Tuple[],
  projection: PerspectiveProjection,
): ProjectedNdcBounds {
  const safePose =
    finitePoint(pose.position) && finitePoint(pose.target)
      ? pose
      : DEFAULT_CAMERA_POSE;
  const { backward, right, up } = cameraBasis(safePose);
  const tanHalfFov = Math.tan(
    (projection.verticalFovDegrees * Math.PI) / 360,
  );
  const aspect =
    Number.isFinite(projection.aspect) && projection.aspect > 0
      ? projection.aspect
      : 16 / 9;
  const near =
    Number.isFinite(projection.near) && projection.near > 0
      ? projection.near
      : 0.1;
  const result: ProjectedNdcBounds = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

  for (const corner of boundsCorners) {
    if (!finitePoint(corner)) continue;
    const relative = subtract(corner, safePose.position);
    const depth = -dot(relative, backward);
    if (depth <= near || !Number.isFinite(depth)) {
      return {
        minX: Number.NEGATIVE_INFINITY,
        maxX: Number.POSITIVE_INFINITY,
        minY: Number.NEGATIVE_INFINITY,
        maxY: Number.POSITIVE_INFINITY,
      };
    }
    const denominator = depth * tanHalfFov;
    const x = dot(relative, right) / (denominator * aspect);
    const y = dot(relative, up) / denominator;
    result.minX = Math.min(result.minX, x);
    result.maxX = Math.max(result.maxX, x);
    result.minY = Math.min(result.minY, y);
    result.maxY = Math.max(result.maxY, y);
  }
  return result;
}

export function projectFramingBoundsToNdc(
  pose: CameraPose,
  geometry: FramingGeometry,
  projection: PerspectiveProjection,
): ProjectedNdcBounds {
  const bounds = isPackedFramingPointCloud(geometry)
    ? geometry.points.length >= 3
      ? projectPackedPointsToNdc(pose, geometry.points, projection)
      : projectBoundsToNdc(
          pose,
          geometry.fallbackCorners ?? [],
          projection,
        )
    : projectBoundsToNdc(pose, geometry, projection);
  return {
    minX: bounds.minX - FRAMING_PROJECTION_GUARD_NDC,
    maxX: bounds.maxX + FRAMING_PROJECTION_GUARD_NDC,
    minY: bounds.minY - FRAMING_PROJECTION_GUARD_NDC,
    maxY: bounds.maxY + FRAMING_PROJECTION_GUARD_NDC,
  };
}

export function solveBottomAnchoredCameraPose(
  basePose: CameraPose,
  framingGeometry: FramingGeometry,
  projection: PerspectiveProjection,
  viewportHeightPx: number,
  requestedScale = 1.1,
  bottomGapPx = 28,
): BottomAnchoredCameraSolution {
  const safeHeight = Math.max(1, viewportHeightPx);
  const safeScale = Math.min(
    1.2,
    Math.max(1, Number.isFinite(requestedScale) ? requestedScale : 1),
  );
  const safeGap = Math.min(
    safeHeight * 0.25,
    Math.max(0, Number.isFinite(bottomGapPx) ? bottomGapPx : 0),
  );
  const { backward, right, up } = cameraBasis(basePose);
  const baseDistance = Math.max(0.001, cameraPoseDistance(basePose));
  const distance = baseDistance / safeScale;
  let pose: CameraPose = {
    target: basePose.target,
    position: add(basePose.target, scale(backward, distance)),
  };
  const desiredBottomNdc = -1 + (safeGap / safeHeight) * 2;
  const tangent = Math.tan(
    ((projection.verticalFovDegrees * Math.PI) / 180) * 0.5,
  );
  let projectedBounds = projectFramingBoundsToNdc(
    pose,
    framingGeometry,
    projection,
  );

  for (let step = 0; step < 2; step += 1) {
    const ndcCorrection = desiredBottomNdc - projectedBounds.minY;
    const horizontalCenterNdc =
      (projectedBounds.minX + projectedBounds.maxX) * 0.5;
    const translation = add(
      scale(
        right,
        horizontalCenterNdc *
          distance *
          tangent *
          projection.aspect,
      ),
      scale(up, -ndcCorrection * distance * tangent),
    );
    pose = {
      position: add(pose.position, translation),
      target: add(pose.target, translation),
    };
    projectedBounds = projectFramingBoundsToNdc(
      pose,
      framingGeometry,
      projection,
    );
  }

  return {
    pose,
    projectedBounds,
    requestedScale: safeScale,
    bottomGapPx: safeGap,
  };
}

export function refreshPointerAfterCameraSettle(
  updatePointerEvents: (() => void) | undefined,
  clearHover: () => void,
) {
  if (updatePointerEvents) {
    updatePointerEvents();
  } else {
    clearHover();
  }
}

export function hasPerspectiveProjectionChanged(
  previous: PerspectiveProjectionSignature,
  next: PerspectiveProjectionSignature,
) {
  return (
    previous.viewportWidth !== next.viewportWidth ||
    previous.viewportHeight !== next.viewportHeight ||
    previous.aspect !== next.aspect ||
    previous.verticalFovDegrees !== next.verticalFovDegrees ||
    previous.near !== next.near
  );
}

export function projectedBoundsFitSafeEnvelope(
  bounds: ProjectedNdcBounds,
  safeNdcX = CAMERA_FOCUS_PROFILES.exterior.safeNdcX,
  safeNdcY = CAMERA_FOCUS_PROFILES.exterior.safeNdcY,
) {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxY) &&
    bounds.minX >= -safeNdcX - FRAMING_SOLVE_NDC_EPSILON &&
    bounds.maxX <= safeNdcX + FRAMING_SOLVE_NDC_EPSILON &&
    bounds.minY >= -safeNdcY - FRAMING_SOLVE_NDC_EPSILON &&
    bounds.maxY <= safeNdcY + FRAMING_SOLVE_NDC_EPSILON
  );
}

function boundsCenter(
  geometry: FramingGeometry,
): Point3Tuple {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  if (isPackedFramingPointCloud(geometry) && geometry.points.length >= 3) {
    if (geometry.center) return geometry.center;
    for (let offset = 0; offset + 2 < geometry.points.length; offset += 3) {
      const x = geometry.points[offset];
      const y = geometry.points[offset + 1];
      const z = geometry.points[offset + 2];
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(z)
      ) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  } else {
    const corners = isPackedFramingPointCloud(geometry)
      ? geometry.fallbackCorners ?? []
      : geometry;
    for (const corner of corners) {
      if (!finitePoint(corner)) continue;
      minX = Math.min(minX, corner[0]);
      minY = Math.min(minY, corner[1]);
      minZ = Math.min(minZ, corner[2]);
      maxX = Math.max(maxX, corner[0]);
      maxY = Math.max(maxY, corner[1]);
      maxZ = Math.max(maxZ, corner[2]);
    }
  }
  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) {
    return [0, 0, 0];
  }
  return [
    (minX + maxX) * 0.5,
    (minY + maxY) * 0.5,
    (minZ + maxZ) * 0.5,
  ];
}

function proposalGeometry(geometry: FramingGeometry): FramingGeometry {
  if (
    isPackedFramingPointCloud(geometry) &&
    geometry.supportPoints &&
    geometry.supportPoints.length >= 3
  ) {
    return {
      points: geometry.supportPoints,
      fallbackCorners: geometry.fallbackCorners,
    };
  }
  return geometry;
}

function perspectiveSupportGeometry(
  geometry: FramingGeometry,
  referencePose: CameraPose,
  projection: PerspectiveProjection,
): FramingGeometry {
  if (
    !isPackedFramingPointCloud(geometry) ||
    geometry.points.length < 3
  ) {
    return proposalGeometry(geometry);
  }
  const { backward, right, up } = cameraBasis(referencePose);
  const tanHalfFov = Math.tan(
    (projection.verticalFovDegrees * Math.PI) / 360,
  );
  const aspect =
    Number.isFinite(projection.aspect) && projection.aspect > 0
      ? projection.aspect
      : 16 / 9;
  const near =
    Number.isFinite(projection.near) && projection.near > 0
      ? projection.near
      : 0.1;
  const extrema = [-1, -1, -1, -1, -1];
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minimumDepth = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset + 2 < geometry.points.length; offset += 3) {
    const x = geometry.points[offset] - referencePose.position[0];
    const y = geometry.points[offset + 1] - referencePose.position[1];
    const z = geometry.points[offset + 2] - referencePose.position[2];
    const depth = -(x * backward[0] + y * backward[1] + z * backward[2]);
    if (depth <= near || !Number.isFinite(depth)) return geometry;
    const denominator = depth * tanHalfFov;
    const projectedX =
      (x * right[0] + y * right[1] + z * right[2]) /
      (denominator * aspect);
    const projectedY =
      (x * up[0] + y * up[1] + z * up[2]) / denominator;
    if (projectedX < minX) {
      minX = projectedX;
      extrema[0] = offset;
    }
    if (projectedX > maxX) {
      maxX = projectedX;
      extrema[1] = offset;
    }
    if (projectedY < minY) {
      minY = projectedY;
      extrema[2] = offset;
    }
    if (projectedY > maxY) {
      maxY = projectedY;
      extrema[3] = offset;
    }
    if (depth < minimumDepth) {
      minimumDepth = depth;
      extrema[4] = offset;
    }
  }
  const uniqueOffsets = [...new Set(extrema.filter((offset) => offset >= 0))];
  const staticSupportLength = geometry.supportPoints?.length ?? 0;
  const supportPoints = new Float64Array(
    uniqueOffsets.length * 3 + staticSupportLength,
  );
  let outputOffset = 0;
  for (const offset of uniqueOffsets) {
    supportPoints[outputOffset] = geometry.points[offset];
    supportPoints[outputOffset + 1] = geometry.points[offset + 1];
    supportPoints[outputOffset + 2] = geometry.points[offset + 2];
    outputOffset += 3;
  }
  if (geometry.supportPoints) {
    supportPoints.set(geometry.supportPoints, outputOffset);
  }
  return {
    points: supportPoints,
    fallbackCorners: geometry.fallbackCorners,
  };
}

function projectedBoundsAreFinite(bounds: ProjectedNdcBounds) {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxY)
  );
}

function requiredDistanceRatio(
  bounds: ProjectedNdcBounds,
  safeLeft: number,
  safeRight: number,
  safeBottom: number,
  safeTop: number,
) {
  if (!projectedBoundsAreFinite(bounds)) return Number.POSITIVE_INFINITY;
  return Math.max(
    1,
    (bounds.maxX - bounds.minX) / (safeLeft + safeRight),
    (bounds.maxY - bounds.minY) / (safeBottom + safeTop),
  );
}

function resolveRightSafeNdc(
  configuredRight: number,
  safeLeft: number,
  safeArea?: CameraFocusSafeArea,
) {
  const requested = safeArea?.rightSafeNdc;
  if (!Number.isFinite(requested)) return configuredRight;
  return Math.min(
    configuredRight,
    Math.max(-safeLeft + 0.05, requested as number),
  );
}

function resolveLeftSafeNdc(
  configuredLeft: number,
  safeRight: number,
  safeArea?: CameraFocusSafeArea,
) {
  const requested = safeArea?.leftSafeNdc;
  if (!Number.isFinite(requested)) return configuredLeft;
  return Math.min(
    configuredLeft,
    Math.max(-safeRight + 0.05, requested as number),
  );
}

function projectedBoundsFitEnvelope(
  bounds: ProjectedNdcBounds,
  safeLeft: number,
  safeRight: number,
  safeBottom: number,
  safeTop: number,
) {
  return (
    projectedBoundsAreFinite(bounds) &&
    bounds.minX >= -safeLeft - FRAMING_SOLVE_NDC_EPSILON &&
    bounds.maxX <= safeRight + FRAMING_SOLVE_NDC_EPSILON &&
    bounds.minY >= -safeBottom - FRAMING_SOLVE_NDC_EPSILON &&
    bounds.maxY <= safeTop + FRAMING_SOLVE_NDC_EPSILON
  );
}

function projectedBoundsFitFocusEnvelope(
  bounds: ProjectedNdcBounds,
  profile: CameraFocusProfile,
  safeArea?: CameraFocusSafeArea,
) {
  const safeLeft = resolveLeftSafeNdc(
    profile.safeNdcLeft ?? profile.safeNdcX,
    profile.safeNdcX,
    safeArea,
  );
  return projectedBoundsFitEnvelope(
    bounds,
    safeLeft,
    resolveRightSafeNdc(profile.safeNdcX, safeLeft, safeArea),
    profile.safeNdcY,
    profile.safeNdcTop ?? profile.safeNdcY,
  );
}

function projectedBoundsFitSelectedEnvelope(
  bounds: ProjectedNdcBounds,
  profile: CameraFocusProfile,
  safeArea?: CameraFocusSafeArea,
) {
  const safeLeft = resolveLeftSafeNdc(
    profile.selectedSafeNdcX,
    profile.selectedSafeNdcX,
    safeArea,
  );
  return projectedBoundsFitEnvelope(
    bounds,
    safeLeft,
    resolveRightSafeNdc(
      profile.selectedSafeNdcX,
      safeLeft,
      safeArea,
    ),
    profile.selectedSafeNdcY,
    profile.selectedSafeNdcY,
  );
}

function calculateFramingCorrection(
  projectedBounds: ProjectedNdcBounds,
  selectedProjectedBounds: ProjectedNdcBounds | undefined,
  profile: CameraFocusProfile,
  desiredSelectedNdcX: number,
  safeArea?: CameraFocusSafeArea,
): readonly [number, number] {
  if (
    !projectedBoundsAreFinite(projectedBounds) ||
    (selectedProjectedBounds &&
      !projectedBoundsAreFinite(selectedProjectedBounds))
  ) {
    return [0, 0];
  }
  const horizontalMin = selectedProjectedBounds
    ? Math.min(projectedBounds.minX, selectedProjectedBounds.minX)
    : projectedBounds.minX;
  const horizontalMax = selectedProjectedBounds
    ? Math.max(projectedBounds.maxX, selectedProjectedBounds.maxX)
    : projectedBounds.maxX;
  const width = horizontalMax - horizontalMin;
  const height = projectedBounds.maxY - projectedBounds.minY;
  const safeLeft = resolveLeftSafeNdc(
    profile.safeNdcLeft ?? profile.safeNdcX,
    profile.safeNdcX,
    safeArea,
  );
  const safeRight = resolveRightSafeNdc(
    profile.safeNdcX,
    safeLeft,
    safeArea,
  );
  const safeTop = profile.safeNdcTop ?? profile.safeNdcY;
  let correctionX = 0;
  let correctionY = 0;
  if (width > safeLeft + safeRight) {
    correctionX = (horizontalMin + horizontalMax) * 0.5;
  } else {
    const minimumSceneShift = -safeLeft - horizontalMin;
    const maximumSceneShift = safeRight - horizontalMax;
    const selectedCenterX = selectedProjectedBounds
      ? (selectedProjectedBounds.minX + selectedProjectedBounds.maxX) * 0.5
      : 0;
    const desiredSceneShift = selectedProjectedBounds
      ? desiredSelectedNdcX - selectedCenterX
      : 0;
    correctionX = -Math.min(
      maximumSceneShift,
      Math.max(minimumSceneShift, desiredSceneShift),
    );
  }
  if (height > profile.safeNdcY + safeTop) {
    correctionY = (projectedBounds.minY + projectedBounds.maxY) * 0.5;
  } else {
    const minimumSceneShift = -profile.safeNdcY - projectedBounds.minY;
    const maximumSceneShift = safeTop - projectedBounds.maxY;
    const selectedCenterY = selectedProjectedBounds
      ? (selectedProjectedBounds.minY + selectedProjectedBounds.maxY) * 0.5
      : 0;
    const desiredSceneShift = selectedProjectedBounds
      ? profile.verticalTargetNdc === undefined
        ? -selectedCenterY * 0.35
        : profile.verticalTargetNdc - selectedCenterY
      : 0;
    correctionY = -Math.min(
      maximumSceneShift,
      Math.max(minimumSceneShift, desiredSceneShift),
    );
  }
  return [correctionX, correctionY];
}

export function solveFrustumSafeCameraPose(
  basePose: CameraPose,
  framingGeometry: FramingGeometry,
  projection: PerspectiveProjection,
  safeArea?: CameraFocusSafeArea,
  safeNdcX = CAMERA_FOCUS_PROFILES.exterior.safeNdcX,
  safeNdcY = CAMERA_FOCUS_PROFILES.exterior.safeNdcY,
  maximumDistance: number = CINEMATIC_CAMERA.maxDistance,
): FrustumSafeCameraSolution {
  const safePose =
    finitePoint(basePose.position) && finitePoint(basePose.target)
      ? basePose
      : DEFAULT_CAMERA_POSE;
  const profile: CameraFocusProfile = {
    distanceScale: 1,
    extremeDistanceScaleBoost: 0,
    horizontalFocusBlend: 0,
    verticalFocusBlend: 0,
    depthFocusBlend: 0,
    safeNdcX,
    safeNdcY,
    safeNdcTop: safeNdcY,
    safeNdcLeft: safeNdcX,
    selectedSafeNdcX: safeNdcX,
    selectedSafeNdcY: safeNdcY,
    lateralTargetNdc: 0,
    viewDirectionBlend: 0,
    backsideViewBoost: 0,
    maxViewDirectionBlend: 0,
    maxViewAngleDegrees: 0,
  };
  const { backward, right, up } = cameraBasis(safePose);
  const initialDistance = cameraPoseDistance(safePose);
  const solveMaximumDistance =
    Number.isFinite(maximumDistance) && maximumDistance > 0
      ? Math.max(initialDistance, maximumDistance)
      : Math.max(initialDistance, CINEMATIC_CAMERA.maxDistance);
  const projectionAspect =
    Number.isFinite(projection.aspect) && projection.aspect > 0
      ? projection.aspect
      : 16 / 9;
  const projectionTanHalfFov = Math.tan(
    (projection.verticalFovDegrees * Math.PI) / 360,
  );
  const safeLeft = resolveLeftSafeNdc(safeNdcX, safeNdcX, safeArea);
  const safeRight = resolveRightSafeNdc(
    safeNdcX,
    safeLeft,
    safeArea,
  );
  let pose = safePose;
  let distance = initialDistance;
  let projectedBounds = projectFramingBoundsToNdc(
    pose,
    framingGeometry,
    projection,
  );

  for (let iteration = 0; iteration < 12; iteration += 1) {
    const distanceRatio = Math.max(
      requiredDistanceRatio(
        projectedBounds,
        safeLeft,
        safeRight,
        safeNdcY,
        safeNdcY,
      ),
      safeLeft > 0
        ? Math.max(1, -projectedBounds.minX / safeLeft)
        : 1,
      safeRight > 0
        ? Math.max(1, projectedBounds.maxX / safeRight)
        : 1,
      safeNdcY > 0
        ? Math.max(
            1,
            -projectedBounds.minY / safeNdcY,
            projectedBounds.maxY / safeNdcY,
          )
        : 1,
    );
    if (distanceRatio > 1.000001 && distance < solveMaximumDistance) {
      distance = Math.min(
        solveMaximumDistance,
        distance * distanceRatio * 1.002,
      );
      pose = {
        target: pose.target,
        position: add(
          pose.target,
          scale(backward, distance),
        ),
      };
      projectedBounds = projectFramingBoundsToNdc(
        pose,
        framingGeometry,
        projection,
      );
      continue;
    }

    const [correctionX, correctionY] = calculateFramingCorrection(
      projectedBounds,
      undefined,
      profile,
      0,
      safeArea,
    );
    if (
      Math.abs(correctionX) < 0.000001 &&
      Math.abs(correctionY) < 0.000001
    ) {
      break;
    }
    const translation = add(
      scale(
        right,
        correctionX *
          distance *
          projectionTanHalfFov *
          projectionAspect,
      ),
      scale(up, correctionY * distance * projectionTanHalfFov),
    );
    pose = {
      target: add(pose.target, translation),
      position: add(pose.position, translation),
    };
    projectedBounds = projectFramingBoundsToNdc(
      pose,
      framingGeometry,
      projection,
    );
  }

  return {
    pose,
    projectedBounds,
    distanceScale:
      initialDistance > 0 ? distance / initialDistance : 1,
  };
}

export function solveFrustumSafeFocusPose(
  restorePose: CameraPose,
  currentPose: CameraPose,
  focusPoint: Point3Tuple,
  profile: CameraFocusProfile,
  framingGeometry: FramingGeometry,
  projection: PerspectiveProjection,
  minDistance: number = CINEMATIC_CAMERA.minDistance,
  maxDistance: number = CINEMATIC_CAMERA.maxDistance,
  selectedFramingGeometry: FramingGeometry = [],
  safeArea?: CameraFocusSafeArea,
): FrustumSafeFocusSolution {
  const safeRestore =
    finitePoint(restorePose.position) && finitePoint(restorePose.target)
      ? restorePose
      : DEFAULT_CAMERA_POSE;
  const safeCurrent =
    finitePoint(currentPose.position) && finitePoint(currentPose.target)
      ? currentPose
      : safeRestore;
  const center = boundsCenter(framingGeometry);
  const hasSelectedGeometry =
    framingGeometryPointCount(selectedFramingGeometry) > 0;
  const safeFocus = finitePoint(focusPoint) ? focusPoint : center;
  const currentBasis = cameraBasis(safeCurrent);
  const focusDelta = subtract(safeFocus, center);
  const currentHorizontal = normalize(
    [currentBasis.backward[0], 0, currentBasis.backward[2]],
    [0, 0, 1],
  );
  const radialHorizontal = normalize(
    [focusDelta[0], 0, focusDelta[2]],
    currentHorizontal,
  );
  const horizontalMagnitude = Math.sqrt(
    Math.max(0, 1 - currentBasis.backward[1] ** 2),
  );
  const radialDirection = normalize(
    [
      radialHorizontal[0] * horizontalMagnitude,
      currentBasis.backward[1],
      radialHorizontal[2] * horizontalMagnitude,
    ],
    currentBasis.backward,
  );
  const backsideAmount = Math.max(
    0,
    -dot(currentBasis.backward, radialDirection),
  );
  const viewDirectionBlend = Math.min(
    profile.maxViewDirectionBlend,
    profile.viewDirectionBlend +
      backsideAmount * profile.backsideViewBoost,
  );
  const currentAzimuth = Math.atan2(
    currentHorizontal[0],
    currentHorizontal[2],
  );
  const radialAzimuth = Math.atan2(
    radialHorizontal[0],
    radialHorizontal[2],
  );
  const rawAzimuthDelta =
    ((radialAzimuth - currentAzimuth + Math.PI * 3) %
      (Math.PI * 2)) -
    Math.PI;
  const maxAzimuthDelta =
    (profile.maxViewAngleDegrees * Math.PI) / 180;
  const azimuthDelta = Math.min(
    maxAzimuthDelta,
    Math.max(
      -maxAzimuthDelta,
      rawAzimuthDelta * viewDirectionBlend,
    ),
  );
  const absoluteAzimuth =
    profile.absoluteAzimuthDegrees === undefined
      ? undefined
      : (profile.absoluteAzimuthDegrees * Math.PI) / 180;
  const absoluteAzimuthDelta =
    absoluteAzimuth === undefined
      ? undefined
      : ((absoluteAzimuth - currentAzimuth + Math.PI * 3) %
          (Math.PI * 2)) -
        Math.PI;
  const authoredAzimuthDelta =
    absoluteAzimuthDelta ??
    azimuthDelta +
      ((profile.azimuthBiasDegrees ?? 0) * Math.PI) / 180;
  const focusedAzimuth =
    currentAzimuth +
    Math.min(
      maxAzimuthDelta,
      Math.max(-maxAzimuthDelta, authoredAzimuthDelta),
    );
  const currentElevation = Math.asin(
    Math.min(1, Math.max(-1, currentBasis.backward[1])),
  );
  const absoluteElevation =
    profile.absoluteElevationDegrees === undefined
      ? undefined
      : (profile.absoluteElevationDegrees * Math.PI) / 180;
  const maxElevationChange =
    ((profile.maxElevationChangeDegrees ?? 0) * Math.PI) / 180;
  const focusedElevation =
    absoluteElevation === undefined
      ? currentElevation
      : currentElevation +
        Math.min(
          maxElevationChange,
          Math.max(
            -maxElevationChange,
            absoluteElevation - currentElevation,
          ),
        );
  const focusedVertical =
    absoluteElevation === undefined
      ? currentBasis.backward[1]
      : Math.sin(focusedElevation);
  const focusedHorizontalMagnitude =
    absoluteElevation === undefined
      ? horizontalMagnitude
      : Math.cos(focusedElevation);
  const backward = normalize(
    [
      Math.sin(focusedAzimuth) * focusedHorizontalMagnitude,
      focusedVertical,
      Math.cos(focusedAzimuth) * focusedHorizontalMagnitude,
    ],
    currentBasis.backward,
  );
  const right = normalize(cross([0, 1, 0], backward), currentBasis.right);
  const up = normalize(cross(backward, right), currentBasis.up);
  const lateralSign =
    profile.fixedLateralSign ?? (dot(focusDelta, right) >= 0 ? 1 : -1);
  const desiredSelectedNdcX = lateralSign * profile.lateralTargetNdc;
  const compositionOffset = add(
    add(
      scale(
        right,
        dot(focusDelta, right) * profile.horizontalFocusBlend,
      ),
      scale(
        up,
        dot(focusDelta, up) * profile.verticalFocusBlend,
      ),
    ),
    scale(
      backward,
      dot(focusDelta, backward) *
        profile.depthFocusBlend,
    ),
  );
  const restoreDistance = cameraPoseDistance(safeRestore);
  const effectiveDistanceScale = Math.min(
    CINEMATIC_CAMERA.maxDistance / restoreDistance,
    profile.distanceScale +
      backsideAmount * profile.extremeDistanceScaleBoost,
  );
  const preferredDistance = Math.min(
    Math.max(
      restoreDistance * effectiveDistanceScale,
      minDistance,
    ),
    maxDistance,
  );
  const proposalReferenceTarget = add(center, compositionOffset);
  const proposalReferencePose: CameraPose = {
    target: proposalReferenceTarget,
    position: add(
      proposalReferenceTarget,
      scale(backward, preferredDistance),
    ),
  };
  const proposalFramingGeometry = perspectiveSupportGeometry(
    framingGeometry,
    proposalReferencePose,
    projection,
  );
  const proposalSelectedGeometry = perspectiveSupportGeometry(
    selectedFramingGeometry,
    proposalReferencePose,
    projection,
  );
  const solveMaximumDistance = Math.max(preferredDistance, maxDistance);
  let lastPose: CameraPose = {
    target: center,
    position: add(center, scale(backward, solveMaximumDistance)),
  };
  let lastBounds: ProjectedNdcBounds = {
    minX: Number.NaN,
    maxX: Number.NaN,
    minY: Number.NaN,
    maxY: Number.NaN,
  };
  let lastSelectedBounds: ProjectedNdcBounds | undefined;
  const projectionAspect =
    Number.isFinite(projection.aspect) && projection.aspect > 0
      ? projection.aspect
      : 16 / 9;
  const projectionTanHalfFov = Math.tan(
    (projection.verticalFovDegrees * Math.PI) / 360,
  );

  let requiredMinimumDistance = preferredDistance;
  for (
    let distanceStep = 0;
    distanceStep <= CINEMATIC_CAMERA.solveDistanceSteps;
    distanceStep += 1
  ) {
    const distanceProgress =
      distanceStep / CINEMATIC_CAMERA.solveDistanceSteps;
    const distance =
      preferredDistance +
      (solveMaximumDistance - preferredDistance) * distanceProgress;
    if (distance + 0.000001 < requiredMinimumDistance) continue;

    for (
      let offsetStep = 0;
      offsetStep <= CINEMATIC_CAMERA.solveOffsetSteps;
      offsetStep += 1
    ) {
      const targetOffsetScale =
        1 - offsetStep / CINEMATIC_CAMERA.solveOffsetSteps;
      let target = add(
        center,
        scale(compositionOffset, targetOffsetScale),
      );
      let pose: CameraPose = {
        target,
        position: add(target, scale(backward, distance)),
      };
      let projectedBounds = projectFramingBoundsToNdc(
        pose,
        proposalFramingGeometry,
        projection,
      );
      let selectedProjectedBounds = hasSelectedGeometry
        ? projectFramingBoundsToNdc(
            pose,
            proposalSelectedGeometry,
            projection,
          )
        : undefined;

      // The compact directional support set proposes composition cheaply.
      for (let correctionStep = 0; correctionStep < 4; correctionStep += 1) {
        const [correctionX, correctionY] = calculateFramingCorrection(
          projectedBounds,
          selectedProjectedBounds,
          profile,
          desiredSelectedNdcX,
          safeArea,
        );
        if (
          Math.abs(correctionX) < 0.000001 &&
          Math.abs(correctionY) < 0.000001
        ) {
          break;
        }
        target = add(
          target,
          add(
            scale(
              right,
              correctionX *
                distance *
                projectionTanHalfFov *
                projectionAspect,
            ),
            scale(
              up,
              correctionY * distance * projectionTanHalfFov,
            ),
          ),
        );
        pose = {
          target,
          position: add(target, scale(backward, distance)),
        };
        projectedBounds = projectFramingBoundsToNdc(
          pose,
          proposalFramingGeometry,
          projection,
        );
        selectedProjectedBounds = hasSelectedGeometry
          ? projectFramingBoundsToNdc(
              pose,
              proposalSelectedGeometry,
              projection,
            )
          : undefined;
      }

      if (
        !projectedBoundsFitFocusEnvelope(
          projectedBounds,
          profile,
          safeArea,
        ) ||
        (selectedProjectedBounds &&
          !projectedBoundsFitSelectedEnvelope(
            selectedProjectedBounds,
            profile,
            safeArea,
          ))
      ) {
        continue;
      }

      // Final acceptance always uses every actual vertex (or every fallback
      // AABB corner). Exact scans may translate the proposal but can never be
      // replaced by support-only acceptance.
      projectedBounds = projectFramingBoundsToNdc(
        pose,
        framingGeometry,
        projection,
      );
      selectedProjectedBounds = hasSelectedGeometry
        ? projectFramingBoundsToNdc(
            pose,
            selectedFramingGeometry,
            projection,
          )
        : undefined;
      for (let correctionStep = 0; correctionStep < 4; correctionStep += 1) {
        const [correctionX, correctionY] = calculateFramingCorrection(
          projectedBounds,
          selectedProjectedBounds,
          profile,
          desiredSelectedNdcX,
          safeArea,
        );
        if (
          Math.abs(correctionX) < 0.000001 &&
          Math.abs(correctionY) < 0.000001
        ) {
          break;
        }
        target = add(
          target,
          add(
            scale(
              right,
              correctionX *
                distance *
                projectionTanHalfFov *
                projectionAspect,
            ),
            scale(
              up,
              correctionY * distance * projectionTanHalfFov,
            ),
          ),
        );
        pose = {
          target,
          position: add(target, scale(backward, distance)),
        };
        projectedBounds = projectFramingBoundsToNdc(
          pose,
          framingGeometry,
          projection,
        );
        selectedProjectedBounds = hasSelectedGeometry
          ? projectFramingBoundsToNdc(
              pose,
              selectedFramingGeometry,
              projection,
            )
          : undefined;
      }

      lastPose = pose;
      lastBounds = projectedBounds;
      lastSelectedBounds = selectedProjectedBounds;
      const fullSafeLeft = resolveLeftSafeNdc(
        profile.safeNdcLeft ?? profile.safeNdcX,
        profile.safeNdcX,
        safeArea,
      );
      const selectedSafeLeft = resolveLeftSafeNdc(
        profile.selectedSafeNdcX,
        profile.selectedSafeNdcX,
        safeArea,
      );
      const fullDistanceRatio = requiredDistanceRatio(
        projectedBounds,
        fullSafeLeft,
        resolveRightSafeNdc(
          profile.safeNdcX,
          fullSafeLeft,
          safeArea,
        ),
        profile.safeNdcY,
        profile.safeNdcTop ?? profile.safeNdcY,
      );
      const selectedDistanceRatio = selectedProjectedBounds
        ? requiredDistanceRatio(
            selectedProjectedBounds,
            selectedSafeLeft,
            resolveRightSafeNdc(
              profile.selectedSafeNdcX,
              selectedSafeLeft,
              safeArea,
            ),
            profile.selectedSafeNdcY,
            profile.selectedSafeNdcY,
          )
        : 1;
      if (fullDistanceRatio > 1.000001 || selectedDistanceRatio > 1.000001) {
        requiredMinimumDistance = Math.min(
          solveMaximumDistance,
          Math.max(
            requiredMinimumDistance,
            distance *
              Math.max(fullDistanceRatio, selectedDistanceRatio) *
              1.002,
          ),
        );
        break;
      }

      const targetCloserThanIdle =
        length(focusDelta) < 0.000001 ||
        length(subtract(target, safeFocus)) <
          length(subtract(center, safeFocus));
      if (
        projectedBoundsFitFocusEnvelope(
          projectedBounds,
          profile,
          safeArea,
        ) &&
        (!selectedProjectedBounds ||
          projectedBoundsFitSelectedEnvelope(
            selectedProjectedBounds,
            profile,
            safeArea,
          )) &&
        (targetCloserThanIdle || hasSelectedGeometry)
      ) {
        const compositionMagnitudeSquared = dot(
          compositionOffset,
          compositionOffset,
        );
        const retainedOffset =
          compositionMagnitudeSquared > 0.000001
            ? Math.min(
                1,
                Math.max(
                  0,
                  dot(
                    subtract(target, center),
                    compositionOffset,
                  ) / compositionMagnitudeSquared,
                ),
              )
            : 0;
        return {
          pose,
          projectedBounds,
          selectedProjectedBounds,
          distanceScale: distance / restoreDistance,
          targetOffsetScale: retainedOffset,
          dynamicallyRelaxed:
            distance > restoreDistance * effectiveDistanceScale + 0.000001,
          viewDirectionBlend,
        };
      }
    }
  }

  if (!Number.isFinite(lastBounds.minX)) {
    lastBounds = projectFramingBoundsToNdc(
      lastPose,
      framingGeometry,
      projection,
    );
    lastSelectedBounds = hasSelectedGeometry
      ? projectFramingBoundsToNdc(
          lastPose,
          selectedFramingGeometry,
          projection,
        )
      : undefined;
  }
  return {
    pose: lastPose,
    projectedBounds: lastBounds,
    selectedProjectedBounds: lastSelectedBounds,
    distanceScale: solveMaximumDistance / restoreDistance,
    targetOffsetScale: 0,
    dynamicallyRelaxed: true,
    viewDirectionBlend,
  };
}

export function resolveRestorePose(savedPose: CameraPose | null) {
  return savedPose ?? DEFAULT_CAMERA_POSE;
}

export function cameraDampingRate(
  prefersReducedMotion: boolean,
  phase: CameraTransitionPhase = "focusing",
) {
  if (prefersReducedMotion) return CINEMATIC_CAMERA.reducedMotionDamping;
  return phase === "returning"
    ? CINEMATIC_CAMERA.returnDamping
    : CINEMATIC_CAMERA.focusDamping;
}

export function cameraMaximumDistanceForAspect(
  aspect: number,
  reservesRightLane = false,
  reservedLeftRatio = 0,
) {
  const safeAspect =
    Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  const aspectScale = 16 / 9 / safeAspect;
  const laneBoost =
    reservesRightLane && safeAspect < 1.5 ? 1.08 : 1;
  const safeReservedLeftRatio =
    Number.isFinite(reservedLeftRatio) && reservedLeftRatio > 0
      ? Math.min(0.4, reservedLeftRatio)
      : 0;
  const leftLaneBoost =
    safeReservedLeftRatio > 0
      ? 1 / Math.max(0.42, 1 - safeReservedLeftRatio * 2)
      : 1;
  return (
    CINEMATIC_CAMERA.maxDistance *
    Math.min(
      3.2,
      Math.max(1, aspectScale * laneBoost * leftLaneBoost),
    )
  );
}

export function advanceRestoreCooldown(
  remainingSeconds: number,
  deltaSeconds: number,
) {
  if (!Number.isFinite(remainingSeconds)) return 0;
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    return Math.max(0, remainingSeconds);
  }
  return Math.max(0, remainingSeconds - deltaSeconds);
}

export function isCameraPoseSettled(
  currentPose: CameraPose,
  desiredPose: CameraPose,
) {
  return (
    length(subtract(currentPose.position, desiredPose.position)) <=
      CINEMATIC_CAMERA.positionSettleTolerance &&
    length(subtract(currentPose.target, desiredPose.target)) <=
      CINEMATIC_CAMERA.targetSettleTolerance
  );
}

export function reduceCameraTransition(
  state: CameraTransitionState,
  event: CameraTransitionEvent,
): CameraTransitionState {
  if (event.type === "selection-change") {
    if (event.regionId) {
      return {
        phase: "focusing",
        activeRegionId: event.regionId,
        hasRestorePose: true,
      };
    }
    return state.hasRestorePose
      ? {
          phase: "returning",
          activeRegionId: null,
          hasRestorePose: true,
        }
      : {
          phase: "idle",
          activeRegionId: null,
          hasRestorePose: false,
        };
  }

  if (event.type === "user-start") {
    return state.activeRegionId
      ? { ...state, phase: "interrupted" }
      : {
          phase: "idle",
          activeRegionId: null,
          hasRestorePose: false,
        };
  }

  if (event.type === "cooldown-complete") {
    return state.phase === "cooldown"
      ? {
          phase: "idle",
          activeRegionId: null,
          hasRestorePose: false,
        }
      : state;
  }

  if (state.phase === "focusing") {
    return { ...state, phase: "focused" };
  }
  if (state.phase === "returning") {
    return {
      phase: "cooldown",
      activeRegionId: null,
      hasRestorePose: false,
    };
  }
  return state;
}

export function shouldAutoRotateCamera(
  prefersReducedMotion: boolean,
  hoveredRegionId: RegionId | null,
  selectedRegionId: RegionId | null,
  phase: CameraTransitionPhase,
  userInteracting: boolean,
) {
  return (
    !prefersReducedMotion &&
    hoveredRegionId === null &&
    selectedRegionId === null &&
    phase === "idle" &&
    !userInteracting
  );
}
