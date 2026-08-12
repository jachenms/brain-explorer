"use client";

import {
  ContactShadows,
  Environment,
  Lightformer,
  PointMaterial,
  Points,
} from "@react-three/drei";
import {
  Canvas,
  useFrame,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import {
  Bloom,
  EffectComposer,
  N8AO,
  ToneMapping,
  Vignette,
} from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from "react";
import * as THREE from "three";

import {
  ENCLOSED_REGION_IDS,
  getBrainCursorClass,
  INTERACTION_BLOOM,
} from "@/lib/brain-interaction";
import type {
  BrainSelectionFocusIntent,
  CameraPose,
  CameraTransitionPhase,
} from "@/lib/brain-camera";
import {
  getIdleSpecimenTransform,
} from "@/lib/brain-camera";
import {
  createBrainExtractionPlanRegistry,
  type BrainExtractionPlanRegistry,
} from "@/lib/brain-extraction";
import { reportExhibitSceneReady } from "@/lib/exhibit-loading-store";
import {
  initialBrainCameraGestureSignal,
  initialBrainGestureState,
  reduceBrainGesture,
  signalBrainCameraWheel,
  syncBrainCameraGestureSignal,
  type BrainCameraGestureSignal,
  type BrainGestureState,
} from "@/lib/brain-gesture";
import { buildInteractionTargetDiagnostic } from "@/lib/brain-interaction-diagnostics";
import {
  getBrainIntersectionRegionId,
} from "@/lib/brain-interaction-raycast";
import {
  isVisibleSurfaceObject,
  probeVisibleRegionSurface,
  raycastBrainAtNdc,
  type VisibleSurfaceProbeHit,
} from "@/lib/brain-visible-surface-probe";
import type { RegionId } from "@/lib/brain-regions";
import { recordBrainTransitionOperation } from "@/lib/brain-transition-performance";
import { getRegionInfoCardLayout } from "@/lib/region-info-card-layout";
import {
  chooseRegionContourAnchorCandidate,
  chooseRegionMarkerCandidate,
  createRegionCardCameraFingerprint,
  createRegionSelectedContourProbePoints,
  findNearestPointsBetweenRegionHulls,
  createRegionScreenHull,
  createEmptyRegionLeaderProbeQueueCounts,
  createRegionLeaderWorldAnchor,
  getRegionMarkerInteriorClearance,
  isRegionLeaderExternalSilhouetteMember,
  REGION_LEADER_SILHOUETTE_ROLES,
  REGION_INFO_LEADER,
  shouldRetryRegionLeaderSupportRegistration,
  projectLeaderNdcToScreen,
  type RegionInfoLeaderHandle,
  type RegionLeaderSilhouette,
  type RegionLeaderSilhouetteMember,
  type RegionLeaderSupportRegistry,
  type RegionLeaderWorldAnchor,
} from "@/lib/region-info-leader";
import {
  advanceSpecimenMotionClock,
  createSpecimenMotionState,
  type SpecimenMotionState,
} from "@/lib/brain-specimen-motion";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

import { BrainModel } from "./BrainModel";
import { CinematicOrbitControls } from "./CinematicOrbitControls";

type BrainSceneProps = {
  modelAttempt: number;
  onInteraction: () => void;
  maximumDpr: number;
  mobilePresentation: boolean;
  compactLandscape: boolean;
  canvasHoveredRegionId: RegionId | null;
  hoveredRegionId: RegionId | null;
  selectedRegionId: RegionId | null;
  leaderRegionId: RegionId | null;
  selectionFocusIntent: BrainSelectionFocusIntent | null;
  onRegionHoverChange: (regionId: RegionId, hovered: boolean) => void;
  onPointerExit: () => void;
  onRegionClick: (
    regionId: RegionId,
    focusIntent: BrainSelectionFocusIntent,
  ) => void;
  onBackgroundHover: () => void;
  onBackgroundClick: () => void;
  onCanvasPointerMove: (
    clientX: number,
    clientY: number,
    pointerType: string,
  ) => void;
  regionLeaderRef: MutableRefObject<RegionInfoLeaderHandle | null>;
  reservedLeftPx: number;
  reservedRightPx: number;
  navigatorBaseLeftPx: number;
  cardBaseRightPx: number;
  cardCameraConvergenceToken: string;
  cardCameraRefitRevision: number;
};
type SceneProps = Omit<
  BrainSceneProps,
  "maximumDpr" | "onCanvasPointerMove"
> & {
  shouldSuppressClick: () => boolean;
  cameraGestureSignalRef: MutableRefObject<BrainCameraGestureSignal>;
};

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function AmbientDust() {
  const points = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const random = seededRandom(271828);
    const result = new Float32Array(180 * 3);

    for (let index = 0; index < 180; index += 1) {
      const radius = 4.5 + random() * 7;
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      result[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      result[index * 3 + 1] = radius * Math.cos(phi) * 0.65;
      result[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }

    return result;
  }, []);

  useFrame((_, delta) => {
    if (points.current) points.current.rotation.y += delta * 0.008;
  });

  return (
    <Points ref={points} positions={positions} stride={3} frustumCulled={false}>
      <PointMaterial
        transparent
        color="#b8c8ee"
        size={0.018}
        sizeAttenuation
        depthWrite={false}
        opacity={0.14}
        toneMapped={false}
      />
    </Points>
  );
}

function FloatingBrain({
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
  specimenRef,
  extractionPlanRef,
  specimenMotionRef,
  leaderExtractionAnchorRef,
  leaderSupportRegistryRef,
}: Pick<
  SceneProps,
  | "modelAttempt"
  | "mobilePresentation"
  | "canvasHoveredRegionId"
  | "hoveredRegionId"
  | "selectedRegionId"
  | "onRegionHoverChange"
  | "onPointerExit"
  | "onRegionClick"
  | "shouldSuppressClick"
> & {
  prefersReducedMotion: boolean;
  specimenRef: MutableRefObject<THREE.Group | null>;
  extractionPlanRef: MutableRefObject<BrainExtractionPlanRegistry>;
  specimenMotionRef: MutableRefObject<SpecimenMotionState>;
  leaderExtractionAnchorRef: MutableRefObject<RegionLeaderWorldAnchor>;
  leaderSupportRegistryRef: MutableRefObject<RegionLeaderSupportRegistry | null>;
}) {
  useFrame((_, delta) => {
    if (!specimenRef.current) return;
    const motion = specimenMotionRef.current;
    const saved = motion.savedTransform;
    if (motion.locked && saved) {
      specimenRef.current.position.fromArray(saved.position);
      specimenRef.current.quaternion.fromArray(saved.quaternion);
      specimenRef.current.scale.fromArray(saved.scale);
      specimenRef.current.updateMatrix();
      specimenRef.current.updateMatrixWorld(true);
      return;
    }
    if (prefersReducedMotion) {
      specimenRef.current.position.set(0, 0, 0);
      specimenRef.current.quaternion.identity();
      specimenRef.current.scale.set(1, 1, 1);
      specimenRef.current.updateMatrix();
      specimenRef.current.updateMatrixWorld(true);
      return;
    }
    const elapsed = advanceSpecimenMotionClock(
      motion,
      delta,
      prefersReducedMotion,
    );
    const idleTransform = getIdleSpecimenTransform(elapsed);
    specimenRef.current.position.y = THREE.MathUtils.damp(
      specimenRef.current.position.y,
      idleTransform.position[1],
      3,
      delta,
    );
    specimenRef.current.rotation.x = THREE.MathUtils.damp(
      specimenRef.current.rotation.x,
      idleTransform.rotation[0],
      3,
      delta,
    );
    specimenRef.current.rotation.y = THREE.MathUtils.damp(
      specimenRef.current.rotation.y,
      idleTransform.rotation[1],
      3,
      delta,
    );
    specimenRef.current.rotation.z = THREE.MathUtils.damp(
      specimenRef.current.rotation.z,
      idleTransform.rotation[2],
      3,
      delta,
    );
  }, -2);

  return (
    <group ref={specimenRef}>
      <BrainModel
        modelAttempt={modelAttempt}
        mobilePresentation={mobilePresentation}
        canvasHoveredRegionId={canvasHoveredRegionId}
        hoveredRegionId={hoveredRegionId}
        selectedRegionId={selectedRegionId}
        onRegionHoverChange={onRegionHoverChange}
        onPointerExit={onPointerExit}
        onRegionClick={onRegionClick}
        shouldSuppressClick={shouldSuppressClick}
        prefersReducedMotion={prefersReducedMotion}
        extractionPlanRef={extractionPlanRef}
        leaderExtractionAnchorRef={leaderExtractionAnchorRef}
        leaderSupportRegistryRef={leaderSupportRegistryRef}
      />
    </group>
  );
}

function SceneReadiness({ attempt }: { attempt: number }) {
  const reportedRef = useRef(false);

  useFrame(() => {
    if (reportedRef.current) return;
    reportedRef.current = true;
    reportExhibitSceneReady(attempt);
  });

  return null;
}

function CanvasViewportSynchronizer() {
  const { gl, setSize } = useThree();

  useEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return;
    const transitionElement = gl.domElement.closest(
      ".brain-scene-viewport",
    );
    let previousWidth = 0;
    let previousHeight = 0;
    const synchronize = (force = false) => {
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      if (
        width <= 0 ||
        height <= 0 ||
        (!force &&
          width === previousWidth &&
          height === previousHeight &&
          gl.domElement.clientWidth === width &&
          gl.domElement.clientHeight === height)
      ) {
        return;
      }
      previousWidth = width;
      previousHeight = height;
      setSize(width, height);
      gl.setSize(width, height);
      gl.domElement.dataset.viewportSync =
        `${width}x${height}`;
    };
    synchronize();
    const observer = new ResizeObserver(() => synchronize());
    observer.observe(parent);
    observer.observe(gl.domElement);
    const styleObserver = new MutationObserver(() => {
      if (
        gl.domElement.clientWidth !== parent.clientWidth ||
        gl.domElement.clientHeight !== parent.clientHeight
      ) {
        synchronize(true);
      }
    });
    styleObserver.observe(gl.domElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
    const handleTransitionEnd = (event: Event) => {
      if (
        (event as TransitionEvent).propertyName === "transform"
      ) {
        synchronize(true);
      }
    };
    transitionElement?.addEventListener(
      "transitionend",
      handleTransitionEnd,
    );
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => synchronize(true));
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      observer.disconnect();
      styleObserver.disconnect();
      transitionElement?.removeEventListener(
        "transitionend",
        handleTransitionEnd,
      );
    };
  }, [gl, setSize]);

  return null;
}

function GalleryLighting({
  mobilePresentation,
}: {
  mobilePresentation: boolean;
}) {
  return (
    <>
      <hemisphereLight
        color="#fffaf7"
        groundColor="#aa8c8f"
        intensity={0.48}
      />
      <directionalLight
        castShadow={!mobilePresentation}
        color="#fff6f2"
        intensity={1.32}
        position={[-4.2, 6.2, 5]}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-4.8}
        shadow-camera-right={4.8}
        shadow-camera-top={4.3}
        shadow-camera-bottom={-4.3}
        shadow-camera-near={1}
        shadow-camera-far={16}
        shadow-bias={-0.00015}
        shadow-normalBias={0.015}
      />
      <directionalLight
        color="#aabfe2"
        intensity={0.34}
        position={[4.8, 2.4, -5.2]}
      />
      <Environment
        background={false}
        environmentIntensity={0.86}
        frames={1}
        resolution={mobilePresentation ? 128 : 256}
      >
        <Lightformer
          form="rect"
          color="#ffdcd0"
          intensity={3.05}
          position={[-3.8, 2.9, 5.8]}
          scale={[2.35, 0.34]}
          target={[0, 0, 0]}
        />
        <Lightformer
          form="rect"
          color="#eee6e2"
          intensity={1.4}
          position={[4.6, 0.7, 4]}
          scale={[2.2, 4.6]}
          target={[0, 0, 0]}
        />
        <Lightformer
          form="rect"
          color="#fff7f1"
          intensity={0.95}
          position={[0, 5, 0.2]}
          scale={[3.6, 0.52]}
          target={[0, 0, 0]}
        />
        <Lightformer
          form="rect"
          color="#dfd9d5"
          intensity={0.48}
          position={[-1.2, 1.4, -5.4]}
          scale={[5.4, 0.85]}
          target={[0, 0, 0]}
        />
        <Lightformer
          form="rect"
          color="#dcc7cb"
          intensity={1.1}
          position={[0, -4, 1.2]}
          scale={[4.6, 1.8]}
          target={[0, 0, 0]}
        />
      </Environment>
    </>
  );
}

