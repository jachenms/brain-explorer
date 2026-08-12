import * as THREE from "three";

import type {
  BrainVolumeData,
  BrainVolumeRegion,
} from "./brain-volume-resource";
import type { RegionId } from "./brain-regions";

export type BrainInternalPresentationMode =
  | "cutaway"
  | "volume-v23"
  | "volume-v24"
  | "volume-v25"
  | "volume-v26"
  | "volume-v27"
  | "volume-v28"
  | "volume-v29"
  | "volume-v30"
  | "volume-v31"
  | "volume-v32"
  | "volume-v33";

type VolumeUniforms = {
  uIntensity: { value: THREE.Data3DTexture };
  uMasks: { value: THREE.Data3DTexture };
  uLabels: { value: THREE.Data3DTexture };
  uGradient: { value: THREE.Data3DTexture };
  uCameraObject: { value: THREE.Vector3 };
  uSlabAxis: { value: number };
  uSlabCenter: { value: number };
  uSlabHalfDepth: { value: number };
  uMaskChannel: { value: THREE.Vector3 };
  uMaskBit: { value: number };
  uVolumeDimensions: { value: THREE.Vector3 };
  uContextHalfVoxels: { value: number };
  uTargetBoundsMin: { value: THREE.Vector3 };
  uTargetBoundsMax: { value: THREE.Vector3 };
  uAccent: { value: THREE.Color };
  uContextOpacity: { value: number };
  uTargetOpacity: { value: number };
  uVisibility: { value: number };
};

export type BrainVolumePresentation = Readonly<{
  group: THREE.Group;
  desktopMesh: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>;
  mobileMesh: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>;
  activeMesh: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>;
  contextShell: THREE.Group;
  diagnosticPlane:
    | THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
    | null;
  uniforms: VolumeUniforms;
  setRegion: (regionId: RegionId | null) => void;
  setVisible: (visible: boolean) => void;
  updateCamera: (camera: THREE.Camera) => void;
  finishPrewarm: () => void;
  diagnostics: {
    resolution: readonly [number, number, number];
    raySteps: number;
    gpuMemoryBytes: number;
    payloadBytes: number;
    contextShellMeshCount: number;
    exactDiagnosticPlane: boolean;
    architecture: string;
    intensityReconstruction: string;
    labelSampling: string;
    targetPresentation: string;
  };
}>;

const VOLUME_ACCENTS: Readonly<
  Record<"hippocampus" | "amygdala" | "corpus-callosum", string>
> = {
  hippocampus: "#d68bb8",
  amygdala: "#d980a5",
  "corpus-callosum": "#c6ae72",
};

