import { createPiperProvider } from 'piper-timing-farm-browser';
import { CONTENT_CATALOG } from './generated-content.js';

let APP_DEBUG = false;
try {
  APP_DEBUG = globalThis.localStorage?.getItem('wbw-debug') === '1';
} catch (_) {
  APP_DEBUG = false;
}

function debugLog(...args) {
  if (APP_DEBUG) console.log(...args);
}

// Pre-register the Service Worker as early as possible so it overlaps with
// other page setup work.  The SW is essential for voice model downloads: it
// intercepts /piper-gate/voices/*.onnx requests and fetches them from
// HuggingFace, caching in OPFS.  Without SW control the requests hit the
// origin, which doesn't have the 60 MB model files, and SPA fallback returns
// HTML that ONNX can't parse.
//
// We MUST wait for the controller to be active before creating Piper workers
// (otherwise model downloads fail with "protobuf parsing failed").  We
// previously tried NOT waiting (to avoid a race where the SW would intercept
// the Worker constructor's fetch for its own script), but that race is no
// longer an issue — the worker script's SHA-256 matches the SW's integrity
// map, so the SW serves it correctly.
//
// Timeout after 8 seconds so we never hang the page indefinitely.
const _swReady = (async () => {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  const waitForController = (timeoutMs) => {
    if (navigator.serviceWorker.controller) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        console.warn('[SW] Controller wait timed out after', timeoutMs, 'ms');
        resolve();
      }, timeoutMs);
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        clearTimeout(timer);
        debugLog('[SW] controllerchange — now controlling');
        resolve();
      }, { once: true });
    });
  };

  // Already controlling — check for updates in the background
  if (navigator.serviceWorker.controller) {
    debugLog('[SW] Already controlling');
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      reg.update().catch(() => {});
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            debugLog('[SW] New version installed — activating');
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    }
    return;
  }

  // First visit: register, wait for activation + controller
  try {
    await navigator.serviceWorker.register('/control-asset-sw.js', {
      scope: '/',
      type: 'module',
    });
    await navigator.serviceWorker.ready;
    debugLog('[SW] Activated — waiting for controller');
    await waitForController(8000);
    debugLog('[SW] Controller ready:', !!navigator.serviceWorker.controller);
  } catch (err) {
    console.warn('[SW] Registration failed:', err.message);
  }
})();

// ─── Content Data ────────────────────────────────────────────────

// The exercise catalog is generated from /data/pet via
// webapp/scripts/generate-content-catalog.js.

// ─── Content Metadata ────────────────────────────────────────────

// Maps exam key → language/level for panel filtering
const EXAM_META = {
  PET: { language: 'en', level: 'B1', label: 'Cambridge B1 Preliminary (PET)' },
};

const PART_LABELS = {
  1: 'Part 1 · Short Descriptions',
  2: 'Part 2 · Monologue',
  3: 'Part 3 · Announcements',
  4: 'Part 4 · Conversation',
};

const DEFAULT_EXERCISE_INDEX = Math.max(
  0,
  CONTENT_CATALOG.exercises.findIndex((exercise) => exercise.id === CONTENT_CATALOG.defaultExerciseId),
);
const DEFAULT_EXERCISE = CONTENT_CATALOG.exercises[DEFAULT_EXERCISE_INDEX] || CONTENT_CATALOG.exercises[0] || null;
const DEFAULT_EXPANDED_SECTION_KEY = DEFAULT_EXERCISE
  ? `${DEFAULT_EXERCISE.exam}-${DEFAULT_EXERCISE.sectionKey || `part-${DEFAULT_EXERCISE.part}`}`
  : null;

// Languages and their level systems shown in the panel
const LANGUAGE_CONFIG = {
  en: {
    label: 'English',
    levels: [
      { id: 'A1',    label: 'A1' },
      { id: 'A2',    label: 'A2 (KET)' },
      { id: 'B1',    label: 'B1 (PET)' },
      { id: 'B2',    label: 'B2 (FCE)' },
      { id: 'C1',    label: 'C1 (CAE)' },
      { id: 'C2',    label: 'C2 (CPE)' },
      { id: 'TOEFL', label: 'TOEFL' },
      { id: 'SAT',   label: 'SAT' },
      { id: 'GRE',   label: 'GRE' },
    ],
  },
  yue: {
    label: 'Cantonese',
    levels: [
      { id: 'YUE-BASIC', label: 'Basic' },
      { id: 'YUE-INT',   label: 'Intermediate' },
      { id: 'YUE-ADV',   label: 'Advanced' },
      { id: 'HKDSE',     label: 'HKDSE' },
    ],
  },
  es: {
    label: 'Spanish',
    levels: [
      { id: 'ES-A1',  label: 'A1' },
      { id: 'ES-A2',  label: 'A2 (DELE)' },
      { id: 'ES-B1',  label: 'B1 (DELE)' },
      { id: 'ES-B2',  label: 'B2 (DELE)' },
      { id: 'ES-C1',  label: 'C1 (DELE)' },
      { id: 'ES-C2',  label: 'C2 (DELE)' },
      { id: 'SELE',   label: 'SELE' },
    ],
  },
};

// ─── Material Panel State ─────────────────────────────────────────

const mpState = {
  open: false,
  lang: 'en',
  level: 'B1',
  expandedMaterials: new Set(DEFAULT_EXERCISE ? [DEFAULT_EXERCISE.exam] : ['PET']),
  expandedParts: new Set(DEFAULT_EXPANDED_SECTION_KEY ? [DEFAULT_EXPANDED_SECTION_KEY] : ['PET-1']),
};

// ─── App State ───────────────────────────────────────────────────

const state = {
  exercises: CONTENT_CATALOG.exercises,
  currentIndex: DEFAULT_EXERCISE_INDEX,
  sentences: [],
  sentenceIndex: 0,
  repeatSentenceIndex: null,
  playing: false,
  paused: false,
  speedPreset: 'normal',       // 'slow'|'normal'|'fast'
  voiceType: 'man',
  repeatMode: false,
  // Dictation mode
  dictMode: 'free',           // 'free' (exercising) | 'programmed' (test taking)
  programmedLaps: 3,          // 1, 3, or 5
  currentLap: 0,              // which lap we're on for current sentence
  programmedPhase: 'sentence', // 'sentence' | 'final'
  // Piper WASM engine
  provider: null,              // PiperProvider instance
  providerReady: false,        // whether provider.init() completed
  audioCtx: null,              // legacy; no longer used for playback
  audioBuffers: {},            // legacy; superseded by audioURLs
  audioURLs: {},               // { slow|normal|fast: blob URL } played via <audio>
  audioPCM: {},                // { slow|normal|fast: {data:Float32Array, sampleRate, length} } for caching
  ttsMetaBySpeed: {},          // { slow: meta, normal: meta, fast: meta }
  srcNode: null,               // set to the <audio> element while it is playing
  srcStartOffset: 0,           // offset in seconds when playback (re)started
  srcStartedAt: 0,             // legacy timing field (unused with <audio>)
  // TTS metadata & timing
  ttsMeta: null,               // reference to ttsMetaBySpeed[speedPreset]
  totalDurationMs: 0,
  elapsedMs: 0,
  inputVisible: false,
  transcriptVisible: false,     // whether user has toggled transcript to visible
  // Loading state
  loadingProgress: 0,          // 0–1 model download / synthesis progress
  loadingMessage: '',          // text shown on loading overlay
  // Programmed-mode gap between laps
  lapGapTimer: null,            // setTimeout id for writing gap
  inLapGap: false,              // true while showing writing gap
  gapCountdownInterval: null,   // setInterval id for countdown display
  // Scrubbing state
  scrubbing: false,
  scrubDir: 0,
  wasPlayingBeforeScrub: false,
  _playRequested: false,         // user clicked Play while audio was loading
};

// ─── HMR State Preservation ──────────────────────────────────────────
// Must run before any async startup code so the dispose handler captures
// the state AFTER initProvider completes, not before.
if (import.meta.hot) {
  const prev = window.__wbw_preserved;
  if (prev) {
    if (prev.provider && prev.providerDebug === APP_DEBUG) {
      state.provider = prev.provider;
      state.providerReady = prev.providerReady;
      debugLog('[HMR] Restored Piper provider');
    }
    if (prev.audioURLs && Object.keys(prev.audioURLs).length > 0) {
      state.audioURLs = prev.audioURLs;
      state.audioPCM = prev.audioPCM || {};
      state.ttsMetaBySpeed = prev.ttsMetaBySpeed || {};
      state.ttsMeta = prev.ttsMeta;
      state.totalDurationMs = prev.totalDurationMs;
      debugLog('[HMR] Restored audio URLs');
    }
    window.__wbw_preserved = null;
  }
  import.meta.hot.dispose(() => {
    window.__wbw_preserved = {
      provider: state.provider,
      providerReady: state.providerReady,
      providerDebug: APP_DEBUG,
      audioURLs: state.audioURLs,
      audioPCM: state.audioPCM,
      ttsMetaBySpeed: state.ttsMetaBySpeed,
      ttsMeta: state.ttsMeta,
      totalDurationMs: state.totalDurationMs,
    };
  });
}

// ─── SVG Icons ──────────────────────────────────────────────────
const ICONS = {
  play:  '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M7 4v16l14-8z" fill="currentColor"/></svg>',
  pause: '<svg width="18" height="18" viewBox="0 0 24 24"><rect x="5" y="3" width="5" height="18" rx="1.5" fill="currentColor"/><rect x="14" y="3" width="5" height="18" rx="1.5" fill="currentColor"/></svg>',
  prev:  '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M19 4v16l-12-8 12-8z" fill="currentColor"/><rect x="4" y="4" width="3" height="16" rx="1" fill="currentColor"/></svg>',
  rew:   '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M13 19V5l-10 7 10 7z" fill="currentColor"/><path d="M24 19V5l-10 7 10 7z" fill="currentColor"/></svg>',
  fwd:   '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M11 5v14l10-7-10-7z" fill="currentColor"/><path d="M0 5v14l10-7-10-7z" fill="currentColor"/></svg>',
  next:  '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M5 4v16l12-8-12-8z" fill="currentColor"/><rect x="17" y="4" width="3" height="16" rx="1" fill="currentColor"/></svg>',
  repeat:'<svg width="16" height="16" viewBox="0 0 24 24"><path d="M6 12a6 6 0 0 1 6-6h5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/><polyline points="19,4 17,6 19,8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 12a6 6 0 0 1-6 6H7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/><polyline points="5,20 7,18 5,16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  eye:   '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M2 12s4-9 10-9 10 9 10 9-4 9-10 9-10-9-10-9z" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>',
  eyeOff:'<svg width="16" height="16" viewBox="0 0 24 24"><path d="M2 12s4-9 10-9 10 9 10 9-4 9-10 9-10-9-10-9z" stroke="currentColor" stroke-width="2" fill="none"/><line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>',
  check: '<svg width="15" height="15" viewBox="0 0 24 24"><polyline points="5,12 10,18 19,7" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  answer:'<svg width="15" height="15" viewBox="0 0 24 24"><path d="M12 21c4.97 0 9-3.58 9-8s-4.03-8-9-8-9 3.58-9 8c0 1.64.55 3.15 1.5 4.38L3 22l4.8-1.2c1.27.77 2.73 1.2 4.2 1.2z" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
  clear: '<svg width="15" height="15" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/><line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  edit:  '<svg width="15" height="15" viewBox="0 0 24 24"><path d="M12 20h9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
};

function setPlayIcon(playing) {
  if (state.dictMode === 'programmed') {
    if (playing || state.paused) {
      $('#btnPlay').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"/></svg> Stop';
      $('#btnPlay').classList.remove('primary');
    } else {
      $('#btnPlay').innerHTML = ICONS.play + ' Start';
      $('#btnPlay').classList.add('primary');
    }
  } else if (state.scrubbing) {
    $('#btnPlay').innerHTML = state.scrubDir < 0
      ? ICONS.rew + ' REW'
      : ICONS.fwd + ' FFWD';
  } else {
    $('#btnPlay').innerHTML = playing ? ICONS.pause + ' Pause' : ICONS.play + ' Play';
  }
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let _inputPanelPreferredBottomH = 0;

// ─── Draggable Splitter ──────────────────────────────────────────

(function initSplitter() {
  const mainArea = $('#main-area');
  const topPanel = $('#top-panel');
  const bottomPanel = $('#bottom-panel');
  const bar = $('#controls-bar');
  let dragging = false;
  let startY = 0;
  let startTopH = 0;
  let startBottomH = 0;

  function getHeights() {
    return {
      top: topPanel.getBoundingClientRect().height,
      bottom: bottomPanel.getBoundingClientRect().height,
      total: topPanel.getBoundingClientRect().height + bar.getBoundingClientRect().height + bottomPanel.getBoundingClientRect().height,
    };
  }

  bar.addEventListener('mousedown', (e) => {
    if (bottomPanel.classList.contains('hidden')) return;
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.progress-wrap')) return;
    dragging = true;
    bar.classList.add('dragging');
    const h = getHeights();
    startY = e.clientY;
    startTopH = h.top;
    startBottomH = h.bottom;
    document.body.style.cursor = 'ns-resize';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    const newTop = Math.max(80, startTopH + dy);
    const barH = bar.getBoundingClientRect().height;
    mainArea.style.gridTemplateRows = newTop + 'px ' + barH + 'px 1fr';
    e.preventDefault();
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    bar.classList.remove('dragging');
    document.body.style.cursor = '';
    // Persist the ratio
    const h = getHeights();
    const avail = h.total - bar.getBoundingClientRect().height;
    _inputPanelPreferredBottomH = h.bottom;
    mainArea.style.gridTemplateRows = h.top + 'px ' + bar.getBoundingClientRect().height + 'px ' + h.bottom + 'px';
  });

  // Touch support
  bar.addEventListener('touchstart', (e) => {
    if (bottomPanel.classList.contains('hidden')) return;
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.progress-wrap')) return;
    dragging = true;
    bar.classList.add('dragging');
    const h = getHeights();
    startY = e.touches[0].clientY;
    startTopH = h.top;
    startBottomH = h.bottom;
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const dy = e.touches[0].clientY - startY;
    const newTop = Math.max(80, startTopH + dy);
    const barH = bar.getBoundingClientRect().height;
    mainArea.style.gridTemplateRows = newTop + 'px ' + barH + 'px 1fr';
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    bar.classList.remove('dragging');
    document.body.style.cursor = '';
    const h = getHeights();
    const barH = bar.getBoundingClientRect().height;
    _inputPanelPreferredBottomH = h.bottom;
    mainArea.style.gridTemplateRows = h.top + 'px ' + barH + 'px ' + h.bottom + 'px';
  });
})();

// ─── Sentence Splitting ──────────────────────────────────────────

function splitSentences(text) {
  const raw = text.match(/[^.!?]+[.!?]+[\s]*/g) || [text];
  return raw.map(s => s.trim()).filter(Boolean);
}

function estimateDuration(sentence) {
  const words = sentence.split(/\s+/).length;
  return (words / 2.5) * 1000; // ms at 1x speed (~150 wpm)
}

function isIOSLikeSafari() {
  const ua = navigator.userAgent || '';
  const iOSDevice = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return iOSDevice && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

const _isSafari = (() => {
  const ua = navigator.userAgent || '';
  return /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua);
})();

function getPiperCpuInstances() {
  // iOS devices: 1 worker to avoid OOM
  if (isIOSLikeSafari()) return 1;
  // Desktop Safari: 1 worker. The SW has no deduplication for concurrent
  // voice model downloads, so 2 workers both pull 60MB through the proxy
  // simultaneously. Worker 0 gets valid bytes, worker 1 gets a partial
  // or corrupt response ("protobuf parsing failed" ERROR_CODE 7).
  if (_isSafari) return 1;
  return Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2));
}

