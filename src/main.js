import { createPiperProvider } from 'piper-timing-farm-browser';

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
        console.log('[SW] controllerchange — now controlling');
        resolve();
      }, { once: true });
    });
  };

  // Already controlling — check for updates in the background
  if (navigator.serviceWorker.controller) {
    console.log('[SW] Already controlling');
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
            console.log('[SW] New version installed — activating');
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
    console.log('[SW] Activated — waiting for controller');
    await waitForController(8000);
    console.log('[SW] Controller ready:', !!navigator.serviceWorker.controller);
  } catch (err) {
    console.warn('[SW] Registration failed:', err.message);
  }
})();

// ─── Content Data ────────────────────────────────────────────────

const EXERCISES = [
  // Part 1 — Short monologues (picture description style)
  { exam:"PET", id:"pet-part1-001", part:1, title:"At the train station",
    text:"The train to London will depart from platform six in approximately ten minutes. Passengers should have their tickets ready for inspection before boarding." },
  { exam:"PET", id:"pet-part1-002", part:1, title:"At the restaurant",
    text:"I'd like to book a table for four people at seven o'clock this evening. We'd prefer a table by the window if that's possible." },
  { exam:"PET", id:"pet-part1-003", part:1, title:"Shopping for clothes",
    text:"These shoes are a bit too tight around the toes. Do you have them in a larger size? I normally take a size forty-two in this brand." },
  { exam:"PET", id:"pet-part1-004", part:1, title:"At the doctor's office",
    text:"I've been feeling quite tired recently and I keep getting headaches in the afternoon. The doctor said I should try to reduce my screen time and get more fresh air." },
  { exam:"PET", id:"pet-part1-005", part:1, title:"Asking for directions",
    text:"Excuse me, could you tell me how to get to the museum? I think I've taken a wrong turn somewhere. Go straight ahead until you reach the traffic lights, then turn left at the post office." },
  { exam:"PET", id:"pet-part1-006", part:1, title:"At the library",
    text:"I need to return these books but the library closes at five thirty today. You can use the drop box outside the main entrance after hours if you prefer." },
  { exam:"PET", id:"pet-part1-007", part:1, title:"Making a phone call",
    text:"Hello, I'm calling about the apartment for rent on Park Road. Is it still available? Yes it is, would you like to arrange a time to come and have a look at it?" },

  // Part 2 — Longer monologue
  { exam:"PET", id:"pet-part2-001", part:2, title:"A cycling trip across France",
    text:"Last summer I decided to go on a cycling trip across France with two of my closest friends. We had been planning this adventure for nearly six months and we were all extremely excited when the day finally arrived. We set off early on a Saturday morning and took the ferry from Dover to Calais. The weather was perfect for cycling, not too hot and not too cold. We had planned to cover about sixty kilometres each day, which gave us plenty of time to stop in small villages and enjoy the local food." },
  { exam:"PET", id:"pet-part2-002", part:2, title:"A visit to the science museum",
    text:"Last month our school organised a trip to the City Science Museum and it turned out to be one of the best school trips I have ever been on. The museum had recently been renovated and they had added several new interactive exhibitions. My favourite part was the space exploration section where you could experience what it feels like to walk on the moon. They also had a wonderful display about the history of flight, with real aircraft hanging from the ceiling. We spent nearly four hours there and still did not manage to see everything." },
  { exam:"PET", id:"pet-part2-003", part:2, title:"Learning to cook",
    text:"When I first moved into my own flat I could barely boil an egg. My mother had always done all the cooking at home and I had never really shown much interest in learning. But after a few weeks of eating nothing but sandwiches and takeaway pizza, I decided something had to change. I started by watching cooking videos online and following simple recipes. The first meal I made was spaghetti bolognese and although it was not perfect, I felt incredibly proud of myself. Now I actually really enjoy cooking and I try to make something new every weekend. My friends say my roast chicken is the best they have ever tasted." },
  { exam:"PET", id:"pet-part2-004", part:2, title:"My first job interview",
    text:"I will never forget my first proper job interview. I was eighteen years old and I had just finished my A-levels. The position was for a part-time sales assistant at a large department store in the city centre. I spent the whole week before the interview preparing answers to possible questions and choosing the right clothes to wear. On the day itself I arrived nearly thirty minutes early because I was so worried about being late. The interview only lasted about fifteen minutes but it felt like hours. To my surprise I got the job and I ended up working there for two years while I was at university." },
  { exam:"PET", id:"pet-part2-005", part:2, title:"A weekend camping trip",
    text:"A few weeks ago my brother and I decided to go camping in the Lake District for the weekend. We had checked the weather forecast and it said there would be light rain on Saturday morning but it would clear up by the afternoon. Unfortunately the forecast was completely wrong and it poured with rain the entire weekend. Our tent was not completely waterproof so we woke up on Sunday morning in a puddle of water. We ended up packing everything up and driving home early, stopping for a hot meal at a pub on the way back. Despite the terrible weather we still laughed about it and agreed we would try again in the summer." },
  { exam:"PET", id:"pet-part2-006", part:2, title:"Learning to play the guitar",
    text:"About six months ago I decided to learn how to play the guitar. My grandfather had given me his old acoustic guitar years ago but it had been sitting in the corner of my bedroom gathering dust ever since. I found a really good teacher online who offers lessons through video calls. At first my fingers were so sore that I could only practise for about ten minutes at a time, but gradually I built up strength and now I can play for an hour without any discomfort. I am not ready to perform in front of an audience yet but I have learned about a dozen songs and I play a little bit every evening to relax." },

  // Part 3 — Gap-fill style (longer monologue)
  { exam:"PET", id:"pet-part3-001", part:3, title:"Summer music festival announcement",
    text:"Good evening everyone and welcome to the Summer Sounds Music Festival. I would like to go through a few important announcements before the first performance begins. The main stage will open at six o'clock this evening with a performance by the local youth orchestra. Food and drink stalls are located behind the main stage and will remain open until eleven o'clock at night. Please note that glass bottles are not allowed anywhere on the festival site for safety reasons. If you need any assistance during the event, the information point is next to the main entrance and our volunteers will be happy to help you. Lost property can be collected from the same location. I hope you all have a wonderful evening and enjoy the music." },
  { exam:"PET", id:"pet-part3-002", part:3, title:"Guide to the city walking tour",
    text:"Good morning and thank you for joining the City History Walking Tour today. My name is Sarah and I will be your guide for the next two hours. We will start our tour here in the main square which was built in eighteen forty-two. Our first stop will be the old cathedral on Hill Street, which is about a ten-minute walk from here. After visiting the cathedral we will continue to the market district where you will have forty-five minutes of free time to explore and buy some lunch. Please stay with the group at all times and wear the red cap that was given to you at the meeting point so that I can easily spot everyone. The tour will finish back here at the main square at around twelve thirty." },
  { exam:"PET", id:"pet-part3-003", part:3, title:"Instructions for a new online course",
    text:"Hello and welcome to your online photography course. Before you begin the first lesson I would like to explain how the course works and what you will need. The course is divided into eight separate units and each unit takes approximately one week to complete. At the end of each unit there is a short quiz to check your understanding. You need to score at least eighty percent to move on to the next unit, but you can retake each quiz up to three times. You will need a camera that allows you to adjust the settings manually, and a notebook for recording your progress. The course materials can be downloaded from the website and you can work through them at your own speed. If you have any questions you can email your tutor at any time." },
  { exam:"PET", id:"pet-part3-004", part:3, title:"Announcement at a sports centre",
    text:"Attention all members. This is a message from the management team at Riverside Sports Centre. We have some important updates about our facilities and opening hours. The swimming pool will be closed for maintenance from the fifteenth to the twenty-second of March. During this period the gym will be open for extended hours, from six in the morning until ten at night. We are also pleased to announce that our new climbing wall will open on the first of April. From next month the monthly membership fee will increase by five pounds to thirty-five pounds. However, if you renew your membership before the end of this month you can still pay the old price. For more information please speak to a member of staff at the reception desk." },
  { exam:"PET", id:"pet-part3-005", part:3, title:"Welcome talk at a language school",
    text:"Good morning and a very warm welcome to everyone joining us here at the Brighton Language School. My name is Mr. Thompson and I am the head teacher. Your classes will begin tomorrow morning at nine o'clock sharp. Please check the notice board in the main hall to find out which classroom you are in and the name of your teacher. There are fifteen students in each class on average and lessons last for three hours with a twenty-minute break in the middle. Lunch is served in the school canteen between twelve and two o'clock. In the afternoons we organise social activities including sports, city tours and film nights. On Friday evening there will be a welcome party in the student common room and everyone is invited." },
  { exam:"PET", id:"pet-part3-006", part:3, title:"Radio announcement about road closures",
    text:"This is a travel update for drivers in the city centre. Due to emergency repair work on a water pipe, Park Avenue will be closed between the hours of eight in the morning and six in the evening for the next three days. Drivers are advised to use Queen Street or Victoria Road as alternative routes. Please be aware that these roads are likely to be busier than usual during the morning and evening rush hours, so you should allow an extra twenty minutes for your journey. Bus services numbers forty-seven and fifty-two will also be affected and will follow a different route during this period. For more information about changes to bus timetables please visit the city transport website or call the helpline." },

  // Part 4 — Dialogue / Interview (longest)
  { exam:"PET", id:"pet-part4-001", part:4, title:"Interview with a wildlife photographer",
    text:"Today I'm joined by Mark Davidson, a wildlife photographer who has just returned from six months in the Amazon rainforest. Mark, welcome to the programme. Thank you for having me. It is nice to be back in a comfortable studio after spending so long in the jungle. What was the most challenging part of your trip? Definitely the insects. I had prepared myself for the heat and the humidity, but I was not expecting so many mosquitoes. I must have used about ten bottles of insect repellent. The humidity also made it very difficult to keep my camera equipment dry, which was a constant worry. And what was the most memorable moment? Without a doubt, the moment I spotted a jaguar only about twenty metres away from me. I had been trying to photograph one for weeks. It was early morning and the light was perfect. I managed to take about thirty photographs before it disappeared back into the trees. That sounds absolutely incredible. Will you be going back? I am already planning my next trip for later this year. There is still so much I want to capture." },
  { exam:"PET", id:"pet-part4-002", part:4, title:"Conversation about a new film",
    text:"Did you see that new film at the cinema last weekend? The one about the explorer who gets lost in the mountains? Yes I did, actually. I went on Saturday evening with my sister. What did you think of it? I thought it was brilliant. The scenery was absolutely stunning and the acting was really convincing. There was one scene near the end that actually made me cry a little bit. I know exactly which scene you mean. I felt the same way. I was not expecting it to be so emotional. But I have to say I thought the beginning was a bit slow. It took about thirty minutes before anything really interesting happened. That is true, but I think it was necessary to build up the characters. Once the story got going it was really exciting. I would definitely recommend it to anyone who enjoys adventure films. Me too. My sister has already told about five of her friends to go and see it. I might even watch it again when it comes out on streaming." },
  { exam:"PET", id:"pet-part4-003", part:4, title:"Discussion about a school project",
    text:"So tell me about your history project. I understand you chose to research life in our town during the Second World War? Yes that is right. My partner James and I spent about three weeks working on it. We interviewed several elderly residents who were children during the war and their stories were absolutely fascinating. That sounds like a really interesting approach. What was the most surprising thing you discovered? We found out that the old factory on Mill Road was used to make parts for aircraft during the war. We had no idea about that before we started our research. One of the people we spoke to actually worked there when she was only sixteen years old. And how did you present your findings? We created a short documentary film using the interviews and old photographs from the local library. We also made a timeline showing the key events that happened in the town between nineteen thirty-nine and nineteen forty-five. Our classmates seemed to really enjoy it. Well done to both of you. That is excellent work." },
  { exam:"PET", id:"pet-part4-004", part:4, title:"Booking a holiday over the phone",
    text:"Good afternoon, Sun Travel. How can I help you today? Hello, I am looking to book a week's holiday somewhere warm in July. Can you tell me what is available? Certainly. Do you have a particular destination in mind or a specific budget you would like to stay within? I was thinking about Spain or perhaps Portugal. Somewhere with a nice beach but also some interesting places to visit nearby. My budget is around six hundred pounds per person including flights and accommodation. I have a lovely package to the Algarve in Portugal. It includes return flights from Manchester, seven nights in a four-star hotel with breakfast, and it is only five minutes walk from the beach. That comes to five hundred and seventy-five pounds per person. That sounds perfect actually. Is there an option to add travel insurance as well? Yes, we can add comprehensive travel insurance for an extra twenty-five pounds per person. Would you like me to go ahead and make the booking? Yes please, let's do that." },
  { exam:"PET", id:"pet-part4-005", part:4, title:"Interview with a young entrepreneur",
    text:"Welcome back to the show. My next guest is Emma Clarke, a twenty-two-year-old who started her own successful online business while she was still at university. Emma, tell us how it all began. Well, it started almost by accident really. I was studying graphic design and I began making my own greeting cards for friends and family. People kept telling me I should sell them, so I opened a small online shop just to see what would happen. And what happened? I was completely shocked by the response. Within the first month I had received over two hundred orders. I was working on my designs every evening after my lectures and packing orders at the weekend. My flatmates thought I was absolutely crazy. How did you manage to balance your studies with running a business? It was incredibly difficult to be honest. There were times when I thought about giving up because I was getting very little sleep. But my parents were really supportive and my tutors gave me some flexibility with deadlines. In the end I graduated with good marks and the business was doing so well that I decided to focus on it full-time. That is a remarkable story. What advice would you give to other young people who want to start a business? I would say just start small and do not be afraid to make mistakes. You learn so much more from the things that go wrong than from the things that go right." },
  { exam:"PET", id:"pet-part4-006", part:4, title:"At the dentist's office",
    text:"Good morning, come in and have a seat. What seems to be the problem? I have been getting a really bad pain in one of my back teeth whenever I eat anything cold or sweet. It started about a week ago and it seems to be getting worse. Let me have a look. Can you open your mouth wide for me please? I am just going to take a quick look around. Is it very serious? I have been quite worried about it actually. I can see a small cavity in your lower right molar. It is not too deep at the moment but it will need a filling. If we leave it any longer the decay could reach the nerve and that would be much more painful and expensive to treat. Can you do the filling today? I am afraid my schedule is completely full today. But I can book you in for Thursday morning at ten thirty if that works for you. The procedure will take about forty-five minutes and you will be able to eat and drink normally a couple of hours afterwards. Thursday morning is fine. Thank you very much. In the meantime try to avoid very cold or sugary foods on that side of your mouth. I will see you on Thursday." },
];

