"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type TransitionEvent,
} from "react";

import {
  BRAIN_REGION_BY_ID,
  type RegionId,
} from "@/lib/brain-regions";
import {
  beginExhibitLoadingAttempt,
  getExhibitSceneBusySnapshot,
  getExhibitSceneReadySnapshot,
  getServerExhibitSceneBusySnapshot,
  getServerExhibitSceneReadySnapshot,
  subscribeToExhibitLoading,
} from "@/lib/exhibit-loading-store";
import {
  reduceHoveredRegion,
  reduceSelectedRegion,
  resolveBrainHoveredRegion,
} from "@/lib/brain-interaction";
import type { BrainSelectionFocusIntent } from "@/lib/brain-camera";
import type { ExhibitLoadingPresentationPhase } from "@/lib/exhibit-loading-state";
import { getRegionInfoCardLayout } from "@/lib/region-info-card-layout";
import type { RegionInfoCardContentPhase } from "@/lib/region-info-card-state";
import type {
  RegionCardCameraInsetRequest,
  RegionInfoLeaderHandle,
} from "@/lib/region-info-leader";
import { getRegionNavigatorLayout } from "@/lib/region-navigator-layout";
import { getMobileExhibitLayout } from "@/lib/mobile-exhibit-layout";

import {
  MobileRegionSheet,
  type MobileRegionSheetView,
} from "./MobileRegionSheet";
import { BrainCutawayAnnotation } from "./BrainCutawayAnnotation";
import { BrainSceneErrorBoundary } from "./BrainSceneErrorBoundary";
import {
  ExhibitLoadingOverlay,
  type ExhibitLoadingOverlayHandle,
} from "./ExhibitLoadingOverlay";
import {
  RegionInfoCard,
  type RegionInfoCardDismissalMode,
} from "./RegionInfoCard";
import { RegionInfoLeader } from "./RegionInfoLeader";
import {
  RegionHoverLabel,
  type RegionHoverLabelHandle,
} from "./RegionHoverLabel";
import { RegionNavigator } from "./RegionNavigator";

const BrainScene = dynamic(
  () => import("./BrainScene").then((module) => module.BrainScene),
  { ssr: false },
);

const SERVER_VIEWPORT_SNAPSHOT = "0:0:0:0";
const COARSE_POINTER_QUERY = "(pointer: coarse)";
const FINE_HOVER_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

const subscribeToViewport = (onStoreChange: () => void) => {
  const coarsePointer = window.matchMedia(COARSE_POINTER_QUERY);
  const fineHoverPointer = window.matchMedia(FINE_HOVER_POINTER_QUERY);
  window.addEventListener("resize", onStoreChange, { passive: true });
  window.addEventListener("orientationchange", onStoreChange, {
    passive: true,
  });
  window.visualViewport?.addEventListener("resize", onStoreChange, {
    passive: true,
  });
  coarsePointer.addEventListener("change", onStoreChange);
  fineHoverPointer.addEventListener("change", onStoreChange);
  return () => {
    window.removeEventListener("resize", onStoreChange);
    window.removeEventListener("orientationchange", onStoreChange);
    window.visualViewport?.removeEventListener("resize", onStoreChange);
    coarsePointer.removeEventListener("change", onStoreChange);
    fineHoverPointer.removeEventListener("change", onStoreChange);
  };
};

const getViewportSnapshot = () =>
  `${window.innerWidth}:${window.innerHeight}:${
    window.matchMedia(COARSE_POINTER_QUERY).matches ? 1 : 0
  }:${window.matchMedia(FINE_HOVER_POINTER_QUERY).matches ? 1 : 0}`;

const getServerViewportSnapshot = () => SERVER_VIEWPORT_SNAPSHOT;

type CardCameraInsetState = {
  convergenceToken: string;
  appliedLeftInsetPx: number;
  appliedRightInsetPx: number;
  refitRevision: number;
};

function useViewportSize() {
  const snapshot = useSyncExternalStore(
    subscribeToViewport,
    getViewportSnapshot,
    getServerViewportSnapshot,
  );
  const [width, height, coarsePointer, fineHoverPointer] =
    snapshot.split(":");
  return {
    width: Number(width),
    height: Number(height),
    coarsePointer: coarsePointer === "1",
    fineHoverPointer: fineHoverPointer === "1",
  };
}

