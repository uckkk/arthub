import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Monitor, Smartphone, Tablet, FoldVertical,
  Upload, ChevronDown, Keyboard, LayoutGrid, AlertTriangle,
  Shield, Eye, EyeOff, Info, X, Maximize
} from 'lucide-react';
import {
  DEVICE_PRESETS, MINIPROGRAM_PRESETS, KEYBOARD_HEIGHTS,
  DevicePreset, MiniProgramPreset,
  getDevicePlatform, getScreenSize, getSafeArea,
  CutoutType,
} from './devicePresets';

/* ============================================================
   类型
   ============================================================ */
interface OverlayWarning {
  id: string;
  level: 'error' | 'warn' | 'info';
  message: string;
  /** 画布上标注的区域 (相对屏幕左上角的逻辑像素) */
  rect: { x: number; y: number; w: number; h: number };
  /** 标注放置侧 */
  side?: 'left' | 'right';
}

type Orientation = 'portrait' | 'landscape';
type AndroidNav = 'gesture' | 'threeButton';
type AspectMode = 'device' | 'preset' | 'custom';

/* ============================================================
   宽高比预设
   ============================================================ */
interface AspectRatioPreset {
  id: string;
  label: string;
  /** 宽:高 (portrait 方向) */
  w: number;
  h: number;
  desc: string;
}

const ASPECT_RATIO_PRESETS: AspectRatioPreset[] = [
  { id: '9:16',   label: '9:16',   w: 9,  h: 16,   desc: '经典 (iPhone 8)' },
  { id: '9:19.5', label: '9:19.5', w: 9,  h: 19.5, desc: 'iPhone X ~ 15' },
  { id: '9:20',   label: '9:20',   w: 9,  h: 20,   desc: 'Samsung S/OnePlus' },
  { id: '9:21',   label: '9:21',   w: 9,  h: 21,   desc: '超长屏 (Sony)' },
  { id: '3:4',    label: '3:4',    w: 3,  h: 4,    desc: 'iPad 经典' },
  { id: '2:3',    label: '2:3',    w: 2,  h: 3,    desc: 'iPad Pro' },
  { id: '10:16',  label: '10:16',  w: 10, h: 16,   desc: 'Android 平板' },
  { id: '16:9',   label: '16:9',   w: 16, h: 9,    desc: '横屏通用' },
  { id: '1:1',    label: '1:1',    w: 1,  h: 1,    desc: '正方形' },
];

/* ============================================================
   常量
   ============================================================ */
const CATEGORY_ICONS: Record<string, React.ElementType> = {
  phone: Smartphone,
  tablet: Tablet,
  foldable: FoldVertical,
};

const OVERLAY_COLORS = {
  safeAreaTop:    'rgba(255, 59, 48, 0.30)',   // 红 — 状态栏/刘海
  safeAreaBottom: 'rgba(255, 149, 0, 0.30)',   // 橙 — 底部安全区
  cutout:         'rgba(255, 59, 48, 0.50)',   // 深红 — 异形屏凹口
  miniProgram:    'rgba(0, 0, 0, 0.18)',       // 半透明黑 — 小程序导航栏
  keyboard:       'rgba(120, 120, 128, 0.30)', // 灰 — 键盘
  tabBar:         'rgba(88, 86, 214, 0.30)',   // 紫 — TabBar
  foldCrease:     'rgba(255, 204, 0, 0.50)',   // 黄 — 折叠屏折痕
  androidNav:     'rgba(255, 149, 0, 0.20)',   // 浅橙 — Android 导航栏
};

/* ============================================================
   Apple 平滑圆角 (复用 CPSAutomation 中的超椭圆算法)
   ============================================================ */
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  radius: number, smoothPercent: number = 80,
) {
  const maxR = Math.min(w, h) / 2;
  if (radius <= 0) { ctx.beginPath(); ctx.rect(x, y, w, h); return; }

  const s = Math.max(0, Math.min(100, smoothPercent)) / 100;
  const n = 2 + s * 3;
  const e = 2 / n;

  let r: number;
  if (s > 0.01) {
    const kCircle = Math.SQRT1_2;
    const kSuper = Math.pow(Math.SQRT1_2, e);
    const scaleFactor = (1 - kCircle) / (1 - kSuper);
    r = Math.min(radius * scaleFactor, maxR);
  } else {
    r = Math.min(radius, maxR);
  }

  const SEG = 48;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  for (let i = SEG; i >= 0; i--) {
    const t = (i / SEG) * Math.PI / 2;
    const px = r * Math.pow(Math.abs(Math.cos(t)), e);
    const py = r * Math.pow(Math.abs(Math.sin(t)), e);
    ctx.lineTo(x + w - r + px, y + r - py);
  }
  ctx.lineTo(x + w, y + h - r);
  for (let i = 0; i <= SEG; i++) {
    const t = (i / SEG) * Math.PI / 2;
    const px = r * Math.pow(Math.abs(Math.cos(t)), e);
    const py = r * Math.pow(Math.abs(Math.sin(t)), e);
    ctx.lineTo(x + w - r + px, y + h - r + py);
  }
  ctx.lineTo(x + r, y + h);
  for (let i = SEG; i >= 0; i--) {
    const t = (i / SEG) * Math.PI / 2;
    const px = r * Math.pow(Math.abs(Math.cos(t)), e);
    const py = r * Math.pow(Math.abs(Math.sin(t)), e);
    ctx.lineTo(x + r - px, y + h - r + py);
  }
  ctx.lineTo(x, y + r);
  for (let i = 0; i <= SEG; i++) {
    const t = (i / SEG) * Math.PI / 2;
    const px = r * Math.pow(Math.abs(Math.cos(t)), e);
    const py = r * Math.pow(Math.abs(Math.sin(t)), e);
    ctx.lineTo(x + r - px, y + r - py);
  }
  ctx.closePath();
}

/* ============================================================
   组件
   ============================================================ */
