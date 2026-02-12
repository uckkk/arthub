/**
 * 视觉显著性分析 — Frequency-tuned Saliency (Achanta et al. 2009)
 *
 * 核心公式: S(x,y) = ||I_μ − I_ω(x,y)||
 *   I_μ  = 全图 Lab 均值
 *   I_ω  = 大核高斯模糊后的 Lab 值 (σ ≈ imageSize/4)
 *
 * 实现: 用 3 轮迭代 box blur 逼近高斯模糊 (σ ≈ r × √(3/N))
 * 可视化增加 sigmoid 对比度增强和饱和度加权
 */

export interface SaliencyResult {
  type: 'result';
  saliencyMap: Float32Array;
  width: number;
  height: number;
}

// ============================================================
// Worker 核心算法代码 (纯 ES5, 兼容所有环境)
// ============================================================
const SALIENCY_ALGO = `
function sRGBtoLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function rgbToLab(r, g, b) {
  var lr = sRGBtoLinear(r), lg = sRGBtoLinear(g), lb = sRGBtoLinear(b);
  var x = 0.4124564*lr + 0.3575761*lg + 0.1804375*lb;
  var y = 0.2126729*lr + 0.7151522*lg + 0.0721750*lb;
  var z = 0.0193339*lr + 0.1191920*lg + 0.9503041*lb;
  var Xn=0.95047, Yn=1.0, Zn=1.08883;
  function f(t){return t>0.008856?Math.pow(t,1/3):7.787*t+16/116;}
  var fx=f(x/Xn), fy=f(y/Yn), fz=f(z/Zn);
  return [116*fy-16, 500*(fx-fy), 200*(fy-fz)];
}

// 迭代 box blur (3 轮逼近高斯)
// 单通道水平 box blur
function boxBlurH(src, dst, w, h, r) {
  var iarr = 1.0 / (r + r + 1);
  for (var i = 0; i < h; i++) {
    var ti = i * w, li = ti, ri = ti + r;
    var fv = src[ti], lv = src[ti + w - 1];
    var val = (r + 1) * fv;
    for (var j = 0; j < r; j++) val += src[ti + j];
    for (var j = 0; j <= r; j++) {
      val += src[ri] - fv;
      dst[ti + j] = val * iarr;
      ri++;
    }
    for (var j = r + 1; j < w - r; j++) {
      val += src[ri] - src[li];
      dst[ti + j] = val * iarr;
      ri++; li++;
    }
    for (var j = w - r; j < w; j++) {
      val += lv - src[li];
      dst[ti + j] = val * iarr;
      li++;
    }
  }
}
// 单通道垂直 box blur
function boxBlurV(src, dst, w, h, r) {
  var iarr = 1.0 / (r + r + 1);
  for (var i = 0; i < w; i++) {
    var ti = i, li = ti, ri = ti + r * w;
    var fv = src[ti], lv = src[ti + w * (h - 1)];
    var val = (r + 1) * fv;
    for (var j = 0; j < r; j++) val += src[ti + j * w];
    for (var j = 0; j <= r; j++) {
      val += src[ri] - fv;
      dst[ti + j * w] = val * iarr;
      ri += w;
    }
    for (var j = r + 1; j < h - r; j++) {
      val += src[ri] - src[li];
      dst[ti + j * w] = val * iarr;
      ri += w; li += w;
    }
    for (var j = h - r; j < h; j++) {
      val += lv - src[li];
      dst[ti + j * w] = val * iarr;
      li += w;
    }
  }
}
// 3 轮 box blur ≈ 高斯模糊
function gaussBlur(ch, w, h, sigma) {
  // 计算 3 轮 box blur 的核大小 (Kovesi 快速高斯近似)
  var wIdeal = Math.sqrt(12.0 * sigma * sigma / 3 + 1);
  var wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  var wu = wl + 2;
  var mIdeal = (12*sigma*sigma - 3*wl*wl - 12*wl - 9) / (-4*wl - 4);
  var m = Math.round(mIdeal);
  var tmp = new Float32Array(ch.length);
  var radii = [];
  for (var i = 0; i < 3; i++) {
    radii.push(i < m ? (wl - 1) / 2 : (wu - 1) / 2);
  }
  // 3 轮交替 H/V blur
  boxBlurH(ch, tmp, w, h, radii[0]);
  boxBlurV(tmp, ch, w, h, radii[0]);
  boxBlurH(ch, tmp, w, h, radii[1]);
  boxBlurV(tmp, ch, w, h, radii[1]);
  boxBlurH(ch, tmp, w, h, radii[2]);
  boxBlurV(tmp, ch, w, h, radii[2]);
}

function computeSaliency(data, w, h) {
  var n = w * h;
  var labL = new Float32Array(n);
  var labA = new Float32Array(n);
  var labB = new Float32Array(n);
  var avgL = 0, avgA = 0, avgB = 0;

  // 1. RGB → Lab + 计算全图均值
  for (var i = 0; i < n; i++) {
    var idx = i * 4;
    var lab = rgbToLab(data[idx], data[idx+1], data[idx+2]);
    labL[i] = lab[0]; labA[i] = lab[1]; labB[i] = lab[2];
    avgL += lab[0]; avgA += lab[1]; avgB += lab[2];
  }
  avgL /= n; avgA /= n; avgB /= n;

  // 2. 大核高斯模糊 (σ ≈ min(w,h)/4, 论文推荐)
  var sigma = Math.max(Math.min(w, h) / 4, 3);
  // 复制用于模糊 (gaussBlur 是 in-place)
  var blurL = labL.slice();
  var blurA = labA.slice();
  var blurB = labB.slice();
  gaussBlur(blurL, w, h, sigma);
  gaussBlur(blurA, w, h, sigma);
  gaussBlur(blurB, w, h, sigma);

  // 3. 显著性 = ||I_μ − I_ω||  (Lab 欧氏距离)
  var saliency = new Float32Array(n);
  var maxS = 0;
  for (var i = 0; i < n; i++) {
    var dL = avgL - blurL[i];
    var dA = avgA - blurA[i];
    var dB = avgB - blurB[i];
    var s = Math.sqrt(dL*dL + dA*dA + dB*dB);
    saliency[i] = s;
    if (s > maxS) maxS = s;
  }

  // 4. 归一化 + sigmoid 对比度增强
  if (maxS > 0) {
    // 先线性归一化
    for (var i = 0; i < n; i++) saliency[i] /= maxS;
    // 计算均值, 用于自适应 sigmoid
    var mean = 0;
    for (var i = 0; i < n; i++) mean += saliency[i];
    mean /= n;
    // sigmoid: f(x) = 1/(1+exp(-k*(x-mean)))  k 控制对比度
    var k = 8;
    for (var i = 0; i < n; i++) {
      saliency[i] = 1.0 / (1.0 + Math.exp(-k * (saliency[i] - mean)));
    }
    // 再次归一化到 [0,1]
    var minS = 1, maxS2 = 0;
    for (var i = 0; i < n; i++) {
      if (saliency[i] < minS) minS = saliency[i];
      if (saliency[i] > maxS2) maxS2 = saliency[i];
    }
    var range = maxS2 - minS;
    if (range > 0) {
      for (var i = 0; i < n; i++) saliency[i] = (saliency[i] - minS) / range;
    }
  }

  return saliency;
}
`;