function BackgroundInteractionCatcher({
  onBackgroundHover,
  onBackgroundClick,
}: Pick<
  BrainSceneProps,
  "onBackgroundHover" | "onBackgroundClick"
>) {
  const handleBackgroundPointer = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (event.pointerType !== "mouse") {
        onBackgroundHover();
        return;
      }
      event.stopPropagation();
      onBackgroundHover();
    },
    [onBackgroundHover],
  );
  const handleBackgroundClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      onBackgroundClick();
    },
    [onBackgroundClick],
  );

  return (
    <mesh
      name="brain-interaction-background"
      frustumCulled={false}
      onPointerMove={handleBackgroundPointer}
      onPointerOver={handleBackgroundPointer}
      onClick={handleBackgroundClick}
    >
      <sphereGeometry args={[24, 16, 12]} />
      <meshBasicMaterial
        side={THREE.BackSide}
        transparent
        opacity={0}
        colorWrite={false}
        depthWrite={false}
        depthTest={false}
        toneMapped={false}
      />
    </mesh>
  );
}

type InteractionProbeIntersection = {
  regionId: RegionId;
  hitProxy: boolean;
  enclosed: boolean;
  visible: boolean;
  distance: number;
};

/**
 * Review instrumentation. The only mutation is an isolated material-strength
 * switch used to capture a paired variation-zero frame without reloading.
 */
type BrainExplorerDiagnostics = {
  getRegionDiagnostics: () => unknown;
  getInteractionTargets: () => {
    coordinateSystem: {
      ndc: string;
      screen: string;
    };
    viewportCssPixels: { width: number; height: number };
    targets: NonNullable<
      ReturnType<typeof buildInteractionTargetDiagnostic>
    >[];
  };
  probeRegionAtNdc: (
    x: number,
    y: number,
  ) => {
    ndc: readonly [number, number];
    resolvedRegionId: RegionId | null;
    intersections: InteractionProbeIntersection[];
  };
  getCameraDiagnostics: () => {
    phase: CameraTransitionPhase;
    position: number[];
    target: number[];
    distance: number;
    specimen: {
      position: number[];
      rotation: number[];
      matrix: number[];
    } | null;
    savedPose: {
      camera: CameraPose | null;
      specimen: {
        position: number[];
        quaternion: number[];
        scale: number[];
        matrix: number[];
        idleElapsedSeconds: number;
      } | null;
    };
  };
  setReviewTissueVariationStrength: (strength: number) => number;
  setReviewTissueFinishEnabled: (enabled: boolean) => number;
  measureRendererFrame: () => Promise<{
    calls: number;
    triangles: number;
    points: number;
    lines: number;
    geometries: number;
    textures: number;
    pixelRatio: number;
  }>;
  getShaderDiagnostics: () => {
    renderer: {
      outputColorSpace: string;
      shadowMapEnabled: boolean;
      shadowMapType: number;
      calls: number;
      triangles: number;
      geometries: number;
      textures: number;
      materials: number;
      pixelRatio: number;
    };
    tissuePrograms: unknown[];
    tissueMaterials: unknown[];
    postprocessing: string[];
    warningIsolation: string;
  };
};

type RegionDiagnosticsWindow = Window & {
  __BRAIN_EXPLORER__?: BrainExplorerDiagnostics;
};

function collectRegionMeshes(scene: THREE.Scene) {
  const meshes: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh && object.userData.regionId) {
      meshes.push(object);
    }
  });
  return meshes;
}

function RegionDiagnostics({
  phaseRef,
  targetRef,
  specimenRef,
  specimenMotionRef,
  savedCameraPoseRef,
  mobilePresentation,
}: {
  phaseRef: MutableRefObject<CameraTransitionPhase>;
  targetRef: MutableRefObject<THREE.Vector3>;
  specimenRef: MutableRefObject<THREE.Group | null>;
  specimenMotionRef: MutableRefObject<SpecimenMotionState>;
  savedCameraPoseRef: MutableRefObject<CameraPose | null>;
  mobilePresentation: boolean;
}) {
  const { camera, gl, scene } = useThree();

  useEffect(() => {
    const probeRaycaster = new THREE.Raycaster();
    const probeNdc = new THREE.Vector2();

    const getRegionDiagnostics = () => {
      scene.updateMatrixWorld(true);
      const raycaster = new THREE.Raycaster();

      return collectRegionMeshes(scene)
        .map((mesh) => {
          const positions = mesh.geometry.getAttribute("position");
          const indices = mesh.geometry.getIndex();
          const fiberObject = mesh as THREE.Mesh & {
            __r3f?: { handlers?: { onClick?: unknown } };
          };
          let raycastHit = false;

          if (positions.count >= 3) {
            const a = new THREE.Vector3().fromBufferAttribute(
              positions,
              indices?.getX(0) ?? 0,
            );
            const b = new THREE.Vector3().fromBufferAttribute(
              positions,
              indices?.getX(1) ?? 1,
            );
            const c = new THREE.Vector3().fromBufferAttribute(
              positions,
              indices?.getX(2) ?? 2,
            );
            const centroid = a.clone().add(b).add(c).multiplyScalar(1 / 3);
            const normal = b
              .clone()
              .sub(a)
              .cross(c.clone().sub(a))
              .normalize()
              .applyNormalMatrix(
                new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld),
              );
            const worldCentroid = centroid.applyMatrix4(mesh.matrixWorld);
            const distance =
              (mesh.geometry.boundingSphere?.radius ?? 2) * 2 + 0.25;
            raycaster.set(
              worldCentroid.clone().addScaledVector(normal, distance),
              normal.clone().negate(),
            );
            raycastHit = raycaster.intersectObject(mesh, false).length > 0;
          }

          return {
            id: mesh.userData.regionId as RegionId,
            triangles: (indices?.count ?? positions.count) / 3,
            hitProxy: mesh.userData.hitProxy === true,
            hasClickHandler: Boolean(fiberObject.__r3f?.handlers?.onClick),
            raycastHit,
          };
        })
        .sort((a, b) => a.id.localeCompare(b.id));
    };

    const getInteractionTargets = () => {
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      const width = gl.domElement.clientWidth || gl.domElement.width;
      const height = gl.domElement.clientHeight || gl.domElement.height;
      const targets = collectRegionMeshes(scene)
        .map((mesh) => {
          const regionId = mesh.userData.regionId as RegionId;
          return buildInteractionTargetDiagnostic(
            mesh,
            regionId,
            camera,
            width,
            height,
          );
        })
        .filter(
          (
            target,
          ): target is NonNullable<
            ReturnType<typeof buildInteractionTargetDiagnostic>
          > => target !== null,
        )
        .sort(
          (a, b) =>
            a.regionId.localeCompare(b.regionId) ||
            Number(a.hitProxy) - Number(b.hitProxy),
        );

      return {
        coordinateSystem: {
          ndc: "x: -1 left to +1 right; y: -1 bottom to +1 top",
          screen: "CSS pixels from canvas top-left",
        },
        viewportCssPixels: { width, height },
        targets,
      };
    };

    const probeRegionAtNdc = (x: number, y: number) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new TypeError("NDC coordinates must be finite numbers");
      }

      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      const probe = raycastBrainAtNdc({
        ndc: probeNdc.set(x, y),
        camera,
        raycaster: probeRaycaster,
        meshes: collectRegionMeshes(scene),
      });
      const rayIntersections = probe.intersections;

      return {
        ndc: [x, y] as const,
        resolvedRegionId: probe.resolvedRegionId,
        intersections: rayIntersections.flatMap((intersection) => {
          const regionId = getBrainIntersectionRegionId(intersection);
          if (!regionId) return [];
          return [
            {
              regionId,
              hitProxy: intersection.object.userData.hitProxy === true,
              enclosed:
                intersection.object.userData.enclosedInternal === true,
              visible: intersection.object.visible,
              distance: Number(intersection.distance.toFixed(6)),
            },
          ];
        }),
      };
    };

    const diagnosticsWindow = window as RegionDiagnosticsWindow;
    const previousDiagnostics = diagnosticsWindow.__BRAIN_EXPLORER__;
    const diagnostics: BrainExplorerDiagnostics = {
      getRegionDiagnostics,
      getInteractionTargets,
      probeRegionAtNdc,
      getCameraDiagnostics: () => {
        const specimen = specimenRef.current;
        return {
          phase: phaseRef.current,
          position: camera.position.toArray(),
          target: targetRef.current.toArray(),
          distance: camera.position.distanceTo(targetRef.current),
          specimen: specimen
            ? {
                position: specimen.position.toArray(),
                rotation: [
                  specimen.rotation.x,
                  specimen.rotation.y,
                  specimen.rotation.z,
                ],
                matrix: specimen.matrix.toArray(),
              }
            : null,
          savedPose: {
            camera: savedCameraPoseRef.current
              ? {
                  position: [...savedCameraPoseRef.current.position],
                  target: [...savedCameraPoseRef.current.target],
                }
              : null,
            specimen: specimenMotionRef.current.savedTransform
              ? {
                  position: [
                    ...specimenMotionRef.current.savedTransform.position,
                  ],
                  quaternion: [
                    ...specimenMotionRef.current.savedTransform.quaternion,
                  ],
                  scale: [
                    ...specimenMotionRef.current.savedTransform.scale,
                  ],
                  matrix: [
                    ...specimenMotionRef.current.savedTransform.matrix,
                  ],
                  idleElapsedSeconds:
                    specimenMotionRef.current.savedTransform
                      .idleElapsedSeconds,
                }
              : null,
          },
        };
      },
      setReviewTissueVariationStrength: (strength) => {
        const nextStrength = THREE.MathUtils.clamp(strength, 0, 1);
        const updatedMaterials = new Set<THREE.Material>();
        scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((material) => {
            if (updatedMaterials.has(material)) return;
            const uniform = material.userData
              .variationStrengthUniform as
              | { value: number }
              | undefined;
            if (!uniform) return;
            uniform.value = nextStrength;
            updatedMaterials.add(material);
          });
        });
        return updatedMaterials.size;
      },
      setReviewTissueFinishEnabled: (enabled) => {
        const updatedMaterials = new Set<THREE.Material>();
        scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((material) => {
            if (
              updatedMaterials.has(material) ||
              material.userData.tissueCategory !== "cortex"
            ) {
              return;
            }
            const variation = material.userData
              .variationStrengthUniform as
              | { value: number }
              | undefined;
            const roughness = material.userData
              .roughnessVariationStrengthUniform as
              | { value: number }
              | undefined;
            const moisture = material.userData
              .moistureStrengthUniform as
              | { value: number }
              | undefined;
            if (!variation || !roughness || !moisture) return;
            variation.value = enabled ? 0.16 : 0;
            roughness.value = enabled ? 0.16 : 0;
            moisture.value = enabled ? 1 : 0;
            updatedMaterials.add(material);
          });
        });
        return updatedMaterials.size;
      },
      measureRendererFrame: () =>
        new Promise((resolve) => {
          const previousAutoReset = gl.info.autoReset;
          gl.info.autoReset = false;
          gl.info.reset();
          requestAnimationFrame(() => {
            const sample = {
              calls: gl.info.render.calls,
              triangles: gl.info.render.triangles,
              points: gl.info.render.points,
              lines: gl.info.render.lines,
              geometries: gl.info.memory.geometries,
              textures: gl.info.memory.textures,
              pixelRatio: gl.getPixelRatio(),
            };
            gl.info.autoReset = previousAutoReset;
            gl.info.reset();
            resolve(sample);
          });
        }),
      getShaderDiagnostics: () => {
        const programs = new Map<string, unknown>();
        const tissueMaterials = new Map<string, unknown>();
        const tissueGeometries = new Map<string, unknown>();
        const sceneMaterials = new Set<string>();
        let externalTissueMeshCount = 0;
        let externalShadowCastingCount = 0;
        let externalShadowReceivingCount = 0;
        scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const tissueVariation =
            object.geometry.getAttribute("tissueVariation");
          if (tissueVariation) {
            tissueGeometries.set(object.geometry.uuid, {
              regionId: object.userData.regionId ?? null,
              vertexCount: tissueVariation.count,
              variation:
                object.geometry.userData.tissueVariation ?? null,
              itemSize: tissueVariation.itemSize,
              hasVertexColor: Boolean(
                object.geometry.getAttribute("color"),
              ),
            });
          }
          if (
            typeof object.userData.regionId === "string" &&
            object.userData.hitProxy !== true &&
            object.userData.enclosedInternal !== true
          ) {
            externalTissueMeshCount += 1;
            if (object.castShadow) externalShadowCastingCount += 1;
            if (object.receiveShadow) externalShadowReceivingCount += 1;
          }
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((material) => {
            sceneMaterials.add(material.uuid);
            const isolation = material.userData.shaderIsolation;
            if (
              isolation &&
              typeof isolation.programKey === "string"
            ) {
              programs.set(isolation.programKey, {
                materialName: material.name,
                ...isolation,
              });
            }
            if (
              material instanceof THREE.MeshPhysicalMaterial &&
              typeof material.userData.regionId === "string" &&
              typeof material.userData.idleTissueColor === "string"
            ) {
              tissueMaterials.set(material.name, {
                regionId: material.userData.regionId,
                tissueCategory: material.userData.tissueCategory,
                idleTissueColor: material.userData.idleTissueColor,
                semanticAccent: material.userData.semanticAccent,
                currentColor: `#${material.color.getHexString(THREE.SRGBColorSpace)}`,
                emissiveIntensity: material.emissiveIntensity,
                metalness: material.metalness,
                roughness: material.roughness,
                clearcoat: material.clearcoat,
                clearcoatRoughness: material.clearcoatRoughness,
                specularIntensity: material.specularIntensity,
                ior: material.ior,
                envMapIntensity: material.envMapIntensity,
                transparent: material.transparent,
                opacity: material.opacity,
                depthWrite: material.depthWrite,
                depthTest: material.depthTest,
                side: material.side,
                vertexColors: material.vertexColors,
                variationStrength:
                  material.userData.variationStrengthUniform?.value ??
                  null,
                roughnessVariationStrength:
                  material.userData.roughnessVariationStrengthUniform
                    ?.value ?? null,
                regionWashStrength:
                  material.userData.regionWashStrengthUniform?.value ??
                  null,
                compiledTissueVariation:
                  material.userData.compiledTissueVariation ?? null,
              });
            }
          });
        });
        const context = gl.getContext();
        const rendererPrograms =
          (
            gl.info as unknown as {
              programs?: Array<{
                cacheKey?: string;
                program?: WebGLProgram;
              }>;
            }
          ).programs ?? [];
        const compiledTissuePrograms = rendererPrograms.flatMap(
          (programRecord) => {
            if (!programRecord.program) return [];
            const shaderSources = (
              context.getAttachedShaders(programRecord.program) ?? []
            ).map((shader) => context.getShaderSource(shader) ?? "");
            const vertexSource =
              shaderSources.find((source) =>
                source.includes("attribute vec3 tissueVariation"),
              ) ?? "";
            const fragmentSource =
              shaderSources.find((source) =>
                source.includes("brainTissueHue"),
              ) ?? "";
            if (!vertexSource || !fragmentSource) return [];
            return [
              {
                cacheKey: programRecord.cacheKey ?? null,
                finalVertexAttribute: vertexSource.includes(
                  "attribute vec3 tissueVariation",
                ),
                finalVec3Varying:
                  vertexSource.includes(
                    "brainTissueVariation = tissueVariation",
                  ) &&
                  fragmentSource.includes(
                    "varying vec3 brainTissueVariation",
                  ),
                finalDiffuseVariation: fragmentSource.includes(
                  "diffuseColor.rgb *= brainTissueLuma * brainTissueHue",
                ),
                finalRoughnessVariation: fragmentSource.includes(
                  "roughnessFactor + brainTissueVariation.y",
                ),
                finalEmissiveRetention: fragmentSource.includes(
                  "totalEmissiveRadiance *= mix(1.0, brainTissueLuma, 0.25)",
                ),
                finalSemanticWash: fragmentSource.includes(
                  "uniform float brainRegionWashStrength",
                ),
                finalDiffuseWrap: false,
                finalReviewUniform: fragmentSource.includes(
                  "uniform float brainTissueVariationStrength",
                ),
                opaqueVariant: fragmentSource.includes(
                  "#define OPAQUE",
                ),
              },
            ];
          },
        );
        return {
          renderer: {
            outputColorSpace: gl.outputColorSpace,
            toneMapping: gl.toneMapping,
            toneMappingName: "NeutralToneMapping",
            toneMappingExposure: gl.toneMappingExposure,
            shadowMapEnabled: gl.shadowMap.enabled,
            shadowMapType: gl.shadowMap.type,
            calls: gl.info.render.calls,
            triangles: gl.info.render.triangles,
            geometries: gl.info.memory.geometries,
            textures: gl.info.memory.textures,
            materials: sceneMaterials.size,
            pixelRatio: gl.getPixelRatio(),
          },
          finalToneMapping: {
            path: mobilePresentation
              ? "renderer-neutral"
              : "composer-neutral-final",
            mode: mobilePresentation
              ? THREE.NeutralToneMapping
              : ToneMappingMode.NEUTRAL,
            exposure: mobilePresentation ? 1.12 : 1,
            outputColorSpace: THREE.SRGBColorSpace,
          },
          lighting: {
            environmentBackground: false,
            environmentFrames: 1,
            environmentResolution: mobilePresentation ? 128 : 256,
            lightformerCount: 5,
            directionalLightCount: 2,
            hemisphereLightCount: 1,
            externalTissueMeshCount,
            externalShadowCastingCount,
            externalShadowReceivingCount,
          },
          tissuePrograms: [...programs.values()],
          tissueMaterials: [...tissueMaterials.values()].sort((a, b) =>
            String(
              (a as { regionId?: unknown }).regionId,
            ).localeCompare(
              String((b as { regionId?: unknown }).regionId),
            ),
          ),
          tissueGeometries: [...tissueGeometries.values()],
          compiledTissuePrograms,
          postprocessing: mobilePresentation
            ? []
            : [
                "N8AO:half-resolution-rest-only",
                "Bloom",
                "Vignette",
                "ToneMapping:NEUTRAL",
              ],
          warningIsolation:
            "Compare tissue program keys with postprocessing and renderer colorspace/shadow variants during a debug capture.",
        };
      },
    };
    diagnosticsWindow.__BRAIN_EXPLORER__ = diagnostics;

    return () => {
      if (diagnosticsWindow.__BRAIN_EXPLORER__ !== diagnostics) return;
      if (previousDiagnostics) {
        diagnosticsWindow.__BRAIN_EXPLORER__ = previousDiagnostics;
      } else {
        delete diagnosticsWindow.__BRAIN_EXPLORER__;
      }
    };
  }, [
    camera,
    gl,
    phaseRef,
    savedCameraPoseRef,
    scene,
    specimenMotionRef,
    specimenRef,
    targetRef,
    mobilePresentation,
  ]);

  return null;
}

