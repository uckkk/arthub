/**
 * 视觉显著性分析 Web Worker
 * 算法: Frequency-tuned Saliency (简化版)
 * 原理: 高对比度、高饱和度区域 → 注意力权重更高
 */

// Worker 消息类型
export interface SaliencyRequest {
  type: 'analyze';
  imageData: ImageData;
  /** 下采样倍率 (加速) */
  downsample: number;
}

export interface SaliencyResult {
  type: 'result';
  /** 归一化 0-1 的显著性图 (与 imageData 同尺寸) */
  saliencyMap: Float32Array;
  width: number;
  height: number;
}

// ---- Worker 逻辑 ----
const workerCode = `
'use strict';

// Lab 色彩空间转换 (用于更准确的感知差异)
function sRGBtoLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToXYZ(r, g, b) {
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.0721750 * b,
    0.0193339 * r + 0.1191920 * g + 0.9503041 * b,
  ];
}

function xyzToLab(x, y, z) {
  const Xn = 0.95047, Yn = 1.0, Zn = 1.08883;
  function f(t) { return t > 0.008856 ? Math.pow(t, 1/3) : 7.787 * t + 16/116; }
  const fx = f(x / Xn), fy = f(y / Yn), fz = f(z / Zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function rgbToLab(r, g, b) {
  const lr = sRGBtoLinear(r), lg = sRGBtoLinear(g), lb = sRGBtoLinear(b);
  const [x, y, z] = linearToXYZ(lr, lg, lb);
  return xyzToLab(x, y, z);
}

self.onmessage = function(e) {
  const { imageData, downsample } = e.data;
  const w = imageData.width;
  const h = imageData.height;
  const data = imageData.data;
  const n = w * h;

  // 1. 转换为 Lab 并计算图像平均色
  const labL = new Float32Array(n);
  const labA = new Float32Array(n);
  const labB = new Float32Array(n);
  let avgL = 0, avgA = 0, avgB = 0;

  for (let i = 0; i < n; i++) {
    const idx = i * 4;
    const [l, a, b] = rgbToLab(data[idx], data[idx+1], data[idx+2]);
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

  // 2. 高斯模糊 Lab 图像 (5x5 核, 简化用均值模糊近似)
  const blurR = 2;
  const blurL = new Float32Array(n);
  const blurAc = new Float32Array(n);
  const blurBc = new Float32Array(n);

  // 水平 pass
  const tmpL = new Float32Array(n);
  const tmpA2 = new Float32Array(n);
  const tmpB2 = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sl = 0, sa = 0, sb = 0, cnt = 0;
      for (let dx = -blurR; dx <= blurR; dx++) {
        const nx = x + dx;
        if (nx >= 0 && nx < w) {
          const j = y * w + nx;
          sl += labL[j]; sa += labA[j]; sb += labB[j]; cnt++;
        }
      }
      const j = y * w + x;
      tmpL[j] = sl / cnt;
      tmpA2[j] = sa / cnt;
      tmpB2[j] = sb / cnt;
    }
  }
  // 垂直 pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sl = 0, sa = 0, sb = 0, cnt = 0;
      for (let dy = -blurR; dy <= blurR; dy++) {
        const ny = y + dy;
        if (ny >= 0 && ny < h) {
          const j = ny * w + x;
          sl += tmpL[j]; sa += tmpA2[j]; sb += tmpB2[j]; cnt++;
        }
      }
      const j = y * w + x;
      blurL[j] = sl / cnt;
      blurAc[j] = sa / cnt;
      blurBc[j] = sb / cnt;
    }
  }

  // 3. 计算显著性: ||I_mean - I_blur|| (CIE Lab 欧氏距离)
  const saliency = new Float32Array(n);
  let maxS = 0;
  for (let i = 0; i < n; i++) {
    const dL = avgL - blurL[i];
    const dA = avgA - blurAc[i];
    const dB = avgB - blurBc[i];
    const s = Math.sqrt(dL*dL + dA*dA + dB*dB);
    saliency[i] = s;
    if (s > maxS) maxS = s;
  }

  // 4. 归一化到 0-1
  if (maxS > 0) {
    for (let i = 0; i < n; i++) {
      saliency[i] /= maxS;
    }
  }

  self.postMessage({
    type: 'result',
    saliencyMap: saliency,
    width: w,
    height: h,
  }, [saliency.buffer]);
};
`;

let workerInstance: Worker | null = null;

function getWorker(): Worker {
  if (!workerInstance) {
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    workerInstance = new Worker(url);
  }
  return workerInstance;
}

/**
 * 对图片执行视觉显著性分析
 * @returns 归一化 0-1 的显著性图
 */
export function analyzeSaliency(
  image: HTMLImageElement,
  maxDim: number = 200,
): Promise<SaliencyResult> {
  return new Promise((resolve, reject) => {
    // 下采样到 maxDim 加速分析
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
    const timeout = setTimeout(() => reject(new Error('Saliency analysis timeout')), 10000);

    worker.onmessage = (e: MessageEvent<SaliencyResult>) => {
      clearTimeout(timeout);
      resolve(e.data);
    };
    worker.onerror = (err) => {
      clearTimeout(timeout);
      reject(err);
    };

    worker.postMessage({ type: 'analyze', imageData, downsample: 1 }, [imageData.data.buffer]);
  });
}

/**
 * 将显著性图渲染为热力图 ImageData
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

    // 色谱: 蓝(0) → 青(0.25) → 绿(0.5) → 黄(0.75) → 红(1)
    let r = 0, g = 0, b = 0;
    if (v < 0.25) {
      const t = v / 0.25;
      r = 0; g = Math.round(t * 255); b = 255;
    } else if (v < 0.5) {
      const t = (v - 0.25) / 0.25;
      r = 0; g = 255; b = Math.round((1 - t) * 255);
    } else if (v < 0.75) {
      const t = (v - 0.5) / 0.25;
      r = Math.round(t * 255); g = 255; b = 0;
    } else {
      const t = (v - 0.75) / 0.25;
      r = 255; g = Math.round((1 - t) * 255); b = 0;
    }

    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = Math.round(v * opacity * 255); // 低显著区域更透明
  }

  return new ImageData(data, width, height);
}

export function terminateWorker() {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
}
