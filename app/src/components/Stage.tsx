import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

interface Props {
  /** Swipe a sinistra / freccia destra. */
  onNext: () => void;
  /** Swipe a destra / freccia sinistra. */
  onPrev: () => void;
  /** Tocco sul lato destro / sinistro (per sfogliare le pagine di una card). */
  onTapRight: () => void;
  onTapLeft: () => void;
  /** Cambia quando cambia la card: fa partire l'animazione di entrata. */
  slideKey: string;
  direction: 'next' | 'prev';
  children: ComponentChildren;
}

const SWIPE_THRESHOLD = 50;

/** Area a tutto schermo che interpreta swipe, tocchi laterali e frecce della tastiera. */
export function Stage({ onNext, onPrev, onTapRight, onTapLeft, slideKey, direction, children }: Props) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const [dx, setDx] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') onTapRight();
      if (e.key === 'ArrowLeft') onTapLeft();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onTapRight, onTapLeft]);

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    const moveX = e.clientX - start.current.x;
    if (Math.abs(moveX) > Math.abs(e.clientY - start.current.y)) setDx(moveX);
  };

  const onPointerUp = (e: PointerEvent) => {
    const s = start.current;
    start.current = null;
    setDx(0);
    if (!s || s.id !== e.pointerId) return;
    const moveX = e.clientX - s.x;
    const moveY = e.clientY - s.y;

    if (Math.abs(moveX) > SWIPE_THRESHOLD && Math.abs(moveX) > Math.abs(moveY)) {
      if (moveX < 0) onNext();
      else onPrev();
      return;
    }
    // Tocco: ignora link e bottoni, poi decide in base al lato.
    if (Math.abs(moveX) < 8 && Math.abs(moveY) < 8) {
      if ((e.target as HTMLElement).closest('a, button')) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      if (x > 0.55) onTapRight();
      else if (x < 0.35) onTapLeft();
    }
  };

  return (
    <div
      class="stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        start.current = null;
        setDx(0);
      }}
    >
      <div
        key={slideKey}
        class={`slide enter-${direction}`}
        style={dx ? { transform: `translateX(${dx * 0.6}px)`, transition: 'none' } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
