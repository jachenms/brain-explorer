import type { RegionId } from "./brain-regions";

export const ENCLOSED_REGION_IDS = new Set<RegionId>([
  "hippocampus",
  "amygdala",
  "corpus-callosum",
]);
export const ENCLOSED_PROXY_RAYCAST_SCALE = 1.25;
export const INTERNAL_XRAY_SHELL_OPACITY = 1;
export const INTERNAL_XRAY_TISSUE_OPACITY = 0.78;
export const INTERACTION_BLOOM = {
  intensity: 0.08,
  luminanceThreshold: 1.6,
  luminanceSmoothing: 0.05,
  radius: 0.25,
} as const;
export type RegionIntersectionCandidate = {
  distance: number;
  regionId: RegionId | null;
  hitProxy: boolean;
  visible: boolean;
};

export type RegionIntersectionReader<T> = {
  getDistance: (intersection: T) => number;
  getRegionId: (intersection: T) => RegionId | null;
  isHitProxy: (intersection: T) => boolean;
  isVisible: (intersection: T) => boolean;
};

export const REGION_INTERSECTION_CANDIDATE_READER: RegionIntersectionReader<RegionIntersectionCandidate> =
  {
    getDistance: (intersection) => intersection.distance,
    getRegionId: (intersection) => intersection.regionId,
    isHitProxy: (intersection) => intersection.hitProxy,
    isVisible: (intersection) => intersection.visible,
  };

export function resolveRegionIntersection<T>(
  intersections: readonly T[],
  reader: RegionIntersectionReader<T>,
): RegionId | null {
  let nearestEnclosedProxyId: RegionId | null = null;
  let nearestEnclosedProxyDistance = Number.POSITIVE_INFINITY;
  let nearestVisibleId: RegionId | null = null;
  let nearestVisibleDistance = Number.POSITIVE_INFINITY;

  for (const intersection of intersections) {
    const regionId = reader.getRegionId(intersection);
    const distance = reader.getDistance(intersection);
    if (
      !regionId ||
      !Number.isFinite(distance) ||
      distance < 0
    ) {
      continue;
    }

    if (
      reader.isHitProxy(intersection) &&
      ENCLOSED_REGION_IDS.has(regionId)
    ) {
      if (distance < nearestEnclosedProxyDistance) {
        nearestEnclosedProxyId = regionId;
        nearestEnclosedProxyDistance = distance;
      }
      continue;
    }

    if (
      reader.isVisible(intersection) &&
      !reader.isHitProxy(intersection) &&
      distance < nearestVisibleDistance
    ) {
      nearestVisibleId = regionId;
      nearestVisibleDistance = distance;
    }
  }

  return nearestEnclosedProxyId ?? nearestVisibleId;
}

export type Point2Tuple = readonly [number, number];

export function getProjectedBounds(points: readonly Point2Tuple[]) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return Number.isFinite(minX)
    ? { min: [minX, minY] as Point2Tuple, max: [maxX, maxY] as Point2Tuple }
    : null;
}

export function ndcPointToScreen(
  point: Point2Tuple,
  width: number,
  height: number,
): Point2Tuple {
  return [
    ((point[0] + 1) * width) / 2,
    ((1 - point[1]) * height) / 2,
  ];
}

export type RegionVisualState =
  | "idle"
  | "context"
  | "hovered"
  | "selected";

export type RegionVisualTarget = {
  colorMix: number;
  emissiveIntensity: number;
  roughnessOffset: number;
  clearcoatOffset: number;
  selectedRimIntensity: number;
  contextRecession: number;
};

const SEMANTIC_WASH_MEMBERS: Readonly<
  Record<RegionId, readonly RegionId[]>
