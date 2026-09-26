import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Grid } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BODY_COLORS, CUBE_SIZE } from "./figure.ts";
import { Runner } from "./Runner.tsx";

const EYE = 1.55;
const FOG = "#111111";
const GRID_COLOR = "#3d4450";
const WALL_Z = -10.2;
const WALL_WIDTH = 42;
const WALL_HEIGHT = 14;

const RUNNERS = [
  {
    name: "left",
    color: BODY_COLORS[0],
    seed: 1.3,
    spawn: [-10.6, 0, -6.4] as const,
    inward: [1, 0, 0.34] as const,
    stop: [-1.15, 0, -3.58] as const,
  },
  {
    name: "deep",
    color: BODY_COLORS[1],
    seed: 4.8,
    spawn: [0.08, 0, -18.6] as const,
    inward: [-0.01, 0, 1] as const,
    stop: [0.04, 0, -4.15] as const,
  },
  {
    name: "right",
    color: BODY_COLORS[2],
    seed: 8.2,
    spawn: [11.1, 0, -7.1] as const,
    inward: [-1, 0, 0.3] as const,
    stop: [1.2, 0, -3.5] as const,
  },
];

function subscribeReducedMotion(onStoreChange: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function reducedMotionSnapshot() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function FixedEye() {
  const camera = useThree((state) => state.camera);

  useLayoutEffect(() => {
    camera.position.set(0, EYE, 0);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, EYE, -1);
    camera.updateMatrixWorld();
  }, [camera]);

  return null;
}

function Floor() {
  const ref = useRef<THREE.Mesh>(null);

  useLayoutEffect(() => {
    const material = ref.current?.material;
    if (!material || Array.isArray(material)) return;
    material.depthWrite = false;
    material.transparent = true;
  }, []);

  return (
    <Grid
      ref={ref}
      args={[4, 4]}
      position={[0, 0.002, 0]}
      cellSize={1}
      cellThickness={0.9}
      cellColor={GRID_COLOR}
      sectionSize={1}
      sectionThickness={0}
      sectionColor={GRID_COLOR}
      fadeDistance={5}
      fadeStrength={1.2}
      fadeFrom={1}
      infiniteGrid
      followCamera
      renderOrder={0}
      frustumCulled={false}
    />
  );
}

const horizonVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Edge fade only. A camera-distance fade would erase the wall, since it sits in the fog.
const horizonFragment = /* glsl */ `
  varying vec3 vWorld;
  uniform vec3 uColor;
  uniform vec2 uResolution;
  uniform float uCell;
  uniform float uThickness;

  float gridLine(vec2 p) {
    vec2 r = p / uCell;
    vec2 grid = abs(fract(r - 0.5) - 0.5) / fwidth(r);
    float line = min(grid.x, grid.y) + 1.0 - uThickness;
    return 1.0 - min(line, 1.0);
  }

  void main() {
    float line = gridLine(vWorld.xy);
    float ndcX = abs(gl_FragCoord.x / uResolution.x * 2.0 - 1.0);
    float ndcY = gl_FragCoord.y / uResolution.y * 2.0 - 1.0;
    float side = smoothstep(0.3, 1.0, ndcX);
    float top = smoothstep(0.1, 0.95, ndcY);
    float alpha = line * (1.0 - side) * (1.0 - top) * 0.58;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function Horizon() {
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uColor: { value: new THREE.Color(GRID_COLOR) },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uCell: { value: 1 },
        uThickness: { value: 0.9 },
      },
      vertexShader: horizonVertex,
      fragmentShader: horizonFragment,
    });
  }, []);

  useEffect(() => () => material.dispose(), [material]);

  useFrame((state) => {
    const dpr = state.gl.getPixelRatio();
    material.uniforms.uResolution.value.set(state.size.width * dpr, state.size.height * dpr);
  });

  return (
    <mesh position={[0, WALL_HEIGHT / 2, WALL_Z]} renderOrder={-1} frustumCulled={false}>
      <planeGeometry args={[WALL_WIDTH, WALL_HEIGHT]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function Scene({ reducedMotion }: { reducedMotion: boolean }) {
  const geometry = useMemo(() => new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE), []);
  const material = useMemo(
    () =>
      new THREE.MeshLambertMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0.82,
        depthWrite: true,
      }),
    [],
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  return (
    <>
      <FixedEye />
      <color attach="background" args={[FOG]} />
      <fog attach="fog" args={[FOG, 4.5, 9.5]} />
      <ambientLight intensity={0.36} />
      <directionalLight position={[1.3, 8.2, 4.4]} intensity={0.82} />
      <Floor />
      <Horizon />
      {RUNNERS.map((runner) => (
        <Runner
          key={runner.name}
          geometry={geometry}
          material={material}
          color={runner.color}
          seed={runner.seed}
          spawn={runner.spawn}
          inward={runner.inward}
          stop={runner.stop}
          reducedMotion={reducedMotion}
        />
      ))}
    </>
  );
}

export function FieldScene() {
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, reducedMotionSnapshot, () => false);

  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
      camera={{ fov: 60, near: 0.08, far: 15, position: [0, EYE, 0] }}
      style={{ width: "100%", height: "100%", display: "block", pointerEvents: "auto" }}
      onCreated={({ gl, camera }) => {
        gl.setClearColor(FOG, 1);
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.toneMapping = THREE.NoToneMapping;
        camera.position.set(0, EYE, 0);
        camera.lookAt(0, EYE, -1);
        camera.updateMatrixWorld();
      }}
    >
      <Scene reducedMotion={reducedMotion} />
    </Canvas>
  );
}
