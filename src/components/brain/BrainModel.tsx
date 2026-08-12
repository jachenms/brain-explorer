"use client";

import { useTexture } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from "react";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from "three-mesh-bvh";

import {
  cleanupLifecycleResources,
  ensureLifecycleResources,
} from "@/lib/brain-bvh-lifecycle";
import {
  BRAIN_MODEL_URL,
  BUNDLED_BRAIN_MODEL_URL,
  getBrainAssetResource,
} from "@/lib/brain-asset-resource";
import {
  ENCLOSED_EDGE_FEATHER_STRENGTH,
  ENCLOSED_PROXY_RAYCAST_SCALE,
  ENCLOSED_REGION_IDS,
  getCorticalShellRenderState,
  getEnclosedRenderState,
  getSemanticRegionAccentId,
  getSemanticRegionVisualState,
  REGION_VISUAL_TARGETS,
  type RegionVisualState,
} from "@/lib/brain-interaction";
import {
  BRAIN_EXTRACTION,
  type BrainExtractionPlanRegistry,
} from "@/lib/brain-extraction";
import type { BrainSelectionFocusIntent } from "@/lib/brain-camera";
import { BRAIN_DRAG_THRESHOLD_CSS_PX } from "@/lib/brain-gesture";
import {
  getBrainIntersectionRegionId,
  resolveBrainInteraction,
} from "@/lib/brain-interaction-raycast";
import {
  BRAIN_REGIONS,
  BRAIN_REGION_BY_ID,
  getRegionIdFromNodeName,
  type RegionId,
} from "@/lib/brain-regions";
import {
  getIdleTissueColor,
  getTissueCategory,
  getTissueMaterialProfile,
} from "@/lib/brain-tissue-palette";
import { getBrainVolumeResource } from "@/lib/brain-volume-resource";
import {
  createBrainVolumePresentation,
  resolveBrainInternalPresentationMode,
  type BrainInternalPresentationMode,
  type BrainVolumePresentation,
} from "@/lib/brain-volume-renderer";
import {
  REGION_LEADER_SILHOUETTE_ROLES,
  REGION_INFO_LEADER,
  type RegionLeaderSupportSample,
  type RegionLeaderSupportRegistry,
  type RegionLeaderWorldAnchor,
} from "@/lib/region-info-leader";
import { installBundledSurfaceAccessPortals } from "@/lib/brain-surface-portals";

type BrainModelProps = {
  modelAttempt: number;
  mobilePresentation: boolean;
  canvasHoveredRegionId: RegionId | null;
  hoveredRegionId: RegionId | null;
  selectedRegionId: RegionId | null;
  onRegionHoverChange: (regionId: RegionId, hovered: boolean) => void;
  onPointerExit: () => void;
  onRegionClick: (
    regionId: RegionId,
    focusIntent: BrainSelectionFocusIntent,
  ) => void;
  shouldSuppressClick: () => boolean;
  prefersReducedMotion: boolean;
  extractionPlanRef: MutableRefObject<BrainExtractionPlanRegistry>;
  leaderExtractionAnchorRef: MutableRefObject<RegionLeaderWorldAnchor>;
  leaderSupportRegistryRef: MutableRefObject<RegionLeaderSupportRegistry | null>;
};

const hitProxyPrefix = "hit-proxy--";
const corticalRegionIds = new Set<RegionId>([
  "frontal-lobe",
  "parietal-lobe",
  "temporal-lobe",
  "occipital-lobe",
  "prefrontal-cortex",
]);
const CORTICAL_REGION_INDEX_ORDER = [
  "prefrontal-cortex",
  "frontal-lobe",
  "parietal-lobe",
  "temporal-lobe",
  "occipital-lobe",
] as const satisfies readonly RegionId[];
const corticalRegionIndex = new Map<RegionId, number>(
  CORTICAL_REGION_INDEX_ORDER.map((regionId, index) => [regionId, index]),
);
const TEMPORAL_SURFACE_ACCENT = new THREE.Color("#35b8b0");
type TissueInteractionUniforms = {
  selectedRimIntensity: { value: number };
  selectedRimColor: { value: THREE.Color };
  enclosedEdgeFeather: { value: number };
  variationStrength: { value: number };
  roughnessVariationStrength: { value: number };
  regionWashStrength: { value: number };
  moistureStrength: { value: number };
  scanShellStrength: { value: number };
  internalScanStrength: { value: number };
  scanPlane: { value: THREE.Vector4 };
  scanSlabWidth: { value: number };
  cortexSelectionWeights: { value: THREE.Vector4 };
  cortexSelectionWeight4: { value: number };
};

function setNumericUniform(
  uniform: { value: number },
  value: number,
) {
  uniform.value = value;
}

const TISSUE_VARIATION_ATTRIBUTE = "tissueVariation";
const SOURCE_CURVATURE_ATTRIBUTE = "_curvature";
const SOURCE_THICKNESS_ATTRIBUTE = "_thickness";
const SOURCE_REGION_WEIGHTS_ATTRIBUTE = "_region_weights";
const SOURCE_REGION_WEIGHT4_ATTRIBUTE = "_region_weight4";
const SOURCE_CURVATURE_RESPONSE_SCALE = 4;
const TISSUE_COLOR_FREQUENCY = 4.6;
const TISSUE_COLOR_WEIGHTS = [0.72, 0.22, 0.06] as const;
const TISSUE_ROUGHNESS_FREQUENCIES = [7, 14] as const;
const TISSUE_ROUGHNESS_WEIGHTS = [0.8, 0.2] as const;
const TISSUE_COLOR_LUMA_RANGE = [0.84, 1.16] as const;
const TISSUE_QUANTILE_SCALE = 0.86;
const TISSUE_ROUGHNESS_TARGET_STANDARD_DEVIATION = 0.48;
const TISSUE_ROUGHNESS_VARIATION = 0.035;
const CORTEX_ROUGHNESS_RANGE = [0.58, 0.8] as const;
const BASE_ROUGHNESS_RANGE = [0.54, 0.86] as const;

type TissueFieldNormalization = Readonly<{
  p05: number;
  median: number;
  p95: number;
}>;

type TissueVariationStatistics = Readonly<{
  colorMedian: number;
  colorStandardDeviation: number;
  roughnessMedian: number;
  roughnessStandardDeviation: number;
  fieldCorrelation: number;
  sampleCount: number;
}>;

type TissueVariationNormalization = Readonly<{
  color: TissueFieldNormalization;
  roughness: TissueFieldNormalization;
  colorMean: number;
  roughnessMean: number;
  roughnessColorProjection: number;
  roughnessAdjustedMedian: number;
  roughnessAdjustedScale: number;
  statistics: TissueVariationStatistics;
}>;

function smoothNoiseWeight(value: number) {
  return value * value * (3 - 2 * value);
}

function tissueNoiseHash(x: number, y: number, z: number) {
  let value =
    Math.imul(x, 374761393) ^
    Math.imul(y, 668265263) ^
    Math.imul(z, 2147483647);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function tissueValueNoise(x: number, y: number, z: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = smoothNoiseWeight(x - ix);
  const fy = smoothNoiseWeight(y - iy);
  const fz = smoothNoiseWeight(z - iz);
  const sample = (dx: number, dy: number, dz: number) =>
    tissueNoiseHash(ix + dx, iy + dy, iz + dz) * 2 - 1;
  const x00 = THREE.MathUtils.lerp(sample(0, 0, 0), sample(1, 0, 0), fx);
  const x10 = THREE.MathUtils.lerp(sample(0, 1, 0), sample(1, 1, 0), fx);
  const x01 = THREE.MathUtils.lerp(sample(0, 0, 1), sample(1, 0, 1), fx);
  const x11 = THREE.MathUtils.lerp(sample(0, 1, 1), sample(1, 1, 1), fx);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(x00, x10, fy),
    THREE.MathUtils.lerp(x01, x11, fy),
    fz,
  );
}

function sampleTissueColorVariation(x: number, y: number, z: number) {
  return TISSUE_COLOR_WEIGHTS.reduce((variation, weight, octave) => {
    const frequency = TISSUE_COLOR_FREQUENCY * 2 ** octave;
    return (
      variation +
      tissueValueNoise(
        x * frequency + 17.13,
        y * frequency - 9.71,
        z * frequency + 4.37,
      ) *
        weight
    );
  }, 0);
}

function sampleTissueRoughnessVariation(x: number, y: number, z: number) {
  return TISSUE_ROUGHNESS_WEIGHTS.reduce(
    (variation, weight, octave) => {
      const frequency = TISSUE_ROUGHNESS_FREQUENCIES[octave];
      return (
        variation +
        tissueValueNoise(
          y * frequency + 41.73,
          z * frequency - 23.19,
          x * frequency + 67.11,
        ) *
          weight
      );
    },
    0,
  );
}

function getTissueVariationSample(
  point: THREE.Vector3,
  atlasCenter: THREE.Vector3,
  inverseLongestSide: number,
) {
  const x = (point.x - atlasCenter.x) * inverseLongestSide;
  const y = (point.y - atlasCenter.y) * inverseLongestSide;
  const z = (point.z - atlasCenter.z) * inverseLongestSide;
  return [
    sampleTissueColorVariation(x, y, z),
    sampleTissueRoughnessVariation(x, y, z),
  ] as const;
}

function percentile(sortedValues: readonly number[], percentileValue: number) {
  const scaledIndex = (sortedValues.length - 1) * percentileValue;
  const lowerIndex = Math.floor(scaledIndex);
  const upperIndex = Math.ceil(scaledIndex);
  return THREE.MathUtils.lerp(
    sortedValues[lowerIndex],
    sortedValues[upperIndex],
    scaledIndex - lowerIndex,
  );
}

function createFieldNormalization(
  sortedValues: readonly number[],
): TissueFieldNormalization {
  return {
    p05: percentile(sortedValues, 0.05),
    median: percentile(sortedValues, 0.5),
    p95: percentile(sortedValues, 0.95),
  };
}

function normalizeTissueField(
  value: number,
  normalization: TissueFieldNormalization,
) {
  const denominator =
    value < normalization.median
      ? normalization.median - normalization.p05
      : normalization.p95 - normalization.median;
  return THREE.MathUtils.clamp(
    (value - normalization.median) /
      Math.max(denominator, Number.EPSILON) *
      TISSUE_QUANTILE_SCALE,
    -1,
    1,
  );
}

function tissueFieldStatistics(values: readonly number[]) {
  const mean =
    values.reduce((total, value) => total + value, 0) /
    Math.max(values.length, 1);
  return {
    mean,
    standardDeviation: Math.sqrt(
      values.reduce(
        (total, value) => total + (value - mean) ** 2,
        0,
      ) / Math.max(values.length, 1),
    ),
  };
}

function tissueFieldCorrelation(
  colorValues: readonly number[],
  roughnessValues: readonly number[],
) {
  const colorStats = tissueFieldStatistics(colorValues);
  const roughnessStats = tissueFieldStatistics(roughnessValues);
  const covariance =
    colorValues.reduce(
      (total, colorValue, index) =>
        total +
        (colorValue - colorStats.mean) *
          (roughnessValues[index] - roughnessStats.mean),
      0,
    ) / Math.max(colorValues.length, 1);
  return (
    covariance /
    Math.max(
      colorStats.standardDeviation * roughnessStats.standardDeviation,
      Number.EPSILON,
    )
  );
}

function decorrelateTissueRoughness(
  colorValue: number,
  roughnessValue: number,
  normalization: Pick<
    TissueVariationNormalization,
    | "colorMean"
    | "roughnessMean"
    | "roughnessColorProjection"
    | "roughnessAdjustedMedian"
    | "roughnessAdjustedScale"
  >,
) {
  const adjusted =
    roughnessValue -
    normalization.roughnessMean -
    normalization.roughnessColorProjection *
      (colorValue - normalization.colorMean);
  return THREE.MathUtils.clamp(
    (adjusted - normalization.roughnessAdjustedMedian) *
      normalization.roughnessAdjustedScale,
    -1,
    1,
  );
}