const vertexShader = /* glsl */ `
  out vec3 vVolumePosition;

  void main() {
    vVolumePosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

function fragmentShaderV23(maxSteps: number) {
  return /* glsl */ `
    precision highp float;
    precision highp sampler3D;

    uniform sampler3D uIntensity;
    uniform sampler3D uMasks;
    uniform sampler3D uGradient;
    uniform vec3 uCameraObject;
    uniform float uSlabAxis;
    uniform float uSlabCenter;
    uniform float uSlabHalfDepth;
    uniform vec3 uMaskChannel;
    uniform vec3 uAccent;
    uniform float uContextOpacity;
    uniform float uTargetOpacity;
    uniform float uVisibility;

    in vec3 vVolumePosition;
    out vec4 outColor;

    vec2 intersectUnitBox(vec3 origin, vec3 direction) {
      vec3 reciprocal = 1.0 / direction;
      vec3 lower = (-0.5 - origin) * reciprocal;
      vec3 upper = (0.5 - origin) * reciprocal;
      vec3 nearPlane = min(lower, upper);
      vec3 farPlane = max(lower, upper);
      float nearDistance = max(max(nearPlane.x, nearPlane.y), nearPlane.z);
      float farDistance = min(min(farPlane.x, farPlane.y), farPlane.z);
      return vec2(nearDistance, farDistance);
    }

    vec3 decodeOctahedral(vec2 encoded) {
      vec2 folded = encoded * 2.0 - 1.0;
      vec3 normal = vec3(
        folded,
        1.0 - abs(folded.x) - abs(folded.y)
      );
      if (normal.z < 0.0) {
        normal.xy =
          (1.0 - abs(normal.yx)) *
          sign(normal.xy + vec2(0.000001));
      }
      return normalize(normal);
    }

    vec3 warmT1(float intensity) {
      vec3 shadow = vec3(0.075, 0.060, 0.064);
      vec3 middle = vec3(0.43, 0.375, 0.37);
      vec3 highlight = vec3(0.91, 0.845, 0.80);
      vec3 lower = mix(shadow, middle, smoothstep(0.05, 0.54, intensity));
      return mix(lower, highlight, smoothstep(0.48, 0.94, intensity));
    }

    void main() {
      if (uVisibility < 0.001) discard;

      vec3 rayDirection = normalize(vVolumePosition - uCameraObject);
      vec2 distances = intersectUnitBox(uCameraObject, rayDirection);
      float rayStart = max(distances.x, 0.0);
      float rayEnd = distances.y;
      if (rayEnd <= rayStart) discard;

      float rayLength = rayEnd - rayStart;
      float stepLength = rayLength / float(${maxSteps});
      vec3 position = uCameraObject + rayDirection * (rayStart + stepLength * 0.5);
      vec4 accumulated = vec4(0.0);

      for (int sampleIndex = 0; sampleIndex < ${maxSteps}; sampleIndex++) {
        if (accumulated.a > 0.965) break;
        vec3 displayCoordinate = position + 0.5;
        vec3 textureCoordinate = vec3(
          1.0 - displayCoordinate.x,
          1.0 - displayCoordinate.y,
          displayCoordinate.z
        );
        float slabCoordinate = mix(
          textureCoordinate.x,
          textureCoordinate.z,
          step(1.5, uSlabAxis)
        );
        bool inside =
          all(greaterThanEqual(textureCoordinate, vec3(0.0))) &&
          all(lessThanEqual(textureCoordinate, vec3(1.0))) &&
          abs(slabCoordinate - uSlabCenter) <= uSlabHalfDepth;
        if (inside) {
          float intensity = texture(uIntensity, textureCoordinate).r;
          if (intensity > 0.015) {
            float selection = dot(
              texture(uMasks, textureCoordinate).rgb,
              uMaskChannel
            );
            float tissue = smoothstep(0.025, 0.24, intensity);
            float whiteMatter = smoothstep(0.38, 0.9, intensity);
            float sampleAlpha =
              tissue * mix(uContextOpacity, uContextOpacity * 0.72, whiteMatter);
            sampleAlpha = max(sampleAlpha, selection * uTargetOpacity);

            vec3 sourceNormal = decodeOctahedral(
              texture(uGradient, textureCoordinate).rg
            );
            vec3 displayNormal = normalize(
              vec3(-sourceNormal.x, -sourceNormal.y, sourceNormal.z)
            );
            vec3 keyDirection = normalize(vec3(-0.46, 0.72, 0.52));
            float diffuse = 0.68 + 0.32 * max(dot(displayNormal, keyDirection), 0.0);
            float depthCue = mix(1.06, 0.78, float(sampleIndex) / float(${maxSteps}));
            vec3 color = warmT1(intensity) * diffuse * depthCue;
            if (selection > 0.01) {
              float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
              vec3 matchedAccent = uAccent * (luminance / max(
                dot(uAccent, vec3(0.2126, 0.7152, 0.0722)),
                0.001
              ));
              color = mix(color, matchedAccent, selection * 0.58);
              color *= 1.0 + selection * 0.12;
            }

            sampleAlpha *= uVisibility;
            accumulated.rgb +=
              (1.0 - accumulated.a) * color * sampleAlpha;
            accumulated.a +=
              (1.0 - accumulated.a) * sampleAlpha;
          }
        }
        position += rayDirection * stepLength;
      }

      if (accumulated.a < 0.008) discard;
      outColor = accumulated;
    }
  `;
}

function fragmentShaderV24(maxSteps: number) {
  return /* glsl */ `
    precision highp float;
    precision highp sampler3D;

    uniform sampler3D uIntensity;
    uniform sampler3D uLabels;
    uniform sampler3D uGradient;
    uniform vec3 uCameraObject;
    uniform vec3 uVolumeDimensions;
    uniform float uSlabAxis;
    uniform float uSlabCenter;
    uniform float uContextHalfVoxels;
    uniform float uMaskBit;
    uniform vec3 uAccent;
    uniform float uVisibility;

    in vec3 vVolumePosition;
    out vec4 outColor;

    vec2 intersectUnitBox(vec3 origin, vec3 direction) {
      vec3 directionSign = mix(
        vec3(-1.0),
        vec3(1.0),
        greaterThanEqual(direction, vec3(0.0))
      );
      vec3 reciprocal = directionSign / max(abs(direction), vec3(0.000001));
      vec3 lower = (-0.5 - origin) * reciprocal;
      vec3 upper = (0.5 - origin) * reciprocal;
      vec3 nearPlane = min(lower, upper);
      vec3 farPlane = max(lower, upper);
      return vec2(
        max(max(nearPlane.x, nearPlane.y), nearPlane.z),
        min(min(farPlane.x, farPlane.y), farPlane.z)
      );
    }

    vec3 localToTexture(vec3 localPosition) {
      vec3 displayCoordinate = localPosition + 0.5;
      return vec3(
        1.0 - displayCoordinate.x,
        1.0 - displayCoordinate.y,
        displayCoordinate.z
      );
    }

    float axisValue(vec3 value) {
      return mix(value.x, value.z, step(1.5, uSlabAxis));
    }

    float packedBit(float byteValue, float bitValue) {
      return mod(floor(byteValue / bitValue), 2.0);
    }

    vec3 decodeOctahedral(vec2 encoded) {
      vec2 folded = encoded * 2.0 - 1.0;
      vec3 normal = vec3(
        folded,
        1.0 - abs(folded.x) - abs(folded.y)
      );
      if (normal.z < 0.0) {
        normal.xy =
          (1.0 - abs(normal.yx)) *
          sign(normal.xy + vec2(0.000001));
      }
      return normalize(normal);
    }

    vec3 crispT1(float intensity) {
      float windowed = clamp((intensity - 0.5) * 1.18 + 0.5, 0.0, 1.0);
      vec3 csf = vec3(0.018, 0.014, 0.016);
      vec3 gray = vec3(0.34, 0.305, 0.30);
      vec3 whiteMatter = vec3(0.79, 0.75, 0.70);
      vec3 highlight = vec3(0.94, 0.90, 0.84);
      vec3 lower = mix(csf, gray, smoothstep(0.06, 0.38, windowed));
      vec3 upper = mix(gray, whiteMatter, smoothstep(0.36, 0.72, windowed));
      return mix(mix(lower, upper, smoothstep(0.30, 0.48, windowed)), highlight,
        smoothstep(0.78, 0.98, windowed));
    }

    void main() {
      if (uVisibility < 0.001) discard;

      vec3 rayDirection = normalize(vVolumePosition - uCameraObject);
      vec2 boxDistances = intersectUnitBox(uCameraObject, rayDirection);
      float boxStart = max(boxDistances.x, 0.0);
      float boxEnd = boxDistances.y;
      if (boxEnd <= boxStart) discard;

      vec3 textureOrigin = localToTexture(uCameraObject);
      vec3 textureDirection = vec3(
        -rayDirection.x,
        -rayDirection.y,
        rayDirection.z
      );
      float slabRate = axisValue(textureDirection);
      if (abs(slabRate) < 0.000001) discard;
      float slabDimension = axisValue(uVolumeDimensions);
      float contextHalfNormalized =
        uContextHalfVoxels / max(slabDimension - 1.0, 1.0);
      float firstSlabDistance =
        (uSlabCenter - contextHalfNormalized - axisValue(textureOrigin)) /
        slabRate;
      float lastSlabDistance =
        (uSlabCenter + contextHalfNormalized - axisValue(textureOrigin)) /
        slabRate;
      float rayStart = max(boxStart, min(firstSlabDistance, lastSlabDistance));
      float rayEnd = min(boxEnd, max(firstSlabDistance, lastSlabDistance));
      if (rayEnd <= rayStart) discard;

      float voxelSpeed = length(
        textureDirection * max(uVolumeDimensions - vec3(1.0), vec3(1.0))
      );
      float stepLength = 1.0 / max(voxelSpeed, 1.0);
      float stepVoxels = stepLength * voxelSpeed;
      vec3 position =
        uCameraObject + rayDirection * (rayStart + stepLength * 0.5);
      vec4 accumulated = vec4(0.0);

      for (int sampleIndex = 0; sampleIndex < ${maxSteps}; sampleIndex++) {
        float rayDistance = rayStart + (float(sampleIndex) + 0.5) * stepLength;
        if (rayDistance > rayEnd || accumulated.a > 0.975) break;

        vec3 textureCoordinate = localToTexture(position);
        float slabCoordinate = axisValue(textureCoordinate);
        float centralDistanceVoxels =
          abs(slabCoordinate - uSlabCenter) * max(slabDimension - 1.0, 1.0);
        float centralWeight =
          1.0 - smoothstep(1.0, 1.5, centralDistanceVoxels);
        float contextDistance =
          centralDistanceVoxels / max(uContextHalfVoxels, 1.0);
        float contextFalloff =
          1.0 - smoothstep(0.35, 1.0, contextDistance);

        float intensity = texture(uIntensity, textureCoordinate).r;
        if (intensity > 0.012) {
          float labelByte =
            floor(texture(uLabels, textureCoordinate).r * 255.0 + 0.5);
          float selection = packedBit(labelByte, uMaskBit);
          float boundary = packedBit(labelByte, uMaskBit * 8.0);
          float semantic = max(selection, boundary * 0.82);
          float tissue = smoothstep(0.035, 0.18, intensity);

          vec3 sourceNormal = decodeOctahedral(
            texture(uGradient, textureCoordinate).rg
          );
          vec3 displayNormal = normalize(
            vec3(-sourceNormal.x, -sourceNormal.y, sourceNormal.z)
          );
          vec3 keyDirection = normalize(vec3(-0.42, 0.76, 0.49));
          float gradientLight =
            0.86 + 0.14 * max(dot(displayNormal, keyDirection), 0.0);
          vec3 color = crispT1(intensity) * gradientLight;
          color *= mix(0.62, 1.0, centralWeight);

          if (semantic > 0.01) {
            float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
            float accentLuminance = max(
              dot(uAccent, vec3(0.2126, 0.7152, 0.0722)),
              0.001
            );
            vec3 matchedAccent = uAccent * (luminance / accentLuminance);
            color = mix(
              color,
              matchedAccent,
              semantic * mix(0.52, 0.68, centralWeight)
            );
          }

          float contextAlpha =
            tissue * contextFalloff * 0.010 +
            selection * contextFalloff * 0.105 +
            boundary * contextFalloff * 0.035;
          float sectionAlpha =
            max(tissue * 0.60, selection * 0.82);
          sectionAlpha = max(sectionAlpha, boundary * 0.90);
          float baseAlpha = mix(contextAlpha, sectionAlpha, centralWeight);
          float sampleAlpha =
            1.0 - pow(max(1.0 - baseAlpha, 0.0001), stepVoxels);
          sampleAlpha *= uVisibility;

          accumulated.rgb +=
            (1.0 - accumulated.a) * color * sampleAlpha;
          accumulated.a +=
            (1.0 - accumulated.a) * sampleAlpha;
        }
        position += rayDirection * stepLength;
      }

      if (accumulated.a < 0.008) discard;
      outColor = accumulated;
    }
  `;
}

function replaceRequiredShaderSection(
  source: string,
  search: string,
  replacement: string,
) {
  if (!source.includes(search)) {
    throw new Error("V25 volume shader patch point is absent.");
  }
  return source.replace(search, replacement);
}

function fragmentShaderV25(maxSteps: number) {
  let source = fragmentShaderV24(maxSteps);
  source = replaceRequiredShaderSection(
    source,
    `    vec3 crispT1(float intensity) {
      float windowed = clamp((intensity - 0.5) * 1.18 + 0.5, 0.0, 1.0);
      vec3 csf = vec3(0.018, 0.014, 0.016);
      vec3 gray = vec3(0.34, 0.305, 0.30);
      vec3 whiteMatter = vec3(0.79, 0.75, 0.70);
      vec3 highlight = vec3(0.94, 0.90, 0.84);
      vec3 lower = mix(csf, gray, smoothstep(0.06, 0.38, windowed));
      vec3 upper = mix(gray, whiteMatter, smoothstep(0.36, 0.72, windowed));
      return mix(mix(lower, upper, smoothstep(0.30, 0.48, windowed)), highlight,
        smoothstep(0.78, 0.98, windowed));
    }`,
    `    vec3 crispT1(float intensity) {
      float windowed = clamp((intensity - 0.5) * 1.10 + 0.5, 0.0, 1.0);
      vec3 csf = vec3(0.012, 0.010, 0.012);
      vec3 deepGray = vec3(0.070, 0.064, 0.068);
      vec3 grayMatter = vec3(0.22, 0.205, 0.205);
      vec3 whiteMatter = vec3(0.44, 0.405, 0.375);
      vec3 cappedPeak = vec3(0.58, 0.535, 0.49);
      vec3 color = mix(csf, deepGray, smoothstep(0.055, 0.18, windowed));
      color = mix(color, grayMatter, smoothstep(0.17, 0.46, windowed));
      color = mix(color, whiteMatter, smoothstep(0.44, 0.76, windowed));
      return mix(color, cappedPeak, smoothstep(0.78, 0.98, windowed));
    }`,
  );
  source = replaceRequiredShaderSection(
    source,
    `        float contextFalloff =
          1.0 - smoothstep(0.35, 1.0, contextDistance);`,
    `        float contextFalloff =
          1.0 - smoothstep(0.42, 1.0, contextDistance);
        float depthFraction = clamp(
          (rayDistance - rayStart) / max(rayEnd - rayStart, 0.000001),
          0.0,
          1.0
        );`,
  );
  source = replaceRequiredShaderSection(
    source,
    `          float gradientLight =
            0.86 + 0.14 * max(dot(displayNormal, keyDirection), 0.0);
          vec3 color = crispT1(intensity) * gradientLight;
          color *= mix(0.62, 1.0, centralWeight);`,
    `          float contextGradientLight =
            0.96 + 0.06 * max(dot(displayNormal, keyDirection), 0.0);
          float gradientLight = mix(
            contextGradientLight,
            1.0,
            centralWeight
          );
          vec3 color = crispT1(intensity) * gradientLight;
          vec3 depthGrade = mix(
            vec3(1.055, 1.005, 0.965),
            vec3(0.88, 0.91, 0.96),
            depthFraction
          );
          color *= mix(depthGrade, vec3(1.0), centralWeight);
          color *= mix(0.90, 1.0, centralWeight);`,
  );
  source = replaceRequiredShaderSection(
    source,
    `              semantic * mix(0.52, 0.68, centralWeight)`,
    `              semantic * mix(0.36, 0.50, centralWeight)`,
  );
  source = replaceRequiredShaderSection(
    source,
    `          float contextAlpha =
            tissue * contextFalloff * 0.010 +
            selection * contextFalloff * 0.105 +
            boundary * contextFalloff * 0.035;
          float sectionAlpha =
            max(tissue * 0.60, selection * 0.82);
          sectionAlpha = max(sectionAlpha, boundary * 0.90);`,
    `          float contextAlpha =
            tissue * contextFalloff * 0.018 +
            selection * contextFalloff * 0.040 +
            boundary * contextFalloff * 0.018;
          contextAlpha *= mix(1.12, 0.72, depthFraction);
          float sectionAlpha =
            max(tissue * 0.54, selection * 0.64);
          sectionAlpha = max(sectionAlpha, boundary * 0.78);`,
  );
  return source;
}

function fragmentShaderV26(maxSteps: number) {
  let source = fragmentShaderV25(maxSteps);
  source = replaceRequiredShaderSection(
    source,
    `          float contextAlpha =
            tissue * contextFalloff * 0.018 +
            selection * contextFalloff * 0.040 +
            boundary * contextFalloff * 0.018;
          contextAlpha *= mix(1.12, 0.72, depthFraction);
          float sectionAlpha =
            max(tissue * 0.54, selection * 0.64);
          sectionAlpha = max(sectionAlpha, boundary * 0.78);
          float baseAlpha = mix(contextAlpha, sectionAlpha, centralWeight);`,
    `          float sidewallWeight = smoothstep(
            0.68,
            0.96,
            contextDistance
          );
          float contextAlpha =
            tissue * contextFalloff * 0.020 +
            tissue * sidewallWeight * 0.030 +
            selection * contextFalloff * 0.052 +
            boundary * contextFalloff * 0.020;
          contextAlpha *= mix(1.12, 0.76, depthFraction);
          float centralGap = smoothstep(
            0.55,
            1.05,
            centralDistanceVoxels
          );
          float baseAlpha = contextAlpha * centralGap;`,
  );
  return source;
}

function fragmentShaderV29Target(maxSteps: number) {
  return /* glsl */ `
    precision highp float;
    precision highp sampler3D;

    uniform sampler3D uLabels;
    uniform vec3 uCameraObject;
    uniform vec3 uVolumeDimensions;
    uniform vec3 uTargetBoundsMin;
    uniform vec3 uTargetBoundsMax;
    uniform float uMaskBit;
    uniform vec3 uAccent;
    uniform float uVisibility;

    in vec3 vVolumePosition;
    out vec4 outColor;

    vec3 localToTexture(vec3 localPosition) {
      vec3 displayCoordinate = localPosition + 0.5;
      return vec3(
        1.0 - displayCoordinate.x,
        1.0 - displayCoordinate.y,
        displayCoordinate.z
      );
    }

    float packedBit(float byteValue, float bitValue) {
      return mod(floor(byteValue / bitValue), 2.0);
    }

    float selectionAtVoxel(vec3 voxelIndex) {
      vec3 textureCoordinate =
        (clamp(
          voxelIndex,
          vec3(0.0),
          uVolumeDimensions - vec3(1.0)
        ) + 0.5) /
        uVolumeDimensions;
      if (
        any(lessThan(textureCoordinate, uTargetBoundsMin)) ||
        any(greaterThan(textureCoordinate, uTargetBoundsMax))
      ) {
        return 0.0;
      }
      float labelByte =
        floor(texture(uLabels, textureCoordinate).r * 255.0 + 0.5);
      return packedBit(labelByte, uMaskBit);
    }

    float displaySelectionAt(vec3 textureCoordinate) {
      vec3 voxelCoordinate =
        textureCoordinate * uVolumeDimensions - 0.5;
      vec3 baseVoxel = floor(voxelCoordinate);
      vec3 blend = fract(voxelCoordinate);
      float c000 = selectionAtVoxel(baseVoxel);
      float c100 = selectionAtVoxel(baseVoxel + vec3(1.0, 0.0, 0.0));
      float c010 = selectionAtVoxel(baseVoxel + vec3(0.0, 1.0, 0.0));
      float c110 = selectionAtVoxel(baseVoxel + vec3(1.0, 1.0, 0.0));
      float c001 = selectionAtVoxel(baseVoxel + vec3(0.0, 0.0, 1.0));
      float c101 = selectionAtVoxel(baseVoxel + vec3(1.0, 0.0, 1.0));
      float c011 = selectionAtVoxel(baseVoxel + vec3(0.0, 1.0, 1.0));
      float c111 = selectionAtVoxel(baseVoxel + vec3(1.0));
      float lower = mix(
        mix(c000, c100, blend.x),
        mix(c010, c110, blend.x),
        blend.y
      );
      float upper = mix(
        mix(c001, c101, blend.x),
        mix(c011, c111, blend.x),
        blend.y
      );
      return mix(lower, upper, blend.z);
    }

    vec2 intersectTargetBounds(vec3 origin, vec3 direction) {
      vec3 directionSign = mix(
        vec3(-1.0),
        vec3(1.0),
        greaterThanEqual(direction, vec3(0.0))
      );
      vec3 reciprocal =
        directionSign / max(abs(direction), vec3(0.000001));
      vec3 lower = (uTargetBoundsMin - origin) * reciprocal;
      vec3 upper = (uTargetBoundsMax - origin) * reciprocal;
      vec3 nearPlane = min(lower, upper);
      vec3 farPlane = max(lower, upper);
      return vec2(
        max(max(nearPlane.x, nearPlane.y), nearPlane.z),
        min(min(farPlane.x, farPlane.y), farPlane.z)
      );
    }

    void main() {
      if (uVisibility < 0.001) discard;

      vec3 rayDirection = normalize(vVolumePosition - uCameraObject);
      vec3 textureOrigin = localToTexture(uCameraObject);
      vec3 textureDirection = vec3(
        -rayDirection.x,
        -rayDirection.y,
        rayDirection.z
      );
      vec2 targetDistances = intersectTargetBounds(
        textureOrigin,
        textureDirection
      );
      float rayStart = max(targetDistances.x, 0.0);
      float rayEnd = targetDistances.y;
      if (rayEnd <= rayStart) discard;

      float voxelSpeed = length(
        textureDirection * max(uVolumeDimensions, vec3(1.0))
      );
      float stepLength = 0.58 / max(voxelSpeed, 1.0);
      float stepVoxels = stepLength * voxelSpeed;
      vec3 position =
        textureOrigin +
        textureDirection * (rayStart + stepLength * 0.35);
      vec4 accumulated = vec4(0.0);

      for (int sampleIndex = 0; sampleIndex < ${maxSteps}; sampleIndex++) {
        float rayDistance =
          rayStart + (float(sampleIndex) + 0.35) * stepLength;
        if (rayDistance > rayEnd || accumulated.a > 0.985) break;

        float selectionCoverage = displaySelectionAt(position);
        float selection = smoothstep(0.34, 0.66, selectionCoverage);
        if (selection > 0.01) {
          float boundary = clamp(
            1.0 - abs(selectionCoverage - 0.5) * 2.0,
            0.0,
            1.0
          );
          vec3 targetCenter =
            (uTargetBoundsMin + uTargetBoundsMax) * 0.5;
          vec3 targetExtent =
            max(uTargetBoundsMax - uTargetBoundsMin, vec3(0.0001));
          vec3 normal = normalize(
            (position - targetCenter) / targetExtent + vec3(0.00001)
          );
          float key = 0.5 + 0.5 * max(
            dot(normal, normalize(vec3(-0.42, 0.72, 0.55))),
            0.0
          );
          float rim = boundary * pow(
            1.0 - abs(dot(normal, normalize(-textureDirection))),
            1.6
          );
          vec3 targetColor =
            uAccent * (0.62 + key * 0.38) +
            mix(uAccent, vec3(1.0), 0.22) * rim * 0.42;
          float baseAlpha = mix(0.090, 0.31, boundary) * selection;
          baseAlpha += rim * 0.10;
          float sampleAlpha =
            1.0 - pow(max(1.0 - baseAlpha, 0.0001), stepVoxels);
          sampleAlpha *= uVisibility;
          accumulated.rgb +=
            (1.0 - accumulated.a) * targetColor * sampleAlpha;
          accumulated.a +=
            (1.0 - accumulated.a) * sampleAlpha;
        }
        position += textureDirection * stepLength;
      }

      if (accumulated.a < 0.008) discard;
      outColor = accumulated;
    }
  `;
}

const CONTEXT_SHELL_REGION_IDS = new Set<RegionId>([
  "frontal-lobe",
  "parietal-lobe",
  "temporal-lobe",
  "occipital-lobe",
  "cerebellum",
  "brain-stem",
  "prefrontal-cortex",
]);

function createV25ContextShell(
  atlasRoot: THREE.Object3D,
  boundsCenter: THREE.Vector3,
  boundsSize: THREE.Vector3,
  volumeUniforms: VolumeUniforms,
  ownedMaterials: Set<THREE.Material>,
) {
  const shellUniforms = {
    uAtlasWorldInverse: { value: new THREE.Matrix4() },
    uBoundsCenter: { value: boundsCenter.clone() },
    uBoundsSize: { value: boundsSize.clone() },
    uVolumeDimensions: volumeUniforms.uVolumeDimensions,
    uSlabAxis: volumeUniforms.uSlabAxis,
    uSlabCenter: volumeUniforms.uSlabCenter,
    uContextHalfVoxels: volumeUniforms.uContextHalfVoxels,
    uVisibility: volumeUniforms.uVisibility,
  };
  const material = new THREE.ShaderMaterial({
    name: "V25 slab-clipped pial backface context",
    uniforms: shellUniforms,
    vertexShader: /* glsl */ `
      uniform mat4 uAtlasWorldInverse;
      out vec3 vAtlasPosition;
      out vec3 vViewNormal;
      out vec3 vViewPosition;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vec4 viewPosition = viewMatrix * worldPosition;
        vAtlasPosition = (uAtlasWorldInverse * worldPosition).xyz;
        vViewNormal = normalize(normalMatrix * normal);
        vViewPosition = viewPosition.xyz;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 uBoundsCenter;
      uniform vec3 uBoundsSize;
      uniform vec3 uVolumeDimensions;
      uniform float uSlabAxis;
      uniform float uSlabCenter;
      uniform float uContextHalfVoxels;
      uniform float uVisibility;

      in vec3 vAtlasPosition;
      in vec3 vViewNormal;
      in vec3 vViewPosition;
      out vec4 outColor;

      float axisValue(vec3 value) {
        return mix(value.x, value.z, step(1.5, uSlabAxis));
      }

      void main() {
        vec3 displayCoordinate =
          (vAtlasPosition - uBoundsCenter) / uBoundsSize + 0.5;
        vec3 textureCoordinate = vec3(
          1.0 - displayCoordinate.x,
          1.0 - displayCoordinate.y,
          displayCoordinate.z
        );
        float slabDimension = axisValue(uVolumeDimensions);
        float slabDistanceVoxels =
          abs(axisValue(textureCoordinate) - uSlabCenter) *
          max(slabDimension - 1.0, 1.0);
        if (slabDistanceVoxels > uContextHalfVoxels) discard;

        float fresnel = pow(
          1.0 - abs(dot(
            normalize(vViewNormal),
            normalize(vViewPosition)
          )),
          2.2
        );
        float slabEdge = smoothstep(
          0.58,
          1.0,
          slabDistanceVoxels / max(uContextHalfVoxels, 1.0)
        );
        float alpha =
          (fresnel * 0.050 + slabEdge * 0.018) *
          uVisibility;
        vec3 color = mix(
          vec3(0.58, 0.39, 0.41),
          vec3(0.78, 0.53, 0.52),
          fresnel
        );
        outColor = vec4(color, alpha);
      }
    `,
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.BackSide,
    toneMapped: true,
  });
  material.customProgramCacheKey = () =>
    "brain-atlas-volume-v25-slab-context-shell";
  material.userData.volumeContextShell = {
    side: "back",
    clipping: "atlas-native-context-slab",
    frontFaceAlpha: 0,
    curvatureSilhouette: "fresnel",
  };
  ownedMaterials.add(material);

  atlasRoot.updateWorldMatrix(true, true);
  const inverseRootWorld = atlasRoot.matrixWorld.clone().invert();
  const candidates: THREE.Mesh[] = [];
  atlasRoot.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const regionId = object.userData.brainRegionId as RegionId | undefined;
    if (
      !regionId ||
      !CONTEXT_SHELL_REGION_IDS.has(regionId) ||
      object.userData.hitProxy === true
    ) {
      return;
    }
    candidates.push(object);
  });
  const shell = new THREE.Group();
  shell.name = "V25 slab-clipped pial context shell";
  const relativeMatrix = new THREE.Matrix4();
  candidates.forEach((source) => {
    source.updateWorldMatrix(true, false);
    relativeMatrix.multiplyMatrices(inverseRootWorld, source.matrixWorld);
    const clone = new THREE.Mesh(source.geometry, material);
    relativeMatrix.decompose(clone.position, clone.quaternion, clone.scale);
    clone.name = `${source.name} V25 context shell`;
    clone.renderOrder = 5;
    clone.raycast = () => {};
    clone.frustumCulled = true;
    shell.add(clone);
  });
  shell.visible = false;
  return { shell, shellUniforms };
}

function setDiagnosticPlaneTransform(
  plane: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>,
  region: BrainVolumeRegion,
  boundsCenter: THREE.Vector3,
  boundsSize: THREE.Vector3,
) {
  plane.position.copy(boundsCenter);
  plane.rotation.set(0, 0, 0);
  if (region.orientation === "sagittal") {
    plane.position.x +=
      (1.0 - region.normalizedCenter - 0.5) * boundsSize.x;
    plane.rotation.y = Math.PI / 2;
    plane.scale.set(boundsSize.z, boundsSize.y, 1);
    return;
  }
  plane.position.z += (region.normalizedCenter - 0.5) * boundsSize.z;
  plane.scale.set(boundsSize.x, boundsSize.y, 1);
}

function createV26DiagnosticPlane(
  data: BrainVolumeData,
  atlasRoot: THREE.Object3D,
  boundsCenter: THREE.Vector3,
  boundsSize: THREE.Vector3,
  volumeUniforms: VolumeUniforms,
  ownedGeometries: Set<THREE.BufferGeometry>,
  ownedMaterials: Set<THREE.Material>,
) {
  const uniforms = {
    uIntensity: volumeUniforms.uIntensity,
    uLabels: volumeUniforms.uLabels,
    uMaskBit: volumeUniforms.uMaskBit,
    uAccent: volumeUniforms.uAccent,
    uSlabAxis: volumeUniforms.uSlabAxis,
    uSlabCenter: volumeUniforms.uSlabCenter,
    uBoundsCenter: { value: boundsCenter.clone() },
    uBoundsSize: { value: boundsSize.clone() },
    uAtlasWorldInverse: { value: new THREE.Matrix4() },
    uVisibility: volumeUniforms.uVisibility,
  };
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  geometry.name = "V26 exact atlas diagnostic plane";
  const material = new THREE.ShaderMaterial({
    name: "V26 exact native T1 cut face",
    uniforms,
    vertexShader: /* glsl */ `
      uniform mat4 uAtlasWorldInverse;
      out vec3 vAtlasPosition;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vAtlasPosition = (uAtlasWorldInverse * worldPosition).xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      precision highp sampler3D;

      uniform sampler3D uIntensity;
      uniform sampler3D uLabels;
      uniform float uMaskBit;
      uniform vec3 uAccent;
      uniform float uSlabAxis;
      uniform float uSlabCenter;
      uniform vec3 uBoundsCenter;
      uniform vec3 uBoundsSize;
      uniform float uVisibility;

      in vec3 vAtlasPosition;
      out vec4 outColor;

      float packedBit(float byteValue, float bitValue) {
        return mod(floor(byteValue / bitValue), 2.0);
      }

      vec3 diagnosticT1(float intensity) {
        float windowed = clamp((intensity - 0.5) * 1.08 + 0.5, 0.0, 1.0);
        vec3 csf = vec3(0.010, 0.009, 0.010);
        vec3 deepGray = vec3(0.10, 0.092, 0.094);
        vec3 grayMatter = vec3(0.30, 0.278, 0.272);
        vec3 whiteMatter = vec3(0.58, 0.535, 0.49);
        vec3 cappedPeak = vec3(0.69, 0.635, 0.575);
        vec3 color = mix(csf, deepGray, smoothstep(0.035, 0.14, windowed));
        color = mix(color, grayMatter, smoothstep(0.13, 0.44, windowed));
        color = mix(color, whiteMatter, smoothstep(0.42, 0.76, windowed));
        return mix(color, cappedPeak, smoothstep(0.82, 0.98, windowed));
      }

      void main() {
        if (uVisibility < 0.001) discard;
        vec3 displayCoordinate =
          (vAtlasPosition - uBoundsCenter) / uBoundsSize + 0.5;
        vec3 textureCoordinate = vec3(
          1.0 - displayCoordinate.x,
          1.0 - displayCoordinate.y,
          displayCoordinate.z
        );
        if (uSlabAxis > 1.5) {
          textureCoordinate.z = uSlabCenter;
        } else {
          textureCoordinate.x = uSlabCenter;
        }
        if (
          any(lessThan(textureCoordinate, vec3(0.0))) ||
          any(greaterThan(textureCoordinate, vec3(1.0)))
        ) {
          discard;
        }

        float labelByte =
          floor(texture(uLabels, textureCoordinate).r * 255.0 + 0.5);
        float support = packedBit(labelByte, 64.0);
        float selection = packedBit(labelByte, uMaskBit);
        float boundary = packedBit(labelByte, uMaskBit * 8.0);
        if (support < 0.5 && selection < 0.5 && boundary < 0.5) discard;

        float intensity = texture(uIntensity, textureCoordinate).r;
        vec3 color = diagnosticT1(intensity);
        float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
        float accentLuminance = max(
          dot(uAccent, vec3(0.2126, 0.7152, 0.0722)),
          0.001
        );
        vec3 matchedAccent = uAccent * (luminance / accentLuminance);
        float semanticMix = selection * 0.18 + boundary * 0.48;
        color = mix(color, matchedAccent, clamp(semanticMix, 0.0, 0.58));
        color *= 1.0 + boundary * 0.025;

        float alpha = max(support * 0.99, max(selection, boundary) * 0.97);
        alpha *= uVisibility;
        outColor = vec4(color * alpha, alpha);
      }
    `,
    glslVersion: THREE.GLSL3,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
  material.customProgramCacheKey = () =>
    "brain-atlas-volume-v26-exact-diagnostic-plane";
  material.userData.diagnosticPlane = {
    intensitySampling: "single-atlas-section-trilinear",
    labels: "native-nearest-one-voxel-boundary",
    edgeEnhancement: "none",
    supportAlpha: "native-aseg-bit-6",
  };
  const plane = new THREE.Mesh(geometry, material);
  plane.name = "V26 exact in-situ diagnostic cut face";
  plane.renderOrder = 8;
  plane.raycast = () => {};
  plane.visible = false;
  setDiagnosticPlaneTransform(
    plane,
    data.manifest.regions.hippocampus,
    boundsCenter,
    boundsSize,
  );
  atlasRoot.updateWorldMatrix(true, false);
  uniforms.uAtlasWorldInverse.value.copy(atlasRoot.matrixWorld).invert();
  ownedGeometries.add(geometry);
  ownedMaterials.add(material);
  return { plane, uniforms };
}

function createV26InSituContextShell(
  atlasRoot: THREE.Object3D,
  boundsCenter: THREE.Vector3,
  boundsSize: THREE.Vector3,
  volumeUniforms: VolumeUniforms,
  ownedMaterials: Set<THREE.Material>,
) {
  const uniforms = {
    uAtlasWorldInverse: { value: new THREE.Matrix4() },
    uBoundsCenter: { value: boundsCenter.clone() },
    uBoundsSize: { value: boundsSize.clone() },
    uVolumeDimensions: volumeUniforms.uVolumeDimensions,
    uSlabAxis: volumeUniforms.uSlabAxis,
    uSlabCenter: volumeUniforms.uSlabCenter,
    uVisibility: volumeUniforms.uVisibility,
  };
  const material = new THREE.ShaderMaterial({
    name: "V26 whole-pial in-situ X-ray context",
    uniforms,
    vertexShader: /* glsl */ `
      uniform mat4 uAtlasWorldInverse;
      in float _curvature;
      out vec3 vAtlasPosition;
      out vec3 vViewNormal;
      out vec3 vViewPosition;
      out float vCurvature;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vec4 viewPosition = viewMatrix * worldPosition;
        vAtlasPosition = (uAtlasWorldInverse * worldPosition).xyz;
        vViewNormal = normalize(normalMatrix * normal);
        vViewPosition = viewPosition.xyz;
        vCurvature = clamp(_curvature * 4.0, -1.0, 1.0);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 uBoundsCenter;
      uniform vec3 uBoundsSize;
      uniform vec3 uVolumeDimensions;
      uniform float uSlabAxis;
      uniform float uSlabCenter;
      uniform float uVisibility;

      in vec3 vAtlasPosition;
      in vec3 vViewNormal;
      in vec3 vViewPosition;
      in float vCurvature;
      out vec4 outColor;

      float axisValue(vec3 value) {
        return mix(value.x, value.z, step(1.5, uSlabAxis));
      }

      void main() {
        vec3 displayCoordinate =
          (vAtlasPosition - uBoundsCenter) / uBoundsSize + 0.5;
        vec3 textureCoordinate = vec3(
          1.0 - displayCoordinate.x,
          1.0 - displayCoordinate.y,
          displayCoordinate.z
        );
        float slabDimension = axisValue(uVolumeDimensions);
        float sectionDistanceVoxels =
          abs(axisValue(textureCoordinate) - uSlabCenter) *
          max(slabDimension - 1.0, 1.0);
        vec3 viewDirection = normalize(-vViewPosition);
        float facing = abs(dot(normalize(vViewNormal), viewDirection));
        float fresnel = pow(1.0 - facing, 2.4);
        float cutOpening =
          1.0 - smoothstep(1.5, 5.0, sectionDistanceVoxels);
        float crown = smoothstep(-0.08, 0.52, vCurvature);
        float cavity = smoothstep(0.06, 0.58, -vCurvature);
        float alpha =
          (0.045 + fresnel * 0.030 + cutOpening * 0.012) *
          mix(0.82, 1.06, crown) *
          mix(1.0, 0.78, cavity) *
          uVisibility;
        vec3 color = vec3(0.54, 0.35, 0.37);
        color *= 1.0 - cavity * 0.16 + crown * 0.055;
        color = mix(color, vec3(0.66, 0.43, 0.43), fresnel * 0.42);
        outColor = vec4(color, alpha);
      }
    `,
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.BackSide,
    toneMapped: true,
  });
  material.customProgramCacheKey = () =>
    "brain-atlas-volume-v26-whole-pial-context";
  material.userData.volumeContextShell = {
    coverage: "whole-cortical-pial",
    passes: "single-backface",
    frontFaceAlpha: 0,
    backFaceAlpha: [0.045, 0.087],
    centralCutOpeningVoxels: 5,
    curvatureModulated: true,
  };
  ownedMaterials.add(material);

  atlasRoot.updateWorldMatrix(true, true);
  const inverseRootWorld = atlasRoot.matrixWorld.clone().invert();
  const candidates: THREE.Mesh[] = [];
  atlasRoot.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const regionId = object.userData.brainRegionId as RegionId | undefined;
    if (
      !regionId ||
      !CONTEXT_SHELL_REGION_IDS.has(regionId) ||
      object.userData.hitProxy === true
    ) {
      return;
    }
    candidates.push(object);
  });
  const shell = new THREE.Group();
  shell.name = "V26 whole-brain pial X-ray locator";
  const relativeMatrix = new THREE.Matrix4();
  candidates.forEach((source) => {
    source.updateWorldMatrix(true, false);
    relativeMatrix.multiplyMatrices(inverseRootWorld, source.matrixWorld);
    const clone = new THREE.Mesh(source.geometry, material);
    relativeMatrix.decompose(clone.position, clone.quaternion, clone.scale);
    clone.name = `${source.name} V26 in-situ pial context`;
    clone.renderOrder = 4;
    clone.raycast = () => {};
    clone.frustumCulled = true;
    shell.add(clone);
  });
  shell.visible = false;
  return { shell, shellUniforms: uniforms };
}

function createV33CoherentXrayShell(
  data: BrainVolumeData,
  volumeUniforms: VolumeUniforms,
  ownedGeometries: Set<THREE.BufferGeometry>,
  ownedMaterials: Set<THREE.Material>,
  mobilePresentation: boolean,
) {
  const uniforms = {
    uVisibility: volumeUniforms.uVisibility,
    uResponsiveOpacityBoost: {
      value: mobilePresentation ? 1.3 : 1,
    },
  };
  const vertexShader = /* glsl */ `
    out vec3 vViewNormal;
    out vec3 vViewPosition;

    void main() {
      vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
      vViewNormal = normalize(normalMatrix * normal);
      vViewPosition = viewPosition.xyz;
      gl_Position = projectionMatrix * viewPosition;
    }
  `;
  const shellMaterial = new THREE.ShaderMaterial({
    name: "V33 clean continuous pial-context shell",
    uniforms,
    vertexShader,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uVisibility;
      uniform float uResponsiveOpacityBoost;
      in vec3 vViewNormal;
      in vec3 vViewPosition;
      out vec4 outColor;

      void main() {
        if (uVisibility < 0.001) discard;
        vec3 viewDirection = normalize(-vViewPosition);
        float facing = clamp(
          dot(normalize(vViewNormal), viewDirection),
          0.0,
          1.0
        );
        float fresnel = pow(1.0 - facing, 2.8);
        vec3 neutralTissue = vec3(0.31, 0.34, 0.39);
        vec3 frostedEdge = vec3(0.62, 0.67, 0.75);
        vec3 color = mix(
          neutralTissue,
          frostedEdge,
          smoothstep(0.08, 0.88, fresnel)
        );
        float alpha =
          (0.012 + fresnel * 0.05) *
          uResponsiveOpacityBoost *
          uVisibility;
        outColor = vec4(color, alpha);
      }
    `,
    glslVersion: THREE.GLSL3,
    transparent: true,
    premultipliedAlpha: false,
    depthTest: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
    side: THREE.FrontSide,
    toneMapped: true,
  });
  shellMaterial.customProgramCacheKey = () =>
    "brain-atlas-volume-v33-continuous-shell";
  shellMaterial.userData.volumeContextShell = {
    coverage: "continuous-smoothed-whole-brain-support",
    passes: "single-front-surface-color",
    side: "front",
    doubleSide: false,
    neutralCoolWarmGray: true,
    faceOnAlpha: 0.012,
    fresnelAlpha: 0.05,
    responsiveOpacityBoost: mobilePresentation ? 1.3 : 1,
    triangleOverdraw: "single-pass",
    curvatureContribution: "none",
    internalLineContribution: "none",
  };
  ownedMaterials.add(shellMaterial);

  const shell = new THREE.Group();
  shell.name = "V33 intact coherent X-ray locator";
  if (data.contextShellGeometry) {
    const geometry = data.contextShellGeometry.clone();
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, shellMaterial);
    mesh.name = "V33 continuous whole-brain pial context";
    mesh.renderOrder = 2;
    mesh.raycast = () => {};
    mesh.frustumCulled = true;
    shell.add(mesh);
    ownedGeometries.add(geometry);
  }
  shell.visible = false;
  return { shell, shellUniforms: null };
}

