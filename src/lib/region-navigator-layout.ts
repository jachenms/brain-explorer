const clamp = (minimum: number, value: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export const REGION_NAVIGATOR_LAYOUT = {
  minimumViewportWidthPx: 960,
  compactViewportWidthPx: 1360,
  compactViewportHeightPx: 860,
  minimumInlineInsetPx: 32,
  maximumInlineInsetPx: 56,
  fluidInlineInsetRatio: 0.035,
  widthPx: 208,
  compactWidthPx: 200,
  minimumCompactWidthPx: 184,
  compactWidthRatio: 0.19,
  topPx: 160,
  compactTopPx: 146,
  bottomPx: 108,
  compactBottomPx: 96,
  rowHeightPx: 34,
  compactRowHeightPx: 32,
  eyebrowLaneHeightPx: 28,
  compactEyebrowLaneHeightPx: 26,
  anatomyGapPx: 28,
  wideAnatomyGapPx: 30,
  compactAnatomyGapPx: 26,
} as const;

export type RegionNavigatorLayout = Readonly<{
  visible: boolean;
  compact: boolean;
  width: number;
  left: number;
  top: number;
  bottom: number;
  safeLaneBottom: number;
  height: number;
  rowHeight: number;
  reservedLeftPx: number;
}>;

export function getRegionNavigatorLayout(
  viewportWidth: number,
  viewportHeight: number,
): RegionNavigatorLayout {
  const width = Math.max(0, viewportWidth);
  const height = Math.max(0, viewportHeight);
  const compact =
    width < REGION_NAVIGATOR_LAYOUT.compactViewportWidthPx ||
    height < REGION_NAVIGATOR_LAYOUT.compactViewportHeightPx;
  const left = Math.round(
    clamp(
      REGION_NAVIGATOR_LAYOUT.minimumInlineInsetPx,
      width * REGION_NAVIGATOR_LAYOUT.fluidInlineInsetRatio,
      REGION_NAVIGATOR_LAYOUT.maximumInlineInsetPx,
    ),
  );
  const navigatorWidth = compact
    ? Math.round(
        clamp(
          REGION_NAVIGATOR_LAYOUT.minimumCompactWidthPx,
          width * REGION_NAVIGATOR_LAYOUT.compactWidthRatio,
          REGION_NAVIGATOR_LAYOUT.compactWidthPx,
        ),
      )
    : REGION_NAVIGATOR_LAYOUT.widthPx;
  const top = compact
    ? REGION_NAVIGATOR_LAYOUT.compactTopPx
    : REGION_NAVIGATOR_LAYOUT.topPx;
  const bottom = compact
    ? REGION_NAVIGATOR_LAYOUT.compactBottomPx
    : REGION_NAVIGATOR_LAYOUT.bottomPx;
  const rowHeight = compact
    ? REGION_NAVIGATOR_LAYOUT.compactRowHeightPx
    : REGION_NAVIGATOR_LAYOUT.rowHeightPx;
  const eyebrowLaneHeight = compact
    ? REGION_NAVIGATOR_LAYOUT.compactEyebrowLaneHeightPx
    : REGION_NAVIGATOR_LAYOUT.eyebrowLaneHeightPx;
  const navigatorHeight = eyebrowLaneHeight + rowHeight * 10;
  const safeLaneBottom = Math.max(top, height - bottom);
  const visible =
    width >= REGION_NAVIGATOR_LAYOUT.minimumViewportWidthPx &&
    safeLaneBottom - top >= navigatorHeight;
  const anatomyGap = compact
    ? REGION_NAVIGATOR_LAYOUT.compactAnatomyGapPx
    : width >= 1720
      ? REGION_NAVIGATOR_LAYOUT.wideAnatomyGapPx
      : REGION_NAVIGATOR_LAYOUT.anatomyGapPx;

  return {
    visible,
    compact,
    width: navigatorWidth,
    left,
    top,
    bottom,
    safeLaneBottom,
    height: navigatorHeight,
    rowHeight,
    reservedLeftPx: visible
      ? Math.ceil(left + navigatorWidth + anatomyGap)
      : 0,
  };
}
