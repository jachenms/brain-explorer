export type RegionNavigatorKeyboardAction =
  | Readonly<{ type: "focus"; index: number }>
  | Readonly<{ type: "select"; index: number }>
  | null;

const wrapIndex = (index: number, count: number) =>
  ((index % count) + count) % count;

export function getRegionNavigatorKeyboardAction(
  key: string,
  currentIndex: number,
  regionCount: number,
): RegionNavigatorKeyboardAction {
  if (regionCount <= 0) {
    return null;
  }

  const index = wrapIndex(currentIndex, regionCount);

  switch (key) {
    case "ArrowDown":
      return { type: "focus", index: wrapIndex(index + 1, regionCount) };
    case "ArrowUp":
      return { type: "focus", index: wrapIndex(index - 1, regionCount) };
    case "Home":
      return { type: "focus", index: 0 };
    case "End":
      return { type: "focus", index: regionCount - 1 };
    case "Enter":
    case " ":
      return { type: "select", index };
    default:
      return null;
  }
}
