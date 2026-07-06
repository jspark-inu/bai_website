const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function safeMaterialUrl(raw: string | null | undefined) {
  const value = (raw || '').trim();
  if (!value) return '';
  if (value.startsWith('/')) return value;
  try {
    const parsed = new URL(value);
    return SAFE_PROTOCOLS.has(parsed.protocol) ? parsed.toString() : '';
  } catch {
    return '';
  }
}
