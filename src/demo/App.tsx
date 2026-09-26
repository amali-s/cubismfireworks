import { useMemo, useState } from "react";
import { CubismItem, CubismReveal, CubismStage } from "../cubism/index.ts";
import { createMenuArt, TILE_HEIGHT, TILE_WIDTH, type MenuArtId } from "./art.ts";
import { FieldPage } from "./FieldPage.tsx";
import { ArchivePage, GalleryPage, StudioPage } from "./subpages.tsx";

const initialGeneration: Record<MenuArtId, number> = {
  gallery: 0,
  archive: 0,
  studio: 0,
  field: 0,
};

export default function App() {
  const art = useMemo(() => createMenuArt(), []);
  const [active, setActive] = useState<MenuArtId | null>(null);
  const [generation, setGeneration] = useState(initialGeneration);

  const close = () => {
    if (active === null) return;
    const id = active;
    setGeneration((current) => ({ ...current, [id]: current[id] + 1 }));
    setActive(null);
  };

  const page =
    active === "gallery" ? (
      <GalleryPage onBack={close} />
    ) : active === "archive" ? (
      <ArchivePage onBack={close} />
    ) : active === "studio" ? (
      <StudioPage onBack={close} />
    ) : active === "field" ? (
      <FieldPage onBack={close} />
    ) : null;

  return (
    <>
      <CubismStage />
      <main>
        <h1>Cubism</h1>
        <div className="menu">
          {art.map((item) => {
            const dimmed = active !== null && active !== item.id;
            return (
              <div key={item.id} className={dimmed ? "menu-item is-dimmed" : "menu-item"}>
                <CubismItem
                  key={`${item.id}-${generation[item.id]}`}
                  src={item.canvas}
                  width={TILE_WIDTH}
                  height={TILE_HEIGHT}
                  onShatter={() => {
                    setActive((current) => current ?? item.id);
                  }}
                />
              </div>
            );
          })}
        </div>
        <CubismReveal active={active !== null}>{page}</CubismReveal>
      </main>
    </>
  );
}