type RegionLeaderProjectionEntry = {
  mesh: THREE.Mesh;
  member: RegionLeaderSilhouetteMember;
};

function getLeaderMaterialState(mesh: THREE.Mesh) {
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];
  const renderMaterials = materials.filter((material) => material.visible);
  return {
    opacity: renderMaterials.length
      ? Math.max(...renderMaterials.map((material) => material.opacity))
      : 0,
    transparent:
      renderMaterials.length > 0 &&
      renderMaterials.every((material) => material.transparent),
    depthWrite:
      renderMaterials.length > 0 &&
      renderMaterials.some((material) => material.depthWrite),
  };
}

function getLeaderAttributeVersion(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null,
) {
  if (!attribute) return 0;
  const versioned = attribute as unknown as {
    version?: number;
    data?: { version?: number };
  };
  return versioned.version ?? versioned.data?.version ?? 0;
}

function getRegionLeaderProjectionFingerprint(
  entries: readonly RegionLeaderProjectionEntry[],
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number,
  dpr: number,
) {
  camera.updateMatrixWorld(true);
  return [
    `${viewportWidth.toFixed(2)}x${viewportHeight.toFixed(2)}@${dpr.toFixed(2)}`,
    camera.projectionMatrix.elements.map((value) => value.toFixed(5)).join(","),
    camera.matrixWorldInverse.elements
      .map((value) => value.toFixed(5))
      .join(","),
    ...entries
      .map(({ mesh, member }) => {
        mesh.updateWorldMatrix(true, false);
        const material = getLeaderMaterialState(mesh);
        return [
          member.stableId,
          member.role,
          mesh.geometry.uuid,
          getLeaderAttributeVersion(
            mesh.geometry.getAttribute("position"),
          ),
          getLeaderAttributeVersion(mesh.geometry.index),
          isVisibleSurfaceObject(mesh) ? 1 : 0,
          material.opacity.toFixed(3),
          material.transparent ? 1 : 0,
          material.depthWrite ? 1 : 0,
          mesh.layers.mask,
          mesh.userData.portalComponent !== undefined ? 1 : 0,
          mesh.userData.hitProxy === true ? 1 : 0,
          mesh.userData.enclosedInternal === true ? 1 : 0,
          mesh.userData.extractionGroupRegionId !== undefined ? 1 : 0,
          mesh.userData.helper === true ? 1 : 0,
          mesh.userData.diagnostic === true ? 1 : 0,
          mesh.matrixWorld.elements
            .map((value) => value.toFixed(5))
            .join(","),
        ].join(":");
      })
      .sort(),
  ].join("|");
}

