/**
 * 视觉显著性分析 — 游戏 UI 专用 (v5)
 *
 * 三路信号融合:
 *   S = w1 × CenterSurround  +  w2 × ColorRarity  +  w3 × Saturation
 *
 * 1. CenterSurround (多尺度局部对比度)
 *    ||I(x,y) − I_σk(x,y)||  在 3 个尺度 (σ = 4%/10%/25% minDim)
 *    → 检测"什么和周围不一样" (按钮从背景中突出, 文字从色块中突出)
 *    小尺度权重仅 0.10, 避免精细纹理(金框花纹等)产生噪点
 *
 * 2. ColorRarity (色彩稀缺度)
 *    基于量化 Lab 直方图的信息论"惊奇度", σ=3% 平滑
 *    → 检测"什么颜色在画面中稀有" (角色独特配色 > 重复的扑克牌)
 *
 * 3. Saturation (饱和度加权)
 *    高饱和 = 游戏 UI 设计意图上的焦点
 *
 * 4. ★ 注意力区域空间平滑 (σ = 4% minDim)
 *    融合后对显著图做 Gaussian blur, 将像素级碎片聚合成
 *    连贯的"注意力区域", 模拟人眼注视焦点 (~3-5% 画面尺寸)
 *
 * 采样: maxDim=400 (横屏游戏截图约 400×171, 足够精确又保持 <300ms)
 */

export interface SaliencyResult {
  type: 'result';
  saliencyMap: Float32Array;
  width: number;
  height: number;
}

// ============================================================
// CIE Lab
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
// 高斯模糊 — 镜像边界 + 3 轮 box blur
// ============================================================
function mirrorIdx(i: number, max: number): number {
  if (i < 0) return Math.min(-i, max - 1);
  if (i >= max) return Math.max(2 * max - 2 - i, 0);
  return i;
}

function boxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  if (r <= 0) { dst.set(src); return; }
  const iarr = 1.0 / (r + r + 1);
  for (let row = 0; row < h; row++) {
    const base = row * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[base + mirrorIdx(k, w)];
    for (let col = 0; col < w; col++) {
      dst[base + col] = sum * iarr;
      sum -= src[base + mirrorIdx(col - r, w)];
      sum += src[base + mirrorIdx(col + r + 1, w)];
    }
  }
}

function boxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  if (r <= 0) { dst.set(src); return; }
  const iarr = 1.0 / (r + r + 1);
  for (let col = 0; col < w; col++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[mirrorIdx(k, h) * w + col];
    for (let row = 0; row < h; row++) {
      dst[row * w + col] = sum * iarr;
      sum -= src[mirrorIdx(row - r, h) * w + col];
      sum += src[mirrorIdx(row + r + 1, h) * w + col];
    }
  }
}

