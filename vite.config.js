import { defineConfig } from 'vite';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Vite plugin that proxies /piper-gate/voices/* requests to HuggingFace.
 * Acts as a safety net when the Service Worker gateway hasn't taken control yet
 * (e.g., first page load before SW activation completes).
 *
 * Priority: local disk cache → in-memory cache → HuggingFace
 * Run `node scripts/download-voice-models.js` once to pre-download models to disk.
 */
function piperVoiceProxy() {
  let modelCards = null;
  const cache = new Map(); // in-memory cache for proxied files
  const voicesDir = resolve(__dirname, 'public/piper-gate/voices');

  function loadModelCards() {
    if (modelCards) return modelCards;
    const cardsPath = resolve(__dirname, 'public/piper-gate/infra/piper-model-cards.json');
    if (existsSync(cardsPath)) {
      modelCards = JSON.parse(readFileSync(cardsPath, 'utf-8'));
    }
    return modelCards || [];
  }

  function serveBuffer(res, buffer, filename, from) {
    const ext = filename.endsWith('.json') ? '.json' : '.onnx';
    const mimeTypes = { '.json': 'application/json', '.onnx': 'application/octet-stream' };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.byteLength);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Piper-Proxy-Source', from);
    res.end(buffer);
  }

  return {
    name: 'piper-voice-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/piper-gate/voices/')) {
          return next();
        }

        const filename = req.url.slice('/piper-gate/voices/'.length);
        const isConfig = filename.endsWith('.onnx.json');
        const modelId = isConfig
          ? filename.slice(0, -10)
          : filename.endsWith('.onnx')
            ? filename.slice(0, -5)
            : null;

        if (!modelId) return next();

        // 1. Serve from in-memory cache (fastest)
        if (cache.has(filename)) {
          const cached = cache.get(filename);
          return serveBuffer(res, cached.buffer, filename, 'memory');
        }

        // 2. Serve from local disk cache (persistent across restarts)
        const localPath = resolve(voicesDir, filename);
        if (existsSync(localPath)) {
          const buffer = readFileSync(localPath);
          cache.set(filename, { buffer, contentType: '' });
          console.log(`[piper-voice-proxy] Serving ${filename} from local disk (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`);
          return serveBuffer(res, buffer, filename, 'disk');
        }

        // 3. Fetch from HuggingFace
        const cards = loadModelCards();
        const card = cards.find(c => c.id === modelId);
        if (!card) return next();

        const hfUrl = isConfig ? card.configUrl : card.modelUrl;
        console.log(`[piper-voice-proxy] Fetching ${filename} from HuggingFace (not in local cache)`);

        try {
          // 120s timeout — 60MB models can take 60-90s on slow connections
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 120_000);
          const hfRes = await fetch(hfUrl, { redirect: 'follow', signal: controller.signal });
          clearTimeout(timeout);
          if (!hfRes.ok) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'text/plain');
            res.end(`[piper-voice-proxy] HuggingFace returned ${hfRes.status} for ${filename}`);
            return;
          }

          const buffer = Buffer.from(await hfRes.arrayBuffer());
          cache.set(filename, { buffer, contentType: '' });
          console.log(`[piper-voice-proxy] Cached ${filename} from HuggingFace (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`);

          // Also save to local disk so it persists across restarts
          try {
            if (!existsSync(voicesDir)) {
              mkdirSync(voicesDir, { recursive: true });
            }
            writeFileSync(localPath, buffer);
            console.log(`[piper-voice-proxy] Saved ${filename} to local disk cache`);
          } catch (saveErr) {
            console.warn(`[piper-voice-proxy] Could not save ${filename} to disk:`, saveErr.message);
          }

          serveBuffer(res, buffer, filename, 'huggingface');
        } catch (err) {
          console.error(`[piper-voice-proxy] Error proxying ${filename}:`, err.message);
          res.statusCode = err.name === 'AbortError' ? 504 : 502;
          res.setHeader('Content-Type', 'text/plain');
          const msg = err.name === 'AbortError'
            ? `[piper-voice-proxy] HuggingFace download timed out for ${filename} (120s)`
            : `[piper-voice-proxy] Proxy error: ${err.message}`;
          res.end(msg);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [piperVoiceProxy()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    target: 'esnext',
  },
});
