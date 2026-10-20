import type { PresenterSettings } from '../config/PresenterSettings';

function resolveSettingsEndpoint(): string {
  const explicitEndpoint = import.meta.env.VITE_SETTINGS_API_URL;
  if (explicitEndpoint && explicitEndpoint.length > 0) {
    return explicitEndpoint;
  }

  // Production is served next to the store; dev reads the production store.
  return import.meta.env.DEV ? 'https://cubewall.arkturian.com/settings' : '/settings';
}

/**
 * Dev sessions must not overwrite the kiosks' production settings unless a
 * settings endpoint was configured explicitly (e.g. a local settings server).
 */
const IS_DEBUG_SESSION = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');
/** `?debug` sessions (automated regression runs, inspection) never write the shared store either. */
const CAN_WRITE_SETTINGS =
  !IS_DEBUG_SESSION && (!import.meta.env.DEV || Boolean(import.meta.env.VITE_SETTINGS_API_URL));

const SAVE_DEBOUNCE_MS = 800;
const SETTINGS_TOKEN_STORAGE_KEY = 'cwSettingsToken';

let pendingSave: ReturnType<typeof setTimeout> | null = null;

/** Write token for a server started with SETTINGS_WRITE_TOKEN (stored once per browser). */
function readSettingsToken(): string | null {
  try {
    return window.localStorage.getItem(SETTINGS_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function isValidSettings(payload: unknown): payload is PresenterSettings {
  return typeof payload === 'object' && payload !== null;
}

export async function loadServerSettings(): Promise<PresenterSettings | null> {
  const endpoint = resolveSettingsEndpoint();
  try {
    const response = await fetch(endpoint, { cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json();
    if (isValidSettings(data)) {
      return data;
    }
    return null;
  } catch (error) {
    console.warn('[SettingsAPI] Failed to load settings from server.', error);
    return null;
  }
}

async function putServerSettings(settings: PresenterSettings): Promise<void> {
  const endpoint = resolveSettingsEndpoint();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = readSettingsToken();
  if (token) headers['X-Settings-Token'] = token;
  try {
    const response = await fetch(endpoint, { method: 'PUT', headers, body: JSON.stringify(settings) });
    if (!response.ok) {
      console.warn(`[SettingsAPI] Server rejected settings (${response.status}).`);
    }
  } catch (error) {
    console.warn('[SettingsAPI] Failed to persist settings to server.', error);
  }
}

/** Debounced: slider drags and camera moves collapse into one write. */
export function saveServerSettings(settings: PresenterSettings): void {
  if (!CAN_WRITE_SETTINGS) return;
  if (pendingSave) clearTimeout(pendingSave);
  pendingSave = setTimeout(() => {
    pendingSave = null;
    void putServerSettings(settings);
  }, SAVE_DEBOUNCE_MS);
}