function getSynthesisConcurrency() {
  if (isIOSLikeSafari()) return 1;
  if (_isSafari) return 1;
  return getPiperCpuInstances();
}

function isCorruptModelError(err) {
  const message = String(err?.message || err || '');
  return /protobuf parsing failed|failed to load model|can't create a session|load failed/i.test(message);
}

async function purgeVoiceAssetCache(modelId) {
  if (!modelId) return false;
  // Try the SW DELETE endpoint even if no controller is visible —
  // the fetch will be intercepted if the SW is active.
  try {
    const res = await fetch(`/piper-gate/voices/${modelId}`, { method: 'DELETE' });
    debugLog('[piper-cache] Purged voice asset cache:', modelId, res.status);
    return res.ok;
  } catch (err) {
    console.warn('[piper-cache] Voice asset purge failed:', err);
    return false;
  }
}

// ─── UI Rendering ────────────────────────────────────────────────

// ─── Material Panel Rendering ─────────────────────────────────────

function getExerciseSectionKey(exercise) {
  return exercise.sectionKey || `part-${exercise.part}`;
}

function getExerciseSectionNodeKey(exercise) {
  return `${exercise.exam}-${getExerciseSectionKey(exercise)}`;
}

function getExerciseSectionLabel(exercise) {
  return exercise.sectionLabel || PART_LABELS[exercise.part] || `Part ${exercise.part}`;
}

function getExerciseSectionOrder(exercise) {
  return Number.isFinite(exercise.sectionOrder) ? exercise.sectionOrder : (Number(exercise.part) || 999);
}

function getExerciseSectionContextLabel(exercise) {
  if (exercise.sectionContextLabel) return exercise.sectionContextLabel;
  if (Number.isInteger(exercise.part)) return `P${exercise.part}`;
  return String(exercise.part || '').trim() || 'Materials';
}

function getExerciseItemLabel(exercise) {
  if (exercise.itemLabel) return exercise.itemLabel;
  const itemNumber = exercise.itemNumber || 1;
  return `Exercise ${String(itemNumber).padStart(2, '0')}`;
}

function getExerciseBadgeLabel(exercise) {
  const sectionLabel = exercise.sectionBadgeLabel || getExerciseSectionLabel(exercise);
  return `${sectionLabel} · ${getExerciseItemLabel(exercise)}`;
}

function getLevelsWithContent(lang) {
  const result = new Set();
  state.exercises.forEach(ex => {
    const meta = EXAM_META[ex.exam];
    if (meta && meta.language === lang) result.add(meta.level);
  });
  return result;
}

function openMaterialPanel() {
  // Ensure current exercise is visible when panel opens
  const curEx = state.exercises[state.currentIndex];
  if (curEx) {
    const meta = EXAM_META[curEx.exam];
    if (meta) {
      mpState.lang = meta.language;
      mpState.level = meta.level;
      mpState.expandedMaterials.add(curEx.exam);
      mpState.expandedParts.add(getExerciseSectionNodeKey(curEx));
    }
  }
  renderMaterialPanel();
  mpState.open = true;
  $('#mp-panel').classList.add('open');
  $('#mp-overlay').classList.add('open');
  setTimeout(() => {
    const active = document.querySelector('#mp-panel .mp-exercise.active');
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 310);
}

function closeMaterialPanel() {
  mpState.open = false;
  $('#mp-panel').classList.remove('open');
  $('#mp-overlay').classList.remove('open');
}

function renderMaterialPanel() {
  // Language bar
  const langBar = $('#mpLangBar');
  langBar.innerHTML = Object.entries(LANGUAGE_CONFIG).map(([code, cfg]) =>
    `<button class="mp-lang-btn${mpState.lang === code ? ' active' : ''}" data-lang="${code}">${cfg.label}</button>`
  ).join('');
  langBar.querySelectorAll('.mp-lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      mpState.lang = btn.dataset.lang;
      const withContent = getLevelsWithContent(mpState.lang);
      const levels = LANGUAGE_CONFIG[mpState.lang].levels;
      const match = levels.find(l => withContent.has(l.id));
      mpState.level = match ? match.id : (levels[0]?.id || '');
      renderMaterialPanel();
    });
  });

  // Level pills
  const levelBar = $('#mpLevelBar');
  const withContent = getLevelsWithContent(mpState.lang);
  const levels = LANGUAGE_CONFIG[mpState.lang]?.levels || [];
  levelBar.innerHTML = levels.map(l =>
    `<button class="mp-level-pill${mpState.level === l.id ? ' active' : ''}${withContent.has(l.id) ? ' has-content' : ''}" data-level="${l.id}">${l.label}</button>`
  ).join('');
  levelBar.querySelectorAll('.mp-level-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      mpState.level = btn.dataset.level;
      renderMaterialPanel();
    });
  });

  renderMaterialTree();
}

function renderMaterialTree() {
  const tree = $('#mpTree');
  const matchingExams = Object.entries(EXAM_META).filter(
    ([, meta]) => meta.language === mpState.lang && meta.level === mpState.level
  );

  if (matchingExams.length === 0) {
    tree.innerHTML = '<div class="mp-empty">No materials yet for this level.<br>More content coming soon! 🌱</div>';
    return;
  }

  const chevron  = '<svg class="mp-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';
  const chevronSm = '<svg class="mp-chevron-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';

  let html = '';
  for (const [examKey, examMeta] of matchingExams) {
    const expanded = mpState.expandedMaterials.has(examKey);
    const examExercises = state.exercises.filter(e => e.exam === examKey);
    const sections = [...new Map(
      examExercises.map((exercise) => [
        getExerciseSectionKey(exercise),
        {
          key: getExerciseSectionKey(exercise),
          label: getExerciseSectionLabel(exercise),
          order: getExerciseSectionOrder(exercise),
        },
      ]),
    ).values()].sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      return left.label.localeCompare(right.label, 'en');
    });

    html += `<div class="mp-material${expanded ? ' expanded' : ''}" data-exam="${examKey}">`;
    html += `<div class="mp-material-header" role="button" aria-expanded="${expanded}">${chevron}<span class="mp-material-icon">📖</span><span class="mp-material-label">${examMeta.label}</span></div>`;
    html += `<div class="mp-parts">`;

    for (const section of sections) {
      const partKey = `${examKey}-${section.key}`;
      const partExpanded = mpState.expandedParts.has(partKey);
      const partExercises = examExercises.filter((exercise) => getExerciseSectionKey(exercise) === section.key);
      const partLabel = section.label;

      html += `<div class="mp-part${partExpanded ? ' expanded' : ''}" data-part-key="${partKey}">`;
      html += `<div class="mp-part-header" role="button" aria-expanded="${partExpanded}">${chevronSm}<span class="mp-part-label">${partLabel}</span></div>`;
      html += `<div class="mp-exercises">`;

      partExercises.forEach((ex, i) => {
        const exIdx = state.exercises.indexOf(ex);
        const isActive = exIdx === state.currentIndex;
        const num = String(ex.itemNumber || i + 1).padStart(2, '0');
        html += `<div class="mp-exercise${isActive ? ' active' : ''}" data-idx="${exIdx}" role="treeitem" aria-selected="${isActive}"><span class="mp-exercise-num">${num}</span><span class="mp-exercise-title">${escapeHtml(ex.title)}</span></div>`;
      });

      html += `</div></div>`; // mp-exercises, mp-part
    }

    html += `</div></div>`; // mp-parts, mp-material
  }

  tree.innerHTML = html;

  // Expand/collapse: materials
  tree.querySelectorAll('.mp-material-header').forEach(header => {
    const node = header.closest('.mp-material');
    const examKey = node.dataset.exam;
    header.addEventListener('click', () => {
      const isExpanded = node.classList.toggle('expanded');
      header.setAttribute('aria-expanded', isExpanded);
      if (isExpanded) mpState.expandedMaterials.add(examKey);
      else mpState.expandedMaterials.delete(examKey);
    });
  });

  // Expand/collapse: parts
  tree.querySelectorAll('.mp-part-header').forEach(header => {
    const node = header.closest('.mp-part');
    const partKey = node.dataset.partKey;
    header.addEventListener('click', () => {
      const isExpanded = node.classList.toggle('expanded');
      header.setAttribute('aria-expanded', isExpanded);
      if (isExpanded) mpState.expandedParts.add(partKey);
      else mpState.expandedParts.delete(partKey);
    });
  });

  // Exercise leaf click → load + close panel
  tree.querySelectorAll('.mp-exercise').forEach(el => {
    el.addEventListener('click', () => {
      loadExercise(+el.dataset.idx);
      closeMaterialPanel();
    });
  });
}

function syncMaterialPanel() {
  // Update active exercise highlight without full re-render
  const tree = $('#mpTree');
  if (!tree) return;
  tree.querySelectorAll('.mp-exercise').forEach(el => {
    const isActive = +el.dataset.idx === state.currentIndex;
    el.classList.toggle('active', isActive);
    el.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  // Update trigger button context label
  const ctxEl = $('#btnMaterialsCtx');
  if (ctxEl) {
    const ex = state.exercises[state.currentIndex];
    ctxEl.textContent = ex ? `${ex.exam} · ${getExerciseSectionContextLabel(ex)}` : 'Materials';
  }
}

function initMaterialPanel() {
  renderMaterialPanel();
  $('#btnMaterials').addEventListener('click', openMaterialPanel);
  $('#mp-overlay').addEventListener('click', closeMaterialPanel);
  $('#mpClose').addEventListener('click', closeMaterialPanel);
  // Swipe-left to close (touch)
  let _touchStartX = 0;
  $('#mp-panel').addEventListener('touchstart', e => { _touchStartX = e.touches[0].clientX; }, { passive: true });
  $('#mp-panel').addEventListener('touchend', e => {
    if (e.changedTouches[0].clientX - _touchStartX < -60) closeMaterialPanel();
  }, { passive: true });
}



async function loadExercise(index) {
  stop();
  state.currentIndex = index;
  const ex = state.exercises[index];
  debugLog(`loadExercise(${index})`, ex.title);
  // Sync panel to reflect loaded exercise
  syncMaterialPanel();
  state.sentences = splitSentences(ex.text);
  state.sentenceIndex = 0;
  state.elapsedMs = 0;
  state.ttsMeta = null;
  resetAudioAssets();
  state.ttsMetaBySpeed = {};
  state._initError = null;

  $('#exerciseBadge').textContent = getExerciseBadgeLabel(ex);
  $('#exerciseTitle').textContent = ex.title;
  $('#transcriptText').innerHTML = state.sentences.map((s, i) => {
    // Tokenize identically to buildWordTimings so word spans and word timings
    // are always 1:1 (any mismatch would desync the text and the progress bar).
    const words = s.split(/\s+/).filter(Boolean).map(w => `<span class="word"><span class="word-text">${w}</span></span>`).join(' ');
    return `<span class="sentence" data-idx="${i}">${words}</span> `;
  }).join('');

  async function jumpToSentenceMs(sentIdx, ms) {
    const repeatWasEnabled = state.repeatMode && state.dictMode !== 'programmed';
    const shouldPlay = (state.playing && !state.paused) || repeatWasEnabled;
    const targetIsLastSentence = sentIdx === state.sentences.length - 1;
    clearScrubResumeTimer();
    _repeatSeekInFlight = repeatWasEnabled && shouldPlay;
    if (repeatWasEnabled) setRepeatTargetIndex(sentIdx);
    stopPlayheadTracker();
    if (!shouldPlay) {
      stopSrcNode();
      state.playing = false;
      state.paused = false;
    }
    state.elapsedMs = ms;
    state.sentenceIndex = sentIdx;
    try {
      if (shouldPlay) {
        if (repeatWasEnabled && targetIsLastSentence) {
          await seekToTime(ms, false, {
            snapProgress: true,
            targetSentenceIndex: sentIdx,
          });
          await play();
        } else {
          await seekToTime(ms, true, {
            snapProgress: true,
            playFromMs: ms,
            targetSentenceIndex: sentIdx,
          });
        }
      } else {
        highlightSentence(sentIdx, { scroll: false });
        updateProgress();
        setPlayIcon(false);
        $('#btnPlay').classList.add('primary');
      }
    } finally {
      if (repeatWasEnabled) {
        setRepeatTargetIndex(sentIdx);
        updateABButtons();
        highlightSentence(sentIdx, { scroll: false });
        updateProgress();
      }
      _repeatSeekInFlight = false;
    }
  }

  // Sentence-level click: jump to that sentence start and, if playback was
  // already running, continue from there so repeat mode retargets immediately.
  $('#transcriptText').querySelectorAll('.sentence').forEach(el => {
    el.addEventListener('click', () => {
      const sentIdx = +el.dataset.idx;
      const bound = getSentenceMsBoundary(sentIdx);
      const ms = Math.max(bound.startMs, Math.min(bound.endMs - 1, bound.startMs));
      void jumpToSentenceMs(sentIdx, ms);
    });
  });

  // Word-level click: position playhead at exact word in the timeline
  $('#transcriptText').querySelectorAll('.word').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const sentEl = el.closest('.sentence');
      const sentIdx = +sentEl.dataset.idx;
      const words = [...sentEl.querySelectorAll('.word')];
      const wordIdx = words.indexOf(el);

      // Seek to this word's start on the shared timeline. The clicked sentence
      // is the source of truth for WHICH sentence — we clamp the seek strictly
      // inside it so the highlight, fill and thumb always resolve to THIS
      // sentence even if the word timings are imprecise or overflow the segment.
      const bound = getSentenceMsBoundary(sentIdx);
      let ms;
      if (bound.words && bound.words[wordIdx]) {
        ms = bound.words[wordIdx].startMs;
      } else {
        const frac = words.length > 0 ? wordIdx / words.length : 0;
        ms = bound.startMs + frac * (bound.endMs - bound.startMs);
      }
      void jumpToSentenceMs(sentIdx, Math.max(bound.startMs, Math.min(bound.endMs - 1, ms)));
    });
  });

  // Preserve transcript visibility across exercise changes
  if (!state.transcriptVisible) {
    $('#top-panel').classList.add('transcript-blurred');
    $('#btnToggleTranscript').innerHTML = ICONS.eyeOff;
    $('#btnToggleTranscript').title = 'Show Transcript';
  }

  // Load audio from TTS server in background
  state.totalDurationMs = state.sentences.reduce((s, sent) => s + estimateDuration(sent), 0);
  renderProgressSegments();
  updateUI();
  resetDictation();
  highlightSentence(0);
  updateABButtons();
  updateProgress();

  // Start audio loading (non-blocking)
  loadExerciseAudio(ex);
}

let _transcriptPlayheadWord = null;

