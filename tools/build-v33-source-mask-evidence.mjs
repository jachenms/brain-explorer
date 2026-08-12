import { gunzipSync } from "node:zlib";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const root = process.cwd();
const directory = path.join(
  root,
  "artifacts",
  "system8-volume-v33-comparison",
  "source-mask-silhouettes",
);
await mkdir(directory, { recursive: true });

const manifest = JSON.parse(
  await readFile(
    path.join(
      root,
      "public",
      "textures",
      "brain-volume-v24",
      "manifest.json",
    ),
    "utf8",
  ),
);
const labels = gunzipSync(
  await readFile(
    path.join(
      root,
      "public",
      "textures",
      "brain-volume-v24",
      "labels-native-r8.raw.gz",
    ),
  ),
);
const [nx, ny, nz] = manifest.volume.dimensions;
const sourceDirectory = path.join(
  root,
  "artifacts",
  "system8-volume-v33-comparison",
);

const banner = (text) =>
  Buffer.from(
    `<svg width="768" height="48" xmlns="http://www.w3.org/2000/svg">
      <rect width="768" height="48" fill="#05060a"/>
      <text x="24" y="31" fill="#d8d2d4" font-family="monospace"
        font-size="16" letter-spacing="2">${text}</text>
    </svg>`,
  );

for (const regionId of [
  "hippocampus",
  "amygdala",
  "corpus-callosum",
]) {
  const region = manifest.regions[regionId];
  const sagittal = region.orientation === "sagittal";
  const width = sagittal ? nz : nx;
  const height = ny;
  const mask = Buffer.alloc(width * height);
  const center = Math.round(
    region.normalizedCenter *
      ((sagittal ? nx : nz) - 1),
  );
  for (let y = 0; y < ny; y += 1) {
    for (let horizontal = 0; horizontal < width; horizontal += 1) {
      const x = sagittal ? center : horizontal;
      const z = sagittal ? horizontal : center;
      const byte = labels[x + nx * (y + ny * z)];
      mask[horizontal + width * (ny - y - 1)] =
        byte & region.bit ? 230 : 0;
    }
  }
  const maskPanel = await sharp(mask, {
    raw: { width, height, channels: 1 },
  })
    .resize(768, 512, {
      fit: "contain",
      background: "#05060a",
      kernel: sharp.kernel.nearest,
    })
    .tint("#d7a9b7")
    .png()
    .toBuffer();
  const targetPanel = await sharp(
    path.join(
      sourceDirectory,
      `turntable-${regionId}-front-1920x1080.png`,
    ),
  )
    .extract({ left: 560, top: 380, width: 760, height: 500 })
    .resize(768, 512, {
      fit: "contain",
      background: "#05060a",
    })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: 1536,
      height: 560,
      channels: 4,
      background: "#05060a",
    },
  })
    .composite([
      { input: banner("EXACT ASEG CENTRAL PROJECTION"), left: 0, top: 0 },
      { input: banner("V33 DISPLAY SILHOUETTE"), left: 768, top: 0 },
      { input: maskPanel, left: 0, top: 48 },
      { input: targetPanel, left: 768, top: 48 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(path.join(directory, `${regionId}-mask-vs-display.png`));
}

console.log(
  JSON.stringify(
    { output: directory, comparisons: 3 },
    null,
    2,
  ),
);
