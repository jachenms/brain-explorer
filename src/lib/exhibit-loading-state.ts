export const EXHIBIT_LOADING_TIMING = {
  appearanceDelayMs: 180,
  minimumVisibleMs: 320,
  reducedMotionMinimumVisibleMs: 140,
  contentExitMs: 160,
  reducedMotionContentExitMs: 100,
  sceneEnterMs: 360,
  reducedMotionSceneEnterMs: 140,
  stallTimeoutMs: 30_000,
} as const;

export type ExhibitLoadingPresentationPhase =
  | "waiting"
  | "visible"
  | "content-exiting"
  | "scene-entering"
  | "hidden"
  | "error";

export type ExhibitLoadingPresentationState = Readonly<{
  attempt: number;
  phase: ExhibitLoadingPresentationPhase;
  startedAt: number;
  visibleAt: number | null;
  readyAt: number | null;
}>;

export type ExhibitLoadingPresentationEvent =
  | { type: "restart"; attempt: number; now: number }
  | { type: "appearance-delay-elapsed"; attempt: number; now: number }
  | { type: "asset-ready"; attempt: number; now: number }
  | { type: "minimum-visible-elapsed"; attempt: number; now: number }
  | { type: "content-exit-elapsed"; attempt: number; now: number }
  | { type: "scene-enter-elapsed"; attempt: number; now: number }
  | { type: "asset-error"; attempt: number; now: number }
  | { type: "stall-timeout"; attempt: number; now: number };

export function getExhibitLoadingTiming(prefersReducedMotion: boolean) {
  return {
    appearanceDelayMs: EXHIBIT_LOADING_TIMING.appearanceDelayMs,
    minimumVisibleMs: prefersReducedMotion
      ? EXHIBIT_LOADING_TIMING.reducedMotionMinimumVisibleMs
      : EXHIBIT_LOADING_TIMING.minimumVisibleMs,
    contentExitMs: prefersReducedMotion
      ? EXHIBIT_LOADING_TIMING.reducedMotionContentExitMs
      : EXHIBIT_LOADING_TIMING.contentExitMs,
    sceneEnterMs: prefersReducedMotion
      ? EXHIBIT_LOADING_TIMING.reducedMotionSceneEnterMs
      : EXHIBIT_LOADING_TIMING.sceneEnterMs,
    stallTimeoutMs: EXHIBIT_LOADING_TIMING.stallTimeoutMs,
  } as const;
}

export function createExhibitLoadingPresentationState(
  attempt: number,
  now: number,
): ExhibitLoadingPresentationState {
  return {
    attempt,
    phase: "waiting",
    startedAt: now,
    visibleAt: null,
    readyAt: null,
  };
}

export function reduceExhibitLoadingPresentation(
  state: ExhibitLoadingPresentationState,
  event: ExhibitLoadingPresentationEvent,
  prefersReducedMotion = false,
): ExhibitLoadingPresentationState {
  if (event.type === "restart") {
    if (event.attempt === state.attempt && state.phase === "waiting") {
      return state;
    }
    return createExhibitLoadingPresentationState(event.attempt, event.now);
  }

  if (event.attempt !== state.attempt) return state;

  if (event.type === "asset-error" || event.type === "stall-timeout") {
    if (state.phase === "hidden") return state;
    return {
      ...state,
      phase: "error",
      readyAt: null,
    };
  }

  if (event.type === "appearance-delay-elapsed") {
    if (state.phase !== "waiting") return state;
    return {
      ...state,
      phase: "visible",
      visibleAt: event.now,
    };
  }

  if (event.type === "asset-ready") {
    if (state.phase === "waiting") {
      return {
        ...state,
        phase: "hidden",
        readyAt: event.now,
      };
    }
    if (state.phase !== "visible") return state;
    const visibleAt = state.visibleAt ?? event.now;
    const minimumVisibleMs =
      getExhibitLoadingTiming(prefersReducedMotion).minimumVisibleMs;
    return {
      ...state,
      phase:
        event.now - visibleAt >= minimumVisibleMs
          ? "content-exiting"
          : "visible",
      readyAt: event.now,
    };
  }

  if (event.type === "minimum-visible-elapsed") {
    if (state.phase !== "visible" || state.readyAt === null) return state;
    return {
      ...state,
      phase: "content-exiting",
    };
  }

  if (event.type === "content-exit-elapsed") {
    if (state.phase !== "content-exiting") return state;
    return {
      ...state,
      phase: "scene-entering",
    };
  }

  if (event.type === "scene-enter-elapsed") {
    if (state.phase !== "scene-entering") return state;
    return {
      ...state,
      phase: "hidden",
    };
  }

  return state;
}
