/**
 * Downloads Piper voice models from HuggingFace to public/piper-gate/voices/.
 * Run once: node scripts/download-voice-models.js
 * After running, the Vite proxy serves models from disk — no more HuggingFace fetches.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const cardsPath = resolve(root, 'public/piper-gate/infra/piper-model-cards.json');
const voicesDir = resolve(root, 'public/piper-gate/voices');

const cards = JSON.parse(readFileSync(cardsPath, 'utf-8'));
const VOICE_IDS = new Set(['en_US-bryce-medium', 'en_US-kristin-medium']);
const selectedCards = cards.filter(card => VOICE_IDS.has(card.id));

if (!existsSync(voicesDir)) {
  mkdirSync(voicesDir, { recursive: true });
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function download(url, dest, expectedSha256) {
  if (existsSync(dest)) {
    const existing = readFileSync(dest);
    const mb = (existing.byteLength / 1024 / 1024).toFixed(1);
    const existingHash = sha256(existing);
    if (!expectedSha256 || existingHash === expectedSha256) {
      console.log(`  [SKIP] ${dest.split('/').pop()} already exists and verified (${mb} MB)`);
      return;
    }
    console.log(`  [REFETCH] ${dest.split('/').pop()} hash mismatch (${existingHash})`);
  }
  console.log(`  [FETCH] ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (expectedSha256) {
    const actualSha256 = sha256(buffer);
    if (actualSha256 !== expectedSha256) {
      throw new Error(`SHA-256 mismatch for ${dest.split('/').pop()}: expected ${expectedSha256}, got ${actualSha256}`);
    }
  }
  writeFileSync(dest, buffer);
  console.log(`  [OK] ${dest.split('/').pop()} saved (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`);
}

console.log(`\nDownloading ${selectedCards.length} app voice models to ${voicesDir}...\n`);

let total = 0;
for (const card of selectedCards) {
  const modelFile = `${card.id}.onnx`;
  const configFile = `${card.id}.onnx.json`;
  await download(card.modelUrl, resolve(voicesDir, modelFile), card.modelSha256);
  await download(card.configUrl, resolve(voicesDir, configFile), card.configSha256);
  total++;
}

console.log(`\nDone. ${total} models cached locally.\n`);
console.log('The Vite proxy will now serve models from disk.');
console.log('You can delete the voices/ directory to force re-download.\n');
