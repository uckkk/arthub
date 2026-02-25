/**
 * WCAG 2.1 对比度计算 + DPI 物理尺寸检测
 */

// ---- 色彩转换 ----

/** sRGB → 相对亮度 (WCAG 2.1 定义) */
export function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** 计算两色对比度 (WCAG 2.1) */
export function contrastRatio(
  fg: [number, number, number],
  bg: [number, number, number],
): number {
  const l1 = relativeLuminance(...fg);
  const l2 = relativeLuminance(...bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---- WCAG 等级判定 ----

export type WCAGLevel = 'AAA' | 'AA' | 'AA-Large' | 'Fail';

/** 判定 WCAG 等级 */
export function getWCAGLevel(ratio: number, isLargeText: boolean = false): WCAGLevel {
  if (isLargeText) {
    if (ratio >= 4.5) return 'AAA';
    if (ratio >= 3) return 'AA';
    return 'Fail';
  }
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA-Large'; // 仅大文本通过
  return 'Fail';
}

/** WCAG 等级颜色 */
export function getWCAGColor(level: WCAGLevel): string {
  switch (level) {
    case 'AAA': return '#22c55e'; // green
    case 'AA': return '#3b82f6'; // blue
    case 'AA-Large': return '#f59e0b'; // amber
    case 'Fail': return '#ef4444'; // red
  }
}

// ---- DPI 物理尺寸检测 ----

export interface PhysicalSizeResult {
  /** 逻辑像素 */
  logicalPx: number;
  /** 物理像素 (px * dpr) */
  physicalPx: number;
  /** 物理尺寸 (mm) */
  physicalMm: number;
  /** 物理尺寸 (pt, 1pt = 1/72 inch) */
  physicalPt: number;
  /** 是否通过最小尺寸检测 */
  pass: boolean;
  /** 警告信息 */
  warning?: string;
}

/**
 * 计算物理尺寸
 * @param logicalPx 逻辑像素值
 * @param ppi 设备像素密度 (如 iPhone 15 Pro = 460 ppi)
 * @param dpr 设备像素比 (如 3x)
 * @param minPx 最小逻辑像素阈值
 */
export function checkPhysicalSize(
  logicalPx: number,
  ppi: number,
  dpr: number,
  minPx: number = 44,
): PhysicalSizeResult {
  const physicalPx = logicalPx * dpr;
  const inches = physicalPx / ppi;
  const mm = inches * 25.4;
  const pt = inches * 72;

  const pass = logicalPx >= minPx;
  const warning = pass ? undefined : `尺寸 ${logicalPx}px < ${minPx}px 最低要求`;

  return { logicalPx, physicalPx, physicalMm: Math.round(mm * 100) / 100, physicalPt: Math.round(pt * 100) / 100, pass, warning };
}

/**
 * 检测文本可读性 (WCAG + 物理尺寸)
 */
export function checkTextReadability(
  fontSize: number,
  ppi: number,
  dpr: number,
): { pass: boolean; warning?: string } {
  const minFontSize = 18; // 逻辑px
  if (fontSize < minFontSize) {
    return { pass: false, warning: `文本 ${fontSize}px < ${minFontSize}px 移动端最小推荐值` };
  }
  // 物理尺寸检查 (最少约 2.5mm 高)
  const physicalMm = (fontSize * dpr / ppi) * 25.4;
  if (physicalMm < 2.5) {
    return { pass: false, warning: `文本物理高度 ${physicalMm.toFixed(1)}mm < 2.5mm` };
  }
  return { pass: true };
}

/**
 * 检测触控目标尺寸 (WCAG 2.5.5)
 */
export function checkTouchTarget(
  widthPx: number,
  heightPx: number,
  minPx: number = 44,
): { pass: boolean; warning?: string } {
  if (widthPx < minPx || heightPx < minPx) {
    return {
      pass: false,
      warning: `触控目标 ${widthPx}×${heightPx}px，最小要求 ${minPx}×${minPx}px`,
    };
  }
  return { pass: true };
}

// ---- 画布取色 ----

/**
 * 从 Canvas 指定坐标取色
 */
export function pickColor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): [number, number, number] {
  const pixel = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
  return [pixel[0], pixel[1], pixel[2]];
}

/**
 * 从 Canvas 取区域平均色 (5x5 采样)
 */
export function pickAreaColor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number = 2,
): [number, number, number] {
  const size = radius * 2 + 1;
  const px = Math.max(0, Math.round(x - radius));
  const py = Math.max(0, Math.round(y - radius));
  const imageData = ctx.getImageData(px, py, size, size);
  const data = imageData.data;
  let r = 0, g = 0, b = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0) { // 忽略透明像素
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count++;
    }
  }
  if (count === 0) return [0, 0, 0];
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}