function measureAtlasTissueVariation(
  scene: THREE.Object3D,
  atlasBounds: THREE.Box3,
): TissueVariationNormalization {
  const atlasSize = atlasBounds.getSize(new THREE.Vector3());
  const atlasCenter = atlasBounds.getCenter(new THREE.Vector3());
  const inverseLongestSide =
    1 /
    Math.max(
      atlasSize.x,
      atlasSize.y,
      atlasSize.z,
      Number.EPSILON,
    );
  const point = new THREE.Vector3();
  const rawColorValues: number[] = [];
  const rawRoughnessValues: number[] = [];
  scene.traverse((object) => {
    const regionId =
      object instanceof THREE.Mesh ? findRegionId(object) : null;
    if (
      !(object instanceof THREE.Mesh) ||
      !regionId ||
      ENCLOSED_REGION_IDS.has(regionId) ||
      corticalRegionIds.has(regionId) ||
      isHitProxy(object)
    ) {
      return;
    }
    const position = object.geometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(
        object.matrixWorld,
      );
      const [colorValue, roughnessValue] = getTissueVariationSample(
        point,
        atlasCenter,
        inverseLongestSide,
      );
      rawColorValues.push(colorValue);
      rawRoughnessValues.push(roughnessValue);
    }
  });
  const color = createFieldNormalization(
    rawColorValues.toSorted((first, second) => first - second),
  );
  const roughness = createFieldNormalization(
    rawRoughnessValues.toSorted((first, second) => first - second),
  );
  const normalizedColors = rawColorValues.map((value) =>
    normalizeTissueField(value, color),
  );
  const normalizedRoughness = rawRoughnessValues.map((value) =>
    normalizeTissueField(value, roughness),
  );
  const colorStats = tissueFieldStatistics(normalizedColors);
  const initialRoughnessStats =
    tissueFieldStatistics(normalizedRoughness);
  const roughnessColorProjection =
    tissueFieldCorrelation(normalizedColors, normalizedRoughness) *
    (initialRoughnessStats.standardDeviation /
      Math.max(colorStats.standardDeviation, Number.EPSILON));
  const adjustedRoughness = normalizedRoughness.map(
    (roughnessValue, index) =>
      roughnessValue -
      initialRoughnessStats.mean -
      roughnessColorProjection *
        (normalizedColors[index] - colorStats.mean),
  );
  const roughnessAdjustedMedian = percentile(
    adjustedRoughness.toSorted((first, second) => first - second),
    0.5,
  );
  const centeredRoughness = adjustedRoughness.map(
    (value) => value - roughnessAdjustedMedian,
  );
  const centeredRoughnessStats =
    tissueFieldStatistics(centeredRoughness);
  const roughnessAdjustedScale =
    TISSUE_ROUGHNESS_TARGET_STANDARD_DEVIATION /
    Math.max(
      centeredRoughnessStats.standardDeviation,
      Number.EPSILON,
    );
  const finalRoughness = centeredRoughness.map((value) =>
    THREE.MathUtils.clamp(
      value * roughnessAdjustedScale,
      -1,
      1,
    ),
  );
  const roughnessStats = tissueFieldStatistics(finalRoughness);
  return {
    color,
    roughness,
    colorMean: colorStats.mean,
    roughnessMean: initialRoughnessStats.mean,
    roughnessColorProjection,
    roughnessAdjustedMedian,
    roughnessAdjustedScale,
    statistics: {
      colorMedian: percentile(
        normalizedColors.toSorted((first, second) => first - second),
        0.5,
      ),
      colorStandardDeviation: colorStats.standardDeviation,
      roughnessMedian: percentile(
        finalRoughness.toSorted((first, second) => first - second),
        0.5,
      ),
      roughnessStandardDeviation: roughnessStats.standardDeviation,
      fieldCorrelation: tissueFieldCorrelation(
        normalizedColors,
        finalRoughness,
      ),
      sampleCount: normalizedColors.length,
    },
  };
}

function bakeTissueVariation(
  geometry: THREE.BufferGeometry,
  atlasMatrix: THREE.Matrix4,
  atlasBounds: THREE.Box3,
  normalization: TissueVariationNormalization,
  cortical: boolean,
) {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const sourceCurvature = geometry.getAttribute(SOURCE_CURVATURE_ATTRIBUTE);
  const sourceThickness = geometry.getAttribute(SOURCE_THICKNESS_ATTRIBUTE);
  if (cortical && (!sourceCurvature || !sourceThickness)) {
    throw new Error(
      `Bundled cortical geometry is missing ${SOURCE_CURVATURE_ATTRIBUTE} or ${SOURCE_THICKNESS_ATTRIBUTE}`,
    );
  }
  const variation = new Float32Array(position.count * 3);
  const point = new THREE.Vector3();
  const surfaceNormal = new THREE.Vector3();
  const ellipsoidNormal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(atlasMatrix);
  const size = atlasBounds.getSize(new THREE.Vector3());
  const center = atlasBounds.getCenter(new THREE.Vector3());
  const inverseLongestSide =
    1 / Math.max(size.x, size.y, size.z, Number.EPSILON);
  let colorMinimum = Number.POSITIVE_INFINITY;
  let colorMaximum = Number.NEGATIVE_INFINITY;
  let roughnessMinimum = Number.POSITIVE_INFINITY;
  let roughnessMaximum = Number.NEGATIVE_INFINITY;
  let geometryResponseMinimum = Number.POSITIVE_INFINITY;
  let geometryResponseMaximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index).applyMatrix4(atlasMatrix);
    surfaceNormal
      .fromBufferAttribute(normal, index)
      .applyNormalMatrix(normalMatrix)
      .normalize();
    ellipsoidNormal
      .set(
        (point.x - center.x) /
          Math.max((size.x * 0.5) ** 2, Number.EPSILON),
        (point.y - center.y) /
          Math.max((size.y * 0.5) ** 2, Number.EPSILON),
        (point.z - center.z) /
          Math.max((size.z * 0.5) ** 2, Number.EPSILON),
      )
      .normalize();
    const geometryResponse = cortical
      ? THREE.MathUtils.clamp(
          -sourceCurvature!.getX(index) *
            SOURCE_CURVATURE_RESPONSE_SCALE,
          -1,
          1,
        )
      : THREE.MathUtils.clamp(
          (surfaceNormal.dot(ellipsoidNormal) - 0.62) / 0.28,
          -1,
          1,
        );
    const [rawColor, rawRoughness] = getTissueVariationSample(
      point,
      center,
      inverseLongestSide,
    );
    const thicknessResponse = cortical
      ? THREE.MathUtils.clamp(
          (sourceThickness!.getX(index) - 2.6) / 1.8,
          -1,
          1,
        )
      : 0;
    const colorValue = THREE.MathUtils.clamp(
      normalizeTissueField(rawColor, normalization.color) +
        thicknessResponse * 0.12,
      -1,
      1,
    );
    const roughnessValue = normalizeTissueField(
      rawRoughness,
      normalization.roughness,
    );
    const decorrelatedRoughness = THREE.MathUtils.clamp(
      decorrelateTissueRoughness(
        colorValue,
        roughnessValue,
        normalization,
      ) - thicknessResponse * 0.18,
      -1,
      1,
    );
    variation[index * 3] = colorValue;
    variation[index * 3 + 1] = decorrelatedRoughness;
    variation[index * 3 + 2] = geometryResponse;
    colorMinimum = Math.min(colorMinimum, colorValue);
    colorMaximum = Math.max(colorMaximum, colorValue);
    roughnessMinimum = Math.min(
      roughnessMinimum,
      decorrelatedRoughness,
    );
    roughnessMaximum = Math.max(
      roughnessMaximum,
      decorrelatedRoughness,
    );
    geometryResponseMinimum = Math.min(
      geometryResponseMinimum,
      geometryResponse,
    );
    geometryResponseMaximum = Math.max(
      geometryResponseMaximum,
      geometryResponse,
    );
  }
  geometry.setAttribute(
    TISSUE_VARIATION_ATTRIBUTE,
    new THREE.BufferAttribute(variation, 3),
  );
  const sourceCurvaturePercentiles = sourceCurvature
    ? (() => {
        const values = Array.from(
          { length: sourceCurvature.count },
          (_, index) => sourceCurvature.getX(index),
        ).sort((first, second) => first - second);
        return {
          p1: percentile(values, 0.01),
          p5: percentile(values, 0.05),
          p50: percentile(values, 0.5),
          p95: percentile(values, 0.95),
          p99: percentile(values, 0.99),
        };
      })()
    : null;
  const sourceThicknessPercentiles = sourceThickness
    ? (() => {
        const values = Array.from(
          { length: sourceThickness.count },
          (_, index) => sourceThickness.getX(index),
        ).sort((first, second) => first - second);
        return {
          p1: percentile(values, 0.01),
          p5: percentile(values, 0.05),
          p50: percentile(values, 0.5),
          p95: percentile(values, 0.95),
          p99: percentile(values, 0.99),
        };
      })()
    : null;
  geometry.userData.tissueVariation = {
    source: cortical
      ? "verified-freesurfer-curvature-and-pial-white-thickness"
      : "baked-atlas-object-space-vec3-geometry-response",
    components: [
      "linear-color",
      "independent-roughness",
      cortical
        ? "freesurfer-curvature-crown-cavity"
        : "ellipsoidal-crown-cavity",
    ],
    itemSize: 3,
    colorMinimum,
    colorMaximum,
    roughnessMinimum,
    roughnessMaximum,
    geometryResponseMinimum,
    geometryResponseMaximum,
    colorFrequency: TISSUE_COLOR_FREQUENCY,
    colorWeights: [...TISSUE_COLOR_WEIGHTS],
    roughnessFrequencies: [...TISSUE_ROUGHNESS_FREQUENCIES],
    roughnessWeights: [...TISSUE_ROUGHNESS_WEIGHTS],
    quantileScale: TISSUE_QUANTILE_SCALE,
    normalizationSource: "exterior-tissue-global-p05-median-p95",
    colorNormalization: normalization.color,
    roughnessNormalization: normalization.roughness,
    roughnessDecorrelation: {
      colorMean: normalization.colorMean,
      roughnessMean: normalization.roughnessMean,
      colorProjection: normalization.roughnessColorProjection,
      adjustedMedian: normalization.roughnessAdjustedMedian,
      adjustedScale: normalization.roughnessAdjustedScale,
    },
    globalStatistics: normalization.statistics,
    linearLumaRange: [...TISSUE_COLOR_LUMA_RANGE],
    roughnessAmplitude: TISSUE_ROUGHNESS_VARIATION,
    sourceCurvatureAttribute: cortical
      ? SOURCE_CURVATURE_ATTRIBUTE
      : null,
    sourceCurvatureResponseScale: cortical
      ? -SOURCE_CURVATURE_RESPONSE_SCALE
      : null,
    sourceCurvatureConvention: cortical
      ? "FreeSurfer positive-sulcus / negative-gyrus"
      : null,
    sourceCurvaturePercentiles,
    sourceThicknessAttribute: cortical
      ? SOURCE_THICKNESS_ATTRIBUTE
      : null,
    sourceThicknessPercentiles,
  };
}

