import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Monitor, Smartphone, Tablet, FoldVertical, RotateCw,
  Upload, ChevronDown, Keyboard, LayoutGrid, AlertTriangle,
  Shield, Eye, EyeOff, Info, X
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
  /** 画布上标注的区域 (逻辑像素) */
  rect?: { x: number; y: number; w: number; h: number };
}

type Orientation = 'portrait' | 'landscape';
type AndroidNav = 'gesture' | 'threeButton';

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

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  /* ---------- 衍生数据 ---------- */
  const device = useMemo(
    () => DEVICE_PRESETS.find(d => d.id === selectedDeviceId) || DEVICE_PRESETS[0],
    [selectedDeviceId],
  );
  const platform = useMemo(() => getDevicePlatform(device), [device]);
  const screenSize = useMemo(() => getScreenSize(device, orientation), [device, orientation]);
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
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sw = screenSize.width;
    const sh = screenSize.height;
    const PADDING = 20; // 画布内边距(用于设备外框)
    const FRAME_R = 40; // 设备外框圆角
    const FRAME_BORDER = 3; // 外框边框粗细

    const cw = sw + PADDING * 2;
    const ch = sh + PADDING * 2;
    canvas.width = cw;
    canvas.height = ch;

    // 清空
    ctx.clearRect(0, 0, cw, ch);

    // 1. 设备外框 (Apple 平滑圆角)
    ctx.save();
    drawRoundedRect(ctx, FRAME_BORDER / 2, FRAME_BORDER / 2, cw - FRAME_BORDER, ch - FRAME_BORDER, FRAME_R, 80);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = FRAME_BORDER;
    ctx.stroke();
    ctx.restore();

    // 2. 屏幕区域裁剪
    ctx.save();
    ctx.rect(PADDING, PADDING, sw, sh);
    ctx.clip();

    // 2a. 屏幕背景
    ctx.fillStyle = '#111';
    ctx.fillRect(PADDING, PADDING, sw, sh);

    // 2b. 截图
    if (image) {
      const imgW = image.naturalWidth;
      const imgH = image.naturalHeight;
      // 等比缩放填满屏幕
      const scaleX = sw / imgW;
      const scaleY = sh / imgH;
      const scale = Math.max(scaleX, scaleY); // cover
      const dw = imgW * scale;
      const dh = imgH * scale;
      const dx = PADDING + (sw - dw) / 2;
      const dy = PADDING + (sh - dh) / 2;
      ctx.drawImage(image, dx, dy, dw, dh);
    }

    // ---------- 遮罩层 ----------
    if (showOverlays) {
      const ox = PADDING; // 屏幕偏移
      const oy = PADDING;
      const newWarnings: OverlayWarning[] = [];

      // 3. 状态栏/顶部安全区
      if (safeArea.top > 0) {
        ctx.fillStyle = OVERLAY_COLORS.safeAreaTop;
        ctx.fillRect(ox, oy, sw, safeArea.top);
      }

      // 4. 异形屏凹口
      if (device.cutout) {
        drawCutout(ctx, device, orientation, ox, oy, sw);
      }

      // 5. 底部安全区
      if (safeArea.bottom > 0) {
        ctx.fillStyle = OVERLAY_COLORS.safeAreaBottom;
        ctx.fillRect(ox, oy + sh - safeArea.bottom, sw, safeArea.bottom);
      }

      // 6. 横屏左右安全区
      if (safeArea.left > 0) {
        ctx.fillStyle = OVERLAY_COLORS.safeAreaTop;
        ctx.fillRect(ox, oy, safeArea.left, sh);
      }
      if (safeArea.right > 0) {
        ctx.fillStyle = OVERLAY_COLORS.safeAreaTop;
        ctx.fillRect(ox + sw - safeArea.right, oy, safeArea.right, sh);
      }

      // 7. 折叠屏折痕
      if (device.foldCrease) {
        const crease = device.foldCrease;
        ctx.fillStyle = OVERLAY_COLORS.foldCrease;
        if (orientation === 'portrait') {
          if (crease.position === 'vertical') {
            ctx.fillRect(ox + crease.offset - crease.width / 2, oy, crease.width, sh);
          } else {
            ctx.fillRect(ox, oy + crease.offset - crease.width / 2, sw, crease.width);
          }
        } else {
          // 横屏时旋转
          if (crease.position === 'vertical') {
            ctx.fillRect(ox, oy + crease.offset - crease.width / 2, sw, crease.width);
          } else {
            ctx.fillRect(ox + crease.offset - crease.width / 2, oy, crease.width, sh);
          }
        }
        newWarnings.push({
          id: 'fold-crease',
          level: 'warn',
          message: '折叠屏折痕区域 — 避免放置关键交互元素',
        });
      }

      // 8. Android 导航栏 (三键模式时更高)
      if (device.androidNavBar && androidNav === 'threeButton') {
        const navH = device.androidNavBar.threeButton;
        ctx.fillStyle = OVERLAY_COLORS.androidNav;
        if (orientation === 'portrait') {
          ctx.fillRect(ox, oy + sh - navH, sw, navH);
        } else {
          ctx.fillRect(ox + sw - navH, oy, navH, sh);
        }
      }

      // 9. 小程序遮罩
      selectedMiniPrograms.forEach(mpId => {
        const mp = MINIPROGRAM_PRESETS.find(m => m.id === mpId);
        if (!mp) return;
        drawMiniProgramOverlay(ctx, mp, device, orientation, ox, oy, sw, sh);
      });

      // 10. TabBar
      if (showTabBar) {
        const tbH = platform === 'ios' ? 50 : 56;
        const bottomOffset = safeArea.bottom;
        ctx.fillStyle = OVERLAY_COLORS.tabBar;
        if (orientation === 'portrait') {
          ctx.fillRect(ox, oy + sh - bottomOffset - tbH, sw, tbH);
        } else {
          ctx.fillRect(ox + safeArea.left, oy + sh - tbH, sw - safeArea.left - safeArea.right, tbH);
        }
      }

      // 11. 键盘
      if (showKeyboard) {
        const kbH = platform === 'ios'
          ? KEYBOARD_HEIGHTS.ios[orientation]
          : KEYBOARD_HEIGHTS.android[orientation];
        ctx.fillStyle = OVERLAY_COLORS.keyboard;
        if (orientation === 'portrait') {
          ctx.fillRect(ox, oy + sh - kbH, sw, kbH);
        } else {
          ctx.fillRect(ox, oy + sh - kbH, sw, kbH);
        }
        newWarnings.push({
          id: 'keyboard',
          level: 'info',
          message: `键盘弹出高度 ${kbH}pt — 确保输入框可见`,
          rect: { x: 0, y: sh - kbH, w: sw, h: kbH },
        });
      }

      // 生成通用警告
      if (safeArea.top > 0) {
        newWarnings.push({
          id: 'safe-top',
          level: 'warn',
          message: `顶部安全区 ${safeArea.top}pt — 避免放置可交互元素`,
        });
      }
      if (safeArea.bottom > 0) {
        newWarnings.push({
          id: 'safe-bottom',
          level: 'warn',
          message: `底部安全区 ${safeArea.bottom}pt — 底部留出足够空间`,
        });
      }
      if (device.cutout) {
        newWarnings.push({
          id: 'cutout',
          level: 'error',
          message: `${getCutoutName(device.cutout.type)} — 此区域内容会被遮挡`,
        });
      }
      if (selectedMiniPrograms.size > 0) {
        newWarnings.push({
          id: 'mini-program-nav',
          level: 'warn',
          message: `${selectedMiniPrograms.size} 个小程序导航栏遮罩已启用`,
        });
      }

      setWarnings(newWarnings);
    } else {
      setWarnings([]);
    }

    ctx.restore(); // 结束屏幕裁剪

    // 12. 设备外框裁剪 (屏幕四角圆角遮罩)
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    drawRoundedRect(ctx, 0, 0, cw, ch, FRAME_R, 80);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();

    // 13. 重绘边框（因为 destination-in 会擦掉之前画的边框）
    ctx.save();
    drawRoundedRect(ctx, FRAME_BORDER / 2, FRAME_BORDER / 2, cw - FRAME_BORDER, ch - FRAME_BORDER, FRAME_R, 80);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = FRAME_BORDER;
    ctx.stroke();
    ctx.restore();

  }, [image, screenSize, device, orientation, safeArea, androidNav, selectedMiniPrograms, showKeyboard, showTabBar, showOverlays, platform]);

  useEffect(() => { renderCanvas(); }, [renderCanvas]);

  /* ---------- 画布自适应缩放 ---------- */
  const canvasStyle = useMemo(() => {
    const cw = screenSize.width + 40;
    const ch = screenSize.height + 40;
    // 限制预览最大高度
    const maxH = 600;
    const maxW = 500;
    let scale = 1;
    if (ch > maxH) scale = Math.min(scale, maxH / ch);
    if (cw > maxW) scale = Math.min(scale, maxW / cw);
    return {
      width: cw * scale,
      height: ch * scale,
    };
  }, [screenSize]);

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
      {/* ---- 左侧: 画布区 ---- */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 min-w-0 overflow-auto">
        {/* 上传区 / 画布 */}
        {!image ? (
          <div
            data-drop-target="ui-audit"
            className={`w-full max-w-lg aspect-[9/16] rounded-2xl border-2 border-dashed transition-colors flex flex-col items-center justify-center cursor-pointer select-none ${
              isDragging
                ? 'border-blue-400 bg-blue-400/10'
                : 'border-[#333] hover:border-[#555] bg-[#161616]'
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={40} className="text-[#555] mb-3" />
            <p className="text-sm text-[#888]">拖放或点击上传游戏截图</p>
            <p className="text-xs text-[#555] mt-1">支持 PNG / JPG / WebP</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div
              data-drop-target="ui-audit"
              className="relative"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              style={{ width: canvasStyle.width, height: canvasStyle.height }}
            >
              <canvas
                ref={canvasRef}
                className="w-full h-full"
                style={{ imageRendering: 'auto' }}
              />
              {isDragging && (
                <div className="absolute inset-0 bg-blue-400/10 border-2 border-blue-400 rounded-2xl flex items-center justify-center">
                  <p className="text-blue-300 text-sm">释放以替换截图</p>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-[#888]">
              <span>{imageName}</span>
              <span>·</span>
              <span>{device.name}</span>
              <span>·</span>
              <span>{screenSize.width}×{screenSize.height}pt</span>
              <button
                className="ml-2 px-2 py-1 rounded bg-[#222] hover:bg-[#333] text-[#aaa] transition-colors"
                onClick={() => { setImage(null); setImageName(''); }}
              >
                更换截图
              </button>
            </div>
          </div>
        )}
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
          {!image ? (
            <p className="text-xs text-[#555]">上传截图后开始检测</p>
          ) : warnings.length === 0 ? (
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
  const statusBarH = orientation === 'portrait'
    ? device.statusBarHeight.portrait
    : device.statusBarHeight.landscape;
  const navH = platform === 'ios' ? mp.navBarHeight.ios : mp.navBarHeight.android;

  if (orientation === 'portrait') {
    // 导航栏 (状态栏下方)
    ctx.fillStyle = mp.color;
    ctx.fillRect(ox, oy + statusBarH, sw, navH);

    // 胶囊按钮
    if (mp.capsule) {
      const cap = mp.capsule;
      const capTop = oy + statusBarH + cap.top;
      const capLeft = ox + sw - cap.right - cap.width;
      ctx.fillStyle = mp.color.replace(/[\d.]+\)$/, '0.45)'); // 更深一点
      simpleRoundRect(ctx, capLeft, capTop, cap.width, cap.height, cap.borderRadius);
      ctx.fill();
      // 胶囊边框
      ctx.strokeStyle = mp.color.replace(/[\d.]+\)$/, '0.6)');
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  } else {
    // 横屏: 左侧导航栏
    ctx.fillStyle = mp.color;
    ctx.fillRect(ox + statusBarH, oy, navH, sh);
  }
}

export default UIAudit;
