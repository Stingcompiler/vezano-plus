/**
 * AES-256-GCM بجافاسكربت خالص (Hermes بلا `crypto.subtle`). مخرجه مطابق لـWebCrypto: النص المشفَّر ملحوق
 * بوسم 16 بايت، IV من 12 بايت، بلا بيانات مُلحقة — فنسخة الجوال تُستعاد على الويب والعكس (SYS-05/06).
 * يُتحقق منه في الاختبار مقابل `crypto.subtle` نفسه. لا يُستعمل للسرّ الطويل؛ لحجم نسخ محلية فقط.
 */

const SBOX = new Uint8Array(256);
const TE0 = new Uint32Array(256);
const TE1 = new Uint32Array(256);
const TE2 = new Uint32Array(256);
const TE3 = new Uint32Array(256);

(() => {
  let p = 1;
  let q = 1;
  const rotl8 = (x: number, n: number) => ((x << n) | (x >> (8 - n))) & 0xff;
  do {
    p = (p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
    q ^= q << 1;
    q ^= q << 2;
    q ^= q << 4;
    q &= 0xff;
    if (q & 0x80) q ^= 0x09;
    const x = q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4);
    SBOX[p] = (x ^ 0x63) & 0xff;
  } while (p !== 1);
  SBOX[0] = 0x63;
  const x2 = (a: number) => ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
  for (let i = 0; i < 256; i++) {
    const s = SBOX[i] ?? 0;
    const s2 = x2(s);
    const s3 = s2 ^ s;
    const w = ((s2 << 24) | (s << 16) | (s << 8) | s3) >>> 0;
    TE0[i] = w;
    TE1[i] = ((w >>> 8) | (w << 24)) >>> 0;
    TE2[i] = ((w >>> 16) | (w << 16)) >>> 0;
    TE3[i] = ((w >>> 24) | (w << 8)) >>> 0;
  }
})();

const sb = (i: number): number => SBOX[i & 255] ?? 0;
const subWord = (w: number): number =>
  ((sb(w >>> 24) << 24) | (sb(w >>> 16) << 16) | (sb(w >>> 8) << 8) | sb(w)) >>> 0;

function expandKey(key: Uint8Array): Uint32Array {
  if (key.length !== 32) throw new Error("aes256_key");
  const w = new Uint32Array(60);
  for (let i = 0; i < 8; i++)
    w[i] =
      (((key[4 * i] ?? 0) << 24) |
        ((key[4 * i + 1] ?? 0) << 16) |
        ((key[4 * i + 2] ?? 0) << 8) |
        (key[4 * i + 3] ?? 0)) >>>
      0;
  let rcon = 1;
  for (let i = 8; i < 60; i++) {
    let t = w[i - 1] ?? 0;
    if (i % 8 === 0) {
      t = (subWord(((t << 8) | (t >>> 24)) >>> 0) ^ (rcon << 24)) >>> 0;
      rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x1b : 0)) & 0xff;
    } else if (i % 8 === 4) t = subWord(t);
    w[i] = ((w[i - 8] ?? 0) ^ t) >>> 0;
  }
  return w;
}

/** يشفّر كتلة (4 كلمات) إلى `out`. */
function encryptBlock(
  w: Uint32Array,
  i0: number,
  i1: number,
  i2: number,
  i3: number,
  out: Uint32Array,
) {
  let s0 = (i0 ^ (w[0] ?? 0)) >>> 0;
  let s1 = (i1 ^ (w[1] ?? 0)) >>> 0;
  let s2 = (i2 ^ (w[2] ?? 0)) >>> 0;
  let s3 = (i3 ^ (w[3] ?? 0)) >>> 0;
  for (let r = 1; r < 14; r++) {
    const k = 4 * r;
    const t0 =
      ((TE0[s0 >>> 24] ?? 0) ^
        (TE1[(s1 >>> 16) & 255] ?? 0) ^
        (TE2[(s2 >>> 8) & 255] ?? 0) ^
        (TE3[s3 & 255] ?? 0) ^
        (w[k] ?? 0)) >>>
      0;
    const t1 =
      ((TE0[s1 >>> 24] ?? 0) ^
        (TE1[(s2 >>> 16) & 255] ?? 0) ^
        (TE2[(s3 >>> 8) & 255] ?? 0) ^
        (TE3[s0 & 255] ?? 0) ^
        (w[k + 1] ?? 0)) >>>
      0;
    const t2 =
      ((TE0[s2 >>> 24] ?? 0) ^
        (TE1[(s3 >>> 16) & 255] ?? 0) ^
        (TE2[(s0 >>> 8) & 255] ?? 0) ^
        (TE3[s1 & 255] ?? 0) ^
        (w[k + 2] ?? 0)) >>>
      0;
    const t3 =
      ((TE0[s3 >>> 24] ?? 0) ^
        (TE1[(s0 >>> 16) & 255] ?? 0) ^
        (TE2[(s1 >>> 8) & 255] ?? 0) ^
        (TE3[s2 & 255] ?? 0) ^
        (w[k + 3] ?? 0)) >>>
      0;
    s0 = t0;
    s1 = t1;
    s2 = t2;
    s3 = t3;
  }
  out[0] =
    (((sb(s0 >>> 24) << 24) | (sb(s1 >>> 16) << 16) | (sb(s2 >>> 8) << 8) | sb(s3)) ^
      (w[56] ?? 0)) >>>
    0;
  out[1] =
    (((sb(s1 >>> 24) << 24) | (sb(s2 >>> 16) << 16) | (sb(s3 >>> 8) << 8) | sb(s0)) ^
      (w[57] ?? 0)) >>>
    0;
  out[2] =
    (((sb(s2 >>> 24) << 24) | (sb(s3 >>> 16) << 16) | (sb(s0 >>> 8) << 8) | sb(s1)) ^
      (w[58] ?? 0)) >>>
    0;
  out[3] =
    (((sb(s3 >>> 24) << 24) | (sb(s0 >>> 16) << 16) | (sb(s1 >>> 8) << 8) | sb(s2)) ^
      (w[59] ?? 0)) >>>
    0;
}

