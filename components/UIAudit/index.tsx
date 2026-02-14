import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Monitor, Smartphone, Tablet, FoldVertical,
  Upload, ChevronDown, Keyboard, LayoutGrid, AlertTriangle,
  Shield, Eye, EyeOff, Info, X,
  Flame, Crosshair, MousePointer, Pipette,
  Hand, Loader2, RefreshCw, Scan, Trash2, Plus, Box,
} from 'lucide-react';
import {
  DEVICE_PRESETS, MINIPROGRAM_PRESETS, KEYBOARD_HEIGHTS,
  DevicePreset, MiniProgramPreset,
  getDevicePlatform, getScreenSize, getSafeArea,
  CutoutType,
} from './devicePresets';
import {
  analyzeSaliency, saliencyToHeatmap, terminateWorker,
  type SaliencyResult,
} from './saliencyWorker';
import {
  contrastRatio, getWCAGLevel, getWCAGColor,
  pickAreaColor, rgbToHex, hexToRgb,
  type WCAGLevel,
} from './contrastUtils';
import {
  drawReachabilityOverlay, drawFittsOverlay, calculateFitts,
  getPortraitReachZones, getLandscapeReachZones,
  type FittsResult, type ReachZone,
} from './reachability';
import {
  generateReport, GRADE_COLORS,
  type AuditReport, type PlatformAdaptInput, type SaliencyInput,
  type ReadabilityInput, type EfficiencyInput,
} from './auditScore';
import {
  detectUIElements, sampleBoxColors, computeThumbAnchors, getThumbSize,
  type DetectedBox,
} from './detectors';

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

/** P1 分析工具的交互模式 */
type AnalysisMode = 'none' | 'contrast' | 'fitts' | 'detect';

/* ============================================================
   检测元素类型
   ============================================================ */
interface ElementAnalysis {
  fitts?: { id: number; distance: number; estimatedTime: number; rating: 'easy' | 'moderate' | 'hard' };
  contrast?: { ratio: number; level: WCAGLevel; fg: [number, number, number]; bg: [number, number, number] };
  touchTarget?: { pass: boolean; minSide: number };
  reachZone?: ReachZone;
  saliency?: number;
}

interface DetectedElement extends DetectedBox {
  analysis: ElementAnalysis;
}

/** 拖拽方向控制柄 */
type HandleDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
/** 框交互模式 */
type BoxDragMode = 'none' | 'move' | 'resize' | 'create';

