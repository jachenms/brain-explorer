import type { RegionId } from "./brain-regions";

export const REGION_INFO_CARD_CONTENT_OUT_MS = 160;
export const REGION_INFO_CARD_CONTENT_GAP_MS = 24;
export const REGION_INFO_CARD_CONTENT_IN_MS = 180;
export const REGION_INFO_CARD_CONTENT_FALLBACK_BUFFER_MS = 24;
export const REGION_INFO_CARD_CONTENT_OPACITY_EASING = "linear";
export const REGION_INFO_CARD_CONTENT_HANDOFF_MS =
  REGION_INFO_CARD_CONTENT_OUT_MS +
  REGION_INFO_CARD_CONTENT_GAP_MS +
  REGION_INFO_CARD_CONTENT_IN_MS;
export const REGION_INFO_CARD_EXIT_MS = 240;
export const REGION_INFO_CARD_KEYBOARD_EXIT_MS = 140;

export type RegionInfoCardPresence = "hidden" | "visible" | "exiting";
export type RegionInfoCardContentPhase =
  | "settled"
  | "preparing"
  | "fading-out"
  | "faded-out"
  | "fading-in";

export function getRegionInfoCardHandoffOpacity(
  direction: "outgoing" | "incoming",
  elapsedMilliseconds: number,
) {
  const duration =
    direction === "outgoing"
      ? REGION_INFO_CARD_CONTENT_OUT_MS
      : REGION_INFO_CARD_CONTENT_IN_MS;
  const progress = Math.min(
    1,
    Math.max(0, elapsedMilliseconds / duration),
  );
  return direction === "outgoing" ? 1 - progress : progress;
}

export type RegionInfoCardState = {
  displayedRegionId: RegionId | null;
  targetRegionId: RegionId | null;
  presence: RegionInfoCardPresence;
  contentPhase: RegionInfoCardContentPhase;
  revision: number;
};

export const initialRegionInfoCardState: RegionInfoCardState = {
  displayedRegionId: null,
  targetRegionId: null,
  presence: "hidden",
  contentPhase: "settled",
  revision: 0,
};

export type RegionInfoCardAction =
  | { type: "sync-selection"; regionId: RegionId | null }
  | { type: "start-content-transition"; revision: number }
  | { type: "swap-content"; revision: number }
  | { type: "start-content-reveal"; revision: number }
  | { type: "complete-content-transition"; revision: number }
  | { type: "complete-exit"; revision: number };

export function reduceRegionInfoCardState(
  state: RegionInfoCardState,
  action: RegionInfoCardAction,
): RegionInfoCardState {
  if (action.type === "sync-selection") {
    if (action.regionId === null) {
      if (state.presence === "hidden" || state.presence === "exiting") {
        return state;
      }

      return {
        ...state,
        targetRegionId: null,
        presence: "exiting",
        contentPhase: "settled",
        revision: state.revision + 1,
      };
    }

    if (
      state.targetRegionId === action.regionId &&
      state.presence === "visible"
    ) {
      return state;
    }

    const revision = state.revision + 1;
    if (
      state.displayedRegionId === null ||
      state.displayedRegionId === action.regionId
    ) {
      return {
        displayedRegionId: action.regionId,
        targetRegionId: action.regionId,
        presence: "visible",
        contentPhase: "settled",
        revision,
      };
    }

    if (state.contentPhase === "fading-out") {
      return {
        ...state,
        targetRegionId: action.regionId,
        revision,
      };
    }
    if (state.contentPhase === "faded-out") {
      return {
        ...state,
        displayedRegionId: action.regionId,
        targetRegionId: action.regionId,
        revision,
      };
    }

    return {
      displayedRegionId: state.displayedRegionId,
      targetRegionId: action.regionId,
      presence: "visible",
      contentPhase:
        state.contentPhase === "fading-in" ? "fading-out" : "preparing",
      revision,
    };
  }

  if (action.type === "start-content-transition") {
    if (
      action.revision !== state.revision ||
      state.presence !== "visible" ||
      state.contentPhase !== "preparing" ||
      state.targetRegionId === null
    ) {
      return state;
    }

    return {
      ...state,
      contentPhase: "fading-out",
    };
  }

  if (action.type === "swap-content") {
    if (
      action.revision !== state.revision ||
      state.presence !== "visible" ||
      state.contentPhase !== "fading-out" ||
      state.targetRegionId === null
    ) {
      return state;
    }
    return {
      ...state,
      displayedRegionId: state.targetRegionId,
      contentPhase: "faded-out",
    };
  }

  if (action.type === "start-content-reveal") {
    if (
      action.revision !== state.revision ||
      state.presence !== "visible" ||
      state.contentPhase !== "faded-out" ||
      state.targetRegionId !== state.displayedRegionId
    ) {
      return state;
    }
    return {
      ...state,
      contentPhase: "fading-in",
    };
  }

  if (action.type === "complete-content-transition") {
    if (
      action.revision !== state.revision ||
      state.presence !== "visible" ||
      state.contentPhase !== "fading-in" ||
      state.targetRegionId !== state.displayedRegionId
    ) {
      return state;
    }
    return {
      ...state,
      contentPhase: "settled",
    };
  }

  if (
    action.revision !== state.revision ||
    state.presence !== "exiting" ||
    state.targetRegionId !== null
  ) {
    return state;
  }

  return {
    displayedRegionId: null,
    targetRegionId: null,
    presence: "hidden",
    contentPhase: "settled",
    revision: state.revision,
  };
}