const LAST4 = [
  0x0000, 0x1c20, 0x3840, 0x2460, 0x7080, 0x6ca0, 0x48c0, 0x54e0, 0xe100, 0xfd20, 0xd940, 0xc560,
  0x9180, 0x8da0, 0xa9c0, 0xb5e0,
];

/** جدول Shoup بـ4 بتات: 16 مدخلاً × 4 كلمات. */
function ghashTable(h: Uint32Array): Uint32Array {
  const t = new Uint32Array(64);
  let v0 = h[0] ?? 0;
  let v1 = h[1] ?? 0;
  let v2 = h[2] ?? 0;
  let v3 = h[3] ?? 0;
  t[32] = v0;
  t[33] = v1;
  t[34] = v2;
  t[35] = v3;
  for (let i = 4; i > 0; i >>= 1) {
    const lsb = v3 & 1;
    v3 = ((v2 << 31) | (v3 >>> 1)) >>> 0;
    v2 = ((v1 << 31) | (v2 >>> 1)) >>> 0;
    v1 = ((v0 << 31) | (v1 >>> 1)) >>> 0;
    v0 = v0 >>> 1;
    if (lsb) v0 = (v0 ^ 0xe1000000) >>> 0;
    t[i * 4] = v0;
    t[i * 4 + 1] = v1;
    t[i * 4 + 2] = v2;
    t[i * 4 + 3] = v3;
  }
  for (let i = 2; i < 16; i <<= 1)
    for (let j = 1; j < i; j++)
      for (let k = 0; k < 4; k++) t[(i + j) * 4 + k] = (t[i * 4 + k] ?? 0) ^ (t[j * 4 + k] ?? 0);
  return t;
}

/** y ← y·H (y أربع كلمات BE). */
function gmult(y: Uint32Array, t: Uint32Array) {
  const x = [y[0] ?? 0, y[1] ?? 0, y[2] ?? 0, y[3] ?? 0];
  const byteAt = (n: number): number => ((x[n >> 2] ?? 0) >>> (24 - 8 * (n & 3))) & 255;
  let lo = byteAt(15) & 0xf;
  let z0 = t[lo * 4] ?? 0;
  let z1 = t[lo * 4 + 1] ?? 0;
  let z2 = t[lo * 4 + 2] ?? 0;
  let z3 = t[lo * 4 + 3] ?? 0;
  for (let i = 15; i >= 0; i--) {
    const b = byteAt(i);
    lo = b & 0xf;
    const hi = b >>> 4;
    if (i !== 15) {
      const rem = z3 & 0xf;
      z3 = ((z2 << 28) | (z3 >>> 4)) >>> 0;
      z2 = ((z1 << 28) | (z2 >>> 4)) >>> 0;
      z1 = ((z0 << 28) | (z1 >>> 4)) >>> 0;
      z0 = z0 >>> 4;
      z0 = (z0 ^ ((LAST4[rem] ?? 0) << 16)) >>> 0;
      z0 = (z0 ^ (t[lo * 4] ?? 0)) >>> 0;
      z1 = (z1 ^ (t[lo * 4 + 1] ?? 0)) >>> 0;
      z2 = (z2 ^ (t[lo * 4 + 2] ?? 0)) >>> 0;
      z3 = (z3 ^ (t[lo * 4 + 3] ?? 0)) >>> 0;
    }
    const rem = z3 & 0xf;
    z3 = ((z2 << 28) | (z3 >>> 4)) >>> 0;
    z2 = ((z1 << 28) | (z2 >>> 4)) >>> 0;
    z1 = ((z0 << 28) | (z1 >>> 4)) >>> 0;
    z0 = z0 >>> 4;
    z0 = (z0 ^ ((LAST4[rem] ?? 0) << 16)) >>> 0;
    z0 = (z0 ^ (t[hi * 4] ?? 0)) >>> 0;
    z1 = (z1 ^ (t[hi * 4 + 1] ?? 0)) >>> 0;
    z2 = (z2 ^ (t[hi * 4 + 2] ?? 0)) >>> 0;
    z3 = (z3 ^ (t[hi * 4 + 3] ?? 0)) >>> 0;
  }
  y[0] = z0;
  y[1] = z1;
  y[2] = z2;
  y[3] = z3;
}

