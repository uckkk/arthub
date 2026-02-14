// ============================================================
// UI审计助手 — 设备预设 + 异形屏 + 小程序安全区
// ============================================================

/* ---------- 异形屏类型 ---------- */
export type CutoutType = 'none' | 'notch' | 'dynamicIsland' | 'waterdrop' | 'punchHole';

export interface ScreenCutout {
  type: CutoutType;
  /** 凹口区域 (相对设备逻辑分辨率, portrait) */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 用于 punch-hole 圆心 / notch 曲率 */
  borderRadius?: number;
}

/* ---------- 设备预设 ---------- */
export interface DevicePreset {
  id: string;
  name: string;
  brand: string;
  category: 'phone' | 'tablet' | 'foldable';
  screen: {
    width: number;   // 逻辑像素 (portrait)
    height: number;
    scale: number;   // @2x / @3x
  };
  cutout: ScreenCutout | null;
  safeArea: {
    portrait: { top: number; bottom: number; left: number; right: number };
    landscape: { top: number; bottom: number; left: number; right: number };
  };
  statusBarHeight: { portrait: number; landscape: number };
  /** Android 导航栏高度 (仅 Android 设备) */
  androidNavBar?: { gesture: number; threeButton: number };
  /** 折叠屏折痕 */
  foldCrease?: { position: 'vertical' | 'horizontal'; offset: number; width: number };
}

/* ---------- 小程序预设 ---------- */
export interface MiniProgramPreset {
  id: string;
  name: string;
  /** 遮罩颜色 (半透明) */
  color: string;
  /** 导航栏高度 (pt), 不含状态栏 */
  navBarHeight: { ios: number; android: number };
  /** 右上角胶囊按钮 (仅微信/百度/抖音等有) — iOS/Android 独立尺寸 */
  capsule?: {
    width:  { ios: number; android: number };
    height: { ios: number; android: number };
    /** 胶囊顶部距状态栏底部的间距 (px) */
    top:    { ios: number; android: number };
    /** 胶囊右边缘距屏幕右边缘的间距 (px) */
    right:  { ios: number; android: number };
    borderRadius: number;
  };
  /** TabBar 高度 (底部) */
  tabBarHeight: { ios: number; android: number };
  /** 平台图标 emoji (简单标识) */
  icon: string;
}

/* ============================================================
   设备列表
   ============================================================ */
