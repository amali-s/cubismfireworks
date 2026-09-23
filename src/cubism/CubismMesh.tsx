import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { easeInCubic, smoothstep } from "./easing.ts";
import { cameraDistance, type ItemRuntime } from "./runtime.ts";

const RIPPLE_SECONDS = 0.72;
const STAGGER = 0.64;
const SLAB = 0.045;
const WAVE = 28;
const CELL_INSET = 0.985;
const SHATTER_FADE_START = 0.7;

type BurstSeed = {
  push: number;
  flyScale: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  fallbackAngle: number;
};

function hash(index: number) {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function gridMetrics(width: number, height: number, columns: number) {
  const rows = Math.max(1, Math.round((columns * height) / Math.max(width, 1)));
  const cellW = width / Math.max(columns, 1);
  const cellH = height / rows;
  return {
    cellW,
    cellH,
    depth: Math.min(cellW, cellH),
  };
}

function extrusionAt(distanceNorm: number, progress: number) {
  const delay = distanceNorm * STAGGER;
  const span = 1 - STAGGER;
  return smoothstep((progress - delay) / span);
}

function shatterOpacity(progress: number) {
  if (progress <= SHATTER_FADE_START) return 1;
  return 1 - (progress - SHATTER_FADE_START) / (1 - SHATTER_FADE_START);
}

function createCubeMaterial() {
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 1,
    toneMapped: false,
  });

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float instanceOpacity;
varying float vInstanceOpacity;
varying vec3 vCubeNormal;`,
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
vInstanceOpacity = instanceOpacity;
vec3 cubeNormal = normal;
#ifdef USE_INSTANCING
  mat3 im = mat3( instanceMatrix );
  cubeNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
  cubeNormal = im * cubeNormal;
#endif
vCubeNormal = normalize( normalMatrix * cubeNormal );`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying float vInstanceOpacity;
varying vec3 vCubeNormal;`,
      )
      .replace(
        "#include <opaque_fragment>",
        `if ( vInstanceOpacity < 0.004 ) discard;
float shade = dot( normalize( vCubeNormal ), vec3( 0.2, 0.45, 0.87 ) );
diffuseColor.rgb *= 0.86 + 0.14 * clamp( shade, 0.0, 1.0 );
diffuseColor.a *= vInstanceOpacity;
#include <opaque_fragment>`,
      );
  };

  material.customProgramCacheKey = () => "cubism-cube-v2";
  return material;
}

function setMediaOpacity(runtime: ItemRuntime, opacity: number) {
  runtime.button?.style.setProperty("--cubism-media-opacity", opacity.toFixed(3));
}

export function CubismMesh({ runtime }: { runtime: ItemRuntime }) {
  if (runtime.samples.length === 0 || runtime.width <= 0 || runtime.height <= 0) return null;
  return <ActiveMesh runtime={runtime} />;
}

