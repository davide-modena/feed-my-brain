import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

const GAP = 40;

interface Props {
  page: number;
  onPages: (pages: number) => void;
  children: ComponentChildren;
}

/**
 * Impagina il contenuto in colonne larghe quanto il contenitore: invece di scorrere
 * in verticale, un testo lungo diventa più pagine affiancate, mostrate una alla volta.
 */
export function Paged({ page, onPages, children }: Props) {
  const outer = useRef<HTMLDivElement>(null);
  const flow = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [fontsReady, setFontsReady] = useState(false);

  useLayoutEffect(() => {
    const el = outer.current!;
    const ro = new ResizeObserver(([entry]) =>
      setSize({ w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // I font web cambiano la lunghezza del testo: ricalcola quando sono pronti.
  useEffect(() => {
    document.fonts?.ready.then(() => setFontsReady(true));
  }, []);

  useLayoutEffect(() => {
    if (!size.w || !flow.current) return;
    const pages = Math.max(1, Math.round((flow.current.scrollWidth + GAP) / (size.w + GAP)));
    onPages(pages);
  }, [size, children, fontsReady]);

  return (
    <div class="paged" ref={outer}>
      <div
        class="paged-flow"
        ref={flow}
        style={{
          width: `${size.w}px`,
          height: `${size.h}px`,
          columnWidth: `${size.w}px`,
          columnGap: `${GAP}px`,
          '--page-h': `${size.h}px`,
          transform: `translateX(${-page * (size.w + GAP)}px)`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
