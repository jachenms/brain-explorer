export type RegionId =
  | "frontal-lobe"
  | "parietal-lobe"
  | "temporal-lobe"
  | "occipital-lobe"
  | "cerebellum"
  | "brain-stem"
  | "hippocampus"
  | "amygdala"
  | "prefrontal-cortex"
  | "corpus-callosum";

export type Vector3Tuple = readonly [number, number, number];

export type BrainRegion = {
  id: RegionId;
  name: string;
  description: string;
  color: string;
  baseColor: string;
  position: Vector3Tuple;
  scale: Vector3Tuple;
  rotation: Vector3Tuple;
  cameraOffset: Vector3Tuple;
  aliases: readonly string[];
  seed: number;
};

export const BRAIN_REGIONS: readonly BrainRegion[] = [
  {
    id: "frontal-lobe",
    name: "额叶",
    description: "你做决定和规划未来的地方",
    color: "#fc7794",
    baseColor: "#bc7887",
    position: [0.78, 0.35, 0.88],
    scale: [0.93, 0.83, 0.82],
    rotation: [0.02, -0.08, -0.06],
    cameraOffset: [2.9, 1.1, 4.2],
    aliases: ["frontal", "frontal_lobe", "frontallobe"],
    seed: 11,
  },
  {
    id: "parietal-lobe",
    name: "顶叶",
    description: "处理触觉、温度和空间感知",
    color: "#a892fd",
    baseColor: "#7d92bd",
    position: [-0.18, 1.04, 0.38],
    scale: [1.01, 0.68, 0.82],
    rotation: [-0.03, 0.04, 0.04],
    cameraOffset: [0.2, 3.4, 4.1],
    aliases: ["parietal", "parietal_lobe", "parietallobe"],
    seed: 23,
  },
  {
    id: "temporal-lobe",
    name: "颞叶",
    description: "负责听觉，并帮助形成记忆",
    color: "#46b2a8",
    baseColor: "#56a097",
    position: [0.42, -0.66, 0.86],
    scale: [0.98, 0.52, 0.8],
    rotation: [0.08, -0.04, -0.1],
    cameraOffset: [1.6, -1.8, 4.2],
    aliases: ["temporal", "temporal_lobe", "temporallobe"],
    seed: 37,
  },
  {
    id: "occipital-lobe",
    name: "枕叶",
    description: "处理你看到的一切",
    color: "#5fa5f7",
    baseColor: "#5e7fac",
    position: [-1.18, 0.2, -0.34],
    scale: [0.72, 0.74, 0.76],
    rotation: [0.03, 0.1, 0.08],
    cameraOffset: [-3.1, 0.7, 4.1],
    aliases: ["occipital", "occipital_lobe", "occipitallobe"],
    seed: 41,
  },
  {
    id: "cerebellum",
    name: "小脑",
    description: "协调你的平衡和运动",
    color: "#d4945a",
    baseColor: "#b98573",
    position: [-0.58, -0.92, -0.62],
    scale: [0.68, 0.43, 0.65],
    rotation: [0.04, 0.12, -0.14],
    cameraOffset: [-2.7, -2.1, 3.9],
    aliases: ["cerebellum", "little_brain"],
    seed: 53,
  },
  {
    id: "brain-stem",
    name: "脑干",
    description: "控制呼吸、心率和睡眠",
    color: "#fa7d6b",
    baseColor: "#a96f6a",
    position: [0.02, -1.58, -0.18],
    scale: [0.27, 0.66, 0.29],
    rotation: [0.03, -0.08, 0.08],
    cameraOffset: [-0.4, -3.2, 3.7],
    aliases: ["brainstem", "brain_stem", "stem"],
    seed: 67,
  },
  {
    id: "hippocampus",
    name: "海马体",
    description: "短期记忆转化为长期记忆的地方",
    color: "#dd7bf2",
    baseColor: "#9c73ae",
    position: [-0.24, -0.22, 1.08],
    scale: [0.58, 0.2, 0.18],
    rotation: [0.02, -0.08, -0.12],
    cameraOffset: [0.7, -0.9, 3.5],
    aliases: ["hippocampus", "hippocampal"],
    seed: 71,
  },
  {
    id: "amygdala",
    name: "杏仁核",
    description: "处理恐惧、愤怒和情绪反应",
    color: "#e878de",
    baseColor: "#bd647c",
    position: [0.42, -0.14, 1.08],
    scale: [0.18, 0.17, 0.15],
    rotation: [0, 0, 0],
    cameraOffset: [1.5, -0.7, 3.25],
    aliases: ["amygdala", "amygdaloid"],
    seed: 83,
  },
  {
    id: "prefrontal-cortex",
    name: "前额叶皮层",
    description: "负责性格和冲动控制",
    color: "#bf89fe",
    baseColor: "#a37bc0",
    position: [1.18, 0.34, 0.56],
    scale: [0.28, 0.56, 0.62],
    rotation: [-0.02, -0.18, -0.06],
    cameraOffset: [3.8, 1.15, 3.65],
    aliases: ["prefrontal", "prefrontal_cortex", "prefrontalcortex", "pfc"],
    seed: 97,
  },
  {
    id: "corpus-callosum",
    name: "胼胝体",
    description: "连接左右脑，使它们能够交流",
    color: "#b8a04c",
    baseColor: "#c2a56f",
    position: [0, 0.38, 1.1],
    scale: [0.64, 0.22, 0.17],
    rotation: [0.03, 0.02, 0.06],
    cameraOffset: [-0.1, 0.8, 3.2],
    aliases: ["corpus", "callosum", "corpus_callosum", "corpuscallosum"],
    seed: 101,
  },
] as const;

export const BRAIN_REGION_BY_ID = new Map(
  BRAIN_REGIONS.map((region) => [region.id, region]),
);

export const BRAIN_REGION_CATALOG_INDEX_BY_ID: ReadonlyMap<
  RegionId,
  number
> = new Map(
  BRAIN_REGIONS.map((region, index) => [region.id, index + 1]),
);

export function formatBrainRegionCatalogIndex(regionId: RegionId) {
  const index = BRAIN_REGION_CATALOG_INDEX_BY_ID.get(regionId);
  if (index === undefined) {
    throw new RangeError(`Unknown brain region: ${regionId}`);
  }

  const digits = Math.max(2, String(BRAIN_REGIONS.length).length);
  return `${String(index).padStart(digits, "0")} / ${String(
    BRAIN_REGIONS.length,
  ).padStart(digits, "0")}`;
}

export function formatBrainRegionDisplayDescription(description: string) {
  const canonical = description.trim();
  if (!canonical) return "";
  return canonical;
}

function normalizeNodeName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function getRegionIdFromNodeName(name: string): RegionId | null {
  const normalizedName = normalizeNodeName(name);

  for (const region of BRAIN_REGIONS) {
    const candidates = [region.id, region.name, ...region.aliases];
    if (
      candidates.some((candidate) =>
        normalizedName.includes(normalizeNodeName(candidate)),
      )
    ) {
      return region.id;
    }
  }

  return null;
}