function addTissueInteractionShader(
  material: THREE.MeshPhysicalMaterial,
  uniforms: TissueInteractionUniforms,
  cortical: boolean,
  enclosed: boolean,
  unifiedCortex = false,
) {
  const roughnessRange = cortical
    ? CORTEX_ROUGHNESS_RANGE
    : BASE_ROUGHNESS_RANGE;
  const materialDebugMode =
    cortical && typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get(
          "brainMaterialDebug",
        )
      : null;
  const materialDebugOutput =
    materialDebugMode === "normal"
      ? `outgoingLight = normalize(normal) * 0.5 + 0.5;`
      : materialDebugMode === "curvature"
      ? `outgoingLight = mix(
  vec3(0.08, 0.13, 0.20),
  vec3(0.96, 0.48, 0.18),
  brainCrownResponse
);
outgoingLight = mix(
  outgoingLight,
  vec3(0.035, 0.045, 0.060),
  brainCavityResponse * 0.92
);`
      : materialDebugMode === "ao"
        ? `outgoingLight = vec3(brainGeometryForm);`
        : materialDebugMode === "crown"
          ? `outgoingLight = vec3(
  brainMoistureRibbon,
  brainCrownResponse * 0.42,
  brainLocalizedCrownLight * 0.22
);`
          : materialDebugMode === "mesh"
            ? `outgoingLight = mix(
  vec3(0.10, 0.12, 0.15),
  vec3(0.18, 0.82, 0.76),
  brainCortexSelectionMask
);`
          : "";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.brainSelectedRimIntensity =
      uniforms.selectedRimIntensity;
    shader.uniforms.brainSelectedRimColor = uniforms.selectedRimColor;
    shader.uniforms.brainEnclosedEdgeFeather =
      uniforms.enclosedEdgeFeather;
    shader.uniforms.brainTissueVariationStrength =
      uniforms.variationStrength;
    shader.uniforms.brainRoughnessVariationStrength =
      uniforms.roughnessVariationStrength;
    shader.uniforms.brainRegionWashStrength =
      uniforms.regionWashStrength;
    shader.uniforms.brainMoistureStrength =
      uniforms.moistureStrength;
    shader.uniforms.brainScanShellStrength =
      uniforms.scanShellStrength;
    shader.uniforms.brainInternalScanStrength =
      uniforms.internalScanStrength;
    shader.uniforms.brainScanPlane = uniforms.scanPlane;
    shader.uniforms.brainScanSlabWidth = uniforms.scanSlabWidth;
    shader.uniforms.brainCortexSelectionWeights =
      uniforms.cortexSelectionWeights;
    shader.uniforms.brainCortexSelectionWeight4 =
      uniforms.cortexSelectionWeight4;
    shader.vertexShader = `attribute vec3 ${TISSUE_VARIATION_ATTRIBUTE};
varying vec3 brainTissueVariation;
varying vec3 brainTissueWorldPosition;
${unifiedCortex ? `attribute vec4 ${SOURCE_REGION_WEIGHTS_ATTRIBUTE};
attribute float ${SOURCE_REGION_WEIGHT4_ATTRIBUTE};
varying vec4 brainCortexRegionWeights;
varying float brainCortexRegionWeight4;` : ""}
${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
brainTissueVariation = ${TISSUE_VARIATION_ATTRIBUTE};
brainTissueWorldPosition =
  (modelMatrix * vec4(transformed, 1.0)).xyz;
${unifiedCortex ? `brainCortexRegionWeights = ${SOURCE_REGION_WEIGHTS_ATTRIBUTE};
brainCortexRegionWeight4 = ${SOURCE_REGION_WEIGHT4_ATTRIBUTE};` : ""}`,
    );
    shader.fragmentShader = `varying vec3 brainTissueVariation;
varying vec3 brainTissueWorldPosition;
uniform float brainSelectedRimIntensity;
uniform vec3 brainSelectedRimColor;
uniform float brainEnclosedEdgeFeather;
uniform float brainTissueVariationStrength;
uniform float brainRoughnessVariationStrength;
uniform float brainRegionWashStrength;
uniform float brainMoistureStrength;
uniform float brainScanShellStrength;
uniform float brainInternalScanStrength;
uniform vec4 brainScanPlane;
uniform float brainScanSlabWidth;
uniform vec4 brainCortexSelectionWeights;
uniform float brainCortexSelectionWeight4;
${unifiedCortex ? `varying vec4 brainCortexRegionWeights;
varying float brainCortexRegionWeight4;` : ""}
${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
float brainTissueColorField =
  clamp(
    brainTissueVariation.x * brainTissueVariationStrength,
    -1.0,
    1.0
  );
float brainTissueLuma = clamp(
  1.0 + brainTissueColorField,
  ${TISSUE_COLOR_LUMA_RANGE[0].toFixed(2)},
  ${TISSUE_COLOR_LUMA_RANGE[1].toFixed(2)}
);
vec3 brainTissueHue = mix(
  vec3(0.985, 0.995, 1.000),
  vec3(1.020, 0.990, 0.980),
  brainTissueColorField * 0.5 + 0.5
);
diffuseColor.rgb *= brainTissueLuma * brainTissueHue;
// Semantic interaction preserves local luminance and modulates chroma, so a
// selected lobe keeps its anatomical crown/cavity response.
float brainCortexSelectionMask = ${unifiedCortex ? `clamp(
  dot(brainCortexRegionWeights, brainCortexSelectionWeights) +
    brainCortexRegionWeight4 * brainCortexSelectionWeight4,
  0.0,
  1.0
)` : "1.0"};
float brainRegionWash = clamp(
  brainRegionWashStrength * brainCortexSelectionMask,
  0.0,
  0.88
);
float brainBaseLuma = dot(
  diffuseColor.rgb,
  vec3(0.2126, 0.7152, 0.0722)
);
float brainAccentLuma = max(
  dot(brainSelectedRimColor, vec3(0.2126, 0.7152, 0.0722)),
  0.001
);
vec3 brainLumaPreservingAccent =
  brainSelectedRimColor * (brainBaseLuma / brainAccentLuma);
brainLumaPreservingAccent =
  vec3(brainBaseLuma) +
  (brainLumaPreservingAccent - vec3(brainBaseLuma)) * 1.35;
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  brainLumaPreservingAccent,
  brainRegionWash
);
float brainCrownResponse = smoothstep(
  -0.08,
  0.86,
  brainTissueVariation.z
);
float brainCavityResponse = smoothstep(
  -0.02,
  0.68,
  -brainTissueVariation.z
);
float brainGeometryForm =
  max(
    0.32,
    1.0 - brainCavityResponse * 0.84 + brainCrownResponse * 0.010
  );
diffuseColor.rgb *= mix(
  1.0,
  brainGeometryForm,
  ${cortical ? "0.98" : "0.5"}
);
float brainCrownKey = saturate(dot(
  normalize(vNormal),
  normalize(vec3(-0.52, 0.74, 0.42))
));
float brainLocalizedCrownLight =
  smoothstep(0.71, 0.765, brainCrownKey) *
  (1.0 - smoothstep(0.80, 0.845, brainCrownKey)) *
  smoothstep(0.68, 0.90, brainCrownResponse);
diffuseColor.rgb *= mix(
  vec3(1.0),
  vec3(1.04, 1.028, 1.018),
  brainLocalizedCrownLight * brainMoistureStrength
);
diffuseColor.rgb += vec3(0.004, 0.002, 0.002) *
  brainCavityResponse * ${cortical ? "0.5" : "0.22"};
float brainFormFacing = saturate(abs(
  dot(normalize(vNormal), normalize(vViewPosition))
));
float brainFormSeparation = mix(
  0.95,
  1.008,
  smoothstep(0.18, 0.78, brainFormFacing)
);
diffuseColor.rgb *= mix(
  1.0,
  brainFormSeparation,
  ${cortical ? "0.36" : "0.24"}
);
diffuseColor.rgb *= mix(
  vec3(0.965, 0.982, 1.018),
  vec3(1.052, 0.972, 0.952),
  brainCrownResponse * 0.62 +
    (brainTissueColorField * 0.5 + 0.5) * 0.38
);`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>
roughnessFactor = clamp(
  roughnessFactor + brainTissueVariation.y *
    brainRoughnessVariationStrength * ${TISSUE_ROUGHNESS_VARIATION.toFixed(3)} +
    brainCavityResponse * ${cortical ? "0.16" : "0.02"} -
    brainCrownResponse * 0.012,
  ${roughnessRange[0].toFixed(2)},
  ${roughnessRange[1].toFixed(2)}
);
// A narrow, curvature-gated area-light response confines moisture to crown
// ribbons without broad plastic highlights.
float brainSurfaceFacing = saturate(abs(
  dot(normalize(vNormal), normalize(vViewPosition))
));
float brainMoistureKey = saturate(dot(
  normalize(vNormal),
  normalize(vec3(-0.52, 0.74, 0.42))
));
float brainMoistureRibbon =
  smoothstep(0.54, 0.66, brainMoistureKey) *
  (1.0 - smoothstep(0.78, 0.88, brainMoistureKey)) *
  smoothstep(0.62, 0.84, brainCrownResponse);
roughnessFactor = clamp(
  roughnessFactor -
    brainMoistureStrength * brainMoistureRibbon * 0.12,
  ${roughnessRange[0].toFixed(2)},
  ${roughnessRange[1].toFixed(2)}
);`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_physical_fragment>",
      `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
float brainCrownClearcoat = smoothstep(0.58, 0.84, brainCrownResponse);
material.clearcoat *= mix(
  0.18,
  1.0,
  brainCrownClearcoat * mix(0.18, 1.0, brainMoistureRibbon)
);
material.clearcoatRoughness = clamp(
  material.clearcoatRoughness +
    brainCavityResponse * 0.22 -
    brainMoistureRibbon * brainMoistureStrength * 0.12,
  0.26,
  0.74
);
#endif`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `outgoingLight +=
  diffuseColor.rgb * ${cortical ? "0.045" : "0.018"};
outgoingLight +=
  vec3(0.12, 0.052, 0.036) *
  brainMoistureRibbon *
  brainMoistureStrength *
  (1.0 - brainRegionWash * 0.35);
float brainSubsurfaceWrap = smoothstep(
  -0.38,
  0.62,
  dot(normalize(normal), normalize(vec3(-0.48, 0.70, 0.52)))
);
outgoingLight +=
  diffuseColor.rgb *
  (1.0 - brainSubsurfaceWrap) *
  ${cortical ? "0.11" : "0.13"};
outgoingLight +=
  vec3(0.052, 0.020, 0.014) *
  (1.0 - brainSubsurfaceWrap) *
  ${cortical ? "0.34" : "0.18"};
float brainCrownMoistureSpec = pow(
  max(
    dot(
      reflect(
        -normalize(vec3(-0.48, 0.70, 0.52)),
        normalize(normal)
      ),
      normalize(-vViewPosition)
    ),
    0.0
  ),
  18.0
) * smoothstep(0.52, 0.86, brainCrownResponse);
outgoingLight +=
  vec3(0.24, 0.12, 0.10) *
  brainCrownMoistureSpec *
  brainMoistureStrength;
float brainLitLuma = dot(
  outgoingLight,
  vec3(0.2126, 0.7152, 0.0722)
);
vec3 brainLitAccent =
  brainSelectedRimColor *
  (brainLitLuma / max(
    dot(brainSelectedRimColor, vec3(0.2126, 0.7152, 0.0722)),
    0.001
  ));
brainLitAccent =
  vec3(brainLitLuma) +
  (brainLitAccent - vec3(brainLitLuma)) * 1.25;
outgoingLight = mix(
  outgoingLight,
  brainLitAccent,
  brainRegionWash * 0.78
);
${materialDebugOutput}
#include <opaque_fragment>`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
totalEmissiveRadiance *= mix(1.0, brainTissueLuma, 0.25);
float brainSelectedFresnel = pow(
  1.0 - saturate(dot(normalize(vNormal), normalize(-vViewPosition))),
  6.0
);
brainSelectedFresnel = smoothstep(0.1, 0.74, brainSelectedFresnel);
totalEmissiveRadiance += brainSelectedRimColor *
  brainSelectedFresnel * brainSelectedRimIntensity *
  brainCortexSelectionMask;`,
    );
    if (enclosed) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        `float brainInternalFacing = saturate(abs(
  dot(normalize(vNormal), normalize(vViewPosition))
));
float brainInternalSectionDistance =
  dot(brainTissueWorldPosition, brainScanPlane.xyz) -
  brainScanPlane.w;
if (
  brainInternalScanStrength > 0.5 &&
  (
    brainInternalSectionDistance < -0.025 ||
    brainInternalSectionDistance > brainScanSlabWidth
  )
) discard;
float brainInternalSectionDepth = 1.0 - smoothstep(
  0.0,
  brainScanSlabWidth,
  max(0.0, brainInternalSectionDistance)
);
float brainInternalEdgeAlpha = smoothstep(
  0.08,
  0.52,
  brainInternalFacing
);
diffuseColor.rgb *= mix(
  1.0,
  mix(0.62, 1.0, brainInternalSectionDepth) *
    mix(0.86, 1.0, brainInternalFacing),
  brainInternalScanStrength
);
diffuseColor.a *= mix(
  1.0,
  brainInternalEdgeAlpha,
  brainEnclosedEdgeFeather
);
#include <opaque_fragment>`,
      );
    } else if (cortical) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        `if (
  brainScanShellStrength > 0.5 &&
  dot(brainTissueWorldPosition, brainScanPlane.xyz) >
    brainScanPlane.w
) discard;
#include <opaque_fragment>`,
      );
    }
    material.userData.compiledTissueVariation = {
      attribute: shader.vertexShader.includes(
        `attribute vec3 ${TISSUE_VARIATION_ATTRIBUTE}`,
      ),
      varying: shader.fragmentShader.includes(
        "varying vec3 brainTissueVariation",
      ),
      roughness: shader.fragmentShader.includes(
        "roughnessFactor + brainTissueVariation.y",
      ),
      diffuse: shader.fragmentShader.includes(
        "diffuseColor.rgb *= brainTissueLuma * brainTissueHue",
      ),
      emissiveTextureRetention: shader.fragmentShader.includes(
        "totalEmissiveRadiance *= mix(1.0, brainTissueLuma, 0.25)",
      ),
      semanticWash: shader.fragmentShader.includes(
        "brainRegionWashStrength",
      ),
      diffuseWrap: false,
      reviewUniform: shader.fragmentShader.includes(
        "uniform float brainTissueVariationStrength",
      ),
      vertexColors: material.vertexColors,
    };
  };
  material.customProgramCacheKey = () =>
    `brain-tissue-interaction-v17-curvature-thickness-${
      cortical ? "cortex" : "base"
    }-${enclosed ? "enclosed" : "exterior"}-${
      materialDebugMode ?? "composite"
    }-${unifiedCortex ? "unified-mask" : "region-mesh"
    }`;
}

function getPresentationAccent(regionId: RegionId) {
  const vivid = new THREE.Color(
    BRAIN_REGION_BY_ID.get(regionId)?.color ?? "#ffffff",
  );
  return ENCLOSED_REGION_IDS.has(regionId)
    ? new THREE.Color("#b5969d").lerp(vivid, 0.2)
    : new THREE.Color("#c5b0b5").lerp(vivid, 0.62);
}

