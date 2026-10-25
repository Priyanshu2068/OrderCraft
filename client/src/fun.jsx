import { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';

export function celebrate(big = false) {
  const colors = ['#6d5efc', '#ff7a59', '#22c55e', '#facc15', '#38bdf8'];
  confetti({ particleCount: big ? 160 : 70, spread: big ? 100 : 70, origin: { y: 0.7 }, colors });
  if (big) setTimeout(() => confetti({ particleCount: 80, angle: 60, spread: 70, origin: { x: 0, y: 0.8 }, colors }), 200);
}

// Animated number: counts up from 0 whenever `value` changes.
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString() }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / 800);
      const eased = 1 - (1 - p) ** 3;
      setShown(a + (value - a) * eased);
      if (p < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(shown)}</>;
}

export function greeting(name) {
  const h = new Date().getHours();
  const part = h < 5 ? 'Burning the midnight oil' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${name.split(' ')[0]}`;
}

export function Empty({ emoji = '🌱', title, children }) {
  return (
    <div className="empty">
      <div className="empty-emoji">{emoji}</div>
      <b>{title}</b>
      <div className="muted">{children}</div>
    </div>
  );
}
