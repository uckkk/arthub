/**
 * UI 元素自动检测器 v4 — 双通道互补检测
 *
 * 核心思想: 纯边缘检测不适合游戏 UI (牌面花纹边缘 > 按钮边缘)
 * 改用两条独立通道各自检出候选, 最后合并:
 *
 *   通道 A — 颜色块分析 (主力):
 *     将图像划分为 blockSize×blockSize 小块, 计算每块均值色,
 *     用颜色相似度 (ΔE < threshold) 聚类相邻块为区域,
 *     提取矩形度高、与周围对比度强的区域作为 UI 控件候选.
 *     优势: 天然适合检测按钮 (纯色/渐变矩形) 且忽略纹理内容.
 *
 *   通道 B — 边缘 + 连通域 (辅助):
 *     传统 Sobel → Otsu → 形态学 → 连通域管线, 补充通道 A 未检出的
 *     高对比小图标 (如倒计时数字、花色符号).
 *
 *   合并: NMS (IoU 0.30) + 包含关系去重 + 置信度排序
 */

/* ================================================================
   公共类型
   ================================================================ */

export interface DetectedBox {
  id: string;
  x: number; y: number; w: number; h: number;
  confidence: number;
  label: 'button' | 'icon' | 'card' | 'region' | 'unknown';
  source: 'auto' | 'manual';
}

/* ================================================================
   主入口
   ================================================================ */

export function detectUIElements(
  image: HTMLImageElement,
  screenW: number,
  screenH: number,
  maxDim: number = 400,
): DetectedBox[] {
  const { canvas, ctx, scale } = prepareWorkCanvas(image, maxDim);
  const w = canvas.width, h = canvas.height;
  const pixels = ctx.getImageData(0, 0, w, h).data;

  // ---- 通道 A: 颜色块分析 (主力) ----
  const colorBoxes = detectByColorBlocks(pixels, w, h);

  // ---- 通道 B: 边缘连通域 (辅助) ----
  const edgeBoxes = detectByEdges(pixels, w, h);

  // ---- 合并两个通道 ----
  const allBoxes = [...colorBoxes, ...edgeBoxes];

  // ---- 过滤 ----
  const minArea = w * h * 0.003;
  const maxArea = w * h * 0.50;
  const minDim = Math.min(w, h) * 0.035;

  const filtered = allBoxes.filter(b => {
    const a = b.w * b.h;
    if (a < minArea || a > maxArea) return false;
    const aspect = b.w / b.h;
    if (aspect < 0.18 || aspect > 5.5) return false;
    if (Math.min(b.w, b.h) < minDim) return false;
    return true;
  });

  // NMS + 去包含
  const nms = nonMaxSuppression(filtered, 0.30);
  const clean = removeContained(nms, 0.65);

  // ★ 大框内部分割: 面积 > 8% 画面的框, 尝试用梯度投影分割为子元素
  const splitThreshold = w * h * 0.08;
  const gray = toGrayscale(pixels, w, h);
  const finalBoxes: RawBox[] = [];
  for (const b of clean) {
    if (b.area > splitThreshold) {
      const subs = trySplitByProjection(gray, w, h, b);
      if (subs.length >= 2) {
        // 分割成功, 用子框替代原框
        for (const sub of subs) {
          if (sub.w * sub.h >= minArea && Math.min(sub.w, sub.h) >= minDim) {
            finalBoxes.push(sub);
          }
        }
        continue;
      }
    }
    finalBoxes.push(b);
  }

  // 映射到屏幕坐标
  const sx = screenW / image.naturalWidth;
  const sy = screenH / image.naturalHeight;
  const minScreenDim = 28;

  const result: DetectedBox[] = [];
  for (const b of finalBoxes) {
    const ox = (b.x / scale) * sx, oy = (b.y / scale) * sy;
    const ow = (b.w / scale) * sx, oh = (b.h / scale) * sy;
    if (Math.min(ow, oh) < minScreenDim) continue;
    if (ow / oh > 6 || oh / ow > 6) continue;

    const cx = ox + ow / 2, cy = oy + oh / 2;
    const edgeDX = Math.min(cx, screenW - cx) / screenW;
    const edgeDY = Math.min(cy, screenH - cy) / screenH;
    const edgeBonus = (edgeDX < 0.12 || edgeDY < 0.12) ? 0.08 : 0;

    result.push({
      id: `auto-${result.length}-${Date.now()}`,
      x: Math.round(ox), y: Math.round(oy),
      w: Math.round(ow), h: Math.round(oh),
      confidence: Math.min(1, b.confidence + edgeBonus),
      label: classifyElement(ow, oh, screenW, screenH),
      source: 'auto' as const,
    });
  }

  result.sort((a, b) => b.confidence - a.confidence);
  return result.slice(0, 30);
}

