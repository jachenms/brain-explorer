import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import type { RegionId } from "./brain-regions";

export type BrainVolumeRegion = Readonly<{
  bit: number;
  labels: readonly number[];
  orientation: "coronal" | "sagittal";
  normalizedCenter: number;
  normalizedHalfDepth?: number;
  contextHalfDepthNormalized?: number;
  contextRadiusVoxels?: number;
  centralSectionThicknessVoxels?: number;
  textureBoundsNormalized?: {
    minimum: readonly [number, number, number];
    maximum: readonly [number, number, number];
  };
  displaySurface?: {
    asset: string;
    bytes: number;
    uncompressedBytes: number;
    sha256: string;
    vertexCount: number;
    triangleCount: number;
    provenance: string;
    displaySmoothing: string;
    reconstruction: {
      method: string;
      supersample: number;
      isoLevel: number;
      smoothingSigmaMillimeters: number;
      nativeVoxelVolumeMm3: number;
      exactAtlasVolumeMm3: number;
      cleanedDisplaySourceVolumeMm3: number;
      displayVolumeMm3: number;
      displayDeviationFromAtlasPercent: number;
      volumeErrorPercent: number;
      centroidErrorMillimeters: number;
      dimensionDeltaPercent: readonly [number, number, number];
      connectedComponents: number;
      watertight: boolean;
      displayCleanup: {
        inputComponents: number;
        retainedComponents: number;
        removedVoxels: number;
        finalComponents: number;
        closingRadiusVoxels: number;
        filledCracksAndCavities: boolean;
        addedVoxels: number;
        removedSourceVoxels: number;
      };
    };
  };
}>;

export type BrainVolumeProfile = "v23" | "v24";

type BrainVolumePayload = Readonly<{
  asset: string;
  bytes: number;
  uncompressedBytes: number;
  sha256: string;
}>;

export type BrainVolumeManifest = Readonly<{
  schemaVersion: number;
  source: {
    dataset: string;
    shape: readonly [number, number, number];
    vox2rasTkr: readonly (readonly number[])[];
    displayAxisMapping: readonly string[];
  };
  volume: {
    dimensions: readonly [number, number, number];
    intensity: BrainVolumePayload;
    masks?: BrainVolumePayload;
    labels?: BrainVolumePayload;
    gradient: BrainVolumePayload;
    gradientDimensions?: readonly [number, number, number];
    contextShell?: BrainVolumePayload & {
      vertexCount: number;
      triangleCount: number;
      connectedComponents: number;
      watertight: boolean;
      provenance: string;
      role: string;
    };
    displayBounds: {
      minimumMillimeters: readonly [number, number, number];
      maximumMillimeters: readonly [number, number, number];
      centerMillimeters: readonly [number, number, number];
      sizeMillimeters: readonly [number, number, number];
    };
  };
  regions: Readonly<
    Record<"hippocampus" | "amygdala" | "corpus-callosum", BrainVolumeRegion>
  >;
  gpuMemoryBytes: number;
}>;

export type BrainVolumeData = Readonly<{
  manifest: BrainVolumeManifest;
  profile: BrainVolumeProfile;
  intensityTexture: THREE.Data3DTexture;
  maskTexture: THREE.Data3DTexture | null;
  labelTexture: THREE.Data3DTexture | null;
  gradientTexture: THREE.Data3DTexture;
  contextShellGeometry: THREE.BufferGeometry | null;
  targetGeometries: Readonly<
    Record<
      "hippocampus" | "amygdala" | "corpus-callosum",
      THREE.BufferGeometry
    >
  > | null;
}>;

type MutableResource = Readonly<{
  read: () => BrainVolumeData;
}>;

const MANIFEST_URLS: Readonly<Record<BrainVolumeProfile, string>> = {
  v23: "/textures/brain-volume/manifest.json",
  v24: "/textures/brain-volume-v24/manifest.json",
};
const resources = new Map<string, MutableResource>();