function ensureTranscriptPlayhead() {
  const host = $('#transcriptText');
  if (!host) return null;

  let playhead = host.querySelector('.transcript-playhead');
  if (!playhead) {
    playhead = document.createElement('div');
    playhead.className = 'transcript-playhead';
    host.prepend(playhead);
  }
  return playhead;
}

function syncTranscriptPlayhead(wordEl, { animate = true, force = false } = {}) {
  const host = $('#transcriptText');
  const playhead = ensureTranscriptPlayhead();
  if (!host || !playhead) return;

  playhead.classList.toggle('repeat', state.repeatMode);

  if (!wordEl) {
    playhead.classList.remove('visible', 'no-transition');
    _transcriptPlayheadWord = null;
    return;
  }

  const sameWord = _transcriptPlayheadWord === wordEl;
  if (sameWord && !force) {
    playhead.classList.add('visible');
    return;
  }

  const previousSentence = _transcriptPlayheadWord?.closest('.sentence');
  const nextSentence = wordEl.closest('.sentence');
  const shouldAnimate = animate && !!_transcriptPlayheadWord && previousSentence === nextSentence;

  if (!shouldAnimate) playhead.classList.add('no-transition');

  const hostRect = host.getBoundingClientRect();
  const wordRect = wordEl.getBoundingClientRect();
  playhead.style.left = (wordRect.left - hostRect.left) + 'px';
  playhead.style.top = (wordRect.top - hostRect.top) + 'px';
  playhead.style.width = wordRect.width + 'px';
  playhead.style.height = wordRect.height + 'px';
  playhead.classList.add('visible');

  if (!shouldAnimate) {
    void playhead.offsetWidth;
    playhead.classList.remove('no-transition');
  }

  _transcriptPlayheadWord = wordEl;
}

function refreshTranscriptPlayhead() {
  requestAnimationFrame(() => updateWordHighlight({ animate: false, forcePlayhead: true }));
}

function highlightSentence(idx, { scroll = true, animateWordPlayhead = false } = {}) {
  state.sentenceIndex = idx;
  const els = document.querySelectorAll('.sentence');
  els.forEach((el, i) => {
    el.classList.toggle('active', i === idx);
    el.classList.toggle('repeat', i === idx && state.repeatMode);
  });
  if (scroll && els[idx]) {
    els[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  updateWordHighlight({ animate: animateWordPlayhead });
}

function updateWordHighlight({ animate = true, forcePlayhead = false } = {}) {
  const idx = state.sentenceIndex;
  const sentEls = document.querySelectorAll('.sentence');
  if (!sentEls[idx]) {
    syncTranscriptPlayhead(null);
    return;
  }

  const bound = getSentenceMsBoundary(idx);
  const words = sentEls[idx].querySelectorAll('.word');
  if (words.length === 0) {
    syncTranscriptPlayhead(null);
    return;
  }

  document.querySelectorAll('.word').forEach(w => {
    w.classList.remove('spoken', 'speaking');
  });

  // The playhead sits in exactly one word. Word timings tile the sentence in
  // the SAME timeline as the thumb, so the speaking word is always the one
  // under the thumb — the two forms stay locked together.
  const timings = (bound.words && bound.words.length === words.length) ? bound.words : null;
  let speakingIdx;
  if (timings) {
    speakingIdx = 0;
    for (let i = 0; i < timings.length; i++) {
      if (state.elapsedMs >= timings[i].startMs - 1) speakingIdx = i;
      else break;
    }
    // Past the final word's end — whole sentence is spoken.
    if (state.elapsedMs >= timings[timings.length - 1].endMs - 1) speakingIdx = words.length;
  } else {
    const span = bound.endMs - bound.startMs;
    const frac = span > 0 ? Math.max(0, Math.min(1, (state.elapsedMs - bound.startMs) / span)) : 0;
    speakingIdx = Math.min(words.length, Math.floor(frac * words.length));
  }

  words.forEach((w, i) => {
    if (i < speakingIdx) w.classList.add('spoken');
    else if (i === speakingIdx) w.classList.add('speaking');
  });

  const speakingWord = speakingIdx < words.length ? words[speakingIdx] : null;
  syncTranscriptPlayhead(speakingWord, { animate, force: forcePlayhead });
}

function updateABButtons() {
  $('#btnRepeat').classList.toggle('ab-active', state.repeatMode);
}

function updateUI() {
  $('#speedSelect').value = state.speedPreset;
  updateABButtons();
  updateProgress();
  updateTransportControls();
}

const _transportButtons = ['btnRew', 'btnFwd', 'btnPrev', 'btnNext', 'btnRepeat'];

function updateTransportControls() {
  const programmed = state.dictMode === 'programmed';
  const testRunning = programmed && (state.playing || state.paused || state.inLapGap);
  _transportButtons.forEach(id => {
    const el = $('#' + id);
    if (el) el.style.display = programmed ? 'none' : '';
  });
  // btnPlay is always visible — update its appearance for the current mode
  if (programmed) {
    setPlayIcon(testRunning);
  }
}

function updateProgress() {
  const total = state.totalDurationMs || 1;
  const currentPct = Math.min(100, (state.elapsedMs / total) * 100);

  // Calculate the current sentence's segment boundaries using meta if available
  const bound = getSentenceMsBoundary(state.sentenceIndex);
  const sentStartPct = total ? (bound.startMs / total) * 100 : 0;
  const sentEndPct = total ? (bound.endMs / total) * 100 : 100;

  // Fill only the current sentence's segment, up to the playhead position.
  // Clamp to the sentence so the fill can never bleed into adjacent sentences.
  const clampedPct = Math.max(sentStartPct, Math.min(sentEndPct, currentPct));
  const fillWidth = clampedPct - sentStartPct;
  $('#progressFill').style.left = sentStartPct + '%';
  $('#progressFill').style.width = fillWidth + '%';
  $('#progressFill').style.borderRadius = '999px';

  $('#progressThumb').style.left = currentPct + '%';

  // Highlight current segment
  $$('.progress-segment').forEach((seg, i) => {
    seg.classList.toggle('current', i === state.sentenceIndex);
    seg.classList.toggle('repeat', i === state.sentenceIndex && state.repeatMode);
  });

  // Color the fill to match repeat mode
  const fill = $('#progressFill');
  if (state.repeatMode) {
    fill.style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)';
  } else {
    fill.style.background = '';
  }

  // Laps-left indicator for programmed mode
  const lapsEl = $('#lapsLeft');
  if (state.inLapGap) {
    // Keep the gap indicator visible (styled by startLapGap)
    lapsEl.style.display = 'flex';
  } else if (state.dictMode === 'programmed' && state.playing && !state.paused && state.programmedPhase === 'sentence') {
    const lapsLeft = state.programmedLaps - state.currentLap + 1;
    const bound = getSentenceMsBoundary(state.sentenceIndex);
    const centerPct = ((bound.startMs + bound.endMs) / 2) / (state.totalDurationMs || 1) * 100;
    lapsEl.textContent = lapsLeft;
    lapsEl.style.left = centerPct + '%';
    lapsEl.style.display = 'flex';
  } else {
    lapsEl.style.display = 'none';
  }

  const fmt = (ms) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m + ':' + String(sec).padStart(2, '0');
  };
  $('#timeDisplay').textContent = fmt(state.elapsedMs) + ' / ' + fmt(total);
  updateWordHighlight();
  updateTransportControls();
}

function renderProgressSegments() {
  const container = $('#progressSegments');
  const total = state.totalDurationMs || 1;
  let parts = [];
  // Use TTS meta boundaries if available, otherwise estimate
  for (let i = 0; i < state.sentences.length; i++) {
    const bound = getSentenceMsBoundary(i);
    const startPct = (bound.startMs / total) * 100;
    const endPct = (bound.endMs / total) * 100;
    const width = endPct - startPct;
    const tick = i > 0
      ? `<div class="progress-tick" data-idx="${i}" style="left:${startPct.toFixed(2)}%"></div>`
      : '';
    parts.push(
      `<div class="progress-segment" data-idx="${i}" style="left:${startPct.toFixed(2)}%;width:${width.toFixed(2)}%"></div>` +
      tick
    );
  }
  container.innerHTML = parts.join('');
}

// ─── Piper Provider & Voice Management ───────────────────────────

let _initPromise = null; // prevents concurrent initProvider() calls