function projectLeaderMeshSilhouette(
  entries: readonly RegionLeaderProjectionEntry[],
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number,
  worldPoint: THREE.Vector3,
  projectedPoint: THREE.Vector3,
  source: RegionLeaderSilhouette["source"],
  baseFingerprint: string,
  requiredRole: RegionLeaderSilhouetteMember["role"],
  projectionIndicesByMeshUuid: ReadonlyMap<string, Uint32Array>,
  includeHiddenAtlasSources = false,
): RegionLeaderSilhouette | null {
  const bounds = {
    left: Number.POSITIVE_INFINITY,
    top: Number.POSITIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY,
    bottom: Number.NEGATIVE_INFINITY,
  };
  const boundaryBuckets = new Map<
    number,
    { left: { x: number; y: number }; right: { x: number; y: number } }
  >();
  let pointCount = 0;
  const contributors: NonNullable<RegionLeaderSilhouette["contributors"]> = [];
  const projectionView = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const frustum = new THREE.Frustum().setFromProjectionMatrix(projectionView);
  for (const { mesh, member } of entries) {
    const visible =
      includeHiddenAtlasSources || isVisibleSurfaceObject(mesh);
    const material = getLeaderMaterialState(mesh);
    mesh.updateWorldMatrix(true, false);
    const frustumValid =
      camera.layers.test(mesh.layers) && frustum.intersectsObject(mesh);
    const portal = mesh.userData.portalComponent !== undefined;
    const proxy = mesh.userData.hitProxy === true;
    const extraction =
      mesh.userData.enclosedInternal === true ||
      mesh.userData.extractionGroupRegionId !== undefined;
    const helper = mesh.userData.helper === true;
    const diagnostic = mesh.userData.diagnostic === true;
    const renderContributing =
      source === "overall-visible-specimen"
        ? isRegionLeaderExternalSilhouetteMember({
            role: member.role,
            visible,
            frustumValid,
            materialOpacity: material.opacity,
            materialDepthWrite: material.depthWrite,
            portal,
            proxy,
            extraction,
            helper,
            diagnostic,
          })
        : visible &&
          frustumValid &&
          member.role === requiredRole &&
          material.opacity > 0.01 &&
          material.depthWrite;
    if (!renderContributing) continue;
    const positions = mesh.geometry.getAttribute("position");
    if (!positions) continue;
    const projectionIndices = projectionIndicesByMeshUuid.get(mesh.uuid);
    if (!projectionIndices?.length) continue;
    const memberPoints: { x: number; y: number }[] = [];
    let cardFacingScreenX = Number.NEGATIVE_INFINITY;
    const cardFacingWorldPoint = new THREE.Vector3();
    for (const index of projectionIndices) {
      worldPoint
        .fromBufferAttribute(positions, index)
        .applyMatrix4(mesh.matrixWorld);
      projectedPoint.copy(worldPoint).project(camera);
      if (
        ![projectedPoint.x, projectedPoint.y, projectedPoint.z].every(
          Number.isFinite,
        ) ||
        projectedPoint.z < -1 ||
        projectedPoint.z > 1
      ) {
        continue;
      }
      const x = ((projectedPoint.x + 1) * viewportWidth) / 2;
      const y = ((1 - projectedPoint.y) * viewportHeight) / 2;
      memberPoints.push({ x, y });
      if (x > cardFacingScreenX) {
        cardFacingScreenX = x;
        cardFacingWorldPoint.copy(worldPoint);
      }
      bounds.left = Math.min(bounds.left, x);
      bounds.top = Math.min(bounds.top, y);
      bounds.right = Math.max(bounds.right, x);
      bounds.bottom = Math.max(bounds.bottom, y);
      const bucketKey = Math.round(y / 2);
      const bucket = boundaryBuckets.get(bucketKey);
      if (bucket) {
        if (x < bucket.left.x) bucket.left = { x, y };
        if (x > bucket.right.x) bucket.right = { x, y };
      } else {
        boundaryBuckets.set(bucketKey, {
          left: { x, y },
          right: { x, y },
        });
      }
      pointCount += 1;
    }
    const memberHull = createRegionScreenHull(memberPoints);
    if (memberHull.length >= 3) {
      contributors.push({
        stableId: member.stableId,
        meshUuid: member.meshUuid,
        semanticName: mesh.name || member.regionId,
        regionId: member.regionId,
        role: member.role,
        sourceKind: member.sourceKind,
        hull: memberHull,
        cardFacingWorldPoint: [
          cardFacingWorldPoint.x,
          cardFacingWorldPoint.y,
          cardFacingWorldPoint.z,
        ],
        cardFacingScreenX,
        visible,
        frustumValid,
        materialOpacity: material.opacity,
        materialTransparent: material.transparent,
        materialDepthWrite: material.depthWrite,
        portal,
        proxy,
        extraction,
        helper,
      });
    }
  }
  if (pointCount === 0) return null;
  const hull = createRegionScreenHull(
    [...boundaryBuckets.values()].flatMap((bucket) => [
      bucket.left,
      bucket.right,
    ]),
  );
  return hull.length >= 3
    ? { bounds, hull, source, baseFingerprint, contributors }
    : null;
}

function projectLeaderComponentHulls(
  meshes: readonly THREE.Mesh[],
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number,
  worldPoint: THREE.Vector3,
  projectedPoint: THREE.Vector3,
  projectionIndicesByMeshUuid: ReadonlyMap<string, Uint32Array>,
) {
  const pointsByComponent = new Map<
    string,
    { x: number; y: number }[]
  >();
  for (const mesh of meshes) {
    if (!isVisibleSurfaceObject(mesh)) continue;
    const positions = mesh.geometry.getAttribute("position");
    if (!positions) continue;
    const projectionIndices = projectionIndicesByMeshUuid.get(mesh.uuid);
    if (!projectionIndices?.length) continue;
    mesh.updateWorldMatrix(true, false);
    for (const index of projectionIndices) {
      worldPoint
        .fromBufferAttribute(positions, index)
        .applyMatrix4(mesh.matrixWorld);
      projectedPoint.copy(worldPoint).project(camera);
      if (
        ![projectedPoint.x, projectedPoint.y, projectedPoint.z].every(
          Number.isFinite,
        ) ||
        projectedPoint.z < -1 ||
        projectedPoint.z > 1
      ) {
        continue;
      }
      const authoredSide =
        typeof mesh.userData.side === "string"
          ? mesh.userData.side
          : null;
      const componentSide =
        authoredSide ??
        (mesh.userData.enclosedInternal === true
          ? positions.getX(index) < 0
            ? "left"
            : "right"
          : null);
      const componentId = componentSide
        ? `${mesh.uuid}:${componentSide}`
        : mesh.uuid;
      const points = pointsByComponent.get(componentId) ?? [];
      points.push({
        x: ((projectedPoint.x + 1) * viewportWidth) / 2,
        y: ((1 - projectedPoint.y) * viewportHeight) / 2,
      });
      pointsByComponent.set(componentId, points);
    }
  }
  return new Map(
    [...pointsByComponent].flatMap(([componentId, points]) => {
      const hull = createRegionScreenHull(points);
      return hull.length >= 3 ? [[componentId, hull] as const] : [];
    }),
  );
}

function createLeaderProjectionIndices(
  pointCount: number,
  maximumSamples = 512,
) {
  const sampleCount = Math.min(pointCount, maximumSamples);
  const indices = new Uint32Array(sampleCount);
  if (sampleCount === 0) return indices;
  if (sampleCount === 1) {
    indices[0] = 0;
    return indices;
  }
  for (let sample = 0; sample < sampleCount; sample += 1) {
    indices[sample] = Math.round(
      (sample * (pointCount - 1)) / (sampleCount - 1),
    );
  }
  return indices;
}

