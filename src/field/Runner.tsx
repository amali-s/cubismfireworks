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
const REST_OPACITY = 0.36;
const SHATTER_FADE_START = 0.7;
const BURST_SECONDS = 1.1;
const REDUCED_FADE_SECONDS = 0.34;
const GRAVITY = 0.25;
const HOLD_DISTANCE = 8;
const FAR_HOLD = 14.5;
const RECYCLE_DELAY = 0.85;
const QUIET_AMP = 0.16;
const QUIET_HZ = 0.8;
const QUIET_GAIT_BOB = 0.022;

const UP = new THREE.Vector3(0, 1, 0);
const SWING_AXIS = new THREE.Vector3(1, 0, 0);

type Mode = "approach" | "hold" | "commit" | "settled" | "recycle";
export type RunnerKind = "charge" | "cross";

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
  kind: RunnerKind;
  routeIndex: number;
  wait: number;
  recycle: number;
  position: THREE.Vector3;
  inward: THREE.Vector3;
  stop: THREE.Vector3;
  exit: THREE.Vector3;
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

export type RunnerRoute = {
  spawn: readonly [number, number, number];
  inward: readonly [number, number, number];
  stop: readonly [number, number, number];
  exit?: readonly [number, number, number];
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
  kind: RunnerKind;
  routes: readonly [RunnerRoute, RunnerRoute];
  startDelay: number;
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

function placeOnRoute(motion: Motion, route: RunnerRoute, index: number, reduced: boolean) {
  motion.routeIndex = index;
  motion.inward.set(route.inward[0], route.inward[1], route.inward[2]);
  if (motion.inward.lengthSq() > 0) motion.inward.normalize();
  motion.stop.set(route.stop[0], route.stop[1], route.stop[2]);
  const exit = route.exit ?? route.stop;
  motion.exit.set(exit[0], exit[1], exit[2]);
  motion.gait = 0;
  motion.recycle = 0;
  motion.wait = 0;
  if (reduced) {
    motion.mode = "settled";
    motion.position.copy(motion.stop);
    motion.settle = 1;
    motion.chargeDir.set(-motion.position.x, 0, -motion.position.z);
    motion.yaw = Math.atan2(-motion.position.x, -motion.position.z);
    return;
  }
  motion.mode = "approach";
  motion.position.set(route.spawn[0], route.spawn[1], route.spawn[2]);
  motion.settle = 0;
  motion.chargeDir.copy(motion.inward);
  motion.yaw = Math.atan2(motion.inward.x, motion.inward.z);
}

function beginCommit(motion: Motion) {
  const target = motion.kind === "cross" ? motion.exit : motion.stop;
  motion.chargeDir.set(target.x - motion.position.x, 0, target.z - motion.position.z);
  if (motion.chargeDir.lengthSq() < 1e-6) {
    motion.position.set(target.x, motion.position.y, target.z);
    if (motion.kind === "cross") {
      motion.mode = "recycle";
      motion.recycle = 0;
      motion.gait = 0;
    } else {
      motion.mode = "settled";
    }
    return;
  }
  motion.chargeDir.normalize();
  motion.mode = "commit";
}

function beginRecycle(motion: Motion, mesh: THREE.Object3D) {
  motion.mode = "recycle";
  motion.recycle = 0;
  motion.gait = 0;
  mesh.visible = false;
}

function stepMotion(motion: Motion, camera: THREE.Camera, dt: number, reduced: boolean) {
  if (motion.mode === "recycle") return true;

  if (reduced) {
    motion.mode = "settled";
    motion.position.copy(motion.stop);
    motion.gait = 0;
    motion.settle = 1;
    motion.yaw = dampAngle(motion.yaw, faceYaw(motion.chargeDir.set(-motion.position.x, 0, -motion.position.z)), 8, dt);
    motion.bobTime += dt * 0.85;
    return false;
  }

  if (motion.mode === "approach" && motion.wait > 0) {
    motion.wait = Math.max(0, motion.wait - dt);
    motion.gait = 0;
    motion.settle = 0;
    motion.bobTime += dt * 0.85;
    return false;
  }

  if (motion.mode === "approach") {
    if (inView(motion, camera)) {
      beginCommit(motion);
    } else {
      const dist = camera.position.distanceTo(motion.position);
      if (dist <= HOLD_DISTANCE) {
        motion.mode = "hold";
      } else {
        motion.position.addScaledVector(motion.inward, WALK_SPEED * dt);
        const nextDist = camera.position.distanceTo(motion.position);
        if (inView(motion, camera)) {
          beginCommit(motion);
        } else if (nextDist <= HOLD_DISTANCE || nextDist >= FAR_HOLD) {
          motion.mode = "hold";
        } else {
          motion.phase += WALK_HZ * TAU * dt;
          motion.yaw = dampAngle(motion.yaw, faceYaw(motion.inward), 8, dt);
          motion.gait = 0;
          motion.settle = 0;
        }
      }
    }
  } else if (motion.mode === "hold") {
    motion.phase += QUIET_HZ * TAU * dt;
    motion.yaw = dampAngle(motion.yaw, faceYaw(motion.inward), 6, dt);
    motion.gait = 0;
    motion.settle = 0;
    if (inView(motion, camera)) beginCommit(motion);
  } else if (motion.mode === "commit") {
    motion.gait = Math.min(1, motion.gait + dt / CHARGE_RAMP);
    const pace = smoothstep(motion.gait);
    const speed = WALK_SPEED + (RUN_SPEED - WALK_SPEED) * pace;
    motion.phase += (WALK_HZ + (RUN_HZ - WALK_HZ) * pace) * TAU * dt;
    motion.yaw = dampAngle(motion.yaw, faceYaw(motion.chargeDir), 8, dt);
    const target = motion.kind === "cross" ? motion.exit : motion.stop;
    const remain = Math.hypot(target.x - motion.position.x, target.z - motion.position.z);
    const step = speed * dt;
    if (remain <= step) {
      motion.position.set(target.x, motion.position.y, target.z);
      if (motion.kind === "cross") {
        motion.mode = "recycle";
        motion.recycle = 0;
        motion.gait = 0;
      } else {
        motion.mode = "settled";
      }
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

  if (motion.mode === "recycle") return true;
  const pace = motion.mode === "approach" || motion.mode === "hold" ? 0 : smoothstep(motion.gait);
  const bobRate = motion.mode === "hold" ? 0.65 : 0.9 + pace * 0.7;
  motion.bobTime += dt * bobRate;
  return false;
}

function swingAngles(motion: Motion) {
  if (motion.mode === "hold") return { amp: QUIET_AMP, bobAmp: QUIET_GAIT_BOB };
  const pace = motion.mode === "approach" || motion.mode === "recycle" ? 0 : smoothstep(motion.gait);
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
      push: 0.12 + hash01(index + 7 + seed * 13.1) * 0.23,
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
    return true;
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
  return false;
}

export function Runner({
  geometry,
  material,
  color,
  seed,
  kind,
  routes,
  startDelay,
  reducedMotion,
  weapon = "sword",
}: RunnerProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  const routesRef = useRef(routes);
  routesRef.current = routes;
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
    const created: Motion = {
      mode: "approach",
      kind,
      routeIndex: 0,
      wait: 0,
      recycle: 0,
      position: new THREE.Vector3(),
      inward: new THREE.Vector3(),
      stop: new THREE.Vector3(),
      exit: new THREE.Vector3(),
      chargeDir: new THREE.Vector3(),
      yaw: 0,
      phase: seed,
      bobTime: seed,
      gait: 0,
      settle: 0,
      posed: new THREE.Vector3(),
      jointRel: new THREE.Vector3(),
      box: new THREE.Box3(),
      frustum: new THREE.Frustum(),
      proj: new THREE.Matrix4(),
      dummy: new THREE.Object3D(),
    };
    placeOnRoute(created, routes[0], 0, reducedMotion);
    if (!reducedMotion) created.wait = startDelay;
    return created;
  }, [kind, reducedMotion, routes, seed, startDelay]);

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
    const capped = Math.min(dt, MAX_STEP);
    const stateBurst = burst.current;
    if (stateBurst.phase === "fly") {
      stateBurst.elapsed = Math.min(stateBurst.duration, stateBurst.elapsed + capped);
      if (writeBurst(mesh, bodyMaterial, shards, stateBurst, motion.dummy)) beginRecycle(motion, mesh);
      return;
    }
    if (motion.mode === "recycle") {
      motion.recycle += capped;
      if (motion.recycle < RECYCLE_DELAY) return;
      const next = motion.routeIndex === 0 ? 1 : 0;
      placeOnRoute(motion, routesRef.current[next], next, reducedRef.current);
      stateBurst.phase = "idle";
      stateBurst.elapsed = 0;
      bodyMaterial.opacity = REST_OPACITY;
      bodyMaterial.depthWrite = true;
      writeInstances(mesh, cubes, motion);
      mesh.visible = true;
      return;
    }
    if (stepMotion(motion, state.camera, capped, reducedRef.current)) {
      beginRecycle(motion, mesh);
      return;
    }
    writeInstances(mesh, cubes, motion);
  });

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const mesh = meshRef.current;
    const stateBurst = burst.current;
    if (!mesh || stateBurst.phase !== "idle" || motion.mode === "recycle") return;
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