/** RGB → Hex */
export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

/** Hex → RGB */
export function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m) return [0, 0, 0];
  return [parseInt(m[0], 16), parseInt(m[1], 16), parseInt(m[2], 16)];
}

// ---- 渐变感知 WCAG 审计 ----

type RGB = [number, number, number];

/**
 * 沿元素边界外扩 offset 像素，等距采样 numPoints 个背景色
 * 同时取元素内部 20%-80% 区域的众数作为前景色
 */
export function sampleGradientAware(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  offset: number = 4,
  numPoints: number = 16,
): { fgColor: RGB; bgSamples: RGB[]; bgWorst: RGB; minContrast: number; avgContrast: number } | null {
  if (w < 4 || h < 4) return null;
  const cW = ctx.canvas.width, cH = ctx.canvas.height;

  // --- 前景色：内部 20%-80% 区域众数 ---
  const inX = Math.round(x + w * 0.2), inY = Math.round(y + h * 0.2);
  const inW = Math.max(2, Math.round(w * 0.6)), inH = Math.max(2, Math.round(h * 0.6));
  const fgColor = sampleModeColor(ctx, inX, inY, inW, inH);
  if (!fgColor) return null;

  // --- 背景色：外扩环形等距采样 ---
  const bgSamples: RGB[] = [];
  const perimeter = 2 * (w + h + offset * 4);
  const step = perimeter / numPoints;

  for (let i = 0; i < numPoints; i++) {
    let dist = i * step;
    let sx: number, sy: number;

    const topLen = w + offset * 2;
    const rightLen = h + offset * 2;
    const bottomLen = topLen;

    if (dist < topLen) {
      sx = x - offset + dist;
      sy = y - offset;
    } else if (dist < topLen + rightLen) {
      const d = dist - topLen;
      sx = x + w + offset;
      sy = y - offset + d;
    } else if (dist < topLen + rightLen + bottomLen) {
      const d = dist - topLen - rightLen;
      sx = x + w + offset - d;
      sy = y + h + offset;
    } else {
      const d = dist - topLen - rightLen - bottomLen;
      sx = x - offset;
      sy = y + h + offset - d;
    }

    sx = Math.max(0, Math.min(cW - 1, Math.round(sx)));
    sy = Math.max(0, Math.min(cH - 1, Math.round(sy)));
    bgSamples.push(pickAreaColor(ctx, sx, sy, 1));
  }

  // --- 计算所有采样点的对比度 ---
  let minContrast = Infinity;
  let worstIdx = 0;
  let totalContrast = 0;

  for (let i = 0; i < bgSamples.length; i++) {
    const cr = contrastRatio(fgColor, bgSamples[i]);
    totalContrast += cr;
    if (cr < minContrast) {
      minContrast = cr;
      worstIdx = i;
    }
  }

  return {
    fgColor,
    bgSamples,
    bgWorst: bgSamples[worstIdx],
    minContrast,
    avgContrast: totalContrast / bgSamples.length,
  };
}

/**
 * 取区域内的众数颜色（量化到 6-bit 后取频率最高的）
 */
