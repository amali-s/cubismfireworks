import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { easeInCubic, easeOutCubic, smoothstep } from "../cubism/easing.ts";
import {
  FIGURE_HEIGHT,
  LIGHTNESS_JITTER,
  cellCenter,
  figureCells,
  isLowerHalf,
  limbPose,
  type FigureCell,
  type WeaponName,
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
const REST_OPACITY = 0.82;
const SHATTER_FADE_START = 0.7;
const BURST_SECONDS = 1.1;
const REDUCED_FADE_SECONDS = 0.34;
const GRAVITY = 3.2;

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

type Shard = {
  origin: THREE.Vector3;
  quaternion: THREE.Quaternion;
  push: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  fallback: THREE.Vector3;
};

type BurstPhase = "idle" | "fly" | "gone";

type BurstState = {
  phase: BurstPhase;
  elapsed: number;
  duration: number;
  reduced: boolean;
  hit: THREE.Vector3;
  dir: THREE.Vector3;
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
  weapon?: WeaponName;
};

function shatterOpacity(progress: number) {
  if (progress <= SHATTER_FADE_START) return 1;
  return 1 - (progress - SHATTER_FADE_START) / (1 - SHATTER_FADE_START);
}

function hash01(n: number) {
  const value = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function bobWeight(cell: FigureCell) {
  if (cell.part === "torso") {
    const fromCore = Math.abs(cell.x) + Math.abs(cell.y - 8);
    return fromCore === 0 ? 0.015 : 0.04 + fromCore * 0.015;
  }
  if (cell.part === "head" || cell.part === "neck") return 0.1;
  if (cell.part === "armL" || cell.part === "armR" || cell.part === "weapon") {
    return 0.06 + 0.94 * ((10 - cell.y) / 4);
  }
  return 0.06 + 0.94 * ((5 - cell.y) / 5);
}

function buildCubes(color: string, seed: number, weapon: WeaponName): Cube[] {
  const base = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl, THREE.SRGBColorSpace);
  return figureCells(weapon).map((cell, index) => {
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
  mesh.boundingSphere = null;
}

function buildShards(count: number, seed: number): Shard[] {
  const shards: Shard[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = hash01(index + 19 + seed * 3.1) * TAU;
    const lift = (hash01(index + 29 + seed * 5.3) - 0.5) * 2;
    shards.push({
      origin: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      push: 0.85 + hash01(index + 7 + seed * 13.1) * 1.9,
      spinX: (hash01(index + 1 + seed) - 0.5) * 8.4,
      spinY: (hash01(index + 2 + seed) - 0.5) * 8.4,
      spinZ: (hash01(index + 3 + seed) - 0.5) * 6.2,
      fallback: new THREE.Vector3(Math.cos(angle), lift, Math.sin(angle)).normalize(),
    });
  }
  return shards;
}

function snapshotPose(cubes: Cube[], shards: Shard[], motion: Motion) {
  const { amp } = swingAngles(motion);
  const dummy = motion.dummy;
  for (let i = 0; i < cubes.length; i += 1) {
    const swing = poseCube(cubes[i], motion, amp, 0);
    dummy.position.copy(motion.posed);
    dummy.rotation.set(0, motion.yaw, 0);
    dummy.rotateX(-swing);
    shards[i].origin.copy(dummy.position);
    shards[i].quaternion.copy(dummy.quaternion);
  }
}

function writeBurst(
  mesh: THREE.InstancedMesh,
  material: THREE.Material,
  shards: Shard[],
  burst: BurstState,
  dummy: THREE.Object3D,
) {
  const duration = burst.duration;
  const t = duration <= 0 ? 1 : burst.elapsed / duration;
  const fade = burst.reduced ? 1 - t : shatterOpacity(t);
  material.opacity = REST_OPACITY * fade;
  material.depthWrite = fade > 0.95;
  if (t >= 1) {
    mesh.visible = false;
    burst.phase = "gone";
    return;
  }

  const travel = burst.reduced ? 0 : easeInCubic(t);
  const fall = burst.reduced ? 0 : 0.5 * GRAVITY * burst.elapsed * burst.elapsed;
  const dir = burst.dir;
  for (let i = 0; i < shards.length; i += 1) {
    const shard = shards[i];
    dummy.position.copy(shard.origin);
    dummy.quaternion.copy(shard.quaternion);
    if (!burst.reduced) {
      dir.copy(shard.origin).sub(burst.hit);
      if (dir.lengthSq() < 1e-6) dir.copy(shard.fallback);
      else dir.normalize();
      dummy.position.addScaledVector(dir, shard.push * travel);
      dummy.position.y -= fall;
      dummy.rotateX(shard.spinX * t);
      dummy.rotateY(shard.spinY * t);
      dummy.rotateZ(shard.spinZ * t);
    }
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.boundingSphere = null;
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
  weapon = "sword",
}: RunnerProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  const cubes = useMemo(() => buildCubes(color, seed, weapon), [color, seed, weapon]);
  const shards = useMemo(() => buildShards(cubes.length, seed), [cubes.length, seed]);
  const bodyMaterial = useMemo(() => {
    const next = material.clone();
    next.transparent = true;
    next.opacity = REST_OPACITY;
    next.depthWrite = true;
    return next;
  }, [material]);
  const burst = useRef<BurstState>({
    phase: "idle",
    elapsed: 0,
    duration: BURST_SECONDS,
    reduced: false,
    hit: new THREE.Vector3(),
    dir: new THREE.Vector3(),
  });
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

  useEffect(() => () => bodyMaterial.dispose(), [bodyMaterial]);

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
    const stateBurst = burst.current;
    if (stateBurst.phase === "gone") return;
    if (stateBurst.phase === "fly") {
      stateBurst.elapsed = Math.min(stateBurst.duration, stateBurst.elapsed + Math.min(dt, MAX_STEP));
      writeBurst(mesh, bodyMaterial, shards, stateBurst, motion.dummy);
      return;
    }
    stepMotion(motion, state.camera, Math.min(dt, MAX_STEP), reducedRef.current);
    writeInstances(mesh, cubes, motion);
  });

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const mesh = meshRef.current;
    const stateBurst = burst.current;
    if (!mesh || stateBurst.phase !== "idle") return;
    const reduced = reducedRef.current;
    snapshotPose(cubes, shards, motion);
    stateBurst.hit.copy(event.point);
    stateBurst.elapsed = 0;
    stateBurst.reduced = reduced;
    stateBurst.duration = reduced ? REDUCED_FADE_SECONDS : BURST_SECONDS;
    stateBurst.phase = "fly";
    writeBurst(mesh, bodyMaterial, shards, stateBurst, motion.dummy);
  };

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, bodyMaterial, cubes.length]}
      frustumCulled={false}
      renderOrder={2}
      dispose={null}
      onClick={onClick}
    />
  );
}