/* ================================================================
   通道 A: 颜色块分析
   将图像切成小格, 用颜色相似度聚类, 找出矩形色块区域
   ================================================================ */

function detectByColorBlocks(
  pixels: Uint8ClampedArray, w: number, h: number,
): RawBox[] {
  const BLOCK = 5; // 每个块 5×5 px (在 400px 工作分辨率下约 80×45 个块, 更细腻)
  const bw = Math.floor(w / BLOCK);
  const bh = Math.floor(h / BLOCK);
  if (bw < 4 || bh < 4) return [];

  // 1. 计算每个块的均值色 + 内部方差
  const blockR = new Float32Array(bw * bh);
  const blockG = new Float32Array(bw * bh);
  const blockB = new Float32Array(bw * bh);
  const blockVar = new Float32Array(bw * bh);

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let sr = 0, sg = 0, sb = 0, sr2 = 0, sg2 = 0, sb2 = 0, n = 0;
      for (let dy = 0; dy < BLOCK; dy++) {
        for (let dx = 0; dx < BLOCK; dx++) {
          const px = bx * BLOCK + dx, py = by * BLOCK + dy;
          if (px >= w || py >= h) continue;
          const j = (py * w + px) * 4;
          const r = pixels[j], g = pixels[j + 1], b = pixels[j + 2];
          sr += r; sg += g; sb += b;
          sr2 += r * r; sg2 += g * g; sb2 += b * b;
          n++;
        }
      }
      const bi = by * bw + bx;
      blockR[bi] = sr / n; blockG[bi] = sg / n; blockB[bi] = sb / n;
      const vr = sr2 / n - (sr / n) ** 2;
      const vg = sg2 / n - (sg / n) ** 2;
      const vb = sb2 / n - (sb / n) ** 2;
      blockVar[bi] = Math.sqrt((Math.max(0, vr) + Math.max(0, vg) + Math.max(0, vb)) / 3);
    }
  }

  // 2. 用颜色相似度聚类相邻块 (4-连通 BFS)
  //    策略: 种子块需要较低方差 (≤40), 但 BFS 扩展时
  //    允许高方差邻居加入 (按钮内的文字块方差高但均色接近),
  //    只要均色距离 < ΔE 阈值即可.
  //    ΔE 阈值按方差自适应: 两块都低方差 → 严格(28);
  //    任一方高方差 → 收紧(18) 避免把文字纹理扩展到背景.
  const DELTA_E_LOW = 28;   // 两块都低方差时的聚类距离
  const DELTA_E_HIGH = 18;  // 涉及高方差块时收紧, 只合并均色非常接近的
  const SEED_VAR = 40;      // 种子块方差上限 (只从低方差块开始 BFS)
  const JOIN_VAR = 70;      // 扩展允许的最大方差 (含文字/渐变的块)

  const labels = new Int32Array(bw * bh).fill(-1);
  let labelId = 0;
  const queue: number[] = [];

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const bi = by * bw + bx;
      if (labels[bi] >= 0) continue;
      if (blockVar[bi] > SEED_VAR) continue; // 只从低方差块开始

      labels[bi] = labelId;
      queue.length = 0; queue.push(bi); let head = 0;

      while (head < queue.length) {
        const ci = queue[head++];
        const cx = ci % bw, cy = (ci - cx) / bw;
        const neighbors = [
          cy > 0 ? ci - bw : -1,
          cy < bh - 1 ? ci + bw : -1,
          cx > 0 ? ci - 1 : -1,
          cx < bw - 1 ? ci + 1 : -1,
        ];
        for (const ni of neighbors) {
          if (ni < 0 || labels[ni] >= 0) continue;
          if (blockVar[ni] > JOIN_VAR) continue; // 超高方差块不参与

          // 均色距离
          const dr = blockR[ci] - blockR[ni];
          const dg = blockG[ci] - blockG[ni];
          const db = blockB[ci] - blockB[ni];
          const dist = Math.sqrt(dr * dr + dg * dg + db * db);

          // 自适应阈值: 涉及高方差块时收紧
          const threshold = (blockVar[ci] > SEED_VAR || blockVar[ni] > SEED_VAR)
            ? DELTA_E_HIGH : DELTA_E_LOW;

          if (dist < threshold) {
            labels[ni] = labelId;
            queue.push(ni);
          }
        }
      }
      labelId++;
    }
  }

  // 3. 提取聚类的外接矩形
  const minBX = new Int32Array(labelId).fill(bw);
  const minBY = new Int32Array(labelId).fill(bh);
  const maxBX = new Int32Array(labelId).fill(0);
  const maxBY = new Int32Array(labelId).fill(0);
  const clusterCount = new Int32Array(labelId);
  const clusterVarSum = new Float64Array(labelId);

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const l = labels[by * bw + bx]; if (l < 0) continue;
      if (bx < minBX[l]) minBX[l] = bx;
      if (by < minBY[l]) minBY[l] = by;
      if (bx > maxBX[l]) maxBX[l] = bx;
      if (by > maxBY[l]) maxBY[l] = by;
      clusterCount[l]++;
      clusterVarSum[l] += blockVar[by * bw + bx];
    }
  }

  const boxes: RawBox[] = [];
  for (let l = 0; l < labelId; l++) {
    if (clusterCount[l] < 4) continue; // 少于 4 个块太小
    const bx1 = minBX[l], by1 = minBY[l];
    const bx2 = maxBX[l] + 1, by2 = maxBY[l] + 1;
    const bboxBlocks = (bx2 - bx1) * (by2 - by1);

    const rectFill = clusterCount[l] / bboxBlocks;
    if (rectFill < 0.35) continue; // 矩形填充率 ≥ 35%

    // 宽高比初筛 (块级别)
    const blockAspect = (bx2 - bx1) / (by2 - by1);
    if (blockAspect < 0.2 || blockAspect > 5) continue;

    // 像素坐标
    const px = bx1 * BLOCK, py = by1 * BLOCK;
    const pw = (bx2 - bx1) * BLOCK, ph = (by2 - by1) * BLOCK;
    const area = pw * ph;

    // 内部均匀度 (方差越低越好)
    const avgVar = clusterVarSum[l] / clusterCount[l];
    const uniformity = Math.max(0, 1 - avgVar / 60);

    // 边缘对比度: 比较聚类块的均色与其外部邻居块的均色差异
    let borderContrast = 0;
    let borderCount = 0;
    for (let by = minBY[l]; by <= maxBY[l]; by++) {
      for (let bx = minBX[l]; bx <= maxBX[l]; bx++) {
        if (labels[by * bw + bx] !== l) continue;
        // 检查4个邻居
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
          const nx = bx + dx, ny = by + dy;
          if (nx < 0 || nx >= bw || ny < 0 || ny >= bh) continue;
          if (labels[ny * bw + nx] === l) continue; // 同聚类
          const ci = by * bw + bx, ni = ny * bw + nx;
          const dr = blockR[ci] - blockR[ni];
          const dg = blockG[ci] - blockG[ni];
          const db = blockB[ci] - blockB[ni];
          borderContrast += Math.sqrt(dr * dr + dg * dg + db * db);
          borderCount++;
        }
      }
    }
    borderContrast = borderCount > 0 ? borderContrast / borderCount : 0;
    // 归一化到 0-1 (对比度 50+ 视为强对比)
    const normalizedContrast = Math.min(1, borderContrast / 50);

    // 边缘对比度门槛: 与周围差异太小的不算 UI 控件
    if (normalizedContrast < 0.18) continue;

    // 按钮形状加成: 宽高比 1.2~4.0 且面积适中的元素更像按钮
    const areaRatio = area / (w * h);
    const aspect = pw / ph;
    const shapeBonus = (aspect >= 1.2 && aspect <= 4.0 && areaRatio >= 0.005 && areaRatio <= 0.08) ? 0.10 : 0;

    // 综合置信度 (边缘对比度权重最大 + 形状加成)
    const confidence = rectFill * 0.20 + uniformity * 0.20 + normalizedContrast * 0.50 + shapeBonus + 0.10;

    boxes.push({
      x: px, y: py, w: pw, h: ph,
      area, pixelCount: clusterCount[l] * BLOCK * BLOCK,
      rectFill,
      confidence: Math.min(1, Math.max(0, confidence)),
    });
  }

  return boxes;
}

