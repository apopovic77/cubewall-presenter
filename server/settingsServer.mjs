import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'settings.json');

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

async function ensureDataFile() {
  try {
    await fs.access(DATA_FILE);
  } catch (error) {
    await fs.writeFile(DATA_FILE, '{}', 'utf8');
    console.log(`[SettingsServer] Created data store at ${DATA_FILE}`);
  }
}

async function readSettings() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (error) {
    return {};
  }
}

async function writeSettings(settings) {
  await fs.writeFile(DATA_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

app.get('/settings', async (req, res) => {
  await ensureDataFile();
  const settings = await readSettings();
  res.json(settings);
});

app.put('/settings', async (req, res) => {
  await ensureDataFile();
  const incoming = req.body ?? {};
  await writeSettings(incoming);
  console.log('[SettingsServer] Settings updated');
  res.status(204).send();
});

const PORT = process.env.PORT ?? 5001;
app.listen(PORT, () => {
  console.log(`[SettingsServer] Listening on http://0.0.0.0:${PORT}/settings`);
});

