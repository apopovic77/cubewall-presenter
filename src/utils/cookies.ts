const DEFAULT_EXPIRY_DAYS = 365;

export function setCookie(name: string, value: string, days: number = DEFAULT_EXPIRY_DAYS): void {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}

export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie ? document.cookie.split('; ') : [];
  for (const entry of cookies) {
    const [key, ...rest] = entry.split('=');
    if (key === name) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}
