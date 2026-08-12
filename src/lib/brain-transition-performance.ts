import type { RegionId } from "./brain-regions";

export type BrainTransitionScenario =
  | "cold-click"
  | "warm-click"
  | "region-switch"
  | "navigator-select"
  | "internal-select";

type TransitionOperation = Readonly<{
  name: string;
  durationMs: number;
  regionId: RegionId | null;
  scenario: BrainTransitionScenario | null;
  timestamp: number;
  detail?: string;
}>;

type TransitionFrame = Readonly<{
  rafDeltaMs: number;
  applicationWorkMs: number;
  regionId: RegionId | null;
  scenario: BrainTransitionScenario | null;
  phase: string;
  timestamp: number;
}>;

const MAX_OPERATIONS = 256;
const MAX_FRAMES = 1024;
const operations: TransitionOperation[] = [];
const frames: TransitionFrame[] = [];
let activeRegionId: RegionId | null = null;
let activeScenario: BrainTransitionScenario | null = null;

function pushBounded<T>(target: T[], value: T, maximum: number) {
  target.push(value);
  if (target.length > maximum) target.splice(0, target.length - maximum);
}

function percentile(values: readonly number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = values.toSorted((first, second) => first - second);
  return sorted[
    Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))
  ];
}

export function beginBrainTransitionScenario(
  scenario: BrainTransitionScenario,
  regionId: RegionId,
) {
  activeScenario = scenario;
  activeRegionId = regionId;
}

export function clearBrainTransitionScenario() {
  activeScenario = null;
  activeRegionId = null;
}

export function recordBrainTransitionOperation(
  name: string,
  durationMs: number,
  detail?: string,
) {
  pushBounded(
    operations,
    {
      name,
      durationMs,
      regionId: activeRegionId,
      scenario: activeScenario,
      timestamp: performance.now(),
      detail,
    },
    MAX_OPERATIONS,
  );
}

export function recordBrainTransitionFrame(
  rafDeltaMs: number,
  applicationWorkMs: number,
  phase: string,
) {
  pushBounded(
    frames,
    {
      rafDeltaMs,
      applicationWorkMs,
      regionId: activeRegionId,
      scenario: activeScenario,
      phase,
      timestamp: performance.now(),
    },
    MAX_FRAMES,
  );
}

export function getBrainTransitionPerformanceSnapshot() {
  const summarize = (values: readonly number[]) => ({
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: values.length ? Math.max(...values) : 0,
    over5ms: values.filter((value) => value > 5).length,
    over8_33ms: values.filter((value) => value > 8.33).length,
    over16_67ms: values.filter((value) => value > 16.67).length,
    over33ms: values.filter((value) => value > 33).length,
  });
  return {
    measurementNote:
      "rAF delta is display/vsync paced; applicationWorkMs measures instrumented camera-loop CPU only.",
    activeScenario,
    activeRegionId,
    operationSummary: Object.fromEntries(
      [...new Set(operations.map((operation) => operation.name))].map(
        (name) => [
          name,
          summarize(
            operations
              .filter((operation) => operation.name === name)
              .map((operation) => operation.durationMs),
          ),
        ],
      ),
    ),
    applicationFrames: summarize(
      frames.map((frame) => frame.applicationWorkMs),
    ),
    rafFrames: summarize(frames.map((frame) => frame.rafDeltaMs),
    ),
    operations: [...operations],
    frames: [...frames],
  };
}

export function resetBrainTransitionPerformance() {
  operations.length = 0;
  frames.length = 0;
  clearBrainTransitionScenario();
}

declare global {
  interface Window {
    __BRAIN_TRANSITION_PERFORMANCE__?: {
      snapshot: typeof getBrainTransitionPerformanceSnapshot;
      reset: typeof resetBrainTransitionPerformance;
    };
  }
}

if (typeof window !== "undefined") {
  window.__BRAIN_TRANSITION_PERFORMANCE__ = {
    snapshot: getBrainTransitionPerformanceSnapshot,
    reset: resetBrainTransitionPerformance,
  };
}
