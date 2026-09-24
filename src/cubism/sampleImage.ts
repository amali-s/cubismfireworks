import type { CubeSample } from "./types.ts";

export type SampledImage = {
  samples: CubeSample[];
  image: HTMLCanvasElement;
};

export async function sampleImage(
  source: string | HTMLCanvasElement,
  width: number,
  height: number,
  columns = 28,
): Promise<SampledImage> {
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
      const color = cellColor(pixels, width, height, column, row, cellW, cellH);
      if (!color) continue;

      samples.push({
        x: centerX - width / 2,
        y: height / 2 - centerY,
        color,
        u: centerX / width,
        v: centerY / height,
      });
    }
  }

  return { samples, image: canvas };
}

function cellColor(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  column: number,
  row: number,
  cellW: number,
  cellH: number,
): [number, number, number] | null {
  const x0 = Math.max(0, Math.floor(column * cellW));
  const y0 = Math.max(0, Math.floor(row * cellH));
  const x1 = Math.min(width, Math.max(x0 + 1, Math.ceil((column + 1) * cellW)));
  const y1 = Math.min(height, Math.max(y0 + 1, Math.ceil((row + 1) * cellH)));
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const offset = (y * width + x) * 4;
      if (pixels[offset + 3] < 128) continue;
      red += pixels[offset];
      green += pixels[offset + 1];
      blue += pixels[offset + 2];
      count += 1;
    }
  }

  if (count === 0) return null;
  return [red / count / 255, green / count / 255, blue / count / 255];
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  return image.decode().then(() => image);
}
