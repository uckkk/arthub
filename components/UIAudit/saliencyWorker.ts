/**
 * 视觉显著性分析 — Frequency-tuned Saliency (Achanta et al. 2009)
 *
 * 核心公式: S(x,y) = ||I_μ − I_ω(x,y)||
 *   I_μ  = 全图 Lab 均值
 *   I_ω  = 大核高斯模糊后的 Lab 值 (σ ≈ imageSize/4)
 *
 * 实现: 3 轮迭代 box blur 逼近高斯 (Kovesi 快速近似)
 * 全部在主线程运行 (200×200 下采样图 < 100ms, 无需 Worker)
 */

export interface SaliencyResult {
  type: 'result';
  saliencyMap: Float32Array;
  width: number;
  height: number;
}

// ============================================================
// CIE Lab 色彩空间转换
// ============================================================
function sRGBtoLinear(c: number): number {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lr = sRGBtoLinear(r), lg = sRGBtoLinear(g), lb = sRGBtoLinear(b);
  const x = 0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb;
  const z = 0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb;
  const Xn = 0.95047, Yn = 1.0, Zn = 1.08883;
  const f = (t: number) => t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116;
  const fx = f(x / Xn), fy = f(y / Yn), fz = f(z / Zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// ============================================================
// 快速高斯模糊 (3 轮 box blur, O(n) 复杂度)
// 参考: Ivan Googleman 线性时间 box blur
// ============================================================
function boxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1.0 / (r + r + 1);
  for (let i = 0; i < h; i++) {
    const ti = i * w;
    let ri2 = ti + r, li2 = ti;
    const fv = src[ti], lv = src[ti + w - 1];
    let val = (r + 1) * fv;
    for (let j = 0; j < r; j++) val += src[ti + Math.min(j, w - 1)];
    for (let j = 0; j <= r; j++) {
      val += (ri2 < ti + w ? src[ri2] : lv) - fv;
      dst[ti + j] = val * iarr;
      ri2++;
    }
    for (let j = r + 1; j < w - r; j++) {
      val += src[ri2] - src[li2];
      dst[ti + j] = val * iarr;
      ri2++;
      li2++;
    }
    for (let j = w - r; j < w; j++) {
      val += lv - src[li2];
      dst[ti + j] = val * iarr;
      li2++;
    }
  }
}

function boxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1.0 / (r + r + 1);
  for (let i = 0; i < w; i++) {
    let ri2 = i + r * w, li2 = i;
    const fv = src[i], lv = src[i + w * (h - 1)];
    let val = (r + 1) * fv;
    for (let j = 0; j < r; j++) val += src[i + Math.min(j, h - 1) * w];
    for (let j = 0; j <= r; j++) {
      val += (ri2 < i + h * w ? src[ri2] : lv) - fv;
      dst[i + j * w] = val * iarr;
      ri2 += w;
    }
    for (let j = r + 1; j < h - r; j++) {
      val += src[ri2] - src[li2];
      dst[i + j * w] = val * iarr;
      ri2 += w;
      li2 += w;
    }
    for (let j = h - r; j < h; j++) {
      val += lv - src[li2];
      dst[i + j * w] = val * iarr;
      li2 += w;
    }
  }
}