// Worker 的完整代码
const workerCode = `
'use strict';
${SALIENCY_ALGO}
self.onmessage = function(e) {
  try {
    var msg = e.data;
    var data = new Uint8ClampedArray(msg.buffer);
    var saliency = computeSaliency(data, msg.width, msg.height);
    self.postMessage({
      type: 'result',
      saliencyMap: saliency,
      width: msg.width,
      height: msg.height,
    }, [saliency.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: (err && err.message) || String(err) });
  }
};
`;

// ============================================================
// 主线程回退 (直接复用同一算法)
// ============================================================
function sRGBtoLinear(c: number): number {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function rgbToLabMain(r: number, g: number, b: number): [number, number, number] {
  const lr = sRGBtoLinear(r), lg = sRGBtoLinear(g), lb = sRGBtoLinear(b);
  const x = 0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb;
  const z = 0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb;
  const Xn = 0.95047, Yn = 1.0, Zn = 1.08883;
  const f = (t: number) => t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116;
  const fx = f(x / Xn), fy = f(y / Yn), fz = f(z / Zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// 单通道 box blur (H / V)
function boxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1.0 / (r + r + 1);
  for (let i = 0; i < h; i++) {
    const ti = i * w;
    let ri2 = ti + r, li2 = ti;
    const fv = src[ti], lv = src[ti + w - 1];
    let val = (r + 1) * fv;
    for (let j = 0; j < r; j++) val += src[ti + j];
    for (let j = 0; j <= r; j++) { val += src[ri2] - fv; dst[ti + j] = val * iarr; ri2++; }
    for (let j = r + 1; j < w - r; j++) { val += src[ri2] - src[li2]; dst[ti + j] = val * iarr; ri2++; li2++; }
    for (let j = w - r; j < w; j++) { val += lv - src[li2]; dst[ti + j] = val * iarr; li2++; }
  }
}

function boxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1.0 / (r + r + 1);
  for (let i = 0; i < w; i++) {
    let ri2 = i + r * w, li2 = i;
    const fv = src[i], lv = src[i + w * (h - 1)];
    let val = (r + 1) * fv;
    for (let j = 0; j < r; j++) val += src[i + j * w];
    for (let j = 0; j <= r; j++) { val += src[ri2] - fv; dst[i + j * w] = val * iarr; ri2 += w; }
    for (let j = r + 1; j < h - r; j++) { val += src[ri2] - src[li2]; dst[i + j * w] = val * iarr; ri2 += w; li2 += w; }
    for (let j = h - r; j < h; j++) { val += lv - src[li2]; dst[i + j * w] = val * iarr; li2 += w; }
  }
}

function gaussBlurMain(ch: Float32Array, w: number, h: number, sigma: number) {
  const wIdeal = Math.sqrt(12.0 * sigma * sigma / 3 + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const tmp = new Float32Array(ch.length);
  const radii: number[] = [];
  for (let i = 0; i < 3; i++) radii.push(i < m ? (wl - 1) / 2 : (wu - 1) / 2);
  for (let p = 0; p < 3; p++) {
    boxBlurH(ch, tmp, w, h, radii[p]);
    boxBlurV(tmp, ch, w, h, radii[p]);
  }
}

function analyzeSaliencyMainThread(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const n = w * h;
  const labL = new Float32Array(n);
  const labA = new Float32Array(n);
  const labB = new Float32Array(n);
  let avgL = 0, avgA = 0, avgB = 0;

  for (let i = 0; i < n; i++) {
    const idx = i * 4;
    const [l, a, b] = rgbToLabMain(data[idx], data[idx + 1], data[idx + 2]);
    labL[i] = l; labA[i] = a; labB[i] = b;
    avgL += l; avgA += a; avgB += b;
  }
  avgL /= n; avgA /= n; avgB /= n;

  const sigma = Math.max(Math.min(w, h) / 4, 3);
  const blurL = labL.slice(), blurA = labA.slice(), blurBc = labB.slice();
  gaussBlurMain(blurL, w, h, sigma);
  gaussBlurMain(blurA, w, h, sigma);
  gaussBlurMain(blurBc, w, h, sigma);

  const saliency = new Float32Array(n);
  let maxS = 0;
  for (let i = 0; i < n; i++) {
    const dL = avgL - blurL[i], dA = avgA - blurA[i], dB = avgB - blurBc[i];
    const s = Math.sqrt(dL * dL + dA * dA + dB * dB);
    saliency[i] = s;
    if (s > maxS) maxS = s;
  }

  if (maxS > 0) {
    for (let i = 0; i < n; i++) saliency[i] /= maxS;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += saliency[i];
    mean /= n;
    const k = 8;
    for (let i = 0; i < n; i++) saliency[i] = 1.0 / (1.0 + Math.exp(-k * (saliency[i] - mean)));
    let minS = 1, maxS2 = 0;
    for (let i = 0; i < n; i++) {
      if (saliency[i] < minS) minS = saliency[i];
      if (saliency[i] > maxS2) maxS2 = saliency[i];
    }
    const range = maxS2 - minS;
    if (range > 0) {
      for (let i = 0; i < n; i++) saliency[i] = (saliency[i] - minS) / range;
    }
  }
  return saliency;
}

// ============================================================
// Worker 管理
// ============================================================
let workerInstance: Worker | null = null;
let workerFailed = false;

function getWorker(): Worker | null {
  if (workerFailed) return null;
  if (!workerInstance) {
    try {
      // 优先使用 data: URL (Electron 下 blob: URL 可能被 CSP 阻止)
      const dataUrl = 'data:application/javascript;charset=utf-8,' + encodeURIComponent(workerCode);
      workerInstance = new Worker(dataUrl);
    } catch (_e1) {
      // 回退到 blob: URL
      try {
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        workerInstance = new Worker(url);
        // 注意: 不要立即 revokeObjectURL, Worker 需要时间加载脚本
      } catch (_e2) {
        console.warn('Web Worker 创建失败, 将使用主线程:', _e2);
        workerFailed = true;
        return null;
      }
    }
  }
  return workerInstance;
}

/**
 * 对图片执行视觉显著性分析
 * 优先 Worker, 失败自动回退主线程
 */
export function analyzeSaliency(
  image: HTMLImageElement,
  maxDim: number = 200,
): Promise<SaliencyResult> {
  const ratio = Math.min(maxDim / image.naturalWidth, maxDim / image.naturalHeight, 1);
  const w = Math.round(image.naturalWidth * ratio);
  const h = Math.round(image.naturalHeight * ratio);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);

  const worker = getWorker();

  if (!worker) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const saliencyMap = analyzeSaliencyMainThread(imageData.data, w, h);
      console.log(`Saliency 主线程分析完成: ${(performance.now() - t0).toFixed(0)}ms (${w}×${h})`);
      resolve({ type: 'result', saliencyMap, width: w, height: h });
    });
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.warn('Saliency Worker 超时, 回退主线程');
      workerFailed = true;
      terminateWorker();
      const saliencyMap = analyzeSaliencyMainThread(imageData.data, w, h);
      resolve({ type: 'result', saliencyMap, width: w, height: h });
    }, 20000);

    worker.onmessage = (e: MessageEvent) => {
      clearTimeout(timeout);
      if (e.data.type === 'error') {
        console.warn('Worker 内部错误:', e.data.message);
        workerFailed = true;
        terminateWorker();
        const saliencyMap = analyzeSaliencyMainThread(imageData.data, w, h);
        resolve({ type: 'result', saliencyMap, width: w, height: h });
        return;
      }
      resolve(e.data as SaliencyResult);
    };

    worker.onerror = (evt) => {
      clearTimeout(timeout);
      const msg = evt instanceof ErrorEvent ? evt.message : 'Unknown worker error';
      console.warn('Worker onerror:', msg);
      workerFailed = true;
      terminateWorker();
      const saliencyMap = analyzeSaliencyMainThread(imageData.data, w, h);
      resolve({ type: 'result', saliencyMap, width: w, height: h });
    };

    const bufferCopy = imageData.data.buffer.slice(0);
    worker.postMessage(
      { type: 'analyze', buffer: bufferCopy, width: w, height: h },
      [bufferCopy],
    );
  });
}