> = {
  // The atlas exposes Prefrontal Cortex independently, so the authored
  // "frontal-lobe" mesh contains only the remaining frontal parcels. A
  // Frontal Lobe wash must include both meshes to communicate the whole lobe.
  "frontal-lobe": ["frontal-lobe", "prefrontal-cortex"],
  "parietal-lobe": ["parietal-lobe"],
  "temporal-lobe": ["temporal-lobe"],
  "occipital-lobe": ["occipital-lobe"],
  cerebellum: ["cerebellum"],
  "brain-stem": ["brain-stem"],
  hippocampus: ["hippocampus"],
  amygdala: ["amygdala"],
  "prefrontal-cortex": ["prefrontal-cortex"],
  "corpus-callosum": ["corpus-callosum"],
};

export function getSemanticWashMembers(regionId: RegionId) {
  return SEMANTIC_WASH_MEMBERS[regionId];
}

function semanticWashIncludes(sourceRegionId: RegionId, regionId: RegionId) {
  return getSemanticWashMembers(sourceRegionId).includes(regionId);
}

export function getSemanticRegionVisualState(
  regionId: RegionId,
  hoveredRegionId: RegionId | null,
  selectedRegionId: RegionId | null,
): RegionVisualState {
  if (
    selectedRegionId &&
    semanticWashIncludes(selectedRegionId, regionId)
  ) {
    return "selected";
  }
  if (hoveredRegionId && semanticWashIncludes(hoveredRegionId, regionId)) {
    return "hovered";
  }
  if (selectedRegionId !== null) return "context";
  return "idle";
}

export function getSemanticRegionAccentId(
  regionId: RegionId,
  hoveredRegionId: RegionId | null,
  selectedRegionId: RegionId | null,
) {
  if (
    selectedRegionId &&
    semanticWashIncludes(selectedRegionId, regionId)
  ) {
    return selectedRegionId;
  }
  if (hoveredRegionId && semanticWashIncludes(hoveredRegionId, regionId)) {
    return hoveredRegionId;
  }
  return regionId;
}

export const REGION_VISUAL_TARGETS: Readonly<
  Record<RegionVisualState, RegionVisualTarget>
> = {
  idle: {
    colorMix: 0,
    emissiveIntensity: 0,
    roughnessOffset: 0,
    clearcoatOffset: 0,
    selectedRimIntensity: 0,
    contextRecession: 0,
  },
  context: {
    colorMix: 0,
    emissiveIntensity: 0,
    roughnessOffset: 0,
    clearcoatOffset: 0,
    selectedRimIntensity: 0,
    contextRecession: 0,
  },
  hovered: {
    colorMix: 0.1,
    emissiveIntensity: 0.002,
    roughnessOffset: -0.006,
    clearcoatOffset: 0,
    selectedRimIntensity: 0.025,
    contextRecession: 0,
  },
  selected: {
    colorMix: 0.72,
    emissiveIntensity: 0.004,
    roughnessOffset: -0.012,
    clearcoatOffset: 0,
    selectedRimIntensity: 0.24,
    contextRecession: 0,
  },
};

export const ENCLOSED_REVEAL_OPACITY: Readonly<
  Record<RegionVisualState, number>
> = {
  idle: 0,
  context: 0,
  hovered: 0.075,
  selected: 0.13,
};
export const ENCLOSED_SELECTED_REVEAL_OPACITY = {
  hippocampus: 0.68,
  amygdala: 0.68,
  "corpus-callosum": 0.68,
} as const;
export const ENCLOSED_IN_SITU_OPACITY = 0.5;
export const ENCLOSED_EDGE_FEATHER_STRENGTH = {
  hippocampus: 0.3,
  amygdala: 0.3,
  "corpus-callosum": 0.28,
} as const;

export function getCorticalShellRenderState(inSituXray = false) {
  if (inSituXray) {
    return {
      transparent: false,
      opacity: INTERNAL_XRAY_SHELL_OPACITY,
      // The screen-space atlas section remains crisp while this cached
      // surface supplies one restrained whole-brain spatial context.
      depthWrite: true,
      depthTest: true,
      side: "front" as const,
      renderOrder: 1,
    };
  }
  return {
    transparent: false,
    opacity: 1,
    depthWrite: true,
    depthTest: true,
    side: "front" as const,
    renderOrder: 0,
  };
}

