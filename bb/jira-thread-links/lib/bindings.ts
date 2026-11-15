export function normalizeKeys(values: string[], prefix: string): string[] {
  return [...new Set(values.map(value => {
    const raw = value.trim().toUpperCase();
    const key = /^\d+$/.test(raw) && prefix ? `${prefix.toUpperCase()}-${raw}` : raw;
    if (!/^[A-Z][A-Z0-9_]*-[1-9]\d*$/.test(key)) throw new Error(`Invalid Jira key: ${value}. Use a full key or configure a project prefix.`);
    return key;
  }))];
}
export function changeKeys(current: string[], operation: 'add' | 'remove' | 'replace', keys: string[]): string[] {
  if (operation === 'replace') return [...keys];
  if (operation === 'remove') return current.filter(key => !keys.includes(key));
  return [...new Set([...current, ...keys])];
}
