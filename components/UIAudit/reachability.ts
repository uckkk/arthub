/**
 * 拇指热区 (Reachability) + Fitts's Law
 *
 * 竖屏: 单手操作 → 拇指从右下角发散
 * 横屏: 双手操作 → 左右拇指分别从左下/右下发散
 */

// ---- 拇指热区 ----

export type ReachZone = 'easy' | 'ok' | 'hard';

export interface ReachZoneRect {
  zone: ReachZone;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 热区颜色 */
export const ZONE_COLORS: Record<ReachZone, string> = {
  easy: 'rgba(34, 197, 94, 0.25)',   // 绿色 - 舒适
  ok: 'rgba(250, 204, 21, 0.25)',    // 黄色 - 可达
  hard: 'rgba(239, 68, 68, 0.25)',   // 红色 - 困难
};

export const ZONE_LABELS: Record<ReachZone, string> = {
  easy: '舒适区',
  ok: '可达区',
  hard: '困难区',
};

/**
 * 计算竖屏单手 (右手) 热区
 * 基于 Steven Hoober 单手操作研究
 *
 * 三个椭圆弧区域:
 * - easy: 屏幕下半部中央 (拇指自然触达)
 * - ok:   屏幕中间带 (需要略微伸展)
 * - hard: 屏幕上方+左上角 (需要重新握持)
 */
export function getPortraitReachZones(
  sw: number,
  sh: number,
): { zones: ReachZoneRect[] } {
  // 简化为水平分带模型 (更准确的是椭圆模型，但分带足够直观)
  const easyTop = sh * 0.55;
  const okTop = sh * 0.25;

  return {
    zones: [
      // Hard: 顶部 25%
      { zone: 'hard', x: 0, y: 0, w: sw, h: okTop },
      // OK: 中间 30%
      { zone: 'ok', x: 0, y: okTop, w: sw, h: easyTop - okTop },
      // Easy: 底部 45%
      { zone: 'easy', x: 0, y: easyTop, w: sw, h: sh - easyTop },
    ],
  };
}

/**
 * 计算横屏双手热区
 * 游戏场景: 左右拇指分别操作
 *
 * - easy: 左右边缘底部 (拇指自然位置)
 * - ok:   左右边缘中部
 * - hard: 屏幕中央 (双手都难以触达)
 */
export function getLandscapeReachZones(
  sw: number,
  sh: number,
): { zones: ReachZoneRect[] } {
  const thumbWidth = sw * 0.25; // 左右各 25% 宽度是拇指区域
  const centerWidth = sw - thumbWidth * 2;
  const easyTop = sh * 0.45;

  return {
    zones: [
      // Hard: 中央全高
      { zone: 'hard', x: thumbWidth, y: 0, w: centerWidth, h: sh },
      // Left OK: 左侧上部
      { zone: 'ok', x: 0, y: 0, w: thumbWidth, h: easyTop },
      // Left Easy: 左侧下部
      { zone: 'easy', x: 0, y: easyTop, w: thumbWidth, h: sh - easyTop },
      // Right OK: 右侧上部
      { zone: 'ok', x: sw - thumbWidth, y: 0, w: thumbWidth, h: easyTop },
      // Right Easy: 右侧下部
      { zone: 'easy', x: sw - thumbWidth, y: easyTop, w: thumbWidth, h: sh - easyTop },
    ],
  };
}

/**
 * 在 Canvas 上绘制热区遮罩
 */
export function drawReachabilityOverlay(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  sw: number,
  sh: number,
  orientation: 'portrait' | 'landscape',
): void {
  const { zones } = orientation === 'portrait'
    ? getPortraitReachZones(sw, sh)
    : getLandscapeReachZones(sw, sh);

  ctx.save();

  for (const z of zones) {
    ctx.fillStyle = ZONE_COLORS[z.zone];
    ctx.fillRect(screenX + z.x, screenY + z.y, z.w, z.h);
  }

  // 绘制区域标签
  ctx.font = `${Math.max(11, sw * 0.025)}px "SF Pro Display", -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const drawnLabels = new Set<string>();
  for (const z of zones) {
    const key = z.zone;
    if (drawnLabels.has(key) && orientation === 'landscape') continue; // 横屏只在一侧标
    drawnLabels.add(key);

    const cx = screenX + z.x + z.w / 2;
    const cy = screenY + z.y + z.h / 2;

    // 背景胶囊
    const label = ZONE_LABELS[z.zone];
    const metrics = ctx.measureText(label);
    const pw = metrics.width + 16;
    const ph = 22;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    const rr = ph / 2;
    ctx.moveTo(cx - pw / 2 + rr, cy - ph / 2);
    ctx.lineTo(cx + pw / 2 - rr, cy - ph / 2);
    ctx.arc(cx + pw / 2 - rr, cy, rr, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(cx - pw / 2 + rr, cy + ph / 2);
    ctx.arc(cx - pw / 2 + rr, cy, rr, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.fillText(label, cx, cy + 1);
  }

  ctx.restore();
}

// ---- Fitts's Law ----

export interface FittsResult {
  /** 起点 */
  from: { x: number; y: number };
  /** 终点 */
  to: { x: number; y: number };
  /** 目标宽度 (px, 默认 44) */
  targetWidth: number;
  /** 距离 (px) */
  distance: number;
  /** 难度指数 (ID = log2(D/W + 1)) */
  indexOfDifficulty: number;
  /** 预估操作时间 (ms) */
  estimatedTime: number;
  /** 评级 */
  rating: 'easy' | 'moderate' | 'hard';
}

/**
 * Fitts's Law 计算
 * ID = log₂(D/W + 1)
 * MT = a + b × ID
 *
 * 经验参数: a=50ms, b=150ms/bit (移动端触摸)
 */
export function calculateFitts(
  from: { x: number; y: number },
  to: { x: number; y: number },
  targetWidth: number = 44,
): FittsResult {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  const id = Math.log2(distance / targetWidth + 1);
  const a = 50;  // 截距 (ms)
  const b = 150; // 斜率 (ms/bit)
  const mt = a + b * id;

  let rating: 'easy' | 'moderate' | 'hard' = 'easy';
  if (id > 4) rating = 'hard';
  else if (id > 2.5) rating = 'moderate';

  return {
    from,
    to,
    targetWidth,
    distance: Math.round(distance),
    indexOfDifficulty: Math.round(id * 100) / 100,
    estimatedTime: Math.round(mt),
    rating,
  };
}

/**
 * 在画布上绘制 Fitts 测量线
 */
export function drawFittsOverlay(
  ctx: CanvasRenderingContext2D,
  result: FittsResult,
  screenX: number,
  screenY: number,
): void {
  ctx.save();

  const fx = screenX + result.from.x;
  const fy = screenY + result.from.y;
  const tx = screenX + result.to.x;
  const ty = screenY + result.to.y;

  // 连接线
  const color = result.rating === 'easy' ? '#22c55e'
    : result.rating === 'moderate' ? '#f59e0b'
    : '#ef4444';

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  ctx.setLineDash([]);

  // 起点
  ctx.fillStyle = '#3b82f6';
  ctx.beginPath();
  ctx.arc(fx, fy, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 终点
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(tx, ty, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 目标宽度虚线圈
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.arc(tx, ty, result.targetWidth / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // 信息标签 (中间位置)
  const mx = (fx + tx) / 2;
  const my = (fy + ty) / 2;

  const lines = [
    `距离: ${result.distance}px`,
    `难度: ID=${result.indexOfDifficulty}`,
    `时间: ~${result.estimatedTime}ms`,
  ];

  ctx.font = '12px "SF Pro Display", -apple-system, sans-serif';
  const maxW = Math.max(...lines.map(l => ctx.measureText(l).width));
  const boxW = maxW + 16;
  const boxH = lines.length * 18 + 12;

  // 标签背景
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  const br = 6;
  ctx.beginPath();
  ctx.moveTo(mx - boxW / 2 + br, my - boxH / 2);
  ctx.lineTo(mx + boxW / 2 - br, my - boxH / 2);
  ctx.arcTo(mx + boxW / 2, my - boxH / 2, mx + boxW / 2, my - boxH / 2 + br, br);
  ctx.lineTo(mx + boxW / 2, my + boxH / 2 - br);
  ctx.arcTo(mx + boxW / 2, my + boxH / 2, mx + boxW / 2 - br, my + boxH / 2, br);
  ctx.lineTo(mx - boxW / 2 + br, my + boxH / 2);
  ctx.arcTo(mx - boxW / 2, my + boxH / 2, mx - boxW / 2, my + boxH / 2 - br, br);
  ctx.lineTo(mx - boxW / 2, my - boxH / 2 + br);
  ctx.arcTo(mx - boxW / 2, my - boxH / 2, mx - boxW / 2 + br, my - boxH / 2, br);
  ctx.closePath();
  ctx.fill();

  // 色条
  ctx.fillStyle = color;
  ctx.fillRect(mx - boxW / 2, my - boxH / 2, 3, boxH);

  // 文字
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => {
    ctx.fillText(line, mx - boxW / 2 + 10, my - boxH / 2 + 6 + i * 18);
  });

  ctx.restore();
}