/** 汇总统计 */
interface DetectionSummary {
  totalElements: number;
  avgFittsID: number;
  avgTime: number;
  contrastPassRate: number;
  touchPassRate: number;
  zoneDistribution: { easy: number; ok: number; hard: number };
  misclickRisk: number;
}

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
  /* ---------- P0 状态 ---------- */
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageName, setImageName] = useState<string>('');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('iphone15pro');
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [androidNav, setAndroidNav] = useState<AndroidNav>('gesture');
  const [selectedMiniPrograms, setSelectedMiniPrograms] = useState<Set<string>>(new Set());
  const [showMiniProgramPanel, setShowMiniProgramPanel] = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [showTabBar, setShowTabBar] = useState(false);
  const [showOverlays, setShowOverlays] = useState(true);
  const [warnings, setWarnings] = useState<OverlayWarning[]>([]);
  const [deviceDropdown, setDeviceDropdown] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // 宽高比
  const [aspectMode, setAspectMode] = useState<AspectMode>('preset');
  const [selectedAspectId, setSelectedAspectId] = useState<string>('9:21');
  const [customWidth, setCustomWidth] = useState<number>(393);
  const [customHeight, setCustomHeight] = useState<number>(852);

  /* ---------- P1 状态 ---------- */
  // 视觉显著性热力图
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [saliencyData, setSaliencyData] = useState<SaliencyResult | null>(null);
  const [heatmapOpacity, setHeatmapOpacity] = useState(0.5);

  // 拇指热区
  const [showReachability, setShowReachability] = useState(false);

  /* ---------- P2: 智能检测状态 ---------- */
  const [detectedElements, setDetectedElements] = useState<DetectedElement[]>([]);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [hoveredElementId, setHoveredElementId] = useState<string | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [showDetectBoxes, setShowDetectBoxes] = useState(true);
  const [showPressureOverlay, setShowPressureOverlay] = useState(false);
  const [thumbHand, setThumbHand] = useState<'right' | 'left'>('right');
  // 框拖拽交互 (用 ref 避免频繁 re-render)
  const boxDragRef = useRef<{
    mode: BoxDragMode;
    handle: HandleDir | '';
    elementId: string;
    startMouse: { x: number; y: number };
    startBox: { x: number; y: number; w: number; h: number };
    createStart?: { x: number; y: number };
  }>({ mode: 'none', handle: '', elementId: '', startMouse: { x: 0, y: 0 }, startBox: { x: 0, y: 0, w: 0, h: 0 } });

  // 分析交互模式 (对比度取色 / Fitts 测量)
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('none');

  // WCAG 对比度
  const [contrastFg, setContrastFg] = useState<[number, number, number] | null>(null);
  const [contrastBg, setContrastBg] = useState<[number, number, number] | null>(null);
  const [contrastPickStep, setContrastPickStep] = useState<'fg' | 'bg'>('fg');
  const [manualFgHex, setManualFgHex] = useState('#FFFFFF');
  const [manualBgHex, setManualBgHex] = useState('#000000');

  // Fitts's Law
  const [fittsFrom, setFittsFrom] = useState<{ x: number; y: number } | null>(null);
  const [fittsTo, setFittsTo] = useState<{ x: number; y: number } | null>(null);
  const [fittsTargetSize, setFittsTargetSize] = useState(44);
  const [fittsResult, setFittsResult] = useState<FittsResult | null>(null);

  // 审计报告
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);

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

  /** 工具栏上显示的宽高比标签 */
  const currentAspectLabel = useMemo(() => {
    if (aspectMode === 'device') return `${screenSize.width}×${screenSize.height}`;
    if (aspectMode === 'preset') {
      const p = ASPECT_RATIO_PRESETS.find(a => a.id === selectedAspectId);
      return p ? p.label : selectedAspectId;
    }
    return `${customWidth}×${customHeight}`;
  }, [aspectMode, selectedAspectId, customWidth, customHeight, screenSize]);

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
      img.onload = () => {
        setImage(img);
        // 重置分析数据
        setSaliencyData(null);
        setContrastFg(null);
        setContrastBg(null);
        setFittsFrom(null);
        setFittsTo(null);
        setFittsResult(null);
        setAuditReport(null);
        setDetectedElements([]);
        setSelectedElementId(null);
      };
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
              setSaliencyData(null);
              setAuditReport(null);
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

  /* ---------- P1: 视觉显著性分析 ---------- */
  const runSaliencyAnalysis = useCallback(async () => {
    if (!image) return;
    setHeatmapLoading(true);
    try {
      const result = await analyzeSaliency(image, 400);
      setSaliencyData(result);
      setShowHeatmap(true);
    } catch (err) {
      console.error('Saliency analysis failed:', err);
    } finally {
      setHeatmapLoading(false);
    }
  }, [image]);

  // 清理 Worker
  useEffect(() => {
    return () => terminateWorker();
  }, []);

  // 图片变更时自动清除旧热力图
  useEffect(() => {
    setSaliencyData(null);
    setShowHeatmap(false);
  }, [image]);

  /* ---------- P1: WCAG 对比度计算结果 ---------- */
  const contrastResult = useMemo(() => {
    if (!contrastFg || !contrastBg) return null;
    const ratio = contrastRatio(contrastFg, contrastBg);
    const level = getWCAGLevel(ratio);
    const levelLarge = getWCAGLevel(ratio, true);
    return { ratio, level, levelLarge };
  }, [contrastFg, contrastBg]);

  /* ---------- P2: 智能检测 ---------- */
  const runAutoDetect = useCallback(() => {
    if (!image) return;
    setIsDetecting(true);
    // 异步执行避免阻塞 UI
    requestAnimationFrame(() => {
      try {
        const boxes = detectUIElements(image, screenSize.width, screenSize.height);
        // 转换为 DetectedElement (analysis 后面计算)
        const elements: DetectedElement[] = boxes.map(b => ({ ...b, analysis: {} }));
        setDetectedElements(elements);
        setAnalysisMode('detect');
      } catch (err) {
        console.error('Auto-detection failed:', err);
      } finally {
        setIsDetecting(false);
      }
    });
  }, [image, screenSize]);

  /** 分析所有检测框 (Fitts, Contrast, Touch, Reachability, Saliency) */
  const analyzeAllElements = useCallback(() => {
    if (detectedElements.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sw = screenSize.width;
    const sh = screenSize.height;

    // 拇指锚点
    const anchors = computeThumbAnchors(sw, sh, orientation, thumbHand);

    // 热区分布
    const { zones } = orientation === 'portrait'
      ? getPortraitReachZones(sw, sh)
      : getLandscapeReachZones(sw, sh);

    const updated = detectedElements.map(el => {
      const cx = el.x + el.w / 2;
      const cy = el.y + el.h / 2;

      // Fitts: 距最近锚点
      let bestFitts: ElementAnalysis['fitts'] | undefined;
      for (const anchor of anchors) {
        const dx = cx - anchor.x;
        const dy = cy - anchor.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const W = Math.max(Math.min(el.w, el.h), 1);
        const id = Math.log2(dist / W + 1);
        if (!Number.isFinite(id)) continue;
        const mt = 50 + 150 * id;
        const rating: 'easy' | 'moderate' | 'hard' = id > 4 ? 'hard' : id > 2.5 ? 'moderate' : 'easy';
        if (!bestFitts || id < bestFitts.id) {
          bestFitts = { id: Math.round(id * 100) / 100, distance: Math.round(dist), estimatedTime: Math.round(mt), rating };
        }
      }

      // 对比度: 从画布采样 (只在框足够大时)
      const screenX = 200; // ANNOTATION_MARGIN
      const screenY = 20;
      let contrastAnalysis: ElementAnalysis['contrast'] | undefined;
      if (el.w >= 10 && el.h >= 10) {
        const colors = sampleBoxColors(ctx, screenX + el.x, screenY + el.y, el.w, el.h);
        if (colors) {
          const ratio = contrastRatio(colors.fg, colors.bg);
          if (Number.isFinite(ratio)) {
            const level = getWCAGLevel(ratio);
            contrastAnalysis = { ratio: Math.round(ratio * 100) / 100, level, fg: colors.fg, bg: colors.bg };
          }
        }
      }

      // 触控目标
      const minSide = Math.min(el.w, el.h);
      const touchPass = minSide >= 44;

      // 热区
      let reachZone: ReachZone = 'hard';
      for (const z of zones) {
        if (cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h) {
          reachZone = z.zone;
          break;
        }
      }

      // 显著性
      let saliencyAvg: number | undefined;
      if (saliencyData) {
        const sMap = saliencyData.saliencyMap;
        const sW = saliencyData.width;
        const sH = saliencyData.height;
        const scaleX = sW / sw;
        const scaleY = sH / sh;
        let sum = 0, cnt = 0;
        const sx0 = Math.max(0, Math.floor(el.x * scaleX));
        const sy0 = Math.max(0, Math.floor(el.y * scaleY));
        const sx1 = Math.min(sW - 1, Math.floor((el.x + el.w) * scaleX));
        const sy1 = Math.min(sH - 1, Math.floor((el.y + el.h) * scaleY));
        for (let sy = sy0; sy <= sy1; sy++) {
          for (let sx = sx0; sx <= sx1; sx++) {
            sum += sMap[sy * sW + sx];
            cnt++;
          }
        }
        if (cnt > 0) saliencyAvg = sum / cnt;
      }

      return {
        ...el,
        analysis: {
          fitts: bestFitts,
          contrast: contrastAnalysis,
          touchTarget: { pass: touchPass, minSide: Math.round(minSide) },
          reachZone,
          saliency: saliencyAvg !== undefined ? Math.round(saliencyAvg * 100) / 100 : undefined,
        },
      };
    });

    setDetectedElements(updated);
  }, [detectedElements, screenSize, orientation, thumbHand, saliencyData]);

  // 检测元素变化时自动分析
  useEffect(() => {
    if (detectedElements.length > 0 && !detectedElements[0].analysis.fitts) {
      // 延迟一帧, 等画布渲染完毕再采样颜色
      const timer = setTimeout(analyzeAllElements, 100);
      return () => clearTimeout(timer);
    }
  }, [detectedElements.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 检测汇总统计 */
  const detectionSummary = useMemo((): DetectionSummary | null => {
    const els = detectedElements;
    if (els.length === 0) return null;
    const fittsEls = els.filter(e => e.analysis.fitts);
    const contrastEls = els.filter(e => e.analysis.contrast);
    const touchEls = els.filter(e => e.analysis.touchTarget);

    const avgFittsID = fittsEls.length > 0
      ? fittsEls.reduce((s, e) => s + e.analysis.fitts!.id, 0) / fittsEls.length : 0;
    const avgTime = fittsEls.length > 0
      ? fittsEls.reduce((s, e) => s + e.analysis.fitts!.estimatedTime, 0) / fittsEls.length : 0;
    const contrastPass = contrastEls.filter(e => e.analysis.contrast!.level !== 'Fail').length;
    const touchPass = touchEls.filter(e => e.analysis.touchTarget!.pass).length;

    const zoneDist = { easy: 0, ok: 0, hard: 0 };
    for (const e of els) {
      if (e.analysis.reachZone) zoneDist[e.analysis.reachZone]++;
    }

    // 误触风险: 检测相邻元素间距 < 8px
    let misclickCount = 0;
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i], b = els[j];
        const gapX = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
        const gapY = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
        if (gapX < 8 && gapY < 8) misclickCount++;
      }
    }

    return {
      totalElements: els.length,
      avgFittsID: Number.isFinite(avgFittsID) ? Math.round(avgFittsID * 100) / 100 : 0,
      avgTime: Number.isFinite(avgTime) ? Math.round(avgTime) : 0,
      contrastPassRate: contrastEls.length > 0 ? Math.round((contrastPass / contrastEls.length) * 100) : 0,
      touchPassRate: touchEls.length > 0 ? Math.round((touchPass / touchEls.length) * 100) : 0,
      zoneDistribution: zoneDist,
      misclickRisk: misclickCount,
    };
  }, [detectedElements]);

  /* ---------- 画布渲染 ---------- */
  const ANNOTATION_MARGIN = 200; // 标注区域宽度 (设备两侧)

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sw = screenSize.width;
    const sh = screenSize.height;
    const FRAME_R = 40;       // 设备圆角
    const FRAME_BORDER = 2.5; // 边框粗细

    // 设备帧 = 屏幕区域 (截图撑满圆角容器)
    const deviceW = sw;
    const deviceH = sh;

    // 画布总尺寸 = 标注区 + 设备 + 标注区
    const cw = ANNOTATION_MARGIN + deviceW + ANNOTATION_MARGIN;
    const ch = deviceH + 40; // 上下各留 20
    canvas.width = cw;
    canvas.height = ch;

    const deviceX = ANNOTATION_MARGIN; // 设备帧左上角 X
    const deviceY = 20;                // 设备帧左上角 Y
    const screenX = deviceX;           // 屏幕 = 设备帧 (无间距)
    const screenY = deviceY;

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

    // 2b. 截图 (cover 缩放: 铺满屏幕区域, 溢出居中裁切)
    // 计算 cover 坐标, 热力图复用同一组坐标以保持对齐
    let imgDx = screenX, imgDy = screenY, imgDw = sw, imgDh = sh;
    if (image) {
      const imgW = image.naturalWidth;
      const imgH = image.naturalHeight;
      const scaleX = sw / imgW;
      const scaleY = sh / imgH;
      const scale = Math.max(scaleX, scaleY);
      imgDw = imgW * scale;
      imgDh = imgH * scale;
      imgDx = screenX + (sw - imgDw) / 2;
      imgDy = screenY + (sh - imgDh) / 2;
      ctx.drawImage(image, imgDx, imgDy, imgDw, imgDh);
    }

    // 2c. 热力图叠加 — 使用与截图相同的 cover 坐标
    if (showHeatmap && saliencyData && image) {
      const heatmap = saliencyToHeatmap(
        saliencyData.saliencyMap,
        saliencyData.width,
        saliencyData.height,
        heatmapOpacity,
      );
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = saliencyData.width;
      tmpCanvas.height = saliencyData.height;
      const tmpCtx = tmpCanvas.getContext('2d')!;
      tmpCtx.putImageData(heatmap, 0, 0);
      // 热力图与截图使用完全相同的 cover 坐标, 保证对齐
      ctx.drawImage(tmpCanvas, imgDx, imgDy, imgDw, imgDh);
    }

    // 2d. 拇指热区遮罩
    if (showReachability) {
      drawReachabilityOverlay(ctx, screenX, screenY, sw, sh, orientation);
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
            ctx.fillRect(ox + crease.offset - halfW, oy, crease.width, sh);
            creaseRect = { x: crease.offset - halfW, y: sh * 0.5, w: crease.width, h: 10 };
            creaseSide = crease.offset < sw / 2 ? 'left' : 'right';
          } else {
            ctx.fillRect(ox, oy + crease.offset - halfW, sw, crease.width);
            creaseRect = { x: 0, y: crease.offset - halfW, w: sw, h: crease.width };
            creaseSide = 'left';
          }
        } else {
          if (crease.position === 'vertical') {
            ctx.fillRect(ox, oy + crease.offset - halfW, sw, crease.width);
            creaseRect = { x: 0, y: crease.offset - halfW, w: sw, h: crease.width };
            creaseSide = 'left';
          } else {
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
          mpRect = { x: 0, y: statusH, w: sw, h: navH };
          mpSide = mpIndex % 2 === 0 ? 'left' : 'right';
        } else {
          const navTop = statusH > 0 ? statusH : safeArea.top;
          const navW = sw - safeArea.left - safeArea.right;
          mpRect = { x: safeArea.left, y: navTop, w: navW, h: navH };
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

    // P1: Fitts's Law 绘制
    if (fittsResult) {
      drawFittsOverlay(ctx, fittsResult, screenX, screenY);
    } else if (fittsFrom && !fittsTo) {
      // 绘制起点标记
      ctx.save();
      ctx.fillStyle = '#3b82f6';
      ctx.beginPath();
      ctx.arc(screenX + fittsFrom.x, screenY + fittsFrom.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(screenX + fittsFrom.x, screenY + fittsFrom.y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ========== P2: 操作压力遮罩 ==========
    if (showPressureOverlay && detectedElements.length > 0) {
      const anchors = computeThumbAnchors(sw, sh, orientation, thumbHand);
      ctx.save();
      ctx.globalAlpha = 0.18;
      // 为每个像素行绘制渐变 (简化: 水平条带)
      const bandH = Math.max(4, Math.ceil(sh / 60));
      for (let by = 0; by < sh; by += bandH) {
        for (let bx = 0; bx < sw; bx += bandH) {
          const px = bx + bandH / 2, py = by + bandH / 2;
          let minDist = Infinity;
          for (const a of anchors) {
            const d = Math.sqrt((px - a.x) ** 2 + (py - a.y) ** 2);
            if (d < minDist) minDist = d;
          }
          const maxDist = Math.sqrt(sw * sw + sh * sh) * 0.6;
          const t = Math.min(1, minDist / maxDist);
          // 绿 → 黄 → 红
          const r = t < 0.5 ? Math.round(t * 2 * 255) : 255;
          const g = t < 0.5 ? 255 : Math.round((1 - (t - 0.5) * 2) * 255);
          ctx.fillStyle = `rgb(${r},${g},0)`;
          ctx.fillRect(screenX + bx, screenY + by, bandH, bandH);
        }
      }
      ctx.restore();
    }

    // ========== P2: 检测框 + 控制柄 ==========
    //   三层可见度:
    //     默认: 不画任何东西 (干净画面)
    //     showDetectBoxes=true: 极淡边框角标
    //     hovered: 中等高亮
    //     selected: 完整详情 + 控制柄
    if (analysisMode === 'detect' && detectedElements.length > 0) {
      ctx.save();
      const HANDLE_SIZE = 5;

      // 辅助: 绘制高亮框 (hover 和 selected 共用)
      const drawHighlightBox = (el: typeof detectedElements[0], isSelected: boolean) => {
        const bx = screenX + el.x, by = screenY + el.y;
        let color = '#3b82f6';
        if (el.analysis.fitts) {
          color = el.analysis.fitts.rating === 'easy' ? '#22c55e'
            : el.analysis.fitts.rating === 'moderate' ? '#f59e0b' : '#ef4444';
        }
        const touchFail = el.analysis.touchTarget && !el.analysis.touchTarget.pass;

        // 边框
        ctx.strokeStyle = color;
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        ctx.globalAlpha = isSelected ? 1 : 0.8;
        ctx.setLineDash(touchFail ? [4, 3] : []);
        ctx.strokeRect(bx, by, el.w, el.h);
        ctx.setLineDash([]);

        // 填充
        ctx.fillStyle = color + (isSelected ? '18' : '10');
        ctx.fillRect(bx, by, el.w, el.h);
        ctx.globalAlpha = 1;

        // 标签
        const labelText = el.label === 'button' ? 'BTN'
          : el.label === 'icon' ? 'ICO'
          : el.label === 'card' ? 'CARD' : 'RGN';
        const fittsText = el.analysis.fitts && Number.isFinite(el.analysis.fitts.id)
          ? ` ID=${el.analysis.fitts.id}` : '';
        ctx.font = `${isSelected ? 'bold ' : ''}10px "SF Pro Display", -apple-system, sans-serif`;
        const fullLabel = isSelected
          ? `${labelText} ${el.w}×${el.h}${fittsText}`
          : `${labelText}${fittsText}`;
        const lw = ctx.measureText(fullLabel).width + 8;
        const lh = 15;
        const ly = by - lh - 2 > screenY ? by - lh - 2 : by + el.h + 2;
        // 圆角背景
        ctx.fillStyle = color;
        const lr = 3;
        ctx.beginPath();
        ctx.moveTo(bx + lr, ly);
        ctx.lineTo(bx + lw - lr, ly);
        ctx.quadraticCurveTo(bx + lw, ly, bx + lw, ly + lr);
        ctx.lineTo(bx + lw, ly + lh - lr);
        ctx.quadraticCurveTo(bx + lw, ly + lh, bx + lw - lr, ly + lh);
        ctx.lineTo(bx + lr, ly + lh);
        ctx.quadraticCurveTo(bx, ly + lh, bx, ly + lh - lr);
        ctx.lineTo(bx, ly + lr);
        ctx.quadraticCurveTo(bx, ly, bx + lr, ly);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(fullLabel, bx + 4, ly + 2.5);

        // 选中: 8 个控制柄
        if (isSelected) {
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          const hs = HANDLE_SIZE;
          const handles: [number, number][] = [
            [bx - hs, by - hs], [bx + el.w / 2 - hs, by - hs], [bx + el.w - hs, by - hs],
            [bx - hs, by + el.h / 2 - hs], [bx + el.w - hs, by + el.h / 2 - hs],
            [bx - hs, by + el.h - hs], [bx + el.w / 2 - hs, by + el.h - hs], [bx + el.w - hs, by + el.h - hs],
          ];
          for (const [hx, hy] of handles) {
            ctx.fillRect(hx, hy, hs * 2, hs * 2);
            ctx.strokeRect(hx, hy, hs * 2, hs * 2);
          }
        }
      };

      // 层1: 所有非高亮框 — showDetectBoxes 时画细虚线框 + 序号
      if (showDetectBoxes) {
        detectedElements.forEach((el, idx) => {
          if (el.id === selectedElementId || el.id === hoveredElementId) return;
          const bx = screenX + el.x, by = screenY + el.y;
          let color = '#3b82f6';
          if (el.analysis.fitts) {
            color = el.analysis.fitts.rating === 'easy' ? '#22c55e'
              : el.analysis.fitts.rating === 'moderate' ? '#f59e0b' : '#ef4444';
          }

          // 虚线边框 — 双层描边法 (暗底 + 亮色, 任何背景都清晰)
          ctx.setLineDash([4, 3]);
          // 底层: 深色阴影 (保证在浅色/彩色背景上可见)
          ctx.strokeStyle = 'rgba(0,0,0,0.55)';
          ctx.lineWidth = 2.5;
          ctx.globalAlpha = 1;
          ctx.strokeRect(bx, by, el.w, el.h);
          // 上层: 彩色描边
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(bx, by, el.w, el.h);
          ctx.setLineDash([]);

          // 左上角序号标记 (圆形, 带暗边)
          const numStr = String(idx + 1);
          ctx.font = 'bold 9px "SF Pro Display", -apple-system, sans-serif';
          const numW = ctx.measureText(numStr).width;
          const badgeR = Math.max(8, (numW + 8) / 2);
          const badgeCX = bx + badgeR + 1;
          const badgeCY = by + badgeR + 1;
          // 暗色外圈
          ctx.beginPath();
          ctx.arc(badgeCX, badgeCY, badgeR + 1.5, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fill();
          // 彩色圆
          ctx.beginPath();
          ctx.arc(badgeCX, badgeCY, badgeR, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          // 白色数字
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(numStr, badgeCX, badgeCY + 0.5);
        });
      }

      // 层2: hover 高亮 (来自侧边栏列表悬停)
      if (hoveredElementId && hoveredElementId !== selectedElementId) {
        const hoverEl = detectedElements.find(e => e.id === hoveredElementId);
        if (hoverEl) drawHighlightBox(hoverEl, false);
      }

      // 层3: 选中框 (完整详情)
      const selectedEl = detectedElements.find(e => e.id === selectedElementId);
      if (selectedEl) drawHighlightBox(selectedEl, true);

      // 拇指锚点 — 真实尺寸椭圆模拟
      const anchors = computeThumbAnchors(sw, sh, orientation, thumbHand);
      const thumbSz = getThumbSize(sw, sh, orientation);
      // sw/sh 在画布上是 1:1 映射, 不需要额外缩放
      const thumbRX = thumbSz.rx;
      const thumbRY = thumbSz.ry;
      for (const a of anchors) {
        const cx = screenX + a.x;
        const cy = screenY + a.y;
        ctx.save();
        // 绘制拇指椭圆 (肤色半透明)
        ctx.beginPath();
        ctx.ellipse(cx, cy, thumbRX, thumbRY, 0, 0, Math.PI * 2);
        // 径向渐变模拟指腹压力 (中心重、边缘淡)
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(thumbRX, thumbRY));
        grad.addColorStop(0, 'rgba(230, 175, 140, 0.55)');  // 肤色中心
        grad.addColorStop(0.6, 'rgba(220, 160, 120, 0.35)');
        grad.addColorStop(1, 'rgba(200, 140, 100, 0.08)');   // 边缘淡出
        ctx.fillStyle = grad;
        ctx.fill();
        // 边缘描边
        ctx.strokeStyle = 'rgba(200, 140, 100, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // 中心小点 (锚点标识)
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(180, 100, 60, 0.8)';
        ctx.fill();
        ctx.restore();
      }

      ctx.restore();
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

  }, [image, screenSize, device, orientation, safeArea, androidNav, selectedMiniPrograms,
      showKeyboard, showTabBar, showOverlays, platform,
      showHeatmap, saliencyData, heatmapOpacity, showReachability,
      fittsFrom, fittsTo, fittsResult,
      analysisMode, detectedElements, selectedElementId, hoveredElementId,
      showDetectBoxes, showPressureOverlay, thumbHand]);

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
    const deviceW = screenSize.width;
    const deviceH = screenSize.height;
    return {
      width: ANNOTATION_MARGIN + deviceW + ANNOTATION_MARGIN,
      height: deviceH + 40, // 上下各 20 给画布留白
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

  /* ---------- 画布坐标转换工具 ---------- */
  const canvasToScreen = useCallback((clientX: number, clientY: number): { sx: number; sy: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = (clientX - rect.left) * scaleX;
    const cy = (clientY - rect.top) * scaleY;
    const sx = cx - ANNOTATION_MARGIN;
    const sy = cy - 20;
    if (sx < 0 || sx > screenSize.width || sy < 0 || sy > screenSize.height) return null;
    return { sx, sy };
  }, [screenSize]);

  /* ---------- P2: 检测框交互 ---------- */
  const hitTestElement = useCallback((sx: number, sy: number): {
    elementId: string | null;
    handle: HandleDir | '';
  } => {
    const HS = 8; // handle hit area
    for (let i = detectedElements.length - 1; i >= 0; i--) {
      const el = detectedElements[i];
      // 检查控制柄 (仅选中元素)
      if (el.id === selectedElementId) {
        const handles: { dir: HandleDir; cx: number; cy: number }[] = [
          { dir: 'nw', cx: el.x, cy: el.y },
          { dir: 'n', cx: el.x + el.w / 2, cy: el.y },
          { dir: 'ne', cx: el.x + el.w, cy: el.y },
          { dir: 'w', cx: el.x, cy: el.y + el.h / 2 },
          { dir: 'e', cx: el.x + el.w, cy: el.y + el.h / 2 },
          { dir: 'sw', cx: el.x, cy: el.y + el.h },
          { dir: 's', cx: el.x + el.w / 2, cy: el.y + el.h },
          { dir: 'se', cx: el.x + el.w, cy: el.y + el.h },
        ];
        for (const h of handles) {
          if (Math.abs(sx - h.cx) <= HS && Math.abs(sy - h.cy) <= HS) {
            return { elementId: el.id, handle: h.dir };
          }
        }
      }
      // 检查框体
      if (sx >= el.x && sx <= el.x + el.w && sy >= el.y && sy <= el.y + el.h) {
        return { elementId: el.id, handle: '' };
      }
    }
    return { elementId: null, handle: '' };
  }, [detectedElements, selectedElementId]);

  /* ---------- 画布鼠标事件 (对比度/Fitts/检测统一入口) ---------- */
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || !image) return;
    const pos = canvasToScreen(e.clientX, e.clientY);
    if (!pos) return;

    if (analysisMode === 'detect') {
      const hit = hitTestElement(pos.sx, pos.sy);
      if (hit.handle) {
        // 开始缩放
        const el = detectedElements.find(e => e.id === hit.elementId);
        if (!el) return;
        boxDragRef.current = {
          mode: 'resize', handle: hit.handle, elementId: el.id,
          startMouse: pos, startBox: { x: el.x, y: el.y, w: el.w, h: el.h },
        };
        e.preventDefault();
      } else if (hit.elementId) {
        // 选中 + 开始移动
        setSelectedElementId(hit.elementId);
        const el = detectedElements.find(e => e.id === hit.elementId);
        if (!el) return;
        boxDragRef.current = {
          mode: 'move', handle: '', elementId: el.id,
          startMouse: pos, startBox: { x: el.x, y: el.y, w: el.w, h: el.h },
        };
        e.preventDefault();
      } else {
        // 空白区域: 开始创建新框
        setSelectedElementId(null);
        boxDragRef.current = {
          mode: 'create', handle: '', elementId: '',
          startMouse: pos, startBox: { x: pos.sx, y: pos.sy, w: 0, h: 0 },
          createStart: pos,
        };
        e.preventDefault();
      }
      return;
    }

    // 非检测模式: P1 的点击逻辑
    if (analysisMode === 'contrast') {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const canvasX = (e.clientX - rect.left) * scaleX;
      const canvasY = (e.clientY - rect.top) * scaleY;
      const color = pickAreaColor(ctx, canvasX, canvasY, 2);

      if (contrastPickStep === 'fg') {
        setContrastFg(color);
        setManualFgHex(rgbToHex(...color));
        setContrastPickStep('bg');
      } else {
        setContrastBg(color);
        setManualBgHex(rgbToHex(...color));
        setContrastPickStep('fg');
      }
    } else if (analysisMode === 'fitts') {
      if (!fittsFrom || fittsResult) {
        setFittsFrom({ x: pos.sx, y: pos.sy });
        setFittsTo(null);
        setFittsResult(null);
      } else {
        const to = { x: pos.sx, y: pos.sy };
        setFittsTo(to);
        setFittsResult(calculateFitts(fittsFrom, to, fittsTargetSize));
      }
    }
  }, [analysisMode, image, canvasToScreen, hitTestElement, detectedElements,
      contrastPickStep, fittsFrom, fittsResult, fittsTargetSize]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    const drag = boxDragRef.current;
    if (drag.mode === 'none') return;
    const pos = canvasToScreen(e.clientX, e.clientY);
    if (!pos) return;

    const dx = pos.sx - drag.startMouse.x;
    const dy = pos.sy - drag.startMouse.y;

    if (drag.mode === 'move') {
      setDetectedElements(prev => prev.map(el =>
        el.id === drag.elementId
          ? { ...el, x: Math.max(0, drag.startBox.x + dx), y: Math.max(0, drag.startBox.y + dy), analysis: {} }
          : el
      ));
    } else if (drag.mode === 'resize') {
      setDetectedElements(prev => prev.map(el => {
        if (el.id !== drag.elementId) return el;
        let { x, y, w, h } = drag.startBox;
        const dir = drag.handle;
        if (dir.includes('w')) { x += dx; w -= dx; }
        if (dir.includes('e')) { w += dx; }
        if (dir.includes('n')) { y += dy; h -= dy; }
        if (dir.includes('s')) { h += dy; }
        // 最小 10×10
        if (w < 10) { if (dir.includes('w')) x = drag.startBox.x + drag.startBox.w - 10; w = 10; }
        if (h < 10) { if (dir.includes('n')) y = drag.startBox.y + drag.startBox.h - 10; h = 10; }
        return { ...el, x: Math.max(0, x), y: Math.max(0, y), w, h, analysis: {} };
      }));
    } else if (drag.mode === 'create' && drag.createStart) {
      // 实时预览创建的框 (暂存为 temp 元素)
      const x = Math.min(drag.createStart.sx, pos.sx);
      const y = Math.min(drag.createStart.sy, pos.sy);
      const w = Math.abs(pos.sx - drag.createStart.sx);
      const h = Math.abs(pos.sy - drag.createStart.sy);
      if (w > 5 && h > 5) {
        const tempId = 'creating-temp';
        setDetectedElements(prev => {
          const rest = prev.filter(e => e.id !== tempId);
          return [...rest, {
            id: tempId, x, y, w, h,
            confidence: 1, label: 'unknown' as const, source: 'manual' as const, analysis: {},
          }];
        });
        setSelectedElementId(tempId);
      }
    }
  }, [canvasToScreen]);

  const handleCanvasMouseUp = useCallback(() => {
    const drag = boxDragRef.current;
    if (drag.mode === 'create') {
      // 完成创建: 将 temp id 改为正式 id
      setDetectedElements(prev => prev.map(el =>
        el.id === 'creating-temp'
          ? { ...el, id: `manual-${Date.now()}`, label: 'unknown' as const, source: 'manual' as const, analysis: {} }
          : el
      ).filter(el => el.w >= 10 && el.h >= 10));
    }
    if (drag.mode !== 'none') {
      // 拖拽结束后重新分析
      setTimeout(() => analyzeAllElements(), 50);
    }
    boxDragRef.current = { mode: 'none', handle: '', elementId: '', startMouse: { x: 0, y: 0 }, startBox: { x: 0, y: 0, w: 0, h: 0 } };
  }, [analyzeAllElements]);

  // 键盘: Delete 删除选中框
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedElementId && analysisMode === 'detect') {
          // 避免在 input 中触发
          if ((e.target as HTMLElement).tagName === 'INPUT') return;
          setDetectedElements(prev => prev.filter(el => el.id !== selectedElementId));
          setSelectedElementId(null);
          e.preventDefault();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedElementId, analysisMode]);

  // 向后兼容: handleCanvasClick 改为 handleCanvasMouseDown
  const handleCanvasClick = handleCanvasMouseDown;

  /* ---------- P1: 生成审计报告 ---------- */
  const generateAuditReport = useCallback(() => {
    // A: 平台适配
    const platformInput: PlatformAdaptInput = {
      overlayWarnings: warnings.filter(w => w.level === 'error' || w.level === 'warn').length,
      hasCutoutConflict: warnings.some(w => w.id === 'cutout'),
      hasSafeAreaConflict: false, // 基础检测
      miniProgramCount: selectedMiniPrograms.size,
    };

    // B: 视觉显著性
    let focusConcentration: number | undefined;
    if (saliencyData) {
      // 计算高显著区域的集中度 (>0.5 阈值的像素占比)
      const highCount = saliencyData.saliencyMap.reduce((s, v) => s + (v > 0.5 ? 1 : 0), 0);
      focusConcentration = 1 - (highCount / saliencyData.saliencyMap.length); // 集中度 = 1 - 分散度
    }
    const saliencyInput: SaliencyInput = {
      analyzed: !!saliencyData,
      focusConcentration,
      focusInSafeArea: undefined,
    };

    // C: 可读性
    const readabilityInput: ReadabilityInput = {
      contrastResults: contrastResult ? [{ ratio: contrastResult.ratio, pass: contrastResult.level !== 'Fail' }] : [],
      textSizeResults: [],
      touchTargetResults: [],
    };

    // D: 操作效率
    const efficiencyInput: EfficiencyInput = {
      fittsResults: fittsResult ? [{ indexOfDifficulty: fittsResult.indexOfDifficulty, rating: fittsResult.rating }] : [],
      criticalInEasyZone: undefined,
    };

    const report = generateReport(platformInput, saliencyInput, readabilityInput, efficiencyInput);
    setAuditReport(report);
  }, [warnings, selectedMiniPrograms, saliencyData, contrastResult, fittsResult]);

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
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        style={{
          cursor: isPanningRef.current ? 'grabbing'
            : analysisMode === 'contrast' ? 'crosshair'
            : analysisMode === 'fitts' ? 'crosshair'
            : 'default',
        }}
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
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                style={{
                  width: canvasStyle.width,
                  height: canvasStyle.height,
                  imageRendering: 'auto',
                  cursor: analysisMode === 'detect'
                    ? (boxDragRef.current.mode !== 'none' ? 'grabbing' : 'crosshair')
                    : analysisMode !== 'none' ? 'crosshair' : 'default',
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
            {analysisMode !== 'none' && (
              <>
                <span>·</span>
                <span className="text-amber-400">
                  {analysisMode === 'contrast' ? `取色模式 (${contrastPickStep === 'fg' ? '点击选前景色' : '点击选背景色'})` : '点击画面标记起/终点'}
                </span>
              </>
            )}
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
        {/* ---- 设备配置工具栏 (设备 + 宽高比 + 方向 合一) ---- */}
        <div className="px-3 py-2 border-b border-[#222] flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0" ref={dropdownRef}>
            <button
              className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-[#1e1e1e] rounded-lg text-xs hover:bg-[#252525] transition-colors"
              onClick={() => setDeviceDropdown(!deviceDropdown)}
            >
              <Monitor size={12} className="shrink-0 text-[#555]" />
              <span className="truncate">
                <span className="text-[#ccc]">{device.name}</span>
                <span className="text-[#333] mx-1">·</span>
                <span className="text-[#777]">{currentAspectLabel}</span>
              </span>
              <ChevronDown size={11} className={`ml-auto shrink-0 text-[#555] transition-transform ${deviceDropdown ? 'rotate-180' : ''}`} />
            </button>

            {deviceDropdown && (
              <div
                className="absolute z-50 mt-1 bg-[#1a1a1a] border border-[#333] rounded-xl shadow-2xl overflow-hidden"
                style={{ left: 0, width: 'calc(100% + 42px)', maxHeight: '75vh' }}
              >
                <div className="overflow-y-auto" style={{ maxHeight: '75vh' }}>
                  {/* ── 设备 ── */}
                  <div className="px-3 py-1.5 text-[10px] text-[#555] uppercase tracking-wider bg-[#1a1a1a] border-b border-[#252525]">
                    设备
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {Object.entries(deviceGroups).map(([cat, devices]) => {
                      const Icon = CATEGORY_ICONS[cat] || Monitor;
                      return (
                        <div key={cat}>
                          <div className="px-3 py-1 text-[10px] text-[#555] flex items-center gap-1.5 bg-[#1a1a1a]">
                            <Icon size={10} />
                            {cat === 'phone' ? '手机' : cat === 'tablet' ? '平板' : '折叠屏'}
                          </div>
                          {devices.map(d => (
                            <button
                              key={d.id}
                              className={`w-full text-left px-3 py-1 text-xs hover:bg-[#252525] transition-colors flex items-center gap-1.5 ${
                                d.id === selectedDeviceId ? 'text-blue-400 bg-blue-500/10' : 'text-[#ccc]'
                              }`}
                              onClick={() => setSelectedDeviceId(d.id)}
                            >
                              <span className="truncate">{d.name}</span>
                              <span className="text-[#555] shrink-0">{d.screen.width}×{d.screen.height}</span>
                              {d.cutout && d.cutout.type !== 'none' && (
                                <span className="ml-auto shrink-0 text-[9px] px-1 py-0.5 rounded bg-[#2a2020] text-red-400/70">
                                  {getCutoutName(d.cutout.type)}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>

                  {/* ── 宽高比 ── */}
                  <div className="px-3 py-1.5 text-[10px] text-[#555] uppercase tracking-wider bg-[#1a1a1a] border-t border-b border-[#252525]">
                    宽高比
                  </div>
                  <div className="p-2.5 space-y-2">
                    <div className="flex bg-[#222] rounded-lg overflow-hidden">
                      {(['device', 'preset', 'custom'] as AspectMode[]).map(mode => (
                        <button
                          key={mode}
                          className={`flex-1 px-2 py-1 text-[11px] transition-colors ${
                            aspectMode === mode ? 'bg-blue-500/20 text-blue-400' : 'text-[#666] hover:text-white'
                          }`}
                          onClick={() => setAspectMode(mode)}
                        >
                          {mode === 'device' ? '跟随设备' : mode === 'preset' ? '预设' : '自定义'}
                        </button>
                      ))}
                    </div>

                    {aspectMode === 'preset' && (
                      <div className="grid grid-cols-3 gap-1">
                        {ASPECT_RATIO_PRESETS.map(p => (
                          <button
                            key={p.id}
                            className={`px-1.5 py-1 rounded text-center transition-colors ${
                              selectedAspectId === p.id
                                ? 'bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30'
                                : 'bg-[#222] text-[#aaa] hover:bg-[#2a2a2a]'
                            }`}
                            onClick={() => setSelectedAspectId(p.id)}
                            title={p.desc}
                          >
                            <div className="text-[11px] font-medium leading-tight">{p.label}</div>
                            <div className="text-[9px] text-[#555] truncate">{p.desc}</div>
                          </button>
                        ))}
                      </div>
                    )}

                    {aspectMode === 'custom' && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-[#555]">W</span>
                        <input
                          type="number" value={customWidth}
                          onChange={e => setCustomWidth(parseInt(e.target.value) || 100)}
                          className="w-14 px-1.5 py-0.5 bg-[#222] border border-[#333] rounded text-[11px] text-white text-center focus:border-blue-500 focus:outline-none"
                          min={100} max={3000}
                        />
                        <X size={8} className="text-[#444]" />
                        <span className="text-[10px] text-[#555]">H</span>
                        <input
                          type="number" value={customHeight}
                          onChange={e => setCustomHeight(parseInt(e.target.value) || 100)}
                          className="w-14 px-1.5 py-0.5 bg-[#222] border border-[#333] rounded text-[11px] text-white text-center focus:border-blue-500 focus:outline-none"
                          min={100} max={3000}
                        />
                        <span className="text-[10px] text-[#555]">pt</span>
                      </div>
                    )}

                    <div className="text-[10px] text-[#444] pt-0.5">
                      {screenSize.width}×{screenSize.height}pt
                      {aspectMode !== 'device' && ` (${(screenSize.width / screenSize.height).toFixed(2)})`}
                    </div>
                  </div>

                  {/* ── Android 导航模式 ── */}
                  {device.androidNavBar && (
                    <div className="border-t border-[#252525]">
                      <div className="px-3 py-1.5 text-[10px] text-[#555] uppercase tracking-wider">导航模式</div>
                      <div className="px-2.5 pb-2.5">
                        <div className="flex bg-[#222] rounded-lg overflow-hidden">
                          <button
                            className={`flex-1 px-3 py-1 text-[11px] transition-colors ${
                              androidNav === 'gesture' ? 'bg-blue-500/20 text-blue-400' : 'text-[#666] hover:text-white'
                            }`}
                            onClick={() => setAndroidNav('gesture')}
                          >手势</button>
                          <button
                            className={`flex-1 px-3 py-1 text-[11px] transition-colors ${
                              androidNav === 'threeButton' ? 'bg-blue-500/20 text-blue-400' : 'text-[#666] hover:text-white'
                            }`}
                            onClick={() => setAndroidNav('threeButton')}
                          >三键</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 方向: 图标切换 */}
          <div className="flex bg-[#1e1e1e] rounded-lg overflow-hidden shrink-0">
            <button
              className={`p-1.5 transition-colors ${
                orientation === 'portrait' ? 'bg-blue-500/20 text-blue-400' : 'text-[#555] hover:text-white'
              }`}
              onClick={() => setOrientation('portrait')}
              title="竖屏"
            >
              <Smartphone size={14} />
            </button>
            <div className="w-px bg-[#2a2a2a]" />
            <button
              className={`p-1.5 transition-colors ${
                orientation === 'landscape' ? 'bg-blue-500/20 text-blue-400' : 'text-[#555] hover:text-white'
              }`}
              onClick={() => setOrientation('landscape')}
              title="横屏"
            >
              <Smartphone size={14} className="rotate-90" />
            </button>
          </div>
        </div>

        {/* == 小程序安全区 (开关 + 多选列表) == */}
        <div className="border-b border-[#1e1e1e] px-4 py-2.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <ToggleSwitch
              checked={showMiniProgramPanel}
              onChange={(v) => {
                setShowMiniProgramPanel(v);
                if (!v) setSelectedMiniPrograms(new Set());
              }}
            />
            <LayoutGrid size={13} className="text-[#666]" />
            <span className="text-xs text-[#aaa]">小程序安全区</span>
            {selectedMiniPrograms.size > 0 && (
              <span className="text-[10px] text-blue-400 ml-auto">{selectedMiniPrograms.size} 个</span>
            )}
          </label>
          {showMiniProgramPanel && (
            <div className="mt-2 grid grid-cols-2 gap-1">
              {MINIPROGRAM_PRESETS.map(mp => (
                <button
                  key={mp.id}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] transition-colors ${
                    selectedMiniPrograms.has(mp.id)
                      ? 'bg-blue-500/15 text-blue-400'
                      : 'text-[#666] hover:text-[#999] hover:bg-[#1a1a1a]'
                  }`}
                  onClick={() => toggleMiniProgram(mp.id)}
                >
                  <span className="text-[10px]">{mp.icon}</span>
                  <span className="truncate">{mp.name.replace('小程序', '')}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* == 场景模拟 (安全区遮罩 开关 + 子项列表) == */}
        <div className="border-b border-[#1e1e1e] px-4 py-2.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <ToggleSwitch checked={showOverlays} onChange={setShowOverlays} />
            <Keyboard size={13} className="text-[#666]" />
            <span className="text-xs text-[#aaa]">安全区遮罩</span>
          </label>
          {showOverlays && (
            <div className="mt-2 grid grid-cols-2 gap-1">
              <button
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] transition-colors ${
                  showKeyboard
                    ? 'bg-purple-500/15 text-purple-400'
                    : 'text-[#666] hover:text-[#999] hover:bg-[#1a1a1a]'
                }`}
                onClick={() => setShowKeyboard(!showKeyboard)}
              >
                <Keyboard size={11} />
                <span>键盘弹出</span>
              </button>
              <button
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] transition-colors ${
                  showTabBar
                    ? 'bg-purple-500/15 text-purple-400'
                    : 'text-[#666] hover:text-[#999] hover:bg-[#1a1a1a]'
                }`}
                onClick={() => setShowTabBar(!showTabBar)}
              >
                <LayoutGrid size={11} />
                <span>底部 TabBar</span>
              </button>
            </div>
          )}
        </div>

        {/* == 热力图 (toggle 即入口, 无多余标题) == */}
        <div className="border-b border-[#1e1e1e] px-4 py-2.5">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <ToggleSwitch checked={showHeatmap} onChange={(v) => {
                setShowHeatmap(v);
                if (v && !saliencyData && image) runSaliencyAnalysis();
              }} />
              <Flame size={13} className="text-[#666]" />
              <span className="text-xs text-[#aaa]">热力图</span>
            </label>
            <div className="flex items-center gap-2">
              {heatmapLoading && <Loader2 size={14} className="text-amber-400 animate-spin" />}
              {showHeatmap && saliencyData && (
                <button
                  className="text-[#555] hover:text-[#999] transition-colors"
                  onClick={runSaliencyAnalysis}
                  title="重新分析"
                >
                  <RefreshCw size={12} />
                </button>
              )}
            </div>
          </div>
          {showHeatmap && (
            <div className="mt-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="range" min={0.1} max={1} step={0.05}
                  value={heatmapOpacity}
                  onChange={e => setHeatmapOpacity(parseFloat(e.target.value))}
                  className="flex-1 h-1 accent-amber-500"
                />
                <span className="text-[10px] text-[#555] w-7 text-right">{Math.round(heatmapOpacity * 100)}%</span>
              </div>
              {!saliencyData && !heatmapLoading && image && (
                <button
                  className="w-full py-1.5 bg-amber-500/15 text-amber-400 text-xs rounded-lg hover:bg-amber-500/25 transition-colors"
                  onClick={runSaliencyAnalysis}
                >开始分析</button>
              )}
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-[#555]">低</span>
                <div className="flex-1 h-1.5 rounded-sm overflow-hidden" style={{
                  background: 'linear-gradient(to right, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000)',
                }} />
                <span className="text-[9px] text-[#555]">高</span>
              </div>
            </div>
          )}
        </div>

        {/* == 拇指热区 (toggle 即入口) == */}
        <div className="border-b border-[#1e1e1e] px-4 py-2.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <ToggleSwitch checked={showReachability} onChange={setShowReachability} />
            <Hand size={13} className="text-[#666]" />
            <span className="text-xs text-[#aaa]">
              {orientation === 'portrait' ? '拇指热区' : '双手热区'}
            </span>
          </label>
          {showReachability && (
            <div className="flex items-center gap-3 text-[10px] mt-2 ml-10">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-green-500/40" />
                <span className="text-[#777]">舒适</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-yellow-400/40" />
                <span className="text-[#777]">可达</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-red-500/40" />
                <span className="text-[#777]">困难</span>
              </div>
            </div>
          )}
        </div>

        {/* == WCAG 对比度 == */}
        <PanelSection title="对比度检测" icon={<Pipette size={14} />}>
          <div className="space-y-3">
            {/* 取色模式切换 */}
            <div className="flex items-center justify-between">
              <button
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                  analysisMode === 'contrast'
                    ? 'bg-violet-500/20 text-violet-400 ring-1 ring-violet-500/30'
                    : 'bg-[#1e1e1e] text-[#aaa] hover:bg-[#252525]'
                }`}
                onClick={() => {
                  setAnalysisMode(analysisMode === 'contrast' ? 'none' : 'contrast');
                  setContrastPickStep('fg');
                }}
              >
                <Crosshair size={12} />
                {analysisMode === 'contrast' ? '取色中...' : '画面取色'}
              </button>
              {contrastFg && contrastBg && (
                <button
                  className="text-[10px] text-[#666] hover:text-[#999] transition-colors"
                  onClick={() => { setContrastFg(null); setContrastBg(null); }}
                >
                  重置
                </button>
              )}
            </div>

            {/* 颜色输入 */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[10px] text-[#666] mb-1 block">前景色</span>
                <div className="flex items-center gap-1.5">
                  <div
                    className="w-6 h-6 rounded border border-[#333] shrink-0"
                    style={{ backgroundColor: contrastFg ? rgbToHex(...contrastFg) : manualFgHex }}
                  />
                  <input
                    type="text"
                    value={contrastFg ? rgbToHex(...contrastFg) : manualFgHex}
                    onChange={e => {
                      setManualFgHex(e.target.value);
                      if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) {
                        setContrastFg(hexToRgb(e.target.value));
                      }
                    }}
                    className="w-full px-2 py-1 bg-[#1e1e1e] border border-[#333] rounded text-[10px] text-white font-mono focus:border-violet-500 focus:outline-none"
                    placeholder="#FFFFFF"
                  />
                </div>
              </div>
              <div>
                <span className="text-[10px] text-[#666] mb-1 block">背景色</span>
                <div className="flex items-center gap-1.5">
                  <div
                    className="w-6 h-6 rounded border border-[#333] shrink-0"
                    style={{ backgroundColor: contrastBg ? rgbToHex(...contrastBg) : manualBgHex }}
                  />
                  <input
                    type="text"
                    value={contrastBg ? rgbToHex(...contrastBg) : manualBgHex}
                    onChange={e => {
                      setManualBgHex(e.target.value);
                      if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) {
                        setContrastBg(hexToRgb(e.target.value));
                      }
                    }}
                    className="w-full px-2 py-1 bg-[#1e1e1e] border border-[#333] rounded text-[10px] text-white font-mono focus:border-violet-500 focus:outline-none"
                    placeholder="#000000"
                  />
                </div>
              </div>
            </div>

            {/* 对比度结果 */}
            {contrastResult && (
              <div className="bg-[#1a1a1a] rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#888]">对比度</span>
                  <span className="text-sm font-bold" style={{ color: getWCAGColor(contrastResult.level) }}>
                    {contrastResult.ratio.toFixed(2)}:1
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <WCAGBadge level={contrastResult.level} label="正文" />
                  <WCAGBadge level={contrastResult.levelLarge} label="大文本" />
                </div>
                {/* 预览条 */}
                <div className="flex gap-2 mt-1">
                  <div
                    className="flex-1 rounded px-2 py-1 text-[10px] text-center"
                    style={{
                      backgroundColor: contrastBg ? rgbToHex(...contrastBg) : '#000',
                      color: contrastFg ? rgbToHex(...contrastFg) : '#fff',
                    }}
                  >
                    示例文本 Aa
                  </div>
                  <div
                    className="flex-1 rounded px-2 py-1 text-[10px] text-center"
                    style={{
                      backgroundColor: contrastFg ? rgbToHex(...contrastFg) : '#fff',
                      color: contrastBg ? rgbToHex(...contrastBg) : '#000',
                    }}
                  >
                    示例文本 Aa
                  </div>
                </div>
              </div>
            )}
          </div>
        </PanelSection>

        {/* == Fitts 测量 (按钮即入口, 无多余标题) == */}
        <div className="border-b border-[#1e1e1e] px-4 py-2.5">
          <div className="flex items-center justify-between">
            <button
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                analysisMode === 'fitts'
                  ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
                  : 'bg-[#1e1e1e] text-[#aaa] hover:bg-[#252525]'
              }`}
              onClick={() => {
                setAnalysisMode(analysisMode === 'fitts' ? 'none' : 'fitts');
                setFittsFrom(null);
                setFittsTo(null);
                setFittsResult(null);
              }}
            >
              <MousePointer size={12} />
              Fitts 测量
            </button>
            <div className="flex items-center gap-2">
              {analysisMode === 'fitts' && (
                <span className="text-[10px] text-emerald-400 animate-pulse">测量中</span>
              )}
              {fittsResult && (
                <button
                  className="text-[10px] text-[#555] hover:text-[#999] transition-colors"
                  onClick={() => { setFittsFrom(null); setFittsTo(null); setFittsResult(null); }}
                >重置</button>
              )}
            </div>
          </div>

          {(analysisMode === 'fitts' || fittsResult) && (
            <div className="mt-2.5 space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[#555]">目标宽度</span>
                <input
                  type="number"
                  value={fittsTargetSize}
                  onChange={e => setFittsTargetSize(Math.max(8, parseInt(e.target.value) || 44))}
                  className="w-14 px-2 py-0.5 bg-[#1e1e1e] border border-[#333] rounded text-[11px] text-white text-center focus:border-emerald-500 focus:outline-none"
                />
                <span className="text-[10px] text-[#555]">px</span>
              </div>

              {analysisMode === 'fitts' && !fittsFrom && (
                <div className="text-[10px] text-[#555] flex items-center gap-1">
                  <MousePointer size={10} />
                  点击画面设置起点
                </div>
              )}
              {analysisMode === 'fitts' && fittsFrom && !fittsTo && (
                <div className="text-[10px] text-emerald-400 flex items-center gap-1">
                  <MousePointer size={10} />
                  点击画面设置终点
                </div>
              )}

              {fittsResult && (
                <div className="bg-[#1a1a1a] rounded-lg p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[#666]">难度 (ID)</span>
                    <span className={`text-sm font-bold ${
                      fittsResult.rating === 'easy' ? 'text-green-400'
                      : fittsResult.rating === 'moderate' ? 'text-amber-400'
                      : 'text-red-400'
                    }`}>
                      {fittsResult.indexOfDifficulty} bits
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px]">
                    <span className="text-[#555]">{fittsResult.distance}px</span>
                    <span className="text-[#555]">~{fittsResult.estimatedTime}ms</span>
                    <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] ${
                      fittsResult.rating === 'easy' ? 'bg-green-500/15 text-green-400'
                      : fittsResult.rating === 'moderate' ? 'bg-amber-500/15 text-amber-400'
                      : 'bg-red-500/15 text-red-400'
                    }`}>
                      {fittsResult.rating === 'easy' ? '轻松' : fittsResult.rating === 'moderate' ? '中等' : '困难'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* == P2: 智能检测 == */}
        <div className="border-b border-[#1e1e1e] px-4 py-2.5">
          <div className="flex items-center justify-between">
            <button
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                analysisMode === 'detect'
                  ? 'bg-cyan-500/20 text-cyan-400 ring-1 ring-cyan-500/30'
                  : 'bg-[#1e1e1e] text-[#aaa] hover:bg-[#252525]'
              }`}
              onClick={() => {
                if (analysisMode === 'detect') {
                  setAnalysisMode('none');
                } else {
                  setAnalysisMode('detect');
                  // 激活模式时自动触发检测
                  if (image && !isDetecting) {
                    runAutoDetect();
                  }
                }
              }}
            >
              <Scan size={12} />
              智能检测
            </button>
            <div className="flex items-center gap-1.5">
              {isDetecting && <Loader2 size={14} className="text-cyan-400 animate-spin" />}
              {analysisMode === 'detect' && detectedElements.length > 0 && (
                <span className="text-[10px] text-cyan-400">{detectedElements.length} 个</span>
              )}
            </div>
          </div>

          {analysisMode === 'detect' && (
            <div className="mt-2.5 space-y-2.5">
              {/* 操作按钮行 */}
              <div className="flex items-center gap-1.5">
                <button
                  className="flex-1 py-1.5 bg-cyan-500/15 text-cyan-400 text-[11px] rounded-lg hover:bg-cyan-500/25 transition-colors flex items-center justify-center gap-1"
                  onClick={runAutoDetect}
                  disabled={!image || isDetecting}
                >
                  <Scan size={11} />
                  {detectedElements.length > 0 ? '重新检测' : '自动检测'}
                </button>
                <button
                  className="px-2.5 py-1.5 bg-[#1e1e1e] text-[#aaa] text-[11px] rounded-lg hover:bg-[#252525] transition-colors"
                  onClick={analyzeAllElements}
                  disabled={detectedElements.length === 0}
                  title="重新分析所有元素"
                >
                  <RefreshCw size={11} />
                </button>
                {detectedElements.length > 0 && (
                  <button
                    className="px-2.5 py-1.5 bg-red-500/10 text-red-400 text-[11px] rounded-lg hover:bg-red-500/20 transition-colors"
                    onClick={() => { setDetectedElements([]); setSelectedElementId(null); }}
                    title="清除所有"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>

              {/* 操作提示 */}
              <div className="text-[10px] text-[#555] space-y-0.5">
                <div>拖拽空白区域画框 · 拖拽框体移动 · 拖拽控制柄缩放</div>
                <div>Delete 删除选中框</div>
              </div>

              {/* 操控选项 */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <ToggleSwitch checked={showPressureOverlay} onChange={setShowPressureOverlay} />
                  <span className="text-[10px] text-[#aaa]">压力遮罩</span>
                </label>
                <div className="flex items-center gap-1 text-[10px]">
                  <Hand size={10} className="text-[#555]" />
                  <button
                    className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                      thumbHand === 'right' ? 'bg-purple-500/20 text-purple-400' : 'text-[#555] hover:text-white'
                    }`}
                    onClick={() => setThumbHand('right')}
                  >右手</button>
                  <button
                    className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                      thumbHand === 'left' ? 'bg-purple-500/20 text-purple-400' : 'text-[#555] hover:text-white'
                    }`}
                    onClick={() => setThumbHand('left')}
                  >左手</button>
                </div>
              </div>

              {/* 汇总统计面板 */}
              {detectionSummary && (
                <div className="bg-[#1a1a1a] rounded-lg p-2.5 space-y-2">
                  <div className="text-[10px] text-[#666] uppercase tracking-wider">汇总统计</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]">
                    <div className="flex justify-between">
                      <span className="text-[#777]">目标数</span>
                      <span className="text-white font-medium">{detectionSummary.totalElements}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#777]">均 ID</span>
                      <span className={`font-medium ${
                        detectionSummary.avgFittsID < 2.5 ? 'text-green-400'
                        : detectionSummary.avgFittsID < 4 ? 'text-amber-400' : 'text-red-400'
                      }`}>{detectionSummary.avgFittsID}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#777]">均耗时</span>
                      <span className="text-white font-medium">~{detectionSummary.avgTime}ms</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#777]">误触风险</span>
                      <span className={`font-medium ${detectionSummary.misclickRisk === 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {detectionSummary.misclickRisk}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#777]">对比度</span>
                      <span className={`font-medium ${
                        detectionSummary.contrastPassRate >= 80 ? 'text-green-400'
                        : detectionSummary.contrastPassRate >= 50 ? 'text-amber-400' : 'text-red-400'
                      }`}>{detectionSummary.contrastPassRate}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#777]">触控尺寸</span>
                      <span className={`font-medium ${
                        detectionSummary.touchPassRate >= 80 ? 'text-green-400'
                        : detectionSummary.touchPassRate >= 50 ? 'text-amber-400' : 'text-red-400'
                      }`}>{detectionSummary.touchPassRate}%</span>
                    </div>
                  </div>
                  {/* 热区分布 */}
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="text-[#555]">热区:</span>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-sm bg-green-500/60" />
                      <span className="text-green-400">{detectionSummary.zoneDistribution.easy}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-sm bg-yellow-400/60" />
                      <span className="text-yellow-400">{detectionSummary.zoneDistribution.ok}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-sm bg-red-500/60" />
                      <span className="text-red-400">{detectionSummary.zoneDistribution.hard}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* 框线开关 + 元素列表 */}
              {detectedElements.length > 0 && (
                <>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <ToggleSwitch checked={showDetectBoxes} onChange={setShowDetectBoxes} />
                      <span className="text-[10px] text-[#aaa]">显示框线</span>
                    </label>
                    <span className="text-[10px] text-[#555]">悬停列表查看</span>
                  </div>
                  <div
                    className="max-h-36 overflow-y-auto space-y-0.5"
                    onMouseLeave={() => setHoveredElementId(null)}
                  >
                    {detectedElements.map((el, idx) => (
                      <button
                        key={el.id}
                        className={`w-full text-left px-2 py-1 rounded text-[10px] transition-colors flex items-center gap-1.5 ${
                          el.id === selectedElementId ? 'bg-cyan-500/15 text-cyan-400'
                          : el.id === hoveredElementId ? 'bg-[#1e1e1e] text-white'
                          : 'text-[#aaa] hover:bg-[#1e1e1e]'
                        }`}
                        onClick={() => setSelectedElementId(el.id === selectedElementId ? null : el.id)}
                        onMouseEnter={() => setHoveredElementId(el.id)}
                      >
                        <span className="w-4 h-4 rounded-full bg-[#333] text-[8px] text-[#999] flex items-center justify-center shrink-0 font-bold">
                          {idx + 1}
                        </span>
                        <span className="truncate">
                          {el.label} {el.w || 0}×{el.h || 0}
                        </span>
                        {el.analysis.fitts && Number.isFinite(el.analysis.fitts.id) && (
                          <span className={`ml-auto shrink-0 ${
                            el.analysis.fitts.rating === 'easy' ? 'text-green-400'
                            : el.analysis.fitts.rating === 'moderate' ? 'text-amber-400' : 'text-red-400'
                          }`}>
                            ID={el.analysis.fitts.id}
                          </span>
                        )}
                        {el.analysis.touchTarget && !el.analysis.touchTarget.pass && (
                          <span className="text-red-400 shrink-0">⚠</span>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* == 综合审计报告 (仅按钮 + 展开结果) == */}
        <div className="border-b border-[#1e1e1e] px-4 py-2.5">
          <button
            className="w-full py-2 bg-blue-500/15 text-blue-400 text-xs rounded-lg hover:bg-blue-500/25 transition-colors"
            onClick={generateAuditReport}
          >
            生成综合报告
          </button>
          {auditReport && (
            <div className="mt-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span
                  className="text-2xl font-bold tabular-nums"
                  style={{ color: GRADE_COLORS[auditReport.grade] }}
                >
                  {auditReport.totalScore}
                </span>
                <span
                  className="text-3xl font-bold opacity-80"
                  style={{ color: GRADE_COLORS[auditReport.grade] }}
                >
                  {auditReport.grade}
                </span>
              </div>
              <div className="space-y-1.5">
                {auditReport.dimensions.map(dim => (
                  <div key={dim.id}>
                    <div className="flex items-center justify-between text-[10px] mb-0.5">
                      <span className="text-[#aaa]">{dim.icon} {dim.name}</span>
                      <span style={{ color: GRADE_COLORS[dim.grade] }}>{dim.score}</span>
                    </div>
                    <div className="h-1 bg-[#1e1e1e] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${dim.score}%`, backgroundColor: GRADE_COLORS[dim.grade] }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {auditReport.suggestions.length > 0 && (
                <div className="text-[9px] text-[#555] leading-relaxed space-y-0.5">
                  {auditReport.suggestions.map((s, i) => <div key={i}>{s}</div>)}
                </div>
              )}
            </div>
          )}
        </div>

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
            {showReachability && (
              <>
                <Legend color="rgba(34, 197, 94, 0.25)" label="拇指舒适区" />
                <Legend color="rgba(250, 204, 21, 0.25)" label="拇指可达区" />
                <Legend color="rgba(239, 68, 68, 0.25)" label="拇指困难区" />
              </>
            )}
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

/** WCAG 等级徽章 */
function WCAGBadge({ level, label }: { level: WCAGLevel; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span
        className="text-[10px] px-1.5 py-0.5 rounded font-medium"
        style={{
          backgroundColor: getWCAGColor(level) + '20',
          color: getWCAGColor(level),
        }}
      >
        {level}
      </span>
      <span className="text-[9px] text-[#666]">{label}</span>
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

    // 胶囊按钮 (iOS/Android 独立尺寸)
    if (mp.capsule) {
      const cap = mp.capsule;
      const capW = platform === 'ios' ? cap.width.ios : cap.width.android;
      const capH = platform === 'ios' ? cap.height.ios : cap.height.android;
      const capTopGap = platform === 'ios' ? cap.top.ios : cap.top.android;
      const capRight = platform === 'ios' ? cap.right.ios : cap.right.android;
      const capTop = oy + statusBarH + capTopGap;
      const capLeft = ox + sw - capRight - capW;
      ctx.fillStyle = mp.color.replace(/[\d.]+\)$/, '0.45)');
      simpleRoundRect(ctx, capLeft, capTop, capW, capH, cap.borderRadius);
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

    // 胶囊按钮 (横屏, iOS/Android 独立尺寸)
    if (mp.capsule) {
      const cap = mp.capsule;
      const capW = platform === 'ios' ? cap.width.ios : cap.width.android;
      const capH = platform === 'ios' ? cap.height.ios : cap.height.android;
      const capTopGap = platform === 'ios' ? cap.top.ios : cap.top.android;
      const capRight = platform === 'ios' ? cap.right.ios : cap.right.android;
      const capTop = navTop + capTopGap;
      const capLeft = navLeft + navWidth - capRight - capW;
      ctx.fillStyle = mp.color.replace(/[\d.]+\)$/, '0.45)');
      simpleRoundRect(ctx, capLeft, capTop, capW, capH, cap.borderRadius);
      ctx.fill();
      ctx.strokeStyle = mp.color.replace(/[\d.]+\)$/, '0.6)');
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

export default UIAudit;
