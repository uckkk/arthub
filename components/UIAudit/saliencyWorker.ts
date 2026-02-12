/**
 * 视觉显著性分析 — 多尺度中心-环绕对比 (适合游戏 UI)
 *
 * 算法原理:
 *   S(x,y) = Σ_k w_k × ||I(x,y) − I_σk(x,y)||  +  saturation_boost
 *
 * 其中 σk 是不同尺度的高斯模糊, 检测不同层级的视觉特征:
 *   - 小尺度 (σ=2~4):  精细文本、小图标边缘
 *   - 中尺度 (σ=8~16): 按钮、角色细节、UI 元素
 *   - 大尺度 (σ=30+):  大面积色块差异、整体构图
 *
 * 优于 FT Saliency 的原因:
 *   1. 局部对比 (不依赖全局均值) → 不受边界效应影响
 *   2. 多尺度融合 → 同时检测粗细粒度的显著特征
 *   3. 饱和度加权 → 游戏 UI 中高饱和色 = 设计意图上的焦点
 *
 * 全部主线程执行 (200×200 下采样 ≈ 80-150ms)
 */

export interface SaliencyResult {
  type: 'result';
  saliencyMap: Float32Array;
  width: number;
  height: number;
}

// ============================================================
// CIE Lab 色彩空间
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
// 快速高斯模糊 — 3 轮 box blur, 镜像边界填充
// ============================================================

/** 安全取值: 镜像边界 */
function mirrorIdx(i: number, max: number): number {
  if (i < 0) return -i;
  if (i >= max) return 2 * max - 2 - i;
  return i;
}

/** 水平 box blur (镜像边界, 避免 clamp 造成的边缘假显著) */
function boxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  if (r <= 0) { dst.set(src); return; }
  const d = r + r + 1;
  const iarr = 1.0 / d;

  for (let row = 0; row < h; row++) {
    const base = row * w;
    // 初始化窗口和
    let sum = 0;
    for (let k = -r; k <= r; k++) {
      sum += src[base + mirrorIdx(k, w)];
    }
    for (let col = 0; col < w; col++) {
      dst[base + col] = sum * iarr;
      // 滑动: 去掉最左, 加上最右
      sum -= src[base + mirrorIdx(col - r, w)];
      sum += src[base + mirrorIdx(col + r + 1, w)];
    }
  }
}

/** 垂直 box blur (镜像边界) */
function boxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  if (r <= 0) { dst.set(src); return; }
  const d = r + r + 1;
  const iarr = 1.0 / d;

  for (let col = 0; col < w; col++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) {
      sum += src[mirrorIdx(k, h) * w + col];
    }
    for (let row = 0; row < h; row++) {
      dst[row * w + col] = sum * iarr;
      sum -= src[mirrorIdx(row - r, h) * w + col];
      sum += src[mirrorIdx(row + r + 1, h) * w + col];
    }
  }
}