function createTissueMaterial(
  regionId: RegionId,
  unifiedCortex = false,
) {
  const vividColor = getPresentationAccent(regionId);
  const idleColor = getIdleTissueColor(regionId);
  const color = new THREE.Color(idleColor);
  const cortical = corticalRegionIds.has(regionId);
  const biologicalExterior =
    cortical || regionId === "cerebellum";
  const enclosed = ENCLOSED_REGION_IDS.has(regionId);
  const brainStem = regionId === "brain-stem";
  const profile = getTissueMaterialProfile(regionId);
  const roughnessRange = cortical
    ? CORTEX_ROUGHNESS_RANGE
    : BASE_ROUGHNESS_RANGE;
  const interactionUniforms: TissueInteractionUniforms = {
    selectedRimIntensity: { value: 0 },
    selectedRimColor: { value: vividColor.clone() },
    enclosedEdgeFeather: {
      value: enclosed
        ? ENCLOSED_EDGE_FEATHER_STRENGTH[
            regionId as keyof typeof ENCLOSED_EDGE_FEATHER_STRENGTH
          ]
        : 0,
    },
    // This is a deterministic, atlas-object-space low-frequency field. It
    // breaks up broad uniform clay response without introducing runtime noise.
    variationStrength: {
      value: cortical ? 0.2 : regionId === "cerebellum" ? 0.14 : 0,
    },
    roughnessVariationStrength: {
      value: cortical ? 0.3 : brainStem ? 0.34 : 0.28,
    },
    regionWashStrength: { value: 0 },
    moistureStrength: {
      value: cortical ? 1 : biologicalExterior ? 0.58 : 0.35,
    },
    scanShellStrength: { value: 0 },
    internalScanStrength: { value: 0 },
    scanPlane: { value: new THREE.Vector4(1, 0, 0, 0) },
    scanSlabWidth: { value: 0.32 },
    cortexSelectionWeights: { value: new THREE.Vector4() },
    cortexSelectionWeight4: { value: 0 },
  };
  const material = new THREE.MeshPhysicalMaterial({
    color,
    vertexColors: false,
    metalness: 0,
    roughness: profile.roughness,
    ior: 1.38,
    specularIntensity: profile.specularIntensity,
    specularColor: new THREE.Color("#dfc1bb"),
    sheen: profile.sheen,
    clearcoat: profile.clearcoat,
    clearcoatRoughness: profile.clearcoatRoughness,
    envMapIntensity: profile.envMapIntensity,
    transparent: false,
    opacity: 1,
    depthWrite: true,
    depthTest: true,
    transmission: 0,
    thickness: 0,
    dithering: false,
  });
  material.name = `${regionId}-premium-tissue`;
  material.userData.tissueResponse = brainStem
    ? "dense warm inferior tissue with a restrained low-clearcoat response"
    : cortical
      ? "warm gray-pink specimen tissue with a coherent moist grazing response"
      : "muted internal tissue with restrained coherent highlights";
  material.userData.regionId = regionId;
  material.userData.idleTissueColor = idleColor;
  material.userData.tissueCategory = getTissueCategory(regionId);
  material.userData.semanticAccent = `#${vividColor.getHexString()}`;
  material.userData.interactionShader =
    "luminance-preserving semantic chroma, verified FreeSurfer curvature plus pial-white thickness response, crown-localized moisture, restrained Fresnel contour, and enclosed silhouette feather";
  material.userData.shaderIsolation = {
    programKey: `brain-tissue-interaction-v17-curvature-thickness-${
      cortical ? "cortex" : "base"
    }-${enclosed ? "enclosed" : "exterior"}`,
    tissueBackscatter: false,
    variationAttribute: TISSUE_VARIATION_ATTRIBUTE,
    variationComponents: [
      "linear-color",
      "independent-roughness",
      cortical
        ? "freesurfer-curvature-plus-pial-white-thickness"
        : "ellipsoidal-crown-cavity",
    ],
    albedoPath: "post-color-fragment-linear-vec3-x",
    linearLumaRange: [...TISSUE_COLOR_LUMA_RANGE],
    diffuseVariationUse: "enabled-deterministic-atlas-object-field",
    roughnessVariation: TISSUE_ROUGHNESS_VARIATION,
    roughnessNoiseSpace: cortical
      ? "disabled-real-curvature-controls-cavity-roughness"
      : "independent-baked-atlas-object-vec3-y",
    roughnessClamp: [...roughnessRange],
    roughnessAnimated: false,
    selectionFresnel: true,
    semanticRegionWash: true,
    curvatureAoStrength: cortical ? 0.42 : 0.12,
    curvatureResponseRange: [-1, 1],
    pialThicknessResponseMillimeters: {
      center: 2.6,
      halfRange: 1.8,
    },
    crownClearcoatMask: cortical ? [0.72, 0.9] : null,
    enclosedFeather: enclosed,
    dithering: false,
  };
  material.userData.variationStrengthUniform =
    interactionUniforms.variationStrength;
  material.userData.roughnessVariationStrengthUniform =
    interactionUniforms.roughnessVariationStrength;
  material.userData.moistureStrengthUniform =
    interactionUniforms.moistureStrength;
  material.userData.regionWashStrengthUniform =
    interactionUniforms.regionWashStrength;
  addTissueInteractionShader(
    material,
    interactionUniforms,
    cortical,
    enclosed,
    unifiedCortex,
  );

  return { material, interactionUniforms };
}

function createScanMaterialVariant(
  material: THREE.MeshPhysicalMaterial,
  enclosed: boolean,
) {
  const scanMaterial = material.clone();
  scanMaterial.name = `${material.name}-cached-sectional-scan`;
  // Share mutable color objects and shader uniforms with the resting material.
  // The render-state switch only swaps a cached material reference; it never
  // recompiles a material or allocates transition-time state.
  scanMaterial.color = material.color;
  scanMaterial.emissive = material.emissive;
  scanMaterial.specularColor = material.specularColor;
  scanMaterial.onBeforeCompile = material.onBeforeCompile;
  scanMaterial.customProgramCacheKey =
    material.customProgramCacheKey;
  scanMaterial.transparent = enclosed;
  scanMaterial.opacity = enclosed ? 0.78 : 1;
  if (!enclosed) {
    scanMaterial.roughness = material.roughness;
    scanMaterial.clearcoat = material.clearcoat;
    scanMaterial.envMapIntensity = material.envMapIntensity;
  }
  scanMaterial.depthWrite = true;
  scanMaterial.depthTest = true;
  scanMaterial.depthFunc = THREE.LessEqualDepth;
  scanMaterial.side = THREE.FrontSide;
  scanMaterial.userData.cachedSectionalVariant = true;
  scanMaterial.userData.cutawayVariant =
    "cached-atlas-plane-clipped-pial";
  scanMaterial.userData.variationStrengthUniform =
    material.userData.variationStrengthUniform;
  scanMaterial.userData.roughnessVariationStrengthUniform =
    material.userData.roughnessVariationStrengthUniform;
  scanMaterial.userData.moistureStrengthUniform =
    material.userData.moistureStrengthUniform;
  scanMaterial.userData.regionWashStrengthUniform =
    material.userData.regionWashStrengthUniform;
  return scanMaterial;
}

function exactRegionId(value: unknown): RegionId | null {
  if (
    typeof value === "string" &&
    BRAIN_REGION_BY_ID.has(value as RegionId)
  ) {
    return value as RegionId;
  }

  return null;
}

function findRegionId(object: THREE.Object3D) {
  let current: THREE.Object3D | null = object;

  // Authored RegionId node names and GLB extras are authoritative. Aliases are
  // only a compatibility fallback for NEXT_PUBLIC_BRAIN_MODEL_URL overrides.
  while (current) {
    const regionId =
      exactRegionId(current.name) ??
      exactRegionId(current.userData.brainRegionId) ??
      exactRegionId(
        current.name.startsWith(hitProxyPrefix)
          ? current.name.slice(hitProxyPrefix.length)
          : null,
      );
    if (regionId) return regionId;
    current = current.parent;
  }

  current = object;
  while (current) {
    const regionId = getRegionIdFromNodeName(current.name);
    if (regionId) return regionId;
    current = current.parent;
  }

  return null;
}

function isHitProxy(object: THREE.Object3D) {
  return (
    object.userData.hitProxy === true ||
    object.name.startsWith(hitProxyPrefix)
  );
}

