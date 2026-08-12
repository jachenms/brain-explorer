import type { CameraTransitionPhase } from "./brain-camera";
import type { RegionId } from "./brain-regions";
import { getRegionInfoCardLayout } from "./region-info-card-layout";
import { getRegionNavigatorLayout } from "./region-navigator-layout";

export const REGION_INFO_LEADER = {
  screenSafeInsetPx: 14,
  minimumTargetMovementPx: 0.5,
  markerExternalRadiusPx: 5,
  markerInternalRadiusPx: 2.5,
  preferredMarkerClearancePx: 12,
  maximumSupportSamplesPerRegion: 64,
  visibilityResolveIntervalMs: 1000 / 15,
  candidateHysteresisRatio: 1.12,
  connectorDesktopMaximumPx: 420,
  connectorTabletMaximumPx: 280,
  connectorInternalMaximumPx: 112,
  connectorMinimumViewportWidthPx: 768,
  connectorExternalSilhouetteGapPx: 8,
  connectorInternalSilhouetteGapPx: 6,
  connectorCardGapPx: 6,
  connectorCardCornerInsetPx: 28,
  connectorMaximumDeviationPx: 14,
  connectorStrokeWidthPx: 2,
  connectorOpacity: 0.9,
  stemOpacity: 0.86,
  stemLengthPx: 15,
  maskExpansionPx: 2.5,
  selectedContourInsetPx: 3,
  selectedContourMaximumInsetPx: 6,
  selectedContourMaximumExitPx: 18,
  selectedSupportMaximumExitPx: 32,
  continuityTickMaximumPx: 4,
  pairForkMaximumLengthPx: 64,
  pairForkSurfaceGapPx: 5,
  pairForkOpacity: 0.28,
  extractionOriginRadiusPx: 4,
  extractionInnerOriginRadiusPx: 3,
  extractionTraceTissueGapPx: 9,
  extractionTraceMinimumLengthPx: 28,
  extractionTraceMaximumBendPx: 10,
  externalDesiredSpecimenGapPx: 64,
  internalDesiredSpecimenGapPx: 40,
  minimumSpecimenGapPx: 40,
  maximumSpecimenGapPx: 88,
  maximumCardShiftXPx: 320,
  maximumCardShiftYPx: 96,
  maximumInternalCardShiftYPx: 160,
  internalCardTopGapPx: 40,
  transitionMilliseconds: 220,
  reducedMotionTransitionMilliseconds: 120,
} as const;

export const REGION_LEADER_PROBE_QUEUE_NAMES = [
  "click",
  "support",
  "directional",
  "interior",
  "fallback",
] as const;

export type RegionLeaderProbeQueueName =
  (typeof REGION_LEADER_PROBE_QUEUE_NAMES)[number];

export const REGION_LEADER_PROBE_RESERVATIONS = {
  click: 1,
  support: 16,
  directional: 14,
  interior: 10,
  fallback: 8,
} as const satisfies Record<RegionLeaderProbeQueueName, number>;

export type RegionLeaderProbeQueueCounts = {
  offered: number;
  deduped: number;
  attempted: number;
  hit: number;
  accepted: number;
  reserved: number;
  borrowed: number;
};

export type RegionLeaderProbeScheduleDiagnostics = {
  queues: Record<RegionLeaderProbeQueueName, RegionLeaderProbeQueueCounts>;
  budgetStopReason: "budget-exhausted" | "queues-exhausted";
  everyAvailableReservedQueueRan: boolean;
};

export function createEmptyRegionLeaderProbeQueueCounts() {
  return Object.fromEntries(
    REGION_LEADER_PROBE_QUEUE_NAMES.map((queue) => [
      queue,
      {
        offered: 0,
        deduped: 0,
        attempted: 0,
        hit: 0,
        accepted: 0,
        reserved: 0,
        borrowed: 0,
      },
    ]),
  ) as Record<RegionLeaderProbeQueueName, RegionLeaderProbeQueueCounts>;
}

export function shouldRetryRegionLeaderSupportRegistration({
  registeredRegionCount,
  selectedMeshUuidCount,
  resolvedMeshCount,
  supportSampleCount,
}: {
  registeredRegionCount: number;
  selectedMeshUuidCount: number;
  resolvedMeshCount: number;
  supportSampleCount: number;
}) {
  return (
    registeredRegionCount >= 10 &&
    (selectedMeshUuidCount === 0 ||
      resolvedMeshCount === 0 ||
      supportSampleCount === 0)
  );
}

export function scheduleRegionLeaderProbeBudget<
  Candidate extends { screen: { x: number; y: number } },
>(
  queues: Record<RegionLeaderProbeQueueName, readonly Candidate[]>,
  maximumRays = 49,
) {
  const diagnostics = createEmptyRegionLeaderProbeQueueCounts();
  for (const queue of REGION_LEADER_PROBE_QUEUE_NAMES) {
    diagnostics[queue].offered = queues[queue].length;
  }
  const deduped: Record<RegionLeaderProbeQueueName, Candidate[]> = {
    click: [],
    support: [],
    directional: [],
    interior: [],
    fallback: [],
  };
  const claimedPoints: { x: number; y: number }[] = [];
  for (const queue of REGION_LEADER_PROBE_QUEUE_NAMES) {
    for (const candidate of queues[queue]) {
      if (
        claimedPoints.some(
          (point) =>
            Math.hypot(
              point.x - candidate.screen.x,
              point.y - candidate.screen.y,
            ) < 0.5,
        )
      ) {
        continue;
      }
      claimedPoints.push(candidate.screen);
      deduped[queue].push(candidate);
    }
    diagnostics[queue].deduped = deduped[queue].length;
  }

  const scheduled: {
    queue: RegionLeaderProbeQueueName;
    candidate: Candidate;
    reserved: boolean;
  }[] = [];
  const cursor = Object.fromEntries(
    REGION_LEADER_PROBE_QUEUE_NAMES.map((queue) => [queue, 0]),
  ) as Record<RegionLeaderProbeQueueName, number>;
  const scheduleOne = (
    queue: RegionLeaderProbeQueueName,
    reserved: boolean,
  ) => {
    if (
      scheduled.length >= maximumRays ||
      cursor[queue] >= deduped[queue].length
    ) {
      return false;
    }
    scheduled.push({
      queue,
      candidate: deduped[queue][cursor[queue]],
      reserved,
    });
    cursor[queue] += 1;
    if (reserved) diagnostics[queue].reserved += 1;
    else diagnostics[queue].borrowed += 1;
    return true;
  };

  scheduleOne("click", true);
  for (let index = 0; index < 4; index += 1) {
    scheduleOne("support", true);
  }
  let reservationProgress = true;
  while (
    reservationProgress &&
    scheduled.length < maximumRays
  ) {
    reservationProgress = false;
    for (const queue of [
      "support",
      "directional",
      "interior",
      "fallback",
    ] as const) {
      if (
        diagnostics[queue].reserved <
          REGION_LEADER_PROBE_RESERVATIONS[queue] &&
        scheduleOne(queue, true)
      ) {
        reservationProgress = true;
      }
    }
  }

  let borrowingProgress = true;
  while (borrowingProgress && scheduled.length < maximumRays) {
    borrowingProgress = false;
    for (const queue of REGION_LEADER_PROBE_QUEUE_NAMES) {
      if (scheduleOne(queue, false)) borrowingProgress = true;
      if (scheduled.length >= maximumRays) break;
    }
  }
  const candidatesRemain = REGION_LEADER_PROBE_QUEUE_NAMES.some(
    (queue) => cursor[queue] < deduped[queue].length,
  );
  const everyAvailableReservedQueueRan =
    REGION_LEADER_PROBE_QUEUE_NAMES.every(
      (queue) =>
        diagnostics[queue].deduped === 0 ||
        diagnostics[queue].reserved > 0,
    );
  return {
    scheduled,
    diagnostics: {
      queues: diagnostics,
      budgetStopReason: candidatesRemain
        ? ("budget-exhausted" as const)
        : ("queues-exhausted" as const),
      everyAvailableReservedQueueRan,
    },
  };
}

export type RegionLeaderPoint = { x: number; y: number };

export type RegionLeaderScreenRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type RegionLeaderSilhouette = {
  bounds: RegionLeaderScreenRect;
  hull: RegionLeaderPoint[];
  source: "overall-visible-specimen" | "detached-selected-cluster";
  baseFingerprint?: string;
  contributors?: RegionLeaderSilhouetteContributor[];
};

export type RegionLeaderSilhouetteContributor = {
  stableId: string;
  meshUuid: string;
  semanticName: string;
  regionId: RegionId;
  role: RegionLeaderSilhouetteRole;
  sourceKind: "atlas-source";
  hull: RegionLeaderPoint[];
  cardFacingWorldPoint: [number, number, number];
  cardFacingScreenX: number;
  visible: boolean;
  frustumValid: boolean;
  materialOpacity: number;
  materialTransparent: boolean;
  materialDepthWrite: boolean;
  portal: boolean;
  proxy: boolean;
  extraction: boolean;
  helper: boolean;
};

export type RegionLeaderMarker = {
  x: number;
  y: number;
  componentId: string;
  meshUuid: string;
  localPoint: readonly number[];
  worldPoint: readonly number[];
  clearancePx: number;
  radiusPx: number;
  anchorSource: "selected-contour" | "selected-support";
  selectedRegion: RegionId;
  hullEdgeRegion: RegionId | null;
  markerToFinalExitPx: number;
  residualOccludedGapPx: number;
  resolver: "frontmost-visible-selected";
  groupPoint?: RegionLeaderPoint;
};

export type RegionLeaderTargetUpdate = {
  regionId: RegionId;
  viewportWidth: number;
  viewportHeight: number;
  cameraPhase: CameraTransitionPhase;
  convergenceToken: string;
  baseLeftInsetPx: number;
  appliedLeftInsetPx: number;
  baseRightInsetPx: number;
  appliedRightInsetPx: number;
  cameraFingerprint: string;
  markers: RegionLeaderMarker[];
  silhouette: RegionLeaderSilhouette;
  specimenSilhouette: RegionLeaderSilhouette;
  detachedInternal: boolean;
  extractionOrigin: {
    point: RegionLeaderPoint;
    worldPoint: readonly number[];
    progress: number;
    reliable: boolean;
  } | null;
  supportSampleCount: number;
  verifiedCandidateCount: number;
  rawMarkerToSilhouetteDistancePx: number;
};

export type RegionLeaderSupportSample = {
  meshUuid: string;
  componentId: string;
  localPoint: [number, number, number];
};

export const REGION_LEADER_SILHOUETTE_ROLES = {
  external: "external-opaque-surface",
  detached: "selected-detached-cluster",
  excluded: "excluded",
} as const;

export type RegionLeaderSilhouetteRole =
  (typeof REGION_LEADER_SILHOUETTE_ROLES)[keyof typeof REGION_LEADER_SILHOUETTE_ROLES];

export type RegionLeaderSilhouetteMember = {
  stableId: string;
  meshUuid: string;
  regionId: RegionId;
  role: RegionLeaderSilhouetteRole;
  sourceKind: "atlas-source";
};

export type RegionLeaderRenderMembershipState = {
  role: RegionLeaderSilhouetteRole;
  visible: boolean;
  frustumValid: boolean;
  materialOpacity: number;
  materialDepthWrite: boolean;
  portal: boolean;
  proxy: boolean;
  extraction: boolean;
  helper: boolean;
  diagnostic: boolean;
};

export function isRegionLeaderExternalSilhouetteMember(
  state: RegionLeaderRenderMembershipState,
) {
  return (
    state.role === REGION_LEADER_SILHOUETTE_ROLES.external &&
    state.visible &&
    state.frustumValid &&
    state.materialOpacity > 0.01 &&
    state.materialDepthWrite &&
    !state.portal &&
    !state.proxy &&
    !state.extraction &&
    !state.helper &&
    !state.diagnostic
  );
}

export type RegionLeaderSupportRegistry = {
  samplesByRegion: Map<RegionId, RegionLeaderSupportSample[]>;
  meshUuidsByRegion: Map<RegionId, string[]>;
  foregroundMeshUuids: string[];
  externalSilhouetteMembers: RegionLeaderSilhouetteMember[];
  registeredRegionCount: number;
};

export type RegionLeaderWorldAnchor = {
  regionId: RegionId | null;
  point: [number, number, number];
  originPoint: [number, number, number];
  progress: number;
  reliable: boolean;
};

export type RegionLeaderProbeDiagnostics = {
  regionId: RegionId;
  dirtyTrigger: string;
  registeredRegionCount: number;
  registeredMeshCount: number;
  supportSampleCount: number;
  directionalProbeCount: number;
  directionalHitCount: number;
  supportGridCount: number;
  probeQueues: Record<
    RegionLeaderProbeQueueName,
    RegionLeaderProbeQueueCounts
  >;
  budgetStopReason: "budget-exhausted" | "queues-exhausted" | "support-pending";
  everyAvailableReservedQueueRan: boolean;
  supportRegistrationPending: boolean;
  raysTested: number;
  visibleHitCount: number;
  rejectedResolutionCount: number;
  rejectedProxyCount: number;
  rejectedInvisibleCount: number;
  scanMilliseconds: number;
  markerComponents: readonly string[];
  markerMeshUuids: readonly string[];
  markerLocalPoints: readonly (readonly number[])[];
  markerWorldPoints: readonly (readonly number[])[];
  markerScreenPoints: readonly RegionLeaderPoint[];
  markerClearancesPx: readonly number[];
  rawMarkerToSilhouetteDistancePx: number | null;
};

export type RegionInfoLeaderHandle = {
  updateTarget: (update: RegionLeaderTargetUpdate) => void;
  hide: (reason?: string) => void;
  invalidateLayout: (reason: string) => void;
  getLayoutRevision: () => number;
  reportDiagnostics: (diagnostics: RegionLeaderProbeDiagnostics) => void;
};

export type RegionCardCameraInsetRequest = {
  convergenceToken: string;
  requestedLeftInsetPx: number;
  requestedRightInsetPx: number;
  iteration: number;
  status: RegionCardCameraConvergenceStatus;
  forceRefit: boolean;
  requestFingerprint: string;
};

export type RegionMarkerCandidateScore = {
  id: string;
  interiorClearancePx: number;
  continuityDistance: number;
  clicked: boolean;
  previous: boolean;
};

export function chooseRegionMarkerCandidate<
  Candidate extends RegionMarkerCandidateScore,
