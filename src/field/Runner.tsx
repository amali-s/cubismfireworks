import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { easeOutCubic, smoothstep } from "../cubism/easing.ts";
import {
  FIGURE,
  FIGURE_HEIGHT,
  LIGHTNESS_JITTER,
  cellCenter,
  isLowerHalf,
  limbPose,
  type FigureCell,
} from "./figure.ts";

const TAU = Math.PI * 2;
const WALK_SPEED = 1.7;
const RUN_SPEED = 2.85;
const WALK_HZ = 1.35;
const RUN_HZ = 2.55;
const WALK_AMP = 0.4;
const RUN_AMP = 0.78;
const LAG = 0.62;
const WALK_BOB = 0.03;
const RUN_BOB = 0.048;
const QUIET_BOB = 0.018;
const CHARGE_RAMP = 0.42;
const SETTLE_TIME = 0.9;
const MAX_STEP = 0.05;

const UP = new THREE.Vector3(0, 1, 0);
const SWING_AXIS = new THREE.Vector3(1, 0, 0);

type Mode = "approach" | "charge" | "settled";

type Cube = {
  rest: THREE.Vector3;
  pivot: THREE.Vector3 | null;
  joint: THREE.Vector3 | null;
  lower: boolean;
  phaseOffset: number;
  bobWeight: number;
  bobPhase: number;
  color: THREE.Color;
};

type Motion = {
  mode: Mode;
  position: THREE.Vector3;
  inward: THREE.Vector3;
  stop: THREE.Vector3;
  chargeDir: THREE.Vector3;
  yaw: number;
  phase: number;
  bobTime: number;
  gait: number;
  settle: number;
  posed: THREE.Vector3;
  jointRel: THREE.Vector3;
  box: THREE.Box3;
  frustum: THREE.Frustum;
  proj: THREE.Matrix4;
  dummy: THREE.Object3D;
};

type RunnerProps = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  color: string;
  seed: number;
  spawn: readonly [number, number, number];
  inward: readonly [number, number, number];
  stop: readonly [number, number, number];
  reducedMotion: boolean;
};

function hash01(n: number) {
  const value = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function bobWeight(cell: FigureCell) {
  if (cell.part === "torso") {
    const fromCore = Math.abs(cell.x) + Math.abs(cell.y - 8);
    return fromCore === 0 ? 0.015 : 0.04 + fromCore * 0.015;
  }
  if (cell.part === "head") return 0.1;
  if (cell.part === "armL" || cell.part === "armR") {
    return 0.06 + 0.94 * ((10 - cell.y) / 4);
  }
  return 0.06 + 0.94 * ((5 - cell.y) / 5);
}

function buildCubes(color: string, seed: number): Cube[] {
  const base = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl, THREE.SRGBColorSpace);
  return FIGURE.map((cell, index) => {
    const pose = limbPose(cell.part);
    const jitter = (hash01(index + seed * 13.1) - 0.5) * 2 * LIGHTNESS_JITTER;
    return {
      rest: new THREE.Vector3(...cellCenter(cell)),
      pivot: pose ? new THREE.Vector3(...pose.pivot) : null,
      joint: pose ? new THREE.Vector3(...pose.joint) : null,
      lower: isLowerHalf(cell),
      phaseOffset: pose?.phaseOffset ?? 0,
      bobWeight: bobWeight(cell),
      bobPhase: hash01(index * 2.3 + seed) * TAU,
      color: new THREE.Color().setHSL(
        hsl.h,
        hsl.s,
        THREE.MathUtils.clamp(hsl.l + jitter, 0, 1),
        THREE.SRGBColorSpace,
      ),
    };
  });
}

function dampAngle(current: number, target: number, lambda: number, dt: number) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * (1 - Math.exp(-lambda * dt));
}

function inView(motion: Motion, camera: THREE.Camera) {
  const { position, box, frustum, proj } = motion;
  box.min.set(position.x - 0.5, 0, position.z - 0.5);
  box.max.set(position.x + 0.5, FIGURE_HEIGHT, position.z + 0.5);
  proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(proj);
  return frustum.intersectsBox(box);
}

function faceYaw(direction: THREE.Vector3) {
  return Math.atan2(direction.x, direction.z);
}

