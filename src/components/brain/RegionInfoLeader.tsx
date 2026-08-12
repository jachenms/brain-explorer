"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type CSSProperties,
} from "react";

import { BRAIN_REGION_BY_ID, type RegionId } from "@/lib/brain-regions";
import type { RegionInfoCardContentPhase } from "@/lib/region-info-card-state";
import {
  advanceRegionCardCameraConvergence,
  advanceRegionLeaderSettlement,
  buildInternalExtractionOriginTrace,
  buildRegionPairForkGeometry,
  buildRegionDepthOccludedLeader,
  createRegionCardCameraFingerprint,
  evaluateRegionHullCardClearance,
  REGION_INFO_LEADER,
  solveNavigatorCardCameraLayout,
  type NavigatorCardCameraLayout,
  type RegionCardCameraConvergenceState,
  type RegionCardCameraInsetRequest,
  type RegionInfoLeaderHandle,
  type RegionSplitCalloutLayout,
} from "@/lib/region-info-leader";
import { recordBrainTransitionOperation } from "@/lib/brain-transition-performance";

type RegionInfoLeaderProps = {
  selectedRegionId: RegionId | null;
  handoffPhase: RegionInfoCardContentPhase;
  onCameraInsetRequest: (request: RegionCardCameraInsetRequest) => void;
};