function createV33BalancedTargetSurfaces(
  data: BrainVolumeData,
  ownedGeometries: Set<THREE.BufferGeometry>,
  ownedMaterials: Set<THREE.Material>,
) {
  const group = new THREE.Group();
  group.name = "V33 structure-specific atlas target surfaces";
  const meshes = new Map<
    "hippocampus" | "amygdala" | "corpus-callosum",
    THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>
  >();
  if (!data.targetGeometries) {
    return {
      group,
      setRegion: () => {},
      setVisible: () => {},
    };
  }

  (
    ["hippocampus", "amygdala", "corpus-callosum"] as const
  ).forEach((regionId) => {
    const geometry = data.targetGeometries![regionId].clone();
    const accent = new THREE.Color(
      regionId === "hippocampus"
        ? "#b85c81"
        : regionId === "amygdala"
          ? "#bd627b"
          : "#b5954d",
    );
    const material = new THREE.MeshPhysicalMaterial({
      name: `V33 ${regionId} balanced biological target`,
      color: accent,
      emissive: accent.clone().multiplyScalar(0.035),
      emissiveIntensity: 0.006,
      roughness: 0.58,
      metalness: 0,
      clearcoat: 0.025,
      clearcoatRoughness: 0.68,
      sheen: 0.2,
      sheenColor: accent.clone().lerp(new THREE.Color("#ffd9cf"), 0.28),
      sheenRoughness: 0.66,
      specularIntensity: 0.47,
      transparent: false,
      opacity: 1,
      depthTest: true,
      depthWrite: true,
      side: THREE.FrontSide,
      toneMapped: true,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.v33TargetAccent = { value: accent };
      shader.fragmentShader = `uniform vec3 v33TargetAccent;
${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        `vec3 v33TargetNormal = normalize(normal);
vec3 v33TargetView = normalize(-vViewPosition);
float v33TargetKey = smoothstep(
  -0.28,
  0.82,
  dot(v33TargetNormal, normalize(vec3(-0.46, 0.72, 0.52)))
);
float v33TargetFill = smoothstep(
  -0.55,
  0.55,
  dot(v33TargetNormal, normalize(vec3(0.58, 0.12, 0.80)))
);
float v33TargetFacing = abs(dot(v33TargetNormal, v33TargetView));
float v33TargetSide = mix(
  0.76,
  1.04,
  smoothstep(0.16, 0.82, v33TargetFacing)
);
float v33TargetRim = pow(1.0 - saturate(v33TargetFacing), 4.2);
float v33TargetBackscatter = pow(1.0 - v33TargetKey, 1.8);
outgoingLight *=
  mix(0.78, 1.18, v33TargetKey) *
  mix(0.92, 1.05, v33TargetFill) *
  v33TargetSide;
outgoingLight +=
  mix(v33TargetAccent, vec3(0.88, 0.33, 0.24), 0.28) *
  v33TargetBackscatter * 0.048;
outgoingLight +=
  mix(v33TargetAccent, vec3(0.72, 0.82, 0.94), 0.28) *
  v33TargetRim * 0.075;
#include <opaque_fragment>`,
      );
    };
    material.customProgramCacheKey = () =>
      `brain-v33-target-${regionId}-balanced-form`;
    material.userData.v33TargetSurface = {
      regionId,
      provenance:
        data.manifest.regions[regionId].displaySurface?.provenance,
      smoothing:
        data.manifest.regions[regionId].displaySurface?.displaySmoothing,
      atlasPlacement: "native-vox2ras-tkr-display-millimeters",
    };
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `V33 in-situ ${regionId} balanced target`;
    mesh.userData.brainRegionId = regionId;
    mesh.userData.v33VisibleTarget = true;
    mesh.renderOrder = 4;
    mesh.frustumCulled = true;
    mesh.visible = false;
    group.add(mesh);
    meshes.set(regionId, mesh);
    ownedGeometries.add(geometry);
    ownedMaterials.add(material);
  });
  group.visible = false;
  let activeRegionId:
    | "hippocampus"
    | "amygdala"
    | "corpus-callosum" = "hippocampus";
  let presentationVisible = false;
  const updateVisibility = () => {
    group.visible = presentationVisible;
    meshes.forEach((mesh, regionId) => {
      mesh.visible =
        presentationVisible && regionId === activeRegionId;
    });
  };
  return {
    group,
    setRegion(
      regionId: "hippocampus" | "amygdala" | "corpus-callosum",
    ) {
      activeRegionId = regionId;
      updateVisibility();
    },
    setVisible(visible: boolean) {
      presentationVisible = visible;
      updateVisibility();
    },
  };
}