const UIAudit: React.FC = () => {
  /* ---------- 状态 ---------- */
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageName, setImageName] = useState<string>('');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('iphone15pro');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [androidNav, setAndroidNav] = useState<AndroidNav>('gesture');
  const [selectedMiniPrograms, setSelectedMiniPrograms] = useState<Set<string>>(new Set());
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [showTabBar, setShowTabBar] = useState(false);
  const [showOverlays, setShowOverlays] = useState(true);
  const [warnings, setWarnings] = useState<OverlayWarning[]>([]);
  const [deviceDropdown, setDeviceDropdown] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // 宽高比
  const [aspectMode, setAspectMode] = useState<AspectMode>('device');
  const [selectedAspectId, setSelectedAspectId] = useState<string>('9:19.5');
  const [customWidth, setCustomWidth] = useState<number>(393);
  const [customHeight, setCustomHeight] = useState<number>(852);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  /* ---------- 衍生数据 ---------- */
  const device = useMemo(
    () => DEVICE_PRESETS.find(d => d.id === selectedDeviceId) || DEVICE_PRESETS[0],
    [selectedDeviceId],
  );
  const platform = useMemo(() => getDevicePlatform(device), [device]);

  // 设备原始尺寸
  const deviceScreenSize = useMemo(() => getScreenSize(device, orientation), [device, orientation]);

  // 最终画布逻辑尺寸 (可被宽高比覆盖)
  const screenSize = useMemo(() => {
    if (aspectMode === 'device') {
      return deviceScreenSize;
    }

    let ratioW: number, ratioH: number;
    if (aspectMode === 'preset') {
      const preset = ASPECT_RATIO_PRESETS.find(p => p.id === selectedAspectId);
      if (!preset) return deviceScreenSize;
      // 预设的 w:h 是 portrait 方向
      if (orientation === 'portrait') {
        ratioW = preset.w;
        ratioH = preset.h;
      } else {
        ratioW = preset.h;
        ratioH = preset.w;
      }
    } else {
      // 自定义: 使用用户输入的绝对像素值
      if (orientation === 'portrait') {
        return { width: Math.max(customWidth, 100), height: Math.max(customHeight, 100) };
      } else {
        return { width: Math.max(customHeight, 100), height: Math.max(customWidth, 100) };
      }
    }

    // 按比例生成逻辑像素: 以设备宽度为基准
    const baseW = deviceScreenSize.width;
    const h = Math.round(baseW * ratioH / ratioW);
    return { width: baseW, height: h };
  }, [aspectMode, selectedAspectId, customWidth, customHeight, deviceScreenSize, orientation]);

  const safeArea = useMemo(
    () => getSafeArea(device, orientation, androidNav),
    [device, orientation, androidNav],
  );

  /* ---------- 点击外部关闭下拉 ---------- */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDeviceDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* ---------- 图片上传处理 ---------- */
  const loadImage = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    setImageName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => setImage(img);
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) loadImage(file);
  }, [loadImage]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadImage(file);
    // 重置 input 允许重复选择同一文件
    e.target.value = '';
  }, [loadImage]);

  /* ---------- Tauri file-drop 支持 ---------- */
  useEffect(() => {
    const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_IPC__;
    if (!isTauri) return;

    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const { appWindow } = await import('@tauri-apps/api/window');
        const { invoke } = await import('@tauri-apps/api/tauri');

        unlisten = await listen<string[]>('tauri://file-drop', async (event) => {
          const files = event.payload;
          if (!files || files.length === 0) return;

          // 检查光标是否在组件区域内
          try {
            const pos = await invoke<{ x: number; y: number }>('get_cursor_position');
            const winPos = await appWindow.innerPosition();
            const cx = pos.x - winPos.x;
            const cy = pos.y - winPos.y;
            const el = document.elementFromPoint(cx, cy);
            if (!el?.closest('[data-drop-target="ui-audit"]')) return;
          } catch { /* 无法获取光标 — 仍然处理 */ }

          const filePath = files[0];
          const ext = filePath.split('.').pop()?.toLowerCase() || '';
          if (!['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return;

          try {
            const data = await invoke<number[]>('read_binary_file_with_path', { filePath });
            const bytes = new Uint8Array(data);
            const blob = new Blob([bytes], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` });
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
              setImage(img);
              setImageName(filePath.split(/[\\/]/).pop() || 'image');
            };
            img.src = url;
          } catch (err) {
            console.error('读取文件失败:', err);
          }
        });
      } catch (err) {
        console.warn('Tauri file-drop 监听失败:', err);
      }
    })();

    return () => { unlisten?.(); };
  }, []);

  /* ---------- 画布渲染 ---------- */
  const ANNOTATION_MARGIN = 200; // 标注区域宽度 (设备两侧)

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sw = screenSize.width;
    const sh = screenSize.height;
    const DEVICE_PAD = 20;  // 设备外框内边距
    const FRAME_R = 40;
    const FRAME_BORDER = 3;

    // 设备帧尺寸
    const deviceW = sw + DEVICE_PAD * 2;
    const deviceH = sh + DEVICE_PAD * 2;

    // 画布总尺寸 = 标注区 + 设备 + 标注区
    const cw = ANNOTATION_MARGIN + deviceW + ANNOTATION_MARGIN;
    const ch = deviceH + 40; // 上下各留 20
    canvas.width = cw;
    canvas.height = ch;

    const deviceX = ANNOTATION_MARGIN; // 设备帧左上角 X
    const deviceY = 20;                // 设备帧左上角 Y
    const screenX = deviceX + DEVICE_PAD; // 屏幕左上角
    const screenY = deviceY + DEVICE_PAD;

    // 清空
    ctx.clearRect(0, 0, cw, ch);

    // 1. 设备外框 (Apple 平滑圆角)
    ctx.save();
    drawRoundedRect(ctx, deviceX + FRAME_BORDER / 2, deviceY + FRAME_BORDER / 2,
      deviceW - FRAME_BORDER, deviceH - FRAME_BORDER, FRAME_R, 80);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = FRAME_BORDER;
    ctx.stroke();
    ctx.restore();

    // 2. 屏幕区域裁剪
    ctx.save();
    ctx.rect(screenX, screenY, sw, sh);
    ctx.clip();

    // 2a. 屏幕背景
    ctx.fillStyle = '#111';
    ctx.fillRect(screenX, screenY, sw, sh);

    // 2b. 截图
    if (image) {
      const imgW = image.naturalWidth;
      const imgH = image.naturalHeight;
      const scaleX = sw / imgW;
      const scaleY = sh / imgH;
      const scale = Math.max(scaleX, scaleY);
      const dw = imgW * scale;
      const dh = imgH * scale;
      const dx = screenX + (sw - dw) / 2;
      const dy = screenY + (sh - dh) / 2;
      ctx.drawImage(image, dx, dy, dw, dh);
    }

    // ---------- 遮罩层 + 收集标注 ----------
    const newWarnings: OverlayWarning[] = [];

    if (showOverlays) {
      const ox = screenX;
      const oy = screenY;

      // 3. 顶部安全区
      if (safeArea.top > 0) {
        ctx.fillStyle = OVERLAY_COLORS.safeAreaTop;
        ctx.fillRect(ox, oy, sw, safeArea.top);
        newWarnings.push({
          id: 'safe-top', level: 'warn',
          message: `顶部安全区 ${safeArea.top}pt`,
          rect: { x: 0, y: 0, w: sw, h: safeArea.top }, side: 'right',
        });
      }

      // 4. 异形屏凹口
      if (device.cutout) {
        drawCutout(ctx, device, orientation, ox, oy, sw);
        const c = device.cutout;
        const cutoutRect = orientation === 'portrait'
          ? { x: c.x, y: c.y, w: c.width, h: c.height }
          : { x: 0, y: c.x, w: c.height, h: c.width };
        // 横屏时凹口在左侧，标注放左边；竖屏时在顶部，标注放右边
        const cutoutSide = orientation === 'landscape' ? 'left' as const : 'right' as const;
        newWarnings.push({
          id: 'cutout', level: 'error',
          message: getCutoutName(c.type),
          rect: cutoutRect,
          side: cutoutSide,
        });
      }

      // 5. 底部安全区
      if (safeArea.bottom > 0) {
        ctx.fillStyle = OVERLAY_COLORS.safeAreaBottom;
        ctx.fillRect(ox, oy + sh - safeArea.bottom, sw, safeArea.bottom);
        newWarnings.push({
          id: 'safe-bottom', level: 'warn',
          message: `底部安全区 ${safeArea.bottom}pt`,
          rect: { x: 0, y: sh - safeArea.bottom, w: sw, h: safeArea.bottom },
          // 横屏时放左侧, 与右侧标注分散; 竖屏放左侧与顶部(右侧)形成对称
          side: 'left',
        });
      }

      // 6. 横屏左右安全区
      if (safeArea.left > 0) {
        ctx.fillStyle = OVERLAY_COLORS.safeAreaTop;
        ctx.fillRect(ox, oy, safeArea.left, sh);
        newWarnings.push({
          id: 'safe-left', level: 'warn',
          message: `左侧安全区 ${safeArea.left}pt`,
          rect: { x: 0, y: sh * 0.3, w: safeArea.left, h: 20 }, side: 'left',
        });
      }
      if (safeArea.right > 0) {
        ctx.fillStyle = OVERLAY_COLORS.safeAreaTop;
        ctx.fillRect(ox + sw - safeArea.right, oy, safeArea.right, sh);
        newWarnings.push({
          id: 'safe-right', level: 'warn',
          message: `右侧安全区 ${safeArea.right}pt`,
          rect: { x: sw - safeArea.right, y: sh * 0.3, w: safeArea.right, h: 20 }, side: 'right',
        });
      }

      // 7. 折叠屏折痕
      if (device.foldCrease) {
        const crease = device.foldCrease;
        ctx.fillStyle = OVERLAY_COLORS.foldCrease;
        let creaseRect: OverlayWarning['rect'];
        let creaseSide: 'left' | 'right';
        const halfW = crease.width / 2;
        if (orientation === 'portrait') {
          if (crease.position === 'vertical') {
            // 竖屏 + 垂直折痕 → 竖线
            ctx.fillRect(ox + crease.offset - halfW, oy, crease.width, sh);
            creaseRect = { x: crease.offset - halfW, y: sh * 0.5, w: crease.width, h: 10 };
            creaseSide = crease.offset < sw / 2 ? 'left' : 'right';
          } else {
            // 竖屏 + 水平折痕 → 横线
            ctx.fillRect(ox, oy + crease.offset - halfW, sw, crease.width);
            creaseRect = { x: 0, y: crease.offset - halfW, w: sw, h: crease.width };
            creaseSide = 'left';
          }
        } else {
          if (crease.position === 'vertical') {
            // 横屏 + 垂直折痕 → 转为横线
            ctx.fillRect(ox, oy + crease.offset - halfW, sw, crease.width);
            creaseRect = { x: 0, y: crease.offset - halfW, w: sw, h: crease.width };
            creaseSide = 'left';
          } else {
            // 横屏 + 水平折痕 → 转为竖线
            ctx.fillRect(ox + crease.offset - halfW, oy, crease.width, sh);
            creaseRect = { x: crease.offset - halfW, y: sh * 0.5, w: crease.width, h: 10 };
            creaseSide = crease.offset < sw / 2 ? 'left' : 'right';
          }
        }
        newWarnings.push({
          id: 'fold-crease', level: 'warn',
          message: '折叠屏折痕',
          rect: creaseRect, side: creaseSide,
        });
      }

      // 8. Android 导航栏
      if (device.androidNavBar && androidNav === 'threeButton') {
        const navH = device.androidNavBar.threeButton;
        ctx.fillStyle = OVERLAY_COLORS.androidNav;
        if (orientation === 'portrait') {
          ctx.fillRect(ox, oy + sh - navH, sw, navH);
          newWarnings.push({
            id: 'android-nav', level: 'info',
            message: `三键导航 ${navH}pt`,
            rect: { x: 0, y: sh - navH, w: sw, h: navH }, side: 'left',
          });
        } else {
          ctx.fillRect(ox + sw - navH, oy, navH, sh);
          newWarnings.push({
            id: 'android-nav', level: 'info',
            message: `三键导航 ${navH}pt`,
            rect: { x: sw - navH, y: sh * 0.7, w: navH, h: 20 }, side: 'right',
          });
        }
      }

      // 9. 小程序遮罩
      let mpIndex = 0;
      selectedMiniPrograms.forEach(mpId => {
        const mp = MINIPROGRAM_PRESETS.find(m => m.id === mpId);
        if (!mp) return;
        drawMiniProgramOverlay(ctx, mp, device, orientation, ox, oy, sw, sh);
        const mpPlatform = getDevicePlatform(device);
        const navH = mpPlatform === 'ios' ? mp.navBarHeight.ios : mp.navBarHeight.android;
        const statusH = orientation === 'portrait' ? device.statusBarHeight.portrait : device.statusBarHeight.landscape;

        let mpRect: OverlayWarning['rect'];
        let mpSide: 'left' | 'right';
        if (orientation === 'portrait') {
          // 竖屏: 导航栏在状态栏下方, 全宽
          mpRect = { x: 0, y: statusH, w: sw, h: navH };
          // 交替左右分布以避免标注重叠
          mpSide = mpIndex % 2 === 0 ? 'left' : 'right';
        } else {
          // 横屏: 导航栏在顶部, 避开左右安全区
          const navTop = statusH > 0 ? statusH : safeArea.top;
          const navW = sw - safeArea.left - safeArea.right;
          mpRect = { x: safeArea.left, y: navTop, w: navW, h: navH };
          // 横屏导航栏在顶部 — 全部放右侧, 用 Y 错开即可
          mpSide = 'right';
        }

        newWarnings.push({
          id: `mp-${mpId}`, level: 'warn',
          message: mp.name.replace('小程序', ''),
          rect: mpRect, side: mpSide,
        });
        mpIndex++;
      });

      // 10. TabBar
      if (showTabBar) {
        const tbH = platform === 'ios' ? 50 : 56;
        const bottomOffset = safeArea.bottom;
        ctx.fillStyle = OVERLAY_COLORS.tabBar;
        if (orientation === 'portrait') {
          ctx.fillRect(ox, oy + sh - bottomOffset - tbH, sw, tbH);
          newWarnings.push({
            id: 'tabbar', level: 'info',
            message: `TabBar ${tbH}pt`,
            rect: { x: 0, y: sh - bottomOffset - tbH, w: sw, h: tbH }, side: 'left',
          });
        } else {
          ctx.fillRect(ox + safeArea.left, oy + sh - tbH, sw - safeArea.left - safeArea.right, tbH);
          newWarnings.push({
            id: 'tabbar', level: 'info',
            message: `TabBar ${tbH}pt`,
            rect: { x: safeArea.left, y: sh - tbH, w: sw - safeArea.left - safeArea.right, h: tbH }, side: 'left',
          });
        }
      }

      // 11. 键盘
      if (showKeyboard) {
        const kbH = platform === 'ios'
          ? KEYBOARD_HEIGHTS.ios[orientation]
          : KEYBOARD_HEIGHTS.android[orientation];
        ctx.fillStyle = OVERLAY_COLORS.keyboard;
        ctx.fillRect(ox, oy + sh - kbH, sw, kbH);
        newWarnings.push({
          id: 'keyboard', level: 'info',
          message: `键盘 ${kbH}pt`,
          rect: { x: 0, y: sh - kbH, w: sw, h: kbH }, side: 'left',
        });
      }
    }

    setWarnings(newWarnings);
    ctx.restore(); // 结束屏幕裁剪

    // 12. 设备帧圆角裁剪 (使用 offscreen canvas 隔离设备区域)
    {
      const offCanvas = document.createElement('canvas');
      offCanvas.width = deviceW;
      offCanvas.height = deviceH;
      const offCtx = offCanvas.getContext('2d')!;
      // 截取设备帧区域
      offCtx.drawImage(canvas, deviceX, deviceY, deviceW, deviceH, 0, 0, deviceW, deviceH);
      // 用圆角遮罩裁剪
      offCtx.globalCompositeOperation = 'destination-in';
      drawRoundedRect(offCtx, 0, 0, deviceW, deviceH, FRAME_R, 80);
      offCtx.fillStyle = '#000';
      offCtx.fill();
      // 清除主画布的设备区域, 然后贴回裁剪后的
      ctx.clearRect(deviceX, deviceY, deviceW, deviceH);
      ctx.drawImage(offCanvas, deviceX, deviceY);
    }

    // 13. 重绘设备边框
    ctx.save();
    drawRoundedRect(ctx, deviceX + FRAME_BORDER / 2, deviceY + FRAME_BORDER / 2,
      deviceW - FRAME_BORDER, deviceH - FRAME_BORDER, FRAME_R, 80);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = FRAME_BORDER;
    ctx.stroke();
    ctx.restore();

    // ========== 14. 标注绘制 ==========
    if (showOverlays && newWarnings.length > 0) {
      drawAnnotations(ctx, newWarnings, screenX, screenY, sw, sh, deviceX, deviceW, cw, ch);
    }

  }, [image, screenSize, device, orientation, safeArea, androidNav, selectedMiniPrograms, showKeyboard, showTabBar, showOverlays, platform]);

  useEffect(() => { renderCanvas(); }, [renderCanvas]);

  /* ---------- 画布视口: 缩放 + 平移 ---------- */
  const [containerSize, setContainerSize] = useState({ w: 600, h: 700 });
  const [zoom, setZoom] = useState(1);       // 用户缩放倍率 (1 = 自适应)
  const [pan, setPan] = useState({ x: 0, y: 0 }); // 平移偏移 (px)
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // 容器尺寸监听
  useEffect(() => {
    const el = canvasAreaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerSize({ w: width, h: height });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 切换设备/宽高比时重置视口
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [screenSize]);

  // 画布总尺寸 (含标注区域)
  const canvasLogicalSize = useMemo(() => {
    const deviceW = screenSize.width + 40;
    const deviceH = screenSize.height + 40;
    return {
      width: ANNOTATION_MARGIN + deviceW + ANNOTATION_MARGIN,
      height: deviceH + 40,
    };
  }, [screenSize]);

  // 基础适配缩放 (让整个画布含标注完整显示)
  const baseScale = useMemo(() => {
    const availW = Math.max(containerSize.w - 16, 200);
    const availH = Math.max(containerSize.h - 60, 200);
    return Math.min(1, availW / canvasLogicalSize.width, availH / canvasLogicalSize.height);
  }, [canvasLogicalSize, containerSize]);

  // 最终显示尺寸 = 基础适配 × 用户缩放
  const canvasStyle = useMemo(() => {
    const s = baseScale * zoom;
    return {
      width: canvasLogicalSize.width * s,
      height: canvasLogicalSize.height * s,
    };
  }, [canvasLogicalSize, baseScale, zoom]);

  // 滚轮缩放 (以光标为锚点)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY;
    const factor = delta > 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.min(Math.max(zoom * factor, 0.2), 5);

    // 锚点: 光标相对容器中心的偏移
    const rect = canvasAreaRef.current?.getBoundingClientRect();
    if (rect) {
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const scale = 1 - newZoom / zoom;
      setPan(prev => ({
        x: prev.x + (cx - prev.x) * scale,
        y: prev.y + (cy - prev.y) * scale,
      }));
    }

    setZoom(newZoom);
  }, [zoom]);

  // 中键按住拖动
  const handlePanStart = useCallback((e: React.MouseEvent) => {
    // 仅中键 (button === 1)
    if (e.button !== 1) return;

    isPanningRef.current = true;
    panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    e.preventDefault();
  }, [pan]);

  const handlePanMove = useCallback((e: React.MouseEvent) => {
    if (!isPanningRef.current) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy });
  }, []);

  const handlePanEnd = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  // 双击归位
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    // 避免触发文件选择
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  /* ---------- 小程序切换 ---------- */
  const toggleMiniProgram = useCallback((id: string) => {
    setSelectedMiniPrograms(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /* ---------- 分组设备 ---------- */
  const deviceGroups = useMemo(() => {
    const groups: Record<string, DevicePreset[]> = {};
    DEVICE_PRESETS.forEach(d => {
      const key = d.category;
      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    });
    return groups;
  }, []);

  /* ============================================================
     渲染
     ============================================================ */
  return (
    <div className="flex h-full bg-[#0e0e0e] text-white overflow-hidden">
      {/* ---- 左侧: 画布区 (可缩放 + 可拖动) ---- */}
      <div
        ref={canvasAreaRef}
        className="flex-1 flex flex-col min-w-0 overflow-hidden relative"
        onWheel={handleWheel}
        onMouseDown={handlePanStart}
        onMouseMove={handlePanMove}
        onMouseUp={handlePanEnd}
        onMouseLeave={handlePanEnd}
        onAuxClick={e => e.preventDefault()}
        onDoubleClick={handleDoubleClick}
        style={{ cursor: isPanningRef.current ? 'grabbing' : 'default' }}
      >
        {/* 可平移+缩放的内容层 — 用 absolute 脱离 flex, 避免被压缩变形 */}
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px)`,
          }}
        >
          {/* 上传区 / 画布 — 用固定尺寸, 不参与 flex 收缩 */}
          {!image ? (
            <div
              data-drop-target="ui-audit"
              className={`pointer-events-auto rounded-2xl border-2 border-dashed transition-colors flex flex-col items-center justify-center cursor-pointer select-none shrink-0 ${
                isDragging
                  ? 'border-blue-400 bg-blue-400/10'
                  : 'border-[#333] hover:border-[#555] bg-[#161616]'
              }`}
              style={{
                width: canvasStyle.width,
                height: canvasStyle.height,
                minWidth: canvasStyle.width,
                minHeight: canvasStyle.height,
              }}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
            >
              <Upload size={40} className="text-[#555] mb-3" />
              <p className="text-sm text-[#888]">拖放或点击上传游戏截图</p>
              <p className="text-xs text-[#555] mt-1">支持 PNG / JPG / WebP</p>
              <p className="text-[10px] text-[#444] mt-2">{screenSize.width}×{screenSize.height}pt</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
          ) : (
            <div
              data-drop-target="ui-audit"
              className="pointer-events-auto relative shrink-0"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <canvas
                ref={canvasRef}
                style={{
                  width: canvasStyle.width,
                  height: canvasStyle.height,
                  imageRendering: 'auto',
                }}
              />
              {isDragging && (
                <div className="absolute inset-0 bg-blue-400/10 border-2 border-blue-400 rounded-2xl flex items-center justify-center">
                  <p className="text-blue-300 text-sm">释放以替换截图</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部信息栏 (固定在视口底部, 不随平移) */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-3 py-2 px-4 bg-gradient-to-t from-[#0e0e0e] via-[#0e0e0ecc] to-transparent pointer-events-none">
          <div className="flex items-center gap-3 text-xs text-[#888] flex-wrap justify-center pointer-events-auto">
            {image && (
              <>
                <span>{imageName}</span>
                <span>·</span>
              </>
            )}
            <span>{device.name}</span>
            <span>·</span>
            <span>{screenSize.width}×{screenSize.height}pt</span>
            {aspectMode !== 'device' && (
              <>
                <span>·</span>
                <span className="text-blue-400">
                  {aspectMode === 'preset' ? selectedAspectId : `${customWidth}:${customHeight}`}
                </span>
              </>
            )}
            <span>·</span>
            <span>{Math.round(zoom * baseScale * 100)}%</span>
            {image && (
              <button
                className="ml-2 px-2 py-1 rounded bg-[#222] hover:bg-[#333] text-[#aaa] transition-colors"
                onClick={() => { setImage(null); setImageName(''); }}
              >
                更换截图
              </button>
            )}
            {(zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
              <button
                className="px-2 py-1 rounded bg-[#222] hover:bg-[#333] text-[#aaa] transition-colors"
                onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
              >
                归位
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ---- 右侧: 控制面板 ---- */}
      <div className="w-80 border-l border-[#222] bg-[#141414] flex flex-col overflow-y-auto shrink-0">
        {/* 标题 */}
        <div className="p-4 border-b border-[#222] flex items-center gap-2">
          <Shield size={16} className="text-blue-400" />
          <span className="font-medium text-sm">UI 审计助手</span>
        </div>

        {/* == 设备选择 == */}
        <PanelSection title="设备" icon={<Monitor size={14} />}>
          <div className="relative" ref={dropdownRef}>
            <button
              className="w-full flex items-center justify-between px-3 py-2 bg-[#1e1e1e] rounded-lg text-sm hover:bg-[#252525] transition-colors"
              onClick={() => setDeviceDropdown(!deviceDropdown)}
            >
              <span className="truncate">{device.name}</span>
              <ChevronDown size={14} className={`transition-transform ${deviceDropdown ? 'rotate-180' : ''}`} />
            </button>
            {deviceDropdown && (
              <div className="absolute z-50 mt-1 w-full bg-[#1e1e1e] border border-[#333] rounded-lg shadow-xl max-h-72 overflow-y-auto">
                {Object.entries(deviceGroups).map(([cat, devices]) => {
                  const Icon = CATEGORY_ICONS[cat] || Monitor;
                  return (
                    <div key={cat}>
                      <div className="px-3 py-1.5 text-[10px] text-[#666] uppercase tracking-wider flex items-center gap-1.5 sticky top-0 bg-[#1e1e1e]">
                        <Icon size={10} />
                        {cat === 'phone' ? '手机' : cat === 'tablet' ? '平板' : '折叠屏'}
                      </div>
                      {devices.map(d => (
                        <button
                          key={d.id}
                          className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#2a2a2a] transition-colors ${
                            d.id === selectedDeviceId ? 'text-blue-400 bg-[#1a2332]' : 'text-[#ccc]'
                          }`}
                          onClick={() => { setSelectedDeviceId(d.id); setDeviceDropdown(false); }}
                        >
                          <span>{d.name}</span>
                          <span className="ml-2 text-[#555]">{d.screen.width}×{d.screen.height}</span>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 方向切换 */}
          <div className="flex items-center gap-2 mt-3">
            <span className="text-xs text-[#888]">方向</span>
            <div className="flex bg-[#1e1e1e] rounded-lg overflow-hidden">
              <button
                className={`px-3 py-1.5 text-xs transition-colors ${
                  orientation === 'portrait' ? 'bg-blue-500/20 text-blue-400' : 'text-[#888] hover:text-white'
                }`}
                onClick={() => setOrientation('portrait')}
              >
                竖屏
              </button>
              <button
                className={`px-3 py-1.5 text-xs transition-colors ${
                  orientation === 'landscape' ? 'bg-blue-500/20 text-blue-400' : 'text-[#888] hover:text-white'
                }`}
                onClick={() => setOrientation('landscape')}
              >
                横屏
              </button>
            </div>
          </div>

          {/* Android 导航 */}
          {device.androidNavBar && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-[#888]">导航栏</span>
              <div className="flex bg-[#1e1e1e] rounded-lg overflow-hidden">
                <button
                  className={`px-3 py-1.5 text-xs transition-colors ${
                    androidNav === 'gesture' ? 'bg-blue-500/20 text-blue-400' : 'text-[#888] hover:text-white'
                  }`}
                  onClick={() => setAndroidNav('gesture')}
                >
                  手势
                </button>
                <button
                  className={`px-3 py-1.5 text-xs transition-colors ${
                    androidNav === 'threeButton' ? 'bg-blue-500/20 text-blue-400' : 'text-[#888] hover:text-white'
                  }`}
                  onClick={() => setAndroidNav('threeButton')}
                >
                  三键
                </button>
              </div>
            </div>
          )}
        </PanelSection>

        {/* == 宽高比 == */}
        <PanelSection title="宽高比" icon={<Maximize size={14} />}>
          {/* 模式切换 */}
          <div className="flex bg-[#1e1e1e] rounded-lg overflow-hidden mb-3">
            <button
              className={`flex-1 px-2 py-1.5 text-xs transition-colors ${
                aspectMode === 'device' ? 'bg-blue-500/20 text-blue-400' : 'text-[#888] hover:text-white'
              }`}
              onClick={() => setAspectMode('device')}
            >
              跟随设备
            </button>
            <button
              className={`flex-1 px-2 py-1.5 text-xs transition-colors ${
                aspectMode === 'preset' ? 'bg-blue-500/20 text-blue-400' : 'text-[#888] hover:text-white'
              }`}
              onClick={() => setAspectMode('preset')}
            >
              预设
            </button>
            <button
              className={`flex-1 px-2 py-1.5 text-xs transition-colors ${
                aspectMode === 'custom' ? 'bg-blue-500/20 text-blue-400' : 'text-[#888] hover:text-white'
              }`}
              onClick={() => setAspectMode('custom')}
            >
              自定义
            </button>
          </div>

          {/* 预设列表 */}
          {aspectMode === 'preset' && (
            <div className="grid grid-cols-3 gap-1.5 mb-2">
              {ASPECT_RATIO_PRESETS.map(p => (
                <button
                  key={p.id}
                  className={`px-2 py-2 rounded-lg text-center transition-colors ${
                    selectedAspectId === p.id
                      ? 'bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30'
                      : 'bg-[#1e1e1e] text-[#aaa] hover:bg-[#252525]'
                  }`}
                  onClick={() => setSelectedAspectId(p.id)}
                  title={p.desc}
                >
                  <div className="text-xs font-medium">{p.label}</div>
                  <div className="text-[10px] text-[#666] mt-0.5 truncate">{p.desc}</div>
                </button>
              ))}
            </div>
          )}

          {/* 自定义输入 */}
          {aspectMode === 'custom' && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-[#666]">W</span>
                <input
                  type="number"
                  value={customWidth}
                  onChange={e => setCustomWidth(parseInt(e.target.value) || 100)}
                  className="w-16 px-2 py-1 bg-[#1e1e1e] border border-[#333] rounded text-xs text-white text-center focus:border-blue-500 focus:outline-none"
                  min={100}
                  max={3000}
                />
              </div>
              <X size={10} className="text-[#555]" />
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-[#666]">H</span>
                <input
                  type="number"
                  value={customHeight}
                  onChange={e => setCustomHeight(parseInt(e.target.value) || 100)}
                  className="w-16 px-2 py-1 bg-[#1e1e1e] border border-[#333] rounded text-xs text-white text-center focus:border-blue-500 focus:outline-none"
                  min={100}
                  max={3000}
                />
              </div>
              <span className="text-[10px] text-[#555]">pt</span>
            </div>
          )}

          {/* 当前比例显示 */}
          <div className="mt-2 text-[10px] text-[#555]">
            当前: {screenSize.width}×{screenSize.height}pt
            {aspectMode !== 'device' && (
              <span className="ml-1">
                ({(screenSize.width / screenSize.height).toFixed(2)})
              </span>
            )}
          </div>
        </PanelSection>

        {/* == 异形屏 == */}
        <PanelSection title="异形屏" icon={<Smartphone size={14} />}>
          <div className="flex items-center gap-2 text-xs text-[#aaa]">
            {device.cutout ? (
              <>
                <span className="inline-block w-2 h-2 rounded-full bg-red-400" />
                <span>{getCutoutName(device.cutout.type)}</span>
                <span className="text-[#555]">({device.cutout.width}×{device.cutout.height}pt)</span>
              </>
            ) : (
              <>
                <span className="inline-block w-2 h-2 rounded-full bg-green-400" />
                <span>无异形屏</span>
              </>
            )}
          </div>
          {device.foldCrease && (
            <div className="flex items-center gap-2 text-xs text-[#aaa] mt-1">
              <span className="inline-block w-2 h-2 rounded-full bg-yellow-400" />
              <span>折痕: {device.foldCrease.position === 'vertical' ? '垂直' : '水平'} @{device.foldCrease.offset}pt</span>
            </div>
          )}
        </PanelSection>

        {/* == 小程序安全区 == */}
        <PanelSection title="小程序安全区" icon={<LayoutGrid size={14} />}>
          <div className="grid grid-cols-2 gap-1.5">
            {MINIPROGRAM_PRESETS.map(mp => (
              <button
                key={mp.id}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                  selectedMiniPrograms.has(mp.id)
                    ? 'bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30'
                    : 'bg-[#1e1e1e] text-[#aaa] hover:bg-[#252525]'
                }`}
                onClick={() => toggleMiniProgram(mp.id)}
              >
                <span>{mp.icon}</span>
                <span className="truncate">{mp.name.replace('小程序', '')}</span>
              </button>
            ))}
          </div>
          {selectedMiniPrograms.size > 0 && (
            <button
              className="mt-2 text-xs text-[#666] hover:text-[#999] transition-colors"
              onClick={() => setSelectedMiniPrograms(new Set())}
            >
              清除全部
            </button>
          )}
        </PanelSection>

        {/* == 场景模拟 == */}
        <PanelSection title="场景模拟" icon={<Keyboard size={14} />}>
          <label className="flex items-center gap-2 cursor-pointer">
            <ToggleSwitch checked={showKeyboard} onChange={setShowKeyboard} />
            <span className="text-xs text-[#aaa]">键盘弹出</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer mt-2">
            <ToggleSwitch checked={showTabBar} onChange={setShowTabBar} />
            <span className="text-xs text-[#aaa]">底部 TabBar</span>
          </label>
        </PanelSection>

        {/* == 遮罩控制 == */}
        <PanelSection title="显示控制" icon={showOverlays ? <Eye size={14} /> : <EyeOff size={14} />}>
          <label className="flex items-center gap-2 cursor-pointer">
            <ToggleSwitch checked={showOverlays} onChange={setShowOverlays} />
            <span className="text-xs text-[#aaa]">显示安全区遮罩</span>
          </label>
        </PanelSection>

        {/* == 检测结果 == */}
        <PanelSection title="检测结果" icon={<AlertTriangle size={14} />}>
          {warnings.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-green-400">
              <Shield size={14} />
              <span>未发现遮挡风险</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {warnings.map(w => (
                <div
                  key={w.id}
                  className={`flex items-start gap-2 text-xs p-2 rounded-lg ${
                    w.level === 'error'
                      ? 'bg-red-500/10 text-red-300'
                      : w.level === 'warn'
                      ? 'bg-yellow-500/10 text-yellow-300'
                      : 'bg-blue-500/10 text-blue-300'
                  }`}
                >
                  {w.level === 'error' ? <X size={12} className="shrink-0 mt-0.5" />
                    : w.level === 'warn' ? <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                    : <Info size={12} className="shrink-0 mt-0.5" />}
                  <span>{w.message}</span>
                </div>
              ))}
            </div>
          )}
        </PanelSection>

        {/* == 图例 == */}
        <PanelSection title="图例" icon={<Eye size={14} />} defaultOpen={false}>
          <div className="space-y-1">
            <Legend color={OVERLAY_COLORS.safeAreaTop} label="状态栏 / 顶部安全区" />
            <Legend color={OVERLAY_COLORS.safeAreaBottom} label="底部安全区" />
            <Legend color={OVERLAY_COLORS.cutout} label="异形屏凹口" />
            <Legend color={OVERLAY_COLORS.miniProgram} label="小程序导航栏" />
            <Legend color={OVERLAY_COLORS.keyboard} label="键盘区域" />
            <Legend color={OVERLAY_COLORS.tabBar} label="TabBar" />
            <Legend color={OVERLAY_COLORS.foldCrease} label="折叠屏折痕" />
          </div>
        </PanelSection>
      </div>
    </div>
  );
};

/* ============================================================
   辅助子组件
   ============================================================ */

/** 面板折叠区块 */
function PanelSection({
  title, icon, children, defaultOpen = true,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[#1e1e1e]">
      <button
        className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-[#999] hover:text-white transition-colors"
        onClick={() => setOpen(!open)}
      >
        {icon}
        <span className="font-medium">{title}</span>
        <ChevronDown
          size={12}
          className={`ml-auto transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

/** iOS 风格开关 */
function ToggleSwitch({
  checked, onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      className={`relative w-8 h-[18px] rounded-full transition-colors ${
        checked ? 'bg-blue-500' : 'bg-[#39393d]'
      }`}
      onClick={() => onChange(!checked)}
    >
      <div
        className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-[14px]' : ''
        }`}
      />
    </button>
  );
}

/** 图例条目 */
function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-[#888]">
      <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </div>
  );
}

/* ============================================================
   绘制辅助函数
   ============================================================ */

/* ============================================================
   标注绘制引擎
   ============================================================ */
const ANNOTATION_COLORS: Record<string, { dot: string; line: string; bg: string; text: string }> = {
  error: { dot: '#ff3b30', line: '#ff3b30', bg: 'rgba(255,59,48,0.12)', text: '#ff6b6b' },
  warn:  { dot: '#ff9500', line: '#ff9500', bg: 'rgba(255,149,0,0.12)', text: '#ffb340' },
  info:  { dot: '#007aff', line: '#007aff', bg: 'rgba(0,122,255,0.12)', text: '#5ac8fa' },
};

function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  warnings: OverlayWarning[],
  screenX: number, screenY: number,
  sw: number, sh: number,
  deviceX: number, deviceW: number,
  _canvasW: number, _canvasH: number,
) {
  // 分左右两侧
  const leftItems = warnings.filter(w => w.side === 'left');
  const rightItems = warnings.filter(w => w.side !== 'left');

  const LABEL_H = 26;      // 标签高度
  const LABEL_GAP = 6;     // 标签间距
  const LABEL_PAD_X = 10;  // 标签内边距
  const LABEL_R = 6;       // 标签圆角
  const DOT_R = 3.5;       // 源点半径
  const FONT_SIZE = 11;
  const MARGIN_W = 190;    // 标注区可用宽度

  ctx.font = `${FONT_SIZE}px -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif`;
  ctx.textBaseline = 'middle';

  // 布局标签 (沿 Y 轴均匀分布, 避免重叠)
  const layoutLabels = (items: OverlayWarning[], startY: number) => {
    // 按源点 Y 坐标排序
    const sorted = [...items].sort((a, b) => {
      const ay = a.rect.y + a.rect.h / 2;
      const by = b.rect.y + b.rect.h / 2;
      return ay - by;
    });

    const positions: number[] = [];
    sorted.forEach((item, i) => {
      const idealY = screenY + item.rect.y + item.rect.h / 2 - LABEL_H / 2;
      let y = Math.max(startY, idealY);
      // 避免与上一个重叠
      if (i > 0 && positions[i - 1] !== undefined) {
        y = Math.max(y, positions[i - 1] + LABEL_H + LABEL_GAP);
      }
      positions.push(y);
    });

    return sorted.map((item, i) => ({ item, labelY: positions[i] }));
  };

  // 绘制一侧的标注
  const drawSide = (items: OverlayWarning[], side: 'left' | 'right') => {
    if (items.length === 0) return;

    const layout = layoutLabels(items, screenY);

    layout.forEach(({ item, labelY }) => {
      const colors = ANNOTATION_COLORS[item.level] || ANNOTATION_COLORS.info;

      // 源点: 遮罩区域靠近标注侧的边缘中点
      let srcX: number, srcY: number;
      srcY = screenY + item.rect.y + item.rect.h / 2;

      if (side === 'left') {
        // 左侧标注 → 源点取 rect 的左边缘
        srcX = screenX + item.rect.x + Math.min(10, item.rect.w / 2);
      } else {
        // 右侧标注 → 源点取 rect 的右边缘
        srcX = screenX + item.rect.x + item.rect.w - Math.min(10, item.rect.w / 2);
      }

      // 标签位置
      const textW = ctx.measureText(item.message).width;
      const labelW = textW + LABEL_PAD_X * 2;
      let labelX: number;
      let elbowX: number; // 折线拐点 X

      if (side === 'left') {
        labelX = deviceX - 12 - labelW;
        elbowX = deviceX - 8;
      } else {
        labelX = deviceX + deviceW + 12;
        elbowX = deviceX + deviceW + 8;
      }

      const labelCenterY = labelY + LABEL_H / 2;

      // ---- 绘制连接线 (折线: 源点 → 拐点 → 标签) ----
      ctx.save();
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(srcX, srcY);
      ctx.lineTo(elbowX, srcY);           // 水平到设备边缘外
      ctx.lineTo(elbowX, labelCenterY);   // 垂直到标签中线
      if (side === 'left') {
        ctx.lineTo(labelX + labelW, labelCenterY); // 水平到标签
      } else {
        ctx.lineTo(labelX, labelCenterY);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.restore();

      // ---- 源点圆点 ----
      ctx.save();
      ctx.fillStyle = colors.dot;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(srcX, srcY, DOT_R, 0, Math.PI * 2);
      ctx.fill();
      // 光晕
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(srcX, srcY, DOT_R * 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // ---- 标签背景 ----
      ctx.save();
      simpleRoundRect(ctx, labelX, labelY, labelW, LABEL_H, LABEL_R);
      ctx.fillStyle = colors.bg;
      ctx.fill();
      // 标签边框
      ctx.strokeStyle = colors.line;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();

      // ---- 标签文字 ----
      ctx.save();
      ctx.fillStyle = colors.text;
      ctx.font = `${FONT_SIZE}px -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = side === 'left' ? 'right' : 'left';
      const textX = side === 'left' ? labelX + labelW - LABEL_PAD_X : labelX + LABEL_PAD_X;
      ctx.fillText(item.message, textX, labelCenterY);
      ctx.restore();
    });
  };

  drawSide(leftItems, 'left');
  drawSide(rightItems, 'right');
}

/** 简单圆角矩形 (兼容不支持 roundRect 的浏览器) */
function simpleRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  radii: number | [number, number, number, number],
) {
  const [tl, tr, br, bl] = typeof radii === 'number'
    ? [radii, radii, radii, radii]
    : radii;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h);
  ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl);
  ctx.arcTo(x, y, x + tl, y, tl);
  ctx.closePath();
}

/** 异形屏凹口名称 */
function getCutoutName(type: CutoutType): string {
  const names: Record<CutoutType, string> = {
    none: '无',
    notch: '刘海屏',
    dynamicIsland: '灵动岛',
    waterdrop: '水滴屏',
    punchHole: '挖孔屏',
  };
  return names[type] || '未知';
}

/** 绘制异形屏凹口遮罩 */
function drawCutout(
  ctx: CanvasRenderingContext2D,
  device: DevicePreset,
  orientation: Orientation,
  ox: number, oy: number,
  sw: number,
) {
  if (!device.cutout) return;
  const cutout = device.cutout;
  ctx.fillStyle = OVERLAY_COLORS.cutout;

  // 横屏时需要旋转凹口位置
  let cx: number, cy: number, cw: number, ch: number;
  if (orientation === 'portrait') {
    cx = ox + cutout.x;
    cy = oy + cutout.y;
    cw = cutout.width;
    ch = cutout.height;
  } else {
    // 横屏: 凹口移到左侧
    cx = ox;
    cy = oy + cutout.x;
    cw = cutout.height;
    ch = cutout.width;
  }

  switch (cutout.type) {
    case 'dynamicIsland': {
      const r = Math.min(cw, ch) / 2;
      simpleRoundRect(ctx, cx, cy, cw, ch, r);
      ctx.fill();
      break;
    }
    case 'notch': {
      // 简化刘海: 宽矩形 + 底部圆角
      const nr = cutout.borderRadius || 12;
      simpleRoundRect(ctx, cx, cy, cw, ch, [0, 0, nr, nr]);
      ctx.fill();
      break;
    }
    case 'punchHole': {
      const r = (cutout.borderRadius || Math.min(cw, ch) / 2);
      ctx.beginPath();
      ctx.arc(cx + cw / 2, cy + ch / 2, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'waterdrop': {
      const r = Math.max(cw, ch) / 2;
      ctx.beginPath();
      ctx.arc(cx + cw / 2, cy + r, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}

/** 绘制小程序遮罩 */
function drawMiniProgramOverlay(
  ctx: CanvasRenderingContext2D,
  mp: MiniProgramPreset,
  device: DevicePreset,
  orientation: Orientation,
  ox: number, oy: number,
  sw: number, sh: number,
) {
  const platform = getDevicePlatform(device);
  const safeArea = orientation === 'portrait'
    ? device.safeArea.portrait
    : device.safeArea.landscape;
  const statusBarH = orientation === 'portrait'
    ? device.statusBarHeight.portrait
    : device.statusBarHeight.landscape;
  const navH = platform === 'ios' ? mp.navBarHeight.ios : mp.navBarHeight.android;

  if (orientation === 'portrait') {
    // ---- 竖屏 ----
    // 导航栏 (状态栏下方, 全宽)
    ctx.fillStyle = mp.color;
    ctx.fillRect(ox, oy + statusBarH, sw, navH);

    // 胶囊按钮
    if (mp.capsule) {
      const cap = mp.capsule;
      const capTop = oy + statusBarH + cap.top;
      const capLeft = ox + sw - cap.right - cap.width;
      ctx.fillStyle = mp.color.replace(/[\d.]+\)$/, '0.45)');
      simpleRoundRect(ctx, capLeft, capTop, cap.width, cap.height, cap.borderRadius);
      ctx.fill();
      ctx.strokeStyle = mp.color.replace(/[\d.]+\)$/, '0.6)');
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  } else {
    // ---- 横屏 ----
    // 横屏时小程序导航栏仍在顶部，但需避开左右安全区
    const navLeft = ox + safeArea.left;
    const navWidth = sw - safeArea.left - safeArea.right;
    const navTop = oy + (statusBarH > 0 ? statusBarH : safeArea.top);

    ctx.fillStyle = mp.color;
    ctx.fillRect(navLeft, navTop, navWidth, navH);

    // 胶囊按钮 (横屏时贴右侧安全区内边缘)
    if (mp.capsule) {
      const cap = mp.capsule;
      const capTop = navTop + cap.top;
      const capLeft = navLeft + navWidth - cap.right - cap.width;
      ctx.fillStyle = mp.color.replace(/[\d.]+\)$/, '0.45)');
      simpleRoundRect(ctx, capLeft, capTop, cap.width, cap.height, cap.borderRadius);
      ctx.fill();
      ctx.strokeStyle = mp.color.replace(/[\d.]+\)$/, '0.6)');
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

export default UIAudit;