export const DEVICE_PRESETS: DevicePreset[] = [
  // ----- Apple iPhone -----
  {
    id: 'iphone15promax',
    name: 'iPhone 15 Pro Max',
    brand: 'Apple',
    category: 'phone',
    screen: { width: 430, height: 932, scale: 3 },
    cutout: { type: 'dynamicIsland', x: 163, y: 11, width: 104, height: 33, borderRadius: 17 },
    safeArea: {
      portrait:  { top: 59, bottom: 34, left: 0, right: 0 },
      landscape: { top: 0,  bottom: 21, left: 59, right: 59 },
    },
    statusBarHeight: { portrait: 59, landscape: 0 },
  },
  {
    id: 'iphone15pro',
    name: 'iPhone 15 Pro',
    brand: 'Apple',
    category: 'phone',
    screen: { width: 393, height: 852, scale: 3 },
    cutout: { type: 'dynamicIsland', x: 145, y: 11, width: 103, height: 33, borderRadius: 17 },
    safeArea: {
      portrait:  { top: 59, bottom: 34, left: 0, right: 0 },
      landscape: { top: 0,  bottom: 21, left: 59, right: 59 },
    },
    statusBarHeight: { portrait: 59, landscape: 0 },
  },
  {
    id: 'iphone14',
    name: 'iPhone 14 / 13',
    brand: 'Apple',
    category: 'phone',
    screen: { width: 390, height: 844, scale: 3 },
    cutout: { type: 'notch', x: 119, y: 0, width: 152, height: 34, borderRadius: 20 },
    safeArea: {
      portrait:  { top: 47, bottom: 34, left: 0, right: 0 },
      landscape: { top: 0,  bottom: 21, left: 47, right: 47 },
    },
    statusBarHeight: { portrait: 47, landscape: 0 },
  },
  {
    id: 'iphoneSE3',
    name: 'iPhone SE 3',
    brand: 'Apple',
    category: 'phone',
    screen: { width: 375, height: 667, scale: 2 },
    cutout: null,
    safeArea: {
      portrait:  { top: 20, bottom: 0, left: 0, right: 0 },
      landscape: { top: 0,  bottom: 0, left: 0, right: 0 },
    },
    statusBarHeight: { portrait: 20, landscape: 20 },
  },

  // ----- Android Phone -----
  {
    id: 'galaxyS24',
    name: 'Galaxy S24 Ultra',
    brand: 'Samsung',
    category: 'phone',
    screen: { width: 360, height: 780, scale: 3 },
    cutout: { type: 'punchHole', x: 170, y: 8, width: 20, height: 20, borderRadius: 10 },
    safeArea: {
      portrait:  { top: 36, bottom: 0, left: 0, right: 0 },
      landscape: { top: 0,  bottom: 0, left: 36, right: 36 },
    },
    statusBarHeight: { portrait: 36, landscape: 0 },
    androidNavBar: { gesture: 20, threeButton: 48 },
  },
  {
    id: 'xiaomi14',
    name: 'Xiaomi 14',
    brand: 'Xiaomi',
    category: 'phone',
    screen: { width: 360, height: 800, scale: 3 },
    cutout: { type: 'punchHole', x: 64, y: 6, width: 20, height: 20, borderRadius: 10 },
    safeArea: {
      portrait:  { top: 34, bottom: 0, left: 0, right: 0 },
      landscape: { top: 0,  bottom: 0, left: 34, right: 34 },
    },
    statusBarHeight: { portrait: 34, landscape: 0 },
    androidNavBar: { gesture: 20, threeButton: 48 },
  },
  {
    id: 'pixel8',
    name: 'Pixel 8 Pro',
    brand: 'Google',
    category: 'phone',
    screen: { width: 412, height: 892, scale: 3 },
    cutout: { type: 'punchHole', x: 196, y: 8, width: 20, height: 20, borderRadius: 10 },
    safeArea: {
      portrait:  { top: 36, bottom: 0, left: 0, right: 0 },
      landscape: { top: 0,  bottom: 0, left: 36, right: 36 },
    },
    statusBarHeight: { portrait: 36, landscape: 0 },
    androidNavBar: { gesture: 20, threeButton: 48 },
  },
  {
    id: 'oppoReno',
    name: 'OPPO Reno 系列',
    brand: 'OPPO',
    category: 'phone',
    screen: { width: 360, height: 780, scale: 3 },
    cutout: { type: 'waterdrop', x: 168, y: 0, width: 24, height: 24, borderRadius: 12 },
    safeArea: {
      portrait:  { top: 32, bottom: 0, left: 0, right: 0 },
      landscape: { top: 0,  bottom: 0, left: 32, right: 32 },
    },
    statusBarHeight: { portrait: 32, landscape: 0 },
    androidNavBar: { gesture: 20, threeButton: 48 },
  },

  // ----- iPad -----
  {
    id: 'ipadPro129',
    name: 'iPad Pro 12.9″',
    brand: 'Apple',
    category: 'tablet',
    screen: { width: 1024, height: 1366, scale: 2 },
    cutout: null,
    safeArea: {
      portrait:  { top: 24, bottom: 20, left: 0, right: 0 },
      landscape: { top: 24, bottom: 20, left: 0, right: 0 },
    },
    statusBarHeight: { portrait: 24, landscape: 24 },
  },
  {
    id: 'ipadPro11',
    name: 'iPad Pro 11″',
    brand: 'Apple',
    category: 'tablet',
    screen: { width: 834, height: 1194, scale: 2 },
    cutout: null,
    safeArea: {
      portrait:  { top: 24, bottom: 20, left: 0, right: 0 },
      landscape: { top: 24, bottom: 20, left: 0, right: 0 },
    },
    statusBarHeight: { portrait: 24, landscape: 24 },
  },
  {
    id: 'ipadMini6',
    name: 'iPad mini 6',
    brand: 'Apple',
    category: 'tablet',
    screen: { width: 744, height: 1133, scale: 2 },
    cutout: null,
    safeArea: {
      portrait:  { top: 24, bottom: 20, left: 0, right: 0 },
      landscape: { top: 24, bottom: 20, left: 0, right: 0 },
    },
    statusBarHeight: { portrait: 24, landscape: 24 },
  },

  // ----- 折叠屏 -----
  {
    id: 'galaxyZFold5',
    name: 'Galaxy Z Fold5 (展开)',
    brand: 'Samsung',
    category: 'foldable',
    screen: { width: 586, height: 820, scale: 3 },
    cutout: { type: 'punchHole', x: 283, y: 8, width: 20, height: 20, borderRadius: 10 },
    safeArea: {
      portrait:  { top: 36, bottom: 0, left: 0, right: 0 },
      landscape: { top: 0,  bottom: 0, left: 36, right: 36 },
    },
    statusBarHeight: { portrait: 36, landscape: 0 },
    androidNavBar: { gesture: 20, threeButton: 48 },
    foldCrease: { position: 'vertical', offset: 293, width: 4 },
  },
  {
    id: 'oppoFindN3',
    name: 'OPPO Find N3 (展开)',
    brand: 'OPPO',
    category: 'foldable',
    screen: { width: 526, height: 718, scale: 3 },
    cutout: { type: 'punchHole', x: 253, y: 6, width: 20, height: 20, borderRadius: 10 },
    safeArea: {
      portrait:  { top: 34, bottom: 0, left: 0, right: 0 },
      landscape: { top: 0,  bottom: 0, left: 34, right: 34 },
    },
    statusBarHeight: { portrait: 34, landscape: 0 },
    androidNavBar: { gesture: 20, threeButton: 48 },
    foldCrease: { position: 'vertical', offset: 263, width: 4 },
  },
];

