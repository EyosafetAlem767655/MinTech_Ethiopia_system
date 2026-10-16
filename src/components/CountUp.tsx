"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animated number that counts up when it scrolls into view.
 *
 * After that first run, a NEW value animates from what is on screen to the new
 * figure. It used to animate exactly once and then ignore every later value, so
 * a tile kept showing the first range's number while the charts under it moved
 * with the range selector.
 */
export default function CountUp({
  value,
  prefix = "",
  suffix = "",
  duration = 1100,
  decimals = 0,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  decimals?: number;
}) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);
  const shown = useRef(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const factor = Math.pow(10, decimals);
    const animate = () => {
      const from = shown.current;
      const t0 = performance.now();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      const tick = (t: number) => {
        const p = Math.min((t - t0) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        const v = Math.round((from + (value - from) * eased) * factor) / factor;
        shown.current = v;
        setDisplay(v);
        frame.current = p < 1 ? requestAnimationFrame(tick) : null;
      };
      frame.current = requestAnimationFrame(tick);
    };

    if (started.current) {
      animate();
      return () => {
        if (frame.current !== null) cancelAnimationFrame(frame.current);
      };
    }

    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || started.current) return;
        started.current = true;
        animate();
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [value, duration, decimals]);

  return (
    <span ref={ref}>
      {prefix}
      {decimals > 0 ? display.toFixed(decimals) : display.toLocaleString()}
      {suffix}
    </span>
  );
}
