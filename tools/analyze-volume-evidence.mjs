import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDirectory = path.join(
  root,
  "artifacts",
  "system8-volume-v33-comparison",
);
const cases = [
  {
    file: "desktop-hippocampus-1920x1080.png",
    crop: { left: 320, top: 36, width: 1120, height: 880 },
  },
  {
    file: "desktop-amygdala-1920x1080.png",
    crop: { left: 360, top: 36, width: 1080, height: 900 },
  },
  {
    file: "desktop-corpus-callosum-1920x1080.png",
    crop: { left: 430, top: 180, width: 1080, height: 790 },
  },
];
const cropDirectory = path.join(evidenceDirectory, "crops");
await mkdir(cropDirectory, { recursive: true });
for (const entry of [
  {
    file: "01-desktop-resting-1920x1080.png",
    crop: { left: 480, top: 80, width: 920, height: 860 },
  },
  {
    file: "desktop-hippocampus-oblique-1920x1080.png",
    crop: { left: 520, top: 34, width: 900, height: 900 },
  },
  {
    file: "desktop-amygdala-oblique-1920x1080.png",
    crop: { left: 520, top: 34, width: 900, height: 900 },
  },
  {
    file: "desktop-corpus-callosum-oblique-1920x1080.png",
    crop: { left: 520, top: 34, width: 900, height: 900 },
  },
]) {
  await sharp(path.join(evidenceDirectory, entry.file))
    .extract(entry.crop)
    .png({ compressionLevel: 9 })
    .toFile(path.join(cropDirectory, entry.file));
}

function percentile(sorted, position) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(position * sorted.length))];
}

const report = {};
for (const entry of cases) {
  await sharp(path.join(evidenceDirectory, entry.file))
    .extract(entry.crop)
    .png({ compressionLevel: 9 })
    .toFile(path.join(cropDirectory, entry.file));
  const { data, info } = await sharp(path.join(evidenceDirectory, entry.file))
    .extract(entry.crop)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const luminances = [];
  let nearWhiteCount = 0;
  let clippedCount = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const diagnosticNeutral =
      Math.max(red, green, blue) - Math.min(red, green, blue) <= 30 &&
      luminance >= 18;
    if (!diagnosticNeutral) continue;
    luminances.push(luminance);
    if (red >= 225 && green >= 225 && blue >= 225) nearWhiteCount += 1;
    if (red >= 250 && green >= 250 && blue >= 250) clippedCount += 1;
  }
  luminances.sort((left, right) => left - right);
  report[entry.file] = {
    crop: entry.crop,
    diagnosticNeutralPixelCount: luminances.length,
    luminance8Bit: {
      p05: percentile(luminances, 0.05),
      median: percentile(luminances, 0.5),
      p90: percentile(luminances, 0.9),
      p95: percentile(luminances, 0.95),
      p99: percentile(luminances, 0.99),
    },
    nearWhitePercent:
      luminances.length > 0 ? (nearWhiteCount / luminances.length) * 100 : null,
    clippedWhitePercent:
      luminances.length > 0 ? (clippedCount / luminances.length) * 100 : null,
  };
}

await writeFile(
  path.join(evidenceDirectory, "image-analysis.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
