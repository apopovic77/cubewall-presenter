import type { PresenterSettings } from '../config/PresenterSettings';
import { HAS_SESSION_OVERRIDES } from '../config/sessionOverrides';

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
/** `?debug` sessions (automated regression runs, inspection) and sessions with URL overrides (`?cubes=`, `?layout=` …) never write the shared store either. */
const CAN_WRITE_SETTINGS =
  !IS_DEBUG_SESSION &&
  !HAS_SESSION_OVERRIDES && (!import.meta.env.DEV || Boolean(import.meta.env.VITE_SETTINGS_API_URL));

const SAVE_DEBOUNCE_MS = 800;
const SETTINGS_TOKEN_STORAGE_KEY = 'cwSettingsToken';

let pendingSave: ReturnType<typeof setTimeout> | null = null;
let latestSettings: PresenterSettings | null = null;
/** The store as this tab last read or wrote it; only keys that differ from it are sent. */
let syncedSettings: Record<string, unknown> | null = null;

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
      syncedSettings = { ...(data as unknown as Record<string, unknown>) };
      return data;
    }
    return null;
  } catch (error) {
    console.warn('[SettingsAPI] Failed to load settings from server.', error);
    return null;
  }
}

function changedKeys(settings: PresenterSettings, synced: Record<string, unknown>): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  Object.entries(settings).forEach(([key, value]) => {
    if (JSON.stringify(value) !== JSON.stringify(synced[key])) changes[key] = value;
  });
  return changes;
}

async function patchServerSettings(changes: Record<string, unknown>): Promise<void> {
  const endpoint = resolveSettingsEndpoint();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = readSettingsToken();
  if (token) headers['X-Settings-Token'] = token;
  try {
    const response = await fetch(endpoint, { method: 'PATCH', headers, body: JSON.stringify(changes) });
    if (!response.ok) {
      console.warn(`[SettingsAPI] Server rejected settings (${response.status}).`);
      return;
    }
    syncedSettings = { ...syncedSettings, ...changes };
  } catch (error) {
    console.warn('[SettingsAPI] Failed to persist settings to server.', error);
  }
}

/** Debounced: slider drags and camera moves collapse into one write. */
export function saveServerSettings(settings: PresenterSettings): void {
  // Only a tab that read the store may write to it, and only what it changed.
  if (!CAN_WRITE_SETTINGS || !syncedSettings) return;
  latestSettings = settings;
  if (pendingSave) clearTimeout(pendingSave);
  pendingSave = setTimeout(() => {
    pendingSave = null;
    if (!latestSettings || !syncedSettings) return;
    const changes = changedKeys(latestSettings, syncedSettings);
    if (Object.keys(changes).length > 0) void patchServerSettings(changes);
  }, SAVE_DEBOUNCE_MS);
}
