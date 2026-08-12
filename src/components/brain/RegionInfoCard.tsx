"use client";

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type TransitionEvent as ReactTransitionEvent,
} from "react";

import {
  BRAIN_REGION_BY_ID,
  formatBrainRegionDisplayDescription,
  type RegionId,
} from "@/lib/brain-regions";
import {
  initialRegionInfoCardState,
  reduceRegionInfoCardState,
  REGION_INFO_CARD_CONTENT_FALLBACK_BUFFER_MS,
  REGION_INFO_CARD_CONTENT_GAP_MS,
  REGION_INFO_CARD_CONTENT_IN_MS,
  REGION_INFO_CARD_CONTENT_OUT_MS,
  REGION_INFO_CARD_EXIT_MS,
  REGION_INFO_CARD_KEYBOARD_EXIT_MS,
  type RegionInfoCardContentPhase,
} from "@/lib/region-info-card-state";

export type RegionInfoCardDismissalMode = "standard" | "keyboard";

type RegionInfoCardProps = {
  selectedRegionId: RegionId | null;
  dismissalMode: RegionInfoCardDismissalMode;
  onDismiss: () => void;
  onPresentedRegionChange: (regionId: RegionId | null) => void;
  onHandoffPhaseChange: (phase: RegionInfoCardContentPhase) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
};

type RegionAccentStyle = CSSProperties & {
  "--region-accent": string;
};

type RegionInfoCardContentProps = {
  regionId: RegionId;
  headingId?: string;
  descriptionId?: string;
};

function RegionInfoCardContent({
  regionId,
  headingId,
  descriptionId,
}: RegionInfoCardContentProps) {
  const region = BRAIN_REGION_BY_ID.get(regionId);
  if (!region) return null;
  const style: RegionAccentStyle = {
    "--region-accent": region.color,
  };

  return (
    <div
      className="region-info-card__layer"
      style={style}
    >
      <div className="region-info-card__topline" aria-hidden="true">
        <span className="region-info-card__selected-dot" />
        <span className="region-info-card__eyebrow">当前选中脑区</span>
      </div>

      <div className="region-info-card__content">
        <h2 id={headingId} className="region-info-card__heading">
          {region.name}
        </h2>
        <p id={descriptionId} className="region-info-card__description">
          {formatBrainRegionDisplayDescription(region.description)}
        </p>
      </div>
    </div>
  );
}