function gaussBlur(ch: Float32Array, w: number, h: number, sigma: number) {
  if (sigma < 0.5) return;
  const wIdeal = Math.sqrt(12.0 * sigma * sigma / 3 + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const tmp = new Float32Array(ch.length);
  const halfMax = Math.floor(Math.min(w, h) / 2) - 1;
  const radii: number[] = [];
  for (let i = 0; i < 3; i++) {
    const r = i < m ? (wl - 1) / 2 : (wu - 1) / 2;
    radii.push(Math.max(1, Math.min(r, halfMax)));
  }
  for (let p = 0; p < 3; p++) {
    boxBlurH(ch, tmp, w, h, radii[p]);
    boxBlurV(tmp, ch, w, h, radii[p]);
  }
}

// ============================================================
// 信号 1: 多尺度中心-环绕对比度
// ============================================================
function computeCenterSurround(
  labL: Float32Array, labA: Float32Array, labB: Float32Array,
  w: number, h: number, minDim: number,
): Float32Array {
  const n = w * h;
  const result = new Float32Array(n);

  // 3 个尺度: 细节 / 元素 / 构图
  // 小尺度 σ 下限提高到 5, 减少精细纹理噪声 (金框花纹等)
  const scales = [
    { sigma: Math.max(5, minDim * 0.04),  weight: 0.10 }, // 文字笔画、小图标
    { sigma: Math.max(10, minDim * 0.10), weight: 0.35 }, // 按钮、角色、卡牌
    { sigma: Math.max(25, minDim * 0.25), weight: 0.55 }, // 整体构图、大区域差异
  ];

  for (const { sigma, weight } of scales) {
    const bL = labL.slice(), bA = labA.slice(), bB = labB.slice();
    gaussBlur(bL, w, h, sigma);
    gaussBlur(bA, w, h, sigma);
    gaussBlur(bB, w, h, sigma);

    for (let i = 0; i < n; i++) {
      const dL = labL[i] - bL[i];
      const dA = labA[i] - bA[i];
      const dB = labB[i] - bB[i];
      result[i] += weight * Math.sqrt(dL * dL + dA * dA + dB * dB);
    }
  }

  // 归一化到 [0, 1]
  let maxV = 0;
  for (let i = 0; i < n; i++) if (result[i] > maxV) maxV = result[i];
  if (maxV > 0) for (let i = 0; i < n; i++) result[i] /= maxV;

  return result;
}

// ============================================================
// 信号 2: 色彩稀缺度 (Lab 直方图 → 信息论惊奇度)
// ============================================================
function computeColorRarity(
  labL: Float32Array, labA: Float32Array, labB: Float32Array,
  w: number, h: number,
): Float32Array {
  const n = w * h;

  // 量化 Lab 到 12×12×12 = 1728 个桶
  const BINS = 12;
  const hist = new Float32Array(BINS * BINS * BINS);
  const pixelBin = new Uint16Array(n);

  for (let i = 0; i < n; i++) {
    // L: [0, 100] → [0, BINS-1]
    const bl = Math.min(BINS - 1, Math.max(0, Math.floor(labL[i] / 100 * BINS)));
    // a: [-128, 127] → [0, BINS-1]
    const ba = Math.min(BINS - 1, Math.max(0, Math.floor((labA[i] + 128) / 256 * BINS)));
    // b: [-128, 127] → [0, BINS-1]
    const bb = Math.min(BINS - 1, Math.max(0, Math.floor((labB[i] + 128) / 256 * BINS)));
    const key = bl * BINS * BINS + ba * BINS + bb;
    pixelBin[i] = key;
    hist[key]++;
  }

  // 将直方图频次转换为概率
  for (let i = 0; i < hist.length; i++) hist[i] /= n;

  // 每个像素的稀缺度 = -log2(概率) (信息论 "self-information")
  // 高频色 → 低惊奇; 稀有色 → 高惊奇
  const rarity = new Float32Array(n);
  let maxR = 0;
  for (let i = 0; i < n; i++) {
    const p = hist[pixelBin[i]];
    rarity[i] = p > 0 ? -Math.log2(p) : 0;
    if (rarity[i] > maxR) maxR = rarity[i];
  }
  // 归一化到 [0, 1]
  if (maxR > 0) for (let i = 0; i < n; i++) rarity[i] /= maxR;

  // 平滑色彩稀缺度, 合并相邻同类区域
  gaussBlur(rarity, w, h, Math.max(4, Math.min(w, h) * 0.03));

  // 平滑后再次归一化
  let maxR2 = 0;
  for (let i = 0; i < n; i++) if (rarity[i] > maxR2) maxR2 = rarity[i];
  if (maxR2 > 0) for (let i = 0; i < n; i++) rarity[i] /= maxR2;

  return rarity;
}

// ============================================================
// 核心融合
// ============================================================
function computeSaliency(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const n = w * h;
  const minDim = Math.min(w, h);

  // 1. RGB → Lab + 饱和度
  const labL = new Float32Array(n);
  const labA = new Float32Array(n);
  const labB = new Float32Array(n);
  const sat = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const idx = i * 4;
    const R = data[idx], G = data[idx + 1], B = data[idx + 2];
    const [l, a, b] = rgbToLab(R, G, B);
    labL[i] = l; labA[i] = a; labB[i] = b;

    const rr = R / 255, gg = G / 255, bb = B / 255;
    const cMax = Math.max(rr, gg, bb), cMin = Math.min(rr, gg, bb);
    const delta = cMax - cMin;
    const light = (cMax + cMin) / 2;
    sat[i] = delta < 0.001 ? 0 : delta / Math.max(1 - Math.abs(2 * light - 1), 0.01);
  }

  // 2. 计算两路信号
  const cs = computeCenterSurround(labL, labA, labB, w, h, minDim);
  const cr = computeColorRarity(labL, labA, labB, w, h);

  // 3. 融合: CenterSurround × 0.55 + ColorRarity × 0.45
  //    然后乘以饱和度 boost
  const saliency = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const base = 0.55 * cs[i] + 0.45 * cr[i];
    // 饱和度: 低饱和 ×0.6, 高饱和 ×1.2
    saliency[i] = base * (0.6 + 0.6 * Math.min(sat[i], 1));
  }

  // 3.5 ★ 关键: 注意力区域空间平滑
  //     人眼注视的焦点半径约占画面 3-5%,
  //     将像素级碎片热点聚合成连贯的"注意力区域"
  gaussBlur(saliency, w, h, Math.max(6, minDim * 0.04));

  // 4. 归一化
  let maxS = 0;
  for (let i = 0; i < n; i++) if (saliency[i] > maxS) maxS = saliency[i];
  if (maxS > 0) for (let i = 0; i < n; i++) saliency[i] /= maxS;

  // 5. 自适应 sigmoid 对比度增强
  let mean = 0;
  for (let i = 0; i < n; i++) mean += saliency[i];
  mean /= n;

  let variance = 0;
  for (let i = 0; i < n; i++) {
    const d = saliency[i] - mean;
    variance += d * d;
  }
  const stddev = Math.sqrt(variance / n);
  // 自适应陡峭度: 方差小 → k大 (强拉对比), 方差大 → k 小 (保持分布)
  const k = stddev > 0.001 ? Math.min(15, Math.max(5, 1.2 / stddev)) : 8;

  for (let i = 0; i < n; i++) {
    saliency[i] = 1.0 / (1.0 + Math.exp(-k * (saliency[i] - mean)));
  }

  // 6. 最终归一化
  let minS = Infinity, maxS2 = -Infinity;
  for (let i = 0; i < n; i++) {
    if (saliency[i] < minS) minS = saliency[i];
    if (saliency[i] > maxS2) maxS2 = saliency[i];
  }
  const range = maxS2 - minS;
  if (range > 0) for (let i = 0; i < n; i++) saliency[i] = (saliency[i] - minS) / range;

  return saliency;
}