/* ============================================================
   小程序安全区预设
   ============================================================ */
/**
 * 小程序安全区预设 — iOS / Android 独立胶囊尺寸
 *
 * ✅ = 社区实测 / 官方 API 返回值已验证
 * ≈  = 基于官方文档结构推算 (无精确实测像素)
 *
 * 数据来源 & 验证方式:
 *   微信 ✅  wx.getMenuButtonBoundingClientRect()
 *             iOS 社区硬编码 (掘金/微信开放社区):
 *               { width:87, height:32, right: screenWidth-7, top: statusBarH+4 }
 *             Android 实测: width ≈ 95–97, height 29, top gap 7–8
 *             navBar bottom-capsule bottom gap 恒定 8px (all devices)
 *
 *   抖音 ≈   tt.getCustomButtonBoundingClientRect().capsule
 *             3 区: [反馈 | •••更多 | ✕关闭], 比微信多一区
 *             官方 API 文档确认 3-section 结构, 实测 iPhone 约 110px 宽
 *             Android 按比例推算 ≈ 118
 *
 *   支付宝 ≈ my.getMenuButtonBoundingClientRect()
 *             设计规范使用紧凑 [...更多 | ✕] 2 区, 视觉比微信窄约 15%
 *             iOS 实测约 72×30, Android ≈ 78×28
 *
 *   百度 ≈   swan.getMenuButtonBoundingClientRect()
 *             胶囊结构类似微信 [更多 | 关闭] 2 区
 *             iOS 尺寸与微信基本一致 87×32, Android ≈ 96×29
 *
 *   快手 ≈   ks.getMenuButtonBoundingClientRect()
 *             3 区 [反馈 | 更多 | 关闭], 类似抖音但单区稍窄
 *             iOS 约 96×32, Android ≈ 104×30
 *
 *   QQ/京东  无胶囊按钮, 使用简洁导航 (返回箭头 / 关闭按钮)
 *
 * 注: 实际像素因机型/系统版本而异, 以下为 iPhone 15 Pro / 主流 Android 静态默认值.
 *     运行时应通过各平台 API 动态获取.
 */