function ActiveMesh({ runtime }: { runtime: ItemRuntime }) {
  const samples = runtime.samples;
  const gl = useThree((state) => state.gl);
  const viewportHeight = useThree((state) => state.size.height);

  const metrics = useMemo(
    () => gridMetrics(runtime.width, runtime.height, runtime.columns),
    [runtime.width, runtime.height, runtime.columns],
  );

  const seeds = useMemo<BurstSeed[]>(
    () =>
      samples.map((_, index) => ({
        push: 52 + hash(index + 7) * 136,
        flyScale: 0.8 + hash(index + 11) * 0.32,
        spinX: (hash(index + 1) - 0.5) * 8.4,
        spinY: (hash(index + 2) - 0.5) * 8.4,
        spinZ: (hash(index + 3) - 0.5) * 6.2,
        fallbackAngle: hash(index + 19) * Math.PI * 2,
      })),
    [samples],
  );

  const mesh = useMemo(() => {
    const { cellW, cellH, depth } = gridMetrics(runtime.width, runtime.height, runtime.columns);
    const geometry = new THREE.BoxGeometry(cellW * CELL_INSET, cellH * CELL_INSET, depth);
    const opacity = new THREE.InstancedBufferAttribute(new Float32Array(samples.length), 1);
    opacity.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("instanceOpacity", opacity);

    const instanced = new THREE.InstancedMesh(geometry, createCubeMaterial(), samples.length);
    instanced.frustumCulled = false;
    instanced.visible = false;
    instanced.matrixAutoUpdate = true;

    const color = new THREE.Color();
    for (let index = 0; index < samples.length; index++) {
      const [red, green, blue] = samples[index].color;
      color.setRGB(red, green, blue, THREE.SRGBColorSpace);
      instanced.setColorAt(index, color);
      opacity.setX(index, 0);
    }
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
    opacity.needsUpdate = true;
    return instanced;
  }, [runtime.width, runtime.height, runtime.columns, samples]);

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      const material = mesh.material;
      if (!Array.isArray(material)) material.dispose();
    };
  }, [mesh]);

  useFrame((_, delta) => {
    const button = runtime.button;
    if (!button || runtime.reduced) {
      mesh.visible = false;
      return;
    }

    const step = Math.min(delta, 0.05);
    const canvasRect = gl.domElement.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      mesh.visible = false;
      return;
    }

    mesh.position.set(
      rect.left + rect.width / 2 - (canvasRect.left + canvasRect.width / 2),
      canvasRect.top + canvasRect.height / 2 - (rect.top + rect.height / 2),
      0,
    );

    const opacity = mesh.geometry.getAttribute("instanceOpacity") as THREE.InstancedBufferAttribute;
    const dummy = scratch.dummy;
    const maxDistance = Math.hypot(runtime.width, runtime.height) || 1;
    const material = mesh.material;
    const cubeMaterial = Array.isArray(material) ? material[0] : material;

    if (runtime.phase === "shatter") {
      if (runtime.shatterMs > 0 && runtime.shatterElapsed >= runtime.shatterMs) {
        mesh.visible = false;
        return;
      }
      runtime.shatterElapsed = Math.min(runtime.shatterMs, runtime.shatterElapsed + step * 1000);
      const t = runtime.shatterMs <= 0 ? 1 : runtime.shatterElapsed / runtime.shatterMs;
      const travel = easeInCubic(t);
      const fade = shatterOpacity(t);
      const fly = cameraDistance(Math.max(viewportHeight, 1)) * 0.88;
      setMediaOpacity(runtime, 0);
      mesh.visible = t < 1 && fade > 0;
      cubeMaterial.depthWrite = fade > 0.95;

      for (let index = 0; index < samples.length; index++) {
        const sample = samples[index];
        const seed = seeds[index];
        let dx = sample.x - runtime.clickX;
        let dy = sample.y - runtime.clickY;
        const length = Math.hypot(dx, dy);
        if (length < 0.001) {
          dx = Math.cos(seed.fallbackAngle);
          dy = Math.sin(seed.fallbackAngle);
        } else {
          dx /= length;
          dy /= length;
        }

        dummy.position.set(
          sample.x + dx * seed.push * travel,
          sample.y + dy * seed.push * travel,
          metrics.depth * 0.5 + travel * fly * seed.flyScale,
        );
        dummy.rotation.set(seed.spinX * t, seed.spinY * t, seed.spinZ * t);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        opacity.setX(index, fade);
      }

      mesh.instanceMatrix.needsUpdate = true;
      opacity.needsUpdate = true;
      return;
    }

    const direction = runtime.phase === "hover" ? 1 : -1;
    runtime.progress = Math.min(1, Math.max(0, runtime.progress + (direction * step) / RIPPLE_SECONDS));
    const imageOpacity = 1 - smoothstep((runtime.progress - 0.12) / 0.88);
    setMediaOpacity(runtime, imageOpacity);

    if (runtime.progress <= 0) {
      mesh.visible = false;
      cubeMaterial.depthWrite = true;
      return;
    }

    mesh.visible = true;
    cubeMaterial.depthWrite = true;

    for (let index = 0; index < samples.length; index++) {
      const sample = samples[index];
      const distance = Math.hypot(sample.x - runtime.pointerX, sample.y - runtime.pointerY);
      const extrusion = extrusionAt(Math.min(1, distance / maxDistance), runtime.progress);
      const scaleZ = SLAB + (1 - SLAB) * extrusion;
      const wave = Math.sin(Math.PI * extrusion) * WAVE;
      dummy.position.set(sample.x, sample.y, metrics.depth * scaleZ * 0.5 + wave);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, scaleZ);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      opacity.setX(index, smoothstep(Math.min(1, extrusion / 0.32)));
    }

    mesh.instanceMatrix.needsUpdate = true;
    opacity.needsUpdate = true;
  });

  return <primitive object={mesh} />;
}

const scratch = {
  dummy: new THREE.Object3D(),
};
