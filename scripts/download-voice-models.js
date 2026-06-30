/**
 * Downloads Piper voice models from HuggingFace to public/piper-gate/voices/.
 * Run once: node scripts/download-voice-models.js
 * After running, the Vite proxy serves models from disk — no more HuggingFace fetches.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const cardsPath = resolve(root, 'public/piper-gate/infra/piper-model-cards.json');
const voicesDir = resolve(root, 'public/piper-gate/voices');

const cards = JSON.parse(readFileSync(cardsPath, 'utf-8'));

if (!existsSync(voicesDir)) {
  mkdirSync(voicesDir, { recursive: true });
}

async function download(url, dest) {
  if (existsSync(dest)) {
    const existing = readFileSync(dest);
    const mb = (existing.byteLength / 1024 / 1024).toFixed(1);
    console.log(`  [SKIP] ${dest.split('/').pop()} already exists (${mb} MB)`);
    return;
  }
  console.log(`  [FETCH] ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    console.error(`  [FAIL] HTTP ${res.status} for ${url}`);
    return;
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buffer);
  console.log(`  [OK] ${dest.split('/').pop()} saved (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`);
}

console.log(`\nDownloading ${cards.length} voice models to ${voicesDir}...\n`);

let total = 0;
for (const card of cards) {
  const modelFile = `${card.id}.onnx`;
  const configFile = `${card.id}.onnx.json`;
  await download(card.modelUrl, resolve(voicesDir, modelFile));
  await download(card.configUrl, resolve(voicesDir, configFile));
  total++;
}

console.log(`\nDone. ${total} models cached locally.\n`);
console.log('The Vite proxy will now serve models from disk.');
console.log('You can delete the voices/ directory to force re-download.\n');