// ============================================================
// API
// ============================================================

/**
 * 分析图片视觉显著性
 * maxDim=400: 横屏游戏截图 → ~400×171, 约 150-300ms
 */
export function analyzeSaliency(
  image: HTMLImageElement,
  maxDim: number = 400,
): Promise<SaliencyResult> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      const t0 = performance.now();

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

      const elapsed = (performance.now() - t0).toFixed(0);
      const minDim = Math.min(w, h);
      console.log(
        `Saliency: ${elapsed}ms (${w}×${h}) ` +
        `σ_cs=[${Math.max(5, minDim * 0.04).toFixed(0)}, ${Math.max(10, minDim * 0.10).toFixed(0)}, ${Math.max(25, minDim * 0.25).toFixed(0)}] ` +
        `σ_smooth=${Math.max(6, minDim * 0.04).toFixed(0)} bins=12³`,
      );

      resolve({ type: 'result', saliencyMap, width: w, height: h });
    });
  });
}

/**
 * 显著性图 → 热力图
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

    // 色谱: 深蓝→蓝→青→绿→黄→橙→红
    let r = 0, g = 0, b = 0;
    if (v < 0.15) {
      const t = v / 0.15;
      b = Math.round(60 + t * 120);
    } else if (v < 0.3) {
      const t = (v - 0.15) / 0.15;
      g = Math.round(t * 180); b = Math.round(180 + t * 75);
    } else if (v < 0.45) {
      const t = (v - 0.3) / 0.15;
      g = Math.round(180 + t * 75); b = Math.round(255 * (1 - t));
    } else if (v < 0.6) {
      const t = (v - 0.45) / 0.15;
      r = Math.round(t * 220); g = 255;
    } else if (v < 0.75) {
      const t = (v - 0.6) / 0.15;
      r = Math.round(220 + t * 35); g = Math.round(255 * (1 - t * 0.55));
    } else if (v < 0.9) {
      const t = (v - 0.75) / 0.15;
      r = 255; g = Math.round(115 * (1 - t));
    } else {
      r = 255; g = 0; b = Math.round((v - 0.9) / 0.1 * 60);
    }

    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = Math.round((0.08 + v * 0.92) * opacity * 255);
  }

  return new ImageData(data, width, height);
}

export function terminateWorker() { /* no-op */ }