async function initProvider() {
  // If already initializing, wait for that to finish instead of racing
  if (_initPromise) {
    debugLog('[initProvider] Already initializing — waiting for existing init');
    await _initPromise;
    return;
  }

  const modelId = VOICE_MODELS[state.voiceType];

  // Create the promise synchronously (before any await) so concurrent callers
  // see _initPromise is set and wait instead of racing.
  _initPromise = (async () => {
    try {
      // Wait for our pre-registered SW (started at import time) so the
      // provider's internal setupAssetSw returns instantly.
      if (_swReady) {
        await _swReady.catch(() => {}); // don't block if SW fails
      }

      if (!state.provider) {
        state.provider = createPiperProvider({ debug: APP_DEBUG });
      }
      const INIT_TIMEOUT_MS = 90_000;

      state.loadingMessage = 'Loading…';
      document.querySelector('.loading-bar-fill')?.classList.add('indeterminate');

      // Warm the Functions proxy so subsequent model downloads don't hit
      // a cold start (especially impactful on slower iPad connections).
      // Hit a small config file through the proxy to trigger Function init.
      const warmupPath = `/proxy-hf/rinaldow/piper-onnx-durations/resolve/main/english/US/${state.voiceType === 'man' ? 'male' : 'female'}/${state.voiceType === 'man' ? 'Bryce' : 'Kristin'}/${modelId}.onnx.json`;
      fetch(warmupPath).catch(() => {});
      debugLog('[initProvider] Proxy warmup sent:', warmupPath);

      const t0 = Date.now();
      const cpuInstances = getPiperCpuInstances();

      const initPromise = state.provider.init({
        modelId,
        cpuInstances,
        onProgress: (s) => {
          document.querySelector('.loading-bar-fill')?.classList.remove('indeterminate');
          state.loadingProgress = s.progress;
          const pct = Math.round(s.progress * 100);
          state.loadingMessage = `Loading… ${pct}%`;
          updateLoadingBar();
        },
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Voice model init timed out after ${INIT_TIMEOUT_MS / 1000}s`)), INIT_TIMEOUT_MS)
      );
      await Promise.race([initPromise, timeoutPromise]);
      document.querySelector('.loading-bar-fill')?.classList.remove('indeterminate');

      state.providerReady = true;
      debugLog(`[initProvider] ready in ${((Date.now() - t0) / 1000).toFixed(1)}s with cpuInstances=${cpuInstances}`);
    } catch (err) {
      document.querySelector('.loading-bar-fill')?.classList.remove('indeterminate');
      console.error('[initProvider] FAILED:', err.message, '| stack:', err.stack);
      state.loadingMessage = 'Loading failed. Please reload the page.';
      updateLoadingBar();
      // Keep overlay visible so user sees the error
      throw err;
    } finally {
      _initPromise = null;
    }
  })();

  await _initPromise;
}

async function initProviderWithCorruptModelRetry() {
  const modelId = VOICE_MODELS[state.voiceType];
  try {
    await initProvider();
  } catch (err) {
    console.warn('[initProvider] Init failed; purging cached voice assets and retrying once. Error:', err?.message || err);
    state.provider = null;
    state.providerReady = false;
    await purgeVoiceAssetCache(modelId);
    // Reset and try again — transient failures (network blips, SW races,
    // Safari fetch blocking) often succeed on the second attempt.
    _initPromise = null;
    await initProvider();
  }
}

async function switchVoice(voiceType) {
  const wasPlaying = state.playing && !state.paused;
  if (wasPlaying) stopSrcNode();

  state.ttsMeta = null;
  resetAudioAssets();
  state.ttsMetaBySpeed = {};
  state.elapsedMs = 0;
  state.sentenceIndex = 0;
  state.totalDurationMs = state.sentences.reduce((s, sent) => s + estimateDuration(sent), 0);
  renderProgressSegments();
  updateProgress();

  if (state.sentences.length > 0 && await loadAudioFromCache()) {
    debugLog('[switchVoice] Cache hit for voice:', voiceType);
    renderProgressSegments();
    updateProgress();
    if (wasPlaying) {
      await seekToTime(0, true);
    }
    return;
  }

  if (!state.provider || !state.providerReady) {
    await initProviderWithCorruptModelRetry();
  }

  const modelId = VOICE_MODELS[voiceType];
  try {
    await state.provider.init({ modelId, cpuInstances: getPiperCpuInstances() });
  } catch (err) {
    if (!isCorruptModelError(err)) {
      console.error('Voice switch failed:', err);
      return;
    }
    console.warn('[switchVoice] Model parse failed; purging cached voice assets and retrying once.');
    await purgeVoiceAssetCache(modelId);
    try {
      await state.provider.init({ modelId, cpuInstances: getPiperCpuInstances() });
    } catch (retryErr) {
      console.error('Voice switch failed after retry:', retryErr);
      return;
    }
  }
  // Re-synthesize with new voice
  if (state.sentences.length > 0) {
    state.loadingMessage = `Preparing ${SPEED_PRESETS[state.speedPreset].label.toLowerCase()} audio…`;
    state.loadingProgress = 0;
    showLoadingOverlay();
    await ensureAudioForPresets([state.speedPreset]);
  }
  if (wasPlaying) {
    await seekToTime(0, true);
  }
}

// ─── Audio-blocked banner ───────────────────────────────────────────────────
// Shown when HTMLAudioElement.play() is rejected (autoplay policy or other
// error). Guides the user to interact with the page.

function showAudioBlockedBanner() {
  if (document.getElementById('audio-blocked-banner')) return;
  const el = document.createElement('div');
  el.id = 'audio-blocked-banner';
  el.style.cssText = [
    'position:fixed', 'bottom:16px', 'left:50%', 'transform:translateX(-50%)',
    'background:#1a1a2e', 'color:#fff', 'padding:12px 20px', 'border-radius:12px',
    'font-family:var(--font,sans-serif)', 'font-size:0.85rem', 'z-index:9999',
    'box-shadow:0 4px 20px rgba(0,0,0,0.4)', 'display:flex', 'align-items:center',
    'gap:12px', 'max-width:90vw',
  ].join(';');
  el.innerHTML = `<span>🔇 Audio unavailable in this window</span>
    <a href="${location.href}" target="_blank" rel="noopener"
      style="background:#e8458b;color:#fff;padding:6px 14px;border-radius:8px;
             text-decoration:none;font-weight:700;white-space:nowrap">
      Open new window
    </a>
    <button onclick="this.closest('#audio-blocked-banner').remove()"
      style="background:none;border:none;color:#aaa;font-size:1.2rem;cursor:pointer;padding:0 2px">✕</button>`;
  document.body.appendChild(el);
}

function hideAudioBlockedBanner() {
  document.getElementById('audio-blocked-banner')?.remove();
}

// ─── Loading Overlay ───────────────────────────────────────────────

function showLoadingOverlay() {
  let overlay = document.querySelector('.loading-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.innerHTML = `
      <div class="loading-spinner"></div>
      <div class="loading-text" id="loadingText"></div>
      <div class="loading-bar-wrap">
        <div class="loading-bar"><div class="loading-bar-fill" id="loadingBarFill"></div></div>
        <span class="loading-pct" id="loadingPct">0%</span>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'flex';
  updateLoadingOverlay();
}

function hideLoadingOverlay() {
  const overlay = document.querySelector('.loading-overlay');
  if (overlay) overlay.style.display = 'none';
}

function updateLoadingOverlay() {
  const textEl = document.getElementById('loadingText');
  const barEl = document.getElementById('loadingBarFill');
  const pctEl = document.getElementById('loadingPct');
  if (textEl) textEl.textContent = state.loadingMessage || 'Loading...';
  const pct = Math.round((state.loadingProgress || 0) * 100);
  if (barEl) barEl.style.width = `${pct}%`;
  if (pctEl) pctEl.textContent = `${pct}%`;
}

function updateLoadingBar() {
  updateLoadingOverlay();
}

// ─── Voice Model Mapping ──────────────────────────────────────────

const VOICE_MODELS = {
  man:  'en_US-bryce-medium',
  lady: 'en_US-kristin-medium',
};

// ─── Speed Presets (Piper duration multiplier: >1 = slower, <1 = faster) ──

const SPEED_PRESETS = {
  slow:   { speed: 1.6, label: 'Slow' },
  normal: { speed: 1.0, label: 'Normal' },
  fast:   { speed: 0.72, label: 'Fast' },
};

async function setSpeed(preset) {
  if (!SPEED_PRESETS[preset]) return;

  const wasPlaying = state.playing && !state.paused;
  const previousPreset = state.speedPreset;

  // Capture position as sentence-index + fraction BEFORE switching timelines.
  // Raw elapsedMs from one speed cannot be used directly in another speed's
  // buffer — the total duration and per-sentence boundaries differ.
  const oldMs = wasPlaying ? currentAudioTime() * 1000 : state.elapsedMs;
  const oldMeta = state.ttsMeta;
  const oldSentIdx = getSentenceAtTime(oldMs);

  if (wasPlaying) stopSrcNode();

  state.speedPreset = preset;
  if (!state.audioURLs[preset] || !state.ttsMetaBySpeed[preset]) {
    try {
      state.loadingMessage = `Preparing ${SPEED_PRESETS[preset].label.toLowerCase()} audio…`;
      state.loadingProgress = 0;
      showLoadingOverlay();
      await ensureAudioForPresets([preset]);
    } catch (err) {
      console.error('[setSpeed] Failed to prepare audio:', err);
      state.speedPreset = previousPreset;
      state.ttsMeta = state.ttsMetaBySpeed[previousPreset] || oldMeta || null;
      state.totalDurationMs = state.ttsMeta ? state.ttsMeta.durationMs : 0;
      state.loadingMessage = `Audio preparation failed: ${err.message || 'unknown error'}`;
      state.loadingProgress = 0;
      showLoadingOverlay();
      document.querySelector('.loading-bar-fill')?.classList.remove('indeterminate');
      updateLoadingOverlay();
      renderProgressSegments();
      updateProgress();
      return;
    }
  }
  state.ttsMeta = state.ttsMetaBySpeed[preset] || state.ttsMeta;
  state.totalDurationMs = state.ttsMeta ? state.ttsMeta.durationMs : 0;

  // Map old position into the new speed's timeline via sentence fraction.
  let newMs = oldMs;
  if (oldMeta && oldMeta.sentences && state.ttsMeta && state.ttsMeta.sentences) {
    const oldBound = oldMeta.sentences[oldSentIdx];
    const newBound = state.ttsMeta.sentences[oldSentIdx];
    if (oldBound && newBound) {
      const sentDur = oldBound.endMs - oldBound.startMs;
      const fraction = sentDur > 0
        ? Math.max(0, Math.min(1, (oldMs - oldBound.startMs) / sentDur))
        : 0;
      newMs = newBound.startMs + fraction * (newBound.endMs - newBound.startMs);
    } else if (newBound) {
      newMs = newBound.startMs;
    }
  }

  // Re-render segments for the new speed's boundaries
  renderProgressSegments();

  if (wasPlaying) {
    await seekToTime(newMs, true);
  } else {
    state.elapsedMs = newMs;
    updateProgress();
  }
}

// ─── Audio Engine Helpers ──────────────────────────────────────────

function currentAudioTime() {
  if (state.srcNode === _player) return _player.currentTime;
  return state.elapsedMs / 1000;
}

function stopSrcNode() {
  try {
    _player.pause();
    _player.playbackRate = 1;
  } catch (_) { /* ignore */ }
  state.srcNode = null;
  _playerToken = 0;
}

let _repeatSeekInFlight = false;
let _playerToken = 0;

function getRepeatTargetIndex() {
  if (typeof state.repeatSentenceIndex === 'number'
    && state.repeatSentenceIndex >= 0
    && state.repeatSentenceIndex < state.sentences.length) {
    return state.repeatSentenceIndex;
  }
  return state.sentenceIndex;
}

function setRepeatTargetIndex(idx) {
  const clamped = Math.max(0, Math.min(state.sentences.length - 1, idx));
  state.repeatSentenceIndex = clamped;
  return clamped;
}

function syncRepeatTargetToCurrentPosition() {
  const ms = state.playing && !state.paused ? currentAudioTime() * 1000 : state.elapsedMs;
  const idx = setRepeatTargetIndex(getSentenceAtTime(ms));
  state.sentenceIndex = idx;
  return idx;
}

async function restartCurrentSentenceForRepeat() {
  if (_repeatSeekInFlight) return;
  if (!state.repeatMode || state.dictMode === 'programmed') return;
  if (!state.playing || state.paused || state.scrubbing) return;

  const repeatIdx = getRepeatTargetIndex();
  const curBound = getSentenceMsBoundary(repeatIdx);
  state.sentenceIndex = repeatIdx;
  _repeatSeekInFlight = true;
  try {
    await seekToTime(curBound.startMs, true, {
      snapProgress: true,
      targetSentenceIndex: repeatIdx,
    });
  } finally {
    _repeatSeekInFlight = false;
  }
}

// ─── HTMLAudioElement playback (Safari/macOS interruption-proof) ─────────────
//
// Web Audio's AudioContext OUTPUT dies permanently after a macOS/iOS Safari
// audio-session interruption (backgrounding for a few minutes, Space switch,
// display sleep). Verified via the clock probe: after returning, a brand-new
// AudioContext created inside a user gesture, resumed to 'running', with valid
// non-zero PCM, still renders SILENCE while its clock keeps advancing. A plain
// reload does not clear it because the same renderer process keeps the wedged
// audio session; only a brand-new window/process recovered.
//
// HTMLMediaElement uses the platform media pipeline (the path music/podcast
// apps use), which is designed to survive interruptions and output-route
// changes. So playback goes through a single <audio> element and ALL timing is
// driven from audio.currentTime. No AudioContext is used for playback.
// See webapp/DEBUG-NOTES.md "AudioContext — Safari/macOS lesson".

const _player = new Audio();
_player.preload = 'auto';
_player.setAttribute('playsinline', '');
try { _player.style.display = 'none'; (document.body || document.documentElement).appendChild(_player); } catch (_) { /* ignore */ }

_player.addEventListener('timeupdate', () => {
  if (!state.repeatMode || state.dictMode === 'programmed') return;
  if (state.srcNode !== _player || !state.playing || state.paused || state.scrubbing) return;

  const curBound = getSentenceMsBoundary(getRepeatTargetIndex());
  const elapsedMs = _player.currentTime * 1000;
  if (elapsedMs >= curBound.endMs - 10) {
    restartCurrentSentenceForRepeat();
  }
});

// Natural end of playback (free mode). Programmed mode stops earlier in the tracker.
_player.addEventListener('ended', () => {
  if (state.srcNode !== _player) return;

  if (state.repeatMode && state.dictMode !== 'programmed') {
    restartCurrentSentenceForRepeat();
    return;
  }

  state.srcNode = null;
  if (state.dictMode !== 'programmed') {
    state.playing = false;
    state.elapsedMs = 0;
    state.sentenceIndex = 0;
    stopPlayheadTracker();
    setPlayIcon(false);
    $('#btnPlay').classList.add('primary');
    highlightSentence(0);
    updateProgress();
  }
});

// Encode mono Float32 PCM as a 16-bit WAV Blob for the <audio> element.
function pcmToWavBlob(float32, sampleRate) {
  const n = float32.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, 1, true);            // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, n * 2, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(off, s, true);
    off += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

// Store PCM for one speed preset and build a fresh blob URL for playback.
function setPlayerPCM(preset, float32, sampleRate) {
  state.audioPCM[preset] = { data: float32, sampleRate, length: float32.length };
  if (_reversedTrackURLs[preset]) {
    try { URL.revokeObjectURL(_reversedTrackURLs[preset]); } catch (_) { /* ignore */ }
    delete _reversedTrackURLs[preset];
  }
  if (state.audioURLs[preset]) { try { URL.revokeObjectURL(state.audioURLs[preset]); } catch (_) { /* ignore */ } }
  state.audioURLs[preset] = URL.createObjectURL(pcmToWavBlob(float32, sampleRate));
}

const _reversedTrackURLs = {};

// Point the <audio> element at the given preset's blob URL (no-op if unchanged).
function ensurePlayerSrc(preset) {
  const url = state.audioURLs[preset];
  if (!url) return false;
  if (_player.dataset.preset !== preset) {
    _player.src = url;
    _player.dataset.preset = preset;
  }
  return true;
}

function getReversedTrackUrl(preset) {
  const cached = _reversedTrackURLs[preset];
  if (cached) return cached;

  const pcm = state.audioPCM[preset];
  if (!pcm?.data || !(pcm.sampleRate > 0)) return null;

  const reversed = new Float32Array(pcm.data.length);
  for (let i = 0, j = pcm.data.length - 1; i < pcm.data.length; i++, j--) reversed[i] = pcm.data[j];

  const url = URL.createObjectURL(pcmToWavBlob(reversed, pcm.sampleRate));
  _reversedTrackURLs[preset] = url;
  return url;
}

function ensureReversedPlayerSrc(preset) {
  const url = getReversedTrackUrl(preset);
  if (!url) return false;
  const rewPreset = `__rew__:${preset}`;
  if (_player.dataset.preset !== rewPreset) {
    _player.src = url;
    _player.dataset.preset = rewPreset;
  }
  return true;
}

// Revoke and clear all audio assets (called when switching exercise/voice).
function resetAudioAssets() {
  for (const k of Object.keys(state.audioURLs)) { try { URL.revokeObjectURL(state.audioURLs[k]); } catch (_) { /* ignore */ } }
  state.audioURLs = {};
  for (const k of Object.keys(_reversedTrackURLs)) {
    try { URL.revokeObjectURL(_reversedTrackURLs[k]); } catch (_) { /* ignore */ }
    delete _reversedTrackURLs[k];
  }
  state.audioPCM = {};
  try { _player.pause(); } catch (_) { /* ignore */ }
  _player.removeAttribute('src');
  delete _player.dataset.preset;
  try { _player.load(); } catch (_) { /* ignore */ }
  state.srcNode = null;
}

// One-time silent WAV used to "bless" _player within the first user gesture
// when audio isn't loaded yet, so that deferred play() calls (after async
// synthesis/cache load) succeed without a gesture. Only fires when _player
// has no real src; if real audio is already loaded, doPlay() itself calls
// play() synchronously inside the gesture — no pre-unlock needed.
const _silentUrl = URL.createObjectURL(pcmToWavBlob(new Float32Array(2205), 22050));
let _playerUnlocked = false;
function unlockPlayerSync() {
  if (_playerUnlocked) return;
  // If real audio is already loaded, doPlay will call play() synchronously
  // within the gesture — mark unlocked and let doPlay do its job.
  if (_player.src && _player.dataset.preset !== '__unlock__') {
    _playerUnlocked = true;
    return;
  }
  // Audio not ready yet — play the silent blob now to bless _player for
  // the deferred play() that will happen once loading completes.
  try {
    _player.src = _silentUrl;
    _player.dataset.preset = '__unlock__';
    const p = _player.play();
    const done = () => { _playerUnlocked = true; };
    if (p && p.then) p.then(done).catch(done);
    else done();
  } catch (_) { _playerUnlocked = true; }
}

// ─── Exercise Loading (Piper WASM synthesis) ────────────────────────

async function synthesizeAllSpeeds(presets = [state.speedPreset]) {
  const synthPresets = [...new Set((presets || []).filter((preset) => SPEED_PRESETS[preset]))];
  if (synthPresets.length === 0) return;

  debugLog('[synthesizeAllSpeeds] Starting synthesis for', state.sentences.length, 'sentences x', synthPresets.length, 'presets');
  const totalSteps = Math.max(1, synthPresets.length * Math.max(state.sentences.length, 1));
  let completedSteps = 0;
  for (const preset of synthPresets) {
    const spd = SPEED_PRESETS[preset];
    debugLog(`[synthesizeAllSpeeds] === ${preset} (speed=${spd.speed}) ===`);
    state.loadingMessage = 'Preparing audio…';
    state.loadingProgress = completedSteps / totalSteps;
    showLoadingOverlay();
    await synthesizeAtSpeed(preset, (sentenceProgress) => {
      const step = completedSteps + sentenceProgress * state.sentences.length;
      state.loadingProgress = step / totalSteps;
      state.loadingMessage = `Preparing audio… ${Math.round(sentenceProgress * 100)}%`;
      updateLoadingOverlay();
    });
    completedSteps += state.sentences.length;
  }
  state.ttsMeta = state.ttsMetaBySpeed[state.speedPreset] || state.ttsMetaBySpeed[synthPresets[0]] || null;
  state.totalDurationMs = state.ttsMeta ? state.ttsMeta.durationMs : 0;
  state.elapsedMs = Math.max(0, Math.min(state.totalDurationMs || 0, state.elapsedMs));
  renderProgressSegments();
  hideLoadingOverlay();
}

async function ensureAudioForPresets(presets) {
  const wantedPresets = [...new Set((presets || []).filter((preset) => SPEED_PRESETS[preset]))];
  const missingPresets = wantedPresets.filter((preset) => !state.audioURLs[preset] || !state.ttsMetaBySpeed[preset]);

  if (missingPresets.length === 0) {
    state.ttsMeta = state.ttsMetaBySpeed[state.speedPreset] || state.ttsMeta;
    state.totalDurationMs = state.ttsMeta ? state.ttsMeta.durationMs : 0;
    return true;
  }

  if (!state.provider || !state.providerReady) {
    if (state.providerReady && !state.provider) {
      console.warn('[audio] providerReady=true but provider is null — re-initializing');
      state.providerReady = false;
    }
    await initProviderWithCorruptModelRetry();
  }

  try {
    await synthesizeAllSpeeds(missingPresets);
  } catch (err) {
    if (!isCorruptModelError(err)) throw err;
    console.warn('[audio] Model parse failed during synthesis — purging and retrying once.');
    state.provider = null;
    state.providerReady = false;
    await purgeVoiceAssetCache(VOICE_MODELS[state.voiceType]);
    await initProviderWithCorruptModelRetry();
    await synthesizeAllSpeeds(missingPresets);
  }

  await saveAudioToCache();
  state.ttsMeta = state.ttsMetaBySpeed[state.speedPreset] || state.ttsMeta;
  state.totalDurationMs = state.ttsMeta ? state.ttsMeta.durationMs : 0;
  return missingPresets.every((preset) => state.audioURLs[preset] && state.ttsMetaBySpeed[preset]);
}

async function synthesizeAtSpeed(preset, onProgress) {
  const spd = SPEED_PRESETS[preset];
  if (!spd || !state.provider || !state.providerReady) {
    debugLog(`synth abort: spd=${!!spd} provider=${!!state.provider} ready=${state.providerReady}`);
    return;
  }

  const sentences = state.sentences;
  const SYNTH_TIMEOUT_MS = 45_000; // 45s per sentence should be plenty

  // Dispatch through a bounded queue. iPad Safari is much more reliable when
  // it does not have several large worker/model jobs active at once.
  let completed = 0;
  const total = sentences.length;
  const concurrency = Math.min(total || 1, getSynthesisConcurrency());
  debugLog(`[synthesize] ${preset}: synthesizing ${total} sentences with concurrency=${concurrency}`);

  const results = new Array(total).fill(null);
  let nextIndex = 0;

  async function synthesizeOne(i) {
    const text = sentences[i];
    const startTime = performance.now();
    let timeoutId = null;
    const synthPromise = state.provider.synthesize(text, { speed: spd.speed });
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Synthesis timed out after ${SYNTH_TIMEOUT_MS / 1000}s`)), SYNTH_TIMEOUT_MS);
    });
    try {
      const res = await Promise.race([synthPromise, timeoutPromise]);
      debugLog(`[synthesize] ${preset} sentence ${i + 1}/${total} OK in ${((performance.now() - startTime) / 1000).toFixed(1)}s`);
      return res;
    } catch (err) {
      console.error(`[synthesize] ${preset} sentence ${i + 1}/${total} FAILED:`, err.message);
      if (isCorruptModelError(err)) throw err;
      return null;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      completed++;
      if (onProgress) onProgress(completed / total);
    }
  }

  async function worker() {
    while (nextIndex < total) {
      const i = nextIndex++;
      results[i] = await synthesizeOne(i);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // Build concatenated PCM buffer and metadata
  const validResults = results.filter(r => r && r.audioData && r.audioData.length > 0);
  if (validResults.length === 0) {
    debugLog(`synth ${preset}: 0/${results.length} valid results`);
    return;
  }

  const sampleRate = validResults[0].sampleRate;
  const guardSamples = Math.max(1, Math.round(sampleRate * 0.1)); // 100 ms

  // Compute total length and build per-sentence metadata
  let totalSamples = 0;
  const metaSentences = [];
  const segmentSpecs = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const wordCount = sentences[i].split(/\s+/).filter(w => w).length;
    const startSample = totalSamples;
    const speechStartSample = startSample + guardSamples;
    const hasAudio = !!(r && r.audioData && r.audioData.length > 0);
    const sampleLen = hasAudio
      ? r.audioData.length
      : Math.max(1, Math.round((estimateDuration(sentences[i]) / 1000) * sampleRate));
    const speechSpanMs = (sampleLen / sampleRate) * 1000;
    totalSamples = speechStartSample + sampleLen;

    // Compute per-word timing on the actual SPEECH timeline. The sentence's
    // segment starts at `startSample` (guard silence), while words begin at
    // `speechStartSample`. This creates a safe zone for prev/next seeks so
    // Safari can land slightly early/late without clipping adjacent words.
    const words = hasAudio
      ? buildWordTimings(sentences[i], r.metadata, speechStartSample, sampleRate, speechSpanMs)
      : buildFallbackWordTimings(sentences[i], (speechStartSample / sampleRate) * 1000, speechSpanMs);

    metaSentences.push({
      startMs: (startSample / sampleRate) * 1000,
      endMs: (totalSamples / sampleRate) * 1000,
      startSample,
      endSample: totalSamples,
      wordCount,
      words,
      durationMs: ((totalSamples - startSample) / sampleRate) * 1000,
      speechStartMs: (speechStartSample / sampleRate) * 1000,
    });

    segmentSpecs.push({
      startSample: speechStartSample,
      audioData: hasAudio ? r.audioData : null,
    });
  }

  // Concatenate all Float32Arrays. The output buffer is zero-filled by default,
  // so each sentence automatically gets its leading guard silence. Failed
  // syntheses become silence of the estimated duration instead of collapsing
  // later sentence boundaries.
  const concat = new Float32Array(totalSamples);
  for (const seg of segmentSpecs) {
    if (seg.audioData) {
      concat.set(seg.audioData, seg.startSample);
    }
  }

  // Store PCM + build a WAV blob URL for the <audio> element.
  setPlayerPCM(preset, concat, sampleRate);

  const totalDurationMs = totalSamples > 0 ? (totalSamples / sampleRate) * 1000 : 0;
  state.ttsMetaBySpeed[preset] = { sentences: metaSentences, durationMs: totalDurationMs, sampleRate };
}

// ─── Phoneme-to-Word Timings ────────────────────────────────────────

// Build per-word timings that TILE the sentence exactly on its sample-based
// timeline. Word weights come from summed phoneme durations when available
// (more natural pacing) and fall back to character length. The weights are then
// normalized to span exactly [sentenceStartMs, sentenceStartMs+sentenceDurationMs],
// which is the same timeline the progress-bar thumb and <audio> playhead use.
// This is what keeps the text highlight and the progress bar locked together.
function buildWordTimings(sentenceText, metadata, sentenceStartSample, sampleRate, sentenceDurationMs = 0) {
  const words = sentenceText.split(/\s+/).filter(w => w);
  const sentenceStartMs = (sentenceStartSample / sampleRate) * 1000;
  if (words.length === 0) return [];
  if (!(sentenceDurationMs > 0)) {
    return buildFallbackWordTimings(sentenceText, sentenceStartMs, sentenceDurationMs);
  }

  // Per-word weight.
  let weights;
  if (metadata && metadata.phonemes && metadata.durations && metadata.phonemes.length > 0) {
    const phonemes = metadata.phonemes;      // string[]
    const durations = metadata.durations;     // Float32Array (seconds)
    const totalPhonemes = phonemes.length;
    const totalChars = words.reduce((s, w) => s + w.length, 0) || words.length;
    weights = new Array(words.length).fill(0);
    let phonemeIdx = 0;
    for (let wi = 0; wi < words.length; wi++) {
      // Give the last word every remaining phoneme so nothing is dropped.
      let endPhonemeIdx;
      if (wi === words.length - 1) {
        endPhonemeIdx = totalPhonemes;
      } else {
        const charFrac = words[wi].length / totalChars;
        const count = Math.max(1, Math.round(charFrac * totalPhonemes));
        endPhonemeIdx = Math.min(totalPhonemes, phonemeIdx + count);
      }
      let d = 0;
      for (let pi = phonemeIdx; pi < endPhonemeIdx; pi++) d += durations[pi];
      weights[wi] = d;
      phonemeIdx = endPhonemeIdx;
    }
  } else {
    weights = words.map(w => w.length || 1);
  }

  let totalWeight = weights.reduce((a, b) => a + b, 0);
  if (!(totalWeight > 0)) { weights = weights.map(() => 1); totalWeight = weights.length; }

  // Normalize weights to tile the sentence span exactly and contiguously.
  const timings = [];
  let cum = 0;
  for (let wi = 0; wi < words.length; wi++) {
    const startMs = sentenceStartMs + (cum / totalWeight) * sentenceDurationMs;
    cum += weights[wi];
    const endMs = sentenceStartMs + (cum / totalWeight) * sentenceDurationMs;
    timings.push({ startMs, endMs });
  }
  // Snap the seams to kill floating-point drift.
  timings[0].startMs = sentenceStartMs;
  timings[timings.length - 1].endMs = sentenceStartMs + sentenceDurationMs;
  return timings;
}

function buildFallbackWordTimings(sentenceText, sentenceStartMs, sentenceDurationMs) {
  const words = sentenceText.split(/\s+/).filter(w => w);
  if (words.length === 0) return [];
  const charCounts = words.map(w => w.length);
  const totalChars = charCounts.reduce((a, b) => a + b, 0) || 1;

  let cumMs = sentenceStartMs;
  return words.map((_w, i) => {
    const frac = charCounts[i] / totalChars;
    const dur = sentenceDurationMs * frac;
    const startMs = cumMs;
    cumMs += dur;
    return { startMs: startMs, endMs: cumMs };
  });
}

// ─── IndexedDB Audio Cache ──────────────────────────────────────────

const CACHE_DB_NAME = 'word-by-word-cache';
const CACHE_STORE = 'synthesized-audio';
// Bump when the word-timing/meta format changes so stale entries are discarded.
const CACHE_META_VERSION = 3;
const CACHE_MAX_ENTRIES = Math.max(100, CONTENT_CATALOG.exercises.length * Object.keys(VOICE_MODELS).length * 2);

function openAudioCache() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(CACHE_STORE)) {
        req.result.createObjectStore(CACHE_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getCacheKey(index = state.currentIndex, voiceType = state.voiceType) {
  const ex = state.exercises[index];
  const exerciseId = ex?.id || `index-${index}`;
  return `${exerciseId}-${voiceType}`;
}

function getLegacyCacheKey(index = state.currentIndex, voiceType = state.voiceType) {
  return `${index}-${voiceType}`;
}

async function loadAudioFromCache() {
  try {
    debugLog('[cache] Opening IndexedDB...');
    const db = await openAudioCache();
    const primaryKey = getCacheKey();
    const legacyKey = getLegacyCacheKey();
    const keys = legacyKey === primaryKey ? [primaryKey] : [primaryKey, legacyKey];
    debugLog('[cache] DB opened, reading keys:', keys);
    const cached = await new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, 'readonly');
      const store = tx.objectStore(CACHE_STORE);
      let nextKey = 0;
      const readNext = () => {
        const req = store.get(keys[nextKey]);
        req.onsuccess = () => {
          if (req.result || nextKey === keys.length - 1) {
            resolve(req.result);
          } else {
            nextKey++;
            readNext();
          }
        };
        req.onerror = () => reject(req.error);
      };
      readNext();
    });
    db.close();
    debugLog('[cache] Read complete, found:', !!cached);
    if (!cached) { debugLog('[cache] No entry found for keys:', keys); return false; }
    // Discard entries written by an older meta/word-timing format.
    if (cached.metaVersion !== CACHE_META_VERSION) {
      debugLog('[cache] Meta version mismatch — cached:', cached.metaVersion, 'current:', CACHE_META_VERSION, '— ignoring');
      return false;
    }
    // Verify sentences match — content could have changed
    if (!cached.sentences || cached.sentences.length !== state.sentences.length) {
      debugLog('[cache] Sentence count mismatch — cached:', cached.sentences?.length, 'current:', state.sentences.length);
      return false;
    }
    for (let i = 0; i < state.sentences.length; i++) {
      if (cached.sentences[i] !== state.sentences[i]) {
        debugLog('[cache] Sentence', i, 'differs — stale cache');
        return false;
      }
    }
    // Restore PCM + rebuild blob URLs and metadata from cache
    let buffersRestored = 0;
    for (const preset of ['slow', 'normal', 'fast']) {
      const bufData = cached.buffers[preset];
      const meta = cached.meta[preset];
      if (bufData && meta) {
        setPlayerPCM(preset, new Float32Array(bufData), meta.sampleRate);
        state.ttsMetaBySpeed[preset] = meta;
        buffersRestored++;
      }
    }
    if (buffersRestored === 0) {
      console.warn('[cache] Entry found with matching sentences but no audio — ignoring');
      return false;
    }
    const currentPresetReady = !!(state.audioURLs[state.speedPreset] && state.ttsMetaBySpeed[state.speedPreset]);
    state.ttsMeta = state.ttsMetaBySpeed[state.speedPreset] || null;
    state.totalDurationMs = state.ttsMeta ? state.ttsMeta.durationMs : 0;
    if (!currentPresetReady) {
      debugLog('[cache] Current preset missing from cached entry — partial cache only');
    }
    return currentPresetReady;
  } catch (err) {
    console.warn('[cache] load failed:', err);
    return false;
  }
}

async function saveAudioToCache() {
  try {
    const db = await openAudioCache();
    const entry = {
      id: getCacheKey(),
      sentences: [...state.sentences],
      voiceType: state.voiceType,
      metaVersion: CACHE_META_VERSION,
      buffers: {},
      meta: {},
      cachedAt: Date.now(),
    };
    for (const preset of ['slow', 'normal', 'fast']) {
      const pcm = state.audioPCM[preset];
      if (pcm && pcm.data) {
        entry.buffers[preset] = pcm.data.buffer.slice(0);
        entry.meta[preset] = state.ttsMetaBySpeed[preset];
      }
    }
    if (Object.keys(entry.buffers).length === 0) {
      db.close();
      console.warn('[cache] save skipped: no audio for:', getCacheKey());
      return;
    }

    const tx = db.transaction(CACHE_STORE, 'readwrite');
    const store = tx.objectStore(CACHE_STORE);
    store.put(entry);
    // Prune oldest entries by cachedAt, not by IndexedDB key order.
    const allReq = store.getAll();
    allReq.onsuccess = () => {
      const entries = allReq.result || [];
      if (entries.length > CACHE_MAX_ENTRIES) {
        const toDelete = entries
          .sort((a, b) => (a.cachedAt || 0) - (b.cachedAt || 0))
          .slice(0, entries.length - CACHE_MAX_ENTRIES);
        toDelete.forEach(item => store.delete(item.id));
      }
    };
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    debugLog('[cache] Saved audio for:', getCacheKey());
  } catch (err) {
    console.warn('[cache] save failed:', err);
  }
}

let _loadAudioSeq = 0; // generation counter to cancel stale concurrent loads

async function loadExerciseAudio(ex) {
  const seq = ++_loadAudioSeq;
  debugLog(`[loadExerciseAudio #${seq}] start — checking cache`);
  const sentences = splitSentences(ex.text);
  state.sentences = sentences;

  // Try IndexedDB cache first, but don't hang if IndexedDB is slow
  let cacheHit = false;
  try {
    const CACHE_CHECK_TIMEOUT_MS = 5_000;
    const cachePromise = loadAudioFromCache();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Cache check timed out')), CACHE_CHECK_TIMEOUT_MS)
    );
    cacheHit = await Promise.race([cachePromise, timeoutPromise]);
  } catch (err) {
    console.warn(`[loadExerciseAudio #${seq}] Cache check failed, will re-synthesize:`, err.message);
    cacheHit = false;
  }

  // If another loadExerciseAudio call started after us, abort — it has fresher data
  if (_loadAudioSeq !== seq) {
    debugLog(`[loadExerciseAudio #${seq}] Aborted — superseded by #${_loadAudioSeq}`);
    return;
  }

  if (cacheHit) {
    debugLog(`[loadExerciseAudio #${seq}] Cache hit — audio ready`);
    // If provider isn't initialized yet, start it in the background so it's
    // available when the user switches to an uncached exercise.
    if (!state.provider || !state.providerReady) {
      debugLog(`[loadExerciseAudio #${seq}] Provider not ready — background init`);
      initProviderWithCorruptModelRetry().catch(err => console.warn('[loadExerciseAudio] Background provider init failed:', err.message));
    }
    hideLoadingOverlay();
    // Preload the <audio> element so the first Play tap starts instantly.
    ensurePlayerSrc(state.speedPreset);
    // Segment positions were rendered with estimates; re-render with real meta.
    renderProgressSegments();
    updateProgress();
    if (state._playRequested && state.audioURLs[state.speedPreset]) {
      state._playRequested = false;
      play();
    }
    state._playRequested = false;
    return;
  }

  // Cache miss — synthesize only the active speed preset for this exercise.
  try {
    debugLog(`[loadExerciseAudio #${seq}] Cache miss — synthesizing`, sentences.length, 'sentences for preset', state.speedPreset);
    showLoadingOverlay();
    await ensureAudioForPresets([state.speedPreset]);
    if (_loadAudioSeq !== seq) {
      debugLog(`[loadExerciseAudio #${seq}] Aborted after synthesis — superseded by #${_loadAudioSeq}`);
      return;
    }
    debugLog(`[loadExerciseAudio #${seq}] Synthesis complete`);
    updateProgress();
  } catch (err) {
    console.error(`[loadExerciseAudio #${seq}] Failed:`, err.message);
    state._initError = err.message || 'unknown error';
    state.loadingMessage = `Audio preparation failed: ${state._initError}`;
    state.loadingProgress = 0;
    showLoadingOverlay();
    document.querySelector('.loading-bar-fill')?.classList.remove('indeterminate');
    updateLoadingOverlay();
  } finally {
    if (_loadAudioSeq !== seq) return;
    ensurePlayerSrc(state.speedPreset);
    const hasAudio = state.audioURLs[state.speedPreset];
    if (hasAudio) {
      hideLoadingOverlay();
    } else if (state._initError) {
      showLoadingOverlay();
    } else {
      hideLoadingOverlay();
    }
    debugLog(`audioLoadDone hasAudio=${!!hasAudio} playRequested=${state._playRequested} err=${state._initError || 'none'}`);
    if (state._playRequested && hasAudio) {
      state._playRequested = false;
      play();
    }
    state._playRequested = false;
  }
}


function getSentenceAtTime(ms) {
  // Use meta boundaries if available, otherwise estimate
  if (state.ttsMeta && state.ttsMeta.sentences) {
    const arr = state.ttsMeta.sentences;
    for (let i = 0; i < arr.length; i++) {
      if (ms >= arr[i].startMs && ms < arr[i].endMs) return i;
    }
    // No exact containment (float gaps / imperfect timings): pick the nearest
    // sentence by start time instead of blindly returning the last one.
    if (ms <= arr[0].startMs) return 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (ms >= arr[i].startMs) return i;
    }
    return arr.length - 1;
  }
  // Fallback: estimate
  let cumMs = 0;
  for (let i = 0; i < state.sentences.length; i++) {
    cumMs += estimateDuration(state.sentences[i]);
    if (cumMs > ms) return i;
  }
  return state.sentences.length - 1;
}

function getSentenceMsBoundary(idx) {
  // Return {startMs, endMs, words} for the given sentence index
  if (state.ttsMeta && state.ttsMeta.sentences && state.ttsMeta.sentences[idx]) {
    return state.ttsMeta.sentences[idx];
  }
  // Fallback (pre-audio): estimate, but still supply tiling word timings so the
  // highlight and progress bar use the same code path as when audio is ready.
  const sent = state.sentences[idx] || '';
  let startMs = 0;
  for (let i = 0; i < idx; i++) startMs += estimateDuration(state.sentences[i]);
  const endMs = startMs + estimateDuration(sent);
  return {
    startMs,
    endMs,
    wordCount: sent.split(/\s+/).filter(Boolean).length,
    words: buildFallbackWordTimings(sent, startMs, endMs - startMs),
  };
}

function getLiveTransportPosition() {
  const ms = currentAudioTime() * 1000;
  const idx = getSentenceAtTime(ms);
  return { ms, idx, bound: getSentenceMsBoundary(idx) };
}

async function waitForPlayerMetadata(token) {
  if (_player.readyState >= 1) return token === _playGen;
  debugLog('[doPlay] readyState=0 — awaiting loadedmetadata');
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      _player.removeEventListener('loadedmetadata', onLoadedMetadata);
      clearTimeout(timer);
      resolve();
    };
    const onLoadedMetadata = () => finish();
    const timer = setTimeout(finish, 2000);
    _player.addEventListener('loadedmetadata', onLoadedMetadata);
  });
  if (token !== _playGen) return false;
  debugLog('[doPlay] metadata ready, readyState now:', _player.readyState);
  return true;
}

async function seekPlayerTo(targetSec, token) {
  if (!(await waitForPlayerMetadata(token))) return false;

  const duration = Number.isFinite(_player.duration) && _player.duration > 0
    ? _player.duration
    : targetSec;
  const clamped = Math.max(0, Math.min(targetSec, Math.max(0, duration - 0.001)));
  const delta = Math.abs((_player.currentTime || 0) - clamped);

  if (delta <= 0.002 && !_player.seeking) {
    return token === _playGen;
  }

  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      _player.removeEventListener('seeked', onSeeked);
      clearTimeout(timer);
      resolve();
    };
    const onSeeked = () => finish();
    const timer = setTimeout(finish, 1200);
    _player.addEventListener('seeked', onSeeked);
    try {
      _player.currentTime = clamped;
    } catch (_) {
      finish();
    }
  });

  // Some Safari builds dispatch `seeked` late or not at all during rapid,
  // consecutive seeks on the same element. Give the media element a brief
  // extra settle window and only continue once `seeking` is actually false.
  const settleDeadline = performance.now() + 300;
  while (_player.seeking && performance.now() < settleDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 16));
    if (token !== _playGen) return false;
  }

  return token === _playGen;
}

