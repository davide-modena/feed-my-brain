export function longDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function shortDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
}
