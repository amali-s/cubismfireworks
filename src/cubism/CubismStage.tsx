import { useLayoutEffect, useSyncExternalStore } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { CubismMesh } from "./CubismMesh.tsx";
import { CUBISM_FOV, cameraDistance, getRuntimes, subscribeRuntimes } from "./runtime.ts";

function PixelCamera() {
  const camera = useThree((state) => state.camera);
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);

  useLayoutEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const viewportHeight = Math.max(height, 1);
    camera.fov = CUBISM_FOV;
    camera.aspect = width / viewportHeight;
    camera.near = 0.1;
    camera.far = 20000;
    camera.position.set(0, 0, cameraDistance(viewportHeight));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, width, height]);

  return null;
}

function StageItems() {
  const runtimes = useSyncExternalStore(subscribeRuntimes, getRuntimes, getRuntimes);
  return (
    <>
      {runtimes.map((runtime) => (
        <CubismMesh key={`${runtime.id}:${runtime.revision}`} runtime={runtime} />
      ))}
    </>
  );
}

export function CubismStage() {
  return (
    <Canvas
      aria-hidden
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true }}
      camera={{ fov: CUBISM_FOV, near: 0.1, far: 20000, position: [0, 0, 800] }}
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 2,
      }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.toneMapping = THREE.NoToneMapping;
      }}
    >
      <PixelCamera />
      <StageItems />
    </Canvas>
  );
}
