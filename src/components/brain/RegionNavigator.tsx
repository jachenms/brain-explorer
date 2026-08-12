"use client";

import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { BRAIN_REGIONS, type RegionId } from "@/lib/brain-regions";
import type { RegionNavigatorLayout } from "@/lib/region-navigator-layout";
import { getRegionNavigatorKeyboardAction } from "@/lib/region-navigator";

const REGION_NAVIGATOR_ROWS = BRAIN_REGIONS.map(({ id, name, color }) => ({
  id,
  name,
  color,
}));

type RegionNavigatorProps = Readonly<{
  layout: RegionNavigatorLayout;
  selectedRegionId: RegionId | null;
  onSelectRegion: (regionId: RegionId) => void;
  onHoverRegion: (regionId: RegionId | null) => void;
}>;

type RegionNavigatorRowProps = Readonly<{
  region: (typeof REGION_NAVIGATOR_ROWS)[number];
  index: number;
  selected: boolean;
  tabIndex: 0 | -1;
  rowHeight: number;
  compact: boolean;
  buttonRef: (node: HTMLButtonElement | null) => void;
  onFocusIndex: (index: number) => void;
  onMoveFocus: (index: number) => void;
  onSelectRegion: (regionId: RegionId) => void;
  onHoverRegion: (regionId: RegionId | null) => void;
}>;

type RegionNavigatorRowStyle = CSSProperties & {
  "--region-accent": string;
  "--region-row-height": string;
};

function RegionNavigatorRowComponent({
  region,
  index,
  selected,
  tabIndex,
  rowHeight,
  compact,
  buttonRef,
  onFocusIndex,
  onMoveFocus,
  onSelectRegion,
  onHoverRegion,
}: RegionNavigatorRowProps) {
  const handleFocus = useCallback(() => {
    onFocusIndex(index);
  }, [index, onFocusIndex]);

  const handleClick = useCallback(() => {
    onSelectRegion(region.id);
  }, [onSelectRegion, region.id]);

  const handlePointerEnter = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === "mouse") {
        onHoverRegion(region.id);
      }
    },
    [onHoverRegion, region.id],
  );

  const handlePointerLeave = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === "mouse") {
        onHoverRegion(null);
      }
    },
    [onHoverRegion],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      const action = getRegionNavigatorKeyboardAction(
        event.key,
        index,
        REGION_NAVIGATOR_ROWS.length,
      );

      if (!action) {
        return;
      }

      event.preventDefault();

      if (action.type === "focus") {
        onMoveFocus(action.index);
        return;
      }

      onSelectRegion(REGION_NAVIGATOR_ROWS[action.index].id);
    },
    [index, onMoveFocus, onSelectRegion],
  );

  const style: RegionNavigatorRowStyle = {
    "--region-accent": region.color,
    "--region-row-height": `${rowHeight}px`,
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      className="region-navigator__row"
      data-compact={compact ? "true" : "false"}
      data-region-id={region.id}
      aria-label={`Select ${region.name}`}
      aria-pressed={selected}
      tabIndex={tabIndex}
      style={style}
      onClick={handleClick}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerLeave}
    >
      <span className="region-navigator__active-tick" aria-hidden="true" />
      <span className="region-navigator__dot" aria-hidden="true" />
      <span className="region-navigator__label">{region.name}</span>
    </button>
  );
}

const RegionNavigatorRow = memo(RegionNavigatorRowComponent);

function RegionNavigatorComponent({
  layout,
  selectedRegionId,
  onSelectRegion,
  onHoverRegion,
}: RegionNavigatorProps) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const buttonRefCallbacks = useMemo(
    () =>
      REGION_NAVIGATOR_ROWS.map(
        (_, index) => (node: HTMLButtonElement | null) => {
          buttonRefs.current[index] = node;
        },
      ),
    [],
  );

  const handleFocusIndex = useCallback((index: number) => {
    setFocusedIndex(index);
  }, []);

  const handleMoveFocus = useCallback((index: number) => {
    setFocusedIndex(index);
    buttonRefs.current[index]?.focus();
  }, []);

  if (!layout.visible) {
    return null;
  }

  return (
    <nav
      className="region-navigator"
      data-region-navigator="true"
      data-compact={layout.compact ? "true" : "false"}
      aria-label="脑区索引"
      style={{
        left: `${layout.left}px`,
        top: `${layout.top}px`,
        width: `${layout.width}px`,
        height: `${layout.height}px`,
      }}
    >
      <div className="region-navigator__eyebrow">REGION INDEX</div>
      <div className="region-navigator__list">
        {REGION_NAVIGATOR_ROWS.map((region, index) => (
          <RegionNavigatorRow
            key={region.id}
            region={region}
            index={index}
            selected={selectedRegionId === region.id}
            tabIndex={focusedIndex === index ? 0 : -1}
            rowHeight={layout.rowHeight}
            compact={layout.compact}
            buttonRef={buttonRefCallbacks[index]}
            onFocusIndex={handleFocusIndex}
            onMoveFocus={handleMoveFocus}
            onSelectRegion={onSelectRegion}
            onHoverRegion={onHoverRegion}
          />
        ))}
      </div>
    </nav>
  );
}

export const RegionNavigator = memo(RegionNavigatorComponent);
