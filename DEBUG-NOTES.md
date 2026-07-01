# Debug Notes — iPad Safari & Service Worker

## iPad vs Desktop Safari: CORP in SW synthetic responses

The most impactful finding: iPad Safari enforces COEP differently from desktop Safari for
Web Worker blob-URL imports.

- **Desktop Safari**: `Cross-Origin-Resource-Policy: same-origin` on SW synthetic responses
  works fine. Workers share the page origin, COEP checks pass.
- **iPad Safari**: The same header **fails** COEP checks. Workers imported from blob URLs
  are treated as a different security context, not matching `same-origin`.
- **Fix**: Use `Cross-Origin-Resource-Policy: cross-origin` on ALL SW synthetic responses.
  It satisfies COEP regardless of origin classification.

Error pattern: "failed to fetch ORT glue" on iPad = CORP `same-origin` in SW response.

File: `public/control-asset-sw.js`, the `$()` function (response builder).

## SW integrity hash on piper-model-cards.json

The SW has a hardcoded SHA-256 hash for `piper-model-cards.json` (the `R` constant).
**Any modification to that file breaks the hash** — the SW returns 404 for all
model/config lookups. If you change model URLs, recompute the hash:

```bash
cat public/piper-gate/infra/piper-model-cards.json | openssl dgst -sha256 -binary | xxd -p -c 64
```

Then update the `R` constant in `public/control-asset-sw.js`.

## Cloudflare Pages proxying

### _redirects 200 rewrite — does NOT proxy external domains
`_redirects` with status 200 only rewrites **internally** (same domain). It does NOT
proxy to external URLs like `https://huggingface.co/`. Result: SPA fallback HTML is
returned instead of proxied content.

### Functions proxy — works but needs cold-start warmup
Cloudflare Pages Functions (`functions/` directory) proxying HuggingFace works. Use a
warmup fetch before heavy downloads to avoid cold-start timeouts on slow connections.

Function format: `functions/proxy-hf/[[path]].ts` — the double-bracket `[[path]]` is
required for nested catch-all paths.

### _routes.json — limits Functions to specific paths
Without `_routes.json`, Functions run for ALL requests (wasteful but harmless).
With it, only included routes invoke Functions:

```json
{ "version": 1, "include": ["/proxy-hf/*"], "exclude": [] }
```

Put in `public/` so Vite copies it to `dist/`.

## Safari Worker concurrency — 1 worker only

The SW has no request deduplication for concurrent voice model downloads. Two workers
both pull 60MB through the proxy simultaneously → one gets a corrupt/incomplete response
("protobuf parsing failed" ERROR_CODE 7). Limit Safari to 1 worker for both init and
synthesis:

```javascript
if (isIOSLikeSafari()) return 1;  // iOS/iPadOS
if (_isSafari) return 1;          // Desktop Safari
```

## Fonts — self-host for cross-device consistency

Apple-specific fonts like "SF Pro Rounded" exist on macOS but NOT on iPadOS. Using them
causes different rendering on different devices. Always use self-hosted fonts or system
font stacks without platform-specific family names if consistency matters.

OpenDyslexic is available via npm (`open-dyslexic`) with woff files in the `woff/`
subdirectory. Copy them to `public/fonts/` and add `@font-face` declarations.

## iPad remote debugging

Requirements: USB cable (must be data-capable, not charge-only), iPad must "Trust This
Computer", Safari → Advanced → Web Inspector must be ON, Mac Safari → Develop menu
must be enabled. The "connecting..." hang is common — try different cable, different
USB port, toggle Web Inspector off/on, quit/reopen Safari on both devices.

## COOP/COEP headers

The `_headers` file sets:
```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

All static assets served under these paths need `Cross-Origin-Resource-Policy: cross-origin`.
The SW's synthetic responses also need it (see top of this file). Without COOP/COEP,
SharedArrayBuffer (required by ONNX WASM) is unavailable.

## AudioContext — Safari/macOS lesson (final architecture)

**Symptom:** After backgrounding for a few minutes (Space switch, display sleep,
another app grabs the audio session) playback runs but is **silent**.
`resume()` reports state `running`, the clock advances, but no sound comes out.
Hard reload does **not** fix it — the same renderer process keeps the wedged
audio session. Only a brand-new window (= new OS process/session) recovered.

**Root cause confirmed via clock probe:** after returning, a brand-new
`AudioContext` created inside a user gesture, resumed to `running`, with valid
non-zero PCM, still rendered SILENCE while its clock kept advancing.
This is a known, unfixed WebKit bug in the Web Audio output pipeline.

**What does NOT work:**
- Resume-only (`audioCtx.resume()`) — the reported state lies.
- Hard-recreating the `AudioContext` per click — Safari allows only ~4 contexts
  per page; leaking contexts (not closing the old one) causes permanent silence.
  Even recreate + `close()` + kick buffer fails: same bug, different context.

**What works: use `HTMLAudioElement` instead of Web Audio for playback.**
`HTMLAudioElement` uses the platform media pipeline (the path music/podcast apps
use), which is designed to survive interruptions and output-route changes. The
next `play()` call from a gesture reliably restarts the output route.

**Current implementation (`src/main.js`):**
- A single `const _player = new Audio()` element is created at module load.
- PCM from Piper synthesis is encoded to a 16-bit WAV `Blob` (`pcmToWavBlob`)
  and a `URL.createObjectURL` blob URL is stored per speed preset
  (`state.audioURLs`). The raw `Float32Array` is kept in `state.audioPCM` for
  IndexedDB caching.
- `doPlay(offsetSec)` sets `_player.currentTime`, calls `_player.play()`, and
  drives timing entirely from `_player.currentTime` via `requestAnimationFrame`.
- `unlockPlayerSync()` plays a 1-sample muted WAV inside the first gesture to
  satisfy autoplay policy; subsequent `play()` calls succeed without a gesture.
- No `AudioContext` is used. Web Audio APIs (`createBufferSource`, `resume`,
  `onstatechange`) are gone from the playback path entirely.

**IndexedDB cache** stores the raw `Float32Array` PCM (same as before); blob
URLs are re-created from it on restore since blob URLs don't survive reloads.
