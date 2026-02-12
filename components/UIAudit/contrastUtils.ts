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