type V27CutFrame = Readonly<{
  point: THREE.Vector3;
  normal: THREE.Vector3;
}>;

type V27RimState = Readonly<{
  group: THREE.Group;
  positiveWall: THREE.Mesh | null;
  negativeWall: THREE.Mesh | null;
  ribbon: THREE.Mesh | null;
}>;

function getV27CutFrame(
  region: BrainVolumeRegion,
  boundsCenter: THREE.Vector3,
  boundsSize: THREE.Vector3,
): V27CutFrame {
  const point = boundsCenter.clone();
  const normal = new THREE.Vector3(0, 0, 1);
  if (region.orientation === "sagittal") {
    point.x += (1.0 - region.normalizedCenter - 0.5) * boundsSize.x;
    normal.set(1, 0, 0);
  } else {
    point.z += (region.normalizedCenter - 0.5) * boundsSize.z;
  }
  return { point, normal };
}

function appendTriangle(
  positions: number[],
  first: THREE.Vector3,
  second: THREE.Vector3,
  third: THREE.Vector3,
) {
  positions.push(
    first.x,
    first.y,
    first.z,
    second.x,
    second.y,
    second.z,
    third.x,
    third.y,
    third.z,
  );
}

function createPositionGeometry(positions: readonly number[], name: string) {
  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.name = name;
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildV27PialRimGeometry(
  atlasRoot: THREE.Object3D,
  sources: readonly THREE.Mesh[],
  frame: V27CutFrame,
  wallDepthMillimeters: number,
  ribbonWidthMillimeters: number,
) {
  atlasRoot.updateWorldMatrix(true, true);
  const inverseRootWorld = atlasRoot.matrixWorld.clone().invert();
  const relativeMatrix = new THREE.Matrix4();
  const planeNormal = frame.normal;
  const positiveWallPositions: number[] = [];
  const negativeWallPositions: number[] = [];
  const ribbonPositions: number[] = [];
  const trianglePoints = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];
  const intersectionPoints = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];
  const tangent = new THREE.Vector3();
  const across = new THREE.Vector3();
  const positiveOffset = planeNormal
    .clone()
    .multiplyScalar(wallDepthMillimeters);
  const negativeOffset = positiveOffset.clone().multiplyScalar(-1);
  const ribbonOffset = new THREE.Vector3();
  const epsilon = 0.0001;

  const appendIntersection = (point: THREE.Vector3, count: number) => {
    for (let index = 0; index < count; index += 1) {
      if (intersectionPoints[index].distanceToSquared(point) < 0.000001) {
        return count;
      }
    }
    if (count >= intersectionPoints.length) return count;
    intersectionPoints[count].copy(point);
    return count + 1;
  };

  sources.forEach((source) => {
    source.updateWorldMatrix(true, false);
    relativeMatrix.multiplyMatrices(inverseRootWorld, source.matrixWorld);
    const position = source.geometry.getAttribute("position");
    const index = source.geometry.getIndex();
    const triangleCount = index
      ? Math.floor(index.count / 3)
      : Math.floor(position.count / 3);
    const readVertex = (triangleIndex: number, corner: number) => {
      const vertexIndex = index
        ? index.getX(triangleIndex * 3 + corner)
        : triangleIndex * 3 + corner;
      return trianglePoints[corner]
        .fromBufferAttribute(position, vertexIndex)
        .applyMatrix4(relativeMatrix);
    };

    for (
      let triangleIndex = 0;
      triangleIndex < triangleCount;
      triangleIndex += 1
    ) {
      const first = readVertex(triangleIndex, 0);
      const second = readVertex(triangleIndex, 1);
      const third = readVertex(triangleIndex, 2);
      const points = [first, second, third] as const;
      const distances = points.map((point) =>
        planeNormal.dot(point) - planeNormal.dot(frame.point),
      );
      if (
        (distances[0] > epsilon &&
          distances[1] > epsilon &&
          distances[2] > epsilon) ||
        (distances[0] < -epsilon &&
          distances[1] < -epsilon &&
          distances[2] < -epsilon)
      ) {
        continue;
      }

      let intersectionCount = 0;
      for (let edgeIndex = 0; edgeIndex < 3; edgeIndex += 1) {
        const nextIndex = (edgeIndex + 1) % 3;
        const edgeStart = points[edgeIndex];
        const edgeEnd = points[nextIndex];
        const startDistance = distances[edgeIndex];
        const endDistance = distances[nextIndex];
        if (Math.abs(startDistance) <= epsilon) {
          intersectionCount = appendIntersection(
            edgeStart,
            intersectionCount,
          );
        }
        if (
          (startDistance < -epsilon && endDistance > epsilon) ||
          (startDistance > epsilon && endDistance < -epsilon)
        ) {
          const interpolation =
            startDistance / (startDistance - endDistance);
          intersectionPoints[2]
            .copy(edgeStart)
            .lerp(edgeEnd, interpolation);
          intersectionCount = appendIntersection(
            intersectionPoints[2],
            intersectionCount,
          );
        }
      }
      if (intersectionCount < 2) continue;

      const segmentStart = intersectionPoints[0];
      const segmentEnd = intersectionPoints[1];
      tangent.subVectors(segmentEnd, segmentStart);
      if (tangent.lengthSq() < 0.0004) continue;
      tangent.normalize();
      across.crossVectors(planeNormal, tangent).normalize();
      ribbonOffset
        .copy(across)
        .multiplyScalar(ribbonWidthMillimeters * 0.5);

      const positiveStart = segmentStart.clone().add(positiveOffset);
      const positiveEnd = segmentEnd.clone().add(positiveOffset);
      appendTriangle(
        positiveWallPositions,
        segmentStart,
        segmentEnd,
        positiveEnd,
      );
      appendTriangle(
        positiveWallPositions,
        segmentStart,
        positiveEnd,
        positiveStart,
      );

      const negativeStart = segmentStart.clone().add(negativeOffset);
      const negativeEnd = segmentEnd.clone().add(negativeOffset);
      appendTriangle(
        negativeWallPositions,
        segmentEnd,
        segmentStart,
        negativeStart,
      );
      appendTriangle(
        negativeWallPositions,
        segmentEnd,
        negativeStart,
        negativeEnd,
      );

      const ribbonA = segmentStart.clone().add(ribbonOffset);
      const ribbonB = segmentEnd.clone().add(ribbonOffset);
      const ribbonC = segmentEnd.clone().sub(ribbonOffset);
      const ribbonD = segmentStart.clone().sub(ribbonOffset);
      appendTriangle(ribbonPositions, ribbonA, ribbonB, ribbonC);
      appendTriangle(ribbonPositions, ribbonA, ribbonC, ribbonD);
    }
  });

  return {
    positiveWall: createPositionGeometry(
      positiveWallPositions,
      "V27 positive retained pial sidewall",
    ),
    negativeWall: createPositionGeometry(
      negativeWallPositions,
      "V27 negative retained pial sidewall",
    ),
    ribbon: createPositionGeometry(
      ribbonPositions,
      "V27 anatomical pial cut-edge ribbon",
    ),
  };
}