/* ================================================================
   大框内部分割: 梯度投影法
   对大框沿水平/垂直方向投影梯度强度, 找到分隔谷 (低梯度带)
   然后沿谷分割为子框
   ================================================================ */

function trySplitByProjection(
  gray: Float32Array, imgW: number, imgH: number, box: RawBox,
): RawBox[] {
  const { x, y, w: bw, h: bh } = box;

  // 计算框内水平和垂直梯度投影
  // 水平投影 (按列求和) → 找垂直分隔线
  const hProj = new Float32Array(bw);
  // 垂直投影 (按行求和) → 找水平分隔线
  const vProj = new Float32Array(bh);

  for (let dy = 1; dy < bh - 1; dy++) {
    for (let dx = 1; dx < bw - 1; dx++) {
      const px = x + dx, py = y + dy;
      if (px <= 0 || px >= imgW - 1 || py <= 0 || py >= imgH - 1) continue;
      const idx = py * imgW + px;
      // 简化梯度 (水平+垂直差分)
      const gx = Math.abs(gray[idx + 1] - gray[idx - 1]);
      const gy = Math.abs(gray[idx + imgW] - gray[idx - imgW]);
      hProj[dx] += gx + gy;
      vProj[dy] += gx + gy;
    }
  }

  // 归一化
  for (let i = 0; i < bw; i++) hProj[i] /= bh;
  for (let i = 0; i < bh; i++) vProj[i] /= bw;

  // 找分隔点: 在投影曲线中寻找 "尖峰" (高梯度带 = 分隔线)
  const hSplits = findSplitPoints(hProj, bw, 0.15);
  const vSplits = findSplitPoints(vProj, bh, 0.15);

  // 用分隔点切割框
  // 优先选择分隔点更多的方向
  const useHSplit = hSplits.length > 0 && hSplits.length >= vSplits.length;
  const useVSplit = vSplits.length > 0 && vSplits.length > hSplits.length;

  const results: RawBox[] = [];

  if (useHSplit) {
    // 垂直方向切割 (用水平投影的分隔点)
    const cuts = [0, ...hSplits, bw];
    for (let i = 0; i < cuts.length - 1; i++) {
      const cx = cuts[i], cw = cuts[i + 1] - cuts[i];
      if (cw < bw * 0.08) continue; // 太窄的条跳过
      results.push({
        x: x + cx, y, w: cw, h: bh,
        area: cw * bh, pixelCount: cw * bh,
        rectFill: box.rectFill,
        confidence: box.confidence * 0.95,
      });
    }
  } else if (useVSplit) {
    // 水平方向切割 (用垂直投影的分隔点)
    const cuts = [0, ...vSplits, bh];
    for (let i = 0; i < cuts.length - 1; i++) {
      const cy = cuts[i], ch = cuts[i + 1] - cuts[i];
      if (ch < bh * 0.08) continue;
      results.push({
        x, y: y + cy, w: bw, h: ch,
        area: bw * ch, pixelCount: bw * ch,
        rectFill: box.rectFill,
        confidence: box.confidence * 0.95,
      });
    }
  }

  // 如果两个方向都有分隔 → 做网格切割
  if (hSplits.length > 0 && vSplits.length > 0 && !useHSplit && !useVSplit) {
    // 不会执行到这里 (上面的 if/else if 覆盖了), 但保留逻辑以防
  }

  // 只有切出 ≥ 2 块才算成功
  return results.length >= 2 ? results : [];
}