function createCardFacingSelectedSurfaceProbePoints(
  hulls: readonly (readonly { x: number; y: number }[])[],
  cardPoint: { x: number; y: number },
  maximumPoints = 8,
) {
  return hulls
    .flatMap((hull) => {
      if (hull.length < 3) return [];
      const center = hull.reduce(
        (total, point) => ({
          x: total.x + point.x / hull.length,
          y: total.y + point.y / hull.length,
        }),
        { x: 0, y: 0 },
      );
      return hull.flatMap((point, index) => {
        const next = hull[(index + 1) % hull.length];
        return [point, {
          x: (point.x + next.x) / 2,
          y: (point.y + next.y) / 2,
        }].map((edgePoint) => {
          const insetDistance = Math.max(
            Number.EPSILON,
            Math.hypot(center.x - edgePoint.x, center.y - edgePoint.y),
          );
          return {
            x:
              edgePoint.x +
              ((center.x - edgePoint.x) / insetDistance) * 2,
            y:
              edgePoint.y +
              ((center.y - edgePoint.y) / insetDistance) * 2,
          };
        });
      });
    })
    .sort(
      (first, second) =>
        Math.hypot(first.x - cardPoint.x, first.y - cardPoint.y) -
          Math.hypot(second.x - cardPoint.x, second.y - cardPoint.y) ||
        second.x - first.x,
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

function createTransientRegionLeaderSilhouette({
  worldPoint,
  camera,
  viewportWidth,
  viewportHeight,
  detachedInternal,
}: {
  worldPoint: THREE.Vector3;
  camera: THREE.Camera;
  viewportWidth: number;
  viewportHeight: number;
  detachedInternal: boolean;
}): RegionLeaderSilhouette | null {
  const viewPoint = worldPoint
    .clone()
    .applyMatrix4(camera.matrixWorldInverse);
  const projected = worldPoint.clone().project(camera);
  if (
    !Number.isFinite(projected.x) ||
    !Number.isFinite(projected.y) ||
    projected.z < -1 ||
    projected.z > 1
  ) {
    return null;
  }
  const center = projectLeaderNdcToScreen(
    projected,
    -viewPoint.z,
    viewportWidth,
    viewportHeight,
  );
  if (!center) return null;
  const radiusX = detachedInternal ? 28 : 36;
  const radiusY = detachedInternal ? 24 : 31;
  const hull = createRegionScreenHull(
    Array.from({ length: 8 }, (_, index) => {
      const angle = (index / 8) * Math.PI * 2;
      return {
        x: center.x + Math.cos(angle) * radiusX,
        y: center.y + Math.sin(angle) * radiusY,
      };
    }),
  );
  return {
    hull,
    bounds: {
      left: center.x - radiusX,
      top: center.y - radiusY,
      right: center.x + radiusX,
      bottom: center.y + radiusY,
    },
    source: detachedInternal
      ? "detached-selected-cluster"
      : "overall-visible-specimen",
    baseFingerprint: [
      "transient-fallback",
      center.x.toFixed(1),
      center.y.toFixed(1),
      detachedInternal ? "internal" : "external",
    ].join(":"),
  };
}

type ResolvedLeaderSurface = {
  mesh: THREE.Mesh;
  localPoint: THREE.Vector3;
  componentId: string;
  screenPoint: { x: number; y: number };
  clearancePx: number;
  anchorSource: "selected-contour" | "selected-support";
  selectedRegion: RegionId;
  hullEdgeRegion: RegionId | null;
  markerToFinalExitPx: number;
  residualOccludedGapPx: number;
  resolver: "frontmost-visible-selected";
  groupPoint?: { x: number; y: number };
};

function RegionLeaderProjector({
  leaderRegionId,
  selectionFocusIntent,
  regionLeaderRef,
  supportRegistryRef,
  phaseRef,
  baseLeftInsetPx,
  appliedLeftInsetPx,
  baseRightInsetPx,
  appliedRightInsetPx,
  convergenceToken,
}: {
  leaderRegionId: RegionId | null;
  selectionFocusIntent: BrainSelectionFocusIntent | null;
  regionLeaderRef: MutableRefObject<RegionInfoLeaderHandle | null>;
  supportRegistryRef: MutableRefObject<RegionLeaderSupportRegistry | null>;
  phaseRef: MutableRefObject<CameraTransitionPhase>;
  baseLeftInsetPx: number;
  appliedLeftInsetPx: number;
  baseRightInsetPx: number;
  appliedRightInsetPx: number;
  convergenceToken: string;
}) {
  const { camera, scene, size } = useThree();
  const resolvedSurfaceRef = useRef<ResolvedLeaderSurface[]>([]);
  const resolvedSilhouetteRef = useRef<RegionLeaderSilhouette | null>(null);
  const resolvedSpecimenSilhouetteRef =
    useRef<RegionLeaderSilhouette | null>(null);
  const resolvedSelectedSilhouetteRef =
    useRef<RegionLeaderSilhouette | null>(null);
  const resolvedComponentHullsRef = useRef<
    Map<string, { x: number; y: number }[]>
  >(new Map());
  const verifiedCandidateCountRef = useRef(0);
  const supportSampleCountRef = useRef(0);
  const registryCacheRef = useRef<{
    registry: RegionLeaderSupportRegistry;
    meshesByUuid: Map<string, THREE.Mesh>;
    foregroundMeshes: THREE.Mesh[];
    externalSilhouetteEntries: RegionLeaderProjectionEntry[];
    silhouetteStateEntries: RegionLeaderProjectionEntry[];
    projectionIndicesByMeshUuid: Map<string, Uint32Array>;
  } | null>(null);
  const lastResolveTimeRef = useRef(Number.NEGATIVE_INFINITY);
  const viewportKeyRef = useRef("");
  const lastCameraMatrixRef = useRef<number[] | null>(null);
  const lastObservedCameraMatrixRef = useRef<number[] | null>(null);
  const lastCameraMotionTimeRef = useRef(Number.NEGATIVE_INFINITY);
  const lastWinnerMatrixRef = useRef<number[] | null>(null);
  const lastSilhouetteFingerprintRef = useRef("");
  const dirtyTriggerRef = useRef("selection");
  const probeBatchIndexRef = useRef(0);
  const accumulatedProbeHitsRef = useRef<VisibleSurfaceProbeHit[]>([]);
  const leaderUpdateThrottleRef = useRef({ key: "", samples: 0 });
  const projectionRetryRef = useRef<{
    regionId: RegionId | null;
    attempts: number;
  }>({ regionId: null, attempts: 0 });
  const transientSurfaceFallbackRef = useRef(false);
  const lastTransientSurfaceRetryRef = useRef(
    Number.NEGATIVE_INFINITY,
  );
  const scratch = useMemo(
    () => ({
      worldPoint: new THREE.Vector3(),
      projectedPoint: new THREE.Vector3(),
      viewPoint: new THREE.Vector3(),
      localPoint: new THREE.Vector3(),
      ndc: new THREE.Vector2(),
      raycaster: new THREE.Raycaster(),
      boundsWorldPoint: new THREE.Vector3(),
      boundsProjectedPoint: new THREE.Vector3(),
    }),
    [],
  );

  useEffect(() => {
    resolvedSurfaceRef.current = [];
    resolvedSilhouetteRef.current = null;
    resolvedSpecimenSilhouetteRef.current = null;
    resolvedSelectedSilhouetteRef.current = null;
    resolvedComponentHullsRef.current = new Map();
    lastResolveTimeRef.current = Number.NEGATIVE_INFINITY;
    lastCameraMatrixRef.current = null;
    lastObservedCameraMatrixRef.current = null;
    lastCameraMotionTimeRef.current = Number.NEGATIVE_INFINITY;
    lastWinnerMatrixRef.current = null;
    lastSilhouetteFingerprintRef.current = "";
    dirtyTriggerRef.current = "selection";
    probeBatchIndexRef.current = 0;
    accumulatedProbeHitsRef.current = [];
    leaderUpdateThrottleRef.current = { key: "", samples: 0 };
    projectionRetryRef.current = {
      regionId: leaderRegionId,
      attempts: 0,
    };
    transientSurfaceFallbackRef.current = false;
    lastTransientSurfaceRetryRef.current =
      Number.NEGATIVE_INFINITY;
    if (!leaderRegionId) regionLeaderRef.current?.hide("no-selection");
  }, [leaderRegionId, regionLeaderRef]);

  useFrame((state) => {
    if (!leaderRegionId) {
      regionLeaderRef.current?.hide("no-selection");
      return;
    }
    const registry = supportRegistryRef.current;
    if (!registry) {
      regionLeaderRef.current?.hide("support-registry-unavailable");
      return;
    }
    const dpr = state.gl.getPixelRatio();
    const viewportKey = `${size.width}x${size.height}@${dpr}`;
    if (viewportKeyRef.current !== viewportKey) {
      viewportKeyRef.current = viewportKey;
      lastResolveTimeRef.current = Number.NEGATIVE_INFINITY;
      dirtyTriggerRef.current = "resize";
      lastSilhouetteFingerprintRef.current = "";
      regionLeaderRef.current?.invalidateLayout("resize");
    }
    if (
      camera instanceof THREE.PerspectiveCamera &&
      Math.abs(camera.aspect - size.width / Math.max(size.height, 1)) > 0.0001
    ) {
      return;
    }
    const elapsedMilliseconds = state.clock.elapsedTime * 1000;
    const cameraElements = camera.matrixWorld.elements;
    const previousObservedCameraMatrix =
      lastObservedCameraMatrixRef.current;
    const observedCameraDirty =
      !previousObservedCameraMatrix ||
      cameraElements.some(
        (value, index) =>
          Math.abs(value - previousObservedCameraMatrix[index]) > 0.0001,
      );
    if (observedCameraDirty) {
      lastObservedCameraMatrixRef.current = [...cameraElements];
      lastCameraMotionTimeRef.current = elapsedMilliseconds;
    }
    let cache = registryCacheRef.current;
    if (!cache || cache.registry !== registry) {
      const meshesByUuid = new Map<string, THREE.Mesh>();
      for (const uuid of registry.foregroundMeshUuids) {
        const object = scene.getObjectByProperty("uuid", uuid);
        if (object instanceof THREE.Mesh) meshesByUuid.set(uuid, object);
      }
      cache = {
        registry,
        meshesByUuid,
        foregroundMeshes: [...meshesByUuid.values()],
        projectionIndicesByMeshUuid: new Map(
          [...meshesByUuid.values()].map((mesh) => [
            mesh.uuid,
            createLeaderProjectionIndices(
              mesh.geometry.getAttribute("position")?.count ?? 0,
            ),
          ]),
        ),
        externalSilhouetteEntries:
          registry.externalSilhouetteMembers.flatMap((member) => {
            const mesh = meshesByUuid.get(member.meshUuid);
            return mesh ? [{ mesh, member }] : [];
          }),
        silhouetteStateEntries: [...meshesByUuid.values()].flatMap(
          (mesh) => {
            const stableId = mesh.userData.regionLeaderStableId;
            const regionId = mesh.userData.regionId;
            const role = mesh.userData.regionLeaderSilhouetteRole;
            return typeof stableId === "string" &&
              typeof regionId === "string" &&
              (role === REGION_LEADER_SILHOUETTE_ROLES.external ||
                role === REGION_LEADER_SILHOUETTE_ROLES.detached)
              ? [{
                  mesh,
                  member: {
                    stableId,
                    meshUuid: mesh.uuid,
                    regionId: regionId as RegionId,
                    role,
                    sourceKind: "atlas-source",
                  },
                }]
              : [];
          },
        ),
      };
      registryCacheRef.current = cache;
      lastResolveTimeRef.current = Number.NEGATIVE_INFINITY;
      dirtyTriggerRef.current = "registry-rebuild";
    }

    const cameraFocused = phaseRef.current === "focused";
    const cameraSettledForLeader =
      cameraFocused ||
      (!observedCameraDirty &&
        elapsedMilliseconds - lastCameraMotionTimeRef.current >= 140);
    const initialSelectionResolve =
      !cameraSettledForLeader &&
      dirtyTriggerRef.current === "selection" &&
      resolvedSurfaceRef.current.length === 0;
    if (
      !cameraSettledForLeader &&
      !initialSelectionResolve &&
      !resolvedSurfaceRef.current.length
    ) {
      return;
    }

    const selectedMeshUuids =
      registry.meshUuidsByRegion.get(leaderRegionId) ?? [];
    const selectedMeshes = selectedMeshUuids.flatMap((uuid) => {
      const mesh = cache.meshesByUuid.get(uuid);
      return mesh ? [mesh] : [];
    });
    const selectedSilhouetteEntries = selectedMeshes.flatMap((mesh) => {
      const role = mesh.userData.regionLeaderSilhouetteRole;
      const stableId = mesh.userData.regionLeaderStableId;
      return (
        (role === REGION_LEADER_SILHOUETTE_ROLES.external ||
          role === REGION_LEADER_SILHOUETTE_ROLES.detached) &&
        typeof stableId === "string"
      )
        ? [{
            mesh,
            member: {
              stableId,
              meshUuid: mesh.uuid,
              regionId: leaderRegionId,
              role,
              sourceKind: "atlas-source" as const,
            },
          }]
        : [];
    });
    const specimenFingerprint = getRegionLeaderProjectionFingerprint(
      cache.externalSilhouetteEntries,
      camera,
      size.width,
      size.height,
      dpr,
    );
    const selectedFingerprint = getRegionLeaderProjectionFingerprint(
      selectedSilhouetteEntries,
      camera,
      size.width,
      size.height,
      dpr,
    );
    const membershipFingerprint =
      getRegionLeaderProjectionFingerprint(
        cache.silhouetteStateEntries,
        camera,
        size.width,
        size.height,
        dpr,
      );
    const inSituInternal = ENCLOSED_REGION_IDS.has(leaderRegionId);
    const activeSilhouetteFingerprint =
      `${specimenFingerprint}|membership:${membershipFingerprint}`;
    const silhouetteFingerprintDirty =
      (cameraSettledForLeader || initialSelectionResolve) &&
      activeSilhouetteFingerprint !== lastSilhouetteFingerprintRef.current;
    if (silhouetteFingerprintDirty) {
      regionLeaderRef.current?.invalidateLayout("silhouette-input");
    }
    if (
      silhouetteFingerprintDirty &&
      dirtyTriggerRef.current === "settled"
    ) {
      dirtyTriggerRef.current = "silhouette-input";
    }

    const previousCameraMatrix = lastCameraMatrixRef.current;
    const cameraDirty =
      !previousCameraMatrix ||
      cameraElements.some(
        (value, index) =>
          Math.abs(value - previousCameraMatrix[index]) > 0.0001,
      );
    if (
      cameraSettledForLeader &&
      cameraDirty &&
      dirtyTriggerRef.current === "settled"
    ) {
      dirtyTriggerRef.current = "camera";
    }
    const currentWinner = resolvedSurfaceRef.current[0] ?? null;
    currentWinner?.mesh.updateWorldMatrix(true, false);
    const winnerTransformDirty =
      currentWinner !== null &&
      (lastWinnerMatrixRef.current === null ||
        currentWinner.mesh.matrixWorld.elements.some(
          (value, index) =>
            Math.abs(
              value - (lastWinnerMatrixRef.current?.[index] ?? value),
            ) > 0.0001,
        ));
    if (
      cameraSettledForLeader &&
      winnerTransformDirty &&
      dirtyTriggerRef.current === "settled"
    ) {
      dirtyTriggerRef.current = "surface-transform";
    }
    if (
      cameraSettledForLeader &&
      probeBatchIndexRef.current > 0 &&
      (cameraDirty || winnerTransformDirty || silhouetteFingerprintDirty)
    ) {
      probeBatchIndexRef.current = 0;
      accumulatedProbeHitsRef.current = [];
      resolvedSelectedSilhouetteRef.current = null;
      resolvedComponentHullsRef.current = new Map();
    }
    const probeBatchIncomplete =
      probeBatchIndexRef.current * 12 < 49;
    const transientSurfaceRetryDue =
      cameraSettledForLeader &&
      !inSituInternal &&
      transientSurfaceFallbackRef.current &&
      !probeBatchIncomplete &&
      elapsedMilliseconds -
        lastTransientSurfaceRetryRef.current >=
        500;
    if (
      (cameraSettledForLeader || initialSelectionResolve) &&
      (resolvedSurfaceRef.current.length === 0 ||
        (cameraSettledForLeader && cameraDirty) ||
        (cameraSettledForLeader && winnerTransformDirty) ||
        silhouetteFingerprintDirty ||
        (cameraSettledForLeader &&
          !inSituInternal &&
          (probeBatchIncomplete || transientSurfaceRetryDue))) &&
      elapsedMilliseconds - lastResolveTimeRef.current >=
      REGION_INFO_LEADER.visibilityResolveIntervalMs
    ) {
      lastResolveTimeRef.current = elapsedMilliseconds;
      if (transientSurfaceRetryDue) {
        probeBatchIndexRef.current = 0;
        accumulatedProbeHitsRef.current = [];
        lastTransientSurfaceRetryRef.current =
          elapsedMilliseconds;
      }
      const leaderResolveStartedAt = performance.now();
      const foregroundMeshes = cache.foregroundMeshes.filter(
        isVisibleSurfaceObject,
      );
      const supportSamples =
        registry.samplesByRegion.get(leaderRegionId) ?? [];
      const fallbackSamples = supportSamples.flatMap((sample) => {
        const mesh = cache.meshesByUuid.get(sample.meshUuid);
        return mesh
          ? [{ mesh, localPoint: sample.localPoint }]
          : [];
      });
      const supportRegistrationPending =
        shouldRetryRegionLeaderSupportRegistration({
          registeredRegionCount: registry.registeredRegionCount,
          selectedMeshUuidCount: selectedMeshUuids.length,
          resolvedMeshCount: selectedMeshes.length,
          supportSampleCount: supportSamples.length,
        });
      if (supportRegistrationPending) {
        resolvedSurfaceRef.current = [];
        resolvedSilhouetteRef.current = null;
        regionLeaderRef.current?.reportDiagnostics({
          regionId: leaderRegionId,
          dirtyTrigger: dirtyTriggerRef.current,
          registeredRegionCount: registry.registeredRegionCount,
          registeredMeshCount: selectedMeshes.length,
          supportSampleCount: supportSamples.length,
          directionalProbeCount: 0,
          directionalHitCount: 0,
          supportGridCount: 0,
          probeQueues: createEmptyRegionLeaderProbeQueueCounts(),
          budgetStopReason: "support-pending",
          everyAvailableReservedQueueRan: false,
          supportRegistrationPending: true,
          raysTested: 0,
          visibleHitCount: 0,
          rejectedResolutionCount: 0,
          rejectedProxyCount: 0,
          rejectedInvisibleCount: 0,
          scanMilliseconds: 0,
          markerComponents: [],
          markerMeshUuids: [],
          markerLocalPoints: [],
          markerWorldPoints: [],
          markerScreenPoints: [],
          markerClearancesPx: [],
          rawMarkerToSilhouetteDistancePx: null,
        });
        regionLeaderRef.current?.hide("support-registration-pending");
        dirtyTriggerRef.current = "support-pending";
        return;
      }
      const projectionDirty =
        !resolvedSpecimenSilhouetteRef.current ||
        !resolvedSelectedSilhouetteRef.current ||
        projectionRetryRef.current.attempts > 0 ||
        (cameraSettledForLeader && cameraDirty) ||
        (cameraSettledForLeader && winnerTransformDirty) ||
        silhouetteFingerprintDirty;
      let specimenSilhouette = resolvedSpecimenSilhouetteRef.current;
      let selectedSilhouette = resolvedSelectedSilhouetteRef.current;
      let componentHulls = resolvedComponentHullsRef.current;
      if (projectionDirty) {
        specimenSilhouette = projectLeaderMeshSilhouette(
          cache.externalSilhouetteEntries,
          camera,
          size.width,
          size.height,
          scratch.boundsWorldPoint,
          scratch.boundsProjectedPoint,
          "overall-visible-specimen",
          `${specimenFingerprint}|membership:${membershipFingerprint}`,
          REGION_LEADER_SILHOUETTE_ROLES.external,
          cache.projectionIndicesByMeshUuid,
          inSituInternal,
        );
        selectedSilhouette = projectLeaderMeshSilhouette(
          selectedSilhouetteEntries,
          camera,
          size.width,
          size.height,
          scratch.boundsWorldPoint,
          scratch.boundsProjectedPoint,
          "detached-selected-cluster",
          `${selectedFingerprint}|membership:${membershipFingerprint}`,
          inSituInternal
            ? REGION_LEADER_SILHOUETTE_ROLES.detached
            : REGION_LEADER_SILHOUETTE_ROLES.external,
          cache.projectionIndicesByMeshUuid,
          inSituInternal,
        );
        componentHulls = projectLeaderComponentHulls(
          selectedMeshes,
          camera,
          size.width,
          size.height,
          scratch.boundsWorldPoint,
          scratch.boundsProjectedPoint,
          cache.projectionIndicesByMeshUuid,
        );
        resolvedComponentHullsRef.current = componentHulls;
      }
      const exactProjectionMissing =
        !specimenSilhouette || !selectedSilhouette;
      if (exactProjectionMissing) {
        const retryState = projectionRetryRef.current;
        const attempts =
          retryState.regionId === leaderRegionId
            ? retryState.attempts + 1
            : 1;
        projectionRetryRef.current = {
          regionId: leaderRegionId,
          attempts,
        };
        const fallbackSample = fallbackSamples[0];
        if (fallbackSample) {
          fallbackSample.mesh.updateWorldMatrix(true, false);
          const transientSilhouette =
            createTransientRegionLeaderSilhouette({
              worldPoint: scratch.worldPoint
                .fromArray(fallbackSample.localPoint)
                .applyMatrix4(fallbackSample.mesh.matrixWorld),
              camera,
              viewportWidth: size.width,
              viewportHeight: size.height,
              detachedInternal: inSituInternal,
            });
          if (transientSilhouette) {
            specimenSilhouette ??= transientSilhouette;
            selectedSilhouette ??= transientSilhouette;
          }
        }
        if (attempts <= 8) state.invalidate();
      } else {
        projectionRetryRef.current = {
          regionId: leaderRegionId,
          attempts: 0,
        };
      }
      resolvedSpecimenSilhouetteRef.current = specimenSilhouette;
      resolvedSelectedSilhouetteRef.current = selectedSilhouette;
      const cardLayout = getRegionInfoCardLayout(
        size.width,
        size.height,
      );
      const selectedContributorHulls =
        specimenSilhouette?.contributors
          ?.filter(
            (contributor) =>
              contributor.regionId === leaderRegionId &&
              contributor.role ===
                REGION_LEADER_SILHOUETTE_ROLES.external,
          )
          .map((contributor) => contributor.hull) ?? [];
      const contourProbePoints =
        !inSituInternal &&
        specimenSilhouette &&
        selectedContributorHulls.length > 0
          ? [
              ...createCardFacingSelectedSurfaceProbePoints(
                selectedContributorHulls,
                {
                  x: cardLayout.left,
                  y:
                    cardLayout.top +
                    cardLayout.leaderAttachmentOffsetYPx,
                },
              ),
              ...createRegionSelectedContourProbePoints({
                overallHull: specimenSilhouette.hull,
                selectedContributorHulls,
                cardPoint: {
                  x: cardLayout.left,
                  y:
                    cardLayout.top +
                    cardLayout.leaderAttachmentOffsetYPx,
                },
              }),
            ]
          : [];
      const previousSurfaces = resolvedSurfaceRef.current.filter(
        (surface) => isVisibleSurfaceObject(surface.mesh),
      );
      const clickedMesh =
        selectionFocusIntent?.regionId === leaderRegionId &&
        selectionFocusIntent.objectUuid &&
        selectionFocusIntent.localPoint
          ? cache.meshesByUuid.get(selectionFocusIntent.objectUuid)
          : null;
      const probe =
        !inSituInternal && specimenSilhouette && selectedSilhouette
          ? probeVisibleRegionSurface({
              regionId: leaderRegionId,
              selectedBounds: selectedSilhouette.bounds,
              viewportWidth: size.width,
              viewportHeight: size.height,
              camera,
              raycaster: scratch.raycaster,
              foregroundMeshes,
              selectedMeshes,
              clickedPoint:
                clickedMesh && selectionFocusIntent?.localPoint
                  ? {
                      mesh: clickedMesh,
                      localPoint: selectionFocusIntent.localPoint,
                    }
                  : null,
              previousPoints: previousSurfaces.map((surface) => ({
                mesh: surface.mesh,
                localPoint: surface.localPoint.toArray(),
              })),
              fallbackPoints: fallbackSamples,
              contourPoints: contourProbePoints,
              maximumRays: 49,
              rayBatchStart: probeBatchIndexRef.current * 12,
              rayBatchSize: 12,
            })
          : null;
      if (probe) {
        recordBrainTransitionOperation(
          "leader-probe-batch",
          probe.elapsedMilliseconds,
          `${probe.counts.raysTested} rays`,
        );
        probeBatchIndexRef.current += 1;
        for (const hit of probe.hits) {
          const duplicate = accumulatedProbeHitsRef.current.some(
            (candidate) =>
              candidate.mesh === hit.mesh &&
              Math.hypot(
                candidate.screenPoint.x - hit.screenPoint.x,
                candidate.screenPoint.y - hit.screenPoint.y,
              ) < 1,
          );
          if (!duplicate) accumulatedProbeHitsRef.current.push(hit);
        }
      }

      const evaluated: (ResolvedLeaderSurface & {
        id: string;
        clicked: boolean;
        previous: boolean;
        source: string;
        continuityDistance: number;
        interiorClearancePx: number;
      })[] = [];
      if (inSituInternal && specimenSilhouette) {
        let inSituCandidate:
          | {
              mesh: THREE.Mesh;
              localPoint: THREE.Vector3;
              componentId: string;
              screenPoint: { x: number; y: number };
              score: number;
            }
          | null = null;
        const targetCenterY =
          (specimenSilhouette.bounds.top +
            specimenSilhouette.bounds.bottom) /
          2;
        for (const sample of supportSamples) {
          const mesh = cache.meshesByUuid.get(sample.meshUuid);
          if (!mesh) continue;
          mesh.updateWorldMatrix(true, false);
          scratch.worldPoint
            .fromArray(sample.localPoint)
            .applyMatrix4(mesh.matrixWorld);
          scratch.viewPoint
            .copy(scratch.worldPoint)
            .applyMatrix4(camera.matrixWorldInverse);
          scratch.projectedPoint.copy(scratch.worldPoint).project(camera);
          const screenPoint = projectLeaderNdcToScreen(
            scratch.projectedPoint,
            -scratch.viewPoint.z,
            size.width,
            size.height,
          );
          if (!screenPoint) continue;
          const score =
            screenPoint.x -
            Math.abs(screenPoint.y - targetCenterY) * 0.18;
          if (!inSituCandidate || score > inSituCandidate.score) {
            inSituCandidate = {
              mesh,
              localPoint: new THREE.Vector3().fromArray(
                sample.localPoint,
              ),
              componentId: sample.componentId,
              screenPoint: { x: screenPoint.x, y: screenPoint.y },
              score,
            };
          }
        }
        if (inSituCandidate) {
          evaluated.push({
            id: `${inSituCandidate.componentId}:in-situ`,
            mesh: inSituCandidate.mesh,
            localPoint: inSituCandidate.localPoint,
            componentId: inSituCandidate.componentId,
            screenPoint: inSituCandidate.screenPoint,
            clearancePx: 0,
            interiorClearancePx: 0,
            clicked: false,
            previous: false,
            source: "in-situ-support",
            continuityDistance: 0,
            anchorSource: "selected-support",
            selectedRegion: leaderRegionId,
            hullEdgeRegion: null,
            markerToFinalExitPx: Number.POSITIVE_INFINITY,
            residualOccludedGapPx: Number.POSITIVE_INFINITY,
            resolver: "frontmost-visible-selected",
          });
        }
      }
      if (
        !inSituInternal &&
        probe &&
        specimenSilhouette &&
        selectedSilhouette
      ) {
        for (const hit of accumulatedProbeHitsRef.current) {
          const componentHull =
            componentHulls.get(hit.componentId) ??
            selectedSilhouette.hull;
          const interiorClearancePx =
            getRegionMarkerInteriorClearance(
              hit.screenPoint,
              componentHull,
            );
          const previousSurface = previousSurfaces.find(
            (surface) => surface.componentId === hit.componentId,
          );
          const continuityDistance = previousSurface
            ? Math.hypot(
                hit.screenPoint.x - previousSurface.screenPoint.x,
                hit.screenPoint.y - previousSurface.screenPoint.y,
              )
            : 0;
          probe.scheduleDiagnostics.queues[hit.queue].accepted += 1;
          evaluated.push({
            id: `${hit.componentId}:${hit.localPoint.toArray().join(",")}`,
            mesh: hit.mesh,
            localPoint: hit.localPoint.clone(),
            componentId: hit.componentId,
            screenPoint: hit.screenPoint,
            clearancePx: interiorClearancePx,
            interiorClearancePx,
            clicked: hit.source === "clicked",
            previous: hit.source === "previous",
            source: hit.source,
            continuityDistance,
            anchorSource: "selected-support",
            selectedRegion: leaderRegionId,
            hullEdgeRegion: null,
            markerToFinalExitPx: Number.POSITIVE_INFINITY,
            residualOccludedGapPx: Number.POSITIVE_INFINITY,
            resolver: "frontmost-visible-selected",
          });
        }
      }
      let usedTransientSurfaceFallback = false;
      if (
        !inSituInternal &&
        evaluated.length === 0 &&
        specimenSilhouette &&
        selectedSilhouette
      ) {
        let fallbackCandidate:
          | (typeof evaluated)[number]
          | null = null;
        let fallbackScore = Number.NEGATIVE_INFINITY;
        for (const sample of supportSamples) {
          const mesh = cache.meshesByUuid.get(sample.meshUuid);
          if (!mesh || !isVisibleSurfaceObject(mesh)) continue;
          mesh.updateWorldMatrix(true, false);
          scratch.worldPoint
            .fromArray(sample.localPoint)
            .applyMatrix4(mesh.matrixWorld);
          scratch.viewPoint
            .copy(scratch.worldPoint)
            .applyMatrix4(camera.matrixWorldInverse);
          scratch.projectedPoint.copy(scratch.worldPoint).project(camera);
          const screenPoint = projectLeaderNdcToScreen(
            scratch.projectedPoint,
            -scratch.viewPoint.z,
            size.width,
            size.height,
          );
          if (!screenPoint) continue;
          const componentHull =
            componentHulls.get(sample.componentId) ??
            selectedSilhouette.hull;
          const interiorClearancePx =
            getRegionMarkerInteriorClearance(
              screenPoint,
              componentHull,
            );
          const score =
            interiorClearancePx * 100 +
            screenPoint.x -
            Math.abs(
              screenPoint.y -
                (selectedSilhouette.bounds.top +
                  selectedSilhouette.bounds.bottom) /
                  2,
            ) *
              0.1;
          if (score <= fallbackScore) continue;
          fallbackScore = score;
          fallbackCandidate = {
            id: `${sample.componentId}:transient-support-fallback`,
            mesh,
            localPoint: new THREE.Vector3().fromArray(
              sample.localPoint,
            ),
            componentId: sample.componentId,
            screenPoint,
            clearancePx: interiorClearancePx,
            interiorClearancePx,
            clicked: false,
            previous: false,
            source: "transient-support-fallback",
            continuityDistance: 0,
            anchorSource: "selected-support",
            selectedRegion: leaderRegionId,
            hullEdgeRegion: null,
            markerToFinalExitPx: Number.POSITIVE_INFINITY,
            residualOccludedGapPx: Number.POSITIVE_INFINITY,
            resolver: "frontmost-visible-selected",
          };
        }
        if (fallbackCandidate) {
          evaluated.push(fallbackCandidate);
          usedTransientSurfaceFallback = true;
        }
      }
      const resolved: ResolvedLeaderSurface[] = [];
      if (inSituInternal) {
        const candidatesByComponent = new Map<string, typeof evaluated>();
        for (const candidate of evaluated) {
          const candidates =
            candidatesByComponent.get(candidate.componentId) ?? [];
          candidates.push(candidate);
          candidatesByComponent.set(candidate.componentId, candidates);
        }
        const componentCandidateSets = [...candidatesByComponent.entries()]
          .sort(([first], [second]) => first.localeCompare(second))
          .map(([, candidates]) => candidates);
        if (componentCandidateSets.length === 2) {
          let closestPair:
            | [typeof evaluated[number], typeof evaluated[number]]
            | null = null;
          let closestDistance = Number.POSITIVE_INFINITY;
          for (const first of componentCandidateSets[0]) {
            for (const second of componentCandidateSets[1]) {
              const distance = Math.hypot(
                first.screenPoint.x - second.screenPoint.x,
                first.screenPoint.y - second.screenPoint.y,
              );
              if (distance < closestDistance) {
                closestDistance = distance;
                closestPair = [first, second];
              }
            }
          }
          if (closestPair) {
            const firstHull =
              componentHulls.get(closestPair[0].componentId) ?? [];
            const secondHull =
              componentHulls.get(closestPair[1].componentId) ?? [];
            const innerPair = findNearestPointsBetweenRegionHulls(
              firstHull,
              secondHull,
            );
            resolved.push(
              {
                ...closestPair[0],
                groupPoint:
                  innerPair?.first ?? closestPair[0].screenPoint,
              },
              {
                ...closestPair[1],
                groupPoint:
                  innerPair?.second ?? closestPair[1].screenPoint,
              },
            );
          }
        } else {
          for (const candidates of componentCandidateSets) {
            const selected =
              chooseRegionMarkerCandidate(candidates).candidate;
            if (selected) resolved.push(selected);
          }
        }
      } else {
        const selected = chooseRegionContourAnchorCandidate({
          candidates: evaluated,
          overallHull: specimenSilhouette?.hull ?? [],
          selectedContributorHulls,
          selectedRegionId: leaderRegionId,
          cardPoint: {
            x: cardLayout.left,
            y:
              cardLayout.top +
              cardLayout.leaderAttachmentOffsetYPx,
          },
        });
        if (selected) {
          resolved.push({
            ...selected.candidate,
            anchorSource: selected.anchorSource,
            selectedRegion: selected.selectedRegion,
            hullEdgeRegion: selected.hullEdgeRegion,
            markerToFinalExitPx: selected.markerToFinalExitPx,
            residualOccludedGapPx:
              selected.residualOccludedGapPx,
            resolver: "frontmost-visible-selected",
          });
        }
      }
      resolvedSurfaceRef.current = resolved;
      if (
        usedTransientSurfaceFallback &&
        !transientSurfaceFallbackRef.current
      ) {
        lastTransientSurfaceRetryRef.current =
          elapsedMilliseconds;
      }
      transientSurfaceFallbackRef.current =
        usedTransientSurfaceFallback && resolved.length > 0;
      resolvedSpecimenSilhouetteRef.current = specimenSilhouette;
      resolvedSilhouetteRef.current = specimenSilhouette;
      verifiedCandidateCountRef.current =
        probe?.counts.visibleHitCount ?? 0;
      supportSampleCountRef.current = supportSamples.length;
      const markerWorldPoints = resolved.map((surface) => {
        surface.mesh.updateWorldMatrix(true, false);
        return scratch.worldPoint
          .copy(surface.localPoint)
          .applyMatrix4(surface.mesh.matrixWorld)
          .toArray();
      });
      const rawMarkerToSilhouetteDistancePx = resolved.length
        ? Math.min(
            ...resolved.map((surface) =>
              Math.max(
                0,
                (resolvedSilhouetteRef.current?.bounds.right ?? surface.screenPoint.x) -
                  surface.screenPoint.x,
              ),
            ),
          )
        : null;
      regionLeaderRef.current?.reportDiagnostics({
        regionId: leaderRegionId,
        dirtyTrigger: dirtyTriggerRef.current,
        registeredRegionCount: registry.registeredRegionCount,
        registeredMeshCount: selectedMeshes.length,
        supportSampleCount: supportSamples.length,
        directionalProbeCount:
          probe?.counts.directionalProbeCount ?? 0,
        directionalHitCount:
          probe?.counts.directionalHitCount ?? 0,
        supportGridCount: probe?.counts.supportGridCount ?? 0,
        probeQueues:
          probe?.scheduleDiagnostics.queues ??
          createEmptyRegionLeaderProbeQueueCounts(),
        budgetStopReason:
          probe?.scheduleDiagnostics.budgetStopReason ??
          "queues-exhausted",
        everyAvailableReservedQueueRan:
          probe?.scheduleDiagnostics.everyAvailableReservedQueueRan ??
          false,
        supportRegistrationPending: false,
        raysTested: probe?.counts.raysTested ?? 0,
        visibleHitCount: probe?.counts.visibleHitCount ?? 0,
        rejectedResolutionCount:
          probe?.counts.rejectedResolutionCount ?? 0,
        rejectedProxyCount: probe?.counts.rejectedProxyCount ?? 0,
        rejectedInvisibleCount:
          probe?.counts.rejectedInvisibleCount ?? 0,
        scanMilliseconds: probe?.elapsedMilliseconds ?? 0,
        markerComponents: resolved.map((surface) => surface.componentId),
        markerMeshUuids: resolved.map((surface) => surface.mesh.uuid),
        markerLocalPoints: resolved.map((surface) =>
          surface.localPoint.toArray(),
        ),
        markerWorldPoints,
        markerScreenPoints: resolved.map((surface) => surface.screenPoint),
        markerClearancesPx: resolved.map((surface) => surface.clearancePx),
        rawMarkerToSilhouetteDistancePx,
      });
      if (!resolved.length) {
        regionLeaderRef.current?.hide(
          probe?.reason ?? "projected-silhouette-unavailable",
        );
      }
      lastCameraMatrixRef.current = [...cameraElements];
      lastWinnerMatrixRef.current = resolved[0]
        ? [...resolved[0].mesh.matrixWorld.elements]
        : null;
      lastSilhouetteFingerprintRef.current = activeSilhouetteFingerprint;
      dirtyTriggerRef.current = "settled";
      recordBrainTransitionOperation(
        "leader-resolve",
        performance.now() - leaderResolveStartedAt,
        `${probeBatchIndexRef.current}/5 batches`,
      );
    }

    const resolved = resolvedSurfaceRef.current;
    const silhouette = resolvedSilhouetteRef.current;
    const specimenSilhouette = resolvedSpecimenSilhouetteRef.current;
    if (!resolved.length || !silhouette || !specimenSilhouette) {
      return;
    }
    const markers = [];
    for (const surface of resolved) {
      if (!inSituInternal && !isVisibleSurfaceObject(surface.mesh)) continue;
      surface.mesh.updateWorldMatrix(true, false);
      scratch.worldPoint
        .copy(surface.localPoint)
        .applyMatrix4(surface.mesh.matrixWorld);
      const worldPoint = scratch.worldPoint.toArray();
      scratch.viewPoint
        .copy(scratch.worldPoint)
        .applyMatrix4(camera.matrixWorldInverse);
      scratch.projectedPoint.copy(scratch.worldPoint).project(camera);
      const screenPoint = projectLeaderNdcToScreen(
        scratch.projectedPoint,
        -scratch.viewPoint.z,
        size.width,
        size.height,
      );
      if (!screenPoint) continue;
      markers.push({
        ...screenPoint,
        componentId: surface.componentId,
        meshUuid: surface.mesh.uuid,
        localPoint: surface.localPoint.toArray(),
        worldPoint,
        clearancePx: surface.clearancePx,
        radiusPx: inSituInternal
          ? REGION_INFO_LEADER.markerInternalRadiusPx
          : REGION_INFO_LEADER.markerExternalRadiusPx,
        anchorSource: surface.anchorSource,
        selectedRegion: surface.selectedRegion,
        hullEdgeRegion: surface.hullEdgeRegion,
        markerToFinalExitPx: surface.markerToFinalExitPx,
        residualOccludedGapPx: surface.residualOccludedGapPx,
        resolver: surface.resolver,
        groupPoint: surface.groupPoint,
      });
    }
    if (!markers.length) {
      regionLeaderRef.current?.hide("marker-offscreen");
      return;
    }
    const rawMarkerToSilhouetteDistancePx = Math.min(
      ...markers.map((marker) =>
        Math.max(0, silhouette.bounds.right - marker.x),
      ),
    );
    const leaderUpdateKey = [
      leaderRegionId,
      silhouette.baseFingerprint ?? "silhouette",
      regionLeaderRef.current?.getLayoutRevision() ?? 0,
      Math.round(appliedLeftInsetPx),
      Math.round(appliedRightInsetPx),
      ...markers.flatMap((marker) => [
        Math.round(marker.x * 2) / 2,
        Math.round(marker.y * 2) / 2,
      ]),
    ].join(":");
    const throttle = leaderUpdateThrottleRef.current;
    if (throttle.key === leaderUpdateKey && throttle.samples >= 2) {
      return;
    }
    leaderUpdateThrottleRef.current =
      throttle.key === leaderUpdateKey
        ? { key: leaderUpdateKey, samples: throttle.samples + 1 }
        : { key: leaderUpdateKey, samples: 1 };
    regionLeaderRef.current?.updateTarget({
      regionId: leaderRegionId,
      viewportWidth: size.width,
      viewportHeight: size.height,
      cameraPhase: phaseRef.current,
      convergenceToken,
      baseLeftInsetPx,
      appliedLeftInsetPx,
      baseRightInsetPx,
      appliedRightInsetPx,
      cameraFingerprint: createRegionCardCameraFingerprint([
        silhouette.bounds.left,
        silhouette.bounds.top,
        silhouette.bounds.right,
        silhouette.bounds.bottom,
      ]),
      markers,
      silhouette,
      specimenSilhouette,
      detachedInternal: inSituInternal,
      extractionOrigin: null,
      supportSampleCount: supportSampleCountRef.current,
      verifiedCandidateCount: verifiedCandidateCountRef.current,
      rawMarkerToSilhouetteDistancePx,
    });
  });

  return null;
}

function Scene({
  modelAttempt,
  onInteraction,
  mobilePresentation,
  compactLandscape,
  canvasHoveredRegionId,
  hoveredRegionId,
  selectedRegionId,
  leaderRegionId,
  selectionFocusIntent,
  onRegionHoverChange,
  onPointerExit,
  onRegionClick,
  onBackgroundHover,
  onBackgroundClick,
  shouldSuppressClick,
  cameraGestureSignalRef,
  regionLeaderRef,
  reservedLeftPx,
  reservedRightPx,
  navigatorBaseLeftPx,
  cardBaseRightPx,
  cardCameraConvergenceToken,
  cardCameraRefitRevision,
}: SceneProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const cinematicPhaseRef = useRef<CameraTransitionPhase>("idle");
  const specimenRef = useRef<THREE.Group>(null);
  const cameraTargetRef = useRef(new THREE.Vector3());
  const extractionPlanRef = useRef(
    createBrainExtractionPlanRegistry(),
  );
  const specimenMotionRef = useRef(createSpecimenMotionState());
  const savedCameraPoseRef = useRef<CameraPose | null>(null);
  const leaderFocusAnchorRef = useRef(
    createRegionLeaderWorldAnchor(),
  );
  const leaderExtractionAnchorRef = useRef(
    createRegionLeaderWorldAnchor(),
  );
  const leaderSupportRegistryRef =
    useRef<RegionLeaderSupportRegistry | null>(null);

  return (
    <>
      <fog attach="fog" args={["#030407", 11.5, 24]} />
      <GalleryLighting mobilePresentation={mobilePresentation} />
      <AmbientDust />
      <BackgroundInteractionCatcher
        onBackgroundHover={onBackgroundHover}
        onBackgroundClick={onBackgroundClick}
      />
      <FloatingBrain
        modelAttempt={modelAttempt}
        mobilePresentation={mobilePresentation}
        canvasHoveredRegionId={canvasHoveredRegionId}
        hoveredRegionId={hoveredRegionId}
        selectedRegionId={selectedRegionId}
        onRegionHoverChange={onRegionHoverChange}
        onPointerExit={onPointerExit}
        onRegionClick={onRegionClick}
        shouldSuppressClick={shouldSuppressClick}
        prefersReducedMotion={prefersReducedMotion}
        specimenRef={specimenRef}
        extractionPlanRef={extractionPlanRef}
        specimenMotionRef={specimenMotionRef}
        leaderExtractionAnchorRef={leaderExtractionAnchorRef}
        leaderSupportRegistryRef={leaderSupportRegistryRef}
      />
      <SceneReadiness attempt={modelAttempt} />
      <CinematicOrbitControls
        mobilePresentation={mobilePresentation}
        compactLandscape={compactLandscape}
        hoveredRegionId={hoveredRegionId}
        selectedRegionId={selectedRegionId}
        selectionFocusIntent={selectionFocusIntent}
        prefersReducedMotion={prefersReducedMotion}
        onInteraction={onInteraction}
        phaseRef={cinematicPhaseRef}
        diagnosticTargetRef={cameraTargetRef}
        gestureSignalRef={cameraGestureSignalRef}
        onHoverRefresh={onPointerExit}
        extractionPlanRef={extractionPlanRef}
        specimenRef={specimenRef}
        specimenMotionRef={specimenMotionRef}
        savedCameraPoseRef={savedCameraPoseRef}
        leaderFocusAnchorRef={leaderFocusAnchorRef}
        reservedLeftPx={reservedLeftPx}
        reservedRightPx={reservedRightPx}
        cameraRefitRevision={cardCameraRefitRevision}
      />
      <RegionLeaderProjector
        leaderRegionId={leaderRegionId}
        selectionFocusIntent={selectionFocusIntent}
        regionLeaderRef={regionLeaderRef}
        supportRegistryRef={leaderSupportRegistryRef}
        phaseRef={cinematicPhaseRef}
        baseLeftInsetPx={navigatorBaseLeftPx}
        appliedLeftInsetPx={reservedLeftPx}
        baseRightInsetPx={cardBaseRightPx}
        appliedRightInsetPx={reservedRightPx}
        convergenceToken={cardCameraConvergenceToken}
      />

      {!mobilePresentation ? (
        <>
          <ContactShadows
            position={[0, -1.98, 0]}
            opacity={0.18}
            scale={9.5}
            blur={5}
            far={5.5}
            color="#03040a"
            frames={1}
          />
          <EffectComposer multisampling={2}>
            <N8AO
              halfRes
              quality="performance"
              aoRadius={0.32}
              distanceFalloff={0.82}
              intensity={selectedRegionId === null ? 0.92 : 0}
              color="#241d22"
            />
            <Bloom
              mipmapBlur
              intensity={INTERACTION_BLOOM.intensity}
              luminanceThreshold={INTERACTION_BLOOM.luminanceThreshold}
              luminanceSmoothing={
                INTERACTION_BLOOM.luminanceSmoothing
              }
              radius={INTERACTION_BLOOM.radius}
            />
            <Vignette
              eskil={false}
              offset={0.35}
              darkness={0.1}
            />
            <ToneMapping mode={ToneMappingMode.NEUTRAL} />
          </EffectComposer>
        </>
      ) : null}

      <RegionDiagnostics
        phaseRef={cinematicPhaseRef}
        targetRef={cameraTargetRef}
        specimenRef={specimenRef}
        specimenMotionRef={specimenMotionRef}
        savedCameraPoseRef={savedCameraPoseRef}
        mobilePresentation={mobilePresentation}
      />
    </>
  );
}

export function BrainScene({
  modelAttempt,
  onInteraction,
  maximumDpr,
  mobilePresentation,
  compactLandscape,
  canvasHoveredRegionId,
  hoveredRegionId,
  selectedRegionId,
  leaderRegionId,
  selectionFocusIntent,
  onRegionHoverChange,
  onPointerExit,
  onRegionClick,
  onBackgroundHover,
  onBackgroundClick,
  onCanvasPointerMove,
  regionLeaderRef,
  reservedLeftPx,
  reservedRightPx,
  navigatorBaseLeftPx,
  cardBaseRightPx,
  cardCameraConvergenceToken,
  cardCameraRefitRevision,
}: BrainSceneProps) {
  const gestureRef = useRef<BrainGestureState>(initialBrainGestureState);
  const cameraGestureSignalRef = useRef<BrainCameraGestureSignal>(
    initialBrainCameraGestureSignal,
  );
  const dispatchPointerGesture = useCallback(
    (action: Parameters<typeof reduceBrainGesture>[1]) => {
      const previous = gestureRef.current;
      const next = reduceBrainGesture(previous, action);
      gestureRef.current = next;
      cameraGestureSignalRef.current = syncBrainCameraGestureSignal(
        cameraGestureSignalRef.current,
        previous,
        next,
      );
      return next;
    },
    [],
  );
  const shouldSuppressClick = useCallback(() => {
    const suppress = gestureRef.current.suppressNextClick;
    gestureRef.current = reduceBrainGesture(gestureRef.current, {
      type: "consume-click",
    });
    return suppress;
  }, []);
  const handleGuardedBackgroundClick = useCallback(() => {
    if (!shouldSuppressClick()) onBackgroundClick();
  }, [onBackgroundClick, shouldSuppressClick]);
  const cancelActivePointers = useCallback(() => {
    dispatchPointerGesture({ type: "pointer-cancel-all" });
    onPointerExit();
  }, [dispatchPointerGesture, onPointerExit]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        cancelActivePointers();
      }
    };
    window.addEventListener("blur", cancelActivePointers);
    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );
    return () => {
      window.removeEventListener("blur", cancelActivePointers);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    };
  }, [cancelActivePointers]);

  return (
    <Canvas
      className={`${getBrainCursorClass(
        hoveredRegionId,
      )} brain-scene-canvas`}
      camera={{
        position: [
          mobilePresentation
            ? compactLandscape
              ? 2.68
              : 3.68
            : 3.35,
          mobilePresentation
            ? compactLandscape
              ? 0.72
              : 1.2
            : 1.1,
          mobilePresentation
            ? compactLandscape
              ? 5.75
              : 7.9
            : 7.2,
        ],
        fov: 34,
        near: 0.1,
        far: 40,
      }}
      dpr={[1, maximumDpr]}
      shadows={mobilePresentation ? false : "percentage"}
      data-mobile-presentation={mobilePresentation ? "true" : "false"}
      onPointerDownCapture={(event) => {
        dispatchPointerGesture({
          type: "pointer-down",
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        });
        onPointerExit();
      }}
      onPointerMoveCapture={(event) => {
        onCanvasPointerMove(
          event.clientX,
          event.clientY,
          event.pointerType,
        );
        const gesture = dispatchPointerGesture({
          type: "pointer-move",
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        });
        if (gesture.gestureDetected) onPointerExit();
      }}
      onPointerUpCapture={(event) => {
        dispatchPointerGesture({
          type: "pointer-up",
          pointerId: event.pointerId,
        });
      }}
      onPointerCancelCapture={(event) => {
        dispatchPointerGesture({
          type: "pointer-cancel",
          pointerId: event.pointerId,
        });
      }}
      onLostPointerCaptureCapture={(event) => {
        dispatchPointerGesture({
          type: "pointer-cancel",
          pointerId: event.pointerId,
        });
      }}
      onPointerLeave={() => {
        cancelActivePointers();
      }}
      onWheelCapture={() => {
        cameraGestureSignalRef.current = signalBrainCameraWheel(
          cameraGestureSignalRef.current,
        );
        onPointerExit();
      }}
      onPointerMissed={handleGuardedBackgroundClick}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
        stencil: false,
      }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.toneMappingExposure = mobilePresentation ? 1.12 : 1;
        gl.shadowMap.enabled = !mobilePresentation;
        gl.shadowMap.type = THREE.PCFShadowMap;
      }}
    >
      <CanvasViewportSynchronizer />
      <Suspense fallback={null}>
        <Scene
          modelAttempt={modelAttempt}
          onInteraction={onInteraction}
          mobilePresentation={mobilePresentation}
          compactLandscape={compactLandscape}
          canvasHoveredRegionId={canvasHoveredRegionId}
          hoveredRegionId={hoveredRegionId}
          selectedRegionId={selectedRegionId}
          leaderRegionId={leaderRegionId}
          selectionFocusIntent={selectionFocusIntent}
          onRegionHoverChange={onRegionHoverChange}
          onPointerExit={onPointerExit}
          onRegionClick={onRegionClick}
          onBackgroundHover={onBackgroundHover}
          onBackgroundClick={handleGuardedBackgroundClick}
          shouldSuppressClick={shouldSuppressClick}
          cameraGestureSignalRef={cameraGestureSignalRef}
          regionLeaderRef={regionLeaderRef}
          reservedLeftPx={reservedLeftPx}
          reservedRightPx={reservedRightPx}
          navigatorBaseLeftPx={navigatorBaseLeftPx}
          cardBaseRightPx={cardBaseRightPx}
          cardCameraConvergenceToken={
            cardCameraConvergenceToken
          }
          cardCameraRefitRevision={cardCameraRefitRevision}
        />
      </Suspense>
    </Canvas>
  );
}
