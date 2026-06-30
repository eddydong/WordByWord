//#region src/worker/process-piper-synthesis.worker.ts
var e = null, t = null, n = null, r = null, i = -1, a = "CPU", o = "", s = 0, c = -1, l = null, u = () => `[PiperWorker:${i}:${a}]`, d = !1;
function f(e, t) {
	self.postMessage({
		type: "log",
		payload: {
			level: e,
			message: t,
			workerId: i,
			timestamp: Date.now()
		}
	});
}
var p = (e, ...t) => {
	let n = `${u()} ${e}`;
	d && console.log(n, ...t), f("info", e + (t.length ? " " + JSON.stringify(t) : ""));
}, m = (e, ...t) => {
	let n = `${u()} ${e}`;
	d && console.warn(n, ...t), f("warn", e + (t.length ? " " + JSON.stringify(t) : ""));
}, h = (e, ...t) => {
	let n = `${u()} ${e}`;
	d && console.error(n, ...t), f("error", e + (t.length ? " " + JSON.stringify(t) : ""));
};
self.onmessage = async (e) => {
	let t = e.data;
	try {
		switch (t.type) {
			case "init":
				c = t.configCounter, await y(t.config);
				break;
			case "load-callback":
				c = t.configCounter, await b(t.useCallback);
				break;
			case "synthesize":
				await x(t.text, t.requestId, {
					speed: t.speed,
					volume: t.volume,
					speakerId: t.speakerId
				});
				break;
		}
	} catch (e) {
		let n = O(e);
		h("Uncaught worker error:", n), D({
			type: "error",
			instanceId: i,
			error: n,
			originalRequest: t
		});
	}
};
var g = `${new URL("../../", self.location.href).href}piper-gate/`, _ = {
	wasm: `${g}infra/`,
	mjs: `${g}infra/ort.wasm.min.mjs`
}, v = {
	piperData: `${g}infra/piper_phonemize.data`,
	piperJs: `${g}infra/piper_phonemize.js`,
	piperWasm: `${g}infra/piper_phonemize.wasm`
};
async function y(n) {
	let { modelId: a, instanceId: l, useCallback: u, defaultSpeakerId: f, debug: m } = n;
	i = l || 0, o = a, s = f || 0, d = m ?? !1, p(`=== INIT START [${a}] ===`, {
		useCallback: u,
		defaultSpeakerId: s
	});
	try {
		let n = await fetch(`${g}voices/${a}.onnx.json`);
		if (!n.ok) throw Error(`Failed to fetch model config: ${n.statusText}`);
		let o = await n.text();
		r = JSON.parse(o);
		let s = await fetch(`${g}voices/${a}.onnx`);
		if (!s.ok) throw Error(`Failed to fetch model: ${s.statusText}`);
		let l = await s.arrayBuffer(), d = await fetch(_.mjs);
		if (!d.ok) throw Error(`Failed to fetch ORT glue: ${d.statusText}`);
		await d.text();
		let f = await import(
			/* @vite-ignore */
			_.mjs
);
		if (t = f.default || f, !t || !t.env) throw Error("Invalid ONNX Runtime module: 'env' is missing. Check if the .mjs URL is correct.");
		t.env.wasm.wasmPaths = _.wasm, t.env.wasm.numThreads = 1, e = await t.InferenceSession.create(l, {
			executionProviders: ["wasm"],
			graphOptimizationLevel: "all"
		}), await C(v), u && await b(!0), p("=== INIT COMPLETE ==="), D({
			type: "ready",
			instanceId: i,
			configCounter: c
		});
	} catch (e) {
		let t = e instanceof Error ? e : Error(String(e));
		throw h("Init failed:", t.message), t;
	}
}
async function b(e) {
	if (!e) {
		l &&= (p("Callback disabled via surgical toggle"), null), D({
			type: "callback-off",
			instanceId: i,
			configCounter: c
		});
		return;
	}
	let t = new URL("./piper-callback.js", self.location.href).href;
	p(`Loading synthesis callback: ${t}`);
	try {
		let e = await fetch(t);
		if (!e.ok) {
			let t = await e.text().catch(() => e.statusText);
			throw Error(`Gateway Error (${e.status}): ${t}`);
		}
		if (l = (await import(
			/* @vite-ignore */
			t
)).onSynthesisComplete, typeof l != "function") throw Error(`Export 'onSynthesisComplete' is not a function in ${t}`);
		p("Synthesis callback loaded successfully"), D({
			type: "callback-on",
			instanceId: i,
			configCounter: c
		});
	} catch (e) {
		l = null;
		let t = e instanceof Error ? e.message : String(e);
		throw h("Failed to load synthesis callback module:", t), D({
			type: "callback-failed",
			instanceId: i,
			error: t
		}), e;
	}
}
async function x(a, s, c) {
	if (!e || !t || !n || !r) throw Error("Worker not initialized");
	let u = performance.now(), { phonemeIds: d, phonemes: f } = w(a, r.espeak.voice), p = E(c.speakerId, r), { audio: m, durations: g } = await T(t, d, c, p);
	if (!g || g.length === 0) throw Error("Durations missing from inference results. Ensure the model is patched to export durations tensor.");
	let _ = 256 / r.audio.sample_rate * 1e3;
	for (let e = 0; e < g.length; e++) g[e] *= _;
	let v = c.volume ?? 1;
	if (v !== 1) for (let e = 0; e < m.length; e++) m[e] *= v;
	let y = m.length / r.audio.sample_rate * 1e3, b = performance.now() - u, x = {
		requestId: s,
		audioData: m,
		sampleRate: r.audio.sample_rate,
		durationMs: y,
		metadata: {
			generationTimeMs: b,
			modelId: o,
			speakerId: p,
			phonemeIds: d,
			phonemes: f,
			durations: g,
			totalAudioDurationMs: y,
			sampleRate: r.audio.sample_rate,
			hopSize: 256
		}
	}, S;
	if (l) try {
		S = await l(x);
	} catch (e) {
		let t = e instanceof Error ? e : Error(String(e));
		throw h(`Callback execution failed: ${t.message}`), Error(`User callback '${o}' failed: ${t.message}`);
	}
	let C = [m.buffer, ...k(S)];
	D({
		type: "success",
		instanceId: i,
		requestId: s,
		result: x,
		callbackResult: S
	}, { transfer: C });
}
var S = null;
async function C(e) {
	let t = e.piperJs, r = await fetch(t);
	if (!r.ok) throw Error(`Failed to fetch phonemizer glue: ${r.statusText}`);
	let i = await r.text();
	n = await Function(i + "; return createPiperPhonemize;")()({
		locateFile: (t) => t.endsWith(".wasm") ? e.piperWasm : t.endsWith(".data") ? e.piperData : t,
		print: (e) => {
			try {
				S = JSON.parse(e);
			} catch {}
		}
	});
}
function w(e, t) {
	let r = JSON.stringify([{ text: e.trim() }]);
	if (S = null, n?.callMain([
		"-l",
		t,
		"--input",
		r,
		"--espeak_data",
		"/espeak-ng-data"
	]), S && S.phoneme_ids !== void 0) {
		let e = S;
		return {
			phonemeIds: e.phoneme_ids,
			phonemes: e.phonemes
		};
	}
	throw Error("Phonemization failed");
}
async function T(t, n, i, a) {
	let { noise_scale: o, length_scale: s, noise_w: c } = r.inference, l = {
		input: new t.Tensor("int64", BigInt64Array.from(n.map(BigInt)), [1, n.length]),
		input_lengths: new t.Tensor("int64", BigInt64Array.from([BigInt(n.length)])),
		scales: new t.Tensor("float32", new Float32Array([
			o,
			i.speed ? s / i.speed : s,
			c
		]))
	};
	Object.keys(r.speaker_id_map).length > 0 && (l.sid = new t.Tensor("int64", BigInt64Array.from([BigInt(a)])));
	let u = await e.run(l);
	return {
		audio: u.output.data,
		durations: u.durations ? u.durations.data : null
	};
}
function E(e, t) {
	let n = Object.keys(t.speaker_id_map).length;
	if (n === 0) return 0;
	let r = e ?? s;
	return r < 0 || r >= n ? (m(`speakerId ${r} out of range (0-${n - 1}), falling back to 0`), 0) : r;
}
function D(e, t) {
	self.postMessage(e, t);
}
function O(e) {
	if (typeof e == "string") return e;
	let t = e instanceof Error ? e.message : String(e);
	if (e && typeof e == "object" && "originalRequest" in e) try {
		let n = { ...e.originalRequest };
		return "text" in n && (n.text = "[REDACTED]"), `${t} (Request: ${JSON.stringify(n)})`;
	} catch {
		return t;
	}
	return t;
}
//#endregion
//#region src/worker/index.ts
function k(e) {
	let t = [];
	function n(e) {
		if (e) {
			if (e instanceof ArrayBuffer) t.push(e);
			else if (ArrayBuffer.isView(e)) t.push(e.buffer);
			else if (typeof e == "object") for (let t in e) n(e[t]);
		}
	}
	return n(e), t;
}
//#endregion
export { k as collectTransferables, x as processPiperSynthesis, y as setupPiperWorker };