/** 在投影曲线中寻找高梯度峰值 (分隔线位置) */
function findSplitPoints(proj: Float32Array, len: number, peakRatio: number): number[] {
  if (len < 10) return [];

  // 计算中间 80% 区域的均值和最大值
  const margin = Math.floor(len * 0.1);
  let sum = 0, max = 0;
  for (let i = margin; i < len - margin; i++) {
    sum += proj[i];
    if (proj[i] > max) max = proj[i];
  }
  const avg = sum / (len - 2 * margin);
  if (max < 5) return []; // 梯度太弱, 没有明显分隔

  // 阈值 = 平均值 + (最大值 - 平均值) × peakRatio
  const threshold = avg + (max - avg) * peakRatio;

  // 找连续高梯度带的中心点
  const splits: number[] = [];
  let inPeak = false, peakStart = 0;
  for (let i = margin; i < len - margin; i++) {
    if (proj[i] >= threshold) {
      if (!inPeak) { inPeak = true; peakStart = i; }
    } else {
      if (inPeak) {
        const center = Math.round((peakStart + i) / 2);
        // 分隔点间距 ≥ 总长的 8%, 避免太密
        if (splits.length === 0 || center - splits[splits.length - 1] >= len * 0.08) {
          splits.push(center);
        }
        inPeak = false;
      }
    }
  }
  return splits;
}

