import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { easeOutCubic } from "./easing.ts";

export type CubismRevealProps = {
  active: boolean;
  delayMs?: number;
  durationMs?: number;
  children: ReactNode;
};

type RevealMotion = {
  /** Mirrors `active` so a rising edge can reset before paint. */
  active: boolean;
  shown: boolean;
  opacity: number;
  offsetY: number;
};

const settled: RevealMotion = { active: false, shown: false, opacity: 0, offsetY: 12 };

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function CubismReveal({
  active,
  delayMs = 400,
  durationMs = 700,
  children,
}: CubismRevealProps) {
  const [motion, setMotion] = useState<RevealMotion>(settled);

  if (active !== motion.active) {
    if (!active) {
      setMotion(settled);
    } else if (prefersReducedMotion()) {
      setMotion({ active: true, shown: true, opacity: 1, offsetY: 0 });
    } else {
      setMotion({ active: true, shown: false, opacity: 0, offsetY: 12 });
    }
  }

  useEffect(() => {
    if (!active || prefersReducedMotion()) return;

    let raf = 0;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      const start = performance.now();
      setMotion({ active: true, shown: true, opacity: 0, offsetY: 12 });

      const tick = (now: number) => {
        if (cancelled) return;
        const raw = durationMs <= 0 ? 1 : Math.min(1, (now - start) / durationMs);
        const t = easeOutCubic(raw);
        setMotion({
          active: true,
          shown: true,
          opacity: t,
          offsetY: 12 * (1 - t),
        });
        if (raw < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, delayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      cancelAnimationFrame(raf);
    };
    // Retrigger only after `active` falls and rises again. Timing is captured on that edge.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- delayMs and durationMs are read for this activation only
  }, [active]);

  if (!active || !motion.shown) return null;

  const style: CSSProperties = {
    opacity: motion.opacity,
    transform: `translateY(${motion.offsetY}px)`,
  };

  return <div style={style}>{children}</div>;
}