// ─── Playback Engine (HTMLAudioElement) ──────────────────────────

async function doPlay(offsetSec, token) {
  debugLog('[doPlay] start, offsetSec:', offsetSec, 'speedPreset:', state.speedPreset, 'urls:', Object.keys(state.audioURLs));
  if (!ensurePlayerSrc(state.speedPreset)) {
    console.error('[doPlay] No audio URL for speed:', state.speedPreset, 'available:', Object.keys(state.audioURLs));
    state.playing = false;
    return false;
  }

  const canSeekLivePlayer = state.srcNode === _player
    && _player.dataset.preset === state.speedPreset;
  if (!canSeekLivePlayer) stopSrcNode();
  if (!(await seekPlayerTo(Math.max(0, offsetSec), token))) {
    debugLog('[doPlay] cancelled during seek');
    return false;
  }

  _player.muted = false;
  _player.playbackRate = 1;
  state.srcNode = _player;
  _playerToken = token;
  state.srcStartOffset = offsetSec;
  state.playing = true;
  state.paused = false;
  try {
    await _player.play();
  } catch (err) {
    console.error('[doPlay] play() rejected:', err && err.message);
    state.playing = false;
    showAudioBlockedBanner();
    return false;
  }
  if (_playGen !== token) {
    if (_playerToken === token) stopSrcNode();
    return false;
  }
  debugLog('[doPlay] playing from', offsetSec.toFixed(2) + 's', 'duration', (_player.duration || 0).toFixed(1) + 's');
  hideAudioBlockedBanner();
  setPlayIcon(true);
  $('#btnPlay').classList.remove('primary');
  if (state.dictMode === 'programmed') lockTextarea(true);
  return true;
}