/* ================================================================
   通道 B: 边缘 + 连通域 (v1 原始管线, 作为辅助)
   ================================================================ */

function detectByEdges(
  pixels: Uint8ClampedArray, w: number, h: number,
): RawBox[] {
  const gray = toGrayscale(pixels, w, h);
  gaussBlur3x3(gray, w, h);
  const gradient = sobelGradient(gray, w, h);
  const thresh = otsuThreshold(gradient, w, h);

  const edgeMap = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) edgeMap[i] = gradient[i] >= thresh ? 1 : 0;

  // 温和形态学: 膨胀 3 → 腐蚀 1
  let morphed = edgeMap;
  for (let i = 0; i < 3; i++) morphed = dilate(morphed, w, h);
  morphed = erode(morphed, w, h);

  const regionMap = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) regionMap[i] = morphed[i] === 0 ? 1 : 0;

  const { labels, count } = connectedComponents(regionMap, w, h);

  // 提取框
  const minX = new Int32Array(count).fill(w);
  const minY = new Int32Array(count).fill(h);
  const maxX = new Int32Array(count).fill(0);
  const maxY = new Int32Array(count).fill(0);
  const pixCount = new Int32Array(count);

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = labels[y * w + x]; if (l < 0) continue;
    if (x < minX[l]) minX[l] = x; if (y < minY[l]) minY[l] = y;
    if (x > maxX[l]) maxX[l] = x; if (y > maxY[l]) maxY[l] = y;
    pixCount[l]++;
  }

  const boxes: RawBox[] = [];
  for (let l = 0; l < count; l++) {
    if (pixCount[l] < 15) continue;
    const bx = minX[l], by = minY[l];
    const bw = maxX[l] - minX[l] + 1, bh = maxY[l] - minY[l] + 1;
    const bboxArea = bw * bh;
    const rectFill = pixCount[l] / bboxArea;
    if (rectFill < 0.25) continue;

    const sizeScore = Math.min(1, bboxArea / (w * h * 0.015));
    // 通道 B 置信度: 不再大幅降权, 让两个通道公平竞争
    const confidence = rectFill * 0.50 + sizeScore * 0.50;
    boxes.push({
      x: bx, y: by, w: bw, h: bh,
      area: bboxArea, pixelCount: pixCount[l], rectFill,
      confidence: Math.min(1, Math.max(0, confidence * 0.90)),
    });
  }

  // 空间合并 (同 v3)
  const mergeDistance = Math.min(w, h) * 0.025;
  return spatialMerge(boxes, mergeDistance, w, h);
}