export function getEnclosedRenderState(
  regionId: RegionId,
  hoveredRegionId: RegionId | null,
  selectedRegionId: RegionId | null,
  inSituXray = false,
) {
  const selected = selectedRegionId === regionId;
  const hovered = !selected && hoveredRegionId === regionId;
  const visible = selected || hovered;
  if (visible && inSituXray) {
    return {
      selected,
      inSituView: selected,
      opacity: selected ? INTERNAL_XRAY_TISSUE_OPACITY : 0.9,
      visible,
      transparent: true,
      depthWrite: true,
      depthTest: true,
      depthFunc: "less-equal" as const,
      side: "front" as const,
      renderOrder: 6,
    };
  }
  return {
    selected,
    inSituView: selected,
    opacity: selected
      ? ENCLOSED_IN_SITU_OPACITY
      : hovered
        ? 0.34
        : 0,
    visible,
    transparent: visible,
    depthWrite: false,
    depthTest: true,
    depthFunc: "greater" as const,
    side: "double" as const,
    renderOrder: 6,
  };
}

export type SelectionAction =
  | { type: "region-click"; regionId: RegionId }
  | { type: "background-click" }
  | { type: "escape" };

export type HoverAction =
  | { type: "region-enter"; regionId: RegionId }
  | { type: "region-leave"; regionId: RegionId }
  | { type: "background-move" }
  | { type: "background-click" }
  | { type: "pointer-exit" };

export type BrainHoverSources = Readonly<{
  canvasRegionId: RegionId | null;
  navigatorRegionId: RegionId | null;
}>;

export function reduceHoveredRegion(
  hoveredRegionId: RegionId | null,
  action: HoverAction,
): RegionId | null {
  if (action.type === "region-enter") return action.regionId;
  if (
    action.type === "pointer-exit" ||
    action.type === "background-move" ||
    action.type === "background-click"
  ) {
    return null;
  }
  return hoveredRegionId === action.regionId ? null : hoveredRegionId;
}

export function resolveBrainHoveredRegion({
  canvasRegionId,
  navigatorRegionId,
}: BrainHoverSources): RegionId | null {
  return navigatorRegionId ?? canvasRegionId;
}

export function getBrainCursorClass(hoveredRegionId: RegionId | null) {
  return hoveredRegionId
    ? "cursor-pointer"
    : "cursor-grab active:cursor-grabbing";
}

export function reduceSelectedRegion(
  selectedRegionId: RegionId | null,
  action: SelectionAction,
): RegionId | null {
  if (action.type === "region-click") {
    return action.regionId;
  }

  return null;
}

export function getRegionVisualState(
  regionId: RegionId,
  hoveredRegionId: RegionId | null,
  selectedRegionId: RegionId | null,
): RegionVisualState {
  if (selectedRegionId === regionId) return "selected";
  if (hoveredRegionId === regionId) return "hovered";
  if (selectedRegionId !== null) return "context";
  return "idle";
}

export function getEnclosedRevealOpacity(
  regionId: RegionId,
  hoveredRegionId: RegionId | null,
  selectedRegionId: RegionId | null,
) {
  if (!ENCLOSED_REGION_IDS.has(regionId)) return 0;
  const visualState = getRegionVisualState(
    regionId,
    hoveredRegionId,
    selectedRegionId,
  );
  if (visualState === "selected") {
    return ENCLOSED_SELECTED_REVEAL_OPACITY[
      regionId as keyof typeof ENCLOSED_SELECTED_REVEAL_OPACITY
    ];
  }
  return ENCLOSED_REVEAL_OPACITY[visualState];
}
