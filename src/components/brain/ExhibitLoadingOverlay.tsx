"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useReducer,
  useSyncExternalStore,
  type CSSProperties,
  type TransitionEvent,
} from "react";

import {
  getExhibitLoadingSnapshot,
  getServerExhibitLoadingSnapshot,
  subscribeToExhibitLoading,
} from "@/lib/exhibit-loading-store";
import {
  createExhibitLoadingPresentationState,
  getExhibitLoadingTiming,
  reduceExhibitLoadingPresentation,
  type ExhibitLoadingPresentationEvent,
} from "@/lib/exhibit-loading-state";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

type ExhibitLoadingOverlayProps = Readonly<{
  attempt: number;
  onRetry: () => void;
  onPresentationPhaseChange: (
    phase: ReturnType<typeof createExhibitLoadingPresentationState>["phase"],
  ) => void;
}>;

export type ExhibitLoadingOverlayHandle = {
  completeSceneEntrance: () => void;
};

type ProgressStyle = CSSProperties & {
  "--exhibit-load-progress": number;
};

function now() {
  return globalThis.performance?.now() ?? Date.now();
}

export const ExhibitLoadingOverlay = forwardRef<
  ExhibitLoadingOverlayHandle,
  ExhibitLoadingOverlayProps
>(function ExhibitLoadingOverlay(
  { attempt, onRetry, onPresentationPhaseChange },
  ref,
) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const asset = useSyncExternalStore(
    subscribeToExhibitLoading,
    getExhibitLoadingSnapshot,
    getServerExhibitLoadingSnapshot,
  );
  const reducer = useCallback(
    (
      state: ReturnType<typeof createExhibitLoadingPresentationState>,
      event: ExhibitLoadingPresentationEvent,
    ) =>
      reduceExhibitLoadingPresentation(
        state,
        event,
        prefersReducedMotion,
      ),
    [prefersReducedMotion],
  );
  const [presentation, dispatch] = useReducer(
    reducer,
    undefined,
    () => createExhibitLoadingPresentationState(attempt, now()),
  );
  const timing = getExhibitLoadingTiming(prefersReducedMotion);

  useImperativeHandle(
    ref,
    () => ({
      completeSceneEntrance: () => {
        dispatch({
          type: "scene-enter-elapsed",
          attempt: presentation.attempt,
          now: now(),
        });
      },
    }),
    [presentation.attempt],
  );

  useEffect(() => {
    onPresentationPhaseChange(presentation.phase);
  }, [onPresentationPhaseChange, presentation.phase]);

  useEffect(() => {
    dispatch({ type: "restart", attempt, now: now() });
  }, [attempt]);

  useEffect(() => {
    if (asset.attempt !== presentation.attempt) return;
    if (asset.phase === "ready") {
      dispatch({
        type: "asset-ready",
        attempt: asset.attempt,
        now: now(),
      });
    } else if (asset.phase === "error") {
      dispatch({
        type: "asset-error",
        attempt: asset.attempt,
        now: now(),
      });
    }
  }, [asset.attempt, asset.phase, presentation.attempt]);

  useEffect(() => {
    if (presentation.phase === "waiting") {
      const remaining = Math.max(
        0,
        presentation.startedAt + timing.appearanceDelayMs - now(),
      );
      const timeout = window.setTimeout(() => {
        dispatch({
          type: "appearance-delay-elapsed",
          attempt: presentation.attempt,
          now: now(),
        });
      }, remaining);
      return () => window.clearTimeout(timeout);
    }

    if (
      presentation.phase === "visible" &&
      presentation.readyAt !== null
    ) {
      const visibleAt = presentation.visibleAt ?? presentation.readyAt;
      const remaining = Math.max(
        0,
        visibleAt + timing.minimumVisibleMs - now(),
      );
      const timeout = window.setTimeout(() => {
        dispatch({
          type: "minimum-visible-elapsed",
          attempt: presentation.attempt,
          now: now(),
        });
      }, remaining);
      return () => window.clearTimeout(timeout);
    }

    if (presentation.phase === "content-exiting") {
      const timeout = window.setTimeout(() => {
        dispatch({
          type: "content-exit-elapsed",
          attempt: presentation.attempt,
          now: now(),
        });
      }, timing.contentExitMs + 80);
      return () => window.clearTimeout(timeout);
    }

    if (presentation.phase === "scene-entering") {
      const timeout = window.setTimeout(() => {
        dispatch({
          type: "scene-enter-elapsed",
          attempt: presentation.attempt,
          now: now(),
        });
      }, timing.sceneEnterMs + 80);
      return () => window.clearTimeout(timeout);
    }

    return undefined;
  }, [
    presentation.attempt,
    presentation.phase,
    presentation.readyAt,
    presentation.startedAt,
    presentation.visibleAt,
    timing.appearanceDelayMs,
    timing.contentExitMs,
    timing.minimumVisibleMs,
    timing.sceneEnterMs,
  ]);

  useEffect(() => {
    if (
      presentation.phase === "hidden" ||
      presentation.phase === "error" ||
      asset.phase === "ready" ||
      asset.phase === "error" ||
      asset.attempt !== presentation.attempt
    ) {
      return;
    }
    const activityAt =
      asset.updatedAt > 0 ? asset.updatedAt : presentation.startedAt;
    const remaining = Math.max(
      0,
      activityAt + timing.stallTimeoutMs - now(),
    );
    const timeout = window.setTimeout(() => {
      dispatch({
        type: "stall-timeout",
        attempt: presentation.attempt,
        now: now(),
      });
    }, remaining);
    return () => window.clearTimeout(timeout);
  }, [
    asset.attempt,
    asset.phase,
    asset.updatedAt,
    presentation.attempt,
    presentation.phase,
    presentation.startedAt,
    timing.stallTimeoutMs,
  ]);

  const handleStageTransitionEnd = useCallback(
    (event: TransitionEvent<HTMLDivElement>) => {
      if (
        event.target !== event.currentTarget ||
        event.propertyName !== "opacity" ||
        presentation.phase !== "content-exiting"
      ) {
        return;
      }
      dispatch({
        type: "content-exit-elapsed",
        attempt: presentation.attempt,
        now: now(),
      });
    },
    [presentation.attempt, presentation.phase],
  );

  if (presentation.phase === "hidden") return null;

  const error = presentation.phase === "error";
  const knownProgress =
    asset.totalBytes !== null &&
    asset.totalBytes > 0 &&
    asset.loadedBytes >= 0;
  const progress = knownProgress
    ? Math.min(1, asset.loadedBytes / asset.totalBytes!)
    : 0;
  const mapping = asset.phase === "mapping";
  const ready = asset.phase === "ready";
  const statusCopy = error
    ? "标本加载失败…"
    : ready
      ? "标本就绪…"
      : mapping
        ? "映射脑区…"
        : "准备标本…";
  const progressStyle: ProgressStyle = {
    "--exhibit-load-progress": progress,
  };
  return (
    <div
      className="exhibit-loading-overlay"
      data-exhibit-loader="true"
      data-loader-state={presentation.phase}
      data-asset-phase={asset.phase}
      data-attempt={presentation.attempt}
      data-progress-known={knownProgress ? "true" : "false"}
      data-progress={knownProgress ? progress.toFixed(4) : undefined}
      aria-busy={!error && !ready}
    >
      <div
        className="exhibit-loading-overlay__stage"
        onTransitionEnd={handleStageTransitionEnd}
      >
        <div className="exhibit-registration-mark" aria-hidden="true">
          <span className="exhibit-registration-mark__axis exhibit-registration-mark__axis--horizontal" />
          <span className="exhibit-registration-mark__axis exhibit-registration-mark__axis--vertical" />
          <span className="exhibit-registration-mark__center" />
        </div>

        <div
          className="exhibit-loading-overlay__status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <p className="exhibit-loading-overlay__eyebrow">
            Atlas registration
          </p>
          <p className="exhibit-loading-overlay__message">
            {statusCopy}
          </p>
        </div>

        {error ? (
          <div className="exhibit-loading-overlay__recovery">
            <p>
              Check the connection, then prepare the specimen again.
            </p>
            <button type="button" onClick={onRetry}>
              Retry Specimen
            </button>
          </div>
        ) : (
          <div
            className="exhibit-loading-overlay__progress"
            style={progressStyle}
            role="progressbar"
            aria-label="标本传输进度"
            aria-valuemin={knownProgress ? 0 : undefined}
            aria-valuemax={knownProgress ? 100 : undefined}
            aria-valuenow={
              knownProgress ? Math.round(progress * 100) : undefined
            }
            aria-valuetext={
              knownProgress
                ? `${Math.round(progress * 100)}% transferred`
                : "传输中…"
            }
          >
            <span
              className="exhibit-loading-overlay__progress-value"
              data-indeterminate={knownProgress ? "false" : "true"}
            />
          </div>
        )}
      </div>
    </div>
  );
});
