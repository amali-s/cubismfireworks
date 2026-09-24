import { useMemo, useState } from "react";
import { CubismItem, CubismReveal, CubismStage } from "../cubism/index.ts";

function useProofTile() {
  return useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 280;
    canvas.height = 360;
    const context = canvas.getContext("2d");
    if (!context) return canvas;
    context.fillStyle = "#d64545";
    context.fillRect(24, 28, 232, 304);
    context.fillStyle = "#f0c14a";
    context.fillRect(52, 60, 116, 96);
    context.fillStyle = "#2c6bed";
    context.beginPath();
    context.arc(176, 226, 58, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#141414";
    context.fillRect(72, 268, 136, 18);
    return canvas;
  }, []);
}

export default function App() {
  const tile = useProofTile();
  const [open, setOpen] = useState(false);

  return (
    <>
      <CubismStage />
      <main>
        <h1>Cubism</h1>
        <p>Hover the tile, then click it.</p>
        <div className="menu-item">
          <CubismItem src={tile} width={280} height={360} onShatter={() => setOpen(true)} />
        </div>
        <CubismReveal active={open}>
          <section>
            <h2>Next view</h2>
            <p>The cubes carried this page in.</p>
          </section>
        </CubismReveal>
      </main>
    </>
  );
}