function createV27RetainedPialCutaway(
  data: BrainVolumeData,
  atlasRoot: THREE.Object3D,
  boundsCenter: THREE.Vector3,
  boundsSize: THREE.Vector3,
  volumeUniforms: VolumeUniforms,
  ownedGeometries: Set<THREE.BufferGeometry>,
  ownedMaterials: Set<THREE.Material>,
  presentationMode: BrainInternalPresentationMode,
) {
  const uniforms = {
    uAtlasWorldInverse: { value: new THREE.Matrix4() },
    uCutPoint: { value: new THREE.Vector3() },
    uCutNormal: { value: new THREE.Vector3(0, 0, 1) },
    uCameraPlaneSide: { value: 1 },
    uVisibility: volumeUniforms.uVisibility,
  };
  const material = new THREE.MeshPhysicalMaterial({
    name: "V27 retained opaque pial tissue",
    color: new THREE.Color("#bba9aa"),
    metalness: 0,
    roughness: 0.8,
    ior: 1.38,
    specularIntensity: 0.32,
    specularColor: new THREE.Color("#d4bbb5"),
    clearcoat: 0.018,
    clearcoatRoughness: 0.8,
    envMapIntensity: 0.78,
    transparent: false,
    opacity: 1,
    depthTest: true,
    depthWrite: true,
    side: THREE.FrontSide,
    dithering: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uV27AtlasWorldInverse = uniforms.uAtlasWorldInverse;
    shader.uniforms.uV27CutPoint = uniforms.uCutPoint;
    shader.uniforms.uV27CutNormal = uniforms.uCutNormal;
    shader.uniforms.uV27CameraPlaneSide = uniforms.uCameraPlaneSide;
    shader.uniforms.uV27Visibility = uniforms.uVisibility;
    shader.vertexShader = `attribute float _curvature;
uniform mat4 uV27AtlasWorldInverse;
out vec3 vV27AtlasPosition;
out float vV27Curvature;
${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
vV27AtlasPosition =
  (uV27AtlasWorldInverse * modelMatrix * vec4(position, 1.0)).xyz;
vV27Curvature = clamp(-_curvature * 4.0, -1.0, 1.0);`,
    );
    shader.fragmentShader = `uniform vec3 uV27CutPoint;
uniform vec3 uV27CutNormal;
uniform float uV27CameraPlaneSide;
uniform float uV27Visibility;
in vec3 vV27AtlasPosition;
in float vV27Curvature;
${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
float v27PlaneDistance = dot(
  vV27AtlasPosition - uV27CutPoint,
  uV27CutNormal
) * uV27CameraPlaneSide;
if (
  uV27Visibility < 0.001 ||
  v27PlaneDistance > ${
    presentationMode === "volume-v28" ? "-0.9" : "0.015"
  }
) discard;
float v27Crown = smoothstep(-0.12, 0.72, vV27Curvature);
float v27Sulcus = smoothstep(0.04, 0.78, -vV27Curvature);
vec3 v27PositionField = sin(
  vV27AtlasPosition * vec3(0.19, 0.23, 0.17) +
  vV27AtlasPosition.yzx * vec3(0.11, 0.07, 0.13)
);
float v27MicroVariation = dot(v27PositionField, vec3(0.42, 0.34, 0.24));
diffuseColor.rgb *=
  (1.0 - v27Sulcus * 0.28 + v27Crown * 0.025) *
  (1.0 + v27MicroVariation * 0.018);
diffuseColor.rgb *= mix(
  vec3(0.985, 0.995, 1.008),
  vec3(1.018, 0.992, 0.978),
  v27MicroVariation * 0.5 + 0.5
);`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>
roughnessFactor = clamp(
  roughnessFactor + v27Sulcus * 0.13 - v27Crown * 0.012 -
    v27MicroVariation * 0.012,
  0.72,
  0.94
);`,
    );
  };
  material.customProgramCacheKey = () =>
    `brain-atlas-${presentationMode}-retained-opaque-pial`;
  material.userData.volumeContextShell = {
    architecture:
      presentationMode === "volume-v28"
        ? "inset camera-far opaque pial half without internal rim"
        : "camera-far opaque pial half",
    transparency: false,
    clipping: "diagnostic-plane-far-side",
    curvatureMicrovariation: true,
    perFrameMaterialCompilation: false,
  };
  ownedMaterials.add(material);

  const rimMaterial =
    presentationMode === "volume-v27"
      ? new THREE.MeshPhysicalMaterial({
          name: "V27 pial cut rim and cortical sidewall",
          color: new THREE.Color("#a99091"),
          metalness: 0,
          roughness: 0.86,
          ior: 1.38,
          specularIntensity: 0.24,
          specularColor: new THREE.Color("#c5aca6"),
          clearcoat: 0,
          envMapIntensity: 0.66,
          transparent: false,
          opacity: 1,
          depthTest: true,
          depthWrite: true,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -0.35,
          polygonOffsetUnits: -0.35,
        })
      : null;
  if (rimMaterial) {
    rimMaterial.userData.cutSurfaceRole =
      "pial-triangle-plane intersection sidewall";
    ownedMaterials.add(rimMaterial);
  }

  atlasRoot.updateWorldMatrix(true, true);
  const inverseRootWorld = atlasRoot.matrixWorld.clone().invert();
  const candidates: THREE.Mesh[] = [];
  atlasRoot.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const regionId = object.userData.brainRegionId as RegionId | undefined;
    if (
      !regionId ||
      !CONTEXT_SHELL_REGION_IDS.has(regionId) ||
      object.userData.hitProxy === true
    ) {
      return;
    }
    candidates.push(object);
  });

  const shell = new THREE.Group();
  shell.name = `${presentationMode} retained opaque anatomical half-brain`;
  const retainedSurface = new THREE.Group();
  retainedSurface.name = `${presentationMode} clipped retained pial surface`;
  const relativeMatrix = new THREE.Matrix4();
  candidates.forEach((source) => {
    source.updateWorldMatrix(true, false);
    relativeMatrix.multiplyMatrices(inverseRootWorld, source.matrixWorld);
    const clone = new THREE.Mesh(source.geometry, material);
    relativeMatrix.decompose(clone.position, clone.quaternion, clone.scale);
    clone.name = `${source.name} ${presentationMode} retained pial tissue`;
    clone.renderOrder = 4;
    clone.raycast = () => {};
    clone.frustumCulled = true;
    retainedSurface.add(clone);
  });
  shell.add(retainedSurface);

  const rimStates = new Map<RegionId, V27RimState>();
  if (presentationMode === "volume-v27") {
    (
      ["hippocampus", "amygdala", "corpus-callosum"] as const
    ).forEach((regionId) => {
    const frame = getV27CutFrame(
      data.manifest.regions[regionId],
      boundsCenter,
      boundsSize,
    );
    const rimGeometry = buildV27PialRimGeometry(
      atlasRoot,
      candidates,
      frame,
      3.2,
      0.72,
    );
    const rimGroup = new THREE.Group();
    rimGroup.name = `${regionId} V27 physical cortical cut rim`;
    rimGroup.visible = false;
    const makeRimMesh = (
      geometry: THREE.BufferGeometry | null,
      suffix: string,
      renderOrder: number,
    ) => {
      if (!geometry || !rimMaterial) return null;
      ownedGeometries.add(geometry);
      const mesh = new THREE.Mesh(geometry, rimMaterial);
      mesh.name = `${regionId} ${suffix}`;
      mesh.renderOrder = renderOrder;
      mesh.raycast = () => {};
      mesh.frustumCulled = true;
      rimGroup.add(mesh);
      return mesh;
    };
    const positiveWall = makeRimMesh(
      rimGeometry.positiveWall,
      "positive pial sidewall",
      7,
    );
    const negativeWall = makeRimMesh(
      rimGeometry.negativeWall,
      "negative pial sidewall",
      7,
    );
    const ribbon = makeRimMesh(
      rimGeometry.ribbon,
      "anatomical cut-edge ribbon",
      9,
    );
    shell.add(rimGroup);
    rimStates.set(regionId, {
      group: rimGroup,
      positiveWall,
      negativeWall,
      ribbon,
    });
    });
  }

  let activeRegionId: RegionId = "hippocampus";
  let activeFrame = getV27CutFrame(
    data.manifest.regions.hippocampus,
    boundsCenter,
    boundsSize,
  );
  const cameraWorld = new THREE.Vector3();
  const cameraAtlas = new THREE.Vector3();
  const applyCameraSide = (cameraPlaneSide: number) => {
    uniforms.uCameraPlaneSide.value = cameraPlaneSide;
    const retainedWallSign = -cameraPlaneSide;
    rimStates.forEach((state, regionId) => {
      const active = regionId === activeRegionId;
      state.group.visible = active;
      if (state.positiveWall) {
        state.positiveWall.visible = active && retainedWallSign > 0;
      }
      if (state.negativeWall) {
        state.negativeWall.visible = active && retainedWallSign < 0;
      }
      if (state.ribbon) state.ribbon.visible = active;
    });
  };
  uniforms.uCutPoint.value.copy(activeFrame.point);
  uniforms.uCutNormal.value.copy(activeFrame.normal);
  applyCameraSide(1);
  shell.visible = false;

  return {
    shell,
    shellUniforms: uniforms,
    setRegion(regionId: RegionId, region: BrainVolumeRegion) {
      activeRegionId = regionId;
      activeFrame = getV27CutFrame(region, boundsCenter, boundsSize);
      uniforms.uCutPoint.value.copy(activeFrame.point);
      uniforms.uCutNormal.value.copy(activeFrame.normal);
      applyCameraSide(uniforms.uCameraPlaneSide.value);
    },
    updateCamera(camera: THREE.Camera) {
      atlasRoot.updateWorldMatrix(true, false);
      uniforms.uAtlasWorldInverse.value.copy(atlasRoot.matrixWorld).invert();
      camera.getWorldPosition(cameraWorld);
      cameraAtlas.copy(cameraWorld);
      atlasRoot.worldToLocal(cameraAtlas);
      const cameraDistance = activeFrame.normal.dot(
        cameraAtlas.sub(activeFrame.point),
      );
      applyCameraSide(cameraDistance >= 0 ? 1 : -1);
    },
  };
}

function createV27DiagnosticPlane(
  data: BrainVolumeData,
  atlasRoot: THREE.Object3D,
  boundsCenter: THREE.Vector3,
  boundsSize: THREE.Vector3,
  volumeUniforms: VolumeUniforms,
  ownedGeometries: Set<THREE.BufferGeometry>,
  ownedMaterials: Set<THREE.Material>,
  presentationMode: BrainInternalPresentationMode,
  mobilePresentation: boolean,
) {
  const contextualXray =
    presentationMode === "volume-v29" ||
    presentationMode === "volume-v30" ||
    presentationMode === "volume-v31" ||
    presentationMode === "volume-v32" ||
    presentationMode === "volume-v33";
  const uniforms = {
    uIntensity: volumeUniforms.uIntensity,
    uLabels: volumeUniforms.uLabels,
    uMaskBit: volumeUniforms.uMaskBit,
    uAccent: volumeUniforms.uAccent,
    uVolumeDimensions: volumeUniforms.uVolumeDimensions,
    uSlabAxis: volumeUniforms.uSlabAxis,
    uSlabCenter: volumeUniforms.uSlabCenter,
    uBoundsCenter: { value: boundsCenter.clone() },
    uBoundsSize: { value: boundsSize.clone() },
    uAtlasWorldInverse: { value: new THREE.Matrix4() },
    uVisibility: volumeUniforms.uVisibility,
  };
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  geometry.name = `${presentationMode} atlas-aligned diagnostic cut plane`;
  const material = new THREE.ShaderMaterial({
    name: `${presentationMode} clean T1 section with exact atlas semantics`,
    uniforms,
    vertexShader: /* glsl */ `
      uniform mat4 uAtlasWorldInverse;
      out vec3 vAtlasPosition;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vAtlasPosition = (uAtlasWorldInverse * worldPosition).xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      precision highp sampler3D;

      uniform sampler3D uIntensity;
      uniform sampler3D uLabels;
      uniform float uMaskBit;
      uniform vec3 uAccent;
      uniform vec3 uVolumeDimensions;
      uniform float uSlabAxis;
      uniform float uSlabCenter;
      uniform vec3 uBoundsCenter;
      uniform vec3 uBoundsSize;
      uniform float uVisibility;

      in vec3 vAtlasPosition;
      out vec4 outColor;

      float packedBit(float byteValue, float bitValue) {
        return mod(floor(byteValue / bitValue), 2.0);
      }

      vec2 planeDimensions() {
        return uSlabAxis > 1.5
          ? uVolumeDimensions.xy
          : uVolumeDimensions.zy;
      }

      vec3 planeUvToTexture(vec2 planeUv) {
        return uSlabAxis > 1.5
          ? vec3(planeUv, uSlabCenter)
          : vec3(uSlabCenter, planeUv.y, planeUv.x);
      }

      vec2 textureToPlaneUv(vec3 textureCoordinate) {
        return uSlabAxis > 1.5
          ? textureCoordinate.xy
          : textureCoordinate.zy;
      }

      float labelByteAt(vec2 planeUv) {
        if (
          any(lessThan(planeUv, vec2(0.0))) ||
          any(greaterThan(planeUv, vec2(1.0)))
        ) {
          return 0.0;
        }
        return floor(
          texture(uLabels, planeUvToTexture(planeUv)).r * 255.0 + 0.5
        );
      }

      float reconstructedT1(vec2 planeUv) {
        return texture(uIntensity, planeUvToTexture(planeUv)).r;
      }

      float insideEdgeDistance(
        float centerValue,
        vec4 neighborValues,
        vec2 voxelFraction
      ) {
        if (centerValue < 0.5) return 0.0;
        float distanceToEdge = 8.0;
        if (neighborValues.x < 0.5) {
          distanceToEdge = min(distanceToEdge, voxelFraction.x);
        }
        if (neighborValues.y < 0.5) {
          distanceToEdge = min(distanceToEdge, 1.0 - voxelFraction.x);
        }
        if (neighborValues.z < 0.5) {
          distanceToEdge = min(distanceToEdge, voxelFraction.y);
        }
        if (neighborValues.w < 0.5) {
          distanceToEdge = min(distanceToEdge, 1.0 - voxelFraction.y);
        }
        return distanceToEdge;
      }

      float brainSupportAtVoxel(vec2 voxelIndex) {
        vec2 dimensions = planeDimensions();
        vec2 centerUv =
          (clamp(voxelIndex, vec2(0.0), dimensions - 1.0) + 0.5) /
          dimensions;
        return packedBit(labelByteAt(centerUv), 64.0);
      }

      float reconstructedBrainSupport(vec2 planeUv) {
        vec2 dimensions = planeDimensions();
        vec2 voxelCoordinate = planeUv * dimensions - 0.5;
        vec2 baseVoxel = floor(voxelCoordinate);
        vec2 blend = fract(voxelCoordinate);
        float lower = mix(
          brainSupportAtVoxel(baseVoxel),
          brainSupportAtVoxel(baseVoxel + vec2(1.0, 0.0)),
          blend.x
        );
        float upper = mix(
          brainSupportAtVoxel(baseVoxel + vec2(0.0, 1.0)),
          brainSupportAtVoxel(baseVoxel + vec2(1.0)),
          blend.x
        );
        return mix(lower, upper, blend.y);
      }

      vec3 diagnosticT1(float intensity) {
        float windowed = clamp(intensity, 0.0, 1.0);
        vec3 csf = vec3(0.007, 0.007, 0.009);
        vec3 deepGray = vec3(0.045, 0.043, 0.046);
        vec3 grayMatter = vec3(0.145, 0.135, 0.136);
        vec3 whiteMatter = vec3(0.335, 0.318, 0.300);
        vec3 cappedPeak = vec3(0.430, 0.405, 0.375);
        vec3 color = mix(csf, deepGray, smoothstep(0.025, 0.12, windowed));
        color = mix(color, grayMatter, smoothstep(0.11, 0.40, windowed));
        color = mix(color, whiteMatter, smoothstep(0.38, 0.72, windowed));
        return mix(color, cappedPeak, smoothstep(0.76, 0.98, windowed));
      }

      void main() {
        if (uVisibility < 0.001) discard;
        vec3 displayCoordinate =
          (vAtlasPosition - uBoundsCenter) / uBoundsSize + 0.5;
        vec3 textureCoordinate = vec3(
          1.0 - displayCoordinate.x,
          1.0 - displayCoordinate.y,
          displayCoordinate.z
        );
        if (uSlabAxis > 1.5) {
          textureCoordinate.z = uSlabCenter;
        } else {
          textureCoordinate.x = uSlabCenter;
        }
        if (
          any(lessThan(textureCoordinate, vec3(0.0))) ||
          any(greaterThan(textureCoordinate, vec3(1.0)))
        ) {
          discard;
        }

        vec2 planeUv = textureToPlaneUv(textureCoordinate);
        vec2 dimensions = planeDimensions();
        vec2 texel = 1.0 / max(dimensions, vec2(1.0));
        float centerByte = labelByteAt(planeUv);
        vec4 neighborBytes = vec4(
          labelByteAt(planeUv - vec2(texel.x, 0.0)),
          labelByteAt(planeUv + vec2(texel.x, 0.0)),
          labelByteAt(planeUv - vec2(0.0, texel.y)),
          labelByteAt(planeUv + vec2(0.0, texel.y))
        );
        float selection = packedBit(centerByte, uMaskBit);
        vec4 selectionNeighbors = vec4(
          packedBit(neighborBytes.x, uMaskBit),
          packedBit(neighborBytes.y, uMaskBit),
          packedBit(neighborBytes.z, uMaskBit),
          packedBit(neighborBytes.w, uMaskBit)
        );
        float displaySupport = reconstructedBrainSupport(planeUv);
        if (displaySupport < 0.002 && selection < 0.5) discard;

        vec2 voxelCoordinate = planeUv * dimensions - 0.5;
        vec2 voxelFraction = fract(voxelCoordinate);
        vec2 pixelFootprint = fwidth(voxelCoordinate);
        float footprint = max(
          max(pixelFootprint.x, pixelFootprint.y),
          0.012
        );
        float targetDistance = insideEdgeDistance(
          selection,
          selectionNeighbors,
          voxelFraction
        );
        float supportAa = max(fwidth(displaySupport) * 0.72, 0.018);
        float supportAlpha = smoothstep(
          0.48 - supportAa,
          0.52 + supportAa,
          displaySupport
        );
        float contourWidth = clamp(footprint * 0.88, 0.025, 0.28);
        float contour = selection * (
          1.0 - smoothstep(
            contourWidth * 0.42,
            contourWidth * 1.15,
            targetDistance
          )
        );

        float intensity = reconstructedT1(planeUv);
        vec3 color = diagnosticT1(intensity);
        float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
        float accentLuminance = max(
          dot(uAccent, vec3(0.2126, 0.7152, 0.0722)),
          0.001
        );
        vec3 matchedAccent = uAccent * (luminance / accentLuminance);
        matchedAccent =
          vec3(luminance) +
          (matchedAccent - vec3(luminance)) * 1.12;
        ${
          contextualXray
            ? `
        float contextualLuminance = dot(
          color,
          vec3(0.2126, 0.7152, 0.0722)
        );
        color =
          vec3(contextualLuminance) * vec3(0.88, 0.92, 1.0);
        float targetContactCue = max(selection, contour * 0.72);
        color *= 1.0 - targetContactCue * 0.14;
        float planeRadius = length(
          (planeUv - vec2(0.5)) * vec2(0.84, 1.08)
        );
        float planeVignette =
          1.0 - smoothstep(0.36, 0.69, planeRadius);
        float alpha =
          supportAlpha *
          (
            0.035 +
            planeVignette * 0.095 +
            selection * 0.085
          ) *
          ${mobilePresentation ? "1.42" : "1.0"} *
          uVisibility;
        if (alpha < 0.002) discard;
        outColor = vec4(color * alpha, alpha);`
            : `
        color = mix(color, matchedAccent, selection * 0.22);
        vec3 contourAccent = matchedAccent * 1.04;
        color = mix(color, contourAccent, contour * 0.68);

        float alpha = max(supportAlpha, selection);
        alpha *= uVisibility;
        if (alpha < 0.002) discard;
        outColor = vec4(color * alpha, alpha);`
        }
      }
    `,
    glslVersion: THREE.GLSL3,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: true,
    depthWrite: !contextualXray,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
  material.customProgramCacheKey = () =>
    `brain-atlas-${presentationMode}-clean-diagnostic-plane`;
  material.userData.diagnosticPlane = {
    intensitySampling: "native-section-hardware-trilinear",
    labels: "native-nearest-exact-occupancy",
    labelBoundaryPresentation: "inside-only-screen-space-analytic-aa",
    edgeEnhancement: "none",
    ringing: "none-no-negative-lobes",
    supportAlpha: "native-brainmask-bilinear-outer-display-alpha",
    composition: contextualXray
      ? "bounded-dark-grayscale-glass-plane-with-target-local-opacity"
      : "opaque-diagnostic-cut-face",
  };
  const plane = new THREE.Mesh(geometry, material);
  plane.name = contextualXray
    ? "V33 bounded embedded MRI reference plane"
    : `${presentationMode} MRI seated at anatomical cut`;
  plane.renderOrder = contextualXray ? 3 : 8;
  plane.raycast = () => {};
  plane.visible = false;
  if (contextualXray) {
    const frameMaterial = new THREE.ShaderMaterial({
      name: "V33 bounded diagnostic glass-plane frame",
      vertexShader: /* glsl */ `
        out vec2 vFrameUv;
        void main() {
          vFrameUv = uv;
          gl_Position =
            projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        in vec2 vFrameUv;
        out vec4 outColor;
        void main() {
          vec2 edgeDistance = min(vFrameUv, 1.0 - vFrameUv);
          float nearestEdge = min(edgeDistance.x, edgeDistance.y);
          float frame = 1.0 - smoothstep(0.006, 0.018, nearestEdge);
          float cornerFalloff =
            smoothstep(0.0, 0.12, vFrameUv.x) *
            smoothstep(0.0, 0.12, vFrameUv.y) *
            smoothstep(0.0, 0.12, 1.0 - vFrameUv.x) *
            smoothstep(0.0, 0.12, 1.0 - vFrameUv.y);
          float glass = 0.006 * cornerFalloff;
          float alpha =
            (frame * 0.085 + glass) *
            ${mobilePresentation ? "1.35" : "1.0"};
          outColor = vec4(vec3(0.48, 0.54, 0.62), alpha);
        }
      `,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: true,
    });
    frameMaterial.customProgramCacheKey = () =>
      "brain-v33-bounded-diagnostic-glass-frame";
    frameMaterial.userData.diagnosticFrame = {
      role: "bounded-planar-reference-cue",
      edgeOpacity: 0.14,
      centerOpacity: 0.006,
    };
    const frame = new THREE.Mesh(geometry, frameMaterial);
    frame.name = "V33 diagnostic plane bounded glass frame";
    frame.scale.setScalar(1.015);
    frame.position.z = -0.0015;
    frame.renderOrder = 2;
    frame.raycast = () => {};
    plane.add(frame);
    ownedMaterials.add(frameMaterial);
  }
  setDiagnosticPlaneTransform(
    plane,
    data.manifest.regions.hippocampus,
    boundsCenter,
    boundsSize,
  );
  atlasRoot.updateWorldMatrix(true, false);
  uniforms.uAtlasWorldInverse.value.copy(atlasRoot.matrixWorld).invert();
  ownedGeometries.add(geometry);
  ownedMaterials.add(material);
  return { plane, uniforms };
}

function createMaterial(
  data: BrainVolumeData,
  maxSteps: number,
  uniforms: VolumeUniforms,
  presentationMode: BrainInternalPresentationMode,
) {
  const material = new THREE.ShaderMaterial({
    name: `FreeSurfer volume raymarch ${maxSteps} steps`,
    uniforms,
    vertexShader,
    fragmentShader:
      data.profile === "v24"
        ? presentationMode === "volume-v29" ||
          presentationMode === "volume-v30" ||
          presentationMode === "volume-v31" ||
          presentationMode === "volume-v32" ||
          presentationMode === "volume-v33"
          ? fragmentShaderV29Target(maxSteps)
          : presentationMode === "volume-v26" ||
          presentationMode === "volume-v27" ||
          presentationMode === "volume-v28"
          ? fragmentShaderV26(maxSteps)
          : presentationMode === "volume-v25"
            ? fragmentShaderV25(maxSteps)
            : fragmentShaderV24(maxSteps)
        : fragmentShaderV23(maxSteps),
    glslVersion: THREE.GLSL3,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.FrontSide,
    toneMapped: true,
  });
  material.customProgramCacheKey = () =>
    `brain-atlas-volume-${presentationMode}-${maxSteps}-${data.manifest.volume.dimensions.join("x")}`;
  material.userData.volumeRaymarch = {
    maxSteps,
    earlyTerminationAlpha: 0.965,
    stableSampling: true,
    gradientSource: "precomputed-octahedral",
    profile: data.profile,
    presentationMode,
  };
  return material;
}

function applyRegion(
  uniforms: VolumeUniforms,
  region: BrainVolumeRegion,
  regionId: "hippocampus" | "amygdala" | "corpus-callosum",
  presentationMode: BrainInternalPresentationMode,
) {
  uniforms.uSlabAxis.value = region.orientation === "sagittal" ? 0 : 2;
  uniforms.uSlabCenter.value = region.normalizedCenter;
  uniforms.uSlabHalfDepth.value =
    region.normalizedHalfDepth ?? region.contextHalfDepthNormalized ?? 0.06;
  uniforms.uContextHalfVoxels.value =
    presentationMode === "volume-v25" ||
    presentationMode === "volume-v26" ||
    presentationMode === "volume-v27" ||
    presentationMode === "volume-v28"
      ? Math.min(region.contextRadiusVoxels ?? 12, 12)
      : region.contextRadiusVoxels ?? 12;
  uniforms.uMaskBit.value = region.bit;
  const textureBounds = region.textureBoundsNormalized;
  uniforms.uTargetBoundsMin.value.fromArray(
    textureBounds?.minimum ?? [0, 0, 0],
  );
  uniforms.uTargetBoundsMax.value.fromArray(
    textureBounds?.maximum ?? [1, 1, 1],
  );
  uniforms.uMaskChannel.value.set(
    region.bit === 1 ? 1 : 0,
    region.bit === 2 ? 1 : 0,
    region.bit === 4 ? 1 : 0,
  );
  uniforms.uAccent.value.set(VOLUME_ACCENTS[regionId]);
}

export function resolveBrainInternalPresentationMode(): BrainInternalPresentationMode {
  if (
    process.env.NODE_ENV !== "production" &&
    typeof window !== "undefined"
  ) {
    const requested = new URLSearchParams(window.location.search).get(
      "brainInternalMode",
    );
    if (
      requested === "cutaway" ||
      requested === "volume-v23" ||
      requested === "volume-v24" ||
      requested === "volume-v25" ||
      requested === "volume-v26" ||
      requested === "volume-v27" ||
      requested === "volume-v28" ||
      requested === "volume-v29" ||
      requested === "volume-v30" ||
      requested === "volume-v31" ||
      requested === "volume-v32" ||
      requested === "volume-v33"
    ) {
      return requested;
    }
    if (requested === "volume") return "volume-v23";
  }
  return "volume-v33";
}

type VolumeContextShellResult = Readonly<{
  shell: THREE.Group;
  shellUniforms: {
    uAtlasWorldInverse: { value: THREE.Matrix4 };
  } | null;
  setRegion?: (regionId: RegionId, region: BrainVolumeRegion) => void;
  updateCamera?: (camera: THREE.Camera) => void;
}>;

export function createBrainVolumePresentation(
  data: BrainVolumeData,
  atlasRoot: THREE.Object3D,
  mobilePresentation: boolean,
  ownedGeometries: Set<THREE.BufferGeometry>,
  ownedMaterials: Set<THREE.Material>,
  presentationMode: BrainInternalPresentationMode,
): BrainVolumePresentation {
  const solidCutaway =
    presentationMode === "volume-v27" || presentationMode === "volume-v28";
  const premiumXray =
    presentationMode === "volume-v29" ||
    presentationMode === "volume-v30" ||
    presentationMode === "volume-v31" ||
    presentationMode === "volume-v32" ||
    presentationMode === "volume-v33";
  const debugLayer =
    (presentationMode === "volume-v31" ||
      presentationMode === "volume-v32" ||
      presentationMode === "volume-v33") &&
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("brainDebugLayer")
      : null;
  const showShellLayer =
    debugLayer === null ||
    debugLayer === "composite" ||
    debugLayer === "shell";
  const showMriLayer =
    debugLayer === null ||
    debugLayer === "composite" ||
    debugLayer === "mri";
  const showTargetLayer =
    debugLayer === null ||
    debugLayer === "composite" ||
    debugLayer === "target";
  const initialTargetBounds =
    data.manifest.regions.hippocampus.textureBoundsNormalized;
  const uniforms: VolumeUniforms = {
    uIntensity: { value: data.intensityTexture },
    uMasks: { value: data.maskTexture ?? data.intensityTexture },
    uLabels: { value: data.labelTexture ?? data.intensityTexture },
    uGradient: { value: data.gradientTexture },
    uCameraObject: { value: new THREE.Vector3() },
    uSlabAxis: { value: 2 },
    uSlabCenter: { value: data.manifest.regions.hippocampus.normalizedCenter },
    uSlabHalfDepth: {
      value:
        data.manifest.regions.hippocampus.normalizedHalfDepth ??
        data.manifest.regions.hippocampus.contextHalfDepthNormalized ??
        0.06,
    },
    uMaskChannel: { value: new THREE.Vector3(1, 0, 0) },
    uMaskBit: { value: 1 },
    uVolumeDimensions: {
      value: new THREE.Vector3(...data.manifest.volume.dimensions),
    },
    uContextHalfVoxels: {
      value:
        presentationMode === "volume-v25" ||
        presentationMode === "volume-v26" ||
        solidCutaway
          ? Math.min(
              data.manifest.regions.hippocampus.contextRadiusVoxels ?? 12,
              12,
            )
          : data.manifest.regions.hippocampus.contextRadiusVoxels ?? 14,
    },
    uTargetBoundsMin: {
      value: new THREE.Vector3(
        ...(initialTargetBounds?.minimum ?? [0, 0, 0]),
      ),
    },
    uTargetBoundsMax: {
      value: new THREE.Vector3(
        ...(initialTargetBounds?.maximum ?? [1, 1, 1]),
      ),
    },
    uAccent: { value: new THREE.Color(VOLUME_ACCENTS.hippocampus) },
    uContextOpacity: { value: mobilePresentation ? 0.044 : 0.038 },
    uTargetOpacity: { value: mobilePresentation ? 0.22 : 0.18 },
    uVisibility: { value: 0 },
  };
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.name = "Atlas volume bounds";
  const desktopSteps =
    solidCutaway
      ? 1
      : premiumXray
        ? 1
      : presentationMode === "volume-v25" ||
          presentationMode === "volume-v26"
      ? 56
      : data.profile === "v24"
        ? 56
        : 72;
  const mobileSteps =
    solidCutaway
      ? 1
      : premiumXray
        ? 1
      : presentationMode === "volume-v25" ||
          presentationMode === "volume-v26"
      ? 40
      : data.profile === "v24"
        ? 40
        : 48;
  const desktopMaterial = createMaterial(
    data,
    desktopSteps,
    uniforms,
    presentationMode,
  );
  const mobileMaterial = createMaterial(
    data,
    mobileSteps,
    uniforms,
    presentationMode,
  );
  const desktopMesh = new THREE.Mesh(geometry, desktopMaterial);
  const mobileMesh = new THREE.Mesh(geometry, mobileMaterial);
  const targetRaycastSources = new Map<
    "hippocampus" | "amygdala" | "corpus-callosum",
    THREE.Mesh[]
  >([
    ["hippocampus", []],
    ["amygdala", []],
    ["corpus-callosum", []],
  ]);
  if (premiumXray) {
    atlasRoot.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const regionId = object.userData.brainRegionId as RegionId | undefined;
      if (
        regionId !== "hippocampus" &&
        regionId !== "amygdala" &&
        regionId !== "corpus-callosum"
      ) {
        return;
      }
      if (object.userData.hitProxy === true) return;
      targetRaycastSources.get(regionId)?.push(object);
    });
  }
  const bounds = data.manifest.volume.displayBounds;
  const center = new THREE.Vector3(...bounds.centerMillimeters);
  const size = new THREE.Vector3(...bounds.sizeMillimeters);
  for (const mesh of [desktopMesh, mobileMesh]) {
    mesh.name = `${mesh.material.name} brain-aligned box`;
    mesh.position.copy(center);
    mesh.scale.copy(size);
    mesh.renderOrder = premiumXray ? 4 : 6;
    mesh.frustumCulled = true;
    if (!premiumXray) mesh.raycast = () => {};
    mesh.visible = false;
  }
  let raycastRegionId:
    | "hippocampus"
    | "amygdala"
    | "corpus-callosum" = "hippocampus";
  if (premiumXray) {
    const targetRaycast = (
      raycaster: THREE.Raycaster,
      intersections: THREE.Intersection[],
    ) => {
      const targetMesh = mobilePresentation ? mobileMesh : desktopMesh;
      const targetIntersections: THREE.Intersection[] = [];
      targetRaycastSources.get(raycastRegionId)?.forEach((source) => {
        source.raycast(raycaster, targetIntersections);
      });
      targetIntersections.forEach((intersection) => {
        intersection.object = targetMesh;
        intersections.push(intersection);
      });
    };
    for (const mesh of [desktopMesh, mobileMesh]) {
      mesh.userData.brainRegionId = raycastRegionId;
      mesh.userData.v29VisibleTargetRaycast = true;
      mesh.raycast = targetRaycast;
    }
  }
  const group = new THREE.Group();
  group.name =
    premiumXray
      ? "Cached V33 balanced in-situ X-ray locator"
      : solidCutaway
      ? `Cached ${presentationMode === "volume-v28" ? "V28" : "V27"} solid anatomical cutaway`
      : "Cached FreeSurfer atlas volume";
  group.userData.volumePresentation = true;
  group.userData.sourceTransform = "T1-vox2ras-tkr-to-atlas-display";
  const v25ContextShellEnabled =
    presentationMode === "volume-v25" &&
    process.env.NODE_ENV !== "production" &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("brainContextShell") ===
      "1";
  const contextShellEnabled =
    presentationMode === "volume-v26" ||
    premiumXray ||
    solidCutaway ||
    v25ContextShellEnabled;
  const contextShellResult: VolumeContextShellResult =
    premiumXray
      ? createV33CoherentXrayShell(
          data,
          uniforms,
          ownedGeometries,
          ownedMaterials,
          mobilePresentation,
        )
      : solidCutaway
      ? createV27RetainedPialCutaway(
          data,
          atlasRoot,
          center,
          size,
          uniforms,
          ownedGeometries,
          ownedMaterials,
          presentationMode,
        )
      : presentationMode === "volume-v26"
      ? createV26InSituContextShell(
          atlasRoot,
          center,
          size,
          uniforms,
          ownedMaterials,
        )
      : v25ContextShellEnabled
        ? createV25ContextShell(
            atlasRoot,
            center,
            size,
            uniforms,
            ownedMaterials,
          )
      : {
          shell: new THREE.Group(),
          shellUniforms: null,
        };
  const contextShell = contextShellResult.shell;
  const targetSurfaceResult = premiumXray
    ? createV33BalancedTargetSurfaces(
        data,
        ownedGeometries,
        ownedMaterials,
      )
    : null;
  const diagnosticPlaneResult =
    premiumXray || solidCutaway
      ? createV27DiagnosticPlane(
          data,
          atlasRoot,
          center,
          size,
          uniforms,
          ownedGeometries,
          ownedMaterials,
          presentationMode,
          mobilePresentation,
        )
      : presentationMode === "volume-v26"
      ? createV26DiagnosticPlane(
          data,
          atlasRoot,
          center,
          size,
          uniforms,
          ownedGeometries,
          ownedMaterials,
        )
      : null;
  const diagnosticPlane = diagnosticPlaneResult?.plane ?? null;
  group.add(contextShell, desktopMesh, mobileMesh);
  if (targetSurfaceResult) group.add(targetSurfaceResult.group);
  if (diagnosticPlane) group.add(diagnosticPlane);
  atlasRoot.add(group);
  const activeMesh = mobilePresentation ? mobileMesh : desktopMesh;
  activeMesh.visible = !solidCutaway && !premiumXray;
  const cameraScratch = new THREE.Vector3();

  ownedGeometries.add(geometry);
  ownedMaterials.add(desktopMaterial);
  ownedMaterials.add(mobileMaterial);

  return {
    group,
    desktopMesh,
    mobileMesh,
    activeMesh,
    contextShell,
    diagnosticPlane,
    uniforms,
    setRegion(regionId) {
      if (
        regionId !== "hippocampus" &&
        regionId !== "amygdala" &&
        regionId !== "corpus-callosum"
      ) {
        return;
      }
      applyRegion(
        uniforms,
        data.manifest.regions[regionId],
        regionId,
        presentationMode,
      );
      if (premiumXray) {
        raycastRegionId = regionId;
        for (const mesh of [desktopMesh, mobileMesh]) {
          mesh.userData.brainRegionId = regionId;
        }
        targetSurfaceResult?.setRegion(regionId);
      }
      if (diagnosticPlane) {
        setDiagnosticPlaneTransform(
          diagnosticPlane,
          data.manifest.regions[regionId],
          center,
          size,
        );
      }
      contextShellResult.setRegion?.(
        regionId,
        data.manifest.regions[regionId],
      );
    },
    setVisible(visible) {
      uniforms.uVisibility.value = visible ? 1 : 0;
      desktopMesh.visible =
        visible &&
        !mobilePresentation &&
        !solidCutaway &&
        !premiumXray;
      mobileMesh.visible =
        visible &&
        mobilePresentation &&
        !solidCutaway &&
        !premiumXray;
      targetSurfaceResult?.setVisible(visible && showTargetLayer);
      contextShell.visible =
        visible && contextShellEnabled && showShellLayer;
      if (diagnosticPlane) {
        diagnosticPlane.visible =
          visible &&
          showMriLayer &&
          (presentationMode === "volume-v26" ||
            premiumXray ||
            solidCutaway);
      }
    },
    updateCamera(camera) {
      cameraScratch.copy(camera.position);
      activeMesh.worldToLocal(cameraScratch);
      uniforms.uCameraObject.value.copy(cameraScratch);
      contextShellResult.shellUniforms?.uAtlasWorldInverse.value
        .copy(atlasRoot.matrixWorld)
        .invert();
      contextShellResult.updateCamera?.(camera);
      diagnosticPlaneResult?.uniforms.uAtlasWorldInverse.value
        .copy(atlasRoot.matrixWorld)
        .invert();
    },
    finishPrewarm() {
      if (uniforms.uVisibility.value > 0) return;
      desktopMesh.visible = false;
      mobileMesh.visible = false;
      contextShell.visible = false;
      targetSurfaceResult?.setVisible(false);
      if (diagnosticPlane) diagnosticPlane.visible = false;
    },
    diagnostics: {
      resolution: data.manifest.volume.dimensions,
      raySteps:
        solidCutaway || premiumXray
          ? 0
          : mobilePresentation
            ? mobileSteps
            : desktopSteps,
      gpuMemoryBytes: data.manifest.gpuMemoryBytes,
      payloadBytes:
        data.manifest.volume.intensity.bytes +
        (data.manifest.volume.masks?.bytes ??
          data.manifest.volume.labels?.bytes ??
          0) +
        data.manifest.volume.gradient.bytes +
        (premiumXray
          ? (
              [
                "hippocampus",
                "amygdala",
                "corpus-callosum",
              ] as const
            ).reduce(
              (total, regionId) =>
                total +
                (data.manifest.regions[regionId].displaySurface?.bytes ??
                  0),
              0,
            )
          : 0),
      contextShellMeshCount: contextShell.children.length,
      exactDiagnosticPlane: diagnosticPlane !== null,
      architecture:
        premiumXray
          ? "v33-continuous-shell-bounded-mri-structure-target-hierarchy"
          : presentationMode === "volume-v28"
          ? "inset-opaque-pial-half-with-clean-brainmask-section"
          : presentationMode === "volume-v27"
            ? "opaque-camera-far-pial-half-with-physical-cut-rim"
          : presentationMode === "volume-v26"
            ? "transparent-whole-pial-context"
            : "raymarched-volume-slab",
      intensityReconstruction:
        premiumXray
          ? "embedded-plane-native-trilinear"
          : solidCutaway
          ? "native-section-hardware-trilinear"
          : "hardware-linear",
      labelSampling: "native-nearest-exact",
      targetPresentation: premiumXray
        ? "structure-specific-volume-corrected-sdf-from-verified-aseg"
        : "section-integrated",
    },
  };
}
