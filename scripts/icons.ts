/** Genera le icone PNG della PWA a partire da app/public/icon.svg. */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const BACKGROUND = '#f6f1e6';
const pub = (f: string) => fileURLToPath(new URL(`../app/public/${f}`, import.meta.url));
const svg = pub('icon.svg');

for (const size of [192, 512]) {
  await sharp(svg).resize(size, size).png().toFile(pub(`icon-${size}.png`));
}
// Icona "maskable": sfondo pieno e contenuto nella safe zone (80%).
await sharp({ create: { width: 512, height: 512, channels: 4, background: BACKGROUND } })
  .composite([{ input: await sharp(svg).resize(410, 410).png().toBuffer(), gravity: 'center' }])
  .png()
  .toFile(pub('icon-maskable-512.png'));
await sharp(svg).resize(180, 180).flatten({ background: BACKGROUND }).png().toFile(pub('apple-touch-icon.png'));
console.log('🎨 Icone generate');