/**
 * 显著性图 → 热力图 ImageData
 */
export function saliencyToHeatmap(
  saliencyMap: Float32Array,
  width: number,
  height: number,
  opacity: number = 0.6,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < saliencyMap.length; i++) {
    const v = saliencyMap[i]; // 已经经过 sigmoid 增强, 范围 0-1
    const idx = i * 4;

    // 色谱: 深蓝(0) → 蓝(0.2) → 青(0.35) → 绿(0.5) → 黄(0.7) → 橙(0.85) → 红(1)
    let r = 0, g = 0, b = 0;
    if (v < 0.2) {
      const t = v / 0.2;
      r = 0; g = 0; b = Math.round(128 + t * 127);
    } else if (v < 0.35) {
      const t = (v - 0.2) / 0.15;
      r = 0; g = Math.round(t * 255); b = 255;
    } else if (v < 0.5) {
      const t = (v - 0.35) / 0.15;
      r = 0; g = 255; b = Math.round((1 - t) * 255);
    } else if (v < 0.7) {
      const t = (v - 0.5) / 0.2;
      r = Math.round(t * 255); g = 255; b = 0;
    } else if (v < 0.85) {
      const t = (v - 0.7) / 0.15;
      r = 255; g = Math.round((1 - t) * 200 + 55); b = 0;
    } else {
      const t = (v - 0.85) / 0.15;
      r = 255; g = Math.round(55 * (1 - t)); b = 0;
    }

    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    // 最低 alpha = 30, 保证低显著区也可见 (不完全透明)
    data[idx + 3] = Math.round((0.12 + v * 0.88) * opacity * 255);
  }

  return new ImageData(data, width, height);
}

export function terminateWorker() {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
}