// ─── App State ───────────────────────────────────────────────────

const state = {
  exercises: EXERCISES,
  currentIndex: 0,
  sentences: [],
  sentenceIndex: 0,
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
  audioCtx: null,              // AudioContext (resumed on user gesture)
  audioBuffers: {},            // { slow: AudioBuffer, normal: AudioBuffer, fast: AudioBuffer }
  ttsMetaBySpeed: {},          // { slow: meta, normal: meta, fast: meta }
  srcNode: null,               // current AudioBufferSourceNode
  srcStartOffset: 0,           // offset in seconds when srcNode started
  srcStartedAt: 0,             // audioCtx.currentTime when srcNode started
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
    if (prev.provider) {
      state.provider = prev.provider;
      state.providerReady = prev.providerReady;
      console.log('[HMR] Restored Piper provider');
    }
    if (prev.audioCtx) {
      state.audioCtx = prev.audioCtx;
      console.log('[HMR] Restored AudioContext');
    }
    if (prev.audioBuffers && Object.keys(prev.audioBuffers).length > 0) {
      state.audioBuffers = prev.audioBuffers;
      state.ttsMetaBySpeed = prev.ttsMetaBySpeed || {};
      state.ttsMeta = prev.ttsMeta;
      state.totalDurationMs = prev.totalDurationMs;
      console.log('[HMR] Restored audio buffers');
    }
    window.__wbw_preserved = null;
  }
  import.meta.hot.dispose(() => {
    window.__wbw_preserved = {
      provider: state.provider,
      providerReady: state.providerReady,
      audioCtx: state.audioCtx,
      audioBuffers: state.audioBuffers,
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
  } else {
    $('#btnPlay').innerHTML = playing ? ICONS.pause + ' Pause' : ICONS.play + ' Play';
  }
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

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
  // Desktop Safari: 2 workers — Safari's SW interception and WASM
  // threading are less robust than Chrome, and 4 concurrent workers
  // can race on the HuggingFace model download, causing some workers
  // to get a partial/corrupt response ("protobuf parsing failed").
  if (_isSafari) return 2;
  return Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2));
}

