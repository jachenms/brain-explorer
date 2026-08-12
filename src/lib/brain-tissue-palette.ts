import type { RegionId } from "./brain-regions";

export type TissueCategory =
  | "cortex"
  | "cerebellum"
  | "brain-stem"
  | "internal-gray"
  | "internal-white";

export type TissueMaterialProfile = Readonly<{
  roughness: number;
  specularIntensity: number;
  sheen: number;
  clearcoat: number;
  clearcoatRoughness: number;
  envMapIntensity: number;
}>;

export const IDLE_TISSUE_PALETTE: Readonly<Record<RegionId, string>> = {
  "frontal-lobe": "#c99f9d",
  "parietal-lobe": "#c99f9d",
  "temporal-lobe": "#c99f9d",
  "occipital-lobe": "#c99f9d",
  "prefrontal-cortex": "#c99f9d",
  cerebellum: "#cfadaa",
  "brain-stem": "#c5a3a1",
  hippocampus: "#aa878f",
  amygdala: "#a47e86",
  "corpus-callosum": "#d8cdc4",
};

const TISSUE_CATEGORY_BY_REGION: Readonly<Record<RegionId, TissueCategory>> = {
  "frontal-lobe": "cortex",
  "parietal-lobe": "cortex",
  "temporal-lobe": "cortex",
  "occipital-lobe": "cortex",
  "prefrontal-cortex": "cortex",
  cerebellum: "cerebellum",
  "brain-stem": "brain-stem",
  hippocampus: "internal-gray",
  amygdala: "internal-gray",
  "corpus-callosum": "internal-white",
};

const TISSUE_MATERIAL_PROFILES: Readonly<
  Record<TissueCategory, TissueMaterialProfile>
> = {
  cortex: {
    roughness: 0.64,
    specularIntensity: 0.53,
    sheen: 0,
    clearcoat: 0.08,
    clearcoatRoughness: 0.34,
    envMapIntensity: 0.93,
  },
  cerebellum: {
    roughness: 0.68,
    specularIntensity: 0.49,
    sheen: 0,
    clearcoat: 0.08,
    clearcoatRoughness: 0.36,
    envMapIntensity: 0.9,
  },
  "brain-stem": {
    roughness: 0.65,
    specularIntensity: 0.38,
    sheen: 0,
    clearcoat: 0.06,
    clearcoatRoughness: 0.38,
    envMapIntensity: 0.88,
  },
  "internal-gray": {
    roughness: 0.58,
    specularIntensity: 0.45,
    sheen: 0,
    clearcoat: 0.11,
    clearcoatRoughness: 0.36,
    envMapIntensity: 1,
  },
  "internal-white": {
    roughness: 0.54,
    specularIntensity: 0.47,
    sheen: 0,
    clearcoat: 0.13,
    clearcoatRoughness: 0.34,
    envMapIntensity: 1.02,
  },
};

export function getIdleTissueColor(regionId: RegionId) {
  return IDLE_TISSUE_PALETTE[regionId];
}

export function getTissueCategory(regionId: RegionId) {
  return TISSUE_CATEGORY_BY_REGION[regionId];
}

export function getTissueMaterialProfile(regionId: RegionId) {
  return TISSUE_MATERIAL_PROFILES[getTissueCategory(regionId)];
}

export function hexToSrgb(hex: string) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map(
    (offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255,
  ) as [number, number, number];
}

export function srgbLuminance(hex: string) {
  const channels = hexToSrgb(hex).map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return (
    channels[0] * 0.2126 +
    channels[1] * 0.7152 +
    channels[2] * 0.0722
  );
}

export function srgbSaturation(hex: string) {
  const channels = hexToSrgb(hex);
  const maximum = Math.max(...channels);
  const minimum = Math.min(...channels);
  const lightness = (maximum + minimum) / 2;
  const delta = maximum - minimum;
  return delta === 0
    ? 0
    : delta / (1 - Math.abs(2 * lightness - 1));
}
