import type { Edition, EditionIndex } from '../../shared/types.ts';

const BASE = `${import.meta.env.BASE_URL}api/`;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`Impossibile caricare ${path} (${res.status})`);
  return res.json() as Promise<T>;
}

export const fetchToday = () => get<Edition>('today.json');
export const fetchIndex = () => get<EditionIndex>('index.json');
export const fetchEdition = (date: string) => get<Edition>(`editions/${date}.json`);
