export const BRAIN_DRAG_THRESHOLD_CSS_PX = 6;

export type BrainPointerOrigin = {
  startX: number;
  startY: number;
};

export type BrainGestureState = {
  activePointers: Readonly<Record<number, BrainPointerOrigin>>;
  gestureDetected: boolean;
  suppressNextClick: boolean;
};

export type BrainCameraGestureSignal = {
  activePointerCount: number;
  interruptRevision: number;
};

export type BrainGestureAction =
  | {
      type: "pointer-down";
      pointerId: number;
      x: number;
      y: number;
    }
  | {
      type: "pointer-move";
      pointerId: number;
      x: number;
      y: number;
    }
  | { type: "pointer-up"; pointerId: number }
  | { type: "pointer-cancel"; pointerId: number }
  | { type: "pointer-cancel-all" }
  | { type: "consume-click" };

export const initialBrainGestureState: BrainGestureState = {
  activePointers: {},
  gestureDetected: false,
  suppressNextClick: false,
};

export const initialBrainCameraGestureSignal: BrainCameraGestureSignal = {
  activePointerCount: 0,
  interruptRevision: 0,
};

export function getActivePointerCount(state: BrainGestureState) {
  return Object.keys(state.activePointers).length;
}

export function syncBrainCameraGestureSignal(
  signal: BrainCameraGestureSignal,
  previous: BrainGestureState,
  next: BrainGestureState,
): BrainCameraGestureSignal {
  return {
    activePointerCount: getActivePointerCount(next),
    interruptRevision:
      !previous.gestureDetected && next.gestureDetected
        ? signal.interruptRevision + 1
        : signal.interruptRevision,
  };
}

export function signalBrainCameraWheel(
  signal: BrainCameraGestureSignal,
): BrainCameraGestureSignal {
  return {
    ...signal,
    interruptRevision: signal.interruptRevision + 1,
  };
}

export function reduceBrainGesture(
  state: BrainGestureState,
  action: BrainGestureAction,
): BrainGestureState {
  if (action.type === "pointer-down") {
    const activePointerCount = getActivePointerCount(state);
    const continuingGesture = activePointerCount > 0;
    const activePointers = continuingGesture ? state.activePointers : {};
    return {
      activePointers: {
        ...activePointers,
        [action.pointerId]: { startX: action.x, startY: action.y },
      },
      gestureDetected: continuingGesture,
      suppressNextClick: continuingGesture ? true : false,
    };
  }
  if (action.type === "pointer-move") {
    const origin = state.activePointers[action.pointerId];
    if (!origin) return state;
    const distance = Math.hypot(
      action.x - origin.startX,
      action.y - origin.startY,
    );
    return distance >= BRAIN_DRAG_THRESHOLD_CSS_PX
      ? {
          ...state,
          gestureDetected: true,
          suppressNextClick: true,
        }
      : state;
  }
  if (
    (action.type === "pointer-up" || action.type === "pointer-cancel") &&
    state.activePointers[action.pointerId]
  ) {
    const activePointers = { ...state.activePointers };
    delete activePointers[action.pointerId];
    return {
      ...state,
      activePointers,
      suppressNextClick:
        state.suppressNextClick ||
        state.gestureDetected ||
        action.type === "pointer-cancel",
    };
  }
  if (action.type === "pointer-cancel-all") {
    return {
      ...state,
      activePointers: {},
      suppressNextClick:
        state.suppressNextClick ||
        state.gestureDetected ||
        getActivePointerCount(state) > 0,
    };
  }
  if (action.type === "consume-click") {
    return { ...state, suppressNextClick: false };
  }
  return state;
}
