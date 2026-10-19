import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'settings.json');

// Browsers may only call the store from these origins (comma-separated list in ALLOWED_ORIGINS).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'https://cubewall.arkturian.com,http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Optional shared secret: when set, PUT requires the header `X-Settings-Token`.
const WRITE_TOKEN = process.env.SETTINGS_WRITE_TOKEN ?? '';

const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({ limit: '256kb' }));

async function readSettings() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[SettingsServer] Failed to read settings.', error);
    }
    return {};
  }
}

// Writes are serialized and atomic (temp file + rename), so concurrent PUTs or a
// crash mid-write can never leave a truncated settings.json behind.
let writeQueue = Promise.resolve();

function writeSettings(settings) {
  const run = async () => {
    const tmpFile = `${DATA_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmpFile, JSON.stringify(settings, null, 2), 'utf8');
    await fs.rename(tmpFile, DATA_FILE);
  };
  writeQueue = writeQueue.then(run, run);
  return writeQueue;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

app.get('/settings', async (req, res) => {
  res.json(await readSettings());
});

app.put('/settings', async (req, res) => {
  if (WRITE_TOKEN && req.get('X-Settings-Token') !== WRITE_TOKEN) {
    res.status(401).json({ error: 'invalid_token' });
    return;
  }
  const incoming = req.body;
  if (!isPlainObject(incoming)) {
    res.status(400).json({ error: 'settings_must_be_object' });
    return;
  }
  try {
    await writeSettings(incoming);
    console.log('[SettingsServer] Settings updated');
    res.status(204).send();
  } catch (error) {
    console.error('[SettingsServer] Failed to write settings.', error);
    res.status(500).json({ error: 'write_failed' });
  }
});

const PORT = process.env.PORT ?? 5001;
app.listen(PORT, () => {
  console.log(`[SettingsServer] Listening on http://0.0.0.0:${PORT}/settings`);
});