function sampleModeColor(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
): RGB | null {
  try {
    const canvasW = ctx.canvas.width, canvasH = ctx.canvas.height;
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(canvasW, Math.floor(x + w));
    const y1 = Math.min(canvasH, Math.floor(y + h));
    const w2 = x1 - x0, h2 = y1 - y0;
    if (w2 <= 0 || h2 <= 0) return null;
    const data = ctx.getImageData(x0, y0, w2, h2).data;
    if (data.length < 4) return null;

    const colorMap = new Map<number, { r: number; g: number; b: number; count: number }>();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const qr = data[i] >> 2, qg = data[i + 1] >> 2, qb = data[i + 2] >> 2;
      const key = (qr << 12) | (qg << 6) | qb;
      const entry = colorMap.get(key);
      if (entry) {
        entry.r += data[i]; entry.g += data[i + 1]; entry.b += data[i + 2];
        entry.count++;
      } else {
        colorMap.set(key, { r: data[i], g: data[i + 1], b: data[i + 2], count: 1 });
      }
    }

    let best: { r: number; g: number; b: number; count: number } | null = null;
    for (const entry of colorMap.values()) {
      if (!best || entry.count > best.count) best = entry;
    }
    if (!best) return null;
    return [Math.round(best.r / best.count), Math.round(best.g / best.count), Math.round(best.b / best.count)];
  } catch { return null; }
}

// ---- 批量 WCAG 审计 ----

export interface WCAGAuditItem {
  elementId: string;
  label: string;
  x: number; y: number; w: number; h: number;
  fgColor: RGB;
  bgWorstColor: RGB;
  minContrast: number;
  avgContrast: number;
  wcagLevel: WCAGLevel;
  wcagLevelLarge: WCAGLevel;
  pass: boolean;
  passLarge: boolean;
  bgSamples: RGB[];
  touchTargetPass: boolean;
  touchTargetWarning?: string;
}

export interface WCAGAuditReport {
  items: WCAGAuditItem[];
  passCount: number;
  failCount: number;
  passRate: number;
  overallLevel: WCAGLevel;
  timestamp: number;
}

/**
 * 对所有检测到的元素执行完整 WCAG 审计
 */
export function batchWCAGAudit(
  ctx: CanvasRenderingContext2D,
  elements: Array<{ id: string; label: string; x: number; y: number; w: number; h: number }>,
  minTouchPx: number = 44,
): WCAGAuditReport {
  const items: WCAGAuditItem[] = [];

  for (const el of elements) {
    const result = sampleGradientAware(ctx, el.x, el.y, el.w, el.h);
    if (!result) continue;

    const level = getWCAGLevel(result.minContrast, false);
    const levelLarge = getWCAGLevel(result.minContrast, true);
    const touch = checkTouchTarget(el.w, el.h, minTouchPx);

    items.push({
      elementId: el.id,
      label: el.label,
      x: el.x, y: el.y, w: el.w, h: el.h,
      fgColor: result.fgColor,
      bgWorstColor: result.bgWorst,
      minContrast: result.minContrast,
      avgContrast: result.avgContrast,
      wcagLevel: level,
      wcagLevelLarge: levelLarge,
      pass: level !== 'Fail',
      passLarge: levelLarge !== 'Fail',
      bgSamples: result.bgSamples,
      touchTargetPass: touch.pass,
      touchTargetWarning: touch.warning,
    });
  }

  const passCount = items.filter(i => i.pass).length;
  const failCount = items.length - passCount;
  const passRate = items.length > 0 ? passCount / items.length : 1;

  let worstLevel: WCAGLevel = 'AAA';
  for (const item of items) {
    if (item.wcagLevel === 'Fail') { worstLevel = 'Fail'; break; }
    if (item.wcagLevel === 'AA-Large' && worstLevel !== 'Fail') worstLevel = 'AA-Large';
    if (item.wcagLevel === 'AA' && (worstLevel === 'AAA')) worstLevel = 'AA';
  }

  return { items, passCount, failCount, passRate, overallLevel: worstLevel, timestamp: Date.now() };
}