function stepMotion(motion: Motion, camera: THREE.Camera, dt: number, reduced: boolean) {
  if (reduced) {
    motion.mode = "settled";
    motion.position.copy(motion.stop);
    motion.gait = 0;
    motion.settle = 1;
    motion.yaw = dampAngle(motion.yaw, faceYaw(motion.chargeDir.set(-motion.position.x, 0, -motion.position.z)), 8, dt);
    motion.bobTime += dt * 0.85;
    return;
  }

  if (motion.mode === "approach") {
    motion.position.addScaledVector(motion.inward, WALK_SPEED * dt);
    motion.phase += WALK_HZ * TAU * dt;
    motion.yaw = dampAngle(motion.yaw, faceYaw(motion.inward), 8, dt);
    motion.gait = 0;
    motion.settle = 0;
    if (inView(motion, camera)) {
      motion.chargeDir.set(motion.stop.x - motion.position.x, 0, motion.stop.z - motion.position.z);
      if (motion.chargeDir.lengthSq() < 1e-6) {
        motion.position.copy(motion.stop);
        motion.mode = "settled";
      } else {
        motion.chargeDir.normalize();
        motion.mode = "charge";
      }
    }
  } else if (motion.mode === "charge") {
    motion.gait = Math.min(1, motion.gait + dt / CHARGE_RAMP);
    const pace = smoothstep(motion.gait);
    const speed = WALK_SPEED + (RUN_SPEED - WALK_SPEED) * pace;
    motion.phase += (WALK_HZ + (RUN_HZ - WALK_HZ) * pace) * TAU * dt;
    motion.yaw = dampAngle(motion.yaw, faceYaw(motion.chargeDir), 8, dt);
    const remain = Math.hypot(motion.stop.x - motion.position.x, motion.stop.z - motion.position.z);
    const step = speed * dt;
    if (remain <= step) {
      motion.position.copy(motion.stop);
      motion.mode = "settled";
    } else {
      motion.position.addScaledVector(motion.chargeDir, step);
    }
  } else {
    motion.settle = Math.min(1, motion.settle + dt / SETTLE_TIME);
    const settled = easeOutCubic(motion.settle);
    motion.phase += RUN_HZ * (1 - settled) * TAU * dt;
    motion.yaw = dampAngle(
      motion.yaw,
      faceYaw(motion.chargeDir.set(-motion.position.x, 0, -motion.position.z)),
      6,
      dt,
    );
  }

  const pace = motion.mode === "approach" ? 0 : smoothstep(motion.gait);
  motion.bobTime += dt * (0.9 + pace * 0.7);
}

function swingAngles(motion: Motion) {
  const pace = motion.mode === "approach" ? 0 : smoothstep(motion.gait);
  const settled = motion.mode === "settled" ? easeOutCubic(motion.settle) : 0;
  const amp = (WALK_AMP + (RUN_AMP - WALK_AMP) * pace) * (1 - settled);
  const bobAmp = (WALK_BOB + (RUN_BOB - WALK_BOB) * pace) * (1 - settled) + QUIET_BOB * settled;
  return { amp, bobAmp };
}

function poseCube(cube: Cube, motion: Motion, amp: number, bobAmp: number) {
  const posed = motion.posed;
  if (!cube.pivot || !cube.joint || amp === 0) {
    posed.copy(cube.rest);
  } else {
    const upper = Math.sin(motion.phase + cube.phaseOffset) * amp;
    const lower = Math.sin(motion.phase + cube.phaseOffset - LAG) * amp;
    posed.copy(cube.rest).sub(cube.pivot);
    posed.applyAxisAngle(SWING_AXIS, -upper);
    if (cube.lower) {
      const jointRel = motion.jointRel.copy(cube.joint).sub(cube.pivot).applyAxisAngle(SWING_AXIS, -upper);
      const extra = -(lower - upper);
      posed.sub(jointRel);
      posed.applyAxisAngle(SWING_AXIS, extra);
      posed.add(jointRel);
    }
    posed.add(cube.pivot);
  }

  posed.y += Math.sin(motion.bobTime * TAU + cube.bobPhase) * bobAmp * cube.bobWeight;
  posed.applyAxisAngle(UP, motion.yaw);
  posed.add(motion.position);
  return cube.lower && cube.pivot ? Math.sin(motion.phase + cube.phaseOffset - LAG) * amp : cube.pivot ? Math.sin(motion.phase + cube.phaseOffset) * amp : 0;
}

function writeInstances(mesh: THREE.InstancedMesh, cubes: Cube[], motion: Motion) {
  const { amp, bobAmp } = swingAngles(motion);
  const dummy = motion.dummy;
  for (let i = 0; i < cubes.length; i += 1) {
    const cube = cubes[i];
    const swing = poseCube(cube, motion, amp, bobAmp);
    dummy.position.copy(motion.posed);
    dummy.rotation.set(0, motion.yaw, 0);
    dummy.rotateX(-swing);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

export function Runner({
  geometry,
  material,
  color,
  seed,
  spawn,
  inward,
  stop,
  reducedMotion,
}: RunnerProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  const cubes = useMemo(() => buildCubes(color, seed), [color, seed]);
  const motion = useMemo<Motion>(() => {
    const atRest = reducedMotion;
    const position = new THREE.Vector3(...(atRest ? stop : spawn));
    const inwardDir = new THREE.Vector3(...inward);
    if (inwardDir.lengthSq() > 0) inwardDir.normalize();
    return {
      mode: atRest ? "settled" : "approach",
      position,
      inward: inwardDir,
      stop: new THREE.Vector3(...stop),
      chargeDir: new THREE.Vector3(-position.x, 0, -position.z),
      yaw: atRest ? Math.atan2(-position.x, -position.z) : Math.atan2(inwardDir.x, inwardDir.z),
      phase: seed,
      bobTime: seed,
      gait: 0,
      settle: atRest ? 1 : 0,
      posed: new THREE.Vector3(),
      jointRel: new THREE.Vector3(),
      box: new THREE.Box3(),
      frustum: new THREE.Frustum(),
      proj: new THREE.Matrix4(),
      dummy: new THREE.Object3D(),
    };
  }, [inward, reducedMotion, seed, spawn, stop]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < cubes.length; i += 1) mesh.setColorAt(i, cubes[i].color);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    writeInstances(mesh, cubes, motion);
  }, [cubes, motion]);

  useFrame((state, dt) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    stepMotion(motion, state.camera, Math.min(dt, MAX_STEP), reducedRef.current);
    writeInstances(mesh, cubes, motion);
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, FIGURE.length]}
      frustumCulled={false}
      renderOrder={2}
      dispose={null}
    />
  );
}