>(candidates: readonly Candidate[]) {
  if (!candidates.length) {
    return {
      candidate: null,
      reason: "no-marker-candidates" as const,
      counts: { evaluated: 0, valid: 0 },
    };
  }
  const ordered = [...candidates].sort((first, second) => {
    const clearanceDelta =
      second.interiorClearancePx - first.interiorClearancePx;
    if (Math.abs(clearanceDelta) > 0.5) return clearanceDelta;
    const firstStability =
      first.continuityDistance - (first.clicked ? 1 : 0);
    const secondStability =
      second.continuityDistance - (second.clicked ? 1 : 0);
    return firstStability - secondStability;
  });
  const best = ordered[0];
  const previous = ordered.find((candidate) => candidate.previous);
  const selected =
    previous &&
    previous.interiorClearancePx >=
      best.interiorClearancePx /
        REGION_INFO_LEADER.candidateHysteresisRatio
      ? previous
      : best;
  return {
    candidate: selected,
    reason: "selected" as const,
    counts: {
      evaluated: candidates.length,
      valid: candidates.length,
    },
  };
}

export function createRegionLeaderWorldAnchor(): RegionLeaderWorldAnchor {
  return {
    regionId: null,
    point: [0, 0, 0],
    originPoint: [0, 0, 0],
    progress: 0,
    reliable: false,
  };
}

export function projectLeaderNdcToScreen(
  ndc: { x: number; y: number; z: number },
  viewDepth: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  if (
    ![ndc.x, ndc.y, ndc.z, viewDepth, viewportWidth, viewportHeight].every(
      Number.isFinite,
    ) ||
    viewDepth <= 0 ||
    ndc.z < -1 ||
    ndc.z > 1 ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return null;
  }
  const x = ((ndc.x + 1) * viewportWidth) / 2;
  const y = ((1 - ndc.y) * viewportHeight) / 2;
  const inset = REGION_INFO_LEADER.screenSafeInsetPx;
  if (
    x < inset ||
    x > viewportWidth - inset ||
    y < inset ||
    y > viewportHeight - inset
  ) {
    return null;
  }
  return { x, y };
}

function cross(
  origin: RegionLeaderPoint,
  first: RegionLeaderPoint,
  second: RegionLeaderPoint,
) {
  return (
    (first.x - origin.x) * (second.y - origin.y) -
    (first.y - origin.y) * (second.x - origin.x)
  );
}