/* ================================================================
   基础图像处理函数
   ================================================================ */

function prepareWorkCanvas(
  image: HTMLImageElement, maxDim: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; scale: number } {
  const iw = image.naturalWidth, ih = image.naturalHeight;
  const maxSide = Math.max(iw, ih);
  const scale = maxSide > maxDim ? maxDim / maxSide : 1;
  const cw = Math.round(iw * scale), ch = Math.round(ih * scale);
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0, cw, ch);
  return { canvas, ctx, scale };
}

function toGrayscale(rgba: Uint8ClampedArray, w: number, h: number): Float32Array {
  const n = w * h, gray = new Float32Array(n);
  for (let i = 0; i < n; i++) { const j = i * 4; gray[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]; }
  return gray;
}

function gaussBlur3x3(data: Float32Array, w: number, h: number): void {
  const tmp = new Float32Array(data.length);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    tmp[i] = (data[i - w - 1] + 2 * data[i - w] + data[i - w + 1] +
      2 * data[i - 1] + 4 * data[i] + 2 * data[i + 1] +
      data[i + w - 1] + 2 * data[i + w] + data[i + w + 1]) / 16;
  }
  data.set(tmp);
}

function sobelGradient(gray: Float32Array, w: number, h: number): Float32Array {
  const grad = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = -gray[i - w - 1] + gray[i - w + 1] - 2 * gray[i - 1] + 2 * gray[i + 1] - gray[i + w - 1] + gray[i + w + 1];
    const gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
    grad[i] = Math.sqrt(gx * gx + gy * gy);
  }
  return grad;
}

function otsuThreshold(data: Float32Array, w: number, h: number): number {
  const n = w * h, hist = new Float64Array(256);
  let maxVal = 0;
  for (let i = 0; i < n; i++) if (data[i] > maxVal) maxVal = data[i];
  if (maxVal === 0) return 0;
  const s = 255 / maxVal;
  for (let i = 0; i < n; i++) hist[Math.min(255, Math.round(data[i] * s))]++;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumBg = 0, wBg = 0, bestThresh = 0, bestVar = 0;
  for (let t = 0; t < 256; t++) {
    wBg += hist[t]; if (wBg === 0) continue;
    const wFg = n - wBg; if (wFg === 0) break;
    sumBg += t * hist[t];
    const v = wBg * wFg * ((sumBg / wBg) - ((sumAll - sumBg) / wFg)) ** 2;
    if (v > bestVar) { bestVar = v; bestThresh = t; }
  }
  return bestThresh / s;
}

function dilate(map: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    for (let dy = -1; dy <= 1 && !v; dy++) for (let dx = -1; dx <= 1 && !v; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && map[ny * w + nx]) v = 1;
    }
    out[y * w + x] = v;
  }
  return out;
}

