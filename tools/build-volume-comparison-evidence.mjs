import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const oldDirectory = path.join(
  root,
  "artifacts",
  "system8-volume-v33-comparison",
);
const volumeDirectory = path.join(
  root,
  "artifacts",
  "system8-v34-comparison",
);
const outputDirectory = path.join(
  root,
  "artifacts",
  "system8-v34-v33-vs-v34",
);
const files = [
  "01-desktop-resting-1920x1080.png",
  "02-desktop-temporal-far-1920x1080.png",
  "desktop-hippocampus-1920x1080.png",
  "desktop-hippocampus-oblique-1920x1080.png",
  "desktop-amygdala-1920x1080.png",
  "desktop-corpus-callosum-1920x1080.png",
];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const file of files) {
  const oldImage = sharp(path.join(oldDirectory, file));
  const volumeImage = sharp(path.join(volumeDirectory, file));
  const metadata = await oldImage.metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new Error(`Missing dimensions for ${file}`);
  const bannerHeight = Math.max(28, Math.round(height * 0.045));
  const label = (text, x) => ({
    input: Buffer.from(
      `<svg width="${width}" height="${bannerHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#05060a"/>
        <text x="${Math.round(width * 0.04)}" y="${Math.round(bannerHeight * 0.68)}"
          fill="#d6d0d2" font-family="monospace" font-size="${Math.max(12, Math.round(bannerHeight * 0.34))}"
          letter-spacing="2">${text}</text>
      </svg>`,
    ),
    left: x,
    top: 0,
  });
  await sharp({
    create: {
      width: width * 2,
      height: height + bannerHeight,
      channels: 4,
      background: "#05060a",
    },
  })
    .composite([
      label("V33 BALANCE PASS", 0),
      label("V34 WELDED EXTERIOR", width),
      { input: await oldImage.png().toBuffer(), left: 0, top: bannerHeight },
      {
        input: await volumeImage.png().toBuffer(),
        left: width,
        top: bannerHeight,
      },
    ])
    .png({ compressionLevel: 9 })
    .toFile(path.join(outputDirectory, file));
}

console.log(
  JSON.stringify(
    { output: outputDirectory, comparisons: files.length },
    null,
    2,
  ),
);
