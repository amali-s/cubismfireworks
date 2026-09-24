import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { sampleImage } from "./sampleImage.ts";
import { createRuntime, publishRuntime, registerRuntime, type ItemRuntime } from "./runtime.ts";

export type CubismItemProps = {
  src: string | HTMLCanvasElement;
  width: number;
  height: number;
  columns?: number;
  shatterMs?: number;
  onShatter: () => void;
};

const buttonStyle: CSSProperties = {
  padding: 0,
  border: "none",
  margin: 0,
  background: "transparent",
  display: "block",
  cursor: "pointer",
  position: "relative",
  overflow: "hidden",
  color: "inherit",
  appearance: "none",
  WebkitAppearance: "none",
  lineHeight: 0,
};

const mediaStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "block",
  objectFit: "fill",
  pointerEvents: "none",
  opacity: "var(--cubism-media-opacity, 1)",
};

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function localPoint(clientX: number, clientY: number, rect: DOMRect) {
  return {
    x: clientX - rect.left - rect.width / 2,
    y: rect.top + rect.height / 2 - clientY,
  };
}

export function CubismItem({
  src,
  width,
  height,
  columns = 28,
  shatterMs = 1100,
  onShatter,
}: CubismItemProps) {
  const runtimeRef = useRef<ItemRuntime | null>(null);
  if (runtimeRef.current === null) runtimeRef.current = createRuntime();
  const runtime = runtimeRef.current;
  runtime.shatterMs = shatterMs;
  runtime.onShatter = onShatter;

  const [hidden, setHidden] = useState(false);

  useLayoutEffect(() => registerRuntime(runtime), [runtime]);

  useEffect(() => {
    let cancelled = false;
    runtime.width = width;
    runtime.height = height;
    runtime.columns = columns;

    if (width <= 0 || height <= 0) {
      runtime.samples = [];
      runtime.image = null;
      runtime.revision += 1;
      publishRuntime();
      return;
    }

    sampleImage(src, width, height, columns).then(
      ({ samples, image }) => {
        if (cancelled) return;
        runtime.width = width;
        runtime.height = height;
        runtime.columns = columns;
        runtime.samples = samples;
        runtime.image = image;
        runtime.revision += 1;
        publishRuntime();
      },
      () => {
        if (cancelled) return;
        runtime.samples = [];
        runtime.image = null;
        runtime.revision += 1;
        publishRuntime();
      },
    );

    return () => {
      cancelled = true;
    };
  }, [runtime, src, width, height, columns]);

  const trackPointer = (event: PointerEvent<HTMLButtonElement>) => {
    if (runtime.phase === "shatter") return;
    const point = localPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
    runtime.pointerX = point.x;
    runtime.pointerY = point.y;
  };

  const onPointerEnter = (event: PointerEvent<HTMLButtonElement>) => {
    if (runtime.phase === "shatter") return;
    trackPointer(event);
    runtime.phase = "hover";
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (runtime.phase !== "hover") return;
    trackPointer(event);
  };

  const onPointerLeave = () => {
    if (runtime.phase === "shatter") return;
    runtime.phase = "idle";
  };

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (runtime.phase === "shatter") return;
    const reduced = prefersReducedMotion();
    runtime.phase = "shatter";
    runtime.reduced = reduced;

    if (reduced) {
      setHidden(true);
      onShatter();
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const point =
      event.detail === 0
        ? { x: 0, y: 0 }
        : localPoint(event.clientX, event.clientY, rect);
    runtime.clickX = point.x;
    runtime.clickY = point.y;
    runtime.shatterElapsed = 0;
    event.currentTarget.style.setProperty("--cubism-media-opacity", "0");
    onShatter();
  };

  if (hidden) return null;

  return (
    <button
      type="button"
      ref={(node) => {
        runtime.button = node;
      }}
      onPointerEnter={onPointerEnter}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onClick={onClick}
      style={{ ...buttonStyle, width, height }}
    >
      <span style={{ display: "block", width: "100%", height: "100%" }}>
        {typeof src === "string" ? (
          <img src={src} alt="" draggable={false} style={mediaStyle} />
        ) : (
          <CanvasTile source={src} style={mediaStyle} />
        )}
      </span>
    </button>
  );
}

function CanvasTile({ source, style }: { source: HTMLCanvasElement; style: CSSProperties }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0);
  }, [source]);

  return <canvas ref={canvasRef} aria-hidden style={style} />;
}
