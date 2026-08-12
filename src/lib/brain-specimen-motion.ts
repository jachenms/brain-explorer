import type { Point3Tuple } from "./brain-camera";

export type QuaternionTuple = readonly [number, number, number, number];

export type SpecimenTransformSnapshot = {
  position: Point3Tuple;
  quaternion: QuaternionTuple;
  scale: Point3Tuple;
  matrix: readonly number[];
  idleElapsedSeconds: number;
};

export type SpecimenMotionState = {
  locked: boolean;
  idleElapsedSeconds: number;
  savedTransform: SpecimenTransformSnapshot | null;
};

export function createSpecimenMotionState(): SpecimenMotionState {
  return {
    locked: false,
    idleElapsedSeconds: 0,
    savedTransform: null,
  };
}

export function lockSpecimenMotion(
  state: SpecimenMotionState,
  snapshot: SpecimenTransformSnapshot,
) {
  if (state.locked && state.savedTransform) return;
  state.locked = true;
  state.savedTransform = {
    position: [...snapshot.position],
    quaternion: [...snapshot.quaternion],
    scale: [...snapshot.scale],
    matrix: [...snapshot.matrix],
    idleElapsedSeconds: snapshot.idleElapsedSeconds,
  };
  state.idleElapsedSeconds = snapshot.idleElapsedSeconds;
}

export function releaseSpecimenMotion(state: SpecimenMotionState) {
  state.locked = false;
}

export function advanceSpecimenMotionClock(
  state: SpecimenMotionState,
  deltaSeconds: number,
  prefersReducedMotion: boolean,
) {
  if (state.locked) return state.idleElapsedSeconds;
  if (prefersReducedMotion) {
    state.idleElapsedSeconds = 0;
    return 0;
  }
  const delta =
    Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
  state.idleElapsedSeconds += delta;
  return state.idleElapsedSeconds;
}
