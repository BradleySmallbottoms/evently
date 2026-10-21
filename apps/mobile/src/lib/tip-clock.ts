function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Nearest five-minute clock. An empty or unreadable value starts at 18:00. */
export function nearestTipClock(value: string | null | undefined): string {
  const match = value?.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return '18:00';
  const hour = Number(match[1]);
  const rounded = Math.round(Number(match[2]) / 5) * 5;
  if (rounded === 60) return `${pad((hour + 1) % 24)}:00`;
  return `${pad(hour)}:${pad(rounded)}`;
}