async function play() {
  debugLog('[play] ENTERED. providerReady:', state.providerReady, 'playing:', state.playing, 'paused:', state.paused, 'dictMode:', state.dictMode, 'urls:', Object.keys(state.audioURLs), 'sentences:', state.sentences.length);
  if (state.scrubbing) stopScrub();

  // If in a writing gap, skip it and start the next lap immediately
  if (state.lapGapTimer) {
    cancelLapGap();
    const curBound = getSentenceMsBoundary(state.sentenceIndex);
    advanceFromLapGap(curBound);
    return;
  }

  // Wait for audio to be ready
  if (!state.audioURLs[state.speedPreset]) {
    debugLog('[play] Audio not ready yet');
    const overlay = document.querySelector('.loading-overlay');
    const loading = overlay && overlay.style.display === 'flex';
    debugLog(`play: no audio, loading=${loading}`);
    state._playRequested = true;
    if (!loading) {
      // Nothing is loading — start synthesis now
      state.loadingMessage = 'Loading…';
      showLoadingOverlay();
      document.querySelector('.loading-bar-fill')?.classList.add('indeterminate');
      const ex = state.exercises[state.currentIndex];
      if (ex) loadExerciseAudio(ex);
    }
    return;
  }
  if (state.playing && !state.paused) { debugLog('[play] already playing'); return; }

  if (state.paused) {
    // Resume from pause
    debugLog('[play] resuming from pause');
    const token = ++_playGen;
    if (await doPlay(currentAudioTime(), token)) {
      startPlayheadTracker();
    }
    return;
  }

  // Fresh play
  debugLog('[play] fresh play, offsetMs:', state.elapsedMs);
  state.playing = true;
  state.paused = false;

  if (state.dictMode === 'programmed') {
    state.currentLap = 1;
    state.programmedPhase = 'sentence';
    lockTextarea(true);
  }

  const offsetSec = state.elapsedMs / 1000;
  const token = ++_playGen;
  if (await doPlay(offsetSec, token)) {
    startPlayheadTracker();
  }
}

let _rafId = null;

function startPlayheadTracker() {
  stopPlayheadTracker();

  function tick() {
    if (!state.playing || state.paused) {
      stopPlayheadTracker();
      return;
    }

    const t = currentAudioTime();
    state.elapsedMs = t * 1000;
    const newIdx = getSentenceAtTime(state.elapsedMs);

    // Handle programmed mode — detect sentence boundary crossing
    if (state.dictMode === 'programmed' && state.programmedPhase === 'sentence') {
      const curBound = getSentenceMsBoundary(state.sentenceIndex);
      if (state.elapsedMs >= curBound.endMs - 10) {
        state.elapsedMs = curBound.endMs;
        stopSrcNode();
        stopPlayheadTracker();
        updateProgress();
        startLapGap(curBound);
        return;
      }
    }

    // Final full reading phase — play through, stop at end
    if (state.dictMode === 'programmed' && state.programmedPhase === 'final') {
      if (state.elapsedMs >= state.totalDurationMs - 50) {
        stop();
        return;
      }
    }

    // Repeat mode — loop back to sentence start
    if (state.repeatMode) {
      const repeatIdx = getRepeatTargetIndex();
      const curBound = getSentenceMsBoundary(repeatIdx);
      state.sentenceIndex = repeatIdx;
      if (state.elapsedMs >= curBound.endMs - 10) {
        restartCurrentSentenceForRepeat();
        return;
      }
    }

    if (!state.repeatMode && newIdx !== state.sentenceIndex) {
      state.sentenceIndex = newIdx;
      highlightSentence(newIdx);
    }
    updateProgress();

    // Stop looping if srcNode was cleared externally (onended already cleaned up)
    if (!state.srcNode && !state.playing) return;

    _rafId = requestAnimationFrame(tick);
  }

  _rafId = requestAnimationFrame(tick);
}

function stopPlayheadTracker() {
  if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
}

// ─── Lap Gap (writing pause between sentence replays in programmed mode) ──

function startLapGap(curBound) {
  cancelLapGap();

  const sentDuration = curBound.endMs - curBound.startMs;
  // Gap proportional to sentence length: 1.5× the audio duration, clamped 2–12s
  const gapMs = Math.max(2000, Math.min(12000, sentDuration * 1.5));

  state.playing = false;
  state.paused = false;
  state.inLapGap = true;

  // Unlock the textarea so the user can type
  lockTextarea(false);

  // Show green bounce + countdown on the laps-left indicator
  const lapsEl = $('#lapsLeft');
  if (lapsEl) {
    lapsEl.classList.add('gap');
    lapsEl.style.display = 'flex';
  }

  startGapCountdown(gapMs);

  state.lapGapTimer = setTimeout(() => {
    state.lapGapTimer = null;
    state.inLapGap = false;
    stopGapCountdown();
    resetLapsStyle();
    advanceFromLapGap(curBound);
  }, gapMs);
}

function startGapCountdown(totalMs) {
  stopGapCountdown();
  const el = $('#lapsLeft');
  if (!el) return;

  const totalSec = Math.ceil(totalMs / 1000);
  let remaining = totalSec;
  el.textContent = remaining;
  tickBounce(el);

  state.gapCountdownInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      stopGapCountdown();
    } else {
      el.textContent = remaining;
      tickBounce(el);
    }
  }, 1000);
}

function tickBounce(el) {
  el.animate([
    { transform: 'translateX(-50%) scale(1)' },
    { transform: 'translateX(-50%) scale(1.28)', offset: 0.25 },
    { transform: 'translateX(-50%) scale(0.88)', offset: 0.5 },
    { transform: 'translateX(-50%) scale(1.06)', offset: 0.7 },
    { transform: 'translateX(-50%) scale(1)' },
  ], { duration: 350, easing: 'ease-in-out' });
}

function stopGapCountdown() {
  if (state.gapCountdownInterval) {
    clearInterval(state.gapCountdownInterval);
    state.gapCountdownInterval = null;
  }
}

function cancelLapGap() {
  if (state.lapGapTimer) {
    clearTimeout(state.lapGapTimer);
    state.lapGapTimer = null;
  }
  state.inLapGap = false;
  stopGapCountdown();
  resetLapsStyle();
}

function resetLapsStyle() {
  const lapsEl = $('#lapsLeft');
  if (lapsEl) {
    lapsEl.classList.remove('gap');
  }
}

function advanceFromLapGap(curBound) {
  // Set playing immediately so the Stop button works during the brief async
  // window between seekToTime starting and doPlay actually creating the source node.
  state.playing = true;
  state.paused = false;
  state.inLapGap = false;

  if (state.currentLap < state.programmedLaps) {
    state.currentLap++;
    seekToTime(curBound.startMs, true);
  } else {
    const nextIdx = state.sentenceIndex + 1;
    if (nextIdx < state.sentences.length) {
      state.sentenceIndex = nextIdx;
      state.currentLap = 1;
      const nextBound = getSentenceMsBoundary(nextIdx);
      seekToTime(nextBound.startMs, true);
    } else {
      state.programmedPhase = 'final';
      state.currentLap = 0;
      seekToTime(0, true);
    }
  }
}

// ─── Playback Control (HTMLAudioElement) ──────────────────────────
let _playGen = 0;
let _scrubResumeTimer = null;

function clearScrubResumeTimer() {
  if (_scrubResumeTimer) {
    clearTimeout(_scrubResumeTimer);
    _scrubResumeTimer = null;
  }
}

function pause() {
  if (!state.playing || state.paused) return;
  clearScrubResumeTimer();
  _playGen++;
  // Capture position BEFORE nulling srcNode — currentAudioTime() needs it
  state.elapsedMs = currentAudioTime() * 1000;
  stopSrcNode();
  state.paused = true;
  stopPlayheadTracker();
  updateProgress();
  setPlayIcon(false);
  $('#btnPlay').classList.add('primary');
}

