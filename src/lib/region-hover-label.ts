export const REGION_HOVER_LABEL_EDGE_PADDING_PX = 12;
export const REGION_HOVER_MARKER_SIZE_PX = 8;
export const REGION_HOVER_LABEL_GAP_PX = 78;
export const REGION_HOVER_WIDE_MARKER_SIZE_PX = 9;
export const REGION_HOVER_WIDE_LABEL_GAP_PX = 96;
export const REGION_HOVER_WIDE_VIEWPORT_PX = 1440;

export type RegionHoverLabelPositionInput = Readonly<{
  pointerX: number;
  pointerY: number;
  labelWidth: number;
  labelHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  markerSizePx?: number;
  labelGapPx?: number;
  edgePaddingPx?: number;
}>;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

export function getRegionHoverLabelPosition({
  pointerX,
  pointerY,
  labelWidth,
  labelHeight,
  viewportWidth,
  viewportHeight,
  markerSizePx = REGION_HOVER_MARKER_SIZE_PX,
  labelGapPx = REGION_HOVER_LABEL_GAP_PX,
  edgePaddingPx = REGION_HOVER_LABEL_EDGE_PADDING_PX,
}: RegionHoverLabelPositionInput) {
  const markerRadius = markerSizePx / 2;
  const markerX = clamp(
    pointerX,
    edgePaddingPx + markerRadius,
    viewportWidth - edgePaddingPx - markerRadius,
  );
  const markerY = clamp(
    pointerY,
    edgePaddingPx + markerRadius,
    viewportHeight - edgePaddingPx - markerRadius,
  );
  const maximumLabelX = Math.max(
    edgePaddingPx,
    viewportWidth - labelWidth - edgePaddingPx,
  );
  const maximumLabelY = Math.max(
    edgePaddingPx,
    viewportHeight - labelHeight - edgePaddingPx,
  );
  const side =
    markerX + labelGapPx + labelWidth <= viewportWidth - edgePaddingPx
      ? ("right" as const)
      : ("left" as const);
  const labelX = clamp(
    side === "right"
      ? markerX + labelGapPx
      : markerX - labelGapPx - labelWidth,
    edgePaddingPx,
    maximumLabelX,
  );
  const labelY = clamp(
    markerY - labelHeight / 2,
    edgePaddingPx,
    maximumLabelY,
  );
  const leaderStartX =
    markerX + (side === "right" ? markerRadius : -markerRadius);
  const leaderEndX =
    side === "right" ? labelX : labelX + labelWidth;
  const leaderEndY = clamp(
    markerY,
    labelY + 6,
    labelY + labelHeight - 6,
  );
  const deltaX = leaderEndX - leaderStartX;
  const deltaY = leaderEndY - markerY;

  return {
    side,
    marker: {
      x: markerX - markerRadius,
      y: markerY - markerRadius,
      size: markerSizePx,
    },
    label: {
      x: labelX,
      y: labelY,
      width: labelWidth,
      height: labelHeight,
    },
    leader: {
      x: leaderStartX,
      y: markerY,
      length: Math.hypot(deltaX, deltaY),
      angleRadians: Math.atan2(deltaY, deltaX),
    },
  };
}
