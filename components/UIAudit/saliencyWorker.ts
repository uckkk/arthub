/**
 * 视觉显著性分析 Web Worker
 * 算法: Frequency-tuned Saliency (简化版)
 * 原理: 高对比度、高饱和度区域 → 注意力权重更高
 */

// Worker 消息类型
export interface SaliencyRequest {
  type: 'analyze';
  /** 原始像素 buffer (RGBA) */
  buffer: ArrayBuffer;
  width: number;
  height: number;
}

export interface SaliencyResult {
  type: 'result';
  /** 归一化 0-1 的显著性图 */
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
  var Xn = 0.95047, Yn = 1.0, Zn = 1.08883;
  function f(t) { return t > 0.008856 ? Math.pow(t, 1/3) : 7.787 * t + 16/116; }
  var fx = f(x / Xn), fy = f(y / Yn), fz = f(z / Zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function rgbToLab(r, g, b) {
  var lr = sRGBtoLinear(r), lg = sRGBtoLinear(g), lb = sRGBtoLinear(b);
  var xyz = linearToXYZ(lr, lg, lb);
  return xyzToLab(xyz[0], xyz[1], xyz[2]);
}

self.onmessage = function(e) {
  try {
    var msg = e.data;
    var data = new Uint8ClampedArray(msg.buffer);
    var w = msg.width;
    var h = msg.height;
    var n = w * h;

    // 1. 转换为 Lab 并计算图像平均色
    var labL = new Float32Array(n);
    var labA = new Float32Array(n);
    var labB = new Float32Array(n);
    var avgL = 0, avgA = 0, avgB = 0;

    for (var i = 0; i < n; i++) {
      var idx = i * 4;
      var lab = rgbToLab(data[idx], data[idx+1], data[idx+2]);
      labL[i] = lab[0];
      labA[i] = lab[1];
      labB[i] = lab[2];
      avgL += lab[0];
      avgA += lab[1];
      avgB += lab[2];
    }
    avgL /= n;
    avgA /= n;
    avgB /= n;

    // 2. 均值模糊 Lab 图像 (5x5 核, 两pass 分离)
    var blurR = 2;

    // 水平 pass
    var tmpL = new Float32Array(n);
    var tmpA2 = new Float32Array(n);
    var tmpB2 = new Float32Array(n);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var sl = 0, sa = 0, sb = 0, cnt = 0;
        for (var dx = -blurR; dx <= blurR; dx++) {
          var nx = x + dx;
          if (nx >= 0 && nx < w) {
            var j = y * w + nx;
            sl += labL[j]; sa += labA[j]; sb += labB[j]; cnt++;
          }
        }
        var j2 = y * w + x;
        tmpL[j2] = sl / cnt;
        tmpA2[j2] = sa / cnt;
        tmpB2[j2] = sb / cnt;
      }
    }

    // 垂直 pass
    var blurL = new Float32Array(n);
    var blurAc = new Float32Array(n);
    var blurBc = new Float32Array(n);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var sl = 0, sa = 0, sb = 0, cnt = 0;
        for (var dy = -blurR; dy <= blurR; dy++) {
          var ny = y + dy;
          if (ny >= 0 && ny < h) {
            var j = ny * w + x;
            sl += tmpL[j]; sa += tmpA2[j]; sb += tmpB2[j]; cnt++;
          }
        }
        var j2 = y * w + x;
        blurL[j2] = sl / cnt;
        blurAc[j2] = sa / cnt;
        blurBc[j2] = sb / cnt;
      }
    }

    // 3. 计算显著性: ||I_mean - I_blur|| (CIE Lab 欧氏距离)
    var saliency = new Float32Array(n);
    var maxS = 0;
    for (var i = 0; i < n; i++) {
      var dL = avgL - blurL[i];
      var dA = avgA - blurAc[i];
      var dB = avgB - blurBc[i];
      var s = Math.sqrt(dL*dL + dA*dA + dB*dB);
      saliency[i] = s;
      if (s > maxS) maxS = s;
    }

    // 4. 归一化到 0-1
    if (maxS > 0) {
      for (var i = 0; i < n; i++) {
        saliency[i] /= maxS;
      }
    }

    self.postMessage({
      type: 'result',
      saliencyMap: saliency,
      width: w,
      height: h,
    }, [saliency.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
`;

// ---- 主线程回退版本 (Worker 不可用时) ----
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

  const blurR = 2;
  const tmpL = new Float32Array(n), tmpA2 = new Float32Array(n), tmpB2 = new Float32Array(n);
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
      tmpL[j] = sl / cnt; tmpA2[j] = sa / cnt; tmpB2[j] = sb / cnt;
    }
  }

  const blurL = new Float32Array(n), blurAc = new Float32Array(n), blurBc = new Float32Array(n);
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
      blurL[j] = sl / cnt; blurAc[j] = sa / cnt; blurBc[j] = sb / cnt;
    }
  }

  const saliency = new Float32Array(n);
  let maxS = 0;
  for (let i = 0; i < n; i++) {
    const dL = avgL - blurL[i], dA = avgA - blurAc[i], dB = avgB - blurBc[i];
    const s = Math.sqrt(dL * dL + dA * dA + dB * dB);
    saliency[i] = s;
    if (s > maxS) maxS = s;
  }
  if (maxS > 0) {
    for (let i = 0; i < n; i++) saliency[i] /= maxS;
  }
  return saliency;
}

// ---- Worker 管理 ----
let workerInstance: Worker | null = null;
let workerFailed = false; // 标记 Worker 是否不可用

function getWorker(): Worker | null {
  if (workerFailed) return null;
  if (!workerInstance) {
    try {
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      workerInstance = new Worker(url);
      URL.revokeObjectURL(url); // 创建后即可释放
    } catch (e) {
      console.warn('Web Worker 创建失败, 将回退到主线程:', e);
      workerFailed = true;
      return null;
    }
  }
  return workerInstance;
}

/**
 * 对图片执行视觉显著性分析
 * 优先使用 Web Worker，失败时自动回退到主线程
 */
export function analyzeSaliency(
  image: HTMLImageElement,
  maxDim: number = 250,
): Promise<SaliencyResult> {
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

  // Worker 不可用 → 主线程回退
  if (!worker) {
    return new Promise((resolve) => {
      console.log('Saliency: 使用主线程分析...');
      const saliencyMap = analyzeSaliencyMainThread(imageData.data, w, h);
      resolve({ type: 'result', saliencyMap, width: w, height: h });
    });
  }

  // Worker 可用 → 传递原始 buffer (不传 ImageData, 避免结构化克隆问题)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.warn('Saliency Worker 超时, 回退到主线程');
      workerFailed = true;
      terminateWorker();
      const saliencyMap = analyzeSaliencyMainThread(imageData.data, w, h);
      resolve({ type: 'result', saliencyMap, width: w, height: h });
    }, 15000);

    worker.onmessage = (e: MessageEvent) => {
      clearTimeout(timeout);
      if (e.data.type === 'error') {
        console.warn('Saliency Worker 内部错误:', e.data.message, '回退到主线程');
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
      console.warn('Saliency Worker 错误:', msg, '回退到主线程');
      workerFailed = true;
      terminateWorker();
      // 回退到主线程
      const saliencyMap = analyzeSaliencyMainThread(imageData.data, w, h);
      resolve({ type: 'result', saliencyMap, width: w, height: h });
    };

    // 发送原始 ArrayBuffer + 尺寸 (而非 ImageData 对象)
    // 复制 buffer 用于传递, 原始 imageData 保留给回退使用
    const bufferCopy = imageData.data.buffer.slice(0);
    worker.postMessage(
      { type: 'analyze', buffer: bufferCopy, width: w, height: h },
      [bufferCopy], // transferable
    );
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