function stop() {
  clearScrubResumeTimer();
  _playGen++;
  state._playRequested = false;
  cancelLapGap();
  stopSrcNode();
  stopPlayheadTracker();
  state.playing = false;
  state.paused = false;
  state.sentenceIndex = getSentenceAtTime(state.elapsedMs);

  // Auto-switch to free mode when the programmed test completes naturally
  if (state.dictMode === 'programmed' && state.programmedPhase === 'final') {
    state.dictMode = 'free';
    $('#dictModeSelect').value = 'free';
    $('#programmedLaps').style.display = 'none';
    updateUI();
  }

  lockTextarea(false);
  highlightSentence(state.sentenceIndex);
  updateProgress();
  setPlayIcon(false);
  $('#btnPlay').classList.add('primary');
}

function lockTextarea(locked) {
  const ta = $('#dictationInput');
  if (ta) ta.readOnly = locked;
}

function renderProgressSnapped(render) {
  document.body.classList.add('progress-snapping');
  render();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.classList.remove('progress-snapping');
    });
  });
}

function getSentenceJumpPlayMs(bound) {
  return Math.max(bound.startMs, Math.min(bound.endMs - 1, bound.startMs + 24));
}

async function seekToTime(ms, keepPlaying, {
  snapProgress = false,
  playFromMs = ms,
  targetSentenceIndex = null,
} = {}) {
  clearScrubResumeTimer();
  state.elapsedMs = Math.max(0, Math.min(state.totalDurationMs, ms));
  const resolvedSentenceIndex = Number.isInteger(targetSentenceIndex)
    ? Math.max(0, Math.min(state.sentences.length - 1, targetSentenceIndex))
    : getSentenceAtTime(state.elapsedMs);
  state.sentenceIndex = resolvedSentenceIndex;
  if (state.repeatMode && state.dictMode !== 'programmed') setRepeatTargetIndex(state.sentenceIndex);

  const render = () => {
    highlightSentence(state.sentenceIndex);
    updateProgress();
  };

  if (snapProgress) renderProgressSnapped(render);

  if (keepPlaying) {
    const token = ++_playGen;
    stopPlayheadTracker();
    const offsetSec = Math.max(0, Math.min(state.totalDurationMs, playFromMs)) / 1000;
    if (await doPlay(offsetSec, token)) {
      startPlayheadTracker();
    } else if (token === _playGen && state.srcNode !== _player) {
      state.playing = false;
      state.paused = false;
      setPlayIcon(false);
      $('#btnPlay').classList.add('primary');
    }
  } else {
    _playGen++;
    stopSrcNode();
    stopPlayheadTracker();
    state.playing = false;
    state.paused = false;
    setPlayIcon(false);
    $('#btnPlay').classList.add('primary');
  }

  if (snapProgress) renderProgressSnapped(render);
  else render();
}

// ─── Scrubbing (cassette-style FFW / REW) using HTMLAudioElement ─────────────
// FFW: fast-forward by setting playbackRate to SCRUB_RATE on the live element.
// REW: use one reversed full-track blob and mirrored timing, because portable
// negative-rate media playback is not available on HTMLAudioElement.

const SCRUB_RATE = 4;
let _scrubTimer = null;
let _scrubFfwStart = 0;     // performance.now() when FFW started
let _scrubFfwOffset = 0;    // element currentTime when FFW started
let _scrubRewStart = 0;     // performance.now() when REW started
let _scrubRewOffset = 0;    // original-track currentTime when REW started

function updateScrubButtons() {
  $('#btnRew').classList.toggle('primary', state.scrubbing && state.scrubDir < 0);
  $('#btnFwd').classList.toggle('primary', state.scrubbing && state.scrubDir > 0);
}

function startScrub(direction) {
  if (state.sentences.length === 0) return;
  state.elapsedMs = currentAudioTime() * 1000;
  state.sentenceIndex = getSentenceAtTime(state.elapsedMs);
  clearScrubResumeTimer();
  _playGen++;
  state.wasPlayingBeforeScrub = state.playing && !state.paused;
  stopSrcNode();
  stopPlayheadTracker();
  state.playing = false;
  state.paused = false;
  state.scrubbing = true;
  state.scrubDir = direction;

  setPlayIcon(false);
  $('#btnPlay').classList.add('primary');
  updateScrubButtons();

  if (direction > 0) startFFW(); else startREW();
}

function startFFW() {
  if (state.wasPlayingBeforeScrub && ensurePlayerSrc(state.speedPreset)) {
    try {
      _player.currentTime = state.elapsedMs / 1000;
      _player.playbackRate = SCRUB_RATE;
      _player.play().catch(() => {});
    } catch (_) { /* ignore */ }
  }
  _scrubFfwStart = performance.now();
  _scrubFfwOffset = state.elapsedMs / 1000;

  _scrubTimer = setInterval(() => {
    if (!state.scrubbing || state.scrubDir <= 0) { clearInterval(_scrubTimer); _scrubTimer = null; return; }
    const effectiveSec = _scrubFfwOffset + (performance.now() - _scrubFfwStart) / 1000 * SCRUB_RATE;
    state.elapsedMs = Math.min(state.totalDurationMs, Math.max(0, effectiveSec * 1000));
    state.sentenceIndex = getSentenceAtTime(state.elapsedMs);
    highlightSentence(state.sentenceIndex);
    updateProgress();
  }, 80);
}

function startREW() {
  if (state.wasPlayingBeforeScrub && ensureReversedPlayerSrc(state.speedPreset)) {
    const pcm = state.audioPCM[state.speedPreset];
    const durationSec = (pcm.length || pcm.data.length) / pcm.sampleRate;
    const startSec = Math.max(0, Math.min(Math.max(0, durationSec - 0.001), durationSec - (state.elapsedMs / 1000)));

    try {
      _player.currentTime = startSec;
      _player.playbackRate = SCRUB_RATE;
      _player.play().catch(() => {});
    } catch (_) { /* ignore */ }
  }

  _scrubRewStart = performance.now();
  _scrubRewOffset = state.elapsedMs / 1000;

  _scrubTimer = setInterval(() => {
    if (!state.scrubbing || state.scrubDir >= 0) { clearInterval(_scrubTimer); _scrubTimer = null; return; }
    const effectiveSec = _scrubRewOffset - (performance.now() - _scrubRewStart) / 1000 * SCRUB_RATE;
    state.elapsedMs = Math.max(0, effectiveSec * 1000);

    state.sentenceIndex = getSentenceAtTime(state.elapsedMs);
    highlightSentence(state.sentenceIndex);
    updateProgress();
  }, 80);
}

function stopScrub() {
  if (!state.scrubbing) return;

  let finalMs = state.elapsedMs;
  if (state.scrubDir > 0) {
    const effectiveSec = _scrubFfwOffset + (performance.now() - _scrubFfwStart) / 1000 * SCRUB_RATE;
    finalMs = Math.min(state.totalDurationMs, Math.max(0, effectiveSec * 1000));
  } else if (state.scrubDir < 0) {
    const effectiveSec = _scrubRewOffset - (performance.now() - _scrubRewStart) / 1000 * SCRUB_RATE;
    finalMs = Math.max(0, effectiveSec * 1000);
  }
  try { _player.pause(); _player.playbackRate = 1; } catch (_) { /* ignore */ }
  if ((_player.dataset.preset || '').startsWith('__rew__:')) {
    ensurePlayerSrc(state.speedPreset);
  }

  state.scrubbing = false;
  state.scrubDir = 0;
  if (_scrubTimer) { clearInterval(_scrubTimer); _scrubTimer = null; }
  updateScrubButtons();

  state.elapsedMs = finalMs;
  state.sentenceIndex = getSentenceAtTime(state.elapsedMs);
  highlightSentence(state.sentenceIndex);
  updateProgress();
  setPlayIcon(false);
  $('#btnPlay').classList.add('primary');

  if (state.wasPlayingBeforeScrub) {
    const resumeMs = state.elapsedMs;
    clearScrubResumeTimer();
    _scrubResumeTimer = setTimeout(() => {
      _scrubResumeTimer = null;
      seekToTime(resumeMs, true);
    }, 80);
  }
  state.wasPlayingBeforeScrub = false;
}

// ─── Scoring Engine (Levenshtein / Wagner-Fischer) ───────────────

function levenshteinWordDiff(expected, actual) {
  const expWords = expected.trim().split(/\s+/).filter(Boolean);
  const actWords = actual.trim().split(/\s+/).filter(Boolean);
  const m = expWords.length, n = actWords.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = expWords[i - 1].toLowerCase() === actWords[j - 1].toLowerCase() ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  const diff = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const subCost = expWords[i - 1].toLowerCase() === actWords[j - 1].toLowerCase() ? 0 : 1;
      if (dp[i][j] === dp[i - 1][j - 1] + subCost) {
        diff.unshift({ expected: expWords[i - 1], actual: actWords[j - 1], type: subCost === 0 ? 'correct' : 'substitution' });
        i--; j--; continue;
      }
    }
    if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      diff.unshift({ expected: expWords[i - 1], actual: null, type: 'missing' });
      i--;
    } else if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) {
      diff.unshift({ expected: null, actual: actWords[j - 1], type: 'extra' });
      j--;
    }
  }
  const correctCount = diff.filter(d => d.type === 'correct').length;
  const accuracy = m > 0 ? Math.round((correctCount / m) * 100) : 0;
  return { diff, accuracy, correctCount, totalExpected: m };
}

function scoreDictation() {
  const input = $('#dictationInput').value;
  if (!input.trim()) { alert('Type what you heard before checking.'); return; }

  const expected = state.exercises[state.currentIndex].text;
  const { diff, accuracy, correctCount, totalExpected } = levenshteinWordDiff(expected, input);

  const circle = $('#scoreCircle');
  circle.textContent = accuracy + '%';
  circle.className = 'score-circle';
  if (accuracy >= 95) circle.classList.add('score-excellent');
  else if (accuracy >= 80) circle.classList.add('score-good');
  else if (accuracy >= 60) circle.classList.add('score-fair');
  else circle.classList.add('score-poor');

  $('#scoreLabel').textContent = accuracy >= 80 ? 'Great job!' : accuracy >= 60 ? 'Keep practising' : 'Needs more work';
  $('#scoreDetail').textContent = `${correctCount} / ${totalExpected} words correct`;

  $('#diffOutput').innerHTML = diff.map(d => {
    if (d.type === 'correct') return `<span class="diff-word correct">${escapeHtml(d.expected)}</span>`;
    if (d.type === 'missing') return `<span class="diff-word missing">${escapeHtml(d.expected)}</span>`;
    if (d.type === 'extra') return `<span class="diff-word extra">${escapeHtml(d.actual)}</span>`;
    if (d.type === 'substitution') return `<span class="diff-word missing">${escapeHtml(d.expected)}</span> → <span class="diff-word extra">${escapeHtml(d.actual)}</span>`;
    return '';
  }).join(' ');

  $('#scoreDisplay').classList.add('visible');
}

function showAnswer() {
  $('#dictationInput').value = state.exercises[state.currentIndex].text;
}

function clearDictation() {
  $('#dictationInput').value = '';
  $('#scoreDisplay').classList.remove('visible');
}