function expandProxyGeometry(
  geometry: THREE.BufferGeometry,
  scale: number,
) {
  geometry.computeBoundingBox();
  const center = geometry.boundingBox?.getCenter(new THREE.Vector3());
  if (!center) return;

  geometry.translate(-center.x, -center.y, -center.z);
  geometry.scale(scale, scale, scale);
  geometry.translate(center.x, center.y, center.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function createSelectionFocusIntent(
  regionId: RegionId,
  intersections: readonly THREE.Intersection<THREE.Object3D>[],
): BrainSelectionFocusIntent {
  if (ENCLOSED_REGION_IDS.has(regionId)) return { regionId };
  const visibleHit = intersections.find(
    (intersection) =>
      getBrainIntersectionRegionId(intersection) === regionId &&
      intersection.object.userData.hitProxy !== true &&
      intersection.object.visible,
  );
  if (!visibleHit) return { regionId };
  const localPoint = visibleHit.object.worldToLocal(
    visibleHit.point.clone(),
  );
  return {
    regionId,
    source: "canvas",
    objectUuid: visibleHit.object.uuid,
    localPoint: [localPoint.x, localPoint.y, localPoint.z],
  };
}

type BoundsTreeGeometry = THREE.BufferGeometry;

type RegionVisual = {
  material: THREE.MeshPhysicalMaterial;
  scanMaterial: THREE.MeshPhysicalMaterial;
  idleColor: THREE.Color;
  contextNeutral: THREE.Color;
  vividColor: THREE.Color;
  targetColor: THREE.Color;
  baseRoughness: number;
  baseClearcoat: number;
  interactionUniforms: TissueInteractionUniforms;
  enclosed: boolean;
  meshes: THREE.Mesh[];
};

type UnifiedCortexVisual = {
  material: THREE.MeshPhysicalMaterial;
  interactionUniforms: TissueInteractionUniforms;
  meshes: THREE.Mesh[];
};

type SectionFrame = {
  localNormal: THREE.Vector3;
  localPoint: THREE.Vector3;
  slabWidth: number;
  cutFace: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  presentation: THREE.Group;
};

type ImportedModelState = {
  root: THREE.Group;
  regionVisuals: Map<RegionId, RegionVisual>;
  unifiedCortexVisual: UnifiedCortexVisual;
  extractionGroups: Map<RegionId, THREE.Group>;
  xrayDepthMeshes: THREE.Mesh[];
  sectionFrames: Map<RegionId, SectionFrame>;
  volumePresentation: BrainVolumePresentation;
  internalPresentationMode: BrainInternalPresentationMode;
  scanOcclusionPlane: THREE.Vector4;
  ownedGeometries: Set<THREE.BufferGeometry>;
  boundsTreeGeometries: Set<BoundsTreeGeometry>;
  ownedMaterials: Set<THREE.Material>;
  ownedTextures: Set<THREE.Texture>;
  leaderSupportRegistry: RegionLeaderSupportRegistry;
};

function createInternalXrayStateMarker() {
  const marker = new THREE.Group();
  marker.name = "博物馆解剖切面状态标记";
  marker.userData.internalSectionVeil = true;
  marker.userData.sectionTreatment = {
    shape: "atlas-aligned-alpha-masked-cut-face",
    cutaway: "near-pial-volume-clipped-far-volume-retained",
    depthOcclusion: true,
    silhouetteContext: "retained-lit-pial-volume",
    filledSectionCap: true,
    selectedTissue: "aseg-slab-integrated-into-t1-section",
    responsiveFraming: "shared-scene-camera-framing",
    physicalEdge: "alpha-boundary-contact-seam",
    mountingContext: "none",
    sourceVolume: "T1.mgz",
    selectionVolume: "aseg.mgz",
    contourArcCount: 0,
    circleCount: 0,
    crosshairCount: 0,
    animatedScan: false,
    depthTick: "atlas-plane-position",
  };
  // The marker remains a diagnostic sibling of the atlas-space cut face.
  marker.userData.ownedGeometries = [];
  marker.userData.ownedMaterials = [];
  marker.visible = false;
  return marker;
}

function createXrayDepthPrepass(
  regionVisuals: ReadonlyMap<RegionId, RegionVisual>,
  ownedMaterials: Set<THREE.Material>,
) {
  const material = new THREE.MeshDepthMaterial({
    depthPacking: THREE.BasicDepthPacking,
    depthTest: true,
    depthWrite: true,
    colorWrite: false,
    side: THREE.FrontSide,
  });
  material.name = "Whole-cortex X-ray nearest-surface depth";
  ownedMaterials.add(material);
  const meshes: THREE.Mesh[] = [];
  regionVisuals.forEach((visual) => {
    if (visual.enclosed) return;
    visual.meshes.forEach((source) => {
      const depthMesh = new THREE.Mesh(source.geometry, material);
      depthMesh.name = `${source.name} X-ray depth prepass`;
      depthMesh.position.copy(source.position);
      depthMesh.quaternion.copy(source.quaternion);
      depthMesh.scale.copy(source.scale);
      depthMesh.matrixAutoUpdate = source.matrixAutoUpdate;
      if (!source.matrixAutoUpdate) depthMesh.matrix.copy(source.matrix);
      depthMesh.frustumCulled = source.frustumCulled;
      depthMesh.renderOrder = 4;
      depthMesh.visible = false;
      depthMesh.userData.xrayDepthPrepass = true;
      depthMesh.raycast = () => {};
      source.parent?.add(depthMesh);
      meshes.push(depthMesh);
    });
  });
  return meshes;
}

function createAtlasCutawayPresentation(
  atlasRoot: THREE.Object3D,
  textures: ReadonlyMap<RegionId, THREE.Texture>,
  ownedGeometries: Set<THREE.BufferGeometry>,
  ownedMaterials: Set<THREE.Material>,
) {
  const definitions: Readonly<
    Record<
      "hippocampus" | "amygdala" | "corpus-callosum",
      {
        point: readonly [number, number, number];
        normal: readonly [number, number, number];
        slabWidth: number;
        physicalSize: readonly [number, number];
      }
    >
  > = {
    hippocampus: {
      point: [0.45, 33.300004, -8.100001],
      normal: [0, 0, 1],
      slabWidth: 0.12,
      physicalSize: [144.000015, 117.900012],
    },
    amygdala: {
      point: [0, 28.800003, 2.7],
      normal: [0, 0, 1],
      slabWidth: 0.12,
      physicalSize: [141.300015, 126.900013],
    },
    "corpus-callosum": {
      point: [-0.9, 21.150002, -8.550001],
      normal: [-1, 0, 0],
      slabWidth: 0.08,
      physicalSize: [178.200019, 136.800014],
    },
  };
  const sectionFrames = new Map<RegionId, SectionFrame>();
  ENCLOSED_REGION_IDS.forEach((regionId) => {
    const definition =
      definitions[regionId as keyof typeof definitions];
    const texture = textures.get(regionId);
    if (!texture) {
      throw new Error(`Missing atlas cut-face texture for ${regionId}`);
    }
    const geometry = new THREE.PlaneGeometry(...definition.physicalSize);
    const cutFaceMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      color: "#fffaf7",
      transparent: true,
      alphaTest: 0.02,
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    cutFaceMaterial.name = `${regionId} T1 aseg cut-face material`;
    cutFaceMaterial.polygonOffset = true;
    cutFaceMaterial.polygonOffsetFactor = -1;
    cutFaceMaterial.polygonOffsetUnits = -1;
    const seamMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      color: "#120d0e",
      transparent: true,
      opacity: 0.42,
      alphaTest: 0.02,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    seamMaterial.name = `${regionId} cut-boundary contact material`;
    const cutFace = new THREE.Mesh(geometry, cutFaceMaterial);
    cutFace.name = `${regionId} atlas-aligned MRI cut face`;
    cutFace.renderOrder = 6;
    cutFace.raycast = () => {};
    cutFace.userData.atlasSectionTexture = true;
    cutFace.userData.sectionOrientation =
      regionId === "corpus-callosum" ? "sagittal" : "coronal";
    const seam = new THREE.Mesh(geometry, seamMaterial);
    seam.name = `${regionId} cut-boundary contact seam`;
    seam.scale.set(1.012, 1.012, 1);
    seam.position.z = -0.018;
    seam.renderOrder = 5;
    seam.raycast = () => {};
    const presentation = new THREE.Group();
    presentation.name = `${regionId} physical atlas cutaway`;
    presentation.position.set(...definition.point);
    presentation.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(...definition.normal).normalize(),
    );
    presentation.add(seam, cutFace);
    presentation.visible = false;
    presentation.userData.cutawayCached = true;
    presentation.userData.sourceTransform =
      "T1-vox2ras-tkr-to-atlas-display";
    atlasRoot.add(presentation);
    ownedGeometries.add(geometry);
    ownedMaterials.add(cutFaceMaterial);
    ownedMaterials.add(seamMaterial);
    sectionFrames.set(regionId, {
      localNormal: new THREE.Vector3(...definition.normal).normalize(),
      localPoint: new THREE.Vector3(...definition.point),
      slabWidth: definition.slabWidth,
      cutFace,
      presentation,
    });
  });
  return sectionFrames;
}

function buildRegionLeaderSupportRegistry(
  regionVisuals: ReadonlyMap<RegionId, RegionVisual>,
): RegionLeaderSupportRegistry {
  const samplesByRegion = new Map<
    RegionId,
    RegionLeaderSupportSample[]
  >();
  const meshUuidsByRegion = new Map<RegionId, string[]>(
    BRAIN_REGIONS.map((region) => [region.id, []]),
  );
  const foregroundMeshUuids: string[] = [];
  const externalSilhouetteMembers: RegionLeaderSupportRegistry["externalSilhouetteMembers"] =
    [];
  const registeredSilhouetteGeometries = new Set<THREE.BufferGeometry>();
  regionVisuals.forEach((visual, regionId) => {
    visual.meshes.forEach((mesh) => {
      foregroundMeshUuids.push(mesh.uuid);
      if (
        mesh.userData.regionLeaderSilhouetteRole ===
          REGION_LEADER_SILHOUETTE_ROLES.external &&
        !registeredSilhouetteGeometries.has(mesh.geometry)
      ) {
        registeredSilhouetteGeometries.add(mesh.geometry);
        externalSilhouetteMembers.push({
          stableId: String(mesh.userData.regionLeaderStableId),
          meshUuid: mesh.uuid,
          regionId,
          role: REGION_LEADER_SILHOUETTE_ROLES.external,
          sourceKind: "atlas-source",
        });
      }
    });
    meshUuidsByRegion.set(
      regionId,
      visual.meshes.map((mesh) => mesh.uuid),
    );
    const meshes = visual.meshes.slice(
      0,
      REGION_INFO_LEADER.maximumSupportSamplesPerRegion,
    );
    const samples: RegionLeaderSupportSample[] = [];
    const baseQuota = Math.max(
      1,
      Math.floor(
        REGION_INFO_LEADER.maximumSupportSamplesPerRegion /
          Math.max(1, meshes.length),
      ),
    );
    for (const mesh of meshes) {
      const position = mesh.geometry.getAttribute("position");
      const remaining =
        REGION_INFO_LEADER.maximumSupportSamplesPerRegion - samples.length;
      const quota = Math.min(baseQuota, remaining, position.count);
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const bounds = mesh.geometry.boundingBox;
      const voxelRepresentatives = new Map<string, number>();
      if (bounds && !bounds.isEmpty()) {
        const size = bounds.getSize(new THREE.Vector3());
        for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
          const voxelX = Math.min(
            3,
            Math.floor(
              ((position.getX(vertexIndex) - bounds.min.x) /
                Math.max(size.x, Number.EPSILON)) *
                4,
            ),
          );
          const voxelY = Math.min(
            3,
            Math.floor(
              ((position.getY(vertexIndex) - bounds.min.y) /
                Math.max(size.y, Number.EPSILON)) *
                4,
            ),
          );
          const voxelZ = Math.min(
            3,
            Math.floor(
              ((position.getZ(vertexIndex) - bounds.min.z) /
                Math.max(size.z, Number.EPSILON)) *
                4,
            ),
          );
          const key = `${voxelX}:${voxelY}:${voxelZ}`;
          if (!voxelRepresentatives.has(key)) {
            voxelRepresentatives.set(key, vertexIndex);
          }
        }
      }
      const spatialIndices = [...voxelRepresentatives.entries()]
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([, vertexIndex]) => vertexIndex);
      const candidateIndices = spatialIndices.length
        ? spatialIndices
        : [Math.floor((position.count - 1) / 2)];
      for (let sampleIndex = 0; sampleIndex < quota; sampleIndex += 1) {
        const vertexIndex =
          candidateIndices[
            Math.min(
              candidateIndices.length - 1,
              Math.floor(
                (sampleIndex * candidateIndices.length) / quota,
              ),
            )
          ];
        samples.push({
          meshUuid: mesh.uuid,
          componentId: mesh.uuid,
          localPoint: [
            position.getX(vertexIndex),
            position.getY(vertexIndex),
            position.getZ(vertexIndex),
          ],
        });
      }
      if (
        samples.length >=
        REGION_INFO_LEADER.maximumSupportSamplesPerRegion
      ) {
        break;
      }
    }
    samplesByRegion.set(regionId, samples);
  });
  const registeredRegionCount = [...meshUuidsByRegion.values()].filter(
    (uuids) => uuids.length > 0,
  ).length;
  return {
    samplesByRegion,
    meshUuidsByRegion,
    foregroundMeshUuids,
    externalSilhouetteMembers,
    registeredRegionCount,
  };
}

type ExtractionDiagnosticState = {
  requestedRegionId: RegionId | null;
  activeRegionId: RegionId | null;
  phase: "idle" | "holding";
  progress: number;
  easedProgress: number;
  rawProgress: number;
  timelineSeconds: number;
  groupVisible: boolean;
  exactRestored: boolean;
  visibleEnclosedRegionCount: number;
  selectionLuminance: {
    targetRegionId: RegionId | null;
    targetMean: number | null;
    nonTargetMean: number | null;
    ratio: number | null;
    selectedMeshIds: readonly string[];
    selectedMeshCount: number;
    globalDimmingApplied: false;
  };
};

function createInternalExtractionGroups(
  root: THREE.Group,
  regionVisuals: Map<RegionId, RegionVisual>,
) {
  root.updateMatrixWorld(true);
  const inverseRootWorld = root.matrixWorld.clone().invert();
  const groups = new Map<RegionId, THREE.Group>();
  ENCLOSED_REGION_IDS.forEach((regionId) => {
    const visual = regionVisuals.get(regionId);
    if (!visual?.meshes.length) return;
    const worldBounds = new THREE.Box3();
    for (const mesh of visual.meshes) {
      mesh.updateWorldMatrix(true, false);
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) {
        worldBounds.union(
          mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld),
        );
      }
    }
    if (worldBounds.isEmpty()) return;
    const worldCenter = worldBounds.getCenter(new THREE.Vector3());
    const rootCenter = worldCenter.applyMatrix4(inverseRootWorld);
    const group = new THREE.Group();
    group.name = `${regionId} extraction transform`;
    group.position.copy(rootCenter);
    group.userData.enclosedExtractionGroup = true;
    group.userData.regionId = regionId;
    root.add(group);
    group.updateMatrixWorld(true);
    for (const mesh of visual.meshes) {
      group.attach(mesh);
      mesh.visible = false;
      mesh.userData.extractionGroupRegionId = regionId;
    }
    group.updateWorldMatrix(true, true);
    const localBounds = new THREE.Box3();
    for (const mesh of visual.meshes) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) {
        mesh.updateMatrix();
        localBounds.union(
          mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix),
        );
      }
    }
    const sectionVeil = createInternalXrayStateMarker();
    group.add(sectionVeil);
    group.userData.internalSectionVeil = sectionVeil;
    group.userData.sectionVeilSize = localBounds
      .getSize(new THREE.Vector3())
      .toArray();
    group.userData.sectionLocalBounds = localBounds.clone();
    group.userData.originalPosition = group.position.clone();
    group.userData.originalQuaternion = group.quaternion.clone();
    group.userData.originalScale = group.scale.clone();
    groups.set(regionId, group);
  });
  root.updateMatrixWorld(true);
  return groups;
}

