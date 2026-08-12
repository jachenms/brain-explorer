import {
  GLTFLoader,
  type GLTF,
} from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

import {
  reportExhibitAssetError,
  reportExhibitAssetMapping,
  reportExhibitAssetTransfer,
} from "./exhibit-loading-store";

export const BUNDLED_BRAIN_MODEL_URL = "/models/brain-atlas.glb";
export const BRAIN_MODEL_URL =
  process.env.NEXT_PUBLIC_BRAIN_MODEL_URL?.trim() ||
  BUNDLED_BRAIN_MODEL_URL;

export type BrainAssetResource = Readonly<{
  attempt: number;
  url: string;
  read: () => GLTF;
}>;

type MutableBrainAssetResource = BrainAssetResource & {
  abort: () => void;
};

const resources = new Map<string, MutableBrainAssetResource>();
const DRACO_DECODER_PATH =
  "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";

function resourceKey(url: string, attempt: number) {
  return `${attempt}:${url}`;
}

function parseContentLength(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function combineChunks(chunks: readonly Uint8Array[], byteLength: number) {
  const combined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

function assetBasePath(url: string) {
  const absoluteUrl = new URL(url, window.location.href);
  return new URL(".", absoluteUrl).href;
}

function createBrainAssetResource(
  url: string,
  attempt: number,
): MutableBrainAssetResource {
  const abortController = new AbortController();
  let status: "pending" | "fulfilled" | "rejected" = "pending";
  let result: GLTF | null = null;
  let failure: unknown = null;

  const promise = Promise.resolve().then(async () => {
    let loadedBytes = 0;
    let totalBytes: number | null = null;
    try {
      reportExhibitAssetTransfer(attempt, 0, null);
      const response = await fetch(url, {
        cache: attempt === 0 ? "default" : "reload",
        signal: abortController.signal,
      });
      if (!response.ok) {
        throw new Error(
          `Specimen request failed with status ${response.status}.`,
        );
      }

      totalBytes = parseContentLength(
        response.headers.get("content-length"),
      );
      let buffer: ArrayBuffer;
      if (response.body) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let lastReportedAt = 0;
        let lastReportedRatio = -1;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value?.byteLength) continue;
          chunks.push(value);
          loadedBytes += value.byteLength;
          const timestamp = performance.now();
          const ratio =
            totalBytes && totalBytes > 0
              ? Math.min(1, loadedBytes / totalBytes)
              : -1;
          if (
            lastReportedAt === 0 ||
            timestamp - lastReportedAt >= 50 ||
            ratio === 1 ||
            (ratio >= 0 && ratio - lastReportedRatio >= 0.01)
          ) {
            lastReportedAt = timestamp;
            lastReportedRatio = ratio;
            reportExhibitAssetTransfer(
              attempt,
              loadedBytes,
              totalBytes,
            );
          }
        }
        buffer = combineChunks(chunks, loadedBytes);
      } else {
        buffer = await response.arrayBuffer();
        loadedBytes = buffer.byteLength;
      }

      const effectiveTotalBytes =
        totalBytes && totalBytes >= loadedBytes
          ? totalBytes
          : loadedBytes || totalBytes;
      reportExhibitAssetTransfer(
        attempt,
        loadedBytes,
        effectiveTotalBytes,
      );
      reportExhibitAssetMapping(
        attempt,
        loadedBytes,
        effectiveTotalBytes,
      );

      const loader = new GLTFLoader();
      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
      loader.setDRACOLoader(dracoLoader);
      try {
        result = await loader.parseAsync(buffer, assetBasePath(url));
      } finally {
        dracoLoader.dispose();
      }
      status = "fulfilled";
    } catch (error) {
      status = "rejected";
      failure = error;
      if (!abortController.signal.aborted) {
        reportExhibitAssetError(attempt, error);
      }
    }
  });

  return {
    attempt,
    url,
    abort: () => abortController.abort(),
    read() {
      if (status === "fulfilled" && result) return result;
      if (status === "rejected") throw failure;
      throw promise;
    },
  };
}

export function getBrainAssetResource(url: string, attempt: number) {
  const key = resourceKey(url, attempt);
  const existing = resources.get(key);
  if (existing) return existing;

  for (const [candidateKey, resource] of resources) {
    if (resource.url === url && resource.attempt !== attempt) {
      resource.abort();
      resources.delete(candidateKey);
    }
  }

  const resource = createBrainAssetResource(url, attempt);
  resources.set(key, resource);
  return resource;
}
