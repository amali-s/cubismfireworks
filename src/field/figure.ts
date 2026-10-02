export const CELL = 0.12;
export const CUBE_FILL = 0.92;
export const CUBE_SIZE = CELL * CUBE_FILL;

/** 14 cells, y 0 through 13: head 2, neck 1, torso 4, legs 7. About 1.68 m. */
export const FIGURE_HEIGHT = 14 * CELL;

export type PartName = "head" | "neck" | "torso" | "armL" | "armR" | "legL" | "legR" | "weapon";

export type WeaponName = "sword" | "axe";

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
const HIP_Y = 7;
const ARM_LENGTH = 6;
const LEG_LENGTH = 7;
const ARM_X = 3;
const LEG_X = 1;

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

function buildBody(): FigureCell[] {
  const cells: FigureCell[] = [];
  // Head is 3 wide and 2 tall. One neck cell sits under it.
  addBox(cells, "head", -1, 1, 12, 13, 0, 1);
  addBox(cells, "neck", 0, 0, 11, 11, 1, 1);
  // Shoulder yoke (5 wide) over a narrower waist (3 wide).
  addBox(cells, "torso", -2, 2, 9, 10, 0, 1);
  addBox(cells, "torso", -1, 1, 7, 8, 0, 1);
  // Arms and legs are one cell thick. Legs leave a gap at x = 0.
  addBox(cells, "armL", -ARM_X, -ARM_X, 5, 10, 1, 1);
  addBox(cells, "armR", ARM_X, ARM_X, 5, 10, 1, 1);
  addBox(cells, "legL", -LEG_X, -LEG_X, 0, 6, 1, 1);
  addBox(cells, "legR", LEG_X, LEG_X, 0, 6, 1, 1);
  return cells;
}

function weapon(x: number, y: number, z: number): FigureCell {
  return { part: "weapon", x, y, z };
}

/** Blade forward (+Z) and one cell down, with a crossguard on the right hand. */
const SWORD_CELLS: readonly FigureCell[] = [
  weapon(2, 5, 2),
  weapon(3, 5, 2),
  weapon(4, 5, 2),
  weapon(3, 5, 3),
  weapon(3, 4, 3),
  weapon(3, 4, 4),
  weapon(3, 4, 5),
];

/** Haft forward and one cell down, with a wider head at the tip. */
const AXE_CELLS: readonly FigureCell[] = [
  weapon(3, 5, 2),
  weapon(3, 5, 3),
  weapon(3, 4, 3),
  weapon(3, 4, 4),
  weapon(3, 5, 5),
  weapon(3, 4, 5),
  weapon(3, 3, 5),
  weapon(4, 4, 5),
];

export const BODY: readonly FigureCell[] = buildBody();
export const SWORD_FIGURE: readonly FigureCell[] = [...BODY, ...SWORD_CELLS];
export const AXE_FIGURE: readonly FigureCell[] = [...BODY, ...AXE_CELLS];

export function figureCells(weaponName: WeaponName): readonly FigureCell[] {
  return weaponName === "sword" ? SWORD_FIGURE : AXE_FIGURE;
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

/** Shoulders and hips are the swing pivots. Head, neck, and torso stay upright. */
export function limbPose(part: PartName): LimbPose | null {
  const frontZ = (1 - 0.5) * CELL;
  if (part === "armL" || part === "armR" || part === "weapon") {
    const side = part === "armL" ? -1 : 1;
    const x = side * ARM_X * CELL;
    const pivotY = SHOULDER_Y * CELL;
    return {
      pivot: [x, pivotY, frontZ],
      joint: [x, pivotY - (ARM_LENGTH * CELL) / 2, frontZ],
      phaseOffset: part === "armL" ? Math.PI : 0,
    };
  }
  if (part === "legL" || part === "legR") {
    const side = part === "legL" ? -1 : 1;
    const hipX = side * LEG_X * CELL;
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
  const arm = cell.part === "armL" || cell.part === "armR" || cell.part === "weapon";
  const length = (arm ? ARM_LENGTH : LEG_LENGTH) * CELL;
  const centerY = (cell.y + 0.5) * CELL;
  return pose.pivot[1] - centerY >= length * 0.5;
}

function assertFigure(cells: readonly FigureCell[], expected: number, label: string) {
  if (cells.length !== expected) {
    throw new Error(`${label} figure has ${cells.length} cells, expected ${expected}`);
  }
  const seen = new Set<string>();
  let minY = Infinity;
  let maxY = -Infinity;
  for (const cell of cells) {
    const key = `${cell.x},${cell.y},${cell.z}`;
    if (seen.has(key)) throw new Error(`${label} figure duplicates ${key}`);
    seen.add(key);
    if (cell.y < minY) minY = cell.y;
    if (cell.y > maxY) maxY = cell.y;
  }
  if (minY !== 0 || maxY !== 13) {
    throw new Error(`${label} figure spans y ${minY}..${maxY}, expected 0..13`);
  }
}

assertFigure(SWORD_FIGURE, 78, "Sword");
assertFigure(AXE_FIGURE, 79, "Axe");

const rightArm = limbPose("armR");
const weaponPose = limbPose("weapon");
if (!rightArm || !weaponPose) throw new Error("Right arm pose missing");
if (
  weaponPose.phaseOffset !== rightArm.phaseOffset ||
  weaponPose.pivot.some((value, index) => value !== rightArm.pivot[index]) ||
  weaponPose.joint.some((value, index) => value !== rightArm.joint[index])
) {
  throw new Error("Weapon pose does not match the right arm");
}
for (const cell of SWORD_CELLS) {
  if (!isLowerHalf(cell)) throw new Error("Sword cell is not on the forearm");
}
for (const cell of AXE_CELLS) {
  if (!isLowerHalf(cell)) throw new Error("Axe cell is not on the forearm");
}