type BrainExperienceStyle = CSSProperties & {
  "--mobile-sheet-base-height": string;
};

export function BrainExperience() {
  const experienceRef = useRef<HTMLElement>(null);
  const regionLeaderRef = useRef<RegionInfoLeaderHandle>(null);
  const loadingOverlayRef = useRef<ExhibitLoadingOverlayHandle>(null);
  const hoverLabelRef = useRef<RegionHoverLabelHandle>(null);
  const hoverLabelFrameRef = useRef<number | null>(null);
  const latestCanvasPointerRef = useRef({
    x: 0,
    y: 0,
    hasSample: false,
  });
  const selectedRegionRef = useRef<RegionId | null>(null);
  const nextModelAttemptRef = useRef(0);
  const viewport = useViewportSize();
  const sceneReady = useSyncExternalStore(
    subscribeToExhibitLoading,
    getExhibitSceneReadySnapshot,
    getServerExhibitSceneReadySnapshot,
  );
  const sceneBusy = useSyncExternalStore(
    subscribeToExhibitLoading,
    getExhibitSceneBusySnapshot,
    getServerExhibitSceneBusySnapshot,
  );
  const [modelAttempt, setModelAttempt] = useState(0);
  const [loadingPresentationPhase, setLoadingPresentationPhase] =
    useState<ExhibitLoadingPresentationPhase>("waiting");
  const [hasInteracted, setHasInteracted] = useState(false);
  const [canvasHoveredRegionId, setCanvasHoveredRegionId] =
    useState<RegionId | null>(null);
  const [navigatorHoveredRegionId, setNavigatorHoveredRegionId] =
    useState<RegionId | null>(null);
  const [selectedRegionId, setSelectedRegionId] =
    useState<RegionId | null>(null);
  const [mobileSheetView, setMobileSheetView] =
    useState<MobileRegionSheetView>("index");
  const [presentedRegionId, setPresentedRegionId] =
    useState<RegionId | null>(null);
  const [handoffPhase, setHandoffPhase] =
    useState<RegionInfoCardContentPhase>("settled");
  const [selectionFocusIntent, setSelectionFocusIntent] =
    useState<BrainSelectionFocusIntent | null>(null);
  const [cardDismissalMode, setCardDismissalMode] =
    useState<RegionInfoCardDismissalMode>("standard");
  const [convergenceRevision, setConvergenceRevision] = useState(0);
  const [cardCameraInsetState, setCardCameraInsetState] =
    useState<CardCameraInsetState>({
      convergenceToken: "",
      appliedLeftInsetPx: 0,
      appliedRightInsetPx: 0,
      refitRevision: 0,
    });
  const navigatorLayout = useMemo(
    () => getRegionNavigatorLayout(viewport.width, viewport.height),
    [viewport.height, viewport.width],
  );
  const mobileLayout = useMemo(
    () =>
      getMobileExhibitLayout(
        viewport.width,
        viewport.height,
        viewport.coarsePointer,
      ),
    [viewport.coarsePointer, viewport.height, viewport.width],
  );
  const cardLayout = useMemo(
    () => getRegionInfoCardLayout(viewport.width, viewport.height),
    [viewport.height, viewport.width],
  );
  const hoveredRegionId = resolveBrainHoveredRegion({
    canvasRegionId: canvasHoveredRegionId,
    navigatorRegionId: navigatorHoveredRegionId,
  });
  const effectiveMobileSheetView =
    selectedRegionId === null ? "index" : mobileSheetView;
  const mobileSheetBaseHeightPx =
    effectiveMobileSheetView === "detail"
      ? mobileLayout.detailSheetBaseHeightPx
      : mobileLayout.sheetBaseHeightPx;
  const baseReservedRightPx =
    !mobileLayout.active &&
    selectedRegionId &&
    cardLayout.reservesLane
      ? cardLayout.reservedRightPx
      : 0;
  const baseReservedLeftPx =
    mobileLayout.active ? 0 : navigatorLayout.reservedLeftPx;
  const cardCameraConvergenceToken = [
    convergenceRevision,
    selectedRegionId ?? "none",
    presentedRegionId ?? "pending",
    `${viewport.width}x${viewport.height}`,
    mobileLayout.mode,
    effectiveMobileSheetView,
    mobileSheetBaseHeightPx,
  ].join(":");
  const hasCurrentCardCameraInset =
    cardCameraInsetState.convergenceToken ===
    cardCameraConvergenceToken;
  const reservedRightPx = selectedRegionId
    ? Math.max(
        baseReservedRightPx,
        hasCurrentCardCameraInset
          ? cardCameraInsetState.appliedRightInsetPx
          : baseReservedRightPx,
      )
    : 0;
  const reservedLeftPx =
    selectedRegionId && hasCurrentCardCameraInset
      ? Math.max(
          baseReservedLeftPx,
          cardCameraInsetState.appliedLeftInsetPx,
        )
      : baseReservedLeftPx;
  const cardCameraRefitRevision = hasCurrentCardCameraInset
    ? cardCameraInsetState.refitRevision
    : 0;
  const selectedRegionName = selectedRegionId
    ? BRAIN_REGION_BY_ID.get(selectedRegionId)?.name
    : null;
  const canvasHoverLabelRegion =
    viewport.fineHoverPointer && canvasHoveredRegionId
      ? (BRAIN_REGION_BY_ID.get(canvasHoveredRegionId) ?? null)
      : null;
  const scenePresentationVisible =
    loadingPresentationPhase === "scene-entering" ||
    loadingPresentationPhase === "hidden";
  const sceneInteractive =
    sceneReady && loadingPresentationPhase === "hidden";
  const cutawayRegionSelected =
    selectedRegionId === "hippocampus" ||
    selectedRegionId === "amygdala" ||
    selectedRegionId === "corpus-callosum";
  const experienceStyle: BrainExperienceStyle = {
    "--mobile-sheet-base-height": `${mobileSheetBaseHeightPx}px`,
  };
  const shouldShowOrbitPrompt = mobileLayout.active || !hasInteracted;
  const mobileOrbitPromptCopy =
    effectiveMobileSheetView === "detail"
      ? "拖拽旋转 · 双指缩放"
      : "拖拽旋转 · 点击大脑或脑区名称";

  const handleRegionClick = useCallback(
    (
      regionId: RegionId,
      focusIntent: BrainSelectionFocusIntent,
    ) => {
      const currentRegionId = selectedRegionRef.current;
      const nextRegionId = reduceSelectedRegion(currentRegionId, {
        type: "region-click",
        regionId,
      });
      setHasInteracted(true);
      setCanvasHoveredRegionId(null);
      setCardDismissalMode("standard");
      window.dispatchEvent(
        new CustomEvent("brain-region-raycast", { detail: regionId }),
      );
      if (nextRegionId === currentRegionId) return;

      setConvergenceRevision((current) => current + 1);
      selectedRegionRef.current = nextRegionId;
      setSelectedRegionId(nextRegionId);
      setMobileSheetView(nextRegionId ? "detail" : "index");
      setSelectionFocusIntent(nextRegionId ? focusIntent : null);
    },
    [],
  );

  const handleBackgroundClick = useCallback(() => {
    const nextRegionId = reduceSelectedRegion(
      selectedRegionRef.current,
      { type: "background-click" },
    );
    setCardDismissalMode("standard");
    setCanvasHoveredRegionId((current) =>
      reduceHoveredRegion(current, { type: "background-click" }),
    );
    setNavigatorHoveredRegionId(null);
    if (nextRegionId !== selectedRegionRef.current) {
      setConvergenceRevision((current) => current + 1);
    }
    selectedRegionRef.current = nextRegionId;
    setSelectedRegionId(nextRegionId);
    setMobileSheetView("index");
    setSelectionFocusIntent(null);
  }, []);

  const handleCardDismiss = useCallback(() => {
    const nextRegionId = reduceSelectedRegion(
      selectedRegionRef.current,
      { type: "background-click" },
    );
    setCardDismissalMode("standard");
    if (nextRegionId !== selectedRegionRef.current) {
      setConvergenceRevision((current) => current + 1);
    }
    selectedRegionRef.current = nextRegionId;
    setSelectedRegionId(nextRegionId);
    setMobileSheetView("index");
    setSelectionFocusIntent(null);
  }, []);

  const handleBackgroundHover = useCallback(() => {
    setCanvasHoveredRegionId((current) =>
      reduceHoveredRegion(current, { type: "background-move" }),
    );
  }, []);

  const handleRegionHoverChange = useCallback(
    (regionId: RegionId, hovered: boolean) => {
      setCanvasHoveredRegionId((current) =>
        reduceHoveredRegion(current, {
          type: hovered ? "region-enter" : "region-leave",
          regionId,
        }),
      );
    },
    [],
  );
  const handlePointerExit = useCallback(() => {
    setCanvasHoveredRegionId((current) =>
      reduceHoveredRegion(current, { type: "pointer-exit" }),
    );
  }, []);

  const handleNavigatorSelect = useCallback(
    (regionId: RegionId) => {
      handleRegionClick(regionId, { regionId, source: "navigator" });
    },
    [handleRegionClick],
  );

  const handleNavigatorHover = useCallback(
    (regionId: RegionId | null) => {
      setNavigatorHoveredRegionId(regionId);
    },
    [],
  );

  const handleInteraction = useCallback(() => {
    setHasInteracted(true);
  }, []);

  const positionCanvasHoverLabel = useCallback(() => {
    hoverLabelFrameRef.current = null;
    const label = hoverLabelRef.current;
    const pointer = latestCanvasPointerRef.current;
    if (!label || !pointer.hasSample) return;
    label.position(
      pointer.x,
      pointer.y,
      window.innerWidth,
      window.innerHeight,
    );
  }, []);

  const scheduleCanvasHoverLabelPosition = useCallback(() => {
    if (hoverLabelFrameRef.current !== null) return;
    hoverLabelFrameRef.current = window.requestAnimationFrame(
      positionCanvasHoverLabel,
    );
  }, [positionCanvasHoverLabel]);

  const handleCanvasPointerMove = useCallback(
    (clientX: number, clientY: number, pointerType: string) => {
      if (
        pointerType !== "mouse" ||
        !window.matchMedia(FINE_HOVER_POINTER_QUERY).matches
      ) {
        return;
      }
      latestCanvasPointerRef.current = {
        x: clientX,
        y: clientY,
        hasSample: true,
      };
      scheduleCanvasHoverLabelPosition();
    },
    [scheduleCanvasHoverLabelPosition],
  );

  const handleModelRetry = useCallback(() => {
    const nextAttempt = nextModelAttemptRef.current + 1;
    nextModelAttemptRef.current = nextAttempt;
    beginExhibitLoadingAttempt(nextAttempt);
    setModelAttempt(nextAttempt);
  }, []);

  const handleSceneTransitionEnd = useCallback(
    (event: TransitionEvent<HTMLDivElement>) => {
      if (
        event.target === event.currentTarget &&
        event.propertyName === "opacity" &&
        loadingPresentationPhase === "scene-entering"
      ) {
        loadingOverlayRef.current?.completeSceneEntrance();
      }
    },
    [loadingPresentationPhase],
  );

  const handleCameraInsetRequest = useCallback(
    (request: RegionCardCameraInsetRequest) => {
      if (
        selectedRegionRef.current === null ||
        presentedRegionId !== selectedRegionId ||
        request.convergenceToken !== cardCameraConvergenceToken
      ) {
        return;
      }
      setCardCameraInsetState((current) => {
        const seed =
          current.convergenceToken === request.convergenceToken
            ? current
            : {
                convergenceToken: request.convergenceToken,
                appliedLeftInsetPx: baseReservedLeftPx,
                appliedRightInsetPx: baseReservedRightPx,
                refitRevision: 0,
              };
        const appliedLeftInsetPx = Math.max(
          baseReservedLeftPx,
          seed.appliedLeftInsetPx,
          request.requestedLeftInsetPx,
        );
        const appliedRightInsetPx = Math.max(
          baseReservedRightPx,
          seed.appliedRightInsetPx,
          request.requestedRightInsetPx,
        );
        const insetChanged =
          appliedLeftInsetPx > seed.appliedLeftInsetPx + 0.5 ||
          appliedRightInsetPx > seed.appliedRightInsetPx + 0.5;
        if (!insetChanged && !request.forceRefit) return seed;
        return {
          convergenceToken: request.convergenceToken,
          appliedLeftInsetPx,
          appliedRightInsetPx,
          refitRevision: seed.refitRevision + 1,
        };
      });
    },
    [
      baseReservedRightPx,
      baseReservedLeftPx,
      cardCameraConvergenceToken,
      presentedRegionId,
      selectedRegionId,
    ],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        selectedRegionRef.current === null
      ) {
        return;
      }
      const activeElement = document.activeElement;
      const navigatorOwnsFocus =
        activeElement instanceof HTMLElement &&
        activeElement.closest("[data-region-navigator='true']") !== null;
      const nextRegionId = reduceSelectedRegion(
        selectedRegionRef.current,
        { type: "escape" },
      );
      setCardDismissalMode("keyboard");
      setConvergenceRevision((current) => current + 1);
      selectedRegionRef.current = nextRegionId;
      setSelectedRegionId(nextRegionId);
      setMobileSheetView("index");
      setSelectionFocusIntent(null);
      if (!navigatorOwnsFocus) {
        experienceRef.current?.focus({ preventScroll: true });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useLayoutEffect(() => {
    if (canvasHoverLabelRegion) positionCanvasHoverLabel();
  }, [
    canvasHoverLabelRegion,
    positionCanvasHoverLabel,
    viewport.height,
    viewport.width,
  ]);

  useEffect(
    () => () => {
      if (hoverLabelFrameRef.current !== null) {
        window.cancelAnimationFrame(hoverLabelFrameRef.current);
      }
    },
    [],
  );

  return (
    <main
      ref={experienceRef}
      className="brain-experience relative w-full overflow-hidden bg-[#030407] outline-none"
      aria-label="交互式人脑展览"
      aria-busy={sceneBusy}
      data-mobile-presentation={mobileLayout.active ? "true" : "false"}
      data-mobile-layout-mode={mobileLayout.mode}
      data-mobile-sheet-view={effectiveMobileSheetView}
      data-cutaway-active={cutawayRegionSelected ? "true" : "false"}
      style={experienceStyle}
      tabIndex={-1}
    >
      <div className="scene-aura" aria-hidden="true" />
      <div className="scene-grain" aria-hidden="true" />

      <div
        className="brain-scene-viewport absolute inset-0 z-10"
        data-scene-ready={sceneReady ? "true" : "false"}
        data-scene-presentation={loadingPresentationPhase}
        data-scene-visible={scenePresentationVisible ? "true" : "false"}
        aria-hidden={!sceneInteractive}
        inert={!sceneInteractive ? true : undefined}
        onTransitionEnd={handleSceneTransitionEnd}
      >
        <BrainSceneErrorBoundary
          key={modelAttempt}
          attempt={modelAttempt}
        >
          <BrainScene
            modelAttempt={modelAttempt}
            onInteraction={handleInteraction}
            maximumDpr={mobileLayout.maximumDpr}
            mobilePresentation={mobileLayout.active}
            compactLandscape={
              mobileLayout.mode === "compact-landscape"
            }
            canvasHoveredRegionId={canvasHoveredRegionId}
            hoveredRegionId={hoveredRegionId}
            selectedRegionId={selectedRegionId}
            leaderRegionId={
              !mobileLayout.active && selectedRegionId
                ? presentedRegionId
                : null
            }
            selectionFocusIntent={selectionFocusIntent}
            onRegionHoverChange={handleRegionHoverChange}
            onPointerExit={handlePointerExit}
            onRegionClick={handleRegionClick}
            onBackgroundHover={handleBackgroundHover}
            onBackgroundClick={handleBackgroundClick}
            onCanvasPointerMove={handleCanvasPointerMove}
            regionLeaderRef={regionLeaderRef}
            reservedLeftPx={reservedLeftPx}
            reservedRightPx={reservedRightPx}
            navigatorBaseLeftPx={baseReservedLeftPx}
            cardBaseRightPx={baseReservedRightPx}
            cardCameraConvergenceToken={
              cardCameraConvergenceToken
            }
            cardCameraRefitRevision={cardCameraRefitRevision}
          />
        </BrainSceneErrorBoundary>
      </div>

      <ExhibitLoadingOverlay
        ref={loadingOverlayRef}
        key={modelAttempt}
        attempt={modelAttempt}
        onRetry={handleModelRetry}
        onPresentationPhaseChange={setLoadingPresentationPhase}
      />

      <RegionHoverLabel
        ref={hoverLabelRef}
        region={canvasHoverLabelRegion}
      />

      <BrainCutawayAnnotation
        regionId={selectedRegionId}
        visible={scenePresentationVisible}
      />

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {selectedRegionName
          ? `${selectedRegionName} 已选中。`
          : "未选择脑区。"}
      </p>

      {mobileLayout.active ? (
        <MobileRegionSheet
          key={selectedRegionId ?? "region-index"}
          selectedRegionId={selectedRegionId}
          view={effectiveMobileSheetView}
          layoutMode={mobileLayout.mode}
          onViewChange={setMobileSheetView}
          onSelectRegion={handleNavigatorSelect}
          onHoverRegion={handleNavigatorHover}
          onDismiss={handleCardDismiss}
          returnFocusRef={experienceRef}
        />
      ) : (
        <>
          <RegionInfoLeader
            ref={regionLeaderRef}
            handoffPhase={handoffPhase}
            selectedRegionId={
              selectedRegionId ? presentedRegionId : null
            }
            onCameraInsetRequest={handleCameraInsetRequest}
          />
          <RegionInfoCard
            selectedRegionId={selectedRegionId}
            dismissalMode={cardDismissalMode}
            onDismiss={handleCardDismiss}
            onPresentedRegionChange={setPresentedRegionId}
            onHandoffPhaseChange={setHandoffPhase}
            returnFocusRef={experienceRef}
          />
          <RegionNavigator
            layout={navigatorLayout}
            selectedRegionId={selectedRegionId}
            onSelectRegion={handleNavigatorSelect}
            onHoverRegion={handleNavigatorHover}
          />
        </>
      )}

      <header className="brain-exhibit-header pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between px-6 pt-6 sm:px-10 sm:pt-9 lg:px-14 lg:pt-11">
        <div>
          <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.3em] text-white/58">
            内在图谱
          </p>
          <h1 className="mt-3 text-balance text-[2rem] font-medium leading-none tracking-[-0.058em] text-white/95 sm:text-[2.45rem] lg:text-[2.8rem]">
            爱化身本体大脑
          </h1>
        </div>

        <div className="brain-exhibit-status hidden items-center gap-3.5 pt-1 sm:flex">
          <span className="h-px w-9 bg-gradient-to-r from-transparent to-white/22" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#a8baff] shadow-[0_0_14px_rgba(145,172,255,0.62)]" />
          <p className="font-mono text-[0.78rem] uppercase tracking-[0.18em] text-white/72">
            10个脑区 · 交互式标本
          </p>
        </div>
      </header>

      <div className="brain-exhibit-tagline pointer-events-none absolute bottom-7 left-6 z-20 max-w-[20rem] sm:bottom-9 sm:left-10 lg:bottom-11 lg:left-14">
        <p className="text-pretty text-[0.95rem] font-normal leading-[1.5] tracking-[-0.018em] text-white/72 [text-shadow:0_1px_12px_rgba(0,0,0,0.72)] sm:text-[1.08rem]">
          近距离凝视那个造就你的器官。
        </p>
      </div>

      <div
        className={`brain-orbit-prompt pointer-events-none absolute bottom-8 left-1/2 z-20 hidden items-center gap-3 sm:flex ${
          shouldShowOrbitPrompt
            ? "translate-y-0 opacity-100"
            : "translate-y-2 opacity-0"
        }`}
        aria-hidden="true"
      >
        <span className="orbit-glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <circle
              cx="12"
              cy="12"
              r="2.35"
              fill="currentColor"
            />
            <path
              d="M4.1 10.3C4.9 6.8 8.05 4.2 11.8 4.2c3.35 0 6.23 2.08 7.4 5.02"
              stroke="currentColor"
              strokeWidth="1.45"
              strokeLinecap="round"
            />
            <path
              d="m17.25 8.2 2.35 1.65.7-2.82"
              stroke="currentColor"
              strokeWidth="1.45"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M19.9 13.7c-.8 3.5-3.95 6.1-7.7 6.1-3.35 0-6.23-2.08-7.4-5.02"
              stroke="currentColor"
              strokeWidth="1.45"
              strokeLinecap="round"
            />
            <path
              d="M6.75 15.8 4.4 14.15l-.7 2.82"
              stroke="currentColor"
              strokeWidth="1.45"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="brain-orbit-prompt__label font-mono text-[0.62rem] uppercase tracking-[0.22em] text-white/38">
          <span className="brain-orbit-prompt__desktop">
            拖拽旋转
          </span>
          <span className="brain-orbit-prompt__mobile">
            {mobileOrbitPromptCopy}
          </span>
        </span>
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 left-0 z-30 w-px bg-gradient-to-b from-transparent via-white/8 to-transparent" />
    </main>
  );
}
