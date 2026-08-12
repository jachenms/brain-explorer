export const REGION_INFO_CARD_LAYOUT = {
  minimumWidthPx: 310,
  fluidWidthRatio: 0.22,
  maximumWidthPx: 350,
  minimumInlineInsetPx: 16,
  fluidInlineInsetRatio: 0.03,
  maximumInlineInsetPx: 40,
  minimumBottomInsetPx: 28,
  fluidBottomInsetRatio: 0.04,
  maximumBottomInsetPx: 40,
  heightPx: 232,
  anatomyGapPx: 26,
  cameraGuardPx: 1,
  leaderAttachmentOffsetYPx: 40,
  minimumLaneViewportWidthPx: 900,
} as const;

function clamp(minimum: number, value: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function getRegionInfoCardLayout(
  viewportWidth: number,
  viewportHeight: number,
) {
  const width = Number.isFinite(viewportWidth)
    ? Math.max(0, viewportWidth)
    : 0;
  const height = Number.isFinite(viewportHeight)
    ? Math.max(0, viewportHeight)
    : 0;
  const right = clamp(
    REGION_INFO_CARD_LAYOUT.minimumInlineInsetPx,
    width * REGION_INFO_CARD_LAYOUT.fluidInlineInsetRatio,
    REGION_INFO_CARD_LAYOUT.maximumInlineInsetPx,
  );
  const cardWidth = Math.min(
    REGION_INFO_CARD_LAYOUT.maximumWidthPx,
    Math.max(
      REGION_INFO_CARD_LAYOUT.minimumWidthPx,
      width * REGION_INFO_CARD_LAYOUT.fluidWidthRatio,
    ),
    Math.max(0, width - REGION_INFO_CARD_LAYOUT.minimumInlineInsetPx * 2),
  );
  const bottom = clamp(
    REGION_INFO_CARD_LAYOUT.minimumBottomInsetPx,
    height * REGION_INFO_CARD_LAYOUT.fluidBottomInsetRatio,
    REGION_INFO_CARD_LAYOUT.maximumBottomInsetPx,
  );
  const left = width - right - cardWidth;
  const reservedRightPx =
    width - left + REGION_INFO_CARD_LAYOUT.anatomyGapPx;

  return {
    width: cardWidth,
    height: REGION_INFO_CARD_LAYOUT.heightPx,
    left,
    right,
    top: height - bottom - REGION_INFO_CARD_LAYOUT.heightPx,
    bottom,
    anatomyGapPx: REGION_INFO_CARD_LAYOUT.anatomyGapPx,
    leaderAttachmentOffsetYPx:
      REGION_INFO_CARD_LAYOUT.leaderAttachmentOffsetYPx,
    reservedRightPx,
    safeRightNdc:
      width > 0
        ? 1 -
          ((reservedRightPx + REGION_INFO_CARD_LAYOUT.cameraGuardPx) *
            2) /
            width
        : -1,
    reservesLane:
      width >= REGION_INFO_CARD_LAYOUT.minimumLaneViewportWidthPx,
  } as const;
}