function erode(map: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let all = true;
    for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1 && all; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h || !map[ny * w + nx]) all = false;
    }
    out[y * w + x] = all ? 1 : 0;
  }
  return out;
}

function connectedComponents(
  regionMap: Uint8Array, w: number, h: number,
): { labels: Int32Array; count: number } {
  const labels = new Int32Array(w * h).fill(-1);
  let labelId = 0;
  const queue: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (regionMap[i] === 0 || labels[i] >= 0) continue;
    labels[i] = labelId; queue.length = 0; queue.push(i); let head = 0;
    while (head < queue.length) {
      const ci = queue[head++]; const cx = ci % w, cy = (ci - cx) / w;
      for (const ni of [cy > 0 ? ci - w : -1, cy < h - 1 ? ci + w : -1, cx > 0 ? ci - 1 : -1, cx < w - 1 ? ci + 1 : -1]) {
        if (ni >= 0 && regionMap[ni] === 1 && labels[ni] < 0) { labels[ni] = labelId; queue.push(ni); }
      }
    }
    labelId++;
  }
  return { labels, count: labelId };
}

/* ================================================================
   后处理: 空间合并 / NMS / 去包含
   ================================================================ */

interface RawBox {
  x: number; y: number; w: number; h: number;
  area: number; pixelCount: number; rectFill: number;
  confidence: number;
}

function spatialMerge(boxes: RawBox[], dist: number, imgW: number, imgH: number): RawBox[] {
  if (boxes.length === 0) return [];
  const parent = boxes.map((_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };

  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    if (find(i) === find(j)) continue;
    if (boxGap(boxes[i], boxes[j]) < dist) {
      const mx = Math.min(boxes[i].x, boxes[j].x), my = Math.min(boxes[i].y, boxes[j].y);
      const mx2 = Math.max(boxes[i].x + boxes[i].w, boxes[j].x + boxes[j].w);
      const my2 = Math.max(boxes[i].y + boxes[i].h, boxes[j].y + boxes[j].h);
      if ((mx2 - mx) * (my2 - my) < imgW * imgH * 0.35) union(i, j);
    }
  }

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < boxes.length; i++) {
    const r = find(i);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r)!.push(i);
  }

  const result: RawBox[] = [];
  for (const indices of clusters.values()) {
    let mx = Infinity, my = Infinity, mx2 = 0, my2 = 0, tp = 0, mc = 0;
    for (const i of indices) {
      const b = boxes[i];
      mx = Math.min(mx, b.x); my = Math.min(my, b.y);
      mx2 = Math.max(mx2, b.x + b.w); my2 = Math.max(my2, b.y + b.h);
      tp += b.pixelCount; mc = Math.max(mc, b.confidence);
    }
    const bw = mx2 - mx, bh = my2 - my;
    result.push({
      x: mx, y: my, w: bw, h: bh,
      area: bw * bh, pixelCount: tp,
      rectFill: Math.min(1, tp / (bw * bh)),
      confidence: Math.min(1, mc + (indices.length > 1 ? 0.05 : 0)),
    });
  }
  return result;
}

function boxGap(a: RawBox, b: RawBox): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  return Math.sqrt(dx * dx + dy * dy);
}

function nonMaxSuppression(boxes: RawBox[], iouThreshold: number): RawBox[] {
  const sorted = [...boxes].sort((a, b) => b.confidence - a.confidence);
  const keep: RawBox[] = [], suppressed = new Set<number>();
  for (let i = 0; i < sorted.length; i++) {
    if (suppressed.has(i)) continue;
    keep.push(sorted[i]);
    for (let j = i + 1; j < sorted.length; j++) {
      if (!suppressed.has(j) && computeIoU(sorted[i], sorted[j]) > iouThreshold) suppressed.add(j);
    }
  }
  return keep;
}

