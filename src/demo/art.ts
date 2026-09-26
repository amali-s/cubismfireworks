export const TILE_WIDTH = 280;
export const TILE_HEIGHT = 360;

export type MenuArtId = "gallery" | "archive" | "studio" | "field";

export type MenuArt = {
  id: MenuArtId;
  canvas: HTMLCanvasElement;
};

type Point = [number, number];

function createTile(paint: (context: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_WIDTH;
  canvas.height = TILE_HEIGHT;
  const context = canvas.getContext("2d");
  if (context) paint(context);
  return canvas;
}

function plane(context: CanvasRenderingContext2D, color: string, points: Point[]) {
  const [first, ...rest] = points;
  if (!first) return;
  context.beginPath();
  context.moveTo(first[0], first[1]);
  for (const [x, y] of rest) context.lineTo(x, y);
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function paintGallery(context: CanvasRenderingContext2D) {
  plane(context, "#f4efe2", [
    [58, 214],
    [214, 168],
    [246, 292],
    [78, 334],
  ]);
  plane(context, "#1d4ed8", [
    [34, 86],
    [132, 38],
    [158, 188],
    [40, 226],
  ]);
  plane(context, "#f2c14a", [
    [116, 52],
    [228, 30],
    [244, 164],
    [128, 186],
  ]);
  plane(context, "#e23b32", [
    [92, 146],
    [206, 122],
    [188, 262],
    [74, 286],
  ]);
  plane(context, "#128a52", [
    [154, 176],
    [236, 154],
    [214, 252],
    [136, 246],
  ]);
  plane(context, "#161616", [
    [128, 104],
    [198, 90],
    [188, 128],
    [118, 140],
  ]);
}

function paintArchive(context: CanvasRenderingContext2D) {
  plane(context, "#f3e1b8", [
    [28, 78],
    [248, 46],
    [232, 154],
    [42, 176],
  ]);
  plane(context, "#0e6e6a", [
    [48, 118],
    [214, 96],
    [250, 208],
    [26, 232],
  ]);
  plane(context, "#c4622d", [
    [64, 176],
    [246, 156],
    [226, 304],
    [36, 286],
  ]);
  plane(context, "#6b2d5b", [
    [146, 34],
    [252, 92],
    [176, 176],
  ]);
  plane(context, "#e0a106", [
    [44, 236],
    [186, 214],
    [174, 258],
    [36, 278],
  ]);
  plane(context, "#1c140e", [
    [92, 138],
    [164, 124],
    [150, 204],
    [78, 216],
  ]);
}

function paintStudio(context: CanvasRenderingContext2D) {
  plane(context, "#14182b", [
    [78, 36],
    [214, 22],
    [242, 138],
    [62, 162],
  ]);
  plane(context, "#f4f7ff", [
    [32, 124],
    [168, 88],
    [198, 228],
    [22, 252],
  ]);
  plane(context, "#ff2d95", [
    [124, 102],
    [258, 148],
    [214, 308],
    [86, 268],
  ]);
  plane(context, "#c8f23a", [
    [24, 176],
    [118, 154],
    [92, 324],
    [12, 300],
  ]);
  plane(context, "#ff8a00", [
    [156, 198],
    [252, 220],
    [228, 344],
    [134, 312],
  ]);
  plane(context, "#3a46e6", [
    [96, 54],
    [184, 42],
    [154, 132],
    [82, 118],
  ]);
}

function paintField(context: CanvasRenderingContext2D) {
  plane(context, "#5c6142", [
    [108, 236],
    [174, 222],
    [166, 328],
    [98, 336],
  ]);
  plane(context, "#6a704c", [
    [100, 142],
    [198, 124],
    [184, 252],
    [88, 268],
  ]);
  plane(context, "#6d7c8b", [
    [58, 160],
    [118, 146],
    [106, 242],
    [48, 252],
  ]);
  plane(context, "#7a8794", [
    [128, 68],
    [190, 52],
    [202, 122],
    [124, 136],
  ]);
  plane(context, "#7c463e", [
    [140, 112],
    [186, 100],
    [176, 156],
    [132, 164],
  ]);
}

export function createMenuArt(): MenuArt[] {
  return [
    { id: "gallery", canvas: createTile(paintGallery) },
    { id: "archive", canvas: createTile(paintArchive) },
    { id: "studio", canvas: createTile(paintStudio) },
    { id: "field", canvas: createTile(paintField) },
  ];
}