async function loadTargetGeometry(asset: string) {
  const gltf = await new GLTFLoader().loadAsync(asset);
  gltf.scene.updateWorldMatrix(true, true);
  let sourceMesh: THREE.Mesh | null = null;
  gltf.scene.traverse((object) => {
    if (sourceMesh || !(object instanceof THREE.Mesh)) return;
    sourceMesh = object;
  });
  if (!sourceMesh) {
    throw new Error(`Brain target surface has no mesh: ${asset}`);
  }
  const mesh = sourceMesh as THREE.Mesh;
  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

async function fetchBuffer(url: string, attempt: number) {
  const response = await fetch(url, {
    cache: attempt === 0 ? "default" : "reload",
  });
  if (!response.ok) {
    throw new Error(`Brain volume request failed (${response.status}): ${url}`);
  }
  const compressed = await response.arrayBuffer();
  const signature = new Uint8Array(compressed, 0, Math.min(2, compressed.byteLength));
  if (signature[0] !== 0x1f || signature[1] !== 0x8b) return compressed;
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot decode the atlas volume payload.");
  }
  const stream = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

function createTexture(
  data: Uint8Array,
  dimensions: readonly [number, number, number],
  format: THREE.PixelFormat,
  filter: THREE.MagnificationTextureFilter,
) {
  const texture = new THREE.Data3DTexture(
    data,
    dimensions[0],
    dimensions[1],
    dimensions[2],
  );
  texture.format = format;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = filter;
  texture.magFilter = filter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createResource(
  attempt: number,
  profile: BrainVolumeProfile,
): MutableResource {
  let status: "pending" | "fulfilled" | "rejected" = "pending";
  let result: BrainVolumeData | null = null;
  let failure: unknown = null;
  const promise = Promise.resolve()
    .then(async () => {
      const manifestResponse = await fetch(MANIFEST_URLS[profile], {
        cache: attempt === 0 ? "default" : "reload",
      });
      if (!manifestResponse.ok) {
        throw new Error(
          `Brain volume manifest failed (${manifestResponse.status}).`,
        );
      }
      const manifest = (await manifestResponse.json()) as BrainVolumeManifest;
      const semanticPayload =
        profile === "v24" ? manifest.volume.labels : manifest.volume.masks;
      if (!semanticPayload) {
        throw new Error(`Brain volume ${profile} semantic payload is absent.`);
      }
      const regionIds = [
        "hippocampus",
        "amygdala",
        "corpus-callosum",
      ] as const;
      const [
        intensityBuffer,
        semanticBuffer,
        gradientBuffer,
        targetGeometryEntries,
        contextShellGeometry,
      ] = await Promise.all([
        fetchBuffer(manifest.volume.intensity.asset, attempt),
        fetchBuffer(semanticPayload.asset, attempt),
        fetchBuffer(manifest.volume.gradient.asset, attempt),
        profile === "v24"
          ? Promise.all(
              regionIds.map(async (regionId) => {
                const surface = manifest.regions[regionId].displaySurface;
                if (!surface) {
                  throw new Error(
                    `Brain volume target surface is absent: ${regionId}`,
                  );
                }
                return [
                  regionId,
                  await loadTargetGeometry(surface.asset),
                ] as const;
              }),
            )
          : Promise.resolve(null),
        profile === "v24" && manifest.volume.contextShell
          ? loadTargetGeometry(manifest.volume.contextShell.asset)
          : Promise.resolve(null),
      ]);
      if (
        intensityBuffer.byteLength !==
          manifest.volume.intensity.uncompressedBytes ||
        semanticBuffer.byteLength !== semanticPayload.uncompressedBytes ||
        gradientBuffer.byteLength !==
          manifest.volume.gradient.uncompressedBytes
      ) {
        throw new Error("Brain volume payload size does not match its manifest.");
      }
      const intensityTexture = createTexture(
        new Uint8Array(intensityBuffer),
        manifest.volume.dimensions,
        THREE.RedFormat,
        THREE.LinearFilter,
      );
      intensityTexture.name = "FreeSurfer T1 R8 atlas volume";
      const semanticTexture = createTexture(
        new Uint8Array(semanticBuffer),
        manifest.volume.dimensions,
        profile === "v24" ? THREE.RedFormat : THREE.RGBAFormat,
        profile === "v24" ? THREE.NearestFilter : THREE.LinearFilter,
      );
      semanticTexture.name =
        profile === "v24"
          ? "FreeSurfer native aseg label volume"
          : "FreeSurfer aseg semantic mask volume";
      const gradientTexture = createTexture(
        new Uint8Array(gradientBuffer),
        manifest.volume.gradientDimensions ?? manifest.volume.dimensions,
        THREE.RGFormat,
        THREE.LinearFilter,
      );
      gradientTexture.name = "FreeSurfer T1 gradient atlas volume";
      result = {
        manifest,
        profile,
        intensityTexture,
        maskTexture: profile === "v23" ? semanticTexture : null,
        labelTexture: profile === "v24" ? semanticTexture : null,
        gradientTexture,
        contextShellGeometry,
        targetGeometries: targetGeometryEntries
          ? (Object.fromEntries(targetGeometryEntries) as Record<
              (typeof regionIds)[number],
              THREE.BufferGeometry
            >)
          : null,
      };
      status = "fulfilled";
    })
    .catch((error: unknown) => {
      failure = error;
      status = "rejected";
    });

  return {
    read() {
      if (status === "fulfilled" && result) return result;
      if (status === "rejected") throw failure;
      throw promise;
    },
  };
}

export function getBrainVolumeResource(
  attempt: number,
  profile: BrainVolumeProfile,
) {
  const key = `${attempt}:${profile}`;
  const existing = resources.get(key);
  if (existing) return existing;
  const resource = createResource(attempt, profile);
  resources.set(key, resource);
  return resource;
}

export function isVolumeRegion(
  regionId: RegionId | null,
): regionId is "hippocampus" | "amygdala" | "corpus-callosum" {
  return (
    regionId === "hippocampus" ||
    regionId === "amygdala" ||
    regionId === "corpus-callosum"
  );
}
