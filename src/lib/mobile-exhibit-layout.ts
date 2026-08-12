const clamp = (minimum: number, value: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export const MOBILE_EXHIBIT_LAYOUT = {
  maximumNarrowViewportWidthPx: 959,
  compactLandscapeMaximumHeightPx: 520,
  tabletMinimumWidthPx: 600,
  minimumTouchTargetPx: 44,
  phoneSheetMinimumHeightPx: 288,
  phoneSheetMaximumHeightPx: 316,
  phoneSheetViewportRatio: 0.35,
  tabletSheetMinimumHeightPx: 176,
  tabletSheetMaximumHeightPx: 208,
  tabletSheetViewportRatio: 0.19,
  landscapeSheetMinimumHeightPx: 132,
  landscapeSheetMaximumHeightPx: 138,
  landscapeSheetViewportRatio: 0.35,
  phoneSelectedSheetReductionPx: 120,
  tabletSelectedSheetMinimumHeightPx: 124,
  landscapeSelectedSheetMinimumHeightPx: 88,
  mobileMaximumDpr: 1.15,
  compactLandscapeMaximumDpr: 1.1,
  desktopMaximumDpr: 1.6,
} as const;

export type MobileExhibitLayoutMode =
  | "desktop"
  | "phone-portrait"
  | "tablet"
  | "compact-landscape";

export type MobileExhibitLayout = Readonly<{
  active: boolean;
  mode: MobileExhibitLayoutMode;
  sheetBaseHeightPx: number;
  detailSheetBaseHeightPx: number;
  canvasHeightPx: number;
  indexColumns: number;
  maximumDpr: number;
  minimumTouchTargetPx: number;
}>;

export function isMobileExhibitPresentation(
  viewportWidth: number,
  coarsePointer: boolean,
) {
  return (
    Number.isFinite(viewportWidth) &&
    viewportWidth > 0 &&
    (viewportWidth <=
      MOBILE_EXHIBIT_LAYOUT.maximumNarrowViewportWidthPx ||
      coarsePointer)
  );
}

export function getMobileExhibitLayout(
  viewportWidth: number,
  viewportHeight: number,
  coarsePointer = false,
): MobileExhibitLayout {
  const width = Number.isFinite(viewportWidth)
    ? Math.max(0, viewportWidth)
    : 0;
  const height = Number.isFinite(viewportHeight)
    ? Math.max(0, viewportHeight)
    : 0;
  const active = isMobileExhibitPresentation(width, coarsePointer);

  if (!active) {
    return {
      active: false,
      mode: "desktop",
      sheetBaseHeightPx: 0,
      detailSheetBaseHeightPx: 0,
      canvasHeightPx: height,
      indexColumns: 0,
      maximumDpr: MOBILE_EXHIBIT_LAYOUT.desktopMaximumDpr,
      minimumTouchTargetPx:
        MOBILE_EXHIBIT_LAYOUT.minimumTouchTargetPx,
    };
  }

  const compactLandscape =
    width > height &&
    height <=
      MOBILE_EXHIBIT_LAYOUT.compactLandscapeMaximumHeightPx;
  const tablet =
    !compactLandscape &&
    width >= MOBILE_EXHIBIT_LAYOUT.tabletMinimumWidthPx;
  const sheetBaseHeightPx = Math.round(
    compactLandscape
      ? clamp(
          MOBILE_EXHIBIT_LAYOUT.landscapeSheetMinimumHeightPx,
          height *
            MOBILE_EXHIBIT_LAYOUT.landscapeSheetViewportRatio,
          MOBILE_EXHIBIT_LAYOUT.landscapeSheetMaximumHeightPx,
        )
      : tablet
        ? clamp(
            MOBILE_EXHIBIT_LAYOUT.tabletSheetMinimumHeightPx,
            height *
              MOBILE_EXHIBIT_LAYOUT.tabletSheetViewportRatio,
            MOBILE_EXHIBIT_LAYOUT.tabletSheetMaximumHeightPx,
          )
        : clamp(
            MOBILE_EXHIBIT_LAYOUT.phoneSheetMinimumHeightPx,
            height *
              MOBILE_EXHIBIT_LAYOUT.phoneSheetViewportRatio,
            MOBILE_EXHIBIT_LAYOUT.phoneSheetMaximumHeightPx,
          ),
  );
  const detailSheetBaseHeightPx = compactLandscape
    ? Math.max(
        MOBILE_EXHIBIT_LAYOUT.landscapeSelectedSheetMinimumHeightPx,
        sheetBaseHeightPx - 24,
      )
    : tablet
      ? Math.max(
          MOBILE_EXHIBIT_LAYOUT.tabletSelectedSheetMinimumHeightPx,
          sheetBaseHeightPx - 72,
        )
      : sheetBaseHeightPx -
        MOBILE_EXHIBIT_LAYOUT.phoneSelectedSheetReductionPx;

  return {
    active: true,
    mode: compactLandscape
      ? "compact-landscape"
      : tablet
        ? "tablet"
        : "phone-portrait",
    sheetBaseHeightPx,
    detailSheetBaseHeightPx,
    canvasHeightPx: Math.max(0, height - sheetBaseHeightPx),
    indexColumns: compactLandscape || tablet ? 5 : 2,
    maximumDpr: compactLandscape
      ? MOBILE_EXHIBIT_LAYOUT.compactLandscapeMaximumDpr
      : MOBILE_EXHIBIT_LAYOUT.mobileMaximumDpr,
    minimumTouchTargetPx:
      MOBILE_EXHIBIT_LAYOUT.minimumTouchTargetPx,
  };
}
