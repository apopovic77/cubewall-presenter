import type { PresenterSettings } from '../config/PresenterSettings';

const SETTINGS_ENDPOINT = import.meta.env.VITE_SETTINGS_API_URL ?? 'http://localhost:5001/settings';

function isValidSettings(payload: unknown): payload is PresenterSettings {
  return typeof payload === 'object' && payload !== null;
}

export async function loadServerSettings(): Promise<PresenterSettings | null> {
  try {
    const response = await fetch(SETTINGS_ENDPOINT, { cache: 'no-store' });
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

export async function saveServerSettings(settings: PresenterSettings): Promise<void> {
  try {
    await fetch(SETTINGS_ENDPOINT, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(settings),
    });
  } catch (error) {
    console.warn('[SettingsAPI] Failed to persist settings to server.', error);
  }
}