function resetDictation() {
  $('#dictationInput').value = '';
  $('#scoreDisplay').classList.remove('visible');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Event Wiring ────────────────────────────────────────────────

debugLog('[init] Wiring events. btnPlay:', !!$('#btnPlay'));

// Clone btnPlay to strip any stale listeners from HMR hot-reloads
{
  const oldBtn = $('#btnPlay');
  const newBtn = oldBtn.cloneNode(true);
  oldBtn.parentNode.replaceChild(newBtn, oldBtn);
}

$('#btnPlay').addEventListener('click', () => {
  debugLog('[click] btnPlay fired. playing:', state.playing, 'paused:', state.paused, 'dictMode:', state.dictMode, 'inLapGap:', state.inLapGap);
  if (state.dictMode === 'programmed') {
    if (state.playing || state.paused || state.inLapGap) {
      // Stop the test mid-way and rewind to first sentence
      stop();
      state.elapsedMs = 0;
      state.sentenceIndex = 0;
      state.currentLap = 0;
      state.programmedPhase = 'sentence';
      highlightSentence(0);
      updateProgress();
    } else {
      // Start from the beginning
      state.currentLap = 0;
      state.programmedPhase = 'sentence';
      state.sentenceIndex = 0;
      state.elapsedMs = 0;
      updateProgress();
      play();
    }
  } else {
    if (state.playing && !state.paused) pause();
    else play();
  }
});

// Prev / Next sentence — single-click jump, preserves play/pause state
$('#btnPrev').addEventListener('click', () => {
  const wasPlaying = state.playing && !state.paused;
  const { ms, idx, bound } = getLiveTransportPosition();
  // If in the middle of current sentence, go to its beginning first
  if (ms > bound.startMs + 500) {
    seekToTime(bound.startMs, wasPlaying, {
      snapProgress: true,
      playFromMs: getSentenceJumpPlayMs(bound),
      targetSentenceIndex: idx,
    });
  } else {
    // Already at beginning, go to previous sentence
    const prevIdx = Math.max(0, idx - 1);
    if (prevIdx !== idx) {
      const prevBound = getSentenceMsBoundary(prevIdx);
      seekToTime(prevBound.startMs, wasPlaying, {
        snapProgress: true,
        playFromMs: getSentenceJumpPlayMs(prevBound),
        targetSentenceIndex: prevIdx,
      });
    }
  }
});
$('#btnNext').addEventListener('click', () => {
  const { idx } = getLiveTransportPosition();
  const nextIdx = Math.min(state.sentences.length - 1, idx + 1);
  if (nextIdx !== idx) {
    const wasPlaying = state.playing && !state.paused;
    const bound = getSentenceMsBoundary(nextIdx);
    seekToTime(bound.startMs, wasPlaying, {
      snapProgress: true,
      playFromMs: getSentenceJumpPlayMs(bound),
      targetSentenceIndex: nextIdx,
    });
  }
});

// Rewind / Forward — long-press only (cassette scrubbing), single click ignored
const SCRUB_PRESS_THRESHOLD = 200; // ms before scrubbing activates

function setupLongPress(btnId, direction) {
  let pressTimer = null;
  let didScrub = false;

  ['mousedown', 'touchstart'].forEach(evt => {
    $(btnId).addEventListener(evt, (e) => {
      e.preventDefault();
      didScrub = false;
      pressTimer = setTimeout(() => {
        didScrub = true;
        startScrub(direction);
      }, SCRUB_PRESS_THRESHOLD);
    });
  });

  ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(evt => {
    $(btnId).addEventListener(evt, (e) => {
      e.preventDefault();
      clearTimeout(pressTimer);
      pressTimer = null;
      if (didScrub) stopScrub();
    });
  });
}

setupLongPress('#btnRew', -1);
setupLongPress('#btnFwd', 1);

$('#speedSelect').addEventListener('change', () => {
  const preset = $('#speedSelect').value;
  if (preset !== state.speedPreset) {
    setSpeed(preset);
  }
});

$('#btnRepeat').addEventListener('click', () => {
  if (state.dictMode === 'programmed') return;
  state.repeatMode = !state.repeatMode;
  if (state.repeatMode) syncRepeatTargetToCurrentPosition();
  else state.repeatSentenceIndex = null;
  updateABButtons();
  highlightSentence(state.sentenceIndex);
  updateProgress();
});

// Transcript blur toggle
$('#btnToggleTranscript').addEventListener('click', () => {
  const panel = $('#top-panel');
  const hidden = panel.classList.toggle('transcript-blurred');
  state.transcriptVisible = !hidden;
  $('#btnToggleTranscript').innerHTML = hidden ? ICONS.eyeOff : ICONS.eye;
  $('#btnToggleTranscript').title = hidden ? 'Show Transcript' : 'Hide Transcript';
});

$('#btnCheck').addEventListener('click', scoreDictation);
$('#btnClearInput').addEventListener('click', clearDictation);

let _inputPanelAnimSeq = 0;

function getInputPanelMetrics() {
  const main = $('#main-area');
  const top = $('#top-panel');
  const bottom = $('#bottom-panel');
  const bar = $('#controls-bar');
  const barH = bar.getBoundingClientRect().height;
  return {
    main,
    topH: top.getBoundingClientRect().height,
    bottomH: bottom.getBoundingClientRect().height,
    barH,
    totalH: Math.max(0, main.getBoundingClientRect().height - barH),
  };
}

function setMainSplitRows(topPx, barH, bottomPx) {
  $('#main-area').style.gridTemplateRows = `${Math.max(0, topPx)}px ${barH}px ${Math.max(0, bottomPx)}px`;
}

function getVisibleInputSplit(metrics) {
  const totalH = metrics.totalH;
  const fallbackBottom = Math.round(totalH * 0.38);
  const requestedBottom = _inputPanelPreferredBottomH > 0 ? _inputPanelPreferredBottomH : fallbackBottom;
  const minBottom = Math.min(140, Math.max(96, totalH * 0.28));
  const maxBottom = Math.max(minBottom, totalH - 96);
  const bottomH = Math.max(minBottom, Math.min(maxBottom, requestedBottom));
  return {
    bottomH,
    topH: Math.max(80, totalH - bottomH),
  };
}

function setInputPanelVisible(visible, { instant = false } = {}) {
  state.inputVisible = visible;
  const panel = $('#bottom-panel');
  const btn = $('#btnToggleInput');
  const seq = ++_inputPanelAnimSeq;
  const metrics = getInputPanelMetrics();

  btn.innerHTML = visible ? `${ICONS.edit} Hide Input` : `${ICONS.edit} Type Here`;
  btn.classList.remove('primary');

  if (visible) {
    const target = getVisibleInputSplit(metrics);

    if (instant) {
      panel.classList.remove('hidden');
      setMainSplitRows(target.topH, metrics.barH, target.bottomH);
      return;
    }

    setMainSplitRows(metrics.topH, metrics.barH, metrics.bottomH);
    requestAnimationFrame(() => {
      if (seq !== _inputPanelAnimSeq || !state.inputVisible) return;
      panel.classList.remove('hidden');
      setMainSplitRows(target.topH, metrics.barH, target.bottomH);
    });
  } else {
    if (metrics.bottomH > 0) _inputPanelPreferredBottomH = metrics.bottomH;
    setMainSplitRows(metrics.topH, metrics.barH, metrics.bottomH);
    panel.classList.add('hidden');

    if (instant) {
      setMainSplitRows(metrics.totalH, metrics.barH, 0);
      return;
    }

    requestAnimationFrame(() => {
      if (seq !== _inputPanelAnimSeq || state.inputVisible) return;
      setMainSplitRows(metrics.totalH, metrics.barH, 0);
    });
  }
}

$('#btnToggleInput').addEventListener('click', () => {
  setInputPanelVisible(!state.inputVisible);
});

$('#voiceSelect').addEventListener('change', () => {
  state.voiceType = $('#voiceSelect').value;
  switchVoice(state.voiceType);
});

$('#dictModeSelect').addEventListener('change', () => {
  state.dictMode = $('#dictModeSelect').value;
  state.currentLap = 0;
  state.programmedPhase = 'sentence';
  $('#programmedLaps').style.display = state.dictMode === 'programmed' ? '' : 'none';
  updateUI();
});

$('#programmedLaps').addEventListener('change', () => {
  state.programmedLaps = parseInt($('#programmedLaps').value);
  state.currentLap = 0;
  updateProgress();
});

// Unified progress bar interaction — click OR drag, one handler for everything.
// Stops current playback on seek and optionally restarts from new position on release.
(function initProgressBar() {
  const wrap = $('#progressBar');
  const thumb = $('#progressThumb');
  let dragging = false;
  let wasPlaying = false;

  function pctFromClientX(clientX) {
    const rect = wrap.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  }

  function applyPct(pct) {
    const ms = (pct / 100) * state.totalDurationMs;
    state.elapsedMs = Math.max(0, Math.min(state.totalDurationMs, ms));
    state.sentenceIndex = getSentenceAtTime(state.elapsedMs);
    if (state.repeatMode && state.dictMode !== 'programmed') {
      setRepeatTargetIndex(state.sentenceIndex);
    }
    // suppress scroll during drag — panel stays put so the thumb and word
    // highlight are always visually in the same frame
    highlightSentence(state.sentenceIndex, { scroll: false });
    updateProgress();
  }

  function beginSeek(e) {
    if (state.dictMode === 'programmed') return;
    dragging = true;
    wasPlaying = state.playing && !state.paused;
    stopSrcNode();
    stopPlayheadTracker();
    state.playing = false;
    state.paused = false;
    document.body.classList.add('dragging-seek');
    thumb.style.transition = 'none';
    applyPct(pctFromClientX(e.clientX));
    e.preventDefault();
  }

  function moveSeek(clientX) {
    if (!dragging) return;
    applyPct(pctFromClientX(clientX));
  }

  function endSeek(clientX) {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('dragging-seek');
    thumb.style.transition = 'left 0.15s linear';
    applyPct(pctFromClientX(clientX));
    // scroll the panel to show the newly-seeked sentence
    const sentEls = document.querySelectorAll('.sentence');
    if (sentEls[state.sentenceIndex]) {
      sentEls[state.sentenceIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (wasPlaying) {
      setTimeout(() => play(), 80);
    }
  }

  wrap.addEventListener('mousedown', (e) => { beginSeek(e); });
  document.addEventListener('mousemove', (e) => { moveSeek(e.clientX); });
  document.addEventListener('mouseup', (e) => { endSeek(e.clientX); });

  wrap.addEventListener('touchstart', (e) => {
    if (state.dictMode === 'programmed') return;
    dragging = true;
    wasPlaying = state.playing && !state.paused;
    stopSrcNode();
    stopPlayheadTracker();
    state.playing = false;
    state.paused = false;
    document.body.classList.add('dragging-seek');
    thumb.style.transition = 'none';
    applyPct(pctFromClientX(e.touches[0].clientX));
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    applyPct(pctFromClientX(e.touches[0].clientX));
  }, { passive: false });

  document.addEventListener('touchend', (e) => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('dragging-seek');
    thumb.style.transition = 'left 0.15s linear';
    applyPct(pctFromClientX(e.changedTouches[0].clientX));
    const sentEls = document.querySelectorAll('.sentence');
    if (sentEls[state.sentenceIndex]) {
      sentEls[state.sentenceIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (wasPlaying) {
      setTimeout(() => play(), 80);
    }
  });
})();

// Keyboard shortcuts (Shift-held global shortcuts)
let keyScrubActive = false;

document.addEventListener('keydown', (e) => {
  // When input panel is visible, require Shift to avoid interfering with typing.
  // When hidden, no Shift needed — shortcuts work directly.
  if (state.inputVisible) {
    if (!e.shiftKey) return;
    if (e.target.tagName === 'TEXTAREA') return;
  } else {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.isContentEditable) return;
  }

  const key = e.key.toLowerCase();
  if (key === 's') {
    e.preventDefault();
    if (state.dictMode === 'programmed') {
      // In test mode, 's' always stops (no pause)
      if (state.playing || state.paused || state.inLapGap) {
        stop();
        state.elapsedMs = 0;
        state.sentenceIndex = 0;
        state.currentLap = 0;
        state.programmedPhase = 'sentence';
        highlightSentence(0);
        updateProgress();
      } else {
        state.currentLap = 0;
        state.programmedPhase = 'sentence';
        state.sentenceIndex = 0;
        state.elapsedMs = 0;
        updateProgress();
        play();
      }
    } else {
      if (state.playing && !state.paused) pause();
      else play();
    }
  } else if (key === 'a') {
    e.preventDefault();
    if (state.dictMode === 'programmed') return;
    // Cassette rewind — start scrubbing backward
    if (!state.scrubbing) {
      // Jump back one before starting scrub so we hear the prior sentence
      const { idx } = getLiveTransportPosition();
      const prevIdx = Math.max(0, idx - 1);
      if (prevIdx !== idx) {
        const prevBound = getSentenceMsBoundary(prevIdx);
        state.elapsedMs = prevBound.startMs;
        state.sentenceIndex = prevIdx;
      }
      keyScrubActive = true;
      startScrub(-1);
    }
  } else if (key === 'd') {
    e.preventDefault();
    if (state.dictMode === 'programmed') return;
    // Cassette fast-forward — start scrubbing forward
    if (!state.scrubbing) {
      keyScrubActive = true;
      startScrub(1);
    }
  } else if (key === 'q') {
    e.preventDefault();
    if (state.dictMode === 'programmed') return;
    const wasPlaying = state.playing && !state.paused;
    const { ms, idx, bound } = getLiveTransportPosition();
    if (ms > bound.startMs + 500) {
      seekToTime(bound.startMs, wasPlaying, { targetSentenceIndex: idx });
    } else {
      const prevIdx = Math.max(0, idx - 1);
      if (prevIdx !== idx) {
        const prevBound = getSentenceMsBoundary(prevIdx);
        seekToTime(prevBound.startMs, wasPlaying, { targetSentenceIndex: prevIdx });
      }
    }
  } else if (key === 'e') {
    e.preventDefault();
    if (state.dictMode === 'programmed') return;
    const { idx } = getLiveTransportPosition();
    const nextIdx = Math.min(state.sentences.length - 1, idx + 1);
    if (nextIdx !== idx) {
      const wasPlaying = state.playing && !state.paused;
      const bound = getSentenceMsBoundary(nextIdx);
      seekToTime(bound.startMs, wasPlaying, { targetSentenceIndex: nextIdx });
    }
  } else if (key === 'w') {
    e.preventDefault();
    if (state.dictMode === 'programmed') return;
    state.repeatMode = !state.repeatMode;
    if (state.repeatMode) syncRepeatTargetToCurrentPosition();
    else state.repeatSentenceIndex = null;
    updateABButtons();
    highlightSentence(state.sentenceIndex);
    updateProgress();
  }
});

document.addEventListener('keyup', (e) => {
  if (keyScrubActive && (e.key.toLowerCase() === 'a' || e.key.toLowerCase() === 'd')) {
    keyScrubActive = false;
    if (state.scrubbing) stopScrub();
  }
});

// ─── Init ────────────────────────────────────────────────────────

// ─── Font Settings ───────────────────────────────────────────────

const FONT_SCALES = { 'S': 0.85, 'M': 1, 'L': 1.2, 'XL': 1.4 };
const FONT_SCALE_NAMES = ['S', 'M', 'L', 'XL'];

const FONT_FAMILIES = {
  rounded: '"Comic Sans MS", "Comic Sans", "OpenDyslexic", cursive, sans-serif',
  sans:    '"Comic Sans MS", "Comic Sans", "OpenDyslexic", cursive, sans-serif',
  serif:   '"Comic Sans MS", "Comic Sans", "OpenDyslexic", cursive, sans-serif',
  dyslexic:'"OpenDyslexic", "Comic Sans MS", "Comic Sans", cursive, sans-serif',
};

function loadFontPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem('wbw-font'));
    if (saved) return saved;
  } catch(e) {}
  return { scale: 'L', family: 'dyslexic' };
}

function saveFontPrefs(prefs) {
  localStorage.setItem('wbw-font', JSON.stringify(prefs));
}

function applyFontPrefs(prefs) {
  const root = document.documentElement;
  root.style.setProperty('--font-scale', FONT_SCALES[prefs.scale]);
  root.style.setProperty('--font', FONT_FAMILIES[prefs.family]);
  $('#fontSizeLabel').textContent = prefs.scale;
  $$('#fontFamilyOptions button').forEach(b => {
    b.classList.toggle('active', b.dataset.font === prefs.family);
  });
  refreshTranscriptPlayhead();
}

window.addEventListener('resize', refreshTranscriptPlayhead);

function changeFontSize(dir) {
  const prefs = loadFontPrefs();
  const idx = FONT_SCALE_NAMES.indexOf(prefs.scale);
  const newIdx = Math.max(0, Math.min(FONT_SCALE_NAMES.length - 1, idx + dir));
  prefs.scale = FONT_SCALE_NAMES[newIdx];
  saveFontPrefs(prefs);
  applyFontPrefs(prefs);
}

function setFontFamily(name) {
  const prefs = loadFontPrefs();
  prefs.family = name;
  saveFontPrefs(prefs);
  applyFontPrefs(prefs);
}

// Font popover toggle
$('#fontBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#fontPopover').classList.toggle('open');
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.font-settings')) {
    $('#fontPopover').classList.remove('open');
  }
});

$('#fontSizeDown').addEventListener('click', () => changeFontSize(-1));
$('#fontSizeUp').addEventListener('click', () => changeFontSize(1));

$$('#fontFamilyOptions button').forEach(btn => {
  btn.addEventListener('click', () => setFontFamily(btn.dataset.font));
});

// Score close button
$('#scoreClose').addEventListener('click', () => {
  const el = $('#scoreDisplay');
  if (!el.classList.contains('visible')) return;
  el.classList.add('closing');
  el.addEventListener('animationend', function handler() {
    el.removeEventListener('animationend', handler);
    el.classList.remove('visible', 'closing');
  });
});

// Init font prefs
applyFontPrefs(loadFontPrefs());

// HTMLAudioElement handles interruption recovery automatically through the
// platform media pipeline — no AudioContext state machine needed.
// If the page was backgrounded while playing (silence on return), the next
// Play tap calls _player.play() fresh on the existing element which the OS
// considers a new gesture-driven activation and restarts the output route.
['pointerdown', 'touchstart', 'keydown'].forEach(evt => {
  window.addEventListener(evt, () => unlockPlayerSync(), { capture: true, once: true });
});

initMaterialPanel();

// Sync dictMode UI to match state. The id was changed from 'dictMode' to
// 'dictModeSelect' to prevent browser autofill from restoring a stale value
// across sessions (autofill matches by id/name).
$('#dictModeSelect').value = state.dictMode;
$('#programmedLaps').value = state.programmedLaps;
$('#programmedLaps').style.display = state.dictMode === 'programmed' ? '' : 'none';
// Initialize bottom panel as hidden
setInputPanelVisible(false, { instant: true });
// ─── Startup ──────────────────────────────────────────────────────
// Show the overlay immediately so the user never sees a broken UI.
// loadExerciseAudio checks IndexedDB cache first — if hit, the overlay
// disappears near-instantly. On cache miss, init + synthesis run
// behind the overlay.

state.loadingMessage = 'Loading…';
showLoadingOverlay();
document.querySelector('.loading-bar-fill')?.classList.add('indeterminate');
if (state.exercises.length > 0) {
  loadExercise(DEFAULT_EXERCISE_INDEX);
} else {
  console.error('[content] No exercises available. Run webapp/scripts/generate-content-catalog.js first.');
}