function getSynthesisConcurrency() {
  if (isIOSLikeSafari()) return 1;
  if (_isSafari) return 2;
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
    console.log('[piper-cache] Purged voice asset cache:', modelId, res.status);
    return res.ok;
  } catch (err) {
    console.warn('[piper-cache] Voice asset purge failed:', err);
    return false;
  }
}

// ─── UI Rendering ────────────────────────────────────────────────

function renderSelectors() {
  // Exam dropdown
  const exams = [...new Set(state.exercises.map(e => e.exam))].sort();
  const examSelect = $('#examSelect');
  examSelect.innerHTML = exams.map(e => `<option value="${e}">${e}</option>`).join('');
  examSelect.value = state.exercises[state.currentIndex].exam;
  updatePartSelect();
}

function updatePartSelect() {
  const exam = $('#examSelect').value;
  const examExercises = state.exercises.filter(e => e.exam === exam);
  const parts = [...new Set(examExercises.map(e => e.part))].sort();
  const partSelect = $('#partSelect');
  partSelect.innerHTML = parts.map(p => {
    const labels = {1:'Part 1', 2:'Part 2', 3:'Part 3', 4:'Part 4'};
    return `<option value="${p}">${labels[p] || 'Part '+p}</option>`;
  }).join('');
  if (parts.length > 0) {
    // Select current exercise's part if it belongs to this exam, otherwise first
    const curPart = state.exercises[state.currentIndex]?.part;
    partSelect.value = (curPart && parts.includes(curPart)) ? curPart : parts[0];
  }
  updateExerciseSelect();
}

function updateExerciseSelect() {
  const exam = $('#examSelect').value;
  const part = +$('#partSelect').value;
  const filtered = state.exercises.filter(e => e.exam === exam && e.part === part);
  const sel = $('#exerciseSelect');
  sel.innerHTML = filtered.map((e) => {
    const origIdx = state.exercises.indexOf(e);
    return `<option value="${origIdx}">${e.title}</option>`;
  }).join('');
  if (filtered.length > 0) {
    // Keep current exercise if it's in this filtered list, otherwise select first
    const curIdx = state.currentIndex;
    const curInFiltered = filtered.some(e => state.exercises.indexOf(e) === curIdx);
    sel.value = curInFiltered ? curIdx : state.exercises.indexOf(filtered[0]);
  }
}

