export const CELL = 0.12;
export const CUBE_FILL = 0.92;
export const CUBE_SIZE = CELL * CUBE_FILL;

/** 14 cells: head 3 + torso 5 + legs 6. */
export const FIGURE_HEIGHT = 14 * CELL;

export type PartName = "head" | "torso" | "armL" | "armR" | "legL" | "legR";

/** Integer cell coordinate. +X is the figure's right, +Y is up, +Z faces the camera. */
export type FigureCell = {
  part: PartName;
  x: number;
  y: number;
  z: number;
};

/** Dust blue, dried red, olive. One hue per body, dark enough for a #111111 field. */
export const BODY_COLORS = ["#697e96", "#965d54", "#707e58"] as const;

/** Added to sRGB lightness so stacked faces of the same hue separate. */
export const LIGHTNESS_JITTER = 0.08;

const SHOULDER_Y = 11;
const HIP_Y = 6;
const ARM_LENGTH = 5;
const LEG_LENGTH = 6;

function addBox(
  cells: FigureCell[],
  part: PartName,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
) {
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      for (let z = z0; z <= z1; z += 1) {
        cells.push({ part, x, y, z });
      }
    }
  }
}

function buildFigure(): FigureCell[] {
  const cells: FigureCell[] = [];
  addBox(cells, "head", -1, 1, 11, 13, 0, 1);
  addBox(cells, "torso", -1, 1, 6, 10, 0, 1);
  addBox(cells, "armL", -3, -2, 6, 10, 1, 1);
  addBox(cells, "armR", 2, 3, 6, 10, 1, 1);
  addBox(cells, "legL", -2, -1, 0, 5, 1, 1);
  addBox(cells, "legR", 1, 2, 0, 5, 1, 1);
  return cells;
}

export const FIGURE: readonly FigureCell[] = buildFigure();

if (FIGURE.length !== 92) {
  throw new Error(`Figure has ${FIGURE.length} cells, expected 92`);
}

export function cellCenter(cell: FigureCell): [number, number, number] {
  return [cell.x * CELL, (cell.y + 0.5) * CELL, (cell.z - 0.5) * CELL];
}

export type LimbPose = {
  pivot: [number, number, number];
  joint: [number, number, number];
  /** Legs oppose each other. Arms counter-swing. */
  phaseOffset: number;
};

/** Shoulders and hips are the swing pivots. Head and torso stay upright. */
export function limbPose(part: PartName): LimbPose | null {
  const frontZ = (1 - 0.5) * CELL;
  if (part === "armL" || part === "armR") {
    const side = part === "armL" ? -1 : 1;
    const pivotY = SHOULDER_Y * CELL;
    return {
      pivot: [side * 1.5 * CELL, pivotY, frontZ],
      joint: [side * 2.5 * CELL, pivotY - (ARM_LENGTH * CELL) / 2, frontZ],
      phaseOffset: part === "armL" ? Math.PI : 0,
    };
  }
  if (part === "legL" || part === "legR") {
    const side = part === "legL" ? -1 : 1;
    const hipX = side * 1.5 * CELL;
    const pivotY = HIP_Y * CELL;
    return {
      pivot: [hipX, pivotY, frontZ],
      joint: [hipX, pivotY - (LEG_LENGTH * CELL) / 2, frontZ],
      phaseOffset: part === "legL" ? 0 : Math.PI,
    };
  }
  return null;
}

export function isLowerHalf(cell: FigureCell): boolean {
  const pose = limbPose(cell.part);
  if (!pose) return false;
  const length = (cell.part === "armL" || cell.part === "armR" ? ARM_LENGTH : LEG_LENGTH) * CELL;
  const centerY = (cell.y + 0.5) * CELL;
  return pose.pivot[1] - centerY >= length * 0.5;
}