/** 3 轮 box blur ≈ 高斯模糊 (Kovesi 快速近似) */
function gaussBlur(ch: Float32Array, w: number, h: number, sigma: number) {
  const wIdeal = Math.sqrt(12.0 * sigma * sigma / 3 + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const tmp = new Float32Array(ch.length);
  const radii: number[] = [];
  for (let i = 0; i < 3; i++) radii.push(i < m ? (wl - 1) / 2 : (wu - 1) / 2);
  // 确保半径 >= 1
  for (let i = 0; i < 3; i++) radii[i] = Math.max(1, radii[i]);

  for (let p = 0; p < 3; p++) {
    boxBlurH(ch, tmp, w, h, radii[p]);
    boxBlurV(tmp, ch, w, h, radii[p]);
  }
}

// ============================================================
// 核心显著性计算
// ============================================================
function computeSaliency(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const n = w * h;
  const labL = new Float32Array(n);
  const labA = new Float32Array(n);
  const labB = new Float32Array(n);
  let avgL = 0, avgA = 0, avgB = 0;

  // 1. RGB → Lab + 全图均值
  for (let i = 0; i < n; i++) {
    const idx = i * 4;
    const [l, a, b] = rgbToLab(data[idx], data[idx + 1], data[idx + 2]);
    labL[i] = l;
    labA[i] = a;
    labB[i] = b;
    avgL += l;
    avgA += a;
    avgB += b;
  }
  avgL /= n;
  avgA /= n;
  avgB /= n;

  // 2. 大核高斯模糊 (σ ≈ min(w,h)/4, 论文推荐)
  const sigma = Math.max(Math.min(w, h) / 4, 3);
  const blurL = labL.slice();
  const blurA2 = labA.slice();
  const blurB2 = labB.slice();
  gaussBlur(blurL, w, h, sigma);
  gaussBlur(blurA2, w, h, sigma);
  gaussBlur(blurB2, w, h, sigma);

  // 3. 显著性 = ||I_μ − I_ω|| (CIE Lab 欧氏距离)
  const saliency = new Float32Array(n);
  let maxS = 0;
  for (let i = 0; i < n; i++) {
    const dL = avgL - blurL[i];
    const dA = avgA - blurA2[i];
    const dB = avgB - blurB2[i];
    const s = Math.sqrt(dL * dL + dA * dA + dB * dB);
    saliency[i] = s;
    if (s > maxS) maxS = s;
  }

  // 4. 归一化 + sigmoid 对比度增强
  if (maxS > 0) {
    for (let i = 0; i < n; i++) saliency[i] /= maxS;

    // 自适应 sigmoid: 以均值为中心增强对比度
    let mean = 0;
    for (let i = 0; i < n; i++) mean += saliency[i];
    mean /= n;

    const k = 8; // sigmoid 陡峭度
    for (let i = 0; i < n; i++) {
      saliency[i] = 1.0 / (1.0 + Math.exp(-k * (saliency[i] - mean)));
    }

    // 再次归一化到 [0, 1]
    let minS = Infinity, maxS2 = -Infinity;
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
// 公开 API
// ============================================================

/**
 * 对图片执行视觉显著性分析
 * 在主线程异步执行 (用 rAF 让出渲染帧避免卡顿)
 */
export function analyzeSaliency(
  image: HTMLImageElement,
  maxDim: number = 200,
): Promise<SaliencyResult> {
  return new Promise((resolve) => {
    // 用 requestAnimationFrame 让 UI 先渲染 loading 状态
    requestAnimationFrame(() => {
      const t0 = performance.now();

      // 下采样
      const ratio = Math.min(maxDim / image.naturalWidth, maxDim / image.naturalHeight, 1);
      const w = Math.round(image.naturalWidth * ratio);
      const h = Math.round(image.naturalHeight * ratio);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);

      const saliencyMap = computeSaliency(imageData.data, w, h);

      console.log(`Saliency 分析完成: ${(performance.now() - t0).toFixed(0)}ms (${w}×${h}, σ=${Math.max(Math.min(w, h) / 4, 3).toFixed(0)})`);

      resolve({ type: 'result', saliencyMap, width: w, height: h });
    });
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
    const v = saliencyMap[i];
    const idx = i * 4;

    // 7 段色谱: 深蓝 → 蓝 → 青 → 绿 → 黄 → 橙 → 红
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
    // 最低 alpha 12%, 保证低显著区也可见
    data[idx + 3] = Math.round((0.12 + v * 0.88) * opacity * 255);
  }

  return new ImageData(data, width, height);
}

/** 兼容旧接口, 实际无 Worker 需要清理 */
export function terminateWorker() {
  // no-op: 已移除 Worker, 保留接口兼容
}