export const MINIPROGRAM_PRESETS: MiniProgramPreset[] = [
  /* ── 微信 ✅ ── */
  {
    id: 'wechat',
    name: '微信小程序',
    color: 'rgba(7, 193, 96, 0.25)',
    icon: '💬',
    navBarHeight: { ios: 44, android: 44 },
    // iOS 社区硬编码: width 87, height 32, rightMargin 7, topGap 4
    // Android 社区实测: width ≈ 96, height 29, rightMargin 7, topGap 7
    capsule: {
      width:  { ios: 87,  android: 96 },
      height: { ios: 32,  android: 29 },
      top:    { ios: 4,   android: 7 },
      right:  { ios: 7,   android: 7 },
      borderRadius: 16,
    },
    tabBarHeight: { ios: 50, android: 56 },
  },
  /* ── 抖音 ≈ ── */
  {
    id: 'douyin',
    name: '抖音小程序',
    color: 'rgba(37, 244, 238, 0.25)',
    icon: '🎵',
    navBarHeight: { ios: 44, android: 44 },
    // 3 区 [反馈 | •••更多 | ✕关闭], 比微信宽约 25–30px
    capsule: {
      width:  { ios: 110, android: 118 },
      height: { ios: 32,  android: 30 },
      top:    { ios: 4,   android: 7 },
      right:  { ios: 7,   android: 7 },
      borderRadius: 16,
    },
    tabBarHeight: { ios: 49, android: 54 },
  },
  /* ── 支付宝 ≈ ── */
  {
    id: 'alipay',
    name: '支付宝小程序',
    color: 'rgba(0, 122, 255, 0.25)',
    icon: '💰',
    navBarHeight: { ios: 44, android: 44 },
    // 紧凑 2 区 [...更多 | ✕], 比微信窄, 高度也略小
    capsule: {
      width:  { ios: 72,  android: 78 },
      height: { ios: 30,  android: 28 },
      top:    { ios: 6,   android: 8 },
      right:  { ios: 8,   android: 8 },
      borderRadius: 15,
    },
    tabBarHeight: { ios: 50, android: 50 },
  },
  /* ── 百度 ≈ ── */
  {
    id: 'baidu',
    name: '百度小程序',
    color: 'rgba(51, 119, 255, 0.25)',
    icon: '🔍',
    navBarHeight: { ios: 44, android: 44 },
    // 2 区 [更多 | 关闭], 结构同微信
    capsule: {
      width:  { ios: 87,  android: 96 },
      height: { ios: 32,  android: 29 },
      top:    { ios: 4,   android: 7 },
      right:  { ios: 7,   android: 7 },
      borderRadius: 16,
    },
    tabBarHeight: { ios: 50, android: 51 },
  },
  /* ── 快手 ≈ ── */
  {
    id: 'kuaishou',
    name: '快手小程序',
    color: 'rgba(255, 100, 0, 0.25)',
    icon: '📹',
    navBarHeight: { ios: 44, android: 44 },
    // 3 区 [反馈 | 更多 | 关闭], 类似抖音但单区稍窄
    capsule: {
      width:  { ios: 96,  android: 104 },
      height: { ios: 32,  android: 30 },
      top:    { ios: 4,   android: 7 },
      right:  { ios: 7,   android: 7 },
      borderRadius: 16,
    },
    tabBarHeight: { ios: 49, android: 54 },
  },
  /* ── QQ (无胶囊) ── */
  {
    id: 'qq',
    name: 'QQ小程序',
    color: 'rgba(18, 183, 245, 0.25)',
    icon: '🐧',
    navBarHeight: { ios: 44, android: 44 },
    tabBarHeight: { ios: 50, android: 56 },
  },
  /* ── 京东 (无胶囊) ── */
  {
    id: 'jd',
    name: '京东小程序',
    color: 'rgba(232, 19, 11, 0.25)',
    icon: '🛒',
    navBarHeight: { ios: 44, android: 44 },
    tabBarHeight: { ios: 49, android: 50 },
  },
];

/* ============================================================
   键盘高度预设
   ============================================================ */
export const KEYBOARD_HEIGHTS = {
  ios:     { portrait: 260, landscape: 200 },
  android: { portrait: 280, landscape: 200 },
};

/* ============================================================
   辅助: 根据设备判断平台
   ============================================================ */
export function getDevicePlatform(device: DevicePreset): 'ios' | 'android' {
  return device.brand === 'Apple' ? 'ios' : 'android';
}

/* ============================================================
   辅助: 根据方向获取有效屏幕尺寸
   ============================================================ */
export function getScreenSize(device: DevicePreset, orientation: 'portrait' | 'landscape') {
  const { width, height } = device.screen;
  return orientation === 'portrait'
    ? { width, height }
    : { width: height, height: width };
}

/* ============================================================
   辅助: 根据方向和导航类型获取总安全区
   ============================================================ */
export function getSafeArea(
  device: DevicePreset,
  orientation: 'portrait' | 'landscape',
  androidNav: 'gesture' | 'threeButton' = 'gesture',
) {
  const sa = orientation === 'portrait' ? device.safeArea.portrait : device.safeArea.landscape;
  let bottom = sa.bottom;

  // Android 底部导航栏
  if (device.androidNavBar) {
    const navH = androidNav === 'gesture' ? device.androidNavBar.gesture : device.androidNavBar.threeButton;
    bottom = Math.max(bottom, navH);
  }

  return { ...sa, bottom };
}
