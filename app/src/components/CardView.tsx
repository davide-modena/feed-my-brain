import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { CATEGORY_LABEL, type Card } from '../../../shared/types.ts';
import { Paged } from './Paged.tsx';

interface Props {
  card: Card;
  page: number;
  pages: number;
  onPages: (pages: number) => void;
}

/** Sotto questa quota di immagine visibile, il ritaglio taglierebbe troppo (es. ritratti verticali). */
const MIN_VISIBLE = 0.75;

/**
 * "cover" riempie il riquadro ritagliando l'immagine; va bene finché le proporzioni sono simili.
 * Altrimenti si mostra l'immagine intera ("contain") con uno sfondo sfocato ai lati.
 */
function chooseFit(imageRatio: number | null, boxRatio: number | null): 'cover' | 'contain' {
  if (!imageRatio || !boxRatio) return 'cover';
  const visible = Math.min(boxRatio, imageRatio) / Math.max(boxRatio, imageRatio);
  return visible < MIN_VISIBLE ? 'contain' : 'cover';
}

export function CardView({ card, page, pages, onPages }: Props) {
  // Alcuni siti bloccano l'hotlinking: se l'immagine non carica, la card resta senza.
  const [imageFailed, setImageFailed] = useState<string | null>(null);
  const image = card.image && imageFailed !== card.image.url ? card.image : null;
  // Proporzioni dell'immagine (al caricamento) e del riquadro (seguite con un ResizeObserver):
  // l'immagine può caricarsi dalla cache prima che la card abbia una dimensione.
  const [imageRatio, setImageRatio] = useState<number | null>(null);
  const [boxRatio, setBoxRatio] = useState<number | null>(null);
  const figure = useRef<HTMLElement>(null);
  const fit = chooseFit(imageRatio, boxRatio);

  useLayoutEffect(() => {
    const el = figure.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setBoxRatio(width / height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [image?.url]);

  return (
    <article class={`card cat-${card.category}`}>
      <Paged page={page} onPages={onPages}>
        {image && (
          <figure ref={figure} class={`card-figure ${fit === 'contain' ? 'is-contain' : ''}`}>
            {fit === 'contain' && (
              <img class="card-figure-backdrop" src={image.url} alt="" aria-hidden="true" referrerpolicy="no-referrer" />
            )}
            <img
              class="card-figure-main"
              src={image.url}
              alt=""
              referrerpolicy="no-referrer"
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalHeight) setImageRatio(img.naturalWidth / img.naturalHeight);
              }}
              onError={() => setImageFailed(image.url)}
            />
          </figure>
        )}
        <p class="card-meta">
          <span class="card-category">{CATEGORY_LABEL[card.category]}</span>
          <span>{card.tag}</span>
        </p>
        <h2 class="card-title">{card.title}</h2>
        <p class="card-summary">{card.summary}</p>
        {card.context && (
          <div class="card-context">
            <p class="card-context-label">Perché conta</p>
            <p>{card.context}</p>
          </div>
        )}
        <p class="sources">
          {card.sources.map((s, i) => (
            <>
              {i > 0 && ' · '}
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.name}
              </a>
            </>
          ))}
          {image && (
            <>
              {' · Immagine: '}
              {image.link ? (
                <a href={image.link} target="_blank" rel="noopener noreferrer">
                  {image.credit}
                </a>
              ) : (
                image.credit
              )}
            </>
          )}
        </p>
      </Paged>
      {pages > 1 && (
        <div class="page-dots" aria-label={`Pagina ${page + 1} di ${pages}`}>
          {Array.from({ length: pages }, (_, i) => (
            <span key={i} class={i === page ? 'is-active' : ''} />
          ))}
          {page < pages - 1 && <span class="page-hint">tocca a destra per continuare</span>}
        </div>
      )}
    </article>
  );
}
