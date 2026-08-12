export function isSupportedOrigin(origin: string): boolean {
  try {
    const protocol = new URL(origin).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function scriptIdFor(origin: string): string {
  const encodedOrigin = Array.from(
    new TextEncoder().encode(origin),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  return `enabled_site_${encodedOrigin}`;
}

export function originFromMatchPattern(match: string): string | null {
  try {
    const url = new URL(match.replace(/\/\*$/, '/'));
    return isSupportedOrigin(url.origin) ? url.origin : null;
  } catch {
    return null;
  }
}
