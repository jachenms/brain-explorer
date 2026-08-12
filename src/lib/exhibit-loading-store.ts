export type ExhibitAssetPhase =
  | "booting"
  | "fetching"
  | "mapping"
  | "ready"
  | "error";

export type ExhibitLoadingSnapshot = Readonly<{
  attempt: number;
  phase: ExhibitAssetPhase;
  loadedBytes: number;
  totalBytes: number | null;
  updatedAt: number;
  errorReason: string | null;
}>;

const INITIAL_EXHIBIT_LOADING_SNAPSHOT: ExhibitLoadingSnapshot = {
  attempt: 0,
  phase: "booting",
  loadedBytes: 0,
  totalBytes: null,
  updatedAt: 0,
  errorReason: null,
};

let snapshot = INITIAL_EXHIBIT_LOADING_SNAPSHOT;
const listeners = new Set<() => void>();

function now() {
  return globalThis.performance?.now() ?? Date.now();
}

function publish(next: ExhibitLoadingSnapshot) {
  if (
    next.attempt === snapshot.attempt &&
    next.phase === snapshot.phase &&
    next.loadedBytes === snapshot.loadedBytes &&
    next.totalBytes === snapshot.totalBytes &&
    next.errorReason === snapshot.errorReason
  ) {
    return;
  }
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function subscribeToExhibitLoading(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getExhibitLoadingSnapshot() {
  return snapshot;
}

export function getServerExhibitLoadingSnapshot() {
  return INITIAL_EXHIBIT_LOADING_SNAPSHOT;
}

export function getExhibitSceneReadySnapshot() {
  return snapshot.phase === "ready";
}

export function getServerExhibitSceneReadySnapshot() {
  return false;
}

export function getExhibitSceneBusySnapshot() {
  return (
    snapshot.phase === "booting" ||
    snapshot.phase === "fetching" ||
    snapshot.phase === "mapping"
  );
}

export function getServerExhibitSceneBusySnapshot() {
  return true;
}

export function beginExhibitLoadingAttempt(attempt: number) {
  if (!Number.isInteger(attempt) || attempt < 0) return;
  publish({
    attempt,
    phase: "booting",
    loadedBytes: 0,
    totalBytes: null,
    updatedAt: now(),
    errorReason: null,
  });
}

export function reportExhibitAssetTransfer(
  attempt: number,
  loadedBytes: number,
  totalBytes: number | null,
) {
  if (attempt !== snapshot.attempt || snapshot.phase === "ready") return;
  const safeLoadedBytes = Number.isFinite(loadedBytes)
    ? Math.max(0, Math.floor(loadedBytes))
    : 0;
  const safeTotalBytes =
    totalBytes !== null && Number.isFinite(totalBytes) && totalBytes > 0
      ? Math.max(safeLoadedBytes, Math.floor(totalBytes))
      : null;
  publish({
    attempt,
    phase: "fetching",
    loadedBytes: safeLoadedBytes,
    totalBytes: safeTotalBytes,
    updatedAt: now(),
    errorReason: null,
  });
}

export function reportExhibitAssetMapping(
  attempt: number,
  loadedBytes: number,
  totalBytes: number | null,
) {
  if (attempt !== snapshot.attempt || snapshot.phase === "ready") return;
  publish({
    attempt,
    phase: "mapping",
    loadedBytes: Math.max(0, Math.floor(loadedBytes)),
    totalBytes:
      totalBytes !== null && Number.isFinite(totalBytes) && totalBytes > 0
        ? Math.floor(totalBytes)
        : null,
    updatedAt: now(),
    errorReason: null,
  });
}

export function reportExhibitSceneReady(attempt: number) {
  if (attempt !== snapshot.attempt) return;
  publish({
    ...snapshot,
    phase: "ready",
    updatedAt: now(),
    errorReason: null,
  });
}

export function reportExhibitAssetError(
  attempt: number,
  error: unknown,
) {
  if (attempt !== snapshot.attempt || snapshot.phase === "ready") return;
  const errorReason =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "标本资源无法准备就绪。";
  publish({
    ...snapshot,
    phase: "error",
    updatedAt: now(),
    errorReason,
  });
}
