"use client";

import type { RegionId } from "@/lib/brain-regions";

const CUTAWAY_ANNOTATIONS: Partial<
  Record<
    RegionId,
    {
      orientation: string;
      plane: string;
      slice: string;
    }
  >
> = {
  hippocampus: {
    orientation: "冠状面 MRI 参考",
    plane: "Y −8.1 mm",
    slice: "119 / 256",
  },
  amygdala: {
    orientation: "冠状面 MRI 参考",
    plane: "Y +2.7 mm",
    slice: "131 / 256",
  },
  "corpus-callosum": {
    orientation: "矢状面 MRI 参考",
    plane: "X −0.9 mm",
    slice: "129 / 256",
  },
};

export function BrainCutawayAnnotation({
  regionId,
  visible,
}: {
  regionId: RegionId | null;
  visible: boolean;
}) {
  const annotation = regionId
    ? CUTAWAY_ANNOTATIONS[regionId]
    : undefined;
  if (!annotation) return null;

  return (
    <div
      className="brain-cutaway-annotation"
      data-visible={visible ? "true" : "false"}
      aria-label={`${annotation.orientation}, atlas plane ${annotation.plane}, T1 and aseg slice ${annotation.slice}`}
    >
      <span>{annotation.orientation}</span>
      <i aria-hidden="true" />
      <span>{annotation.plane}</span>
    </div>
  );
}