/** 3 轮 box blur ≈ 高斯模糊 (Kovesi 核大小计算) */
function gaussBlur(ch: Float32Array, w: number, h: number, sigma: number) {
  if (sigma < 0.5) return;

  const wIdeal = Math.sqrt(12.0 * sigma * sigma / 3 + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const tmp = new Float32Array(ch.length);
  const radii: number[] = [];
  for (let i = 0; i < 3; i++) {
    const r = i < m ? (wl - 1) / 2 : (wu - 1) / 2;
    radii.push(Math.max(1, Math.min(r, Math.floor(Math.min(w, h) / 2) - 1)));
  }

  for (let p = 0; p < 3; p++) {
    boxBlurH(ch, tmp, w, h, radii[p]);
    boxBlurV(tmp, ch, w, h, radii[p]);
  }
}

// ============================================================
// 核心: 多尺度中心-环绕显著性
// ============================================================
function computeSaliency(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const n = w * h;
  const minDim = Math.min(w, h);

  // 1. RGB → Lab + 饱和度
  const labL = new Float32Array(n);
  const labA = new Float32Array(n);
  const labB = new Float32Array(n);
  const saturation = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const idx = i * 4;
    const R = data[idx], G = data[idx + 1], B = data[idx + 2];

    const [l, a, b] = rgbToLab(R, G, B);
    labL[i] = l;
    labA[i] = a;
    labB[i] = b;

    // 计算 HSL 饱和度
    const rr = R / 255, gg = G / 255, bb = B / 255;
    const cMax = Math.max(rr, gg, bb), cMin = Math.min(rr, gg, bb);
    const delta = cMax - cMin;
    const light = (cMax + cMin) / 2;
    saturation[i] = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1) + 0.001);
  }

  // 2. 多尺度中心-环绕: 在 3 个尺度计算 ||original − blurred||
  const scales = [
    { sigma: Math.max(1.5, minDim * 0.015), weight: 0.25 },  // 精细 (文字/小图标)
    { sigma: Math.max(4, minDim * 0.06),    weight: 0.40 },  // 中等 (按钮/角色)
    { sigma: Math.max(10, minDim * 0.15),   weight: 0.35 },  // 粗略 (大面积区别)
  ];

  const saliency = new Float32Array(n);

  for (const { sigma, weight } of scales) {
    const blurL = labL.slice();
    const blurA = labA.slice();
    const blurB = labB.slice();
    gaussBlur(blurL, w, h, sigma);
    gaussBlur(blurA, w, h, sigma);
    gaussBlur(blurB, w, h, sigma);

    for (let i = 0; i < n; i++) {
      const dL = labL[i] - blurL[i];
      const dA = labA[i] - blurA[i];
      const dB = labB[i] - blurB[i];
      saliency[i] += weight * Math.sqrt(dL * dL + dA * dA + dB * dB);
    }
  }

  // 3. 饱和度加权 (游戏 UI 中高饱和 = 设计焦点)
  for (let i = 0; i < n; i++) {
    // 饱和度 boost: 饱和度 0→×0.7, 饱和度 1→×1.3
    saliency[i] *= (0.7 + 0.6 * Math.min(saturation[i], 1));
  }

  // 4. 归一化到 [0, 1]
  let maxS = 0;
  for (let i = 0; i < n; i++) {
    if (saliency[i] > maxS) maxS = saliency[i];
  }
  if (maxS > 0) {
    for (let i = 0; i < n; i++) saliency[i] /= maxS;
  }

  // 5. 自适应 sigmoid 对比度增强
  let mean = 0;
  for (let i = 0; i < n; i++) mean += saliency[i];
  mean /= n;

  // sigmoid 中心 = 均值, 斜率自适应 (方差小→陡峭, 方差大→平缓)
  let variance = 0;
  for (let i = 0; i < n; i++) {
    const d = saliency[i] - mean;
    variance += d * d;
  }
  variance /= n;
  const stddev = Math.sqrt(variance);
  // k 取值: stddev 小时 k 大 (对比度增强更强)
  const k = stddev > 0 ? Math.min(12, Math.max(4, 1.5 / stddev)) : 8;

  for (let i = 0; i < n; i++) {
    saliency[i] = 1.0 / (1.0 + Math.exp(-k * (saliency[i] - mean)));
  }

  // 6. 再次归一化到 [0, 1]
  let minS = Infinity, maxS2 = -Infinity;
  for (let i = 0; i < n; i++) {
    if (saliency[i] < minS) minS = saliency[i];
    if (saliency[i] > maxS2) maxS2 = saliency[i];
  }
  const range = maxS2 - minS;
  if (range > 0) {
    for (let i = 0; i < n; i++) saliency[i] = (saliency[i] - minS) / range;
  }

  return saliency;
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 对图片执行视觉显著性分析
 * 主线程 + requestAnimationFrame (200×200 ≈ 80-150ms, 不会阻塞 UI)
 */
export function analyzeSaliency(
  image: HTMLImageElement,
  maxDim: number = 200,
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
        `Saliency 分析完成: ${elapsed}ms (${w}×${h}) ` +
        `scales=[${(minDim * 0.015).toFixed(1)}, ${(minDim * 0.06).toFixed(1)}, ${(minDim * 0.15).toFixed(1)}]`,
      );

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
    if (v < 0.15) {
      const t = v / 0.15;
      r = 0; g = 0; b = Math.round(80 + t * 100);
    } else if (v < 0.3) {
      const t = (v - 0.15) / 0.15;
      r = 0; g = Math.round(t * 200); b = Math.round(180 + t * 75);
    } else if (v < 0.45) {
      const t = (v - 0.3) / 0.15;
      r = 0; g = Math.round(200 + t * 55); b = Math.round(255 * (1 - t));
    } else if (v < 0.6) {
      const t = (v - 0.45) / 0.15;
      r = Math.round(t * 200); g = 255; b = 0;
    } else if (v < 0.75) {
      const t = (v - 0.6) / 0.15;
      r = Math.round(200 + t * 55); g = Math.round(255 * (1 - t * 0.5)); b = 0;
    } else if (v < 0.9) {
      const t = (v - 0.75) / 0.15;
      r = 255; g = Math.round(128 * (1 - t)); b = 0;
    } else {
      const t = (v - 0.9) / 0.1;
      r = 255; g = 0; b = Math.round(t * 80); // 红→品红高亮
    }

    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    // 最低 alpha 8%, 高显著区更不透明
    data[idx + 3] = Math.round((0.08 + v * 0.92) * opacity * 255);
  }

  return new ImageData(data, width, height);
}

/** 兼容旧接口 */
export function terminateWorker() {
  // no-op
}
