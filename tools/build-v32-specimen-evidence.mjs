import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(
  root,
  "artifacts",
  "system8-v34-comparison",
);
const output = path.join(source, "specimen-crops");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const crops = [
  {
    source: "01-desktop-resting-1920x1080.png",
    output: "resting-tissue-200pct.png",
    region: { left: 390, top: 105, width: 1100, height: 820 },
  },
  {
    source: "02-desktop-temporal-far-1920x1080.png",
    output: "temporal-selection-200pct.png",
    region: { left: 315, top: 70, width: 1220, height: 860 },
  },
];

for (const crop of crops) {
  await sharp(path.join(source, crop.source))
    .extract(crop.region)
    .resize({
      width: crop.region.width * 2,
      height: crop.region.height * 2,
      kernel: sharp.kernel.lanczos3,
    })
    .png({ compressionLevel: 9 })
    .toFile(path.join(output, crop.output));
}

console.log(
  JSON.stringify(
    {
      output,
      crops: crops.length,
      scale: "200%",
      interpolation: "Lanczos3",
    },
    null,
    2,
  ),
);
