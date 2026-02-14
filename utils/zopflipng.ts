/**
 * ZopfliPNG — 极致无损 PNG 编码器
 *
 * 策略：
 * 1. 先做 WASM 热身测试（3 秒超时）
 * 2. 如果 Zopfli WASM 可用 → 分块 Zopfli deflate（16KB/块，真实进度 + ETA）
 * 3. 如果 WASM 不可用（初始化失败/超时）→ 自动降级到浏览器原生 CompressionStream
 *
 * 两条路径都使用相同的最优行滤波算法，差异仅在 deflate 压缩器。
 */

// ==== CRC-32 (PNG chunk 校验) ====
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c;
}
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ==== Adler-32 (zlib 尾部校验) ====
function adler32(data: Uint8Array): number {
  const MOD = 65521;
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

// ==== helpers ====
function u32BE(buf: Uint8Array, off: number, v: number) {
  buf[off] = (v >>> 24) & 0xff; buf[off + 1] = (v >>> 16) & 0xff;
  buf[off + 2] = (v >>> 8) & 0xff; buf[off + 3] = v & 0xff;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  u32BE(chunk, 0, data.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  u32BE(chunk, 8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

// ==== PNG row filters ====
function filterNone(row: Uint8Array): Uint8Array {
  const o = new Uint8Array(1 + row.length); o[0] = 0; o.set(row, 1); return o;
}
function filterSub(row: Uint8Array, bpp: number): Uint8Array {
  const o = new Uint8Array(1 + row.length); o[0] = 1;
  for (let i = 0; i < row.length; i++) o[1 + i] = (row[i] - (i >= bpp ? row[i - bpp] : 0)) & 0xff;
  return o;
}
function filterUp(row: Uint8Array, prev: Uint8Array | null): Uint8Array {
  const o = new Uint8Array(1 + row.length); o[0] = 2;
  for (let i = 0; i < row.length; i++) o[1 + i] = (row[i] - (prev ? prev[i] : 0)) & 0xff;
  return o;
}
function filterAvg(row: Uint8Array, prev: Uint8Array | null, bpp: number): Uint8Array {
  const o = new Uint8Array(1 + row.length); o[0] = 3;
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? row[i - bpp] : 0, b = prev ? prev[i] : 0;
    o[1 + i] = (row[i] - Math.floor((a + b) / 2)) & 0xff;
  }
  return o;
}
function filterPaeth(row: Uint8Array, prev: Uint8Array | null, bpp: number): Uint8Array {
  const o = new Uint8Array(1 + row.length); o[0] = 4;
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? row[i - bpp] : 0;
    const b = prev ? prev[i] : 0;
    const c = (i >= bpp && prev) ? prev[i - bpp] : 0;
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    o[1 + i] = (row[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
  }
  return o;
}

function sumAbs(d: Uint8Array): number {
  let s = 0;
  for (let i = 1; i < d.length; i++) { const v = d[i]; s += v < 128 ? v : 256 - v; }
  return s;
}

// ==== Timeout helper ====
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`超时 (${ms}ms)`)), ms);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

// ==== 浏览器原生 deflate 降级方案 ====
async function nativeZlibCompress(data: Uint8Array): Promise<Uint8Array> {
  // CompressionStream('deflate') 输出标准 zlib 格式（2字节头 + deflate + 4字节Adler-32）
  // 这正好是 PNG IDAT 需要的格式！
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalLen);
  let off = 0;
  for (const c of chunks) { result.set(c, off); off += c.length; }
  return result;
}

// ==== Main encoder ====
export interface ZopfliPNGOptions {
  numiterations?: number;
  onProgress?: (progress: number, phase: string, etaMs?: number) => void;
}

const FIXED_CHUNK_SIZE = 16384; // 16KB
const WARMUP_TIMEOUT_MS = 3000;  // WASM 热身超时 3 秒
const CHUNK_TIMEOUT_MS = 15000;  // 单块压缩超时 15 秒

// 记住 Zopfli WASM 状态，避免每次都浪费 3 秒去尝试
let _zopfliStatus: 'untested' | 'available' | 'unavailable' = 'untested';
let _deflateAsyncFn: ((buf: Uint8Array, opts: Record<string, unknown>) => Promise<Uint8Array>) | null = null;

/** 获取当前 Zopfli WASM 引擎状态 */
export function getZopfliStatus(): 'untested' | 'available' | 'unavailable' {
  return _zopfliStatus;
}

/** 重置 Zopfli 状态，允许重新探测 */
export function resetZopfliStatus(): void {
  _zopfliStatus = 'untested';
  _deflateAsyncFn = null;
}

/** 测试 Zopfli WASM 是否可用（结果会被缓存） */
async function probeZopfli(): Promise<boolean> {
  if (_zopfliStatus === 'available') return true;
  if (_zopfliStatus === 'unavailable') return false;

  try {
    const mod = await withTimeout(import('@gfx/zopfli'), 3000);
    const fn = mod.deflateAsync;
    if (!fn) throw new Error('deflateAsync export missing');

    // 热身：压缩 256 字节，必须在 3 秒内返回结果
    const testBuf = new Uint8Array(256);
    for (let i = 0; i < 256; i++) testBuf[i] = i & 0xff;
    const result = await withTimeout(fn(testBuf, { numiterations: 1, blocksplitting: false }), WARMUP_TIMEOUT_MS);
    if (!result || result.length === 0) throw new Error('warmup returned empty');

    _deflateAsyncFn = fn;
    _zopfliStatus = 'available';
    return true;
  } catch {
    // Zopfli WASM 在当前环境不可用（常见于某些浏览器/Electron）
    // 静默降级到原生 CompressionStream，不打扰用户
    _zopfliStatus = 'unavailable';
    _deflateAsyncFn = null;
    return false;
  }
}

