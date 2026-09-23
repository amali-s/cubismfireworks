import type { CubeSample } from "./types.ts";

export async function sampleImage(
  source: string | HTMLCanvasElement,
  width: number,
  height: number,
  columns = 28,
): Promise<CubeSample[]> {
  const drawable = typeof source === "string" ? await loadImage(source) : source;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("2d canvas context is unavailable");
  }

  context.drawImage(drawable, 0, 0, width, height);

  const rows = Math.max(1, Math.round((columns * height) / width));
  const cellW = width / columns;
  const cellH = height / rows;
  const pixels = context.getImageData(0, 0, width, height).data;
  const samples: CubeSample[] = [];

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const centerX = (column + 0.5) * cellW;
      const centerY = (row + 0.5) * cellH;
      const pixelX = Math.min(width - 1, Math.floor(centerX));
      const pixelY = Math.min(height - 1, Math.floor(centerY));
      const offset = (pixelY * width + pixelX) * 4;
      if (pixels[offset + 3] < 128) continue;

      samples.push({
        x: centerX - width / 2,
        y: height / 2 - centerY,
        color: [
          pixels[offset] / 255,
          pixels[offset + 1] / 255,
          pixels[offset + 2] / 255,
        ],
        u: centerX / width,
        v: centerY / height,
      });
    }
  }

  return samples;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  return image.decode().then(() => image);
}