const be32 = (b: Uint8Array, o: number): number =>
  (((b[o] ?? 0) << 24) | ((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0)) >>> 0;

/** GHASH فوق `data` (يُبطَّن بأصفار) ثم كتلة الأطوال (بلا AAD). */
function ghash(t: Uint32Array, data: Uint8Array): Uint32Array {
  const y = new Uint32Array(4);
  const blk = new Uint8Array(16);
  for (let off = 0; off < data.length; off += 16) {
    const n = Math.min(16, data.length - off);
    if (n === 16) {
      y[0] = ((y[0] ?? 0) ^ be32(data, off)) >>> 0;
      y[1] = ((y[1] ?? 0) ^ be32(data, off + 4)) >>> 0;
      y[2] = ((y[2] ?? 0) ^ be32(data, off + 8)) >>> 0;
      y[3] = ((y[3] ?? 0) ^ be32(data, off + 12)) >>> 0;
    } else {
      blk.fill(0);
      blk.set(data.subarray(off, off + n));
      y[0] = ((y[0] ?? 0) ^ be32(blk, 0)) >>> 0;
      y[1] = ((y[1] ?? 0) ^ be32(blk, 4)) >>> 0;
      y[2] = ((y[2] ?? 0) ^ be32(blk, 8)) >>> 0;
      y[3] = ((y[3] ?? 0) ^ be32(blk, 12)) >>> 0;
    }
    gmult(y, t);
  }
  // كتلة الأطوال: AAD = 0 بت، النص = len*8 بت
  const bits = data.length * 8;
  y[2] = ((y[2] ?? 0) ^ Math.floor(bits / 0x100000000)) >>> 0;
  y[3] = ((y[3] ?? 0) ^ (bits >>> 0)) >>> 0;
  gmult(y, t);
  return y;
}

function ctr(w: Uint32Array, iv: Uint8Array, input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length);
  const ks = new Uint32Array(4);
  const c0 = be32(iv, 0);
  const c1 = be32(iv, 4);
  const c2 = be32(iv, 8);
  let counter = 2; // J0 = IV||1، أول كتلة بيانات = IV||2
  for (let off = 0; off < input.length; off += 16) {
    encryptBlock(w, c0, c1, c2, counter >>> 0, ks);
    counter = (counter + 1) >>> 0;
    const n = Math.min(16, input.length - off);
    for (let i = 0; i < n; i++) {
      const word = ks[i >> 2] ?? 0;
      out[off + i] = (input[off + i] ?? 0) ^ ((word >>> (24 - 8 * (i & 3))) & 255);
    }
  }
  return out;
}

function tagFor(w: Uint32Array, t: Uint32Array, iv: Uint8Array, cipher: Uint8Array): Uint8Array {
  const s = ghash(t, cipher);
  const e = new Uint32Array(4);
  encryptBlock(w, be32(iv, 0), be32(iv, 4), be32(iv, 8), 1, e);
  const tag = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const word = ((e[i >> 2] ?? 0) ^ (s[i >> 2] ?? 0)) >>> 0;
    tag[i] = (word >>> (24 - 8 * (i & 3))) & 255;
  }
  return tag;
}

function setup(key: Uint8Array) {
  const w = expandKey(key);
  const h = new Uint32Array(4);
  encryptBlock(w, 0, 0, 0, 0, h);
  return { w, t: ghashTable(h) };
}

/** AES-256-GCM: يعيد النص المشفَّر ملحوقاً بالوسم (كـWebCrypto). */
export function aesGcmEncrypt(key: Uint8Array, iv: Uint8Array, plain: Uint8Array): Uint8Array {
  if (iv.length !== 12) throw new Error("iv12");
  const { w, t } = setup(key);
  const cipher = ctr(w, iv, plain);
  const tag = tagFor(w, t, iv, cipher);
  const out = new Uint8Array(cipher.length + 16);
  out.set(cipher);
  out.set(tag, cipher.length);
  return out;
}

/** يفكّ ويتحقق من الوسم؛ يرمي عند وسم خاطئ (كلمة خاطئة أو ملف ممسوس). */
export function aesGcmDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  if (iv.length !== 12 || data.length < 16) throw new Error("gcm_input");
  const { w, t } = setup(key);
  const cipher = data.subarray(0, data.length - 16);
  const tag = data.subarray(data.length - 16);
  const expect = tagFor(w, t, iv, cipher);
  let diff = 0;
  for (let i = 0; i < 16; i++) diff |= (expect[i] ?? 0) ^ (tag[i] ?? 0);
  if (diff !== 0) throw new Error("gcm_tag");
  return ctr(w, iv, cipher);
}