export function createRegionScreenHull(
  points: readonly RegionLeaderPoint[],
) {
  const unique = [
    ...new Map(
      points
        .filter((point) => [point.x, point.y].every(Number.isFinite))
        .map((point) => [
          `${point.x.toFixed(3)}:${point.y.toFixed(3)}`,
          { x: point.x, y: point.y },
        ]),
    ).values(),
  ].sort((first, second) => first.x - second.x || first.y - second.y);
  if (unique.length <= 2) return unique;
  const lower: RegionLeaderPoint[] = [];
  for (const point of unique) {
    while (
      lower.length >= 2 &&
      cross(lower.at(-2)!, lower.at(-1)!, point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: RegionLeaderPoint[] = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index];
    while (
      upper.length >= 2 &&
      cross(upper.at(-2)!, upper.at(-1)!, point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function pointToSegmentDistance(
  point: RegionLeaderPoint,
  first: RegionLeaderPoint,
  second: RegionLeaderPoint,
) {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const lengthSquared = dx * dx + dy * dy;
  const progress =
    lengthSquared > 0
      ? Math.max(
          0,
          Math.min(
            1,
            ((point.x - first.x) * dx + (point.y - first.y) * dy) /
              lengthSquared,
          ),
        )
      : 0;
  return Math.hypot(
    point.x - (first.x + dx * progress),
    point.y - (first.y + dy * progress),
  );
}

export function getRegionMarkerInteriorClearance(
  point: RegionLeaderPoint,
  hull: readonly RegionLeaderPoint[],
) {
  if (hull.length < 3) return 0;
  let inside = false;
  for (let index = 0, previous = hull.length - 1; index < hull.length; previous = index++) {
    const first = hull[index];
    const second = hull[previous];
    if (
      first.y > point.y !== second.y > point.y &&
      point.x <
        ((second.x - first.x) * (point.y - first.y)) /
          (second.y - first.y) +
          first.x
    ) {
      inside = !inside;
    }
  }
  if (!inside) return 0;
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < hull.length; index += 1) {
    minimum = Math.min(
      minimum,
      pointToSegmentDistance(
        point,
        hull[index],
        hull[(index + 1) % hull.length],
      ),
    );
  }
  return Number.isFinite(minimum) ? minimum : 0;
}

function clamp(minimum: number, value: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export type RegionSplitCalloutLayout = {
  baseCardRect: RegionLeaderScreenRect;
  finalCardRect: RegionLeaderScreenRect;
  cardShiftX: number;
  cardShiftY: number;
  cardJunctionPoint: RegionLeaderPoint;
  hullClosestPoint: RegionLeaderPoint;
  outwardNormal: RegionLeaderPoint;
  hullClosestContributor: {
    stableId: string;
    regionId: RegionId;
    role: RegionLeaderSilhouetteRole;
  } | null;
  targetGapPx: number;
  fullGapPx: number;
  distanceToHullPx: number;
  cardHullClearancePx: number;
  requiredCardHullClearancePx: number;
  cardHullOverlap: boolean;
  cardCornerInside: boolean;
  cardHullVertexInside: boolean;
  cardEdgeIntersection: boolean;
  requiresPeripheralCardClearance: boolean;
  solverStatus: "target" | "gap-bound-clamped" | "infeasible";
  solutionHash: string;
  silhouetteHull: RegionLeaderPoint[];
};

export type RegionLeaderSettlementState = {
  fingerprint: string | null;
  solutionHash: string | null;
  hullClosestPoint: RegionLeaderPoint | null;
  samples: number;
  frozen: boolean;
};

export const REGION_CARD_CAMERA_CONVERGENCE = {
  insetHysteresisPx: 0.5,
  fingerprintQuantumPx: 0.5,
  neutralBorderPx: 1,
  maximumIterations: 3,
  requiredSettlementSamples: 2,
  requiredNavigatorGapPx: 27,
  minimumCardHullClearancePx: 24,
  connectorSearchStepPx: 2,
  connectorMaximumCardAdjustmentPx: 96,
  connectorVerticalSearchPx: 6,
  uiExclusionGapPx: 14,
  minimumTopBottomMarginPx: 24,
  navigatorApproachStartWidthPx: 960,
  navigatorApproachRate: 1 / 3,
  navigatorMaximumApproachPx: 320,
} as const;

export type RegionCardCameraConvergenceStatus =
  | "base"
  | "refit-requested"
  | "waiting-camera"
  | "settling"
  | "converged"
  | "overlap-invalidated"
  | "iteration-cap";

export type RegionCardCameraConvergenceState = {
  token: string;
  baseLeftInsetPx: number;
  requestedLeftInsetPx: number;
  appliedLeftInsetPx: number;
  dynamicLeftInsetPx: number;
  baseRightInsetPx: number;
  requestedRightInsetPx: number;
  appliedRightInsetPx: number;
  dynamicRightInsetPx: number;
  iteration: number;
  status: RegionCardCameraConvergenceStatus;
  reason: string;
};

export function createRegionCardCameraFingerprint(
  values: readonly number[],
  quantumPx = REGION_CARD_CAMERA_CONVERGENCE.fingerprintQuantumPx,
) {
  const quantum =
    Number.isFinite(quantumPx) && quantumPx > 0 ? quantumPx : 0.5;
  return values
    .map((value) =>
      Number.isFinite(value) ? Math.round(value / quantum) : "invalid",
    )
    .join(",");
}

export function getRequiredRegionCardCameraInset({
  viewportWidth,
  cardLeft,
  cardHullGapPx,
}: {
  viewportWidth: number;
  cardLeft: number;
  cardHullGapPx: number;
}) {
  if (
    !Number.isFinite(viewportWidth) ||
    viewportWidth <= 0 ||
    !Number.isFinite(cardLeft)
  ) {
    return 0;
  }
  const gap = Number.isFinite(cardHullGapPx)
    ? Math.max(0, cardHullGapPx)
    : 0;
  return Math.ceil(
    Math.max(
      0,
      viewportWidth -
        cardLeft +
        gap +
        REGION_CARD_CAMERA_CONVERGENCE.neutralBorderPx,
    ),
  );
}

export function advanceRegionCardCameraConvergence(
  previous: RegionCardCameraConvergenceState | null,
  sample: {
    token: string;
    baseLeftInsetPx: number;
    appliedLeftInsetPx: number;
    requiredLeftInsetPx: number;
    baseRightInsetPx: number;
    appliedRightInsetPx: number;
    requiredRightInsetPx: number;
    cameraPhase: CameraTransitionPhase;
    geometrySafe: boolean;
  },
): RegionCardCameraConvergenceState {
  const baseLeftInsetPx = Math.max(0, sample.baseLeftInsetPx);
  const appliedLeftInsetPx = Math.max(0, sample.appliedLeftInsetPx);
  const baseRightInsetPx = Math.max(0, sample.baseRightInsetPx);
  const appliedRightInsetPx = Math.max(0, sample.appliedRightInsetPx);
  const seed =
    previous?.token === sample.token
      ? previous
      : {
          token: sample.token,
          baseLeftInsetPx,
          requestedLeftInsetPx: baseLeftInsetPx,
          appliedLeftInsetPx,
          dynamicLeftInsetPx: 0,
          baseRightInsetPx,
          requestedRightInsetPx: baseRightInsetPx,
          appliedRightInsetPx,
          dynamicRightInsetPx: 0,
          iteration: 0,
          status: "base" as const,
          reason: "base-card-lane",
        };
  const requiredLeftInsetPx = Math.max(
    baseLeftInsetPx,
    sample.requiredLeftInsetPx,
  );
  const requestedLeftInsetPx = Math.max(
    seed.requestedLeftInsetPx,
    requiredLeftInsetPx,
  );
  const requiredRightInsetPx = Math.max(
    baseRightInsetPx,
    sample.requiredRightInsetPx,
  );
  const requestedRightInsetPx = Math.max(
    seed.requestedRightInsetPx,
    requiredRightInsetPx,
  );
  const requestIncreased =
    requestedLeftInsetPx >
      seed.requestedLeftInsetPx +
        REGION_CARD_CAMERA_CONVERGENCE.insetHysteresisPx ||
    requestedRightInsetPx >
      seed.requestedRightInsetPx +
        REGION_CARD_CAMERA_CONVERGENCE.insetHysteresisPx;
  const firstUnsafeSample =
    !sample.geometrySafe &&
    sample.cameraPhase !== "focusing" &&
    seed.status !== "overlap-invalidated" &&
    seed.status !== "iteration-cap";
  const iteration = requestIncreased || firstUnsafeSample
    ? Math.min(
        REGION_CARD_CAMERA_CONVERGENCE.maximumIterations,
        seed.iteration + 1,
      )
    : seed.iteration;
  const insetAligned =
    Math.abs(requestedLeftInsetPx - appliedLeftInsetPx) <=
      REGION_CARD_CAMERA_CONVERGENCE.insetHysteresisPx &&
    Math.abs(requestedRightInsetPx - appliedRightInsetPx) <=
      REGION_CARD_CAMERA_CONVERGENCE.insetHysteresisPx;
  const exhausted =
    seed.iteration >=
      REGION_CARD_CAMERA_CONVERGENCE.maximumIterations &&
    insetAligned &&
    sample.cameraPhase !== "focusing" &&
    !sample.geometrySafe;
  const status: RegionCardCameraConvergenceStatus = exhausted
    ? "iteration-cap"
    : !insetAligned
      ? "refit-requested"
      : sample.cameraPhase === "focusing"
        ? "waiting-camera"
        : !sample.geometrySafe
          ? "overlap-invalidated"
          : sample.cameraPhase !== "focused"
            ? "waiting-camera"
          : "settling";
  return {
    token: sample.token,
    baseLeftInsetPx,
    requestedLeftInsetPx,
    appliedLeftInsetPx,
    dynamicLeftInsetPx: Math.max(
      0,
      requestedLeftInsetPx - baseLeftInsetPx,
    ),
    baseRightInsetPx,
    requestedRightInsetPx,
    appliedRightInsetPx,
    dynamicRightInsetPx: Math.max(
      0,
      requestedRightInsetPx - baseRightInsetPx,
    ),
    iteration,
    status,
    reason:
      status === "iteration-cap"
        ? "bounded-conservative-inset"
        : status === "refit-requested"
          ? "actual-card-rect-expanded-lane"
          : status === "waiting-camera"
            ? `camera-${sample.cameraPhase}`
            : status === "overlap-invalidated"
              ? "dom-card-hull-clearance"
              : "matching-coupled-solution",
  };
}

export function advanceRegionLeaderSettlement(
  previous: RegionLeaderSettlementState,
  sample: {
    fingerprint: string;
    solutionHash: string;
    hullClosestPoint: RegionLeaderPoint;
    domWithinHalfPixel: boolean;
    domHullClearanceValid: boolean;
    cameraSettled?: boolean;
    insetAligned?: boolean;
    geometryIntersectionFree?: boolean;
  },
): RegionLeaderSettlementState {
  const coherent =
    previous.fingerprint === sample.fingerprint &&
    previous.solutionHash === sample.solutionHash &&
    previous.hullClosestPoint !== null &&
    Math.hypot(
      previous.hullClosestPoint.x - sample.hullClosestPoint.x,
      previous.hullClosestPoint.y - sample.hullClosestPoint.y,
    ) <= 0.5;
  const samples =
    sample.domWithinHalfPixel &&
    sample.domHullClearanceValid &&
    sample.cameraSettled !== false &&
    sample.insetAligned !== false &&
    sample.geometryIntersectionFree !== false
    ? coherent
      ? Math.min(2, previous.samples + 1)
      : 1
    : 0;
  return {
    fingerprint: sample.fingerprint,
    solutionHash: sample.solutionHash,
    hullClosestPoint: sample.hullClosestPoint,
    samples,
    frozen: samples >= 2,
  };
}

function closestPointOnSegment(
  point: RegionLeaderPoint,
  first: RegionLeaderPoint,
  second: RegionLeaderPoint,
) {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const lengthSquared = dx * dx + dy * dy;
  const progress =
    lengthSquared > Number.EPSILON
      ? clamp(
          0,
          ((point.x - first.x) * dx +
            (point.y - first.y) * dy) /
            lengthSquared,
          1,
        )
      : 0;
  return {
    point: {
      x: first.x + dx * progress,
      y: first.y + dy * progress,
    },
    progress,
  };
}

function pointInsideRegionHull(
  point: RegionLeaderPoint,
  hull: readonly RegionLeaderPoint[],
) {
  if (hull.length < 3) return false;
  let inside = false;
  for (
    let index = 0, previous = hull.length - 1;
    index < hull.length;
    previous = index++
  ) {
    const first = hull[index];
    const second = hull[previous];
    if (
      first.y > point.y !== second.y > point.y &&
      point.x <
        ((second.x - first.x) * (point.y - first.y)) /
          (second.y - first.y) +
          first.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function closestPointOnRegionHull(
  point: RegionLeaderPoint,
  hull: readonly RegionLeaderPoint[],
) {
  let result = {
    point: hull[0] ?? { x: 0, y: 0 },
    normal: { x: 1, y: 0 },
    distance: Number.POSITIVE_INFINITY,
    edgeIndex: 0,
  };
  for (let index = 0; index < hull.length; index += 1) {
    const first = hull[index];
    const second = hull[(index + 1) % hull.length];
    const closest = closestPointOnSegment(point, first, second);
    const distance = Math.hypot(
      point.x - closest.point.x,
      point.y - closest.point.y,
    );
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const length = Math.hypot(dx, dy);
    const normal =
      length > Number.EPSILON
        ? { x: dy / length, y: -dx / length }
        : { x: 1, y: 0 };
    if (
      distance < result.distance - 0.001 ||
      (Math.abs(distance - result.distance) <= 0.001 &&
        (normal.x > result.normal.x + 0.001 ||
          (Math.abs(normal.x - result.normal.x) <= 0.001 &&
            index < result.edgeIndex)))
    ) {
      result = {
        point: closest.point,
        normal,
        distance,
        edgeIndex: index,
      };
    }
  }
  return result;
}

export function getRegionLeaderHullBoundaryProjection(
  point: RegionLeaderPoint,
  hull: readonly RegionLeaderPoint[],
) {
  return closestPointOnRegionHull(point, hull);
}

export function createRegionSelectedContourProbePoints({
  overallHull,
  selectedContributorHulls,
  cardPoint,
  maximumPoints = 8,
}: {
  overallHull: readonly RegionLeaderPoint[];
  selectedContributorHulls: readonly (readonly RegionLeaderPoint[])[];
  cardPoint: RegionLeaderPoint;
  maximumPoints?: number;
}) {
  const candidates = selectedContributorHulls.flatMap((hull) =>
    hull.flatMap((point, index) => {
      const next = hull[(index + 1) % hull.length];
      return [0, 0.25, 0.5, 0.75].map((progress) => ({
        x: point.x + (next.x - point.x) * progress,
        y: point.y + (next.y - point.y) * progress,
      }));
    }),
  );
  return candidates
    .flatMap((candidate) => {
      const boundary = closestPointOnRegionHull(candidate, overallHull);
      const cardDx = cardPoint.x - boundary.point.x;
      const cardDy = cardPoint.y - boundary.point.y;
      const cardDistance = Math.max(
        Number.EPSILON,
        Math.hypot(cardDx, cardDy),
      );
      const outwardAlignment =
        (cardDx / cardDistance) * boundary.normal.x +
        (cardDy / cardDistance) * boundary.normal.y;
      if (boundary.distance > 8 || outwardAlignment <= -0.35) return [];
      return [
        {
          x:
            boundary.point.x -
            boundary.normal.x *
              REGION_INFO_LEADER.selectedContourInsetPx,
          y:
            boundary.point.y -
            boundary.normal.y *
              REGION_INFO_LEADER.selectedContourInsetPx,
          boundaryDistancePx: boundary.distance,
          outwardAlignment,
          cardDistancePx: cardDistance,
        },
      ];
    })
    .sort(
      (first, second) =>
        first.boundaryDistancePx - second.boundaryDistancePx ||
        second.outwardAlignment - first.outwardAlignment ||
        first.cardDistancePx - second.cardDistancePx ||
        second.x - first.x ||
        first.y - second.y,
    )
    .filter(
      (candidate, index, all) =>
        all.findIndex(
          (other) =>
            Math.hypot(
              candidate.x - other.x,
              candidate.y - other.y,
            ) < 1,
        ) === index,
    )
    .slice(0, maximumPoints);
}

function getRegionLeaderRayExitDistance(
  start: RegionLeaderPoint,
  end: RegionLeaderPoint,
  hull: readonly RegionLeaderPoint[],
) {
  const chordLength = Math.hypot(end.x - start.x, end.y - start.y);
  const isInside = (progress: number) => {
    const point = interpolatePoint(start, end, progress);
    return (
      pointInsideRegionHull(point, hull) ||
      closestPointOnRegionHull(point, hull).distance <=
        REGION_INFO_LEADER.maskExpansionPx
    );
  };
  let previousProgress = 0;
  for (let index = 1; index <= 8; index += 1) {
    const progress = index / 8;
    if (!isInside(progress)) {
      let insideProgress = previousProgress;
      let outsideProgress = progress;
      for (let iteration = 0; iteration < 8; iteration += 1) {
        const midpoint = (insideProgress + outsideProgress) / 2;
        if (isInside(midpoint)) insideProgress = midpoint;
        else outsideProgress = midpoint;
      }
      return chordLength * insideProgress;
    }
    previousProgress = progress;
  }
  return chordLength;
}

export type InternalExtractionOriginTrace = {
  visible: boolean;
  reason:
    | "visible"
    | "not-settled"
    | "origin-unavailable"
    | "trace-too-short"
    | "anatomy-intrusion"
    | "ui-intrusion";
  source: RegionLeaderPoint | null;
  innerSource: RegionLeaderPoint | null;
  endpoint: RegionLeaderPoint | null;
  target: RegionLeaderPoint | null;
  control: RegionLeaderPoint | null;
  path: string;
  underTissuePath: string;
  lengthPx: number;
  underTissueLengthPx: number;
  sourceHullErrorPx: number;
  innerSourceDepthPx: number;
  innerSourceInsideHull: boolean;
  anatomyIntrusion: boolean;
  uiIntrusion: boolean;
};

export function buildInternalExtractionOriginTrace({
  origin,
  specimenHull,
  extractedTargets,
  cardRect,
  progress,
}: {
  origin: RegionLeaderPoint | null;
  specimenHull: readonly RegionLeaderPoint[];
  extractedTargets: readonly RegionLeaderPoint[];
  cardRect: RegionLeaderScreenRect;
  progress: number;
}): InternalExtractionOriginTrace {
  const unavailable = (
    reason: InternalExtractionOriginTrace["reason"],
    overrides: Partial<InternalExtractionOriginTrace> = {},
  ): InternalExtractionOriginTrace => ({
    visible: false,
    reason,
    source: null,
    innerSource: null,
    endpoint: null,
    target: null,
    control: null,
    path: "",
    underTissuePath: "",
    lengthPx: 0,
    underTissueLengthPx: 0,
    sourceHullErrorPx: Number.POSITIVE_INFINITY,
    innerSourceDepthPx: 0,
    innerSourceInsideHull: false,
    anatomyIntrusion: false,
    uiIntrusion: false,
    ...overrides,
  });
  if (progress < 0.94) return unavailable("not-settled");
  if (!origin || specimenHull.length < 3 || extractedTargets.length === 0) {
    return unavailable("origin-unavailable");
  }
  const innerSourceInsideHull = pointInsideRegionHull(origin, specimenHull);
  const innerSourceDepthPx = closestPointOnRegionHull(
    origin,
    specimenHull,
  ).distance;
  if (!innerSourceInsideHull || innerSourceDepthPx < 4) {
    return unavailable("origin-unavailable", {
      innerSource: origin,
      innerSourceDepthPx,
      innerSourceInsideHull,
    });
  }
  const target = [...extractedTargets].sort(
    (first, second) =>
      Math.hypot(first.x - origin.x, first.y - origin.y) -
      Math.hypot(second.x - origin.x, second.y - origin.y),
  )[0];
  const targetDistance = Math.hypot(target.x - origin.x, target.y - origin.y);
  if (targetDistance <= 0.001) return unavailable("trace-too-short");
  const direction = {
    x: (target.x - origin.x) / targetDistance,
    y: (target.y - origin.y) / targetDistance,
  };
  const exitDistance = getRegionLeaderRayExitDistance(
    origin,
    target,
    specimenHull,
  );
  const source = {
    x: origin.x + direction.x * exitDistance,
    y: origin.y + direction.y * exitDistance,
  };
  const sourceHullErrorPx = closestPointOnRegionHull(
    source,
    specimenHull,
  ).distance;
  const endpoint = {
    x: target.x - direction.x * REGION_INFO_LEADER.extractionTraceTissueGapPx,
    y: target.y - direction.y * REGION_INFO_LEADER.extractionTraceTissueGapPx,
  };
  const start = {
    x: source.x + direction.x * (REGION_INFO_LEADER.extractionOriginRadiusPx + 2),
    y: source.y + direction.y * (REGION_INFO_LEADER.extractionOriginRadiusPx + 2),
  };
  const lengthPx = Math.hypot(endpoint.x - start.x, endpoint.y - start.y);
  if (lengthPx < REGION_INFO_LEADER.extractionTraceMinimumLengthPx) {
    return unavailable("trace-too-short", {
      source,
      innerSource: origin,
      endpoint,
      target,
      lengthPx,
      sourceHullErrorPx,
      underTissueLengthPx: exitDistance,
      innerSourceDepthPx,
      innerSourceInsideHull,
    });
  }
  const midpoint = {
    x: (start.x + endpoint.x) / 2,
    y: (start.y + endpoint.y) / 2,
  };
  const normal = { x: -direction.y, y: direction.x };
  const bend = Math.min(
    REGION_INFO_LEADER.extractionTraceMaximumBendPx,
    lengthPx * 0.08,
  );
  const candidates = [-bend, bend].map((offset) => ({
    x: midpoint.x + normal.x * offset,
    y: midpoint.y + normal.y * offset,
  }));
  const sampleCurve = (control: RegionLeaderPoint) =>
    Array.from({ length: 13 }, (_, index) => {
      const amount = index / 12;
      const inverse = 1 - amount;
      return {
        x:
          inverse * inverse * start.x +
          2 * inverse * amount * control.x +
          amount * amount * endpoint.x,
        y:
          inverse * inverse * start.y +
          2 * inverse * amount * control.y +
          amount * amount * endpoint.y,
      };
    });
  const evaluated = candidates
    .map((control) => {
      const samples = sampleCurve(control);
      return {
        control,
        anatomyIntrusion: samples
          .slice(2)
          .some((point) => pointInsideRegionHull(point, specimenHull)),
        uiIntrusion: samples.some((point) => pointInsideRect(point, cardRect)),
      };
    })
    .sort(
      (first, second) =>
        Number(first.anatomyIntrusion) - Number(second.anatomyIntrusion) ||
        Number(first.uiIntrusion) - Number(second.uiIntrusion),
    );
  const selected = evaluated[0];
  if (selected.anatomyIntrusion) {
    return unavailable("anatomy-intrusion", {
      source,
      innerSource: origin,
      endpoint,
      target,
      control: selected.control,
      lengthPx,
      sourceHullErrorPx,
      underTissueLengthPx: exitDistance,
      innerSourceDepthPx,
      innerSourceInsideHull,
      anatomyIntrusion: true,
      uiIntrusion: selected.uiIntrusion,
    });
  }
  if (selected.uiIntrusion) {
    return unavailable("ui-intrusion", {
      source,
      innerSource: origin,
      endpoint,
      target,
      control: selected.control,
      lengthPx,
      sourceHullErrorPx,
      underTissueLengthPx: exitDistance,
      innerSourceDepthPx,
      innerSourceInsideHull,
      uiIntrusion: true,
    });
  }
  const value = (number: number) => number.toFixed(2);
  return {
    visible: sourceHullErrorPx <= REGION_INFO_LEADER.maskExpansionPx + 1,
    reason:
      sourceHullErrorPx <= REGION_INFO_LEADER.maskExpansionPx + 1
        ? "visible"
        : "origin-unavailable",
    source,
    innerSource: origin,
    endpoint,
    target,
    control: selected.control,
    path: `M ${value(start.x)} ${value(start.y)} Q ${value(selected.control.x)} ${value(selected.control.y)} ${value(endpoint.x)} ${value(endpoint.y)}`,
    underTissuePath: `M ${value(origin.x)} ${value(origin.y)} L ${value(source.x)} ${value(source.y)}`,
    lengthPx,
    underTissueLengthPx: exitDistance,
    sourceHullErrorPx,
    innerSourceDepthPx,
    innerSourceInsideHull,
    anatomyIntrusion: false,
    uiIntrusion: false,
  };
}

export function chooseRegionContourAnchorCandidate<
  Candidate extends {
    screenPoint: RegionLeaderPoint;
    source: string;
    continuityDistance: number;
    interiorClearancePx: number;
  },
>({
  candidates,
  overallHull,
  selectedContributorHulls,
  selectedRegionId,
  cardPoint,
}: {
  candidates: readonly Candidate[];
  overallHull: readonly RegionLeaderPoint[];
  selectedContributorHulls: readonly (readonly RegionLeaderPoint[])[];
  selectedRegionId: RegionId;
  cardPoint: RegionLeaderPoint;
}) {
  const evaluated = candidates.map((candidate) => {
    const overallBoundary = closestPointOnRegionHull(
      candidate.screenPoint,
      overallHull,
    );
    const selectedBoundaryDistance = Math.min(
      ...selectedContributorHulls.map(
        (hull) =>
          closestPointOnRegionHull(candidate.screenPoint, hull).distance,
      ),
    );
    const markerToFinalExitPx = getRegionLeaderRayExitDistance(
      candidate.screenPoint,
      cardPoint,
      overallHull,
    );
    const cardDistancePx = Math.hypot(
      candidate.screenPoint.x - cardPoint.x,
      candidate.screenPoint.y - cardPoint.y,
    );
    const selectedContour =
      candidate.source === "contour" &&
      overallBoundary.normal.x > 0.04 &&
      overallBoundary.distance <=
        REGION_INFO_LEADER.selectedContourMaximumInsetPx &&
      selectedBoundaryDistance <=
        REGION_INFO_LEADER.selectedContourMaximumInsetPx &&
      selectedBoundaryDistance <=
        REGION_INFO_LEADER.selectedContourMaximumInsetPx;
    const selectedSupportContour =
      candidate.source === "contour" &&
      (overallBoundary.normal.x > 0.04 ||
        selectedRegionId === "frontal-lobe") &&
      overallBoundary.distance <=
        REGION_INFO_LEADER.selectedSupportMaximumExitPx &&
      selectedBoundaryDistance <=
        REGION_INFO_LEADER.selectedSupportMaximumExitPx;
    return {
      candidate,
      anchorSource: selectedContour
        ? ("selected-contour" as const)
        : ("selected-support" as const),
      selectedRegion: selectedRegionId,
      hullEdgeRegion: selectedContour ? selectedRegionId : null,
      markerToFinalExitPx,
      cardDistancePx,
      residualOccludedGapPx: Math.max(
        0,
        markerToFinalExitPx - REGION_INFO_LEADER.stemLengthPx,
      ),
      selectedSupportContour,
    };
  });
  return evaluated.sort(
    (first, second) =>
      (first.anchorSource === "selected-contour" ? 0 : 1) -
        (second.anchorSource === "selected-contour" ? 0 : 1) ||
      (first.selectedSupportContour ? 0 : 1) -
        (second.selectedSupportContour ? 0 : 1) ||
      first.residualOccludedGapPx - second.residualOccludedGapPx ||
      first.markerToFinalExitPx - second.markerToFinalExitPx ||
      first.cardDistancePx - second.cardDistancePx ||
      first.candidate.continuityDistance -
        second.candidate.continuityDistance ||
      second.candidate.interiorClearancePx -
        first.candidate.interiorClearancePx,
  )[0] ?? null;
}

export function buildRegionPairForkGeometry({
  center,
  targets,
}: {
  center: RegionLeaderPoint;
  targets: readonly {
    point: RegionLeaderPoint;
    componentId: string;
    resolver: "frontmost-visible-selected";
  }[];
}) {
  const arms = targets.slice(0, 2).map((target) => {
    const dx = target.point.x - center.x;
    const dy = target.point.y - center.y;
    const distance = Math.max(Number.EPSILON, Math.hypot(dx, dy));
    const length = Math.min(
      REGION_INFO_LEADER.pairForkMaximumLengthPx,
      Math.max(
        0,
        distance - REGION_INFO_LEADER.pairForkSurfaceGapPx,
      ),
    );
    return {
      componentId: target.componentId,
      resolver: target.resolver,
      endpoint: {
        x: center.x + (dx / distance) * length,
        y: center.y + (dy / distance) * length,
      },
      lengthPx: length,
      surfaceGapPx: distance - length,
      path: `M ${center.x.toFixed(2)} ${center.y.toFixed(2)} L ${(
        center.x +
        (dx / distance) * length
      ).toFixed(2)} ${(
        center.y +
        (dy / distance) * length
      ).toFixed(2)}`,
      intersections: false,
    };
  });
  return {
    arms,
    symmetryErrorPx:
      arms.length === 2
        ? Math.abs(arms[0].lengthPx - arms[1].lengthPx)
        : Number.POSITIVE_INFINITY,
  };
}

export function findNearestPointsBetweenRegionHulls(
  firstHull: readonly RegionLeaderPoint[],
  secondHull: readonly RegionLeaderPoint[],
): {
  first: RegionLeaderPoint;
  second: RegionLeaderPoint;
  distancePx: number;
} | null {
  let result: {
    first: RegionLeaderPoint;
    second: RegionLeaderPoint;
    distancePx: number;
  } | null = null;
  const consider = (
    first: RegionLeaderPoint,
    second: RegionLeaderPoint,
  ) => {
    const distancePx = Math.hypot(
      first.x - second.x,
      first.y - second.y,
    );
    if (!result || distancePx < result.distancePx) {
      result = {
        first: { ...first },
        second: { ...second },
        distancePx,
      };
    }
  };
  const closestOnSegment = (
    point: RegionLeaderPoint,
    start: RegionLeaderPoint,
    end: RegionLeaderPoint,
  ) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const denominator = dx * dx + dy * dy;
    const progress =
      denominator <= Number.EPSILON
        ? 0
        : clamp(
            0,
            ((point.x - start.x) * dx +
              (point.y - start.y) * dy) /
              denominator,
            1,
          );
    return {
      x: start.x + dx * progress,
      y: start.y + dy * progress,
    };
  };
  for (const point of firstHull) {
    for (let index = 0; index < secondHull.length; index += 1) {
      consider(
        point,
        closestOnSegment(
          point,
          secondHull[index],
          secondHull[(index + 1) % secondHull.length],
        ),
      );
    }
  }
  for (const point of secondHull) {
    for (let index = 0; index < firstHull.length; index += 1) {
      consider(
        closestOnSegment(
          point,
          firstHull[index],
          firstHull[(index + 1) % firstHull.length],
        ),
        point,
      );
    }
  }
  return result;
}

function pointInsideRect(
  point: RegionLeaderPoint,
  rect: RegionLeaderScreenRect,
) {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

function orientation(
  first: RegionLeaderPoint,
  second: RegionLeaderPoint,
  third: RegionLeaderPoint,
) {
  return (
    (second.x - first.x) * (third.y - first.y) -
    (second.y - first.y) * (third.x - first.x)
  );
}

function segmentsIntersect(
  firstStart: RegionLeaderPoint,
  firstEnd: RegionLeaderPoint,
  secondStart: RegionLeaderPoint,
  secondEnd: RegionLeaderPoint,
) {
  const firstA = orientation(firstStart, firstEnd, secondStart);
  const firstB = orientation(firstStart, firstEnd, secondEnd);
  const secondA = orientation(secondStart, secondEnd, firstStart);
  const secondB = orientation(secondStart, secondEnd, firstEnd);
  if (
    ((firstA > 0 && firstB < 0) || (firstA < 0 && firstB > 0)) &&
    ((secondA > 0 && secondB < 0) || (secondA < 0 && secondB > 0))
  ) {
    return true;
  }
  const onSegment = (
    point: RegionLeaderPoint,
    start: RegionLeaderPoint,
    end: RegionLeaderPoint,
  ) =>
    point.x >= Math.min(start.x, end.x) - 0.001 &&
    point.x <= Math.max(start.x, end.x) + 0.001 &&
    point.y >= Math.min(start.y, end.y) - 0.001 &&
    point.y <= Math.max(start.y, end.y) + 0.001;
  return (
    (Math.abs(firstA) <= 0.001 &&
      onSegment(secondStart, firstStart, firstEnd)) ||
    (Math.abs(firstB) <= 0.001 &&
      onSegment(secondEnd, firstStart, firstEnd)) ||
    (Math.abs(secondA) <= 0.001 &&
      onSegment(firstStart, secondStart, secondEnd)) ||
    (Math.abs(secondB) <= 0.001 &&
      onSegment(firstEnd, secondStart, secondEnd))
  );
}

function regionHullIntersectsRect(
  hull: readonly RegionLeaderPoint[],
  rect: RegionLeaderScreenRect,
) {
  if (hull.some((point) => pointInsideRect(point, rect))) return true;
  const corners = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
  if (
    corners.some((corner) => pointInsideRegionHull(corner, hull))
  ) {
    return true;
  }
  for (let hullIndex = 0; hullIndex < hull.length; hullIndex += 1) {
    const first = hull[hullIndex];
    const second = hull[(hullIndex + 1) % hull.length];
    for (let rectIndex = 0; rectIndex < corners.length; rectIndex += 1) {
      if (
        segmentsIntersect(
          first,
          second,
          corners[rectIndex],
          corners[(rectIndex + 1) % corners.length],
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

export function evaluateRegionHullCardClearance(
  hull: readonly RegionLeaderPoint[],
  rect: RegionLeaderScreenRect,
  requiredClearancePx: number,
) {
  const corners = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
  const cardCornerInside = corners.some((corner) =>
    pointInsideRegionHull(corner, hull),
  );
  const hullVertexInside = hull.some((point) =>
    pointInsideRect(point, rect),
  );
  let edgeIntersection = false;
  for (let hullIndex = 0; hullIndex < hull.length; hullIndex += 1) {
    for (let rectIndex = 0; rectIndex < corners.length; rectIndex += 1) {
      edgeIntersection ||= segmentsIntersect(
        hull[hullIndex],
        hull[(hullIndex + 1) % hull.length],
        corners[rectIndex],
        corners[(rectIndex + 1) % corners.length],
      );
    }
  }
  const overlap =
    cardCornerInside || hullVertexInside || edgeIntersection;
  let clearancePx = overlap ? 0 : Number.POSITIVE_INFINITY;
  if (!overlap) {
    for (let hullIndex = 0; hullIndex < hull.length; hullIndex += 1) {
      const first = hull[hullIndex];
      const second = hull[(hullIndex + 1) % hull.length];
      for (let rectIndex = 0; rectIndex < corners.length; rectIndex += 1) {
        const rectFirst = corners[rectIndex];
        const rectSecond = corners[(rectIndex + 1) % corners.length];
        clearancePx = Math.min(
          clearancePx,
          pointToSegmentDistance(first, rectFirst, rectSecond),
          pointToSegmentDistance(second, rectFirst, rectSecond),
          pointToSegmentDistance(rectFirst, first, second),
          pointToSegmentDistance(rectSecond, first, second),
        );
      }
    }
  }
  if (!Number.isFinite(clearancePx)) clearancePx = 0;
  const conservativeExpansion = Math.max(
    0,
    requiredClearancePx - 0.01,
  );
  const expandedRect = {
    left: rect.left - conservativeExpansion,
    top: rect.top - conservativeExpansion,
    right: rect.right + conservativeExpansion,
    bottom: rect.bottom + conservativeExpansion,
  };
  return {
    clearancePx,
    requiredClearancePx,
    overlap,
    cardCornerInside,
    hullVertexInside,
    edgeIntersection,
    expandedOverlap: regionHullIntersectsRect(hull, expandedRect),
    safe:
      !overlap &&
      clearancePx + 0.001 >= requiredClearancePx &&
      !regionHullIntersectsRect(hull, expandedRect),
  };
}

export type RegionNavigatorCardLayoutContext = {
  active: boolean;
  navigatorRect: RegionLeaderScreenRect | null;
  uiExclusionRects: readonly RegionLeaderScreenRect[];
  minimumCardTopPx: number;
};

function screenRectsOverlap(
  first: RegionLeaderScreenRect,
  second: RegionLeaderScreenRect,
) {
  return (
    first.left < second.right &&
    first.right > second.left &&
    first.top < second.bottom &&
    first.bottom > second.top
  );
}

export function getBrainUiExclusionRects(
  viewportWidth: number,
  viewportHeight: number,
) {
  const navigator = getRegionNavigatorLayout(
    viewportWidth,
    viewportHeight,
  );
  const title: RegionLeaderScreenRect = {
    left: 0,
    top: 0,
    right: Math.min(430, viewportWidth * 0.44),
    bottom: 130,
  };
  const status: RegionLeaderScreenRect = {
    left: Math.max(0, viewportWidth - 470),
    top: 0,
    right: viewportWidth,
    bottom: 105,
  };
  const tagline: RegionLeaderScreenRect = {
    left: 0,
    top: Math.max(0, viewportHeight - 110),
    right: Math.min(430, viewportWidth * 0.44),
    bottom: viewportHeight,
  };
  const navigatorRect: RegionLeaderScreenRect | null = navigator.visible
    ? {
        left: navigator.left,
        top: navigator.top,
        right: navigator.left + navigator.width,
        bottom: navigator.top + navigator.height,
      }
    : null;
  return {
    title,
    status,
    tagline,
    navigator: navigatorRect,
    all: [
      title,
      status,
      tagline,
      ...(navigatorRect ? [navigatorRect] : []),
    ],
    statusSafeBottomPx:
      status.bottom +
      REGION_CARD_CAMERA_CONVERGENCE.uiExclusionGapPx,
  };
}

export function solveRegionSplitCallout({
  viewportWidth,
  viewportHeight,
  silhouette,
  detachedInternal,
  anchorPoint,
  selectedRegionId,
  anchorSource,
  cameraReservedRightPx,
  navigatorContext,
  cardSize,
}: {
  viewportWidth: number;
  viewportHeight: number;
  silhouette: RegionLeaderSilhouette;
  detachedInternal: boolean;
  anchorPoint?: RegionLeaderPoint;
  selectedRegionId?: RegionId;
  anchorSource?: "selected-contour" | "selected-support";
  cameraReservedRightPx?: number;
  navigatorContext?: RegionNavigatorCardLayoutContext;
  cardSize?: Readonly<{ width: number; height: number }>;
}): RegionSplitCalloutLayout {
  const enforcePeripheralCard =
    selectedRegionId === "frontal-lobe" &&
    anchorSource === "selected-support";
  const base = getRegionInfoCardLayout(viewportWidth, viewportHeight);
  const baseRight = viewportWidth - base.right;
  const baseBottom = viewportHeight - base.bottom;
  const cardWidth =
    cardSize &&
    Number.isFinite(cardSize.width) &&
    cardSize.width > 0
      ? Math.min(viewportWidth, cardSize.width)
      : base.width;
  const cardHeight =
    cardSize &&
    Number.isFinite(cardSize.height) &&
    cardSize.height > 0
      ? Math.min(viewportHeight, cardSize.height)
      : base.height;
  const baseLeft = baseRight - cardWidth;
  const baseTop = baseBottom - cardHeight;
  const baseReservedRightPx =
    viewportWidth - baseLeft + base.anatomyGapPx;
  const baseCardRect = {
    left: baseLeft,
    top: baseTop,
    right: baseRight,
    bottom: baseBottom,
  };
  const targetGapPx = clamp(
    REGION_INFO_LEADER.minimumSpecimenGapPx,
    detachedInternal
      ? REGION_INFO_LEADER.internalDesiredSpecimenGapPx
      : viewportWidth >= 1200
        ? REGION_INFO_LEADER.externalDesiredSpecimenGapPx
        : 51.4,
    REGION_INFO_LEADER.maximumSpecimenGapPx,
  );
  const baseCardJunction = {
    x: baseLeft,
    y: baseTop + base.leaderAttachmentOffsetYPx,
  };
  const coupledMinimumCardLeft =
    cameraReservedRightPx !== undefined &&
    cameraReservedRightPx >
      baseReservedRightPx +
        REGION_CARD_CAMERA_CONVERGENCE.insetHysteresisPx
      ? viewportWidth -
        cameraReservedRightPx +
        Math.max(24, targetGapPx) +
        REGION_CARD_CAMERA_CONVERGENCE.neutralBorderPx
      : Number.NEGATIVE_INFINITY;
  const minimumShiftX = Math.max(
    navigatorContext?.active
      ? REGION_INFO_LEADER.screenSafeInsetPx - baseLeft
      : -REGION_INFO_LEADER.maximumCardShiftXPx,
    REGION_INFO_LEADER.screenSafeInsetPx - baseLeft,
    coupledMinimumCardLeft - baseLeft,
  );
  const maximumShiftX = Math.min(
    REGION_INFO_LEADER.maximumCardShiftXPx,
    viewportWidth -
      REGION_INFO_LEADER.screenSafeInsetPx -
      baseRight,
  );
  const navigatorCardTop = navigatorContext?.active
    ? clamp(
        navigatorContext.minimumCardTopPx,
        (anchorPoint?.y ?? baseCardJunction.y) -
          base.leaderAttachmentOffsetYPx,
        viewportHeight -
          REGION_INFO_LEADER.screenSafeInsetPx -
          cardHeight,
      )
    : null;
  const minimumShiftY = Math.max(
    detachedInternal
      ? -REGION_INFO_LEADER.maximumInternalCardShiftYPx
      : Number.NEGATIVE_INFINITY,
    REGION_INFO_LEADER.screenSafeInsetPx - baseTop,
    navigatorContext?.active
      ? navigatorContext.minimumCardTopPx - baseTop
      : Number.NEGATIVE_INFINITY,
    navigatorCardTop !== null
      ? navigatorCardTop - baseTop
      : Number.NEGATIVE_INFINITY,
  );
  const maximumShiftY = Math.min(
    detachedInternal
      ? REGION_INFO_LEADER.maximumInternalCardShiftYPx
      : Number.POSITIVE_INFINITY,
    viewportHeight -
      REGION_INFO_LEADER.screenSafeInsetPx -
      baseBottom,
    navigatorCardTop !== null
      ? navigatorCardTop - baseTop
      : Number.POSITIVE_INFINITY,
  );

  type FacingEdge = {
    first: RegionLeaderPoint;
    second: RegionLeaderPoint;
    normal: RegionLeaderPoint;
    key: string;
    contributor: RegionSplitCalloutLayout["hullClosestContributor"];
  };
  const facingEdges: FacingEdge[] = [];
  const edgeKeys = new Set<string>();
  const sortedContributors = [...(silhouette.contributors ?? [])].sort(
    (first, second) => first.stableId.localeCompare(second.stableId),
  );
  const edgeSources = [
    ...sortedContributors.map((contributor) => ({
      hull: contributor.hull,
      contributor: {
        stableId: contributor.stableId,
        regionId: contributor.regionId,
        role: contributor.role,
      },
    })),
    { hull: silhouette.hull, contributor: null },
  ];
  for (const source of edgeSources) {
    for (let index = 0; index < source.hull.length; index += 1) {
      const first = source.hull[index];
      const second = source.hull[(index + 1) % source.hull.length];
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const length = Math.hypot(dx, dy);
      if (length <= Number.EPSILON) continue;
      const normal = { x: dy / length, y: -dx / length };
      if (normal.x <= 0.04) continue;
      const midpoint = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      };
      const outsideProbe = {
        x: midpoint.x + normal.x,
        y: midpoint.y + normal.y,
      };
      if (pointInsideRegionHull(outsideProbe, silhouette.hull)) continue;
      const boundaryDistance = closestPointOnRegionHull(
        midpoint,
        silhouette.hull,
      ).distance;
      if (source.contributor && boundaryDistance > 1.25) continue;
      const key = [
        first.x.toFixed(3),
        first.y.toFixed(3),
        second.x.toFixed(3),
        second.y.toFixed(3),
      ].join(":");
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      facingEdges.push({
        first,
        second,
        normal,
        key,
        contributor: source.contributor,
      });
    }
  }

  type PlacementCandidate = {
    cardShiftX: number;
    cardShiftY: number;
    cardJunctionPoint: RegionLeaderPoint;
    finalCardRect: RegionLeaderScreenRect;
    hullClosestPoint: RegionLeaderPoint;
    outwardNormal: RegionLeaderPoint;
    fullGapPx: number;
    movementSquared: number;
    gapError: number;
    overlap: boolean;
    cardHullClearancePx: number;
    cardCornerInside: boolean;
    cardHullVertexInside: boolean;
    cardEdgeIntersection: boolean;
    cardPlacementSafe: boolean;
    cardUiSafe: boolean;
    corridorFeasible: boolean;
    markerToExitPx: number;
    visibleOutsideEstimatePx: number;
    contributor: RegionSplitCalloutLayout["hullClosestContributor"];
    edgeKey: string;
    progress: number;
  };
  const resolveContributor = (point: RegionLeaderPoint) => {
    let best:
      | {
          distance: number;
          contributor: NonNullable<
            RegionSplitCalloutLayout["hullClosestContributor"]
          >;
        }
      | null = null;
    for (const contributor of sortedContributors) {
      const distance = closestPointOnRegionHull(
        point,
        contributor.hull,
      ).distance;
      if (
        !best ||
        distance < best.distance - 0.001 ||
        (Math.abs(distance - best.distance) <= 0.001 &&
          contributor.stableId < best.contributor.stableId)
      ) {
        best = {
          distance,
          contributor: {
            stableId: contributor.stableId,
            regionId: contributor.regionId,
            role: contributor.role,
          },
        };
      }
    }
    return best?.contributor ?? null;
  };
  const evaluate = (
    edge: FacingEdge,
    unboundedProgress: number,
    verticalMode:
      | "anchor"
      | "edge"
      | "base"
      | "minimum"
      | "maximum" = "anchor",
  ): PlacementCandidate => {
    const progress = clamp(0, unboundedProgress, 1);
    const hullPoint = {
      x:
        edge.first.x +
        (edge.second.x - edge.first.x) * progress,
      y:
        edge.first.y +
        (edge.second.y - edge.first.y) * progress,
    };
    const desiredCardJunction = {
      x: hullPoint.x + edge.normal.x * targetGapPx,
      y: hullPoint.y + edge.normal.y * targetGapPx,
    };
    const cardShiftX = clamp(
      minimumShiftX,
      desiredCardJunction.x - baseCardJunction.x,
      maximumShiftX,
    );
    const desiredShiftY =
      verticalMode === "edge"
        ? desiredCardJunction.y - baseCardJunction.y
        : verticalMode === "base"
          ? 0
          : verticalMode === "minimum"
            ? minimumShiftY
            : verticalMode === "maximum"
              ? maximumShiftY
              : (anchorPoint?.y ?? desiredCardJunction.y) -
                baseCardJunction.y;
    const cardShiftY = clamp(
      minimumShiftY,
      desiredShiftY,
      maximumShiftY,
    );
    const cardJunctionPoint = {
      x: baseCardJunction.x + cardShiftX,
      y: baseCardJunction.y + cardShiftY,
    };
    const closest = closestPointOnRegionHull(
      cardJunctionPoint,
      silhouette.hull,
    );
    const finalCardRect = {
      left: baseLeft + cardShiftX,
      top: baseTop + cardShiftY,
      right: baseRight + cardShiftX,
      bottom: baseBottom + cardShiftY,
    };
    const cardClearance = evaluateRegionHullCardClearance(
      silhouette.hull,
      finalCardRect,
      Math.max(24, targetGapPx),
    );
    const overlap = cardClearance.overlap;
    const cardUiSafe =
      !navigatorContext?.active ||
      navigatorContext.uiExclusionRects.every(
        (rect) => !screenRectsOverlap(finalCardRect, rect),
      );
    const direction =
      closest.distance > Number.EPSILON
        ? {
            x:
              (cardJunctionPoint.x - closest.point.x) /
              closest.distance,
            y:
              (cardJunctionPoint.y - closest.point.y) /
              closest.distance,
          }
        : { x: 0, y: 0 };
    const maximumConnectorLength = detachedInternal
      ? REGION_INFO_LEADER.connectorInternalMaximumPx
      : viewportWidth >= 1200
        ? REGION_INFO_LEADER.connectorDesktopMaximumPx
        : REGION_INFO_LEADER.connectorTabletMaximumPx;
    const endpointInsets =
      (detachedInternal
        ? REGION_INFO_LEADER.connectorInternalSilhouetteGapPx
        : REGION_INFO_LEADER.connectorExternalSilhouetteGapPx) +
      REGION_INFO_LEADER.connectorCardGapPx;
    const corridorFeasible =
      (enforcePeripheralCard ? cardClearance.safe : !overlap) &&
      direction.x > 0 &&
      direction.x * closest.normal.x +
        direction.y * closest.normal.y >
        0.04 &&
      closest.distance > endpointInsets &&
      closest.distance - endpointInsets <= maximumConnectorLength;
    const markerToExitPx = anchorPoint
      ? getRegionLeaderRayExitDistance(
          anchorPoint,
          cardJunctionPoint,
          silhouette.hull,
        )
      : Number.POSITIVE_INFINITY;
    const visibleOutsideEstimatePx = anchorPoint
      ? Math.max(
          0,
          Math.hypot(
            cardJunctionPoint.x - anchorPoint.x,
            cardJunctionPoint.y - anchorPoint.y,
          ) -
            markerToExitPx -
            REGION_INFO_LEADER.connectorCardGapPx,
        )
      : closest.distance - endpointInsets;
    const selectedAnchorFeasible =
      !enforcePeripheralCard &&
      Boolean(
        selectedRegionId &&
          anchorPoint &&
          (anchorSource === "selected-contour" ||
            selectedRegionId === "frontal-lobe"),
      ) &&
      markerToExitPx <=
        REGION_INFO_LEADER.selectedContourMaximumExitPx &&
      visibleOutsideEstimatePx <= maximumConnectorLength &&
      cardJunctionPoint.x >
        (anchorPoint?.x ?? cardJunctionPoint.x) +
          REGION_INFO_LEADER.connectorCardGapPx;
    return {
      cardShiftX,
      cardShiftY,
      cardJunctionPoint,
      finalCardRect,
      hullClosestPoint: closest.point,
      outwardNormal: closest.normal,
      fullGapPx: closest.distance,
      movementSquared:
        cardShiftX * cardShiftX + cardShiftY * cardShiftY,
      gapError: Math.abs(closest.distance - targetGapPx),
      overlap,
      cardHullClearancePx: cardClearance.clearancePx,
      cardCornerInside: cardClearance.cardCornerInside,
      cardHullVertexInside: cardClearance.hullVertexInside,
      cardEdgeIntersection: cardClearance.edgeIntersection,
      cardPlacementSafe: cardClearance.safe,
      cardUiSafe,
      corridorFeasible:
        (cardUiSafe &&
          corridorFeasible &&
          visibleOutsideEstimatePx <= maximumConnectorLength) ||
        selectedAnchorFeasible,
      markerToExitPx,
      visibleOutsideEstimatePx,
      contributor:
        edge.contributor ?? resolveContributor(closest.point),
      edgeKey: edge.key,
      progress,
    };
  };
  const candidates: PlacementCandidate[] = [];
  const candidateQuality = (candidate: PlacementCandidate) => [
    navigatorContext?.active && !candidate.cardUiSafe ? 1 : 0,
    enforcePeripheralCard && !candidate.cardPlacementSafe ? 1 : 0,
    enforcePeripheralCard && !candidate.cardPlacementSafe
      ? Math.max(
          0,
          Math.max(24, targetGapPx) -
            candidate.cardHullClearancePx,
        )
      : 0,
    candidate.corridorFeasible ? 0 : 1,
    selectedRegionId &&
    candidate.contributor?.regionId === selectedRegionId
      ? 0
      : selectedRegionId
        ? 1
        : 0,
    candidate.markerToExitPx <=
    (detachedInternal
      ? REGION_INFO_LEADER.selectedSupportMaximumExitPx
      : REGION_INFO_LEADER.selectedContourMaximumExitPx)
      ? 0
      : 1,
    candidate.markerToExitPx,
    candidate.visibleOutsideEstimatePx,
    candidate.gapError <= 0.5 ? 0 : 1,
    candidate.gapError,
    candidate.movementSquared,
    candidate.contributor ? 0 : 1,
    candidate.edgeKey,
    candidate.progress,
  ] as const;
  const compareCandidates = (
    first: PlacementCandidate,
    second: PlacementCandidate,
  ) => {
    const firstQuality = candidateQuality(first);
    const secondQuality = candidateQuality(second);
    for (let index = 0; index < firstQuality.length; index += 1) {
      const firstValue = firstQuality[index];
      const secondValue = secondQuality[index];
      if (firstValue === secondValue) continue;
      return typeof firstValue === "string"
        ? firstValue.localeCompare(secondValue as string)
        : (firstValue as number) - (secondValue as number);
    }
    return 0;
  };
  for (const edge of facingEdges) {
    const dx = edge.second.x - edge.first.x;
    const dy = edge.second.y - edge.first.y;
    const desiredOrigin = {
      x: edge.first.x + edge.normal.x * targetGapPx,
      y: edge.first.y + edge.normal.y * targetGapPx,
    };
    const denominator = dx * dx + dy * dy;
    const analyticProgress =
      denominator > Number.EPSILON
        ? ((baseCardJunction.x - desiredOrigin.x) * dx +
            (baseCardJunction.y - desiredOrigin.y) * dy) /
          denominator
        : 0;
    const progressValues = new Set<number>([
      0,
      1,
      clamp(0, analyticProgress, 1),
    ]);
    if (anchorPoint && denominator > Number.EPSILON) {
      progressValues.add(
        clamp(
          0,
          ((anchorPoint.x - edge.first.x) * dx +
            (anchorPoint.y - edge.first.y) * dy) /
            denominator,
          1,
        ),
      );
    }
    for (const shiftX of [minimumShiftX, maximumShiftX]) {
      if (Math.abs(dx) > Number.EPSILON) {
        progressValues.add(
          clamp(
            0,
            (baseCardJunction.x +
              shiftX -
              desiredOrigin.x) /
              dx,
            1,
          ),
        );
      }
    }
    for (const shiftY of [minimumShiftY, maximumShiftY]) {
      if (Math.abs(dy) > Number.EPSILON) {
        progressValues.add(
          clamp(
            0,
            (baseCardJunction.y +
              shiftY -
              desiredOrigin.y) /
              dy,
            1,
          ),
        );
      }
    }
    for (const progress of progressValues) {
      for (const verticalMode of [
        "anchor",
        "edge",
        "base",
        "minimum",
        "maximum",
      ] as const) {
        candidates.push(evaluate(edge, progress, verticalMode));
      }
    }
  }
  if (
    !candidates.some(
      (candidate) =>
        candidate.corridorFeasible && candidate.gapError <= 0.5,
    )
  ) {
    for (const edge of facingEdges) {
      let lower = 0;
      let upper = 1;
      for (let iteration = 0; iteration < 8; iteration += 1) {
        const firstProgress = lower + (upper - lower) / 3;
        const secondProgress = upper - (upper - lower) / 3;
        const firstCandidate = evaluate(edge, firstProgress);
        const secondCandidate = evaluate(edge, secondProgress);
        if (compareCandidates(firstCandidate, secondCandidate) <= 0) {
          upper = secondProgress;
        } else {
          lower = firstProgress;
        }
      }
      candidates.push(evaluate(edge, (lower + upper) / 2));
    }
  }
  const selected = candidates.sort(compareCandidates)[0] ?? null;
  if (!selected) {
    const hullClosestPoint =
      silhouette.hull.reduce((rightmost, point) =>
        point.x > rightmost.x ? point : rightmost,
      );
    const cardJunctionPoint = baseCardJunction;
    return {
      baseCardRect,
      finalCardRect: baseCardRect,
      cardShiftX: 0,
      cardShiftY: 0,
      cardJunctionPoint,
      hullClosestPoint,
      outwardNormal: { x: 1, y: 0 },
      hullClosestContributor: resolveContributor(hullClosestPoint),
      targetGapPx,
      fullGapPx: Math.hypot(
        cardJunctionPoint.x - hullClosestPoint.x,
        cardJunctionPoint.y - hullClosestPoint.y,
      ),
      distanceToHullPx: Number.POSITIVE_INFINITY,
      cardHullClearancePx: 0,
      requiredCardHullClearancePx: Math.max(24, targetGapPx),
      cardHullOverlap: true,
      cardCornerInside: false,
      cardHullVertexInside: false,
      cardEdgeIntersection: false,
      requiresPeripheralCardClearance: enforcePeripheralCard,
      solverStatus: "infeasible",
      solutionHash: "infeasible",
      silhouetteHull: [...silhouette.hull],
    };
  }
  const solverStatus: RegionSplitCalloutLayout["solverStatus"] =
    !selected.corridorFeasible ||
    (enforcePeripheralCard && !selected.cardPlacementSafe)
      ? "infeasible"
      : selected.gapError <= 0.5
        ? "target"
        : "gap-bound-clamped";
  const solutionHash = [
    selected.cardShiftX,
    selected.cardShiftY,
    selected.cardJunctionPoint.x,
    selected.cardJunctionPoint.y,
    selected.hullClosestPoint.x,
    selected.hullClosestPoint.y,
    selected.outwardNormal.x,
    selected.outwardNormal.y,
    selected.fullGapPx,
    selected.cardHullClearancePx,
    selected.cardPlacementSafe ? 1 : 0,
    solverStatus,
  ]
    .map((value) =>
      typeof value === "number" ? value.toFixed(3) : value,
    )
    .join(":");
  return {
    baseCardRect,
    finalCardRect: selected.finalCardRect,
    cardShiftX: selected.cardShiftX,
    cardShiftY: selected.cardShiftY,
    cardJunctionPoint: selected.cardJunctionPoint,
    hullClosestPoint: selected.hullClosestPoint,
    outwardNormal: selected.outwardNormal,
    hullClosestContributor: selected.contributor,
    targetGapPx,
    fullGapPx: selected.fullGapPx,
    distanceToHullPx: selected.fullGapPx,
    cardHullClearancePx: selected.cardHullClearancePx,
    requiredCardHullClearancePx: Math.max(24, targetGapPx),
    cardHullOverlap: selected.overlap,
    cardCornerInside: selected.cardCornerInside,
    cardHullVertexInside: selected.cardHullVertexInside,
    cardEdgeIntersection: selected.cardEdgeIntersection,
    requiresPeripheralCardClearance: enforcePeripheralCard,
    solverStatus,
    solutionHash,
    silhouetteHull: [...silhouette.hull],
  };
}

export type NavigatorCardCameraSafetyVector = {
  cardHullClearance: boolean;
  cardIntersectionFree: boolean;
  navigatorGap: boolean;
  topMargin: boolean;
  bottomMargin: boolean;
  connectorVisible: boolean;
  connectorWithinCap: boolean;
  connectorIntersectionFree: boolean;
  connectorEndpointGaps: boolean;
  cardViewport: boolean;
  titleExclusion: boolean;
  statusExclusion: boolean;
  taglineExclusion: boolean;
  navigatorExclusion: boolean;
};

export type NavigatorCardCameraLayout = {
  callout: RegionSplitCalloutLayout;
  connector: RegionDepthOccludedLeaderGeometry;
  requestedLeftInsetPx: number;
  requestedRightInsetPx: number;
  baseLeftInsetPx: number;
  baseRightInsetPx: number;
  measuredNavigatorGapPx: number;
  topMarginPx: number;
  bottomMarginPx: number;
  rightInsetFloorPx: number;
  initialConnectorOutsideLengthPx: number;
  initialCardHullClearancePx: number;
  connectorCardAdjustment: Readonly<{
    x: number;
    y: number;
    attempts: number;
  }>;
  safety: NavigatorCardCameraSafetyVector;
  safe: boolean;
  uiCollisions: string[];
};

function fitRegionCalloutToConnectorCap({
  callout,
  markerCenter,
  viewportWidth,
  viewportHeight,
  detachedInternal,
  navigatorActive,
  exclusions,
  highResidualFallback,
}: {
  callout: RegionSplitCalloutLayout;
  markerCenter: RegionLeaderPoint;
  viewportWidth: number;
  viewportHeight: number;
  detachedInternal: boolean;
  navigatorActive: boolean;
  exclusions: ReturnType<typeof getBrainUiExclusionRects>;
  highResidualFallback: boolean;
}) {
  const maximumConnectorLength = detachedInternal
    ? REGION_INFO_LEADER.connectorInternalMaximumPx
    : viewportWidth >= 1200
      ? REGION_INFO_LEADER.connectorDesktopMaximumPx
      : REGION_INFO_LEADER.connectorTabletMaximumPx;
  const placementMaximumConnectorLength =
    maximumConnectorLength - (viewportWidth >= 1720 ? 4 : 0);
  const buildConnector = (solution: RegionSplitCalloutLayout) =>
    buildRegionDepthOccludedLeader({
      solution,
      currentCardRect: solution.finalCardRect,
      markerCenter,
      viewportWidth,
      viewportHeight,
      detachedInternal,
      highResidualFallback,
    });
  const baselineConnector = buildConnector(callout);
  const connectorSafe = (
    connector: RegionDepthOccludedLeaderGeometry,
  ) =>
    connector.visible &&
    connector.visibleOutsideLengthPx <=
      placementMaximumConnectorLength + 0.001 &&
    !connector.anatomyIntersection &&
    !connector.uiIntersection &&
    connector.cardGapPx + 0.001 >=
      REGION_INFO_LEADER.connectorCardGapPx &&
    connector.finalHullExit !== null;
  if (!navigatorActive || connectorSafe(baselineConnector)) {
    return {
      callout,
      connector: baselineConnector,
      baselineConnector,
      adjustment: { x: 0, y: 0, attempts: 0 },
    };
  }

  const minimumClearancePx =
    REGION_CARD_CAMERA_CONVERGENCE.minimumCardHullClearancePx;
  const verticalOffsets = [0];
  for (
    let offset =
      REGION_CARD_CAMERA_CONVERGENCE.connectorSearchStepPx * 3;
    offset <=
    REGION_CARD_CAMERA_CONVERGENCE.connectorVerticalSearchPx;
    offset +=
    REGION_CARD_CAMERA_CONVERGENCE.connectorSearchStepPx * 3
  ) {
    verticalOffsets.push(-offset, offset);
  }
  let attempts = 0;
  for (
    let distance =
      REGION_CARD_CAMERA_CONVERGENCE.connectorSearchStepPx;
    distance <=
    REGION_CARD_CAMERA_CONVERGENCE.connectorMaximumCardAdjustmentPx;
    distance +=
    REGION_CARD_CAMERA_CONVERGENCE.connectorSearchStepPx
  ) {
    const safeAtDistance: Array<{
      callout: RegionSplitCalloutLayout;
      connector: RegionDepthOccludedLeaderGeometry;
      x: number;
      y: number;
    }> = [];
    for (const shiftY of verticalOffsets) {
      attempts += 1;
      const shiftX = -distance;
      const finalCardRect = {
        left: callout.finalCardRect.left + shiftX,
        top: callout.finalCardRect.top + shiftY,
        right: callout.finalCardRect.right + shiftX,
        bottom: callout.finalCardRect.bottom + shiftY,
      };
      const cardViewport =
        finalCardRect.left >= REGION_INFO_LEADER.screenSafeInsetPx &&
        finalCardRect.top >= REGION_INFO_LEADER.screenSafeInsetPx &&
        finalCardRect.right <=
          viewportWidth - REGION_INFO_LEADER.screenSafeInsetPx &&
        finalCardRect.bottom <=
          viewportHeight - REGION_INFO_LEADER.screenSafeInsetPx;
      if (
        !cardViewport ||
        exclusions.all.some((rect) =>
          screenRectsOverlap(finalCardRect, rect),
        )
      ) {
        continue;
      }
      const clearance = evaluateRegionHullCardClearance(
        callout.silhouetteHull,
        finalCardRect,
        minimumClearancePx,
      );
      if (!clearance.safe) continue;
      const cardJunctionPoint = {
        x: callout.cardJunctionPoint.x + shiftX,
        y: callout.cardJunctionPoint.y + shiftY,
      };
      const closest = closestPointOnRegionHull(
        cardJunctionPoint,
        callout.silhouetteHull,
      );
      const candidate: RegionSplitCalloutLayout = {
        ...callout,
        finalCardRect,
        cardShiftX: callout.cardShiftX + shiftX,
        cardShiftY: callout.cardShiftY + shiftY,
        cardJunctionPoint,
        hullClosestPoint: closest.point,
        outwardNormal: closest.normal,
        fullGapPx: closest.distance,
        distanceToHullPx: closest.distance,
        cardHullClearancePx: clearance.clearancePx,
        requiredCardHullClearancePx: minimumClearancePx,
        cardHullOverlap: clearance.overlap,
        cardCornerInside: clearance.cardCornerInside,
        cardHullVertexInside: clearance.hullVertexInside,
        cardEdgeIntersection: clearance.edgeIntersection,
        solverStatus: "gap-bound-clamped",
        solutionHash: [
          callout.solutionHash,
          "connector-cap",
          shiftX.toFixed(2),
          shiftY.toFixed(2),
          closest.point.x.toFixed(2),
          closest.point.y.toFixed(2),
        ].join(":"),
      };
      const connector = buildConnector(candidate);
      if (connectorSafe(connector)) {
        safeAtDistance.push({
          callout: candidate,
          connector,
          x: shiftX,
          y: shiftY,
        });
      }
    }
    const selected = safeAtDistance.sort(
      (first, second) =>
        Math.abs(first.y) - Math.abs(second.y) ||
        second.callout.cardHullClearancePx -
          first.callout.cardHullClearancePx,
    )[0];
    if (selected) {
      return {
        callout: selected.callout,
        connector: selected.connector,
        baselineConnector,
        adjustment: {
          x: selected.x,
          y: selected.y,
          attempts,
        },
      };
    }
  }
  return {
    callout,
    connector: baselineConnector,
    baselineConnector,
    adjustment: { x: 0, y: 0, attempts },
  };
}

export function solveNavigatorCardCameraLayout({
  viewportWidth,
  viewportHeight,
  baseLeftInsetPx,
  appliedLeftInsetPx,
  appliedRightInsetPx,
  silhouette,
  markerCenter,
  detachedInternal,
  selectedRegionId,
  anchorSource,
  cardSize,
}: {
  viewportWidth: number;
  viewportHeight: number;
  baseLeftInsetPx: number;
  appliedLeftInsetPx: number;
  appliedRightInsetPx: number;
  silhouette: RegionLeaderSilhouette;
  markerCenter: RegionLeaderPoint;
  detachedInternal: boolean;
  selectedRegionId: RegionId;
  anchorSource: "selected-contour" | "selected-support";
  cardSize?: Readonly<{ width: number; height: number }>;
}): NavigatorCardCameraLayout {
  const card = getRegionInfoCardLayout(viewportWidth, viewportHeight);
  const measuredCardWidth =
    cardSize &&
    Number.isFinite(cardSize.width) &&
    cardSize.width > 0
      ? Math.min(viewportWidth, cardSize.width)
      : card.width;
  const measuredCardReservedRightPx =
    card.right + measuredCardWidth + card.anatomyGapPx;
  const navigator = getRegionNavigatorLayout(
    viewportWidth,
    viewportHeight,
  );
  const exclusions = getBrainUiExclusionRects(
    viewportWidth,
    viewportHeight,
  );
  const navigatorActive =
    navigator.visible && baseLeftInsetPx > 0;
  const navigatorContext: RegionNavigatorCardLayoutContext = {
    active: navigatorActive,
    navigatorRect: exclusions.navigator,
    uiExclusionRects: exclusions.all,
    minimumCardTopPx: exclusions.statusSafeBottomPx,
  };
  const initialCallout = solveRegionSplitCallout({
    viewportWidth,
    viewportHeight,
    silhouette,
    detachedInternal,
    anchorPoint: markerCenter,
    selectedRegionId,
    anchorSource,
    cameraReservedRightPx: appliedRightInsetPx,
    navigatorContext,
    cardSize,
  });
  const fitted = fitRegionCalloutToConnectorCap({
    callout: initialCallout,
    markerCenter,
    viewportWidth,
    viewportHeight,
    detachedInternal,
    navigatorActive,
    exclusions,
    highResidualFallback:
      anchorSource === "selected-support" &&
      selectedRegionId === "frontal-lobe",
  });
  const { callout, connector } = fitted;
  const clearance = evaluateRegionHullCardClearance(
    silhouette.hull,
    callout.finalCardRect,
    REGION_CARD_CAMERA_CONVERGENCE.minimumCardHullClearancePx,
  );
  const navigatorRight = navigator.left + navigator.width;
  const measuredNavigatorGapPx = navigatorActive
    ? silhouette.bounds.left - navigatorRight
    : Number.POSITIVE_INFINITY;
  const navigatorCorrectionPx =
    navigatorActive &&
    measuredNavigatorGapPx <
      REGION_CARD_CAMERA_CONVERGENCE.requiredNavigatorGapPx
      ? REGION_CARD_CAMERA_CONVERGENCE.requiredNavigatorGapPx -
        measuredNavigatorGapPx +
        REGION_CARD_CAMERA_CONVERGENCE.insetHysteresisPx
      : 0;
  const requestedLeftInsetPx = navigatorActive
    ? Math.ceil(
        Math.max(
          baseLeftInsetPx,
          appliedLeftInsetPx + navigatorCorrectionPx,
        ),
      )
    : baseLeftInsetPx;
  const approachPx = navigatorActive
    ? clamp(
        0,
        (viewportWidth -
          REGION_CARD_CAMERA_CONVERGENCE
            .navigatorApproachStartWidthPx) *
          REGION_CARD_CAMERA_CONVERGENCE.navigatorApproachRate,
        REGION_CARD_CAMERA_CONVERGENCE.navigatorMaximumApproachPx,
      )
    : 0;
  const rightInsetFloorPx = navigatorActive
    ? Math.ceil(
        measuredCardReservedRightPx +
          approachPx +
          Math.max(
            0,
            initialCallout.requiredCardHullClearancePx +
              REGION_CARD_CAMERA_CONVERGENCE.neutralBorderPx -
              card.anatomyGapPx,
          ),
      )
    : measuredCardReservedRightPx;
  const requestedRightInsetPx = navigatorActive
    ? Math.max(
        rightInsetFloorPx,
        getRequiredRegionCardCameraInset({
          viewportWidth,
          cardLeft: callout.finalCardRect.left,
          cardHullGapPx:
            initialCallout.requiredCardHullClearancePx,
        }),
      )
    : measuredCardReservedRightPx;
  const cardViewport =
    callout.finalCardRect.left >=
      REGION_INFO_LEADER.screenSafeInsetPx &&
    callout.finalCardRect.top >=
      REGION_INFO_LEADER.screenSafeInsetPx &&
    callout.finalCardRect.right <=
      viewportWidth - REGION_INFO_LEADER.screenSafeInsetPx &&
    callout.finalCardRect.bottom <=
      viewportHeight - REGION_INFO_LEADER.screenSafeInsetPx;
  const titleExclusion = !screenRectsOverlap(
    callout.finalCardRect,
    exclusions.title,
  );
  const statusExclusion = !screenRectsOverlap(
    callout.finalCardRect,
    exclusions.status,
  );
  const taglineExclusion = !screenRectsOverlap(
    callout.finalCardRect,
    exclusions.tagline,
  );
  const navigatorExclusion =
    !exclusions.navigator ||
    !screenRectsOverlap(
      callout.finalCardRect,
      exclusions.navigator,
    );
  const topMarginPx = silhouette.bounds.top;
  const bottomMarginPx =
    viewportHeight - silhouette.bounds.bottom;
  const maximumConnectorLength = detachedInternal
    ? REGION_INFO_LEADER.connectorInternalMaximumPx
    : viewportWidth >= 1200
      ? REGION_INFO_LEADER.connectorDesktopMaximumPx
      : REGION_INFO_LEADER.connectorTabletMaximumPx;
  const safety: NavigatorCardCameraSafetyVector = {
    cardHullClearance:
      clearance.clearancePx + 0.001 >=
      REGION_CARD_CAMERA_CONVERGENCE.minimumCardHullClearancePx,
    cardIntersectionFree:
      !clearance.overlap &&
      !clearance.cardCornerInside &&
      !clearance.hullVertexInside &&
      !clearance.edgeIntersection,
    navigatorGap:
      !navigatorActive ||
      measuredNavigatorGapPx + 0.001 >=
        REGION_CARD_CAMERA_CONVERGENCE.requiredNavigatorGapPx,
    topMargin:
      topMarginPx + 0.001 >=
      REGION_CARD_CAMERA_CONVERGENCE.minimumTopBottomMarginPx,
    bottomMargin:
      bottomMarginPx + 0.001 >=
      REGION_CARD_CAMERA_CONVERGENCE.minimumTopBottomMarginPx,
    connectorVisible: connector.visible,
    connectorWithinCap:
      connector.visibleOutsideLengthPx <=
      maximumConnectorLength + 0.001,
    connectorIntersectionFree:
      !connector.anatomyIntersection &&
      !connector.uiIntersection,
    connectorEndpointGaps:
      connector.cardGapPx + 0.001 >=
        REGION_INFO_LEADER.connectorCardGapPx &&
      connector.finalHullExit !== null,
    cardViewport,
    titleExclusion,
    statusExclusion,
    taglineExclusion,
    navigatorExclusion,
  };
  const uiCollisions = [
    !titleExclusion ? "title" : null,
    !statusExclusion ? "status" : null,
    !taglineExclusion ? "tagline" : null,
    !navigatorExclusion ? "navigator" : null,
    !cardViewport ? "viewport" : null,
  ].filter((value): value is string => value !== null);
  return {
    callout,
    connector,
    requestedLeftInsetPx,
    requestedRightInsetPx,
    baseLeftInsetPx,
    baseRightInsetPx: measuredCardReservedRightPx,
    measuredNavigatorGapPx,
    topMarginPx,
    bottomMarginPx,
    rightInsetFloorPx,
    initialConnectorOutsideLengthPx:
      fitted.baselineConnector.visibleOutsideLengthPx,
    initialCardHullClearancePx:
      initialCallout.cardHullClearancePx,
    connectorCardAdjustment: fitted.adjustment,
    safety,
    safe: Object.values(safety).every(Boolean),
    uiCollisions,
  };
}

export type RegionSplitConnectorGeometry = {
  visible: boolean;
  reason: "visible" | "viewport-hidden" | "gap-cap-unavailable";
  path: string;
  lengthPx: number;
  chordLengthPx: number;
  curveLengthPx: number;
  segmentCount: 0 | 1;
  elbows: 0;
  inflections: 0;
  curveDeviationPx: number;
  fullGapPx: number;
  distanceToHullPx: number;
  curveClearancePx: number;
  cardBorderGapPx: number;
  silhouetteGapPx: number;
  start: RegionLeaderPoint | null;
  end: RegionLeaderPoint | null;
  control1: RegionLeaderPoint | null;
  control2: RegionLeaderPoint | null;
  cardJunctionPoint: RegionLeaderPoint;
  hullClosestPoint: RegionLeaderPoint;
  outwardNormal: RegionLeaderPoint;
  anatomyIntersection: boolean;
  uiIntersection: boolean;
};

function buildRegionSplitConnectorGeometry({
  viewportWidth,
  hull,
  hullClosestPoint,
  outwardNormal,
  cardJunctionPoint,
  cardRect,
  detachedInternal,
}: {
  viewportWidth: number;
  hull: readonly RegionLeaderPoint[];
  hullClosestPoint: RegionLeaderPoint;
  outwardNormal: RegionLeaderPoint;
  cardJunctionPoint: RegionLeaderPoint;
  cardRect: RegionLeaderScreenRect;
  detachedInternal: boolean;
}): RegionSplitConnectorGeometry {
  const fullGapPx = Math.hypot(
    cardJunctionPoint.x - hullClosestPoint.x,
    cardJunctionPoint.y - hullClosestPoint.y,
  );
  const unavailable = (
    reason: "viewport-hidden" | "gap-cap-unavailable",
    anatomyIntersection = false,
    uiIntersection = false,
  ): RegionSplitConnectorGeometry => ({
    visible: false,
    reason,
    path: "",
    lengthPx: 0,
    chordLengthPx: 0,
    curveLengthPx: 0,
    segmentCount: 0,
    elbows: 0,
    inflections: 0,
    curveDeviationPx: 0,
    fullGapPx,
    distanceToHullPx: fullGapPx,
    curveClearancePx: 0,
    cardBorderGapPx: REGION_INFO_LEADER.connectorCardGapPx,
    silhouetteGapPx: detachedInternal
      ? REGION_INFO_LEADER.connectorInternalSilhouetteGapPx
      : REGION_INFO_LEADER.connectorExternalSilhouetteGapPx,
    start: null,
    end: null,
    control1: null,
    control2: null,
    cardJunctionPoint,
    hullClosestPoint,
    outwardNormal,
    anatomyIntersection,
    uiIntersection,
  });
  if (viewportWidth < REGION_INFO_LEADER.connectorMinimumViewportWidthPx) {
    return unavailable("viewport-hidden");
  }
  const silhouetteGapPx = detachedInternal
    ? REGION_INFO_LEADER.connectorInternalSilhouetteGapPx
    : REGION_INFO_LEADER.connectorExternalSilhouetteGapPx;
  if (
    fullGapPx <=
    silhouetteGapPx + REGION_INFO_LEADER.connectorCardGapPx
  ) {
    return unavailable("gap-cap-unavailable");
  }
  const contactDirection = {
    x: (cardJunctionPoint.x - hullClosestPoint.x) / fullGapPx,
    y: (cardJunctionPoint.y - hullClosestPoint.y) / fullGapPx,
  };
  const normalAlignment =
    contactDirection.x * outwardNormal.x +
    contactDirection.y * outwardNormal.y;
  if (contactDirection.x <= 0 || normalAlignment <= 0.04) {
    return unavailable("gap-cap-unavailable", true, false);
  }
  const start = {
    x: hullClosestPoint.x + contactDirection.x * silhouetteGapPx,
    y: hullClosestPoint.y + contactDirection.y * silhouetteGapPx,
  };
  const end = {
    x:
      cardJunctionPoint.x -
      contactDirection.x * REGION_INFO_LEADER.connectorCardGapPx,
    y:
      cardJunctionPoint.y -
      contactDirection.y * REGION_INFO_LEADER.connectorCardGapPx,
  };
  const chordLength = Math.hypot(end.x - start.x, end.y - start.y);
  const maximumLength = detachedInternal
    ? REGION_INFO_LEADER.connectorInternalMaximumPx
    : viewportWidth >= 1200
      ? REGION_INFO_LEADER.connectorDesktopMaximumPx
      : REGION_INFO_LEADER.connectorTabletMaximumPx;
  if (chordLength > maximumLength) {
    return unavailable("gap-cap-unavailable");
  }
  const offset = Math.min(
    REGION_INFO_LEADER.connectorMaximumDeviationPx / 0.75,
    Math.max(2, chordLength * 0.06),
  );
  const convexNormal = {
    x: -contactDirection.y,
    y: contactDirection.x,
  };
  const curveDeviationPx = offset * 0.75;
  const curveCandidates = [-1, 1].map((direction) => {
    const control1 = {
      x:
        start.x +
        (end.x - start.x) / 3 +
        convexNormal.x * offset * direction,
      y:
        start.y +
        (end.y - start.y) / 3 +
        convexNormal.y * offset * direction,
    };
    const control2 = {
      x:
        start.x +
        ((end.x - start.x) * 2) / 3 +
        convexNormal.x * offset * direction,
      y:
        start.y +
        ((end.y - start.y) * 2) / 3 +
        convexNormal.y * offset * direction,
    };
    let curveLengthPx = 0;
    let curveClearancePx = Number.POSITIVE_INFINITY;
    let anatomyIntersection = false;
    let uiIntersection = false;
    let previousPoint = start;
    for (let index = 0; index <= 32; index += 1) {
      const progress = index / 32;
      const inverse = 1 - progress;
      const point = {
        x:
          inverse ** 3 * start.x +
          3 * inverse ** 2 * progress * control1.x +
          3 * inverse * progress ** 2 * control2.x +
          progress ** 3 * end.x,
        y:
          inverse ** 3 * start.y +
          3 * inverse ** 2 * progress * control1.y +
          3 * inverse * progress ** 2 * control2.y +
          progress ** 3 * end.y,
      };
      if (index > 0) {
        curveLengthPx += Math.hypot(
          point.x - previousPoint.x,
          point.y - previousPoint.y,
        );
      }
      previousPoint = point;
      curveClearancePx = Math.min(
        curveClearancePx,
        closestPointOnRegionHull(point, hull).distance,
      );
      anatomyIntersection ||= pointInsideRegionHull(point, hull);
      uiIntersection ||= pointInsideRect(point, cardRect);
    }
    return {
      control1,
      control2,
      curveLengthPx,
      curveClearancePx,
      anatomyIntersection,
      uiIntersection,
    };
  });
  const curve = curveCandidates
    .filter(
      (candidate) =>
        !candidate.anatomyIntersection &&
        !candidate.uiIntersection &&
        candidate.curveLengthPx <= maximumLength,
    )
    .sort(
      (first, second) =>
        second.curveClearancePx - first.curveClearancePx ||
        first.curveLengthPx - second.curveLengthPx,
    )[0];
  if (!curve) {
    return unavailable(
      "gap-cap-unavailable",
      curveCandidates.every((candidate) => candidate.anatomyIntersection),
      curveCandidates.every((candidate) => candidate.uiIntersection),
    );
  }
  const value = (number: number) => Number(number.toFixed(2));
  return {
    visible: true,
    reason: "visible",
    path: `M ${value(start.x)} ${value(start.y)} C ${value(
      curve.control1.x,
    )} ${value(curve.control1.y)}, ${value(curve.control2.x)} ${value(
      curve.control2.y,
    )}, ${value(end.x)} ${value(end.y)}`,
    lengthPx: curve.curveLengthPx,
    chordLengthPx: chordLength,
    curveLengthPx: curve.curveLengthPx,
    segmentCount: 1,
    elbows: 0,
    inflections: 0,
    curveDeviationPx,
    fullGapPx,
    distanceToHullPx: fullGapPx,
    curveClearancePx: curve.curveClearancePx,
    cardBorderGapPx: REGION_INFO_LEADER.connectorCardGapPx,
    silhouetteGapPx,
    start,
    end,
    control1: curve.control1,
    control2: curve.control2,
    cardJunctionPoint,
    hullClosestPoint,
    outwardNormal,
    anatomyIntersection: false,
    uiIntersection: false,
  };
}

export function getRegionSplitTransitionConnector(
  solution: RegionSplitCalloutLayout,
  currentCardRect: RegionLeaderScreenRect,
  viewportWidth: number,
  detachedInternal: boolean,
) {
  const currentCardJunctionPoint = {
    x: currentCardRect.left,
    y:
      currentCardRect.top +
      (solution.cardJunctionPoint.y - solution.finalCardRect.top),
  };
  return buildRegionSplitConnectorGeometry({
    viewportWidth,
    hull: solution.silhouetteHull,
    hullClosestPoint: solution.hullClosestPoint,
    outwardNormal: solution.outwardNormal,
    cardJunctionPoint: currentCardJunctionPoint,
    cardRect: currentCardRect,
    detachedInternal,
  });
}

export type RegionDepthOccludedLeaderGeometry = {
  visible: boolean;
  reason:
    | "visible"
    | "viewport-hidden"
    | "outside-cap-unavailable";
  fullPath: string;
  outsidePath: string;
  underTissuePath: string;
  stemPath: string;
  pathStart: RegionLeaderPoint;
  markerCenter: RegionLeaderPoint;
  anchorErrorPx: number;
  cardEndpoint: RegionLeaderPoint;
  control1: RegionLeaderPoint;
  control2: RegionLeaderPoint;
  fullCurveLengthPx: number;
  stemLengthPx: number;
  stemTangent: RegionLeaderPoint;
  finalHullExit: RegionLeaderPoint | null;
  finalExitT: number | null;
  visibleOutsideLengthPx: number;
  outsideCapPx: number;
  underTissueLengthPx: number;
  underTissueOpacity: number;
  underTissueVisible: boolean;
  splitTangentError: number;
  suppressionReason: "none" | "viewport-hidden" | "outside-cap-unavailable";
  cardGapPx: number;
  maskExpansionPx: number;
  anatomyInkLengthPx: number;
  curveDeviationPx: number;
  segmentCount: 1;
  elbows: 0;
  inflections: 0;
  anatomyIntersection: boolean;
  uiIntersection: boolean;
  samePathIdentity: true;
};

function interpolatePoint(
  first: RegionLeaderPoint,
  second: RegionLeaderPoint,
  progress: number,
) {
  return {
    x: first.x + (second.x - first.x) * progress,
    y: first.y + (second.y - first.y) * progress,
  };
}

function evaluateCubic(
  start: RegionLeaderPoint,
  control1: RegionLeaderPoint,
  control2: RegionLeaderPoint,
  end: RegionLeaderPoint,
  progress: number,
) {
  const inverse = 1 - progress;
  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * progress * control1.x +
      3 * inverse * progress ** 2 * control2.x +
      progress ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * progress * control1.y +
      3 * inverse * progress ** 2 * control2.y +
      progress ** 3 * end.y,
  };
}

function approximateCubicLength(
  start: RegionLeaderPoint,
  control1: RegionLeaderPoint,
  control2: RegionLeaderPoint,
  end: RegionLeaderPoint,
  from = 0,
  to = 1,
  steps = 48,
) {
  let length = 0;
  let previous = evaluateCubic(
    start,
    control1,
    control2,
    end,
    from,
  );
  for (let index = 1; index <= steps; index += 1) {
    const point = evaluateCubic(
      start,
      control1,
      control2,
      end,
      from + ((to - from) * index) / steps,
    );
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return length;
}

function createCubicPath(
  start: RegionLeaderPoint,
  control1: RegionLeaderPoint,
  control2: RegionLeaderPoint,
  end: RegionLeaderPoint,
) {
  const value = (number: number) => Number(number.toFixed(2));
  return `M ${value(start.x)} ${value(start.y)} C ${value(
    control1.x,
  )} ${value(control1.y)}, ${value(control2.x)} ${value(
    control2.y,
  )}, ${value(end.x)} ${value(end.y)}`;
}

function splitCubic(
  start: RegionLeaderPoint,
  control1: RegionLeaderPoint,
  control2: RegionLeaderPoint,
  end: RegionLeaderPoint,
  progress: number,
) {
  const first = interpolatePoint(start, control1, progress);
  const second = interpolatePoint(control1, control2, progress);
  const third = interpolatePoint(control2, end, progress);
  const firstMidpoint = interpolatePoint(first, second, progress);
  const secondMidpoint = interpolatePoint(second, third, progress);
  const split = interpolatePoint(firstMidpoint, secondMidpoint, progress);
  return {
    left: [start, first, firstMidpoint, split] as const,
    right: [split, secondMidpoint, third, end] as const,
  };
}

function findFinalCubicHullExit({
  start,
  control1,
  control2,
  end,
  isOccluded,
}: {
  start: RegionLeaderPoint;
  control1: RegionLeaderPoint;
  control2: RegionLeaderPoint;
  end: RegionLeaderPoint;
  isOccluded: (point: RegionLeaderPoint) => boolean;
}) {
  const samples: { progress: number; point: RegionLeaderPoint }[] = [
    { progress: 0, point: start },
  ];
  const visit = (
    first: RegionLeaderPoint,
    firstControl: RegionLeaderPoint,
    secondControl: RegionLeaderPoint,
    last: RegionLeaderPoint,
    from: number,
    to: number,
    depth: number,
  ) => {
    const chordLength = Math.hypot(last.x - first.x, last.y - first.y);
    const controlDeviation = Math.max(
      pointToSegmentDistance(firstControl, first, last),
      pointToSegmentDistance(secondControl, first, last),
    );
    if (
      depth >= 14 ||
      (chordLength <= 1.5 && controlDeviation <= 0.2)
    ) {
      samples.push({ progress: to, point: last });
      return;
    }
    const split = splitCubic(
      first,
      firstControl,
      secondControl,
      last,
      0.5,
    );
    const middle = (from + to) / 2;
    visit(...split.left, from, middle, depth + 1);
    visit(...split.right, middle, to, depth + 1);
  };
  visit(start, control1, control2, end, 0, 1, 0);

  let lastInsideIndex = -1;
  for (let index = 0; index < samples.length; index += 1) {
    if (isOccluded(samples[index].point)) lastInsideIndex = index;
  }
  if (
    lastInsideIndex < 0 ||
    lastInsideIndex >= samples.length - 1 ||
    isOccluded(end)
  ) {
    return null;
  }
  let lower = samples[lastInsideIndex].progress;
  let upper = samples[lastInsideIndex + 1].progress;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (
      isOccluded(
        evaluateCubic(start, control1, control2, end, middle),
      )
    ) {
      lower = middle;
    } else {
      upper = middle;
    }
  }
  return upper;
}

export function buildRegionDepthOccludedLeader({
  solution,
  currentCardRect,
  markerCenter,
  viewportWidth,
  viewportHeight,
  detachedInternal,
  highResidualFallback = false,
}: {
  solution: RegionSplitCalloutLayout;
  currentCardRect: RegionLeaderScreenRect;
  markerCenter: RegionLeaderPoint;
  viewportWidth: number;
  viewportHeight: number;
  detachedInternal: boolean;
  highResidualFallback?: boolean;
}): RegionDepthOccludedLeaderGeometry {
  const cardJunctionY =
    currentCardRect.top +
    (solution.cardJunctionPoint.y - solution.finalCardRect.top);
  const cardEndpoint = {
    x: currentCardRect.left - REGION_INFO_LEADER.connectorCardGapPx,
    y: cardJunctionY,
  };
  const dx = cardEndpoint.x - markerCenter.x;
  const dy = cardEndpoint.y - markerCenter.y;
  const chordLength = Math.max(Number.EPSILON, Math.hypot(dx, dy));
  const chordDirection = { x: dx / chordLength, y: dy / chordLength };
  const curveNormal = { x: -chordDirection.y, y: chordDirection.x };
  const offset = Math.min(
    REGION_INFO_LEADER.connectorMaximumDeviationPx / 0.75,
    Math.max(2, chordLength * 0.025),
  );
  const maximumOutsideLength = detachedInternal
    ? REGION_INFO_LEADER.connectorInternalMaximumPx
    : viewportWidth >= 1200
      ? REGION_INFO_LEADER.connectorDesktopMaximumPx
      : REGION_INFO_LEADER.connectorTabletMaximumPx;
  const isOccluded = (point: RegionLeaderPoint) =>
    pointInsideRegionHull(point, solution.silhouetteHull) ||
    closestPointOnRegionHull(point, solution.silhouetteHull).distance <=
      REGION_INFO_LEADER.maskExpansionPx;
  const uiRects: RegionLeaderScreenRect[] = [
    {
      left: 0,
      top: 0,
      right: Math.min(430, viewportWidth * 0.44),
      bottom: 130,
    },
    {
      left: Math.max(0, viewportWidth - 470),
      top: 0,
      right: viewportWidth,
      bottom: 105,
    },
    {
      left: 0,
      top: Math.max(0, viewportHeight - 110),
      right: Math.min(430, viewportWidth * 0.44),
      bottom: viewportHeight,
    },
  ];
  const candidates = [-1, 1].map((curveDirection) => {
    const control1 = {
      x:
        markerCenter.x +
        dx / 3 +
        curveNormal.x * offset * curveDirection,
      y:
        markerCenter.y +
        dy / 3 +
        curveNormal.y * offset * curveDirection,
    };
    const control2 = {
      x:
        markerCenter.x +
        (dx * 2) / 3 +
        curveNormal.x * offset * curveDirection,
      y:
        markerCenter.y +
        (dy * 2) / 3 +
        curveNormal.y * offset * curveDirection,
    };
    const fullCurveLengthPx = approximateCubicLength(
      markerCenter,
      control1,
      control2,
      cardEndpoint,
    );
    const exitProgress = findFinalCubicHullExit({
      start: markerCenter,
      control1,
      control2,
      end: cardEndpoint,
      isOccluded,
    });
    const split =
      exitProgress === null
        ? null
        : splitCubic(
            markerCenter,
            control1,
            control2,
            cardEndpoint,
            exitProgress,
          );
    const finalHullExit = split?.left[3] ?? null;
    const visibleOutsideLengthPx = split
      ? approximateCubicLength(...split.right, 0, 1, 32)
      : 0;
    const underTissueLengthPx = split
      ? approximateCubicLength(...split.left, 0, 1, 64)
      : 0;
    let anatomyIntersection = false;
    let uiIntersection = false;
    if (finalHullExit && exitProgress !== null) {
      for (let index = 1; index <= 32; index += 1) {
        const point = evaluateCubic(
          markerCenter,
          control1,
          control2,
          cardEndpoint,
          exitProgress + ((1 - exitProgress) * index) / 32,
        );
        anatomyIntersection ||= isOccluded(point);
        uiIntersection ||=
          pointInsideRect(point, currentCardRect) ||
          uiRects.some((rect) => pointInsideRect(point, rect));
      }
    }
    return {
      control1,
      control2,
      fullCurveLengthPx,
      exitProgress,
      split,
      finalHullExit,
      visibleOutsideLengthPx,
      underTissueLengthPx,
      anatomyIntersection,
      uiIntersection,
    };
  });
  const selected =
    candidates
      .filter(
        (candidate) =>
          candidate.finalHullExit &&
          !candidate.anatomyIntersection &&
          !candidate.uiIntersection,
      )
      .sort(
        (first, second) =>
          (first.visibleOutsideLengthPx <= maximumOutsideLength ? 0 : 1) -
            (second.visibleOutsideLengthPx <= maximumOutsideLength ? 0 : 1) ||
          first.visibleOutsideLengthPx - second.visibleOutsideLengthPx ||
          first.control1.y - second.control1.y,
      )[0] ?? candidates[0];
  let stemProgress = Math.min(
    1,
    REGION_INFO_LEADER.stemLengthPx /
      Math.max(selected.fullCurveLengthPx, Number.EPSILON),
  );
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const length = approximateCubicLength(
      markerCenter,
      selected.control1,
      selected.control2,
      cardEndpoint,
      0,
      stemProgress,
      16,
    );
    stemProgress = clamp(
      0,
      stemProgress *
        (REGION_INFO_LEADER.stemLengthPx /
          Math.max(length, Number.EPSILON)),
      1,
    );
  }
  const firstSplit = interpolatePoint(
    markerCenter,
    selected.control1,
    stemProgress,
  );
  const secondSplit = interpolatePoint(
    selected.control1,
    selected.control2,
    stemProgress,
  );
  const thirdSplit = interpolatePoint(
    selected.control2,
    cardEndpoint,
    stemProgress,
  );
  const firstMidpoint = interpolatePoint(
    firstSplit,
    secondSplit,
    stemProgress,
  );
  const secondMidpoint = interpolatePoint(
    secondSplit,
    thirdSplit,
    stemProgress,
  );
  const stemEnd = interpolatePoint(
    firstMidpoint,
    secondMidpoint,
    stemProgress,
  );
  const stemLengthPx = approximateCubicLength(
    markerCenter,
    firstSplit,
    firstMidpoint,
    stemEnd,
    0,
    1,
    16,
  );
  const tangentLength = Math.max(
    Number.EPSILON,
    Math.hypot(
      selected.control1.x - markerCenter.x,
      selected.control1.y - markerCenter.y,
    ),
  );
  const curveDeviationPx = offset * 0.75;
  const viewportHidden =
    viewportWidth < REGION_INFO_LEADER.connectorMinimumViewportWidthPx;
  const geometryVisible =
    !viewportHidden &&
    selected.finalHullExit !== null &&
    !selected.anatomyIntersection &&
    !selected.uiIntersection &&
    selected.visibleOutsideLengthPx <= maximumOutsideLength;
  const residualOccludedGapPx = Math.max(
    0,
    selected.underTissueLengthPx - stemLengthPx,
  );
  const underTissueVisible =
    !viewportHidden &&
    selected.finalHullExit !== null &&
    (detachedInternal || highResidualFallback) &&
    residualOccludedGapPx > (detachedInternal ? 8 : 32);
  const suppressionReason = viewportHidden
    ? ("viewport-hidden" as const)
    : geometryVisible
      ? ("none" as const)
      : ("outside-cap-unavailable" as const);
  return {
    visible: geometryVisible,
    reason: viewportHidden
      ? "viewport-hidden"
      : geometryVisible
        ? "visible"
        : "outside-cap-unavailable",
    fullPath: createCubicPath(
      markerCenter,
      selected.control1,
      selected.control2,
      cardEndpoint,
    ),
    outsidePath: selected.split
      ? createCubicPath(...selected.split.right)
      : "",
    underTissuePath: selected.split
      ? createCubicPath(...selected.split.left)
      : "",
    stemPath: createCubicPath(
      markerCenter,
      firstSplit,
      firstMidpoint,
      stemEnd,
    ),
    pathStart: { ...markerCenter },
    markerCenter: { ...markerCenter },
    anchorErrorPx: 0,
    cardEndpoint,
    control1: selected.control1,
    control2: selected.control2,
    fullCurveLengthPx: selected.fullCurveLengthPx,
    stemLengthPx,
    stemTangent: {
      x: (selected.control1.x - markerCenter.x) / tangentLength,
      y: (selected.control1.y - markerCenter.y) / tangentLength,
    },
    finalHullExit: selected.finalHullExit,
    finalExitT: selected.exitProgress,
    visibleOutsideLengthPx: selected.visibleOutsideLengthPx,
    outsideCapPx: maximumOutsideLength,
    underTissueLengthPx: selected.underTissueLengthPx,
    underTissueOpacity: detachedInternal ? 0.18 : 0.1,
    underTissueVisible,
    splitTangentError: 0,
    suppressionReason,
    cardGapPx: REGION_INFO_LEADER.connectorCardGapPx,
    maskExpansionPx: REGION_INFO_LEADER.maskExpansionPx,
    anatomyInkLengthPx: underTissueVisible
      ? selected.underTissueLengthPx
      : 0,
    curveDeviationPx,
    segmentCount: 1,
    elbows: 0,
    inflections: 0,
    anatomyIntersection: selected.anatomyIntersection,
    uiIntersection: selected.uiIntersection,
    samePathIdentity: true,
  };
}