export async function encodeZopfliPNG(imageData: ImageData, options: ZopfliPNGOptions = {}): Promise<Uint8Array> {
  const { width, height, data } = imageData;
  const bpp = 4;
  const rowLen = width * bpp;
  const numIterations = options.numiterations ?? 5;
  const report = options.onProgress;

  // ── Phase 1: 行滤波 ──
  report?.(0, '行滤波');
  const rows: Uint8Array[] = [];
  let prev: Uint8Array | null = null;
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(data.buffer, data.byteOffset + y * rowLen, rowLen);
    const candidates = [
      filterNone(row), filterSub(row, bpp), filterUp(row, prev),
      filterAvg(row, prev, bpp), filterPaeth(row, prev, bpp),
    ];
    let best = candidates[0], bestS = sumAbs(candidates[0]);
    for (let i = 1; i < 5; i++) { const s = sumAbs(candidates[i]); if (s < bestS) { best = candidates[i]; bestS = s; } }
    rows.push(best);
    prev = row;
  }

  report?.(0.05, '准备数据');
  const totalLen = rows.reduce((s, r) => s + r.length, 0);
  const raw = new Uint8Array(totalLen);
  let off = 0;
  for (const r of rows) { raw.set(r, off); off += r.length; }

  // ── Phase 2: 压缩（自动选择最佳可用引擎）──
  let zlibData: Uint8Array;

  report?.(0.07, '检测压缩引擎');
  const zopfliOk = await probeZopfli();

  if (zopfliOk && _deflateAsyncFn) {
    // ── 路径 A: Zopfli 分块压缩（真实进度 + ETA）──
    report?.(0.10, 'Zopfli 压缩');
    const adlerChecksum = adler32(raw);

    const numChunks = Math.ceil(raw.length / FIXED_CHUNK_SIZE);
    const deflateChunks: Uint8Array[] = [];
    let cumulativeTime = 0;
    const fn = _deflateAsyncFn; // local ref for closure

    for (let i = 0; i < numChunks; i++) {
      const start = i * FIXED_CHUNK_SIZE;
      const end = Math.min(start + FIXED_CHUNK_SIZE, raw.length);
      const chunk = raw.slice(start, end);
      const t0 = performance.now();

      let compressed: Uint8Array;
      try {
        compressed = await withTimeout(
          fn(chunk, { numiterations: numIterations, blocksplitting: false }),
          CHUNK_TIMEOUT_MS,
        );
      } catch {
        // 单块超时 → 标记 Zopfli 不可用并降级
        _zopfliStatus = 'unavailable';
        report?.(0.10 + 0.85 * (i / numChunks), '降级到原生压缩');
        zlibData = await nativeZlibCompress(raw);
        return buildPNG(width, height, zlibData, report);
      }

      cumulativeTime += performance.now() - t0;
      const result = new Uint8Array(compressed);
      if (i < numChunks - 1) result[0] = result[0] & 0xFE;
      deflateChunks.push(result);

      await new Promise(r => setTimeout(r, 0));
      const done = i + 1;
      const progress = 0.10 + 0.85 * (done / numChunks);
      const avgMs = cumulativeTime / done;
      const etaMs = avgMs * (numChunks - done);
      report?.(progress, `压缩 ${done}/${numChunks}`, etaMs);
    }

    // 组装 zlib 流
    report?.(0.96, '组装文件', 0);
    const ZLIB_HEADER = new Uint8Array([0x78, 0x01]);
    const totalDeflateSize = deflateChunks.reduce((s, c) => s + c.length, 0);
    zlibData = new Uint8Array(2 + totalDeflateSize + 4);
    zlibData.set(ZLIB_HEADER, 0);
    let pos = 2;
    for (const dc of deflateChunks) { zlibData.set(dc, pos); pos += dc.length; }
    u32BE(zlibData, pos, adlerChecksum);
  } else {
    // ── 路径 B: 原生最优压缩（CompressionStream + 最优行滤波）──
    report?.(0.10, '深度压缩中');
    zlibData = await nativeZlibCompress(raw);
    report?.(0.95, '压缩完成');
  }

  return buildPNG(width, height, zlibData, report);
}

function buildPNG(
  width: number,
  height: number,
  zlibData: Uint8Array,
  report?: (p: number, phase: string, eta?: number) => void,
): Uint8Array {
  const SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = new Uint8Array(13);
  u32BE(ihdrData, 0, width);
  u32BE(ihdrData, 4, height);
  ihdrData[8] = 8; ihdrData[9] = 6; // 8-bit RGBA
  const ihdr = makeChunk('IHDR', ihdrData);
  const idat = makeChunk('IDAT', zlibData);
  const iend = makeChunk('IEND', new Uint8Array(0));

  const png = new Uint8Array(SIG.length + ihdr.length + idat.length + iend.length);
  let p = 0;
  png.set(SIG, p); p += SIG.length;
  png.set(ihdr, p); p += ihdr.length;
  png.set(idat, p); p += idat.length;
  png.set(iend, p);

  report?.(1, '完成', 0);
  return png;
}