function ImportedBrain({
  url,
  modelAttempt,
  mobilePresentation,
  canvasHoveredRegionId,
  hoveredRegionId,
  selectedRegionId,
  onRegionHoverChange,
  onPointerExit,
  onRegionClick,
  shouldSuppressClick,
  prefersReducedMotion,
  leaderExtractionAnchorRef,
  leaderSupportRegistryRef,
}: BrainModelProps & { url: string }) {
  const gltf = getBrainAssetResource(url, modelAttempt).read();
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const internalPresentationMode = useMemo(
    () => resolveBrainInternalPresentationMode(),
    [],
  );
  const volumeData = getBrainVolumeResource(
    modelAttempt,
    internalPresentationMode === "volume-v23" ? "v23" : "v24",
  ).read();
  const [hippocampusTexture, amygdalaTexture, corpusCallosumTexture] =
    useTexture([
      "/textures/brain-sections/hippocampus-coronal.png",
      "/textures/brain-sections/amygdala-coronal.png",
      "/textures/brain-sections/corpus-callosum-sagittal.png",
    ]);
  const sectionTextures = useMemo(() => {
    const textures = new Map<RegionId, THREE.Texture>([
      ["hippocampus", hippocampusTexture],
      ["amygdala", amygdalaTexture],
      ["corpus-callosum", corpusCallosumTexture],
    ]);
    const anisotropy = Math.min(
      8,
      gl.capabilities.getMaxAnisotropy(),
    );
    textures.forEach((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = anisotropy;
      texture.needsUpdate = true;
    });
    return textures;
  }, [
    amygdalaTexture,
    corpusCallosumTexture,
    gl,
    hippocampusTexture,
  ]);
  const modelState = useMemo<ImportedModelState>(() => {
    const useBundledSurfacePortals = url === BUNDLED_BRAIN_MODEL_URL;
    const clonedScene = cloneSkeleton(gltf.scene);
    clonedScene.updateMatrixWorld(true);
    const atlasBounds = new THREE.Box3().setFromObject(clonedScene);
    const tissueVariationNormalization = measureAtlasTissueVariation(
      clonedScene,
      atlasBounds,
    );
    const tissueMaterials = new Map<RegionId, THREE.MeshPhysicalMaterial>();
    const regionVisuals = new Map<RegionId, RegionVisual>();
    const unifiedCortexMeshes: THREE.Mesh[] = [];
    const semanticMeshCounts = new Map<RegionId, number>();
    const ownedGeometries = new Set<THREE.BufferGeometry>();
    const boundsTreeGeometries = new Set<BoundsTreeGeometry>();
    const ownedMaterials = new Set<THREE.Material>();
    const ownedTextures = new Set<THREE.Texture>();
    clonedScene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;

      if (object.userData.unifiedCortex === true) {
        object.geometry = object.geometry.clone();
        bakeTissueVariation(
          object.geometry,
          object.matrixWorld,
          atlasBounds,
          tissueVariationNormalization,
          true,
        );
        object.userData.regionLeaderSilhouetteRole =
          REGION_LEADER_SILHOUETTE_ROLES.excluded;
        object.userData.unifiedCortexVisual = true;
        object.raycast = () => {};
        object.visible = true;
        object.castShadow = !mobilePresentation;
        object.receiveShadow = !mobilePresentation;
        unifiedCortexMeshes.push(object);
        ownedGeometries.add(object.geometry);
        return;
      }

      const regionId = findRegionId(object);
      const hitProxy = isHitProxy(object);
      const enclosedInternal =
        regionId !== null && ENCLOSED_REGION_IDS.has(regionId);
      object.userData.regionId = regionId;
      object.userData.hitProxy = hitProxy;
      object.userData.enclosedInternal = enclosedInternal;
      object.userData.regionLeaderSilhouetteRole = hitProxy
        ? REGION_LEADER_SILHOUETTE_ROLES.excluded
        : enclosedInternal
          ? REGION_LEADER_SILHOUETTE_ROLES.detached
          : regionId
            ? REGION_LEADER_SILHOUETTE_ROLES.external
            : REGION_LEADER_SILHOUETTE_ROLES.excluded;
      if (regionId) {
        const semanticIndex = semanticMeshCounts.get(regionId) ?? 0;
        object.userData.regionLeaderStableId =
          `${regionId}:atlas-source:${semanticIndex}`;
        semanticMeshCounts.set(regionId, semanticIndex + 1);
      }
      // Three.js raycasting intentionally includes invisible objects. Keeping
      // authored cortical proxies and enclosed structures hidden prevents
      // internal tissue from bleeding through the pial fissure while preserving
      // both proxy selection and reveal-ready internal geometry.
      object.visible = !hitProxy && !enclosedInternal;
      object.castShadow = object.visible && !mobilePresentation;
      object.receiveShadow = object.visible && !mobilePresentation;
      object.geometry = object.geometry.clone();
      if (regionId && !hitProxy) {
        bakeTissueVariation(
          object.geometry,
          object.matrixWorld,
          atlasBounds,
          tissueVariationNormalization,
          corticalRegionIds.has(regionId),
        );
      }
      ownedGeometries.add(object.geometry);
      if (
        hitProxy &&
        enclosedInternal &&
        !useBundledSurfacePortals
      ) {
        expandProxyGeometry(
          object.geometry,
          ENCLOSED_PROXY_RAYCAST_SCALE,
        );
        object.userData.raycastScale = ENCLOSED_PROXY_RAYCAST_SCALE;
      }
      if (regionId && !hitProxy) {
        const geometry = object.geometry as BoundsTreeGeometry;
        computeBoundsTree.call(geometry);
        object.raycast = acceleratedRaycast;
        object.userData.boundsTreeBuilt = true;
        boundsTreeGeometries.add(geometry);
      }

      if (regionId && !hitProxy) {
        let material = tissueMaterials.get(regionId);
        if (!material) {
          const tissue = createTissueMaterial(regionId);
          material = tissue.material;
          if (enclosedInternal) {
            material.transparent = false;
            material.opacity = 1;
            material.depthWrite = true;
            material.depthTest = true;
            material.depthFunc = THREE.LessEqualDepth;
            material.side = THREE.FrontSide;
          }
          tissueMaterials.set(regionId, material);
          ownedMaterials.add(material);
          const scanMaterial = createScanMaterialVariant(
            material,
            enclosedInternal,
          );
          ownedMaterials.add(scanMaterial);
          const idleColor = material.color.clone();
          const idleLuminance =
            idleColor.r * 0.2126 +
            idleColor.g * 0.7152 +
            idleColor.b * 0.0722;
          regionVisuals.set(regionId, {
            material,
            scanMaterial,
            idleColor,
            contextNeutral: new THREE.Color(
              idleLuminance,
              idleLuminance,
              idleLuminance,
            ),
            vividColor: getPresentationAccent(regionId),
            targetColor: new THREE.Color(),
            baseRoughness: material.roughness,
            baseClearcoat: material.clearcoat,
            interactionUniforms: tissue.interactionUniforms,
            enclosed: enclosedInternal,
            meshes: [],
          });
        }
        object.material = material;
        regionVisuals.get(regionId)?.meshes.push(object);
        if (enclosedInternal) {
          object.renderOrder = BRAIN_EXTRACTION.targetRenderOrder;
        }
      } else if (Array.isArray(object.material)) {
        object.material = object.material.map((material) => {
          const clone = material.clone();
          ownedMaterials.add(clone);
          return clone;
        });
      } else {
        object.material = object.material.clone();
        ownedMaterials.add(object.material);
      }
    });
    const unifiedCortexTissue = createTissueMaterial(
      "frontal-lobe",
      true,
    );
    ownedMaterials.add(unifiedCortexTissue.material);
    unifiedCortexMeshes.forEach((mesh) => {
      mesh.material = unifiedCortexTissue.material;
      mesh.name = "V34 unified welded pial cortex";
      mesh.userData.sharedSmoothNormals = true;
      mesh.userData.semanticMask =
        "verified FreeSurfer annotation vertex weights";
    });
    regionVisuals.forEach((visual, regionId) => {
      if (!corticalRegionIds.has(regionId)) return;
      visual.meshes.forEach((mesh) => {
        mesh.visible = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.userData.auxiliaryRegionHitGeometry = true;
      });
    });

    // Capture the authored atlas bounds before runtime-only portals are added so
    // System 2 centering and hero scale remain bit-for-bit unchanged.
    const bounds = atlasBounds.clone();
    if (useBundledSurfacePortals) {
      const portals = installBundledSurfaceAccessPortals(
        clonedScene,
        ENCLOSED_PROXY_RAYCAST_SCALE,
      );
      portals.replacedGeometries.forEach((geometry) => {
        ownedGeometries.delete(geometry);
        geometry.dispose();
      });
      portals.components.forEach(({ mesh }) => {
        ownedGeometries.add(mesh.geometry);
      });
    }

    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const longestSide = Math.max(size.x, size.y, size.z) || 1;
    clonedScene.position.sub(center);

    const root = new THREE.Group();
    root.name = "解剖脑图谱";
    // Keep bundled and configured GLBs in the same hero framing.
    root.scale.setScalar(4.875 / longestSide);
    root.add(clonedScene);
    const extractionGroups = createInternalExtractionGroups(
      root,
      regionVisuals,
    );
    const xrayDepthMeshes = createXrayDepthPrepass(
      regionVisuals,
      ownedMaterials,
    );
    const scanOcclusionPlane = new THREE.Vector4(1, 0, 0, 0);
    regionVisuals.forEach((visual) => {
      visual.interactionUniforms.scanPlane.value =
        scanOcclusionPlane;
    });
    const sectionFrames = createAtlasCutawayPresentation(
      clonedScene,
      sectionTextures,
      ownedGeometries,
      ownedMaterials,
    );
    const volumePresentation = createBrainVolumePresentation(
      volumeData,
      clonedScene,
      mobilePresentation,
      ownedGeometries,
      ownedMaterials,
      internalPresentationMode,
    );
    extractionGroups.forEach((group) => {
      const sectionVeil = group.userData
        .internalSectionVeil as THREE.Group | undefined;
      for (const geometry of (sectionVeil?.userData
        .ownedGeometries ?? []) as THREE.BufferGeometry[]) {
        ownedGeometries.add(geometry);
      }
      for (const material of (sectionVeil?.userData
        .ownedMaterials ?? []) as THREE.Material[]) {
        ownedMaterials.add(material);
      }
    });
    const leaderSupportRegistry =
      buildRegionLeaderSupportRegistry(regionVisuals);
    return {
      root,
      regionVisuals,
      unifiedCortexVisual: {
        material: unifiedCortexTissue.material,
        interactionUniforms:
          unifiedCortexTissue.interactionUniforms,
        meshes: unifiedCortexMeshes,
      },
      extractionGroups,
      xrayDepthMeshes,
      sectionFrames,
      volumePresentation,
      internalPresentationMode,
      scanOcclusionPlane,
      ownedGeometries,
      boundsTreeGeometries,
      ownedMaterials,
      ownedTextures,
      leaderSupportRegistry,
    };
  }, [
    gltf.scene,
    internalPresentationMode,
    mobilePresentation,
    sectionTextures,
    url,
    volumeData,
  ]);

  useEffect(() => {
    const prewarmFrame = requestAnimationFrame(() => {
      modelState.volumePresentation.finishPrewarm();
    });
    return () => cancelAnimationFrame(prewarmFrame);
  }, [modelState.volumePresentation]);

  useEffect(() => {
    leaderSupportRegistryRef.current =
      modelState.leaderSupportRegistry;
    return () => {
      if (
        leaderSupportRegistryRef.current ===
        modelState.leaderSupportRegistry
      ) {
        leaderSupportRegistryRef.current = null;
      }
    };
  }, [leaderSupportRegistryRef, modelState.leaderSupportRegistry]);

  useEffect(() => {
    ensureLifecycleResources(
      modelState.boundsTreeGeometries,
      (geometry) =>
        Boolean(
          (
            geometry as BoundsTreeGeometry & {
              boundsTree?: unknown;
            }
          ).boundsTree,
        ),
      (geometry) => computeBoundsTree.call(geometry),
    );

    return () => {
      onPointerExit();
      cleanupLifecycleResources(
        modelState.boundsTreeGeometries,
        (geometry) => disposeBoundsTree.call(geometry),
      );
      cleanupLifecycleResources(modelState.ownedGeometries, (geometry) =>
        geometry.dispose(),
      );
      cleanupLifecycleResources(modelState.ownedMaterials, (material) =>
        material.dispose(),
      );
      cleanupLifecycleResources(modelState.ownedTextures, (texture) =>
        texture.dispose(),
      );
    };
  }, [modelState, onPointerExit]);

  const extractionDiagnosticRef = useRef<ExtractionDiagnosticState>({
    requestedRegionId: null,
    activeRegionId: null,
    phase: "idle",
    progress: 0,
    easedProgress: 0,
    rawProgress: 0,
    timelineSeconds: 0,
    groupVisible: false,
    exactRestored: true,
    visibleEnclosedRegionCount: 0,
    selectionLuminance: {
      targetRegionId: null,
      targetMean: null,
      nonTargetMean: null,
      ratio: null,
      selectedMeshIds: [],
      selectedMeshCount: 0,
      globalDimmingApplied: false,
    },
  });
  const selectionMeshIdsRef = useRef<string[]>([]);
  const inSituScratch = useMemo(
    () => ({
      worldAnchor: new THREE.Vector3(),
      sectionPoint: new THREE.Vector3(),
      scanAxis: new THREE.Vector3(),
      cameraOffset: new THREE.Vector3(),
      worldQuaternion: new THREE.Quaternion(),
    }),
    [],
  );
  useEffect(() => {
    const leaderExtractionAnchor =
      leaderExtractionAnchorRef.current;
    leaderExtractionAnchor.regionId = null;
    leaderExtractionAnchor.progress = 0;
    leaderExtractionAnchor.reliable = false;
    modelState.extractionGroups.forEach((group) => {
      group.position.copy(group.userData.originalPosition);
      group.quaternion.copy(group.userData.originalQuaternion);
      group.scale.copy(group.userData.originalScale);
      group.visible = false;
    });
    return () => {
      leaderExtractionAnchor.regionId = null;
      leaderExtractionAnchor.progress = 0;
      leaderExtractionAnchor.reliable = false;
    };
  }, [leaderExtractionAnchorRef, modelState]);
  useEffect(() => {
    const diagnosticsWindow = window as Window & {
      __BRAIN_EXTRACTION__?: {
        getSnapshot: () => unknown;
      };
    };
    const previous = diagnosticsWindow.__BRAIN_EXTRACTION__;
    const diagnostics = {
      getSnapshot: () => {
        const current = extractionDiagnosticRef.current;
        const group = current.activeRegionId
          ? modelState.extractionGroups.get(current.activeRegionId)
          : undefined;
        const originalPosition = group?.userData
          .originalPosition as THREE.Vector3 | undefined;
        const originalQuaternion = group?.userData
          .originalQuaternion as THREE.Quaternion | undefined;
        const originalScale = group?.userData
          .originalScale as THREE.Vector3 | undefined;
        const sectionVeil = group?.userData
          .internalSectionVeil as THREE.Group | undefined;
        const localOffset =
          group && originalPosition
            ? group.position.clone().sub(originalPosition).toArray()
            : [0, 0, 0];
        const currentWorldBounds =
          group && group.visible
            ? new THREE.Box3().setFromObject(group)
            : null;
        const solidVolumeCutaway =
          modelState.internalPresentationMode === "volume-v27" ||
          modelState.internalPresentationMode === "volume-v28";
        const premiumXrayLocator =
          modelState.internalPresentationMode === "volume-v29" ||
          modelState.internalPresentationMode === "volume-v30" ||
          modelState.internalPresentationMode === "volume-v31" ||
          modelState.internalPresentationMode === "volume-v32" ||
          modelState.internalPresentationMode === "volume-v33";
        return {
          requestedRegionId: current.requestedRegionId,
          activeRegionId: current.activeRegionId,
          presentationMode:
            modelState.internalPresentationMode !== "cutaway"
              ? `atlas-${modelState.internalPresentationMode}`
              : "in-situ",
          phase: current.phase,
          progress: current.progress,
          easedProgress: current.easedProgress,
          rawProgress: current.rawProgress,
          timelineSeconds: current.timelineSeconds,
          scale: 1,
          worldOffset: [0, 0, 0],
          currentWorldOffset: [0, 0, 0],
          localOffset,
          authoredTransform: {
            position: originalPosition?.toArray() ?? null,
            quaternion: originalQuaternion?.toArray() ?? null,
            scale: originalScale?.toArray() ?? null,
          },
          currentTransform: group
            ? {
                position: group.position.toArray(),
                quaternion: group.quaternion.toArray(),
                scale: group.scale.toArray(),
              }
            : null,
          authoredTransformError:
            group && originalPosition && originalQuaternion && originalScale
              ? {
                  position: group.position.distanceTo(originalPosition),
                  quaternion: group.quaternion.angleTo(originalQuaternion),
                  scale: group.scale.distanceTo(originalScale),
                }
              : null,
          sectionVeilVisible: sectionVeil?.visible === true,
          sectionTreatment:
            modelState.internalPresentationMode !== "cutaway"
              ? {
                  shape:
                    premiumXrayLocator
                      ? "intact-pial-xray-with-strict-shell-mri-target-hierarchy"
                      : solidVolumeCutaway
                      ? "atlas-aligned-mri-face-at-solid-pial-cut"
                      : "brain-aligned-raymarched-depth-slab",
                  depthOcclusion:
                    premiumXrayLocator
                      ? "low-center-opacity-depth-resolved-fresnel-frontface"
                      : solidVolumeCutaway
                      ? "opaque-camera-far-pial-half"
                      : "front-to-back-compositing",
                  silhouetteContext:
                    premiumXrayLocator
                      ? "intact-neutral-pial-xray-shell"
                      : solidVolumeCutaway
                      ? "retained-solid-anatomical-specimen"
                      : "low-opacity-t1-volume",
                  selectedTissue:
                    premiumXrayLocator
                      ? "exact-nearest-aseg-three-dimensional-volume"
                      : solidVolumeCutaway
                      ? modelState.internalPresentationMode === "volume-v28"
                        ? "exact-nearest-atlas-wash-on-clean-brainmask-section"
                        : "exact-nearest-atlas-wash-with-inside-aa-contour"
                      : "aseg-mask-integrated-in-volume",
                  sourceVolume: "T1.mgz",
                  selectionVolume: "aseg.mgz",
                  supportVolume:
                    modelState.internalPresentationMode === "volume-v28" ||
                    premiumXrayLocator
                      ? "brainmask.mgz"
                      : "aseg-derived",
                  animatedScan: false,
                  mountingContext: "none",
                }
              : (sectionVeil?.userData.sectionTreatment ?? null),
          xrayDepthPrepassVisibleCount:
            modelState.xrayDepthMeshes.filter((mesh) => mesh.visible)
              .length,
          scanOcclusionPrepassVisibleCount: 0,
          atlasSectionTextureVisibleCount: [
            ...modelState.sectionFrames.values(),
          ].filter((frame) => frame.presentation.visible).length,
          realVolumeSectionVisible:
            current.activeRegionId !== null &&
            (solidVolumeCutaway || premiumXrayLocator
              ? modelState.volumePresentation.diagnosticPlane?.visible === true
              : modelState.volumePresentation.activeMesh.visible),
          internalPresentationMode:
            modelState.internalPresentationMode,
          volumeDiagnostics: {
            ...modelState.volumePresentation.diagnostics,
            visible: modelState.volumePresentation.activeMesh.visible,
            sampling: "stable-front-to-back",
            gradientLighting: "precomputed-octahedral",
            earlyTerminationAlpha: 0.965,
          },
          responsiveSectionLayout:
            current.activeRegionId === null
              ? null
              : {
                  mode:
                    modelState.internalPresentationMode !== "cutaway"
                      ? "atlas-scene-volume-slab"
                      : "atlas-scene-cut-face",
                  safeArea: "camera-frustum",
                },
          intentionalScanViewport:
            current.activeRegionId === null
              ? null
              : {
                  visible: ENCLOSED_REGION_IDS.has(
                    current.activeRegionId,
                  ),
                  projection:
                    premiumXrayLocator
                      ? "atlas-aligned-intact-brain-xray-locator"
                      : solidVolumeCutaway
                      ? "atlas-aligned-solid-anatomical-cutaway"
                      : modelState.internalPresentationMode !== "cutaway"
                        ? "atlas-aligned-raymarched-volume"
                        : "atlas-aligned-scene-plane",
                  perspectiveTiltDegrees: "camera-authored",
                  physicalThickness:
                    solidVolumeCutaway
                      ? modelState.internalPresentationMode === "volume-v28"
                        ? 0.9
                        : 3.2
                      : 0,
                  mountingHardwareCount: 0,
                },
          selectedSourceMeshVisibleCount:
            current.activeRegionId === null
              ? 0
              : (modelState.regionVisuals
                  .get(current.activeRegionId)
                  ?.meshes.filter((mesh) => mesh.visible).length ?? 0),
          visibleExteriorSourceMeshCount: [
            ...modelState.regionVisuals.values(),
          ].reduce(
            (count, visual) =>
              count +
              (visual.enclosed
                ? 0
                : visual.meshes.filter((mesh) => mesh.visible).length),
            0,
          ),
          scanOcclusionPlane:
            modelState.scanOcclusionPlane.toArray(),
          originalCentroid: currentWorldBounds
            ? currentWorldBounds
                .getCenter(new THREE.Vector3())
                .toArray()
            : null,
          finalCentroid: currentWorldBounds
            ? currentWorldBounds
                .getCenter(new THREE.Vector3())
                .toArray()
            : null,
          currentCentroid: currentWorldBounds
            ? currentWorldBounds
                .getCenter(new THREE.Vector3())
                .toArray()
            : null,
          originalBounds: currentWorldBounds
            ? {
                min: currentWorldBounds.min.toArray(),
                max: currentWorldBounds.max.toArray(),
              }
            : null,
          finalBounds: currentWorldBounds
            ? {
                min: currentWorldBounds.min.toArray(),
                max: currentWorldBounds.max.toArray(),
              }
            : null,
          currentWorldBounds: currentWorldBounds
            ? {
                min: currentWorldBounds.min.toArray(),
                max: currentWorldBounds.max.toArray(),
              }
            : null,
          groupVisible: current.groupVisible,
          exactRestored: current.exactRestored,
          contextRecessionTarget:
            current.activeRegionId === null
              ? 0
              : BRAIN_EXTRACTION.contextRecession,
          visibleEnclosedRegionCount:
            current.visibleEnclosedRegionCount,
          selectionLuminance: current.selectionLuminance,
          renderContracts: {
            context: {
              transparent: false,
              depthWrite: true,
              depthTest: true,
              side: "front",
              renderOrder: 4,
            },
            target: {
              transparent: true,
              depthWrite: true,
              depthTest: true,
              depthFunc: "less-equal",
              side: "front",
              renderOrder: 6,
            },
          },
          budgetDelta: {
            objects:
              modelState.xrayDepthMeshes.length +
              modelState.sectionFrames.size * 2 +
              2,
            draws:
              modelState.xrayDepthMeshes.length +
              (modelState.internalPresentationMode !== "cutaway" ? 1 : 2),
            passes: 0,
            materials: 8,
            textures: 6,
          },
        };
      },
    };
    diagnosticsWindow.__BRAIN_EXTRACTION__ = diagnostics;
    return () => {
      if (diagnosticsWindow.__BRAIN_EXTRACTION__ !== diagnostics) return;
      if (previous) diagnosticsWindow.__BRAIN_EXTRACTION__ = previous;
      else delete diagnosticsWindow.__BRAIN_EXTRACTION__;
    };
  }, [modelState]);
  useFrame((_, delta) => {
    leaderExtractionAnchorRef.current.regionId = null;
    leaderExtractionAnchorRef.current.progress = 0;
    leaderExtractionAnchorRef.current.reliable = false;
    const transitionRate = prefersReducedMotion ? 100_000 : 7.5;
    const activeInSituRegionId =
      selectedRegionId !== null &&
      ENCLOSED_REGION_IDS.has(selectedRegionId)
        ? selectedRegionId
        : null;
    const activeXrayRegionId =
      activeInSituRegionId ??
      (selectedRegionId === null &&
      hoveredRegionId !== null &&
      ENCLOSED_REGION_IDS.has(hoveredRegionId)
        ? hoveredRegionId
        : null);
    const volumeMode =
      modelState.internalPresentationMode !== "cutaway";
    const activeVolumeRegionId = volumeMode
      ? activeInSituRegionId
      : null;
    modelState.xrayDepthMeshes.forEach((mesh) => {
      mesh.visible =
        activeXrayRegionId !== null && activeInSituRegionId === null;
    });
    modelState.sectionFrames.forEach((frame, regionId) => {
      frame.presentation.visible =
        !volumeMode && regionId === activeInSituRegionId;
    });
    modelState.volumePresentation.setRegion(activeVolumeRegionId);
    modelState.volumePresentation.setVisible(
      activeVolumeRegionId !== null,
    );
    if (activeVolumeRegionId) {
      modelState.volumePresentation.updateCamera(camera);
    }
    let visibleEnclosedRegionCount = 0;
    modelState.extractionGroups.forEach((group, regionId) => {
      const originalPosition = group.userData
        .originalPosition as THREE.Vector3;
      const originalQuaternion = group.userData
        .originalQuaternion as THREE.Quaternion;
      const originalScale = group.userData
        .originalScale as THREE.Vector3;
      const selectedInSitu = regionId === activeInSituRegionId;
      const hoveredInSitu =
        activeInSituRegionId === null && hoveredRegionId === regionId;
      const sectionVeil = group.userData
        .internalSectionVeil as THREE.Group | undefined;
      group.position.copy(originalPosition);
      group.quaternion.copy(originalQuaternion);
      group.scale.copy(originalScale);
      group.visible = selectedInSitu || hoveredInSitu;
      if (group.visible) {
        visibleEnclosedRegionCount += 1;
      }
      if (sectionVeil) {
        sectionVeil.visible = selectedInSitu;
      }
      group.updateMatrixWorld(true);
      if (selectedInSitu && group.visible) {
        group.getWorldPosition(inSituScratch.worldAnchor);
        const anchor = leaderExtractionAnchorRef.current;
        anchor.regionId = regionId;
        anchor.point[0] = inSituScratch.worldAnchor.x;
        anchor.point[1] = inSituScratch.worldAnchor.y;
        anchor.point[2] = inSituScratch.worldAnchor.z;
        anchor.originPoint[0] = inSituScratch.worldAnchor.x;
        anchor.originPoint[1] = inSituScratch.worldAnchor.y;
        anchor.originPoint[2] = inSituScratch.worldAnchor.z;
        anchor.progress = 1;
        anchor.reliable = true;
      }
    });
    const sectionFrame = activeInSituRegionId
      ? modelState.sectionFrames.get(activeInSituRegionId)
      : undefined;
    if (sectionFrame) {
      sectionFrame.cutFace.getWorldQuaternion(
        inSituScratch.worldQuaternion,
      );
      inSituScratch.scanAxis
        .set(0, 0, 1)
        .applyQuaternion(inSituScratch.worldQuaternion)
        .normalize();
      sectionFrame.cutFace.getWorldPosition(inSituScratch.sectionPoint);
      modelState.scanOcclusionPlane.set(
        inSituScratch.scanAxis.x,
        inSituScratch.scanAxis.y,
        inSituScratch.scanAxis.z,
        inSituScratch.scanAxis.dot(inSituScratch.sectionPoint),
      );
      modelState.regionVisuals.forEach((visual) => {
        visual.interactionUniforms.scanSlabWidth.value =
          sectionFrame.slabWidth;
      });
    }
    extractionDiagnosticRef.current.requestedRegionId =
      activeInSituRegionId;
    extractionDiagnosticRef.current.activeRegionId =
      activeInSituRegionId;
    extractionDiagnosticRef.current.phase = activeInSituRegionId
      ? "holding"
      : "idle";
    extractionDiagnosticRef.current.progress = activeInSituRegionId
      ? 1
      : 0;
    extractionDiagnosticRef.current.easedProgress =
      extractionDiagnosticRef.current.progress;
    extractionDiagnosticRef.current.rawProgress =
      extractionDiagnosticRef.current.progress;
    extractionDiagnosticRef.current.timelineSeconds = 0;
    extractionDiagnosticRef.current.groupVisible =
      visibleEnclosedRegionCount === 1;
    extractionDiagnosticRef.current.exactRestored =
      true;
    extractionDiagnosticRef.current.visibleEnclosedRegionCount =
      visibleEnclosedRegionCount;
    let targetLuminanceTotal = 0;
    let targetLuminanceCount = 0;
    let nonTargetLuminanceTotal = 0;
    let nonTargetLuminanceCount = 0;
    const selectedMeshIds = selectionMeshIdsRef.current;
    selectedMeshIds.length = 0;
    modelState.regionVisuals.forEach((visual, regionId) => {
      const selectedVisualRegionId = selectedRegionId;
      const visualState: RegionVisualState = getSemanticRegionVisualState(
        regionId,
        hoveredRegionId,
        selectedVisualRegionId,
      );
      const semanticAccentId = getSemanticRegionAccentId(
        regionId,
        hoveredRegionId,
        selectedVisualRegionId,
      );
      const semanticAccent =
        modelState.regionVisuals.get(semanticAccentId)?.vividColor ??
        visual.vividColor;
      const target = REGION_VISUAL_TARGETS[visualState];
      const material = visual.material;
      const xrayShell =
        activeInSituRegionId !== null &&
        !volumeMode &&
        !visual.enclosed;
      const volumeShell =
        activeInSituRegionId !== null &&
        volumeMode &&
        !visual.enclosed;

      const idleLuminance =
        visual.idleColor.r * 0.2126 +
        visual.idleColor.g * 0.7152 +
        visual.idleColor.b * 0.0722;
      const accentLuminance = Math.max(
        semanticAccent.r * 0.2126 +
          semanticAccent.g * 0.7152 +
          semanticAccent.b * 0.0722,
        0.001,
      );
      visual.targetColor
        .copy(semanticAccent)
        .multiplyScalar(idleLuminance / accentLuminance)
        .lerp(visual.idleColor, 1 - target.colorMix);
      const externalSelectionActive =
        selectedRegionId !== null &&
        !ENCLOSED_REGION_IDS.has(selectedRegionId);
      if (visualState === "selected" && !visual.enclosed) {
        visual.targetColor.lerp(visual.idleColor, 0.55);
      } else if (
        externalSelectionActive &&
        visualState === "context" &&
        !visual.enclosed
      ) {
        visual.targetColor.copy(visual.idleColor);
      }
      const contextRecession =
        externalSelectionActive && !visual.enclosed
          ? 0
          : selectedRegionId !== null &&
        ENCLOSED_REGION_IDS.has(selectedRegionId) &&
        !visual.enclosed
          ? Math.max(
              target.contextRecession,
              BRAIN_EXTRACTION.contextRecession,
            )
          : target.contextRecession;
      if (contextRecession > 0) {
        visual.targetColor.lerp(visual.contextNeutral, contextRecession);
        if (!xrayShell) {
          visual.targetColor.multiplyScalar(1 - contextRecession);
        }
      }
      material.color.r = THREE.MathUtils.damp(
        material.color.r,
        visual.targetColor.r,
        transitionRate,
        delta,
      );
      material.color.g = THREE.MathUtils.damp(
        material.color.g,
        visual.targetColor.g,
        transitionRate,
        delta,
      );
      material.color.b = THREE.MathUtils.damp(
        material.color.b,
        visual.targetColor.b,
        transitionRate,
        delta,
      );
      const externalContextFill =
        externalSelectionActive &&
        visualState === "context" &&
        !visual.enclosed;
      const targetEmissiveColor = externalContextFill
        ? visual.idleColor
        : semanticAccent;
      const targetEmissiveIntensity = externalContextFill
        ? 0
        : target.emissiveIntensity;
      material.emissive.r = THREE.MathUtils.damp(
        material.emissive.r,
        targetEmissiveColor.r,
        transitionRate,
        delta,
      );
      material.emissive.g = THREE.MathUtils.damp(
        material.emissive.g,
        targetEmissiveColor.g,
        transitionRate,
        delta,
      );
      material.emissive.b = THREE.MathUtils.damp(
        material.emissive.b,
        targetEmissiveColor.b,
        transitionRate,
        delta,
      );
      material.emissiveIntensity = THREE.MathUtils.damp(
        material.emissiveIntensity,
        targetEmissiveIntensity,
        transitionRate,
        delta,
      );
      material.roughness = THREE.MathUtils.damp(
        material.roughness,
        externalContextFill
          ? visual.baseRoughness
          : visual.baseRoughness + target.roughnessOffset,
        transitionRate,
        delta,
      );
      material.clearcoat = THREE.MathUtils.damp(
        material.clearcoat,
        externalContextFill
          ? visual.baseClearcoat
          : visual.baseClearcoat + target.clearcoatOffset,
        transitionRate,
        delta,
      );
      visual.interactionUniforms.selectedRimIntensity.value =
        THREE.MathUtils.damp(
          visual.interactionUniforms.selectedRimIntensity.value,
          target.selectedRimIntensity,
          transitionRate,
          delta,
        );
      visual.interactionUniforms.selectedRimColor.value.copy(
        semanticAccent,
      );
      const targetWashStrength =
        visualState === "selected"
          ? visual.enclosed
            ? 0.2
            : 0.18
          : visualState === "hovered"
            ? visual.enclosed
              ? 0.12
              : 0.17
            : 0;
      visual.interactionUniforms.regionWashStrength.value =
        THREE.MathUtils.damp(
          visual.interactionUniforms.regionWashStrength.value,
          targetWashStrength,
          transitionRate,
          delta,
        );
      visual.interactionUniforms.scanShellStrength.value =
        THREE.MathUtils.damp(
          visual.interactionUniforms.scanShellStrength.value,
          xrayShell ? 1 : 0,
          transitionRate,
          delta,
        );
      visual.interactionUniforms.internalScanStrength.value =
        THREE.MathUtils.damp(
          visual.interactionUniforms.internalScanStrength.value,
          visual.enclosed && activeInSituRegionId === regionId
            ? 1
            : 0,
          transitionRate,
          delta,
        );
      visual.scanMaterial.emissiveIntensity =
        material.emissiveIntensity;
      visual.scanMaterial.roughness = material.roughness;
      visual.scanMaterial.clearcoat = material.clearcoat;

      if (visual.enclosed) {
        const renderState = getEnclosedRenderState(
          regionId,
          hoveredRegionId,
          selectedVisualRegionId,
          activeXrayRegionId === regionId,
        );
        const renderMaterial =
          activeXrayRegionId === regionId
            ? visual.scanMaterial
            : material;
        if (activeXrayRegionId === regionId) {
          renderMaterial.roughness = 0.68;
          renderMaterial.clearcoat = 0;
        }
        renderMaterial.depthWrite = renderState.depthWrite;
        renderMaterial.depthTest = renderState.depthTest;
        renderMaterial.depthFunc =
          renderState.depthFunc === "less-equal"
            ? THREE.LessEqualDepth
            : THREE.GreaterDepth;
        visual.meshes.forEach((mesh) => {
          if (mesh.material !== renderMaterial) {
            mesh.material = renderMaterial;
          }
          mesh.visible =
            renderState.visible && activeInSituRegionId !== regionId;
          mesh.renderOrder = renderState.renderOrder;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
        });
        renderMaterial.opacity = THREE.MathUtils.damp(
          renderMaterial.opacity,
          renderState.opacity,
          transitionRate,
          delta,
        );
        if (
          regionId !== selectedRegionId &&
          hoveredRegionId !== regionId
        ) {
          renderMaterial.opacity = 0;
          visual.meshes.forEach((mesh) => {
            mesh.visible = false;
            mesh.castShadow = false;
          });
        }
        if (
          renderState.opacity === 0 &&
          renderMaterial.opacity < 0.002
        ) {
          renderMaterial.opacity = 0;
          visual.meshes.forEach((mesh) => {
            mesh.visible = false;
            mesh.castShadow = false;
          });
        }
      } else {
        const shellState = getCorticalShellRenderState(
          activeInSituRegionId !== null,
        );
        const renderMaterial = xrayShell
          ? visual.scanMaterial
          : material;
        renderMaterial.transparent = shellState.transparent;
        renderMaterial.opacity = THREE.MathUtils.damp(
          renderMaterial.opacity,
          shellState.opacity,
          transitionRate,
          delta,
        );
        renderMaterial.depthWrite = shellState.depthWrite;
        renderMaterial.depthTest = shellState.depthTest;
        visual.meshes.forEach((mesh) => {
          if (mesh.material !== renderMaterial) {
            mesh.material = renderMaterial;
          }
          mesh.visible = !volumeShell;
          mesh.renderOrder = shellState.renderOrder;
          mesh.castShadow =
            !mobilePresentation && activeInSituRegionId === null;
          mesh.receiveShadow =
            !mobilePresentation && activeInSituRegionId === null;
        });
      }
      if (corticalRegionIds.has(regionId)) {
        const materialLuminance =
          material.color.r * 0.2126 +
          material.color.g * 0.7152 +
          material.color.b * 0.0722;
        if (visualState === "selected") {
          targetLuminanceTotal += materialLuminance;
          targetLuminanceCount += 1;
          visual.meshes.forEach((mesh) => {
            selectedMeshIds.push(mesh.name || mesh.uuid);
          });
        } else {
          nonTargetLuminanceTotal += materialLuminance;
          nonTargetLuminanceCount += 1;
        }
      }
    });
    const unifiedCortex = modelState.unifiedCortexVisual;
    const activeUnifiedRegionId =
      selectedRegionId && corticalRegionIds.has(selectedRegionId)
        ? selectedRegionId
        : !selectedRegionId &&
            hoveredRegionId &&
            corticalRegionIds.has(hoveredRegionId)
          ? hoveredRegionId
          : null;
    const activeUnifiedRegionIndex = activeUnifiedRegionId
      ? corticalRegionIndex.get(activeUnifiedRegionId)
      : undefined;
    const selectionWeights =
      unifiedCortex.interactionUniforms.cortexSelectionWeights.value;
    selectionWeights.set(0, 0, 0, 0);
    setNumericUniform(
      unifiedCortex.interactionUniforms.cortexSelectionWeight4,
      0,
    );
    if (activeUnifiedRegionIndex !== undefined) {
      if (activeUnifiedRegionIndex < 4) {
        selectionWeights.setComponent(activeUnifiedRegionIndex, 1);
      } else {
        setNumericUniform(
          unifiedCortex.interactionUniforms.cortexSelectionWeight4,
          1,
        );
      }
    }
    const unifiedAccent = activeUnifiedRegionId
      ? activeUnifiedRegionId === "temporal-lobe"
        ? TEMPORAL_SURFACE_ACCENT
        : getPresentationAccent(activeUnifiedRegionId)
      : getPresentationAccent("temporal-lobe");
    unifiedCortex.interactionUniforms.selectedRimColor.value.copy(
      unifiedAccent,
    );
    setNumericUniform(
      unifiedCortex.interactionUniforms.regionWashStrength,
      THREE.MathUtils.damp(
        unifiedCortex.interactionUniforms.regionWashStrength.value,
        activeUnifiedRegionId
          ? selectedRegionId === activeUnifiedRegionId
            ? 0.4
            : 0.1
          : 0,
        transitionRate,
        delta,
      ),
    );
    setNumericUniform(
      unifiedCortex.interactionUniforms.selectedRimIntensity,
      THREE.MathUtils.damp(
        unifiedCortex.interactionUniforms.selectedRimIntensity.value,
        activeUnifiedRegionId
          ? selectedRegionId === activeUnifiedRegionId
            ? 0.065
            : 0.025
          : 0,
        transitionRate,
        delta,
      ),
    );
    unifiedCortex.meshes.forEach((mesh) => {
      mesh.visible = activeInSituRegionId === null;
      mesh.castShadow =
        !mobilePresentation && activeInSituRegionId === null;
      mesh.receiveShadow =
        !mobilePresentation && activeInSituRegionId === null;
    });
    modelState.regionVisuals.forEach((visual, regionId) => {
      if (!corticalRegionIds.has(regionId)) return;
      visual.meshes.forEach((mesh) => {
        mesh.visible = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      });
    });
    if (
      selectedRegionId &&
      corticalRegionIds.has(selectedRegionId)
    ) {
      selectedMeshIds.length = 0;
      selectedMeshIds.push(
        ...unifiedCortex.meshes.map((mesh) => mesh.name || mesh.uuid),
      );
      const unifiedLuminance =
        unifiedCortex.material.color.r * 0.2126 +
        unifiedCortex.material.color.g * 0.7152 +
        unifiedCortex.material.color.b * 0.0722;
      targetLuminanceTotal = unifiedLuminance;
      targetLuminanceCount = 1;
    }
    const targetMean =
      targetLuminanceCount > 0
        ? targetLuminanceTotal / targetLuminanceCount
        : null;
    const nonTargetMean =
      nonTargetLuminanceCount > 0
        ? nonTargetLuminanceTotal / nonTargetLuminanceCount
        : null;
    extractionDiagnosticRef.current.selectionLuminance = {
      targetRegionId:
        selectedRegionId && !ENCLOSED_REGION_IDS.has(selectedRegionId)
          ? selectedRegionId
          : null,
      targetMean,
      nonTargetMean,
      ratio:
        targetMean !== null && nonTargetMean !== null && nonTargetMean > 0
          ? targetMean / nonTargetMean
          : null,
      selectedMeshIds,
      selectedMeshCount: selectedMeshIds.length,
      globalDimmingApplied: false,
    };
  });

  const handleClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      if (
        event.delta > BRAIN_DRAG_THRESHOLD_CSS_PX ||
        shouldSuppressClick()
      ) {
        event.stopPropagation();
        return;
      }
      const regionId = resolveBrainInteraction(event.intersections);
      if (!regionId) return;
      event.stopPropagation();
      onRegionClick(
        regionId,
        createSelectionFocusIntent(regionId, event.intersections),
      );
    },
    [onRegionClick, shouldSuppressClick],
  );

  const handlePointerIntersection = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (event.pointerType !== "mouse") {
        onPointerExit();
        return;
      }
      const regionId = resolveBrainInteraction(event.intersections);
      if (!regionId) return;

      event.stopPropagation();
      if (regionId !== canvasHoveredRegionId) {
        onRegionHoverChange(regionId, true);
      }
    },
    [canvasHoveredRegionId, onPointerExit, onRegionHoverChange],
  );

  return (
    <primitive
      object={modelState.root}
      onClick={handleClick}
      onPointerMove={handlePointerIntersection}
      onPointerOver={handlePointerIntersection}
    />
  );
}

export function BrainModel(props: BrainModelProps) {
  return (
    <ImportedBrain
      url={BRAIN_MODEL_URL}
      {...props}
    />
  );
}