async function loadExercise(index) {
  stop();
  state.currentIndex = index;
  const ex = state.exercises[index];
  console.log(`loadExercise(${index})`, ex.title);
  // Sync selectors to reflect loaded exercise (setting .value doesn't fire change)
  $('#examSelect').value = ex.exam;
  updatePartSelect();
  state.sentences = splitSentences(ex.text);
  state.sentenceIndex = 0;
  state.elapsedMs = 0;
  state.ttsMeta = null;
  state.audioBuffers = {};
  state.ttsMetaBySpeed = {};
  state._initError = null;

  $('#exerciseBadge').textContent = `Part ${ex.part} · Exercise ${index + 1}`;
  $('#exerciseTitle').textContent = ex.title;
  $('#transcriptText').innerHTML = state.sentences.map((s, i) => {
    const words = s.split(' ').map(w => `<span class="word">${w}</span>`).join(' ');
    return `<span class="sentence" data-idx="${i}">${words}</span> `;
  }).join('');

  // Word-level click: position playhead at exact word in the timeline
  $('#transcriptText').querySelectorAll('.word').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasPlaying = state.playing && !state.paused;
      stopSrcNode();
      stopPlayheadTracker();
      state.playing = false; state.paused = false;

      const sentEl = el.closest('.sentence');
      const sentIdx = +sentEl.dataset.idx;
      const words = [...sentEl.querySelectorAll('.word')];
      const wordIdx = words.indexOf(el);

      // Calculate timeline position for this word
      const bound = getSentenceMsBoundary(sentIdx);
      const fraction = bound.wordCount > 1 ? wordIdx / (bound.wordCount - 1) : 0;
      state.elapsedMs = bound.startMs + fraction * (bound.endMs - bound.startMs);
      state.sentenceIndex = sentIdx;

      highlightSentence(sentIdx);
      updateProgress();
      setPlayIcon(false);
      $('#btnPlay').classList.add('primary');

      if (wasPlaying) {
        setTimeout(() => play(), 80);
      }
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

function highlightSentence(idx) {
  state.sentenceIndex = idx;
  const els = document.querySelectorAll('.sentence');
  els.forEach((el, i) => {
    el.classList.toggle('active', i === idx);
    el.classList.toggle('repeat', i === idx && state.repeatMode);
  });
  if (els[idx]) {
    els[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  updateWordHighlight();
}

function updateWordHighlight() {
  // During active playback, srcNode is set — use precise word timing
  const idx = state.sentenceIndex;
  const sentEls = document.querySelectorAll('.sentence');
  if (!sentEls[idx]) return;

  const bound = getSentenceMsBoundary(idx);
  const words = sentEls[idx].querySelectorAll('.word');
  if (words.length === 0) return;

  document.querySelectorAll('.word').forEach(w => {
    w.classList.remove('spoken', 'speaking');
  });

  const elapsedInSent = Math.max(0, state.elapsedMs - bound.startMs);

  // Use per-word phoneme timings if available
  if (bound.words && bound.words.length > 0 && bound.words.length === words.length) {
    let speakingIdx = -1;
    for (let i = 0; i < bound.words.length; i++) {
      const w = bound.words[i];
      if (elapsedInSent >= w.startMs - bound.startMs && elapsedInSent < w.endMs - bound.startMs) {
        speakingIdx = i;
        break;
      }
    }
    words.forEach((w, i) => {
      if (i < speakingIdx) w.classList.add('spoken');
      else if (i === speakingIdx) w.classList.add('speaking');
    });
  } else {
    // Fallback: character-length proportion
    const sentDuration = bound.endMs - bound.startMs;
    const fraction = sentDuration > 0 ? Math.min(1, elapsedInSent / sentDuration) : 0;
    const spokenCount = Math.floor(fraction * words.length);
    words.forEach((w, i) => {
      if (i < spokenCount) w.classList.add('spoken');
      else if (i === spokenCount) w.classList.add('speaking');
    });
  }
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

  // Fill only the current sentence's segment, up to the playhead position
  const fillWidth = Math.max(0, currentPct - sentStartPct);
  $('#progressFill').style.left = sentStartPct + '%';
  $('#progressFill').style.width = fillWidth + '%';
  $('#progressFill').style.borderRadius = fillWidth > 0 ? '0' : '';

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
    parts.push(
      `<div class="progress-segment" data-idx="${i}" style="left:${startPct.toFixed(2)}%;width:${width.toFixed(2)}%"></div>` +
      `<div class="progress-tick" data-idx="${i}" style="left:${startPct.toFixed(2)}%"></div>`
    );
  }
  container.innerHTML = parts.join('');
}

// ─── Piper Provider & Voice Management ───────────────────────────

let _initPromise = null; // prevents concurrent initProvider() calls

async function initProvider() {
  // If already initializing, wait for that to finish instead of racing
  if (_initPromise) {
    console.log('[initProvider] Already initializing — waiting for existing init');
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
        state.provider = createPiperProvider({ debug: true });
      }
      const INIT_TIMEOUT_MS = 90_000;

      state.loadingMessage = 'Loading…';
      document.querySelector('.loading-bar-fill')?.classList.add('indeterminate');

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
      if (!state.audioCtx) {
        state.audioCtx = new AudioContext();
      }
      console.log(`[initProvider] ready in ${((Date.now() - t0) / 1000).toFixed(1)}s with cpuInstances=${cpuInstances}`);
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
  state.audioBuffers = {};
  state.ttsMetaBySpeed = {};
  state.elapsedMs = 0;
  state.sentenceIndex = 0;
  state.totalDurationMs = state.sentences.reduce((s, sent) => s + estimateDuration(sent), 0);
  renderProgressSegments();
  updateProgress();

  if (state.sentences.length > 0 && await loadAudioFromCache()) {
    console.log('[switchVoice] Cache hit for voice:', voiceType);
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
    await synthesizeAllSpeeds();
    await saveAudioToCache();
  }
  if (wasPlaying) {
    await seekToTime(0, true);
  }
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
  const savedMs = state.elapsedMs;

  if (wasPlaying) stopSrcNode();

  state.speedPreset = preset;
  state.ttsMeta = state.ttsMetaBySpeed[preset] || state.ttsMeta;
  state.totalDurationMs = state.ttsMeta ? state.ttsMeta.durationMs : 0;

  if (wasPlaying) {
    await seekToTime(savedMs, true);
  } else {
    updateProgress();
  }
}

// ─── Audio Engine Helpers ──────────────────────────────────────────

function currentAudioTime() {
  if (!state.srcNode || !state.audioCtx) return state.elapsedMs / 1000;
  return state.audioCtx.currentTime - state.srcStartedAt + state.srcStartOffset;
}

function stopSrcNode() {
  if (state.srcNode) {
    try { state.srcNode.stop(); } catch (_) { /* already stopped */ }
    state.srcNode = null;
  }
}

// Create the AudioContext if needed — does NOT resume (requires user gesture).
// Safe to call during page load for buffer creation / cache restoration.
function ensureAudioCtx() {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

// Resume the AudioContext before playback. Must be called from a user-gesture
// context (click handler) or it will stay suspended indefinitely.
async function resumeAudioCtx() {
  ensureAudioCtx();
  if (state.audioCtx.state === 'suspended') {
    await state.audioCtx.resume();
  }
  if (state.audioCtx.state !== 'running') {
    throw new Error('AudioContext not running — browser may be blocking audio');
  }
}

// ─── Exercise Loading (Piper WASM synthesis) ────────────────────────

async function synthesizeAllSpeeds() {
  console.log('[synthesizeAllSpeeds] Starting synthesis for', state.sentences.length, 'sentences x 3 speeds');
  const presets = ['slow', 'normal', 'fast'];
  const totalSteps = presets.length * state.sentences.length;
  let completedSteps = 0;
  for (const preset of presets) {
    const spd = SPEED_PRESETS[preset];
    console.log(`[synthesizeAllSpeeds] === ${preset} (speed=${spd.speed}) ===`);
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
  state.ttsMeta = state.ttsMetaBySpeed[state.speedPreset];
  state.totalDurationMs = state.ttsMeta ? state.ttsMeta.durationMs : 0;
  state.elapsedMs = 0;
  renderProgressSegments();
  hideLoadingOverlay();
}

async function synthesizeAtSpeed(preset, onProgress) {
  const spd = SPEED_PRESETS[preset];
  if (!spd || !state.provider || !state.providerReady) {
    console.log(`synth abort: spd=${!!spd} provider=${!!state.provider} ready=${state.providerReady}`);
    return;
  }

  const sentences = state.sentences;
  const SYNTH_TIMEOUT_MS = 45_000; // 45s per sentence should be plenty

  // Dispatch through a bounded queue. iPad Safari is much more reliable when
  // it does not have several large worker/model jobs active at once.
  let completed = 0;
  const total = sentences.length;
  const concurrency = Math.min(total || 1, getSynthesisConcurrency());
  console.log(`[synthesize] ${preset}: synthesizing ${total} sentences with concurrency=${concurrency}`);

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
      console.log(`[synthesize] ${preset} sentence ${i + 1}/${total} OK in ${((performance.now() - startTime) / 1000).toFixed(1)}s`);
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
    console.log(`synth ${preset}: 0/${results.length} valid results`);
    return;
  }

  const sampleRate = validResults[0].sampleRate;

  // Compute total length and build per-sentence metadata
  let totalSamples = 0;
  const metaSentences = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const wordCount = sentences[i].split(/\s+/).filter(w => w).length;
    if (r && r.audioData && r.audioData.length > 0) {
      const startSample = totalSamples;
      const durMs = r.durationMs || (r.audioData.length / r.sampleRate) * 1000;
      const sampleLen = r.audioData.length;
      totalSamples += sampleLen;

      // Compute per-word timing from phoneme data
      const words = buildWordTimings(sentences[i], r.metadata, startSample, sampleRate);

      metaSentences.push({
        startMs: (startSample / sampleRate) * 1000,
        endMs: (totalSamples / sampleRate) * 1000,
        startSample,
        endSample: totalSamples,
        wordCount,
        words,
        durationMs: durMs,
      });
    } else {
      // Fallback: estimate duration for failed synthesis
      const estDur = estimateDuration(sentences[i]);
      metaSentences.push({
        startMs: (totalSamples / sampleRate) * 1000,
        endMs: ((totalSamples / sampleRate) * 1000) + estDur,
        startSample: totalSamples,
        endSample: totalSamples,
        wordCount,
        words: buildFallbackWordTimings(sentences[i], (totalSamples / sampleRate) * 1000, estDur),
        durationMs: estDur,
      });
    }
  }

  // Concatenate all Float32Arrays
  const concat = new Float32Array(totalSamples);
  let offset = 0;
  for (const r of validResults) {
    concat.set(r.audioData, offset);
    offset += r.audioData.length;
  }

  // Create AudioBuffer
  ensureAudioCtx();
  const buf = state.audioCtx.createBuffer(1, concat.length, sampleRate);
  buf.copyToChannel(concat, 0);
  state.audioBuffers[preset] = buf;

  const totalDurationMs = totalSamples > 0 ? (totalSamples / sampleRate) * 1000 : 0;
  state.ttsMetaBySpeed[preset] = { sentences: metaSentences, durationMs: totalDurationMs, sampleRate };
}

// ─── Phoneme-to-Word Timings ────────────────────────────────────────

function buildWordTimings(sentenceText, metadata, sentenceStartSample, sampleRate) {
  const words = sentenceText.split(/\s+/).filter(w => w);
  if (!metadata || !metadata.phonemes || !metadata.durations || words.length === 0) {
    return buildFallbackWordTimings(sentenceText, (sentenceStartSample / sampleRate) * 1000, 0);
  }

  const phonemes = metadata.phonemes;       // string[]
  const durations = metadata.durations;      // Float32Array (seconds)

  // Map phonemes to words by character-length proportion
  const totalChars = words.reduce((s, w) => s + w.length, 0);
  const totalPhonemes = phonemes.length;
  if (totalPhonemes === 0 || totalChars === 0) {
    return buildFallbackWordTimings(sentenceText, (sentenceStartSample / sampleRate) * 1000, 0);
  }

  // Assign phonemes to each word proportionally by character count
  let phonemeIdx = 0;
  const wordTimings = [];
  const sentenceStartMs = (sentenceStartSample / sampleRate) * 1000;

  for (let wi = 0; wi < words.length; wi++) {
    const charFrac = words[wi].length / totalChars;
    const numPhonemesForWord = Math.max(1, Math.round(charFrac * totalPhonemes));
    const endPhonemeIdx = Math.min(totalPhonemes, phonemeIdx + numPhonemesForWord);

    // Sum durations for this word's phonemes
    let wordDurSec = 0;
    for (let pi = phonemeIdx; pi < endPhonemeIdx; pi++) {
      wordDurSec += durations[pi];
    }

    const wordStartMs = sentenceStartMs + (phonemeIdx > 0
      ? durations.slice(0, phonemeIdx).reduce((a, b) => a + b, 0) * 1000
      : 0);
    const wordEndMs = wordStartMs + wordDurSec * 1000;

    wordTimings.push({ startMs: wordStartMs, endMs: wordEndMs });
    phonemeIdx = endPhonemeIdx;
  }

  return wordTimings;
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
const CACHE_MAX_ENTRIES = Math.max(100, EXERCISES.length * Object.keys(VOICE_MODELS).length * 2);

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
    console.log('[cache] Opening IndexedDB...');
    const db = await openAudioCache();
    const primaryKey = getCacheKey();
    const legacyKey = getLegacyCacheKey();
    const keys = legacyKey === primaryKey ? [primaryKey] : [primaryKey, legacyKey];
    console.log('[cache] DB opened, reading keys:', keys);
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
    console.log('[cache] Read complete, found:', !!cached);
    if (!cached) { console.log('[cache] No entry found for keys:', keys); return false; }
    // Verify sentences match — content could have changed
    if (!cached.sentences || cached.sentences.length !== state.sentences.length) {
      console.log('[cache] Sentence count mismatch — cached:', cached.sentences?.length, 'current:', state.sentences.length);
      return false;
    }
    for (let i = 0; i < state.sentences.length; i++) {
      if (cached.sentences[i] !== state.sentences[i]) {
        console.log('[cache] Sentence', i, 'differs — stale cache');
        return false;
      }
    }
    // Restore audio buffers and metadata from cache
    await ensureAudioCtx();
    let buffersRestored = 0;
    for (const preset of ['slow', 'normal', 'fast']) {
      const bufData = cached.buffers[preset];
      const meta = cached.meta[preset];
      if (bufData && meta) {
        const buf = state.audioCtx.createBuffer(1, bufData.byteLength / 4, meta.sampleRate);
        buf.copyToChannel(new Float32Array(bufData), 0);
        state.audioBuffers[preset] = buf;
        state.ttsMetaBySpeed[preset] = meta;
        buffersRestored++;
      }
    }
    if (buffersRestored === 0) {
      console.warn('[cache] Entry found with matching sentences but no audio buffers — ignoring');
      return false;
    }
    state.ttsMeta = state.ttsMetaBySpeed[state.speedPreset];
    state.totalDurationMs = state.ttsMeta ? state.ttsMeta.durationMs : 0;
    return true;
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
      buffers: {},
      meta: {},
      cachedAt: Date.now(),
    };
    for (const preset of ['slow', 'normal', 'fast']) {
      const buf = state.audioBuffers[preset];
      if (buf) {
        entry.buffers[preset] = buf.getChannelData(0).buffer.slice(0);
        entry.meta[preset] = state.ttsMetaBySpeed[preset];
      }
    }
    if (Object.keys(entry.buffers).length === 0) {
      db.close();
      console.warn('[cache] save skipped: no audio buffers for:', getCacheKey());
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
    console.log('[cache] Saved audio for:', getCacheKey());
  } catch (err) {
    console.warn('[cache] save failed:', err);
  }
}

let _loadAudioSeq = 0; // generation counter to cancel stale concurrent loads

async function loadExerciseAudio(ex) {
  const seq = ++_loadAudioSeq;
  console.log(`[loadExerciseAudio #${seq}] start — checking cache`);
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
    console.log(`[loadExerciseAudio #${seq}] Aborted — superseded by #${_loadAudioSeq}`);
    return;
  }

  if (cacheHit) {
    console.log(`[loadExerciseAudio #${seq}] Cache hit — audio ready`);
    // If provider isn't initialized yet, start it in the background so it's
    // available when the user switches to an uncached exercise.
    if (!state.provider || !state.providerReady) {
      console.log(`[loadExerciseAudio #${seq}] Provider not ready — background init`);
      initProviderWithCorruptModelRetry().catch(err => console.warn('[loadExerciseAudio] Background provider init failed:', err.message));
    }
    hideLoadingOverlay();
    updateProgress();
    if (state._playRequested && state.audioBuffers[state.speedPreset]) {
      state._playRequested = false;
      play();
    }
    state._playRequested = false;
    return;
  }

  // Cache miss — init engine if not already running, then synthesize
  try {
    if (!state.provider || !state.providerReady) {
      // Recover from HMR-induced inconsistent state: providerReady=true but provider=null
      if (state.providerReady && !state.provider) {
        console.warn(`[loadExerciseAudio #${seq}] providerReady=true but provider is null — re-initializing`);
        state.providerReady = false;
      }
      showLoadingOverlay();
      await initProviderWithCorruptModelRetry();
      // Check again — initProvider may have taken long enough for another call to start
      if (_loadAudioSeq !== seq) {
        console.log(`[loadExerciseAudio #${seq}] Aborted after initProvider — superseded by #${_loadAudioSeq}`);
        return;
      }
    }

    console.log(`[loadExerciseAudio #${seq}] Cache miss — synthesizing`, sentences.length, 'sentences');
    try {
      await synthesizeAllSpeeds();
    } catch (err) {
      if (!isCorruptModelError(err)) throw err;
      console.warn(`[loadExerciseAudio #${seq}] Model parse failed during synthesis — purging and retrying once.`);
      state.provider = null;
      state.providerReady = false;
      await purgeVoiceAssetCache(VOICE_MODELS[state.voiceType]);
      await initProviderWithCorruptModelRetry();
      await synthesizeAllSpeeds();
    }
    if (_loadAudioSeq !== seq) {
      console.log(`[loadExerciseAudio #${seq}] Aborted after synthesis — superseded by #${_loadAudioSeq}`);
      return;
    }
    console.log(`[loadExerciseAudio #${seq}] Synthesis complete`);
    updateProgress();
    await saveAudioToCache();
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
    const hasAudio = state.audioBuffers[state.speedPreset];
    if (hasAudio) {
      hideLoadingOverlay();
    } else if (state._initError) {
      showLoadingOverlay();
    } else {
      hideLoadingOverlay();
    }
    console.log(`audioLoadDone hasAudio=${!!hasAudio} playRequested=${state._playRequested} err=${state._initError || 'none'}`);
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
    for (let i = 0; i < state.ttsMeta.sentences.length; i++) {
      const s = state.ttsMeta.sentences[i];
      if (ms >= s.startMs && ms < s.endMs) return i;
    }
    return state.ttsMeta.sentences.length - 1;
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
  // Return {startMs, endMs} for the given sentence index
  if (state.ttsMeta && state.ttsMeta.sentences && state.ttsMeta.sentences[idx]) {
    return state.ttsMeta.sentences[idx];
  }
  // Fallback
  let startMs = 0;
  for (let i = 0; i < idx; i++) startMs += estimateDuration(state.sentences[i]);
  const endMs = startMs + estimateDuration(state.sentences[idx] || '');
  return { startMs, endMs, wordCount: (state.sentences[idx] || '').split(' ').length };
}

// ─── Playback Engine (AudioBufferSourceNode) ─────────────────────

async function doPlay(offsetSec) {
  const gen = _playGen;
  console.log('[doPlay] start, offsetSec:', offsetSec, 'speedPreset:', state.speedPreset, 'audioBuffers keys:', Object.keys(state.audioBuffers));
  try {
    await resumeAudioCtx();
  } catch (err) {
    console.error('[doPlay] Cannot resume AudioContext:', err.message);
    state.playing = false;
    return;
  }
  if (_playGen !== gen) {
    console.log('[doPlay] cancelled — stop() was called during async gap');
    return;
  }
  stopSrcNode();

  const buf = state.audioBuffers[state.speedPreset];
  if (!buf) {
    console.error('[doPlay] No audio buffer for speed:', state.speedPreset, 'available:', Object.keys(state.audioBuffers));
    return;
  }
  console.log('[doPlay] buffer: duration=', buf.duration.toFixed(1) + 's', 'sampleRate=', buf.sampleRate, 'length=', buf.length, 'channels=', buf.numberOfChannels);
  // Diagnostic: check if the buffer has audible PCM data
  const channelData = buf.getChannelData(0);
  let peak = 0, nonZero = 0;
  const checkLen = Math.min(10000, channelData.length);
  for (let i = 0; i < checkLen; i++) {
    const abs = Math.abs(channelData[i]);
    if (abs > peak) peak = abs;
    if (abs > 0.001) nonZero++;
  }
  console.log('[doPlay] buffer peak amplitude:', peak.toFixed(4), 'non-zero samples in first 10k:', nonZero, '/', checkLen);

  const src = state.audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(state.audioCtx.destination);

  state.srcNode = src;
  state.srcStartOffset = offsetSec;
  state.srcStartedAt = state.audioCtx.currentTime;
  state.playing = true;
  state.paused = false;

  src.onended = () => {
    console.log('[doPlay] src.onended fired');
    if (state.srcNode === src) {
      state.srcNode = null;
    }
  };
  // Use currentTime as "when" — passing 0 may be in the past and silently dropped
  const now = state.audioCtx.currentTime;
  src.start(now, offsetSec);
  console.log('[doPlay] src.start() called at ctx time:', now, 'offset:', offsetSec, 'playing:', state.playing);
  setPlayIcon(true);
  $('#btnPlay').classList.remove('primary');
  if (state.dictMode === 'programmed') lockTextarea(true);
}

async function play() {
  console.log('[play] ENTERED. providerReady:', state.providerReady, 'playing:', state.playing, 'paused:', state.paused, 'dictMode:', state.dictMode, 'audioBuffers:', Object.keys(state.audioBuffers), 'sentences:', state.sentences.length);
  if (state.scrubbing) stopScrub();

  // If in a writing gap, skip it and start the next lap immediately
  if (state.lapGapTimer) {
    cancelLapGap();
    const curBound = getSentenceMsBoundary(state.sentenceIndex);
    advanceFromLapGap(curBound);
    return;
  }

  // Wait for audio to be ready
  if (!state.audioBuffers[state.speedPreset]) {
    console.warn('[play] Audio not ready yet');
    const overlay = document.querySelector('.loading-overlay');
    const loading = overlay && overlay.style.display === 'flex';
    console.log(`play: no audio, loading=${loading}`);
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
  if (state.playing && !state.paused) { console.log('[play] already playing'); return; }

  if (state.paused) {
    // Resume from pause
    console.log('[play] resuming from pause');
    await doPlay(currentAudioTime());
    startPlayheadTracker();
    return;
  }

  // Fresh play
  console.log('[play] fresh play, offsetMs:', state.elapsedMs);
  state.playing = true;
  state.paused = false;

  if (state.dictMode === 'programmed') {
    state.currentLap = 1;
    state.programmedPhase = 'sentence';
    lockTextarea(true);
  }

  const offsetSec = state.elapsedMs / 1000;
  await doPlay(offsetSec);
  startPlayheadTracker();
}

let _playheadTimer = null;

function startPlayheadTracker() {
  stopPlayheadTracker();
  _playheadTimer = setInterval(() => {
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
      const curBound = getSentenceMsBoundary(state.sentenceIndex);
      if (state.elapsedMs >= curBound.endMs - 10) {
        seekToTime(curBound.startMs, true);
        return;
      }
    }

    if (newIdx !== state.sentenceIndex) {
      state.sentenceIndex = newIdx;
      highlightSentence(newIdx);
    }
    updateProgress();
  }, 100);
}

function stopPlayheadTracker() {
  if (_playheadTimer) { clearInterval(_playheadTimer); _playheadTimer = null; }
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

// ─── Playback Control (AudioBuffer) ───────────────────────────────
let _playGen = 0;

function pause() {
  if (!state.playing || state.paused) return;
  stopSrcNode();
  state.elapsedMs = currentAudioTime() * 1000;
  state.paused = true;
  stopPlayheadTracker();
  updateProgress();
  setPlayIcon(false);
  $('#btnPlay').classList.add('primary');
}

function stop() {
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

async function seekToTime(ms, keepPlaying) {
  state.elapsedMs = Math.max(0, Math.min(state.totalDurationMs, ms));
  state.sentenceIndex = getSentenceAtTime(state.elapsedMs);

  if (keepPlaying) {
    stopSrcNode();
    const gen = _playGen;
    const offsetSec = state.elapsedMs / 1000;
    await doPlay(offsetSec);
    if (_playGen !== gen) return; // stop() was called during async gap
    startPlayheadTracker();
  } else {
    stopSrcNode();
    stopPlayheadTracker();
    state.playing = false;
    state.paused = false;
    setPlayIcon(false);
    $('#btnPlay').classList.add('primary');
  }

  highlightSentence(state.sentenceIndex);
  updateProgress();
}

// ─── Scrubbing (cassette-style FFW / reversed REW) ────────────────

const SCRUB_RATE = 2.5;
let _scrubTimer = null;
let _ffwSrc = null;
let _rewSrc = null;
let _ffwStartedAt = 0;
let _ffwStartOffset = 0;

function startScrub(direction) {
  if (state.sentences.length === 0) return;
  state.wasPlayingBeforeScrub = state.playing && !state.paused;
  stopSrcNode();
  stopPlayheadTracker();
  state.playing = false;
  state.paused = false;
  state.scrubbing = true;
  state.scrubDir = direction;

  setPlayIcon(false);
  $('#btnPlay').classList.add('primary');

  if (direction > 0) {
    startFFW();
  } else {
    startREW();
  }
}

function startFFW() {
  const buf = state.audioBuffers[state.speedPreset];
  if (!buf || !state.audioCtx) return;

  const offsetSec = state.elapsedMs / 1000;
  _ffwSrc = state.audioCtx.createBufferSource();
  _ffwSrc.buffer = buf;
  _ffwSrc.playbackRate.value = SCRUB_RATE;
  _ffwSrc.connect(state.audioCtx.destination);
  _ffwSrc.start(0, offsetSec);
  _ffwSrc.onended = () => { _ffwSrc = null; };
  _ffwStartedAt = state.audioCtx.currentTime;
  _ffwStartOffset = offsetSec;

  // Update UI periodically during FFW
  _scrubTimer = setInterval(() => {
    if (!state.scrubbing || state.scrubDir <= 0) {
      clearInterval(_scrubTimer);
      _scrubTimer = null;
      return;
    }
    const effectiveSec = _ffwStartOffset + (state.audioCtx.currentTime - _ffwStartedAt) * SCRUB_RATE;
    state.elapsedMs = Math.min(state.totalDurationMs, Math.max(0, effectiveSec * 1000));
    state.sentenceIndex = getSentenceAtTime(state.elapsedMs);
    highlightSentence(state.sentenceIndex);
    updateProgress();
  }, 80);
}

function startREW() {
  const stepMs = 100;
  _scrubTimer = setInterval(() => {
    if (!state.scrubbing || state.scrubDir >= 0) {
      clearInterval(_scrubTimer);
      _scrubTimer = null;
      return;
    }
    state.elapsedMs = Math.max(0, state.elapsedMs - stepMs * SCRUB_RATE);
    state.sentenceIndex = getSentenceAtTime(state.elapsedMs);
    highlightSentence(state.sentenceIndex);
    updateProgress();
  }, stepMs);

  playRewBurst();
}

function createReversedBuffer(fromSec, durationSec) {
  const buf = state.audioBuffers[state.speedPreset];
  if (!buf) return null;

  const sampleRate = buf.sampleRate;
  const startSample = Math.max(0, Math.floor(fromSec * sampleRate));
  const lengthSamples = Math.min(Math.floor(durationSec * sampleRate), buf.length - startSample);
  if (lengthSamples <= 0) return null;

  const reversed = state.audioCtx.createBuffer(buf.numberOfChannels, lengthSamples, sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const srcData = buf.getChannelData(ch);
    const dstData = reversed.getChannelData(ch);
    for (let i = 0; i < lengthSamples; i++) {
      dstData[i] = srcData[startSample + lengthSamples - 1 - i];
    }
  }
  return reversed;
}

function playRewBurst() {
  if (!state.scrubbing || state.scrubDir >= 0) return;

  const buf = state.audioBuffers[state.speedPreset];
  if (!buf || !state.audioCtx) return;

  const currentSec = state.elapsedMs / 1000;
  const segmentDur = 0.8; // seconds of original audio to reverse
  const startSec = Math.max(0, currentSec - segmentDur);
  const actualDur = currentSec - startSec;
  if (actualDur <= 0.01) return;

  const reversed = createReversedBuffer(startSec, actualDur);
  if (!reversed) return;

  _rewSrc = state.audioCtx.createBufferSource();
  _rewSrc.buffer = reversed;
  _rewSrc.playbackRate.value = SCRUB_RATE;
  _rewSrc.connect(state.audioCtx.destination);
  _rewSrc.start(0);
  _rewSrc.onended = () => {
    _rewSrc = null;
    if (state.scrubbing && state.scrubDir < 0) {
      playRewBurst(); // chain next burst while still rewinding
    }
  };
}

function stopScrub() {
  if (!state.scrubbing) return;

  // Compute final position before clearing state
  let finalMs = state.elapsedMs;
  if (_ffwSrc) {
    try {
      const effectiveSec = _ffwStartOffset + (state.audioCtx.currentTime - _ffwStartedAt) * SCRUB_RATE;
      finalMs = Math.min(state.totalDurationMs, Math.max(0, effectiveSec * 1000));
      _ffwSrc.stop();
    } catch (_) { /* already stopped */ }
    _ffwSrc = null;
  }
  if (_rewSrc) {
    try { _rewSrc.stop(); } catch (_) { /* already stopped */ }
    _rewSrc = null;
  }

  state.scrubbing = false;
  state.scrubDir = 0;

  if (_scrubTimer) {
    clearInterval(_scrubTimer);
    _scrubTimer = null;
  }

  state.elapsedMs = finalMs;
  state.sentenceIndex = getSentenceAtTime(state.elapsedMs);
  highlightSentence(state.sentenceIndex);
  updateProgress();
  setPlayIcon(false);
  $('#btnPlay').classList.add('primary');

  if (state.wasPlayingBeforeScrub) {
    const resumeMs = state.elapsedMs;
    stopSrcNode();
    setTimeout(() => seekToTime(resumeMs, true), 80);
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

console.log('[init] Wiring events. btnPlay:', !!$('#btnPlay'));

// Clone btnPlay to strip any stale listeners from HMR hot-reloads
{
  const oldBtn = $('#btnPlay');
  const newBtn = oldBtn.cloneNode(true);
  oldBtn.parentNode.replaceChild(newBtn, oldBtn);
}

$('#btnPlay').addEventListener('click', () => {
  console.log('[click] btnPlay fired. playing:', state.playing, 'paused:', state.paused, 'dictMode:', state.dictMode, 'inLapGap:', state.inLapGap);
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
  const bound = getSentenceMsBoundary(state.sentenceIndex);
  // If in the middle of current sentence, go to its beginning first
  if (state.elapsedMs > bound.startMs + 500) {
    seekToTime(bound.startMs, wasPlaying);
  } else {
    // Already at beginning, go to previous sentence
    const idx = Math.max(0, state.sentenceIndex - 1);
    if (idx !== state.sentenceIndex) {
      const prevBound = getSentenceMsBoundary(idx);
      seekToTime(prevBound.startMs, wasPlaying);
    }
  }
});
$('#btnNext').addEventListener('click', () => {
  const idx = Math.min(state.sentences.length - 1, state.sentenceIndex + 1);
  if (idx !== state.sentenceIndex) {
    const wasPlaying = state.playing && !state.paused;
    const bound = getSentenceMsBoundary(idx);
    seekToTime(bound.startMs, wasPlaying);
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

$('#btnToggleInput').addEventListener('click', () => {
  state.inputVisible = !state.inputVisible;
  const panel = $('#bottom-panel');
  const btn = $('#btnToggleInput');
  const main = $('#main-area');
  const barH = $('#controls-bar').getBoundingClientRect().height;
  if (state.inputVisible) {
    panel.classList.remove('hidden');
    main.style.gridTemplateRows = `1fr ${barH}px 1fr`;
    btn.textContent = 'Hide Input';
    btn.classList.add('primary');
  } else {
    panel.classList.add('hidden');
    main.style.gridTemplateRows = `1fr ${barH}px 0px`;
    btn.textContent = 'Type Here';
    btn.classList.remove('primary');
  }
});

// Re-entrancy guard: Safari can fire spurious change events when
// innerHTML is set on a <select>, which could cause infinite loops or
// revert to the wrong exercise during selector sync.
let _suppressSelectorEvents = false;

$('#examSelect').addEventListener('change', () => {
  if (_suppressSelectorEvents) return;
  _suppressSelectorEvents = true;
  updatePartSelect();
  loadExercise(+$('#exerciseSelect').value);
  _suppressSelectorEvents = false;
});

$('#partSelect').addEventListener('change', () => {
  if (_suppressSelectorEvents) return;
  _suppressSelectorEvents = true;
  updateExerciseSelect();
  loadExercise(+$('#exerciseSelect').value);
  _suppressSelectorEvents = false;
});

$('#exerciseSelect').addEventListener('change', () => {
  if (_suppressSelectorEvents) return;
  _suppressSelectorEvents = true;
  loadExercise(+$('#exerciseSelect').value);
  _suppressSelectorEvents = false;
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
    highlightSentence(state.sentenceIndex);
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
    thumb.style.transition = 'left 0.15s linear';
    applyPct(pctFromClientX(clientX));
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
    thumb.style.transition = 'left 0.15s linear';
    applyPct(pctFromClientX(e.changedTouches[0].clientX));
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
      const idx = Math.max(0, state.sentenceIndex - 1);
      if (idx !== state.sentenceIndex) state.sentenceIndex = idx;
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
    const bound = getSentenceMsBoundary(state.sentenceIndex);
    if (state.elapsedMs > bound.startMs + 500) {
      seekToTime(bound.startMs, wasPlaying);
    } else {
      const idx = Math.max(0, state.sentenceIndex - 1);
      if (idx !== state.sentenceIndex) {
        const prevBound = getSentenceMsBoundary(idx);
        seekToTime(prevBound.startMs, wasPlaying);
      }
    }
  } else if (key === 'e') {
    e.preventDefault();
    if (state.dictMode === 'programmed') return;
    const idx = Math.min(state.sentences.length - 1, state.sentenceIndex + 1);
    if (idx !== state.sentenceIndex) {
      const wasPlaying = state.playing && !state.paused;
      const bound = getSentenceMsBoundary(idx);
      seekToTime(bound.startMs, wasPlaying);
    }
  } else if (key === 'w') {
    e.preventDefault();
    if (state.dictMode === 'programmed') return;
    state.repeatMode = !state.repeatMode;
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
  rounded: '"SF Pro Rounded", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  sans:    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  serif:   'Georgia, "Times New Roman", serif',
  dyslexic:'"OpenDyslexic", "Comic Sans MS", cursive, sans-serif',
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
}

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

renderSelectors();
// Sync dictMode UI to match state. The id was changed from 'dictMode' to
// 'dictModeSelect' to prevent browser autofill from restoring a stale value
// across sessions (autofill matches by id/name).
$('#dictModeSelect').value = state.dictMode;
$('#programmedLaps').value = state.programmedLaps;
$('#programmedLaps').style.display = state.dictMode === 'programmed' ? '' : 'none';
// Initialize bottom panel as hidden
$('#bottom-panel').classList.add('hidden');
$('#main-area').style.gridTemplateRows = `1fr ${$('#controls-bar').getBoundingClientRect().height}px 0px`;
// ─── Startup ──────────────────────────────────────────────────────
// Show the overlay immediately so the user never sees a broken UI.
// loadExerciseAudio checks IndexedDB cache first — if hit, the overlay
// disappears near-instantly. On cache miss, init + synthesis run
// behind the overlay.

state.loadingMessage = 'Loading…';
showLoadingOverlay();
document.querySelector('.loading-bar-fill')?.classList.add('indeterminate');
loadExercise(7);
