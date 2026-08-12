"use client";

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type CSSProperties,
} from "react";

import type { BrainRegion } from "@/lib/brain-regions";
import {
  getRegionHoverLabelPosition,
  REGION_HOVER_LABEL_GAP_PX,
  REGION_HOVER_MARKER_SIZE_PX,
  REGION_HOVER_WIDE_LABEL_GAP_PX,
  REGION_HOVER_WIDE_MARKER_SIZE_PX,
  REGION_HOVER_WIDE_VIEWPORT_PX,
} from "@/lib/region-hover-label";

type RegionHoverLabelProps = {
  region: BrainRegion | null;
};

type RegionHoverLabelStyle = CSSProperties & {
  "--region-hover-accent": string;
};

export type RegionHoverLabelHandle = {
  position: (
    pointerX: number,
    pointerY: number,
    viewportWidth: number,
    viewportHeight: number,
  ) => void;
};

export const RegionHoverLabel = forwardRef<
  RegionHoverLabelHandle,
  RegionHoverLabelProps
>(function RegionHoverLabel({ region }, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLSpanElement>(null);
  const leaderRef = useRef<HTMLSpanElement>(null);
  const placardRef = useRef<HTMLDivElement>(null);
  const style: RegionHoverLabelStyle = {
    "--region-hover-accent": region?.color ?? "transparent",
  };

  useImperativeHandle(ref, () => ({
    position: (pointerX, pointerY, viewportWidth, viewportHeight) => {
      const root = rootRef.current;
      const marker = markerRef.current;
      const leader = leaderRef.current;
      const placard = placardRef.current;
      if (!root || !marker || !leader || !placard) return;
      const wide = viewportWidth >= REGION_HOVER_WIDE_VIEWPORT_PX;
      const geometry = getRegionHoverLabelPosition({
        pointerX,
        pointerY,
        labelWidth: placard.offsetWidth,
        labelHeight: placard.offsetHeight,
        viewportWidth,
        viewportHeight,
        markerSizePx: wide
          ? REGION_HOVER_WIDE_MARKER_SIZE_PX
          : REGION_HOVER_MARKER_SIZE_PX,
        labelGapPx: wide
          ? REGION_HOVER_WIDE_LABEL_GAP_PX
          : REGION_HOVER_LABEL_GAP_PX,
      });
      root.dataset.side = geometry.side;
      root.dataset.coordinateSpace = "viewport-fixed";
      root.dataset.placardWidth = String(placard.offsetWidth);
      root.dataset.placardHeight = String(placard.offsetHeight);
      root.dataset.markerSize = String(geometry.marker.size);
      root.dataset.leaderLength = geometry.leader.length.toFixed(2);
      if (root.dataset.ancestryAudited !== "true") {
        let ancestor = root.parentElement;
        const transformedAncestors: string[] = [];
        while (ancestor && ancestor !== document.body) {
          const computed = window.getComputedStyle(ancestor);
          if (
            computed.transform !== "none" ||
            computed.getPropertyValue("scale") !== "none" ||
            (computed.getPropertyValue("zoom") !== "" &&
              computed.getPropertyValue("zoom") !== "1")
          ) {
            transformedAncestors.push(
              ancestor.className || ancestor.tagName.toLowerCase(),
            );
          }
          ancestor = ancestor.parentElement;
        }
        root.dataset.ancestryAudited = "true";
        root.dataset.transformedAncestors =
          transformedAncestors.join("|");
        root.dataset.noScaledAncestor = String(
          transformedAncestors.length === 0,
        );
      }
      marker.style.transform = `translate3d(${geometry.marker.x}px, ${geometry.marker.y}px, 0)`;
      leader.style.width = `${geometry.leader.length}px`;
      leader.style.transform = `translate3d(${geometry.leader.x}px, ${geometry.leader.y}px, 0) rotate(${geometry.leader.angleRadians}rad)`;
      placard.style.transform = `translate3d(${geometry.label.x}px, ${geometry.label.y}px, 0)`;
    },
  }));

  return (
    <div
      ref={rootRef}
      className="region-hover-label-anchor"
      data-region-hover-label="true"
      data-hover-source="canvas"
      data-region-id={region?.id}
      data-visible={region ? "true" : "false"}
      aria-hidden="true"
      style={style}
    >
      <span ref={markerRef} className="region-hover-label__marker-anchor">
        <span className="region-hover-label__marker" />
      </span>
      <span ref={leaderRef} className="region-hover-label__leader-anchor">
        <span className="region-hover-label__leader" />
      </span>
      <div ref={placardRef} className="region-hover-label__placard-anchor">
        <div className="region-hover-label">
          <span className="region-hover-label__eyebrow">Region</span>
          <span className="region-hover-label__name">
            {region?.name ?? ""}
          </span>
        </div>
      </div>
    </div>
  );
});
