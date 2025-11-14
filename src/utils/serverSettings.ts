import type { PresenterSettings } from '../config/PresenterSettings';

function resolveSettingsEndpoint(): string {
  const explicitEndpoint = import.meta.env.VITE_SETTINGS_API_URL;
  if (explicitEndpoint && explicitEndpoint.length > 0) {
    return explicitEndpoint;
  }

  return 'https://cubewall.arkturian.com/settings';
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

export async function saveServerSettings(settings: PresenterSettings): Promise<void> {
  const endpoint = resolveSettingsEndpoint();
  try {
    await fetch(endpoint, {
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