type RegionLeaderStyle = CSSProperties & {
  "--region-accent": string;
};

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function fingerprintLabel(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export const RegionInfoLeader = memo(
  forwardRef<RegionInfoLeaderHandle, RegionInfoLeaderProps>(
    function RegionInfoLeader(
      {
        selectedRegionId,
        handoffPhase,
        onCameraInsetRequest,
      },
      ref,
    ) {
      const svgRef = useRef<SVGSVGElement>(null);
      const connectorRef = useRef<SVGPathElement>(null);
      const stemRef = useRef<SVGPathElement>(null);
      const underTissueRef = useRef<SVGPathElement>(null);
      const maskPolygonRef = useRef<SVGPolygonElement>(null);
      const maskRectRef = useRef<SVGRectElement>(null);
      const markerGroupRef = useRef<SVGGElement>(null);
      const forkGroupRef = useRef<SVGGElement>(null);
      const continuityGroupRef = useRef<SVGGElement>(null);
      const extractionTraceRef = useRef<SVGPathElement>(null);
      const extractionOriginRef = useRef<SVGCircleElement>(null);
      const extractionUnderTissueRef = useRef<SVGPathElement>(null);
      const extractionInnerOriginRef = useRef<SVGCircleElement>(null);
      const sectionLabelRef = useRef<SVGTextElement>(null);
      const maskId = `region-leader-mask-${useId().replaceAll(":", "")}`;
      const activeRegionRef = useRef<RegionId | null>(selectedRegionId);
      const lastMarkerPaintRef = useRef(Number.NEGATIVE_INFINITY);
      const convergenceStateRef =
        useRef<RegionCardCameraConvergenceState | null>(null);
      const lastInsetRequestRef = useRef("");
      const insetRequestCountRef = useRef(0);
      const observedCardSizeRef = useRef({ width: 0, height: 0 });
      const cardLayoutRevisionRef = useRef(0);
      const layoutStateRef = useRef<{
        key: string;
        plan: NavigatorCardCameraLayout;
        solution: RegionSplitCalloutLayout;
        settleSamples: number;
        frozen: boolean;
        lastFingerprint: string | null;
        lastSolutionHash: string | null;
        lastHullPoint: { x: number; y: number } | null;
      } | null>(null);

      const resetCardShift = useCallback(() => {
        const card =
          svgRef.current?.parentElement?.querySelector<HTMLElement>(
            ".region-info-card",
          );
        card?.style.setProperty("--region-card-shift-x", "0px");
        card?.style.setProperty("--region-card-shift-y", "0px");
      }, []);

      const hide = useCallback(
        (reason = "inactive") => {
          const svg = svgRef.current;
          if (svg) {
            svg.dataset.visible = "false";
            svg.dataset.connectorVisible = "false";
            svg.dataset.extractionTraceVisible = "false";
            svg.dataset.hideReason = reason;
          }
          if (reason === "no-selection" || reason === "inactive") {
            layoutStateRef.current = null;
            resetCardShift();
          }
        },
        [resetCardShift],
      );

      useLayoutEffect(() => {
        activeRegionRef.current = selectedRegionId;
        layoutStateRef.current = null;
        convergenceStateRef.current = null;
        lastInsetRequestRef.current = "";
        insetRequestCountRef.current = 0;
        lastMarkerPaintRef.current = Number.NEGATIVE_INFINITY;
        if (!selectedRegionId) hide("no-selection");
      }, [hide, selectedRegionId]);

      useLayoutEffect(() => {
        const parent = svgRef.current?.parentElement;
        const card = parent?.querySelector<HTMLElement>(
          ".region-info-card",
        );
        if (!card || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(([entry]) => {
          if (!entry) return;
          const nextSize = {
            // The solver routes to the painted border edge, so consume the
            // border-box dimensions. This read only runs after a resize
            // notification, never in the frame loop.
            width: card.offsetWidth || entry.contentRect.width,
            height: card.offsetHeight || entry.contentRect.height,
          };
          const previousSize = observedCardSizeRef.current;
          if (
            Math.abs(nextSize.width - previousSize.width) <= 0.5 &&
            Math.abs(nextSize.height - previousSize.height) <= 0.5
          ) {
            return;
          }
          observedCardSizeRef.current = nextSize;
          cardLayoutRevisionRef.current += 1;
          layoutStateRef.current = null;
          convergenceStateRef.current = null;
          lastInsetRequestRef.current = "";
          insetRequestCountRef.current = 0;
          if (svgRef.current) {
            svgRef.current.dataset.cardLayoutRevision = String(
              cardLayoutRevisionRef.current,
            );
          }
        });
        observer.observe(card);
        return () => observer.disconnect();
      }, [handoffPhase, selectedRegionId]);

      useImperativeHandle(
        ref,
        () => ({
          hide,
          getLayoutRevision() {
            return cardLayoutRevisionRef.current;
          },
          invalidateLayout(reason) {
            if (reason === "resize" || reason === "card-layout") {
              convergenceStateRef.current = null;
              lastInsetRequestRef.current = "";
              insetRequestCountRef.current = 0;
            }
            const layoutState = layoutStateRef.current;
            if (layoutState) {
              layoutState.frozen = false;
              layoutState.settleSamples = 0;
              layoutState.lastFingerprint = null;
              layoutState.lastSolutionHash = null;
              layoutState.lastHullPoint = null;
            }
            const svg = svgRef.current;
            if (svg) {
              svg.dataset.frozenLayout = "false";
              svg.dataset.settleSamples = "0";
              svg.dataset.invalidationReason = reason;
            }
            const card =
              svg?.parentElement?.querySelector<HTMLElement>(
                ".region-info-card",
              );
            card?.setAttribute("data-callout-layout-frozen", "false");
          },
          reportDiagnostics(diagnostics) {
            const svg = svgRef.current;
            if (!svg) return;
            svg.dataset.registeredRegionCount = String(
              diagnostics.registeredRegionCount,
            );
            svg.dataset.registeredMeshCount = String(
              diagnostics.registeredMeshCount,
            );
            svg.dataset.supportSampleCount = String(
              diagnostics.supportSampleCount,
            );
            svg.dataset.directionalProbeCount = String(
              diagnostics.directionalProbeCount,
            );
            svg.dataset.directionalHitCount = String(
              diagnostics.directionalHitCount,
            );
            svg.dataset.supportGridCount = String(
              diagnostics.supportGridCount,
            );
            for (const [queue, counts] of Object.entries(
              diagnostics.probeQueues,
            )) {
              const prefix = `probe${queue[0].toUpperCase()}${queue.slice(1)}`;
              svg.dataset[`${prefix}Offered`] = String(counts.offered);
              svg.dataset[`${prefix}Deduped`] = String(counts.deduped);
              svg.dataset[`${prefix}Attempted`] = String(counts.attempted);
              svg.dataset[`${prefix}Hit`] = String(counts.hit);
              svg.dataset[`${prefix}Accepted`] = String(counts.accepted);
              svg.dataset[`${prefix}Reserved`] = String(counts.reserved);
              svg.dataset[`${prefix}Borrowed`] = String(counts.borrowed);
            }
            svg.dataset.budgetStopReason = diagnostics.budgetStopReason;
            svg.dataset.everyReservedQueueRan = String(
              diagnostics.everyAvailableReservedQueueRan,
            );
            svg.dataset.supportRegistrationPending = String(
              diagnostics.supportRegistrationPending,
            );
            svg.dataset.raysTested = String(diagnostics.raysTested);
            svg.dataset.visibleHitCount = String(
              diagnostics.visibleHitCount,
            );
            svg.dataset.rejectedResolutionCount = String(
              diagnostics.rejectedResolutionCount,
            );
            svg.dataset.rejectedProxyCount = String(
              diagnostics.rejectedProxyCount,
            );
            svg.dataset.rejectedInvisibleCount = String(
              diagnostics.rejectedInvisibleCount,
            );
            svg.dataset.scanMilliseconds =
              diagnostics.scanMilliseconds.toFixed(3);
            svg.dataset.dirtyTrigger = diagnostics.dirtyTrigger;
            svg.dataset.markerComponents =
              diagnostics.markerComponents.join(";");
            svg.dataset.markerMeshes =
              diagnostics.markerMeshUuids.join(";");
            svg.dataset.markerLocalPoints =
              diagnostics.markerLocalPoints
                .map((point) => point.join(","))
                .join(";");
            svg.dataset.markerWorldPoints =
              diagnostics.markerWorldPoints
                .map((point) => point.join(","))
                .join(";");
            svg.dataset.markerScreenPoints =
              diagnostics.markerScreenPoints
                .map((point) => `${point.x},${point.y}`)
                .join(";");
            svg.dataset.markerClearances =
              diagnostics.markerClearancesPx.join(",");
            svg.dataset.rawMarkerToSilhouetteDistance =
              diagnostics.rawMarkerToSilhouetteDistancePx?.toFixed(2) ?? "";
          },
          updateTarget(update) {
            const svg = svgRef.current;
            const connector = connectorRef.current;
            const stem = stemRef.current;
            const underTissue = underTissueRef.current;
            const maskPolygon = maskPolygonRef.current;
            const maskRect = maskRectRef.current;
            const markerGroup = markerGroupRef.current;
            const forkGroup = forkGroupRef.current;
            const continuityGroup = continuityGroupRef.current;
            const extractionTrace = extractionTraceRef.current;
            const extractionOrigin = extractionOriginRef.current;
            const extractionUnderTissue =
              extractionUnderTissueRef.current;
            const extractionInnerOrigin =
              extractionInnerOriginRef.current;
            const sectionLabel = sectionLabelRef.current;
            if (
              activeRegionRef.current !== update.regionId ||
              !svg ||
              !connector ||
              !stem ||
              !underTissue ||
              !maskPolygon ||
              !maskRect ||
              !markerGroup ||
              !forkGroup ||
              !continuityGroup ||
              !extractionTrace ||
              !extractionOrigin ||
              !extractionUnderTissue ||
              !extractionInnerOrigin ||
              !sectionLabel
            ) {
              hide("region-mismatch");
              return;
            }

            const card =
              svg.parentElement?.querySelector<HTMLElement>(
                ".region-info-card",
              ) ?? null;
            const displayedMarker =
              update.detachedInternal && update.markers.length >= 2
                ? {
                    x:
                      update.markers.reduce(
                        (total, marker) =>
                          total + (marker.groupPoint?.x ?? marker.x),
                        0,
                      ) / update.markers.length,
                    y:
                      update.markers.reduce(
                        (total, marker) =>
                          total + (marker.groupPoint?.y ?? marker.y),
                        0,
                      ) / update.markers.length,
                    componentId: "selected-pair-anchor",
                    meshUuid: "verified-pair",
                    localPoint: [],
                    worldPoint: [],
                    clearancePx: Math.min(
                      ...update.markers.map(
                        (marker) => marker.clearancePx,
                      ),
                    ),
                    radiusPx: REGION_INFO_LEADER.markerInternalRadiusPx,
                    anchorSource: "selected-support" as const,
                    selectedRegion: update.regionId,
                    hullEdgeRegion: update.regionId,
                    markerToFinalExitPx: Math.min(
                      ...update.markers.map(
                        (marker) => marker.markerToFinalExitPx,
                      ),
                    ),
                    residualOccludedGapPx: Math.min(
                      ...update.markers.map(
                        (marker) => marker.residualOccludedGapPx,
                      ),
                    ),
                    resolver: "frontmost-visible-selected" as const,
                  }
                : update.markers[0];
            if (!displayedMarker) {
              hide("marker-offscreen");
              return;
            }
            const now = globalThis.performance?.now() ?? Date.now();
            const shouldPaintMarker =
              now - lastMarkerPaintRef.current >=
                REGION_INFO_LEADER.visibilityResolveIntervalMs ||
              markerGroup.childElementCount !== 1;
            const currentCircle = markerGroup.children[0];
            const activeMarker =
              !shouldPaintMarker && currentCircle
                ? {
                    ...displayedMarker,
                    x: Number(currentCircle.getAttribute("cx")),
                    y: Number(currentCircle.getAttribute("cy")),
                  }
                : displayedMarker;
            const layoutKey = [
              update.regionId,
              update.viewportWidth,
              update.viewportHeight,
              update.detachedInternal ? "internal" : "external",
              `${activeMarker.x.toFixed(0)},${activeMarker.y.toFixed(0)}`,
              `${observedCardSizeRef.current.width.toFixed(0)}x${observedCardSizeRef.current.height.toFixed(0)}`,
              update.silhouette.baseFingerprint ?? "legacy-silhouette",
              update.appliedLeftInsetPx.toFixed(0),
              update.appliedRightInsetPx.toFixed(0),
            ].join(":");
            if (layoutStateRef.current?.key !== layoutKey) {
              const layoutStartedAt = performance.now();
              const plan = solveNavigatorCardCameraLayout({
                viewportWidth: update.viewportWidth,
                viewportHeight: update.viewportHeight,
                baseLeftInsetPx: update.baseLeftInsetPx,
                appliedLeftInsetPx: update.appliedLeftInsetPx,
                appliedRightInsetPx:
                  update.appliedRightInsetPx,
                silhouette: update.silhouette,
                detachedInternal: update.detachedInternal,
                markerCenter: activeMarker,
                selectedRegionId: update.regionId,
                anchorSource: activeMarker.anchorSource,
                cardSize: observedCardSizeRef.current,
              });
              layoutStateRef.current = {
                key: layoutKey,
                plan,
                solution: plan.callout,
                settleSamples: 0,
                frozen: false,
                lastFingerprint: null,
                lastSolutionHash: null,
                lastHullPoint: null,
              };
              recordBrainTransitionOperation(
                "leader-layout-solve",
                performance.now() - layoutStartedAt,
                update.cameraPhase,
              );
            }
            const layoutState = layoutStateRef.current;
            const plan = layoutState.plan;
            const solution = layoutState.solution;
            card?.style.setProperty(
              "--region-card-shift-x",
              `${solution.cardShiftX}px`,
            );
            card?.style.setProperty(
              "--region-card-shift-y",
              `${solution.cardShiftY}px`,
            );

            const currentCardRect = solution.finalCardRect;
            const finalRect = solution.finalCardRect;
            const withinFinalRect = (
              ["left", "top", "right", "bottom"] as const
            ).every(
              (edge) =>
                Math.abs(currentCardRect[edge] - finalRect[edge]) <= 0.5,
            );
            const domCardClearance = evaluateRegionHullCardClearance(
              solution.silhouetteHull,
              currentCardRect,
              solution.requiredCardHullClearancePx,
            );
            const cameraFingerprint = update.cameraFingerprint;
            const hullFingerprint = createRegionCardCameraFingerprint(
              solution.silhouetteHull.flatMap((point) => [
                point.x,
                point.y,
              ]),
            );
            const cardFingerprint = createRegionCardCameraFingerprint([
              finalRect.left,
              finalRect.top,
              finalRect.right,
              finalRect.bottom,
            ]);
            const geometryIntersectionFree =
              !domCardClearance.overlap &&
              !domCardClearance.cardCornerInside &&
              !domCardClearance.hullVertexInside &&
              !domCardClearance.edgeIntersection;
            const geometrySafe =
              geometryIntersectionFree &&
              domCardClearance.safe &&
              plan.safe;
            let convergence = advanceRegionCardCameraConvergence(
              convergenceStateRef.current,
              {
                token: update.convergenceToken,
                baseLeftInsetPx: update.baseLeftInsetPx,
                appliedLeftInsetPx:
                  update.appliedLeftInsetPx,
                requiredLeftInsetPx:
                  plan.requestedLeftInsetPx,
                baseRightInsetPx: update.baseRightInsetPx,
                appliedRightInsetPx: update.appliedRightInsetPx,
                requiredRightInsetPx:
                  plan.requestedRightInsetPx,
                cameraPhase: update.cameraPhase,
                geometrySafe,
              },
            );
            const insetAligned =
              Math.abs(
                convergence.requestedLeftInsetPx -
                  update.appliedLeftInsetPx,
              ) <= 0.5 &&
              Math.abs(
                convergence.requestedRightInsetPx -
                  update.appliedRightInsetPx,
              ) <= 0.5;
            const sampleFingerprint = [
              update.convergenceToken,
              cameraFingerprint,
              hullFingerprint,
              cardFingerprint,
              solution.solutionHash,
            ].join(":");
            const settlement = advanceRegionLeaderSettlement(
              {
                fingerprint: layoutState.lastFingerprint,
                solutionHash: layoutState.lastSolutionHash,
                hullClosestPoint: layoutState.lastHullPoint,
                samples: layoutState.settleSamples,
                frozen: layoutState.frozen,
              },
              {
                fingerprint: sampleFingerprint,
                solutionHash: solution.solutionHash,
                hullClosestPoint: solution.hullClosestPoint,
                domWithinHalfPixel: withinFinalRect,
                domHullClearanceValid: domCardClearance.safe,
                cameraSettled: update.cameraPhase === "focused",
                insetAligned,
                geometryIntersectionFree:
                  geometryIntersectionFree && plan.safe,
              },
            );
            if (settlement.frozen) {
              convergence = {
                ...convergence,
                status: "converged",
                reason: "two-matching-safe-coupled-samples",
              };
            }
            convergenceStateRef.current = convergence;
            const shouldRequestRefit =
              (convergence.status === "refit-requested" ||
                convergence.status === "overlap-invalidated" ||
                convergence.status === "iteration-cap") &&
              convergence.iteration <= 3;
            const requestFingerprint = [
              update.convergenceToken,
              convergence.iteration,
              convergence.requestedLeftInsetPx.toFixed(2),
              convergence.requestedRightInsetPx.toFixed(2),
              convergence.status,
            ].join(":");
            if (
              shouldRequestRefit &&
              insetRequestCountRef.current < 1 &&
              requestFingerprint !== lastInsetRequestRef.current
            ) {
              insetRequestCountRef.current += 1;
              lastInsetRequestRef.current = requestFingerprint;
              onCameraInsetRequest({
                convergenceToken: update.convergenceToken,
                requestedLeftInsetPx:
                  convergence.requestedLeftInsetPx,
                requestedRightInsetPx:
                  convergence.requestedRightInsetPx,
                iteration: convergence.iteration,
                status: convergence.status,
                forceRefit:
                  convergence.status === "overlap-invalidated" ||
                  convergence.status === "iteration-cap",
                requestFingerprint,
              });
            }
            layoutState.settleSamples = settlement.samples;
            layoutState.frozen = settlement.frozen;
            layoutState.lastFingerprint = settlement.fingerprint;
            layoutState.lastSolutionHash = settlement.solutionHash;
            layoutState.lastHullPoint = settlement.hullClosestPoint;
            card?.setAttribute(
              "data-callout-layout-frozen",
              String(layoutState.frozen),
            );
            card?.setAttribute(
              "data-hull-clearance-valid",
              String(domCardClearance.safe),
            );
            const geometry = buildRegionDepthOccludedLeader({
              solution,
              currentCardRect: layoutState.frozen
                ? solution.finalCardRect
                : currentCardRect,
              markerCenter: activeMarker,
              viewportWidth: update.viewportWidth,
              viewportHeight: update.viewportHeight,
              detachedInternal: update.detachedInternal,
              highResidualFallback:
                activeMarker.anchorSource === "selected-support" &&
                update.regionId === "frontal-lobe",
            });
            const markerToFinalExitPx = geometry.underTissueLengthPx;
            const residualOccludedGapPx = Math.max(
              0,
              markerToFinalExitPx - geometry.stemLengthPx,
            );
            const continuityTickLength =
              residualOccludedGapPx > 4 &&
                residualOccludedGapPx <= 32
                ? Math.min(4, residualOccludedGapPx / 2)
                : 0;
            const cardContactPoint = {
              x: currentCardRect.left,
              y: geometry.cardEndpoint.y,
            };
            const elbowX = Math.min(
              cardContactPoint.x - 18,
              Math.max(
                activeMarker.x + 36,
                cardContactPoint.x - 68,
              ),
            );
            const continuousElbowPath = [
              `M ${activeMarker.x.toFixed(2)} ${activeMarker.y.toFixed(2)}`,
              `L ${elbowX.toFixed(2)} ${activeMarker.y.toFixed(2)}`,
              `L ${elbowX.toFixed(2)} ${cardContactPoint.y.toFixed(2)}`,
              `L ${cardContactPoint.x.toFixed(2)} ${cardContactPoint.y.toFixed(2)}`,
            ].join(" ");
            connector.setAttribute("d", continuousElbowPath);
            stem.setAttribute("d", "");
            underTissue.setAttribute("d", "");
            maskRect.setAttribute("width", String(update.viewportWidth));
            maskRect.setAttribute("height", String(update.viewportHeight));
            maskPolygon.setAttribute(
              "points",
              solution.silhouetteHull
                .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
                .join(" "),
            );
            maskPolygon.setAttribute(
              "stroke-width",
              String(REGION_INFO_LEADER.maskExpansionPx * 2),
            );
            const forkGeometry = buildRegionPairForkGeometry({
              center: activeMarker,
              targets: update.detachedInternal
                ? update.markers.slice(0, 2).map((target) => ({
                    point: target.groupPoint ?? target,
                    componentId: target.componentId,
                    resolver: target.resolver,
                  }))
                : [],
            });
            const forkMetrics = forkGeometry.arms.map(
              (arm, index) => {
                  let path = forkGroup.children[index];
                  if (!path) {
                    path = document.createElementNS(
                      SVG_NAMESPACE,
                      "path",
                    );
                    path.setAttribute(
                      "class",
                      "region-info-leader__fork-arm",
                    );
                    forkGroup.append(path);
                  }
                  path.setAttribute(
                    "d",
                    arm.path,
                  );
                  path.setAttribute(
                    "data-component-id",
                    arm.componentId,
                  );
                  return {
                    componentId: arm.componentId,
                    endpoint: arm.endpoint,
                    length: arm.lengthPx,
                    gap: arm.surfaceGapPx,
                  };
                },
            );
            while (forkGroup.childElementCount > forkMetrics.length) {
              forkGroup.lastElementChild?.remove();
            }
            const extractionOriginGeometry =
              buildInternalExtractionOriginTrace({
                origin:
                  update.detachedInternal && update.extractionOrigin?.reliable
                    ? update.extractionOrigin.point
                    : null,
                specimenHull: update.specimenSilhouette.hull,
                extractedTargets: update.detachedInternal
                  ? update.markers.map(
                      (marker) => marker.groupPoint ?? marker,
                    )
                  : [],
                cardRect: currentCardRect,
                progress: update.extractionOrigin?.progress ?? 0,
              });
            extractionTrace.setAttribute(
              "d",
              extractionOriginGeometry.path,
            );
            extractionUnderTissue.setAttribute(
              "d",
              extractionOriginGeometry.underTissuePath,
            );
            if (extractionOriginGeometry.source) {
              extractionOrigin.setAttribute(
                "cx",
                extractionOriginGeometry.source.x.toFixed(2),
              );
              extractionOrigin.setAttribute(
                "cy",
                extractionOriginGeometry.source.y.toFixed(2),
              );
              extractionOrigin.setAttribute(
                "r",
                String(REGION_INFO_LEADER.extractionOriginRadiusPx),
              );
            }
            if (extractionOriginGeometry.innerSource) {
              extractionInnerOrigin.setAttribute(
                "cx",
                extractionOriginGeometry.innerSource.x.toFixed(2),
              );
              extractionInnerOrigin.setAttribute(
                "cy",
                extractionOriginGeometry.innerSource.y.toFixed(2),
              );
              extractionInnerOrigin.setAttribute(
                "r",
                String(REGION_INFO_LEADER.extractionInnerOriginRadiusPx),
              );
            }
            const continuityTickOffsets = continuityTickLength
              ? [
                  geometry.stemLengthPx,
                  Math.max(
                    geometry.stemLengthPx,
                    markerToFinalExitPx - continuityTickLength,
                  ),
                ]
              : [];
            continuityTickOffsets.forEach((offset, index) => {
              let tick = continuityGroup.children[index];
              if (!tick) {
                tick = document.createElementNS(SVG_NAMESPACE, "path");
                tick.setAttribute(
                  "class",
                  "region-info-leader__continuity-tick",
                );
                continuityGroup.append(tick);
              }
              tick.setAttribute("d", geometry.fullPath);
              tick.setAttribute(
                "stroke-dasharray",
                `0 ${offset.toFixed(2)} ${continuityTickLength.toFixed(2)} ${geometry.fullCurveLengthPx.toFixed(2)}`,
              );
            });
            while (
              continuityGroup.childElementCount >
              continuityTickOffsets.length
            ) {
              continuityGroup.lastElementChild?.remove();
            }

            if (shouldPaintMarker) {
              while (
                markerGroup.childElementCount < 1
              ) {
                const marker = document.createElementNS(
                  SVG_NAMESPACE,
                  "circle",
                );
                marker.setAttribute(
                  "class",
                  "region-info-leader__marker",
                );
                markerGroup.append(marker);
              }
              while (
                markerGroup.childElementCount > update.markers.length
              ) {
                markerGroup.lastElementChild?.remove();
              }
              const circle = markerGroup.children[0];
              circle.setAttribute("cx", displayedMarker.x.toFixed(2));
              circle.setAttribute("cy", displayedMarker.y.toFixed(2));
              circle.setAttribute(
                "r",
                displayedMarker.radiusPx.toFixed(2),
              );
              circle.setAttribute(
                "data-component-id",
                displayedMarker.componentId,
              );
              circle.setAttribute(
                "data-anchor-kind",
                update.detachedInternal
                  ? "selected-pair-anchor"
                  : "verified-tissue-hit",
              );
              lastMarkerPaintRef.current = now;
            }

            svg.setAttribute(
              "viewBox",
              `0 0 ${update.viewportWidth} ${update.viewportHeight}`,
            );
            if (update.detachedInternal) {
              sectionLabel.textContent = "IN SITU · X-RAY";
              sectionLabel.style.display = "";
              const labelWidth = Math.max(
                sectionLabel.getComputedTextLength(),
                104,
              );
              const labelX = Math.min(
                cardContactPoint.x - labelWidth - 18,
                Math.max(
                  activeMarker.x + 52,
                  elbowX - labelWidth - 10,
                ),
              );
              const labelY = cardContactPoint.y - 11;
              const targetClearance = Math.hypot(
                Math.max(
                  activeMarker.x - (labelX + labelWidth),
                  labelX - activeMarker.x,
                  0,
                ),
                Math.max(
                  activeMarker.y - labelY,
                  labelY - activeMarker.y,
                  0,
                ),
              );
              const cardClearance =
                cardContactPoint.x - (labelX + labelWidth);
              const labelHasClearance =
                targetClearance >= 42 &&
                cardClearance >= 14 &&
                labelX >= 14 &&
                labelY >= 20 &&
                labelY <= update.viewportHeight - 18;
              sectionLabel.setAttribute(
                "x",
                labelX.toFixed(2),
              );
              sectionLabel.setAttribute(
                "y",
                labelY.toFixed(2),
              );
              sectionLabel.style.display = labelHasClearance
                ? ""
                : "none";
              svg.dataset.sectionLabelClearance = Math.min(
                targetClearance,
                cardClearance,
              ).toFixed(2);
              svg.dataset.sectionLabelVisible = String(
                labelHasClearance,
              );
            } else {
              sectionLabel.textContent = "";
              sectionLabel.style.display = "none";
              svg.dataset.sectionLabelClearance = "";
              svg.dataset.sectionLabelVisible = "false";
            }
            svg.dataset.sectionTreatment = update.detachedInternal
              ? "whole-specimen-xray"
              : "surface-anchor";
            svg.dataset.calloutMode = "depth-occluded-anchor";
            svg.dataset.visible = "true";
            const endpointToCardDistancePx = Math.abs(
              cardContactPoint.x - currentCardRect.left,
            );
            const targetMarkerErrorPx = geometry.anchorErrorPx;
            const connectorVisible =
              geometry.visible &&
              endpointToCardDistancePx <= 1 &&
              targetMarkerErrorPx <= 0.5;
            svg.dataset.connectorVisible = String(connectorVisible);
            svg.dataset.endpointToCardDistance =
              endpointToCardDistancePx.toFixed(2);
            svg.dataset.targetMarkerError =
              targetMarkerErrorPx.toFixed(2);
            svg.dataset.connectivityValid = String(
              endpointToCardDistancePx <= 1 &&
                targetMarkerErrorPx <= 0.5,
            );
            svg.dataset.routeSegments = "3";
            svg.dataset.routeGap = "0";
            svg.dataset.extractionTraceVisible = String(
              extractionOriginGeometry.visible,
            );
            svg.dataset.extractionTraceReason =
              extractionOriginGeometry.reason;
            svg.dataset.extractionTraceLength =
              extractionOriginGeometry.lengthPx.toFixed(2);
            svg.dataset.extractionUnderTissueLength =
              extractionOriginGeometry.underTissueLengthPx.toFixed(2);
            svg.dataset.extractionSourceHullError =
              extractionOriginGeometry.sourceHullErrorPx.toFixed(2);
            svg.dataset.extractionSourcePoint =
              extractionOriginGeometry.source
                ? `${extractionOriginGeometry.source.x.toFixed(2)},${extractionOriginGeometry.source.y.toFixed(2)}`
                : "";
            svg.dataset.extractionInnerSourcePoint =
              extractionOriginGeometry.innerSource
                ? `${extractionOriginGeometry.innerSource.x.toFixed(2)},${extractionOriginGeometry.innerSource.y.toFixed(2)}`
                : "";
            svg.dataset.extractionInnerSourceInsideHull = String(
              extractionOriginGeometry.innerSourceInsideHull,
            );
            svg.dataset.extractionInnerSourceDepth =
              extractionOriginGeometry.innerSourceDepthPx.toFixed(2);
            svg.dataset.extractionEndpoint =
              extractionOriginGeometry.endpoint
                ? `${extractionOriginGeometry.endpoint.x.toFixed(2)},${extractionOriginGeometry.endpoint.y.toFixed(2)}`
                : "";
            svg.dataset.extractionTargetPoint =
              extractionOriginGeometry.target
                ? `${extractionOriginGeometry.target.x.toFixed(2)},${extractionOriginGeometry.target.y.toFixed(2)}`
                : "";
            svg.dataset.extractionWorldOrigin =
              update.extractionOrigin?.worldPoint.join(",") ?? "";
            svg.dataset.extractionProgress = (
              update.extractionOrigin?.progress ?? 0
            ).toFixed(3);
            svg.dataset.extractionAnatomyIntrusion = String(
              extractionOriginGeometry.anatomyIntrusion,
            );
            svg.dataset.extractionUiIntrusion = String(
              extractionOriginGeometry.uiIntrusion,
            );
            svg.dataset.connectorReason = geometry.reason;
            svg.dataset.connectorLength =
              geometry.visibleOutsideLengthPx.toFixed(2);
            svg.dataset.connectorChordLength = Math.hypot(
              geometry.cardEndpoint.x - geometry.pathStart.x,
              geometry.cardEndpoint.y - geometry.pathStart.y,
            ).toFixed(2);
            svg.dataset.connectorCurveLength =
              geometry.fullCurveLengthPx.toFixed(2);
            svg.dataset.connectorSegmentCount = String(
              geometry.segmentCount,
            );
            svg.dataset.connectorElbows = String(geometry.elbows);
            svg.dataset.connectorInflections = String(
              geometry.inflections,
            );
            svg.dataset.connectorCurveDeviation =
              geometry.curveDeviationPx.toFixed(2);
            svg.dataset.connectorStroke = String(
              REGION_INFO_LEADER.connectorStrokeWidthPx,
            );
            svg.dataset.connectorOpacity = String(
              REGION_INFO_LEADER.connectorOpacity,
            );
            svg.dataset.fullGap = solution.fullGapPx.toFixed(2);
            svg.dataset.distanceToHull =
              solution.distanceToHullPx.toFixed(2);
            svg.dataset.pathStart = [
              geometry.pathStart.x,
              geometry.pathStart.y,
            ]
              .map((value) => value.toFixed(2))
              .join(",");
            svg.dataset.markerCenter = [
              geometry.markerCenter.x,
              geometry.markerCenter.y,
            ]
              .map((value) => value.toFixed(2))
              .join(",");
            svg.dataset.anchorError = geometry.anchorErrorPx.toFixed(3);
            svg.dataset.cardEndpoint = [
              geometry.cardEndpoint.x,
              geometry.cardEndpoint.y,
            ]
              .map((value) => value.toFixed(2))
              .join(",");
            svg.dataset.fullCurve = geometry.fullPath;
            svg.dataset.stemLength = geometry.stemLengthPx.toFixed(2);
            svg.dataset.stemTangent = [
              geometry.stemTangent.x,
              geometry.stemTangent.y,
            ]
              .map((value) => value.toFixed(4))
              .join(",");
            svg.dataset.maskSource = update.silhouette.source;
            svg.dataset.maskExpansion =
              geometry.maskExpansionPx.toFixed(2);
            svg.dataset.maskHull = maskPolygon.getAttribute("points") ?? "";
            svg.dataset.finalHullExit = geometry.finalHullExit
              ? `${geometry.finalHullExit.x.toFixed(2)},${geometry.finalHullExit.y.toFixed(2)}`
              : "";
            svg.dataset.visibleOutsideLength =
              geometry.visibleOutsideLengthPx.toFixed(2);
            svg.dataset.finalExitT =
              geometry.finalExitT?.toFixed(6) ?? "";
            svg.dataset.underTissueLength =
              geometry.underTissueLengthPx.toFixed(2);
            svg.dataset.underTissueOpacity =
              geometry.underTissueOpacity.toFixed(2);
            svg.dataset.underTissueVisible = String(
              geometry.underTissueVisible,
            );
            svg.dataset.outsideCap = geometry.outsideCapPx.toFixed(2);
            svg.dataset.splitTangentError =
              geometry.splitTangentError.toFixed(6);
            svg.dataset.suppressionReason = geometry.suppressionReason;
            svg.dataset.anatomyInkLength =
              geometry.anatomyInkLengthPx.toFixed(2);
            svg.dataset.samePathIdentity = String(
              geometry.samePathIdentity,
            );
            svg.dataset.cardShiftX = solution.cardShiftX.toFixed(2);
            svg.dataset.cardShiftY = solution.cardShiftY.toFixed(2);
            svg.dataset.cardHullClearance =
              solution.cardHullClearancePx.toFixed(2);
            svg.dataset.requiredCardHullClearance =
              solution.requiredCardHullClearancePx.toFixed(2);
            svg.dataset.cardHullOverlap = String(
              solution.cardHullOverlap,
            );
            svg.dataset.cardCornerInside = String(
              solution.cardCornerInside,
            );
            svg.dataset.cardHullVertexInside = String(
              solution.cardHullVertexInside,
            );
            svg.dataset.cardEdgeIntersection = String(
              solution.cardEdgeIntersection,
            );
            svg.dataset.domCardHullClearance =
              domCardClearance.clearancePx.toFixed(2);
            svg.dataset.domCardHullOverlap = String(
              domCardClearance.overlap,
            );
            svg.dataset.domCardCornerInside = String(
              domCardClearance.cardCornerInside,
            );
            svg.dataset.domCardHullVertexInside = String(
              domCardClearance.hullVertexInside,
            );
            svg.dataset.domCardEdgeIntersection = String(
              domCardClearance.edgeIntersection,
            );
            svg.dataset.frozenLayout = String(layoutState.frozen);
            svg.dataset.settleSamples = String(
              Math.min(2, layoutState.settleSamples),
            );
            svg.dataset.baseCardRect = [
              solution.baseCardRect.left,
              solution.baseCardRect.top,
              solution.baseCardRect.right,
              solution.baseCardRect.bottom,
            ]
              .map((value) => value.toFixed(2))
              .join(",");
            svg.dataset.finalCardRect = [
              solution.finalCardRect.left,
              solution.finalCardRect.top,
              solution.finalCardRect.right,
              solution.finalCardRect.bottom,
            ]
              .map((value) => value.toFixed(2))
              .join(",");
            svg.dataset.cameraPhase = update.cameraPhase;
            svg.dataset.requestedLeftInset =
              convergence.requestedLeftInsetPx.toFixed(2);
            svg.dataset.appliedLeftInset =
              update.appliedLeftInsetPx.toFixed(2);
            svg.dataset.baseLeftInset =
              convergence.baseLeftInsetPx.toFixed(2);
            svg.dataset.dynamicLeftInset =
              convergence.dynamicLeftInsetPx.toFixed(2);
            svg.dataset.requestedRightInset =
              convergence.requestedRightInsetPx.toFixed(2);
            svg.dataset.appliedRightInset =
              update.appliedRightInsetPx.toFixed(2);
            svg.dataset.baseRightInset =
              convergence.baseRightInsetPx.toFixed(2);
            svg.dataset.dynamicRightInset =
              convergence.dynamicRightInsetPx.toFixed(2);
            svg.dataset.convergenceIteration = String(
              convergence.iteration,
            );
            svg.dataset.convergenceStatus = convergence.status;
            svg.dataset.convergenceReason = convergence.reason;
            svg.dataset.convergenceToken = update.convergenceToken;
            svg.dataset.cameraFingerprint = fingerprintLabel(
              cameraFingerprint,
            );
            svg.dataset.hullSolutionFingerprint =
              fingerprintLabel(hullFingerprint);
            svg.dataset.cardSolutionFingerprint =
              fingerprintLabel(cardFingerprint);
            svg.dataset.coupledSolutionFingerprint =
              fingerprintLabel(sampleFingerprint);
            svg.dataset.usableLane = [
              update.appliedLeftInsetPx,
              update.viewportWidth - update.appliedRightInsetPx,
            ]
              .map((value) => value.toFixed(2))
              .join(",");
            svg.dataset.projectedHullBounds = [
              update.silhouette.bounds.left,
              update.silhouette.bounds.top,
              update.silhouette.bounds.right,
              update.silhouette.bounds.bottom,
            ]
              .map((value) => value.toFixed(2))
              .join(",");
            svg.dataset.anatomyIndexGap =
              plan.measuredNavigatorGapPx.toFixed(2);
            svg.dataset.anatomyCardGap = (
              finalRect.left - update.silhouette.bounds.right
            ).toFixed(2);
            svg.dataset.anatomyTopGap =
              update.silhouette.bounds.top.toFixed(2);
            svg.dataset.anatomyBottomGap = (
              update.viewportHeight -
              update.silhouette.bounds.bottom
            ).toFixed(2);
            svg.dataset.rightInsetFloor =
              plan.rightInsetFloorPx.toFixed(2);
            svg.dataset.connectorCardAdjustment = [
              plan.connectorCardAdjustment.x,
              plan.connectorCardAdjustment.y,
            ]
              .map((value) => value.toFixed(2))
              .join(",");
            svg.dataset.connectorPlacementAttempts = String(
              plan.connectorCardAdjustment.attempts,
            );
            svg.dataset.initialConnectorOutsideLength =
              plan.initialConnectorOutsideLengthPx.toFixed(2);
            svg.dataset.initialCardHullClearance =
              plan.initialCardHullClearancePx.toFixed(2);
            svg.dataset.uiCollisions =
              plan.uiCollisions.join(",");
            svg.dataset.safetyVector = Object.entries(plan.safety)
              .map(
                ([gate, passed]) =>
                  `${gate}:${passed ? "true" : "false"}`,
              )
              .join(",");
            svg.dataset.safetyAllPassed = String(plan.safe);
            svg.dataset.cardJunctionY =
              solution.cardJunctionPoint.y.toFixed(2);
            svg.dataset.cardJunctionPoint = [
              solution.cardJunctionPoint.x,
              solution.cardJunctionPoint.y,
            ]
              .map((value) => value.toFixed(2))
              .join(",");
            svg.dataset.hullClosestPoint = [
              solution.hullClosestPoint.x,
              solution.hullClosestPoint.y,
            ]
              .map((value) => value.toFixed(2))
              .join(",");
            svg.dataset.outwardNormal = [
              solution.outwardNormal.x,
              solution.outwardNormal.y,
            ]
              .map((value) => value.toFixed(4))
              .join(",");
            svg.dataset.solverStatus = solution.solverStatus;
            svg.dataset.solutionHash =
              fingerprintLabel(solution.solutionHash);
            svg.dataset.hullClosestRegion =
              solution.hullClosestContributor?.regionId ?? "";
            svg.dataset.hullClosestRole =
              solution.hullClosestContributor?.role ?? "";
            svg.dataset.hullClosestMember =
              solution.hullClosestContributor?.stableId ?? "";
            svg.dataset.silhouetteSource = update.silhouette.source;
            svg.dataset.hullFingerprint =
              fingerprintLabel(sampleFingerprint);
            svg.dataset.silhouetteContributors = [
              ...(update.silhouette.contributors ?? []),
            ]
              .sort((first, second) => {
                const firstSelected =
                  first.stableId ===
                  solution.hullClosestContributor?.stableId;
                const secondSelected =
                  second.stableId ===
                  solution.hullClosestContributor?.stableId;
                return firstSelected === secondSelected
                  ? first.stableId.localeCompare(second.stableId)
                  : firstSelected
                    ? -1
                    : 1;
              })
              .map((contributor) =>
                [
                  contributor.stableId,
                  contributor.regionId,
                  contributor.role,
                  contributor.cardFacingScreenX.toFixed(2),
                  contributor.cardFacingWorldPoint
                    .map((value) => value.toFixed(4))
                    .join("/"),
                  contributor.visible ? "visible" : "hidden",
                  contributor.frustumValid ? "frustum" : "culled",
                  contributor.materialOpacity.toFixed(3),
                  contributor.materialTransparent
                    ? "transparent"
                    : "opaque",
                  contributor.materialDepthWrite
                    ? "depth-write"
                    : "no-depth-write",
                  contributor.sourceKind,
                  contributor.portal ? "portal" : "not-portal",
                  contributor.proxy ? "proxy" : "not-proxy",
                  contributor.extraction
                    ? "extraction"
                    : "not-extraction",
                  contributor.helper ? "helper" : "not-helper",
                ].join("|"),
              )
              .join(";");
            svg.dataset.anatomyIntersection = String(
              geometry.anatomyIntersection,
            );
            svg.dataset.uiIntersection = String(geometry.uiIntersection);
            svg.dataset.cardBorderGap = geometry.cardGapPx.toFixed(2);
            svg.dataset.markerCount = "1";
            svg.dataset.verifiedComponentCount = String(
              update.markers.length,
            );
            svg.dataset.anchorKind = update.detachedInternal
              ? "selected-pair-anchor"
              : "verified-tissue-hit";
            svg.dataset.anchorSource = activeMarker.anchorSource;
            svg.dataset.selectedRegion = activeMarker.selectedRegion;
            svg.dataset.hullEdgeRegion =
              activeMarker.hullEdgeRegion ??
              solution.hullClosestContributor?.regionId ??
              "";
            svg.dataset.markerToFinalExit =
              markerToFinalExitPx.toFixed(2);
            svg.dataset.residualOccludedGap =
              residualOccludedGapPx.toFixed(2);
            svg.dataset.continuityTickLengths =
              continuityTickLength > 0
                ? `${continuityTickLength.toFixed(2)},${continuityTickLength.toFixed(2)}`
                : "0,0";
            svg.dataset.resolver = activeMarker.resolver;
            svg.dataset.forkArmEndpoints = forkMetrics
              .map(
                (metric) =>
                  `${metric.endpoint.x.toFixed(2)},${metric.endpoint.y.toFixed(2)}`,
              )
              .join(";");
            svg.dataset.forkArmComponents = forkMetrics
              .map((metric) => metric.componentId)
              .join(";");
            svg.dataset.forkArmLengths = forkMetrics
              .map((metric) => metric.length.toFixed(2))
              .join(",");
            svg.dataset.forkArmGaps = forkMetrics
              .map((metric) => metric.gap.toFixed(2))
              .join(",");
            svg.dataset.forkArmSymmetry = forkMetrics.length === 2
              ? forkGeometry.symmetryErrorPx.toFixed(2)
              : "";
            svg.dataset.forkArmIntersections = "false";
            svg.dataset.markerError = "0";
            svg.dataset.markerUpdateRateLimit = "15";
            svg.dataset.verifiedCandidateCount = String(
              update.verifiedCandidateCount,
            );
            svg.dataset.markerPoints =
              `${activeMarker.x.toFixed(2)},${activeMarker.y.toFixed(2)}`;
            svg.dataset.verifiedComponentPoints = update.markers
              .map((marker) => `${marker.x.toFixed(2)},${marker.y.toFixed(2)}`)
              .join(";");
            svg.dataset.markerComponents = displayedMarker.componentId;
            svg.dataset.verifiedComponents = update.markers
              .map((marker) => marker.componentId)
              .join(";");
            svg.dataset.markerClearances = update.markers
              .map((marker) => marker.clearancePx.toFixed(2))
              .join(",");
            svg.dataset.rawMarkerToSilhouetteDistance =
              update.rawMarkerToSilhouetteDistancePx.toFixed(2);
            svg.dataset.regionId = update.regionId;
            delete svg.dataset.hideReason;
            delete svg.dataset.invalidationReason;
          },
        }),
        [hide, onCameraInsetRequest],
      );

      const style: RegionLeaderStyle = {
        "--region-accent":
          (selectedRegionId
            ? BRAIN_REGION_BY_ID.get(selectedRegionId)?.color
            : null) ?? "#a8baff",
      };

      return (
        <svg
          ref={svgRef}
          className="region-info-leader"
          style={style}
          data-visible="false"
          data-connector-visible="false"
          data-callout-mode="depth-occluded-anchor"
          data-content-phase={handoffPhase}
          data-region-id={selectedRegionId ?? undefined}
          aria-hidden="true"
          focusable="false"
          preserveAspectRatio="none"
        >
          <defs>
            <mask
              id={maskId}
              maskUnits="userSpaceOnUse"
              maskContentUnits="userSpaceOnUse"
            >
              <rect ref={maskRectRef} x="0" y="0" fill="white" />
              <polygon
                ref={maskPolygonRef}
                fill="black"
                stroke="black"
                strokeLinejoin="round"
              />
            </mask>
          </defs>
          <path
            ref={underTissueRef}
            className="region-info-leader__under-tissue"
          />
          <path
            ref={stemRef}
            className="region-info-leader__stem"
          />
          <path
            ref={connectorRef}
            className="region-info-leader__connector"
          />
          <path
            ref={extractionUnderTissueRef}
            className="region-info-leader__extraction-under-tissue"
          />
          <circle
            ref={extractionInnerOriginRef}
            className="region-info-leader__extraction-inner-origin"
          />
          <path
            ref={extractionTraceRef}
            className="region-info-leader__extraction-trace"
          />
          <circle
            ref={extractionOriginRef}
            className="region-info-leader__extraction-origin"
          />
          <g
            ref={forkGroupRef}
            className="region-info-leader__pair-fork"
          />
          <g
            ref={continuityGroupRef}
            className="region-info-leader__continuity"
          />
          <g ref={markerGroupRef} className="region-info-leader__markers" />
          <text
            ref={sectionLabelRef}
            className="region-info-leader__section-label"
          />
        </svg>
      );
    },
  ),
);
