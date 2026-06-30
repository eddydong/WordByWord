async function e(e, n) {
	let r = new t(e.url, e.status, e.headers.get("X-Request-Id") ?? n?.requestId);
	r.message = `Api error with status ${r.statusCode}${n?.message ? `. ${n.message}` : ""}`;
	let i = [`URL: ${r.url}`, r.requestId ? `Request ID: ${r.requestId}` : void 0].filter(Boolean).join(". ");
	if (e.headers.get("Content-Type")?.startsWith("application/json")) {
		let t = await e.json();
		r.message = t.error || t.message || r.message, t.error_description && (r.message = r.message ? r.message + `: ${t.error_description}` : t.error_description), r.data = t;
	} else r.data = { message: await e.text() };
	throw r.message += `. ${i}`, r;
}
var t = class extends Error {
	statusCode;
	url;
	requestId;
	data;
	constructor(e, t, n, r) {
		super(r), this.statusCode = t, this.requestId = n, this.url = e;
	}
}, n = class extends Error {};
function r(e) {
	if (!e.startsWith("hf_")) throw TypeError("Your access token must start with 'hf_'");
}
function i(e) {
	if (e.accessToken) return r(e.accessToken), e.accessToken;
	if (e.credentials?.accessToken) return r(e.credentials.accessToken), e.credentials.accessToken;
}
function a(e) {
	if (typeof e != "string") return e;
	if (e.startsWith("model/") || e.startsWith("models/")) throw TypeError("A repo designation for a model should not start with 'models/', directly specify the model namespace / name");
	if (e.startsWith("space/")) throw TypeError("Spaces should start with 'spaces/', plural, not 'space/'");
	if (e.startsWith("dataset/")) throw TypeError("Datasets should start with 'datasets/', plural, not 'dataset/'");
	if (e.startsWith("bucket/")) throw TypeError("Buckets should start with 'buckets/', plural, not 'bucket/'");
	let t = e.split("/").length - 1;
	if (e.startsWith("spaces/")) {
		if (t !== 2) throw TypeError("Space Id must include namespace and name of the space");
		return {
			type: "space",
			name: e.slice(7)
		};
	}
	if (e.startsWith("datasets/")) {
		if (t > 2) throw TypeError("Too many slashes in repo designation: " + e);
		return {
			type: "dataset",
			name: e.slice(9)
		};
	}
	if (e.startsWith("buckets/")) {
		if (t !== 2) throw TypeError("Bucket Id must include namespace and name of the bucket");
		return {
			type: "bucket",
			name: e.slice(8)
		};
	}
	if (t > 1) throw TypeError("Too many slashes in repo designation: " + e);
	return {
		type: "model",
		name: e
	};
}
typeof window < "u" && window.document, typeof self == "object" && self.constructor && self.constructor.name, new Promise((e) => {});
var o = class extends Blob {
	static async create(e, t) {
		let n = t?.fetch ?? fetch, r = await n(e, {
			method: "HEAD",
			...t?.accessToken && { headers: { Authorization: `Bearer ${t.accessToken}` } }
		}), i = Number(r.headers.get("content-length")), a = r.headers.get("content-type") || "";
		return r.headers.get("accept-ranges") !== "bytes" || i < (t?.cacheBelow ?? 1e6) ? await (await n(e)).blob() : new o(e, 0, i, a, !0, n, t?.accessToken);
	}
	url;
	start;
	end;
	contentType;
	full;
	fetch;
	accessToken;
	constructor(e, t, n, r, i, a, o) {
		super([]), this.url = e, this.start = t, this.end = n, this.contentType = r, this.full = i, this.fetch = a, this.accessToken = o;
	}
	get size() {
		return this.end - this.start;
	}
	get type() {
		return this.contentType;
	}
	slice(e = 0, t = this.size) {
		return new o(this.url, this.start + e, Math.min(this.start + t, this.end), this.contentType, e === 0 && t === this.size ? this.full : !1, this.fetch, this.accessToken);
	}
	async arrayBuffer() {
		return (await this.fetchRange()).arrayBuffer();
	}
	async text() {
		return (await this.fetchRange()).text();
	}
	stream() {
		let e = new TransformStream();
		return this.fetchRange().then((t) => t.body?.pipeThrough(e)).catch((t) => e.writable.abort(t.message)), e.readable;
	}
	fetchRange() {
		let t = this.fetch;
		return this.full ? t(this.url, { ...this.accessToken && { headers: { Authorization: `Bearer ${this.accessToken}` } } }).then((t) => t.ok ? t : e(t)) : t(this.url, { headers: {
			Range: `bytes=${this.start}-${this.end - 1}`,
			...this.accessToken && { Authorization: `Bearer ${this.accessToken}` }
		} }).then((t) => t.ok ? t : e(t));
	}
};
function s(e, t) {
	let n = e.length, r = new Uint8Array(n + t.length);
	return r.set(e), r.set(t, n), r;
}
function c(e, t) {
	let n = 0;
	return n |= e[t++] << 0, n |= e[t++] << 8, n |= e[t++] << 16, n |= e[t++] << 24, n |= e[t++] << 32, n |= e[t++] << 40, n |= e[t++] << 48, n |= e[t++] << 56, n;
}
function l(e, t) {
	let n = 0;
	return n |= e[t++] << 0, n |= e[t++] << 8, n |= e[t++] << 16, n |= e[t++] << 24, n;
}
var u = 4, d = 65536;
C(5 << 20), S();
var f = 407708164, p = 4, m = 8, h = 16, g = 64, _ = 192, v = 2147483648, y = 4, b = 7, x = {
	4: 65536,
	5: 262144,
	6: 1048576,
	7: 4194304
};
function S() {
	try {
		return new Uint32Array(d);
	} catch {
		let e = Array(d);
		for (let t = 0; t < d; t++) e[t] = 0;
		return e;
	}
}
function C(e) {
	return new Uint8Array(e);
}
function ee(e, t, n) {
	return e.slice(t, n);
}
function w(e) {
	let t = 0;
	if (l(e, t) !== f) throw Error("invalid magic number");
	t += 4;
	let n = e[t++];
	if ((n & _) !== g) throw Error("incompatible descriptor version " + (n & _));
	let r = (n & h) !== 0, i = (n & m) !== 0, a = e[t++] >> y & b;
	if (x[a] === void 0) throw Error("invalid block size " + a);
	let o = x[a];
	if (i) return c(e, t);
	t++;
	let s = 0;
	for (;;) {
		let n = l(e, t);
		if (t += 4, n & v ? (n &= ~v, s += n) : n > 0 && (s += o), n === 0) return s;
		r && (t += 4), t += n;
	}
}
function te(e, t, n, r, i) {
	let a, o, s, c, l, d = t.copyWithin !== void 0 && t.fill !== void 0;
	for (s = n + r; n < s;) {
		let r = e[n++], f = r >> 4;
		if (f > 0) {
			if (f === 15) for (; f += e[n], e[n++] === 255;);
			for (c = n + f; n < c;) t[i++] = e[n++];
		}
		if (n >= s) break;
		if (a = r & 15, o = e[n++] | e[n++] << 8, a === 15) for (; a += e[n], e[n++] === 255;);
		if (a += u, d && o === 1) t.fill(t[i - 1] | 0, i, i + a), i += a;
		else if (d && o > a && a > 31) t.copyWithin(i, i - o, i - o + a), i += a;
		else for (l = i - o, c = l + a; l < c;) t[i++] = t[l++] | 0;
	}
	return i;
}
function ne(e, t) {
	let n, r, i, a, o = 0, s = 0;
	if (l(e, o) !== f) throw Error("invalid magic number");
	if (o += 4, a = e[o++], (a & _) !== g) throw Error("incompatible descriptor version");
	if (n = (a & h) !== 0, r = (a & p) !== 0, i = (a & m) !== 0, x[e[o++] >> y & b] === void 0) throw Error("invalid block size");
	for (i && (o += 8), o++;;) {
		var c = l(e, o);
		if (o += 4, c === 0) break;
		if (n && (o += 4), (c & v) !== 0) {
			c &= ~v;
			for (let n = 0; n < c; n++) t[s++] = e[o++];
		} else s = te(e, t, o, c, s), o += c;
	}
	return r && (o += 4), s;
}
function T(e, t) {
	let n, r;
	return t === void 0 && (t = w(e)), n = C(t), r = ne(e, n), r !== t && (n = ee(n, 0, r)), n;
}
var re = class {
	ranges = [];
	add(e, t) {
		if (t <= e) throw TypeError("End must be greater than start");
		let n = [];
		for (let r = 0; r < this.ranges.length; r++) {
			let i = this.ranges[r];
			if (e < i.end && t > i.start && n.push({
				index: r,
				range: i
			}), i.data !== null) throw Error("Overlapping range already has data");
		}
		if (n.length === 0) {
			this.ranges.push({
				start: e,
				end: t,
				refCount: 1,
				data: null
			}), this.ranges.sort((e, t) => e.start - t.start);
			return;
		}
		let r = [], i = e;
		for (let e = 0; e < n.length; e++) {
			let { range: a } = n[e];
			i < a.start ? r.push({
				start: i,
				end: a.start,
				refCount: 1,
				data: null
			}) : a.start < i && r.push({
				start: a.start,
				end: i,
				refCount: a.refCount,
				data: null
			}), r.push({
				start: Math.max(i, a.start),
				end: Math.min(t, a.end),
				refCount: a.refCount + 1,
				data: null
			}), a.end > t && r.push({
				start: t,
				end: a.end,
				refCount: a.refCount,
				data: null
			}), i = Math.max(i, a.end);
		}
		i < t && r.push({
			start: i,
			end: t,
			refCount: 1,
			data: null
		});
		let a = n[0].index, o = n[n.length - 1].index;
		this.ranges.splice(a, o - a + 1, ...r), this.ranges.sort((e, t) => e.start - t.start);
	}
	remove(e, t) {
		if (t <= e) throw TypeError("End must be greater than start");
		let n = [];
		for (let r = 0; r < this.ranges.length; r++) {
			let i = this.ranges[r];
			e < i.end && t > i.start && n.push({
				index: r,
				range: i
			});
		}
		if (n.length === 0) throw Error("No ranges found to remove");
		if (e !== n[0].range.start || t !== n[n.length - 1].range.end) throw Error("Range boundaries must match existing boundaries");
		for (let e = 0; e < n.length; e++) {
			let { range: t } = n[e];
			t.refCount--;
		}
		this.ranges = this.ranges.filter((e) => e.refCount > 0);
	}
	getRanges(e, t) {
		if (t <= e) throw TypeError("End must be greater than start");
		return this.ranges.filter((n) => e < n.end && t > n.start);
	}
	getAllRanges() {
		return [...this.ranges];
	}
}, E = 6e4, ie = 1e3, ae = {
	0: "None",
	1: "LZ4",
	2: "ByteGroupingLZ4"
}, D = 8, O = class extends Blob {
	fetch;
	accessToken;
	refreshUrl;
	reconstructionUrl;
	hash;
	start = 0;
	end = 0;
	internalLogging = !1;
	reconstructionInfo;
	listener;
	constructor(e) {
		if (super([]), this.fetch = e.fetch ?? fetch.bind(globalThis), this.accessToken = i(e), this.refreshUrl = e.refreshUrl, this.end = e.size, this.reconstructionUrl = e.reconstructionUrl, this.hash = e.hash, this.listener = e.listener, this.internalLogging = e.internalLogging ?? !1, e.readToken) {
			let t = j({
				refreshUrl: this.refreshUrl,
				initialAccessToken: this.accessToken
			});
			A.set(t, {
				accessToken: e.readToken.accessToken,
				expiresAt: /* @__PURE__ */ new Date(e.readToken.exp * 1e3),
				casUrl: e.readToken.casUrl
			});
		}
	}
	get size() {
		return this.end - this.start;
	}
	#e() {
		let e = new O({
			fetch: this.fetch,
			hash: this.hash,
			refreshUrl: this.refreshUrl,
			reconstructionUrl: this.reconstructionUrl,
			size: this.size
		});
		return e.accessToken = this.accessToken, e.start = this.start, e.end = this.end, e.reconstructionInfo = this.reconstructionInfo, e.listener = this.listener, e.internalLogging = this.internalLogging, e;
	}
	slice(e = 0, t = this.size) {
		let n = this.#e();
		return n.start = this.start + e, n.end = Math.min(this.start + t, this.end), (n.start !== this.start || n.end !== this.end) && (n.reconstructionInfo = void 0), n;
	}
	#t;
	#n() {
		return this.#t ||= (async () => {
			let t = await M(this.accessToken, this.fetch, this.refreshUrl), n = await this.fetch(this.reconstructionUrl ?? `${t.casUrl}/v1/reconstructions/${this.hash}`, { headers: {
				Authorization: `Bearer ${t.accessToken}`,
				Range: `bytes=${this.start}-${this.end - 1}`
			} });
			if (!n.ok) throw await e(n);
			return this.reconstructionInfo = await n.json(), this.reconstructionInfo;
		})().finally(() => this.#t = void 0), this.#t;
	}
	async #r() {
		if (this.size === 0) return new ReadableStream({ start(e) {
			e.close();
		} });
		this.reconstructionInfo || await this.#n();
		let t = /* @__PURE__ */ new Map();
		if (!this.reconstructionInfo) throw Error("Failed to load reconstruction info");
		for (let e of this.reconstructionInfo.terms) {
			let n = t.get(e.hash);
			n || (n = new re(), t.set(e.hash, n)), n.add(e.range.start, e.range.end);
		}
		let n = this.listener, r = this.internalLogging ? (...e) => console.log(...e) : () => {};
		async function* i(i, a, o, c) {
			let l = 0, u = i.offset_into_first_range;
			for (let d of i.terms) {
				if (l >= o) break;
				let f = t.get(d.hash);
				if (!f) throw Error(`Failed to find range list for term ${d.hash}`);
				{
					let e = f.getRanges(d.range.start, d.range.end);
					if (e.every((e) => e.data)) {
						r("all data available for term", d.hash, u);
						rangeLoop: for (let t of e) for (let e of t.data) {
							if (u) {
								let t = Math.min(u, e.byteLength);
								if (e = e.slice(t), u -= t, !e.byteLength) continue;
							}
							if (e.byteLength > o - l && (e = e.slice(0, o - l)), l += e.byteLength, yield t.refCount > 1 ? e.slice() : e, n?.({
								event: "progress",
								progress: {
									read: l,
									total: o
								}
							}), l >= o) break rangeLoop;
						}
						f.remove(d.range.start, d.range.end);
						continue;
					}
				}
				let p = i.fetch_info[d.hash].find((e) => e.range.start <= d.range.start && e.range.end >= d.range.end);
				if (!p) throw Error(`Failed to find fetch info for term ${d.hash} and range ${d.range.start}-${d.range.end}`);
				r("term", d), r("fetchinfo", p), r("readBytesToSkip", u);
				let m = await a(p.url, { headers: { Range: `bytes=${p.url_range.start}-${p.url_range.end}` } });
				if (m.status === 403 && (i = await c(), m = await a(p.url, { headers: { Range: `bytes=${p.url_range.start}-${p.url_range.end}` } })), !m.ok) throw await e(m);
				r("expected content length", m.headers.get("content-length"), "range", p.url_range, m.headers.get("content-range"));
				let h = m.body?.getReader();
				if (!h) throw Error("Failed to get reader from response body");
				let g = !1, _ = p.range.start, v = f.getRanges(p.range.start, p.range.end), y, b = 0;
				fetchData: for (; !g && l < o;) {
					let e = await h.read();
					if (n?.({ event: "read" }), g = e.done, r("read", e.value?.byteLength, "bytes", "total read", l, "toSkip", u), !e.value) {
						r("no data in result, cancelled", e);
						continue;
					}
					for (b += e.value.byteLength, y &&= (e.value = s(y, e.value), void 0); l < o && e.value?.byteLength;) {
						if (e.value.byteLength < 8) {
							y = e.value;
							continue fetchData;
						}
						let t = new DataView(e.value.buffer, e.value.byteOffset, D), i = {
							version: t.getUint8(0),
							compressed_length: t.getUint8(1) | t.getUint8(2) << 8 | t.getUint8(3) << 16,
							compression_scheme: t.getUint8(4),
							uncompressed_length: t.getUint8(5) | t.getUint8(6) << 8 | t.getUint8(7) << 16
						};
						if (r("chunk header", i, "to skip", u), i.version !== 0) throw Error(`Unsupported chunk version ${i.version}`);
						if (i.compression_scheme !== 0 && i.compression_scheme !== 1 && i.compression_scheme !== 2) throw Error(`Unsupported compression scheme ${ae[i.compression_scheme] ?? i.compression_scheme}`);
						if (e.value.byteLength < i.compressed_length + D) {
							y = e.value;
							continue fetchData;
						}
						e.value = e.value.slice(D);
						let a = i.compression_scheme === 1 ? T(e.value.slice(0, i.compressed_length), i.uncompressed_length) : i.compression_scheme === 2 ? oe(T(e.value.slice(0, i.compressed_length), i.uncompressed_length)) : e.value.slice(0, i.compressed_length), s = v.find((e) => _ >= e.start && _ < e.end), c = _ >= d.range.start && _ < d.range.end, f = c ? 2 : 1, p = !1;
						if (s && s.refCount >= f && (s.data ??= [], s.data.push(a), p = !0), c) {
							if (u) {
								let e = Math.min(u, a.byteLength);
								a = a.slice(u), u -= e;
							}
							a.byteLength > o - l && (a = a.slice(0, o - l)), a.byteLength && (r("yield", a.byteLength, "bytes", e.value.byteLength, "total read", l, p), l += a.byteLength, yield p ? a.slice() : a, n?.({
								event: "progress",
								progress: {
									read: l,
									total: o
								}
							}));
						}
						_++, e.value = e.value.slice(i.compressed_length);
					}
				}
				if (g && l < o && b < p.url_range.end - p.url_range.start + 1) throw r("done", g, "total read", l, o, b), r("failed to fetch all data for term", d.hash), Error(`Failed to fetch all data for term ${d.hash}, fetched ${b} bytes out of ${p.url_range.end - p.url_range.start + 1}`);
				r("done", g, "total read", l, o, b), r("cancel reader"), await h.cancel();
			}
		}
		let a = i(this.reconstructionInfo, this.fetch, this.end - this.start, this.#n.bind(this));
		return new ReadableStream({
			async pull(e) {
				let t = await a.next();
				t.value && e.enqueue(t.value), t.done && e.close();
			},
			type: "bytes"
		}, { highWaterMark: 1e3 });
	}
	async arrayBuffer() {
		let e = await this.#r();
		return new Response(e).arrayBuffer();
	}
	async text() {
		let e = await this.#r();
		return new Response(e).text();
	}
	async response() {
		let e = await this.#r();
		return new Response(e);
	}
	stream() {
		let e = new TransformStream();
		return this.#r().then((t) => t.pipeThrough(e)).catch((t) => e.writable.abort(t.message)), e.readable;
	}
}, k = /* @__PURE__ */ new Map(), A = /* @__PURE__ */ new Map();
function j(e) {
	return JSON.stringify([e.refreshUrl, e.initialAccessToken]);
}
function oe(e) {
	let t = Math.floor(e.byteLength / 4), n = e.byteLength % 4, r = t + +(n >= 1), i = r + t + +(n >= 2), a = i + t + +(n == 3), o = new Uint8Array(e.byteLength);
	for (let t = 0, n = 0; t < e.byteLength; t += 4, n++) o[t] = e[n];
	for (let t = 1, n = r; t < e.byteLength; t += 4, n++) o[t] = e[n];
	for (let t = 2, n = i; t < e.byteLength; t += 4, n++) o[t] = e[n];
	for (let t = 3, n = a; t < e.byteLength; t += 4, n++) o[t] = e[n];
	return o;
}
async function M(e, t, n) {
	let r = j({
		refreshUrl: n,
		initialAccessToken: e
	}), i = A.get(r);
	if (i && i.expiresAt > new Date(Date.now() + E)) return {
		accessToken: i.accessToken,
		casUrl: i.casUrl
	};
	let a = k.get(r);
	if (a) return a;
	let o = (async () => {
		let i = await t(n, { headers: { ...e ? { Authorization: `Bearer ${e}` } : {} } });
		if (!i.ok) throw Error(`Failed to get JWT token: ${i.status} ${await i.text()}`);
		let a = await i.json(), o = {
			accessToken: a.accessToken,
			expiresAt: /* @__PURE__ */ new Date(a.exp * 1e3),
			casUrl: a.casUrl
		};
		k.delete(r);
		for (let [e, t] of A.entries()) if (t.expiresAt < new Date(Date.now() + E)) A.delete(e);
		else break;
		if (A.size >= ie) {
			let e = A.keys().next().value;
			e && A.delete(e);
		}
		return A.set(r, o), {
			accessToken: a.accessToken,
			casUrl: a.casUrl
		};
	})();
	return k.set(r, o), o;
}
"ff".repeat(32), new Uint8Array([
	72,
	70,
	82,
	101,
	112,
	111,
	77,
	101,
	116,
	97,
	68,
	97,
	116,
	97,
	0,
	85,
	105,
	103,
	69,
	106,
	123,
	129,
	87,
	131,
	165,
	189,
	217,
	92,
	205,
	209,
	74,
	169
]);
function se(e) {
	return Object.fromEntries([...e.matchAll(/<(https?:[/][/][^>]+)>;\s+rel="([^"]+)"/g)].map(([, e, t]) => [t, e]));
}
async function ce(t) {
	let r = i(t), o = a(t.repo), s = t.hubUrl ?? "https://huggingface.co", c = o.type === "bucket" ? void 0 : t.revision ?? "main", l = `${s}/${o.type === "model" ? "" : `${o.type}s/`}${o.name}/${t.raw ? "raw" : "resolve"}${c ? `/${encodeURIComponent(c)}` : ""}/${t.path}` + (t.noContentDisposition ? "?noContentDisposition=1" : ""), u = await (t.fetch ?? fetch)(l, {
		method: "GET",
		headers: {
			...r && { Authorization: `Bearer ${r}` },
			Range: "bytes=0-0",
			Accept: "application/vnd.xet-fileinfo+json, */*"
		}
	});
	if (u.status === 404 && u.headers.get("X-Error-Code") === "EntryNotFound") return null;
	if (!u.ok) throw await e(u);
	let d, f;
	if (u.headers.get("Content-Type")?.includes("application/vnd.xet-fileinfo+json")) {
		if (d = parseInt(u.headers.get("X-Linked-Size") ?? "invalid"), isNaN(d)) throw new n("Invalid file size received in X-Linked-Size header");
		let e = u.headers.get("X-Xet-Hash"), t = se(u.headers.get("Link") ?? ""), r = (() => {
			try {
				return new URL(t["xet-reconstruction-info"]);
			} catch {
				return null;
			}
		})(), i = (() => {
			try {
				return new URL(t["xet-auth"]);
			} catch {
				return null;
			}
		})();
		if (!e) throw new n("No hash received in X-Xet-Hash header");
		if (!r || !i) throw new n("No xet-reconstruction-info or xet-auth link header");
		f = {
			hash: e,
			refreshUrl: i,
			reconstructionUrl: r
		};
	}
	if (d === void 0 || isNaN(d)) {
		let e = u.headers.get("content-range");
		if (!e) throw new n("Expected size information");
		let [, t] = e.split("/");
		if (d = parseInt(t), isNaN(d)) throw new n("Invalid file size received");
	}
	let p = u.headers.get("X-Linked-ETag") ?? u.headers.get("ETag") ?? void 0;
	if (!p) throw new n("Expected ETag");
	return {
		etag: p,
		size: d,
		xet: f,
		url: u.url && (new URL(u.url).origin === new URL(s).origin || u.headers.get("X-Cache")?.endsWith(" cloudfront")) ? u.url : l
	};
}
async function le(e) {
	let t = i(e), n = e.downloadInfo ?? await ce({
		accessToken: t,
		repo: e.repo,
		path: e.path,
		revision: e.revision,
		hubUrl: e.hubUrl,
		fetch: e.fetch,
		raw: e.raw
	});
	return n ? n.xet && e.xet !== !1 ? new O({
		refreshUrl: n.xet.refreshUrl.href,
		reconstructionUrl: n.xet.reconstructionUrl.href,
		fetch: e.fetch,
		accessToken: t,
		size: n.size,
		readToken: typeof e.xet == "object" ? e.xet.readToken : void 0
	}) : new o(new URL(n.url), 0, n.size, "", !0, e.fetch ?? fetch, t) : null;
}
//#endregion
//#region src/control-asset-sw.ts
var N = self, P = `${N.location.pathname.substring(0, N.location.pathname.lastIndexOf("/") + 1)}piper-gate/`;
async function ue(e) {
	let t = await crypto.subtle.digest("SHA-256", e);
	return Array.from(new Uint8Array(t)).map((e) => e.toString(16).padStart(2, "0")).join("");
}
async function F(e, t) {
	return (await ue(e)).toLowerCase() === t.toLowerCase();
}
var I = "infra", L = "voices", R = "270aa371f9f528df0363f012b8d878267bf41531ff0a6008fb26e552dceec654", z = "64fe111b343e21a537018c3bbfbff70917f4cb39ced6242cd7d35e4f166985d7", B = !1, V = new BroadcastChannel("piper-gate-debug");
V.onmessage = (e) => {
	B = e.data.debug;
}, N.addEventListener("message", (e) => {
	e.data && e.data.type === "CLAIM" && N.clients.claim();
});
function H(e, t, ...n) {
	!B && e === "log" || console[e](t, ...n);
}
var U = {
	"ort-wasm-simd-threaded.wasm": "be0e129949062ad50290ef94683fac8be5bb6156f709e030b7a5f1661a2f6c17",
	"ort.wasm.min.mjs": "d5a6d7bc8ee587648fb3742dde8c0094d17cbd3822a68bbec8ddfcd4f2adb88e",
	"ort-wasm-simd-threaded.mjs": "5687566b1bc1c8cf628d76c2ddb16b2a3b81a7997273d4666564880495088e57",
	"piper_phonemize.data": "29f1025eb23a5b5c192cd14a6efbce4509402ff265405072ee6f7d1a09b78f8c",
	"piper_phonemize.js": "fef0c2fc442d24fdef5c7c7cc37d5da2314407640fe11ab1bfe347c723dff19b",
	"piper_phonemize.wasm": "b777cd107a91d2bcc6a1ea46f2c26a662a7407394fe84589198aeaa83dd7a9d6",
	"process-piper-synthesis.worker.js": z,
	"piper-model-cards.json": R,
	"piper-callback.js": ""
}, de = {
	"ort-wasm-simd-threaded.wasm": "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/ort-wasm-simd-threaded.wasm",
	"ort.wasm.min.mjs": "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/ort.wasm.min.mjs",
	"ort-wasm-simd-threaded.mjs": "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/ort-wasm-simd-threaded.mjs",
	"piper_phonemize.data": "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data",
	"piper_phonemize.js": "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.js",
	"piper_phonemize.wasm": "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm"
}, W = /* @__PURE__ */ new Map(), G = /* @__PURE__ */ new Map(), K = !1, q = null;
async function fe() {
	if (!K) return q || (q = (async () => {
		let e = await Y("piper-model-cards.json");
		if (!e.ok) throw Error(`[piper-gate] Index resolution failed: ${e.status} ${await e.text()}`);
		let t = await e.arrayBuffer(), n = JSON.parse(new TextDecoder().decode(t));
		for (let e of n) W.set(e.id, {
			onnx: e.modelSha256,
			config: e.configSha256
		}), G.set(e.id, {
			onnx: e.modelUrl,
			config: e.configUrl
		});
		K = !0, H("log", `[piper-gate] Model cards verified and registries populated: ${n.length} models.`);
	})(), q.catch(() => {
		q = null;
	}), q);
}
var pe = {
	".wasm": "application/wasm",
	".mjs": "text/javascript",
	".js": "text/javascript",
	".data": "application/octet-stream",
	".onnx": "application/octet-stream",
	".json": "application/json"
}, J = new BroadcastChannel("piper-download-progress");
function me(e, t) {
	let n = t instanceof Error;
	J.postMessage({
		type: "error",
		filename: e,
		message: n ? t.message : String(t),
		stack: n ? t.stack : void 0,
		code: n ? t.name : "UNKNOWN_ERROR"
	});
}
function he(e) {
	return !!(e in U || e.endsWith(".onnx") || e.endsWith(".onnx.json"));
}
N.addEventListener("install", () => {
	N.skipWaiting();
}), N.addEventListener("activate", (e) => {
	e.waitUntil(N.clients.claim());
}), N.addEventListener("fetch", (e) => {
	let t = new URL(e.request.url);
	if (t.origin === N.location.origin && !t.pathname.startsWith(P)) {
		let e = t.pathname.split("/").pop() || "";
		he(e) && H("warn", `[piper-gate] [Path Deviation] Detected request for Piper asset '${e}' at non-gateway path: ${t.pathname}. This request bypasses Service Worker integrity verification and OPFS caching. Please update the requester to use: ${P}.../${e}`);
	}
	if (t.origin !== N.location.origin || !t.pathname.startsWith(P)) return;
	let n = t.pathname.slice(P.length);
	if (n) {
		if (e.request.method === "DELETE") {
			e.respondWith(ye(n));
			return;
		}
		if (n.endsWith(".map")) {
			e.respondWith(new Response("{}", {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}));
			return;
		}
		e.respondWith(ge(n, e.request));
	}
});
async function ge(e, t) {
	try {
		let n = e.split("/");
		if (n.length !== 2) return new Response(`[piper-gate] Invalid path format: ${e}`, { status: 400 });
		let [r, i] = n;
		return r === "infra" ? await Y(i) : r === "voices" ? await _e(i, t) : new Response(`[piper-gate] Unknown directory: ${r}`, { status: 400 });
	} catch (t) {
		return me(e, t), new Response(t instanceof Error ? t.message : String(t), {
			status: 500,
			statusText: "Piper Gateway Resolver Error"
		});
	}
}
async function Y(e) {
	let t = U[e];
	if (!t) return new Response(`[piper-gate] Unknown infra asset: ${e}`, { status: 404 });
	let n = await X(I, e);
	if (n) {
		if (await F(n, t)) return H("log", `[piper-gate] [Cache Hit] '${e}' verified from OPFS.`), $(n, { filename: e });
		H("log", `[piper-gate] [Stale Cache] OPFS integrity mismatch for '${e}'. Deleting stale entry to trigger re-fetch.`), await Q(I, e);
	}
	try {
		let n = await fetch(`${P}infra/${e}`);
		if (n.ok) {
			let r = await n.arrayBuffer();
			if (await F(r, t)) return await Z(I, e, r) ? H("log", `[piper-gate] [Cache Restored] '${e}' verified and cached.`) : H("warn", `[piper-gate] [Cache Miss] '${e}' verified but not cached (storage issue).`), $(r, { filename: e });
			H("error", `[piper-gate] Local infra asset integrity mismatch: ${e}`);
		}
	} catch {
		H("log", `[piper-gate] Local file '${e}' unavailable. Fetching from CDN.`);
	}
	let r = de[e];
	if (!r) return new Response(`[piper-gate] No CDN URL for infra asset: ${e}`, { status: 404 });
	try {
		let n = await fetch(r);
		if (!n.ok) return new Response(`[piper-gate] CDN returned ${n.status} for: ${e}`, { status: 502 });
		let i = await n.arrayBuffer();
		return await F(i, t) ? (await Z(I, e, i) ? H("log", `[piper-gate] Infra asset from CDN verified and cached: ${e}`) : H("warn", `[piper-gate] Infra asset from CDN verified but not cached: ${e}`), $(i, { filename: e })) : new Response(`[piper-gate] CDN asset integrity mismatch: ${e}`, { status: 403 });
	} catch (t) {
		return H("error", `[piper-gate] CDN fetch failed for ${e}:`, t), new Response(`[piper-gate] CDN unreachable for: ${e}`, { status: 502 });
	}
}
async function _e(e, t) {
	let n = e.endsWith(".onnx.json"), r = n ? e.slice(0, -10) : e.slice(0, -5), i = n ? "config" : "onnx", a = t.headers.get("x-piper-cache-download") === "true";
	await fe();
	let o = W.get(r), s = o ? i === "onnx" ? o.onnx : o.config : null;
	if (!s) return H("error", `[piper-gate] No SHA-256 available for voice: ${e}`), new Response(`[piper-gate] SHA-256 required for voice asset: ${e}. Model must be present in piper-model-cards.json.`, { status: 403 });
	let c = await X(L, e);
	if (c) {
		if (await F(c, s)) return H("log", `[piper-gate] [Cache Hit] Voice asset verified from OPFS: ${e}`), $(c, { filename: e });
		H("log", `[piper-gate] [Stale Cache] Voice integrity mismatch for '${e}'. Purging stale entry.`), await Q(L, e);
	}
	let l = G.get(r), u = l ? i === "onnx" ? l.onnx : l.config : null;
	if (!u) return new Response(`[piper-gate] No source URL for voice: ${e}`, { status: 404 });
	try {
		let n = ve(u), r, i = 0;
		if (n) {
			H("log", `[piper-gate] Using HF Hub download for: ${e}`);
			let a = await le({
				repo: n.repo,
				revision: n.revision,
				path: n.path,
				fetch: (e, n) => fetch(e, {
					...n,
					signal: t.signal
				})
			});
			if (!a) return new Response(`[piper-gate] HF Hub failed to resolve: ${e}`, { status: 502 });
			i = a.size, J.postMessage({
				type: "progress",
				filename: e,
				downloaded: i,
				total: i
			}), r = await a.arrayBuffer();
		} else {
			let n = await fetch(u, { signal: t.signal });
			if (!n.ok) return new Response(`[piper-gate] Source returned ${n.status} for: ${e}`, { status: 502 });
			i = Number(n.headers.get("Content-Length")) || 0;
			let a = n.body?.getReader();
			if (!a) return new Response(`[piper-gate] No response body for: ${e}`, { status: 502 });
			let o = [], s = 0, c = 0;
			try {
				for (;;) {
					let { done: t, value: n } = await a.read();
					if (t) break;
					o.push(n), s += n.length;
					let r = Date.now();
					r - c > 100 && (J.postMessage({
						type: "progress",
						filename: e,
						downloaded: s,
						total: i || s
					}), c = r);
				}
			} finally {
				a.releaseLock();
			}
			r = await new Blob(o).arrayBuffer();
		}
		return await F(r, s) ? (await Z(L, e, r) ? H("log", `[piper-gate] [Cache Restored] Voice asset '${e}' verified and cached.`) : H("warn", `[piper-gate] [Cache Miss] Voice asset '${e}' verified but not cached (storage issue).`), a ? $(null, {
			status: 204,
			extraHeaders: { "x-piper-sha256": s }
		}) : $(r, { filename: e })) : (H("error", `[piper-gate] Voice asset integrity mismatch: ${e}`), new Response(`[piper-gate] Integrity mismatch for: ${e}`, { status: 403 }));
	} catch (t) {
		return t instanceof Error && t.name === "AbortError" ? new Response(`[piper-gate] Download aborted: ${e}`, { status: 499 }) : (H("error", `[piper-gate] Download failed for ${e}:`, t), new Response(`[piper-gate] Download failed for: ${e}`, { status: 502 }));
	}
}
function ve(e) {
	let t = e.match(/^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/([^/]+)\/(.+)$/);
	return t ? {
		repo: t[1],
		revision: t[2],
		path: t[3]
	} : null;
}
async function X(e, t) {
	try {
		return await (await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle(e, { create: !1 })).getFileHandle(t, { create: !1 })).getFile()).arrayBuffer();
	} catch (n) {
		return H("warn", `[piper-gate] OPFS read failed for ${e}/${t}:`, n), null;
	}
}
async function Z(e, t, n) {
	try {
		let r = await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle(e, { create: !0 })).getFileHandle(t, { create: !0 })).createWritable();
		return await r.write(n), await r.close(), !0;
	} catch (n) {
		return H("warn", `[piper-gate] OPFS write failed for ${e}/${t}:`, n), !1;
	}
}
async function Q(e, t) {
	try {
		await (await (await navigator.storage.getDirectory()).getDirectoryHandle(e, { create: !1 })).removeEntry(t);
	} catch (n) {
		H("warn", `[piper-gate] OPFS delete failed for ${e}/${t}:`, n);
	}
}
async function ye(e) {
	try {
		let t = await navigator.storage.getDirectory();
		if (e === "voices/" || e === "voices") {
			try {
				await t.removeEntry("voices", { recursive: !0 }), H("log", "[piper-gate] Voice cache cleared (recursive)");
			} catch (e) {
				if (!(e instanceof Error && (e.name === "NotFoundError" || e.message.toLowerCase().includes("not found")))) throw e;
			}
			return new Response(null, { status: 204 });
		}
		if (e === "infra/" || e === "infra") {
			try {
				await t.removeEntry("infra", { recursive: !0 }), H("log", "[piper-gate] Infra asset cache cleared (recursive)");
			} catch (e) {
				if (!(e instanceof Error && (e.name === "NotFoundError" || e.message.toLowerCase().includes("not found")))) throw e;
			}
			return new Response(null, { status: 204 });
		}
		if (e.startsWith("voices/")) {
			let n = e.slice(7);
			if (!n) return new Response("[piper-gate] Missing modelId for deletion", { status: 400 });
			let r = await t.getDirectoryHandle("voices", { create: !1 }).catch(() => null);
			if (r) {
				for (let e of [".onnx", ".onnx.json"]) try {
					await r.removeEntry(`${n}${e}`);
				} catch (e) {
					if (!(e instanceof Error && (e.name === "NotFoundError" || e.message.toLowerCase().includes("not found")))) throw e;
				}
				H("log", `[piper-gate] Model assets purged: ${n}`);
			}
			return new Response(null, { status: 204 });
		}
		return new Response(`[piper-gate] Unsupported deletion path: ${e}`, { status: 400 });
	} catch (t) {
		return H("error", `[piper-gate] Deletion failed for ${e}:`, t), new Response("[piper-gate] Internal OPFS Error", { status: 500 });
	}
}
function $(e, t = {}) {
	let { filename: n, status: r = 200, extraHeaders: i = {} } = t, a = {
		"x-piper-sw": "verified",
		"Cross-Origin-Resource-Policy": "same-origin",
		...i
	};
	return n && (a["Content-Type"] = pe[n.substring(n.lastIndexOf("."))] ?? "application/octet-stream"), new Response(e, {
		status: r,
		headers: a
	});
}
//#endregion