function removeContained(boxes: RawBox[], threshold: number): RawBox[] {
  return boxes.filter((b, i) =>
    !boxes.some((other, j) => i !== j && other.area > b.area && interArea(b, other) / b.area > threshold)
  );
}

function computeIoU(a: RawBox, b: RawBox): number {
  const inter = interArea(a, b);
  return inter === 0 ? 0 : inter / (a.w * a.h + b.w * b.h - inter);
}

function interArea(a: RawBox, b: RawBox): number {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  return (x2 > x1 && y2 > y1) ? (x2 - x1) * (y2 - y1) : 0;
}

/* ---- 分类 ---- */
function classifyElement(w: number, h: number, screenW: number, screenH: number): DetectedBox['label'] {
  const ratio = (w * h) / (screenW * screenH), aspect = w / h;
  if (ratio < 0.012 && aspect > 0.55 && aspect < 1.8) return 'icon';
  if (ratio < 0.06 && aspect >= 1.5) return 'button';
  if (ratio < 0.035) return 'button';
  if (ratio < 0.20) return 'card';
  return 'region';
}

/* ================================================================
   导出工具函数
   ================================================================ */

export function sampleBoxColors(
  ctx: CanvasRenderingContext2D,
  canvasX: number, canvasY: number, w: number, h: number,
): { fg: [number, number, number]; bg: [number, number, number] } | null {
  if (w < 6 || h < 6) return null;
  try {
    const cw = Math.max(4, Math.round(w * 0.4)), ch = Math.max(4, Math.round(h * 0.4));
    const cx = Math.round(canvasX + (w - cw) / 2), cy = Math.round(canvasY + (h - ch) / 2);
    const cd = ctx.getImageData(cx, cy, cw, ch).data;
    let fR = 0, fG = 0, fB = 0, fN = 0;
    for (let i = 0; i < cd.length; i += 4) { fR += cd[i]; fG += cd[i + 1]; fB += cd[i + 2]; fN++; }
    let bR = 0, bG = 0, bB = 0, bN = 0;
    const td = ctx.getImageData(Math.round(canvasX), Math.round(canvasY), Math.round(w), 2).data;
    for (let i = 0; i < td.length; i += 4) { bR += td[i]; bG += td[i + 1]; bB += td[i + 2]; bN++; }
    const bd = ctx.getImageData(Math.round(canvasX), Math.round(canvasY + h - 2), Math.round(w), 2).data;
    for (let i = 0; i < bd.length; i += 4) { bR += bd[i]; bG += bd[i + 1]; bB += bd[i + 2]; bN++; }
    if (fN === 0 || bN === 0) return null;
    return {
      fg: [Math.round(fR / fN), Math.round(fG / fN), Math.round(fB / fN)],
      bg: [Math.round(bR / bN), Math.round(bG / bN), Math.round(bB / bN)],
    };
  } catch { return null; }
}

export function computeThumbAnchors(
  screenW: number, screenH: number,
  orientation: 'portrait' | 'landscape',
  hand: 'right' | 'left' = 'right',
): { x: number; y: number }[] {
  if (orientation === 'portrait') {
    return hand === 'right'
      ? [{ x: screenW * 0.80, y: screenH * 0.93 }]
      : [{ x: screenW * 0.20, y: screenH * 0.93 }];
  }
  return [
    { x: screenW * 0.05, y: screenH * 0.90 },
    { x: screenW * 0.95, y: screenH * 0.90 },
  ];
}

export function getThumbSize(
  screenW: number, _screenH: number,
  orientation: 'portrait' | 'landscape',
): { rx: number; ry: number } {
  if (orientation === 'portrait') {
    const rx = screenW * 0.10;
    return { rx, ry: rx * 1.35 };
  }
  const rx = screenW * 0.04;
  return { rx, ry: rx * 1.35 };
}
