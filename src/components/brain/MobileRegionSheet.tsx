"use client";

import {
  memo,
  useCallback,
  useId,
  type CSSProperties,
  type PointerEvent,
  type RefObject,
} from "react";

import {
  BRAIN_REGION_BY_ID,
  BRAIN_REGIONS,
  formatBrainRegionDisplayDescription,
  type RegionId,
} from "@/lib/brain-regions";
import type { MobileExhibitLayoutMode } from "@/lib/mobile-exhibit-layout";
import { ENCLOSED_REGION_IDS } from "@/lib/brain-interaction";

const MOBILE_REGION_ROWS = BRAIN_REGIONS.map(
  ({ id, name, color }, index) => ({
    id,
    name,
    color,
    catalogNumber: String(index + 1).padStart(2, "0"),
  }),
);

export type MobileRegionSheetView = "index" | "detail";

type MobileRegionSheetProps = Readonly<{
  selectedRegionId: RegionId | null;
  view: MobileRegionSheetView;
  layoutMode: MobileExhibitLayoutMode;
  onViewChange: (view: MobileRegionSheetView) => void;
  onSelectRegion: (regionId: RegionId) => void;
  onHoverRegion: (regionId: RegionId | null) => void;
  onDismiss: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}>;

type RegionAccentStyle = CSSProperties & {
  "--region-accent": string;
};

export const MobileRegionSheet = memo(function MobileRegionSheet({
  selectedRegionId,
  view,
  layoutMode,
  onViewChange,
  onSelectRegion,
  onHoverRegion,
  onDismiss,
  returnFocusRef,
}: MobileRegionSheetProps) {
  const headingId = useId();
  const selectedRegion = selectedRegionId
    ? BRAIN_REGION_BY_ID.get(selectedRegionId)
    : null;
  const effectiveView = selectedRegion ? view : "index";
  const internalInSituActive =
    selectedRegionId !== null && ENCLOSED_REGION_IDS.has(selectedRegionId);

  const handleDismiss = useCallback(() => {
    returnFocusRef.current?.focus({ preventScroll: true });
    onDismiss();
  }, [onDismiss, returnFocusRef]);

  const handlePointerEnter = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType !== "mouse") return;
      const regionId = event.currentTarget.dataset.regionId as
        | RegionId
        | undefined;
      if (regionId) onHoverRegion(regionId);
    },
    [onHoverRegion],
  );

  const handlePointerLeave = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === "mouse") onHoverRegion(null);
    },
    [onHoverRegion],
  );

  return (
    <section
      className="mobile-region-sheet"
      data-mobile-region-sheet="true"
      data-view={effectiveView}
      data-layout-mode={layoutMode}
      data-region-count={MOBILE_REGION_ROWS.length}
      data-selected-region={selectedRegionId ?? ""}
      data-in-situ-view={internalInSituActive ? "true" : "false"}
      aria-labelledby={headingId}
    >
      <div className="mobile-region-sheet__material" aria-hidden="true" />

      <header className="mobile-region-sheet__header">
        <div className="mobile-region-sheet__identity">
          <span className="mobile-region-sheet__rule" aria-hidden="true" />
          <div>
            <h2 id={headingId} className="mobile-region-sheet__eyebrow">
              {effectiveView === "detail"
                ? internalInSituActive
                  ? "内部脑区"
                  : "当前选中脑区"
                : "脑区索引"}
            </h2>
            <p className="mobile-region-sheet__count">
              {effectiveView === "detail"
                ? internalInSituActive
                  ? selectedRegionId === "corpus-callosum"
                    ? "原位矢状面 MRI"
                    : "原位冠状面 MRI"
                  : "解剖说明牌"
                : "10个解剖脑区"}
            </p>
          </div>
        </div>

        {effectiveView === "detail" ? (
          <div className="mobile-region-sheet__header-actions">
            <button
              type="button"
              className="mobile-region-sheet__index-toggle"
              onClick={() => onViewChange("index")}
            >
              {layoutMode === "compact-landscape"
                ? "脑区"
                : "脑区索引"}
            </button>
            <button
              type="button"
              className="mobile-region-sheet__close"
              aria-label={`取消选择 ${selectedRegion?.name ?? "脑区"}`}
              onClick={handleDismiss}
            >
              <svg
                viewBox="0 0 18 18"
                width="21"
                height="21"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M4 4 14 14M14 4 4 14"
                  stroke="currentColor"
                  strokeWidth="1.55"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        ) : selectedRegion ? (
          <button
            type="button"
            className="mobile-region-sheet__selection-return"
            onClick={() => onViewChange("detail")}
          >
            <span
              className="mobile-region-sheet__selection-return-dot"
              style={
                {
                  "--region-accent": selectedRegion.color,
                } as RegionAccentStyle
              }
              aria-hidden="true"
            />
            <span>查看选中</span>
          </button>
        ) : null}
      </header>

      {effectiveView === "index" ? (
        <nav
          className="mobile-region-sheet__index"
          aria-label="脑区索引"
        >
          {MOBILE_REGION_ROWS.map((region) => {
            const selected = selectedRegionId === region.id;
            const style: RegionAccentStyle = {
              "--region-accent": region.color,
            };
            return (
              <button
                key={region.id}
                type="button"
                className="mobile-region-sheet__region"
                data-region-id={region.id}
                aria-label={`Select ${region.name}`}
                aria-pressed={selected}
                style={style}
                onClick={() => {
                  onViewChange("detail");
                  onSelectRegion(region.id);
                }}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={handlePointerLeave}
                onPointerCancel={handlePointerLeave}
              >
                <span className="mobile-region-sheet__catalog-number">
                  {region.catalogNumber}
                </span>
                <span
                  className="mobile-region-sheet__region-dot"
                  aria-hidden="true"
                />
                <span className="mobile-region-sheet__region-name">
                  {region.name}
                </span>
              </button>
            );
          })}
        </nav>
      ) : selectedRegion ? (
        <div className="mobile-region-sheet__detail">
          <article
            className="mobile-region-sheet__placard"
            style={
              {
                "--region-accent": selectedRegion.color,
              } as RegionAccentStyle
            }
          >
            <span
              className="mobile-region-sheet__placard-marker"
              aria-hidden="true"
            />
            <div className="mobile-region-sheet__placard-copy">
              <h3 className="mobile-region-sheet__region-heading">
                {selectedRegion.name}
              </h3>
              <p className="mobile-region-sheet__description">
                {formatBrainRegionDisplayDescription(
                  selectedRegion.description,
                )}
              </p>
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
});