export const RegionInfoCard = memo(function RegionInfoCard({
  selectedRegionId,
  dismissalMode,
  onDismiss,
  onPresentedRegionChange,
  onHandoffPhaseChange,
  returnFocusRef,
}: RegionInfoCardProps) {
  const headingId = useId();
  const descriptionId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [cardState, dispatch] = useReducer(
    reduceRegionInfoCardState,
    initialRegionInfoCardState,
  );
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(media.matches);
    updatePreference();
    media.addEventListener("change", updatePreference);
    return () => media.removeEventListener("change", updatePreference);
  }, []);

  useLayoutEffect(() => {
    dispatch({ type: "sync-selection", regionId: selectedRegionId });
  }, [selectedRegionId]);

  useEffect(() => {
    if (
      selectedRegionId === null &&
      document.activeElement === closeButtonRef.current
    ) {
      returnFocusRef.current?.focus({ preventScroll: true });
    }
  }, [returnFocusRef, selectedRegionId]);

  useEffect(() => {
    if (cardState.contentPhase !== "preparing") return;
    const revision = cardState.revision;
    if (prefersReducedMotion) {
      dispatch({ type: "start-content-transition", revision });
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      dispatch({ type: "start-content-transition", revision });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    cardState.contentPhase,
    cardState.revision,
    prefersReducedMotion,
  ]);

  useEffect(() => {
    if (cardState.contentPhase !== "fading-out") return;
    const revision = cardState.revision;
    if (prefersReducedMotion) {
      dispatch({ type: "swap-content", revision });
      return;
    }
    const timeout = window.setTimeout(
      () => dispatch({ type: "swap-content", revision }),
      REGION_INFO_CARD_CONTENT_OUT_MS +
        REGION_INFO_CARD_CONTENT_FALLBACK_BUFFER_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [
    cardState.contentPhase,
    cardState.revision,
    prefersReducedMotion,
  ]);

  useEffect(() => {
    if (cardState.contentPhase !== "faded-out") return;
    const revision = cardState.revision;
    if (prefersReducedMotion) {
      dispatch({ type: "start-content-reveal", revision });
      return;
    }
    const startedAt = performance.now();
    let frame = 0;
    const waitForHiddenGap = (now: number) => {
      if (now - startedAt >= REGION_INFO_CARD_CONTENT_GAP_MS) {
        dispatch({ type: "start-content-reveal", revision });
        return;
      }
      frame = window.requestAnimationFrame(waitForHiddenGap);
    };
    frame = window.requestAnimationFrame(waitForHiddenGap);
    return () => window.cancelAnimationFrame(frame);
  }, [
    cardState.contentPhase,
    cardState.revision,
    prefersReducedMotion,
  ]);

  useEffect(() => {
    if (cardState.contentPhase !== "fading-in") return;
    const revision = cardState.revision;
    if (prefersReducedMotion) {
      dispatch({ type: "complete-content-transition", revision });
      return;
    }
    const timeout = window.setTimeout(
      () => dispatch({ type: "complete-content-transition", revision }),
      REGION_INFO_CARD_CONTENT_IN_MS +
        REGION_INFO_CARD_CONTENT_FALLBACK_BUFFER_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [
    cardState.contentPhase,
    cardState.revision,
    prefersReducedMotion,
  ]);

  useLayoutEffect(() => {
    onPresentedRegionChange(cardState.displayedRegionId);
  }, [cardState.displayedRegionId, onPresentedRegionChange]);

  useLayoutEffect(() => {
    onHandoffPhaseChange(cardState.contentPhase);
  }, [cardState.contentPhase, onHandoffPhaseChange]);

  useEffect(() => {
    if (cardState.presence !== "exiting") return;
    const revision = cardState.revision;
    const duration =
      dismissalMode === "keyboard"
        ? REGION_INFO_CARD_KEYBOARD_EXIT_MS
        : REGION_INFO_CARD_EXIT_MS;
    const timeout = window.setTimeout(() => {
      dispatch({ type: "complete-exit", revision });
    }, duration);
    return () => window.clearTimeout(timeout);
  }, [cardState.presence, cardState.revision, dismissalMode]);

  const handleDismiss = useCallback(() => {
    returnFocusRef.current?.focus({ preventScroll: true });
    onDismiss();
  }, [onDismiss, returnFocusRef]);

  const handleContentTransitionEnd = useCallback(
    (event: ReactTransitionEvent<HTMLElement>) => {
      if (
        event.propertyName !== "opacity" ||
        !(event.target instanceof HTMLElement) ||
        !event.target.classList.contains("region-info-card__layer")
      ) {
        return;
      }
      const revision = cardState.revision;
      if (
        cardState.contentPhase === "fading-out" &&
        event.elapsedTime * 1000 >=
          REGION_INFO_CARD_CONTENT_OUT_MS - 16
      ) {
        dispatch({ type: "swap-content", revision });
      } else if (
        cardState.contentPhase === "fading-in" &&
        event.elapsedTime * 1000 >=
          REGION_INFO_CARD_CONTENT_IN_MS - 16
      ) {
        dispatch({ type: "complete-content-transition", revision });
      }
    },
    [cardState.contentPhase, cardState.revision],
  );

  const isInteractive = selectedRegionId !== null;
  const displayedRegionId =
    cardState.displayedRegionId ?? selectedRegionId;
  const accessibleRegionId = displayedRegionId;
  const accessibleRegion = accessibleRegionId
    ? BRAIN_REGION_BY_ID.get(accessibleRegionId)
    : null;
  const selectedRegion = selectedRegionId
    ? BRAIN_REGION_BY_ID.get(selectedRegionId)
    : null;
  const visualPresence = isInteractive
    ? "visible"
    : displayedRegionId
      ? "exiting"
      : "hidden";
  const style: RegionAccentStyle = {
    "--region-accent":
      accessibleRegion?.color ??
      selectedRegion?.color ??
      "#a8baff",
  };

  return (
    <aside
      className="region-info-card"
      style={style}
      data-presence={visualPresence}
      data-content-phase={cardState.contentPhase}
      data-dismissal-mode={dismissalMode}
      data-handoff-revision={cardState.revision}
      data-region-id={accessibleRegionId ?? undefined}
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      aria-live="off"
      aria-hidden={!isInteractive}
      inert={isInteractive ? undefined : true}
      onTransitionEnd={handleContentTransitionEnd}
    >
      {displayedRegionId ? (
        <RegionInfoCardContent
          key={displayedRegionId}
          regionId={displayedRegionId}
          headingId={headingId}
          descriptionId={descriptionId}
        />
      ) : null}

      <button
        ref={closeButtonRef}
        className="region-info-card__close"
        type="button"
        aria-label={`取消选择 ${
          selectedRegion?.name ?? accessibleRegion?.name ?? "脑区"
        }`}
        disabled={!isInteractive}
        tabIndex={isInteractive ? 0 : -1}
        onClick={handleDismiss}
      >
        <svg
          viewBox="0 0 16 16"
          width="16"
          height="16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4.25 4.25 11.75 11.75M11.75 4.25 4.25 11.75"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </aside>
  );
});
