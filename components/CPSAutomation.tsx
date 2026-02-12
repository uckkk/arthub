import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Download, RotateCcw, Plus } from 'lucide-react';
import { useToast } from './Toast';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/dialog';
import { listen } from '@tauri-apps/api/event';
import { appWindow } from '@tauri-apps/api/window';
import JSZip from 'jszip';

// 默认参数配置
const DEFAULT_CONFIG = {
  portrait: {
    borderRadius: 46,
    smoothBorderRadius: 80,
    shadow: {
      offsetX: 0,
      offsetY: 8,
      blur: 10,
      spread: 0,
      color: 'rgba(0, 0, 0, 0.2)',
    },
    // 内容裁切尺寸（蓝色区域）
    sizes: {
      big: { width: 618, height: 536 },
      mid: { width: 290, height: 536 },
      small: { width: 290, height: 246 },
    },
    // 固定输出尺寸（含投影边距的黑色区域）
    outputSizes: {
      big: { width: 648, height: 566 },
      mid: { width: 320, height: 566 },
      small: { width: 320, height: 276 },
    },
    // 内容裁切区到输出边缘的固定间距
    margin: { left: 15, right: 15, top: 7, bottom: 23 },
    namePrefix: 'cps_big_icon@',
  },
  popup: {
    width: 1009,
    height: 567,
    // borderRadius 共用 portrait.borderRadius
    namePrefix: 'cps_image@',
  },
  appIcon: {
    width: 72,
    height: 72,
    borderRadius: 18,
    smoothBorderRadius: 60,
    namePrefix: 'ylg_cps_icon@',
  },
};

interface ImageFile {
  file: File;
  preview: string;
  name: string;
}

interface GeneratedImage {
  name: string;
  blob: Blob;
}

type DropTarget = 'portrait' | 'popup' | 'appIcon' | null;

const CPSAutomation: React.FC = () => {
  const { showToast } = useToast();

  const [portraitImage, setPortraitImage] = useState<ImageFile | null>(null);
  const [popupImage, setPopupImage] = useState<ImageFile | null>(null);
  const [appIconImage, setAppIconImage] = useState<ImageFile | null>(null);

  const [dragOverTarget, setDragOverTarget] = useState<DropTarget>(null);

  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [customName, setCustomName] = useState('');
  const [customMode, setCustomMode] = useState(false); // 自定义开关，默认关闭

  const portraitBigCanvasRef = useRef<HTMLCanvasElement>(null);
  const portraitMidCanvasRef = useRef<HTMLCanvasElement>(null);
  const portraitSmallCanvasRef = useRef<HTMLCanvasElement>(null);
  const popupCanvasRef = useRef<HTMLCanvasElement>(null);
  const appIconCanvasRef = useRef<HTMLCanvasElement>(null);

  const hoverTargetRef = useRef<DropTarget>(null);

  // 用 ref 跟踪最新的图片状态，这样 Tauri 事件监听器的 useEffect 不需要
  // 依赖 portraitImage/popupImage/appIconImage，避免每次上传图片后重新注册监听器
  const portraitImageRef = useRef(portraitImage);
  const popupImageRef = useRef(popupImage);
  const appIconImageRef = useRef(appIconImage);
  useEffect(() => { portraitImageRef.current = portraitImage; }, [portraitImage]);
  useEffect(() => { popupImageRef.current = popupImage; }, [popupImage]);
  useEffect(() => { appIconImageRef.current = appIconImage; }, [appIconImage]);

  // ---- 固定边距（内容裁切区到输出边缘） ----
  const margin = config.portrait.margin;

  // ---- 环境检测 ----
  const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_IPC__;

  // ---- 通过操作系统光标位置查找拖放目标（Tauri 专用） ----
  const findDropTargetUnderCursor = useCallback(async (): Promise<DropTarget> => {
    if (!isTauri) return null;
    try {
      const [screenX, screenY] = await invoke<[number, number]>('get_cursor_position');
      const windowPos = await appWindow.innerPosition();
      const scale = window.devicePixelRatio || 1;
      const cssX = (screenX - windowPos.x) / scale;
      const cssY = (screenY - windowPos.y) / scale;
      const el = document.elementFromPoint(cssX, cssY);
      if (el) {
        const dropArea = el.closest('[data-drop-target]');
        if (dropArea) {
          return dropArea.getAttribute('data-drop-target') as DropTarget;
        }
      }
    } catch (err) {
      console.debug('[CPS] findDropTargetUnderCursor fallback:', err);
    }
    return null;
  }, [isTauri]);

  // ---- 处理拖入的文件（Tauri 和浏览器通用） ----
  const handleDroppedFile = useCallback((file: File, target: DropTarget) => {
    if (!target || !file.type.startsWith('image/')) {
      if (!file.type.startsWith('image/')) showToast('请拖入图片文件', 'error');
      return;
    }
    const preview = URL.createObjectURL(file);
    const imageFile: ImageFile = { file, preview, name: file.name };
    if (target === 'portrait') setPortraitImage(imageFile);
    else if (target === 'popup') setPopupImage(imageFile);
    else if (target === 'appIcon') setAppIconImage(imageFile);
  }, []);

  // ---- Tauri 文件拖拽支持（仅在 Tauri 环境中注册） ----
  useEffect(() => {
    if (!isTauri) return;

    let unlistenDrop: (() => void) | null = null;
    let unlistenHover: (() => void) | null = null;
    let unlistenCancel: (() => void) | null = null;

    const setup = async () => {
      unlistenHover = await listen<string[]>('tauri://file-drop-hover', async () => {
        const target = await findDropTargetUnderCursor();
        if (target) {
          hoverTargetRef.current = target;
          setDragOverTarget(target);
        } else {
          hoverTargetRef.current = null;
          setDragOverTarget(null);
        }
      });

      unlistenDrop = await listen<string[]>('tauri://file-drop', async (event) => {
        setDragOverTarget(null);
        const paths = event.payload;
        if (!paths || paths.length === 0) return;

        const filePath = paths[0];
        const lowerPath = filePath.toLowerCase();

        const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.svg'].some(
          ext => lowerPath.endsWith(ext)
        );
        if (!isImage) { showToast('请拖入图片文件', 'error'); return; }

        let target = hoverTargetRef.current;
        if (!target) target = await findDropTargetUnderCursor();
        if (!target) {
          const emptySlots: DropTarget[] = [];
          if (!portraitImageRef.current) emptySlots.push('portrait');
          if (!popupImageRef.current) emptySlots.push('popup');
          if (!appIconImageRef.current) emptySlots.push('appIcon');
          if (emptySlots.length === 1) target = emptySlots[0];
          else { showToast('请将图片拖入指定的输入框区域', 'info'); return; }
        }

        try {
          const fileBytes: number[] = await invoke('read_binary_file_with_path', { filePath });
          const uint8Array = new Uint8Array(fileBytes);
          let mimeType = 'image/png';
          if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) mimeType = 'image/jpeg';
          else if (lowerPath.endsWith('.gif')) mimeType = 'image/gif';
          else if (lowerPath.endsWith('.webp')) mimeType = 'image/webp';
          else if (lowerPath.endsWith('.bmp')) mimeType = 'image/bmp';
          else if (lowerPath.endsWith('.svg')) mimeType = 'image/svg+xml';

          const fileName = filePath.split(/[\\/]/).pop() || 'image.png';
          const blob = new Blob([uint8Array], { type: mimeType });
          const file = new File([blob], fileName, { type: mimeType });
          handleDroppedFile(file, target);
        } catch (err) {
          console.error('读取拖拽文件失败:', err);
          showToast('读取文件失败', 'error');
        }
        hoverTargetRef.current = null;
      });

      unlistenCancel = await listen('tauri://file-drop-cancelled', () => {
        setDragOverTarget(null);
        hoverTargetRef.current = null;
      });
    };

    setup();
    return () => { unlistenDrop?.(); unlistenHover?.(); unlistenCancel?.(); };
  }, [isTauri, showToast, findDropTargetUnderCursor, handleDroppedFile]);

  // ---- 浏览器 HTML5 拖拽回退（非 Tauri 环境） ----
  useEffect(() => {
    if (isTauri) return;

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const area = el?.closest('[data-drop-target]');
      const target = (area?.getAttribute('data-drop-target') || null) as DropTarget;
      hoverTargetRef.current = target;
      setDragOverTarget(target);
    };

    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) {
        hoverTargetRef.current = null;
        setDragOverTarget(null);
      }
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragOverTarget(null);
      const file = e.dataTransfer?.files?.[0];
      const target = hoverTargetRef.current;
      hoverTargetRef.current = null;
      if (file && target) handleDroppedFile(file, target);
    };

    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onDrop);
    };
  }, [isTauri, handleDroppedFile]);

  // ---- 图片处理工具函数 ----

  const loadImage = (file: File): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });

  // Apple 平滑圆角 (Continuous Curvature / G2 Continuity)
  // 超椭圆算法: n=2 普通圆弧, n>2 平滑过渡
  // 关键: 超椭圆 n>2 时角点在 45° 处向内收缩，需要补偿放大 r
  // 使视觉圆角大小与 iOS cornerRadius 参数精确匹配
  const drawRoundedRect = (
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number,
    radius: number, smoothPercent: number = 80
  ) => {
    const maxR = Math.min(w, h) / 2;

    if (radius <= 0) {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      return;
    }

    const s = Math.max(0, Math.min(100, smoothPercent)) / 100;
    const n = 2 + s * 3; // s=0→n=2(正圆), s=0.8→n=4.4(Apple风格)
    const e = 2 / n;     // 超椭圆参数指数

    // 补偿超椭圆的视觉缩小效应
    // 原理: 超椭圆 45° 处距角点距离 = r*(1-k)*√2, k=(1/√2)^(2/n)
    // 正圆 45° 处距角点距离 = R*(1-1/√2)*√2
    // 令两者相等: r = R * (1-1/√2) / (1-k) = R * scaleFactor
    let r: number;
    if (s > 0.01) {
      const kCircle = Math.SQRT1_2; // 1/√2 ≈ 0.7071
      const kSuper = Math.pow(Math.SQRT1_2, e); // (1/√2)^(2/n)
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
  };

  // 大尺寸: 最长边撑满，保持宽高比，居中
  const fitBigSize = (img: HTMLImageElement, cw: number, ch: number) => {
    const ia = img.width / img.height;
    const ca = cw / ch;
    let dw, dh, dx, dy;
    if (ia > ca) { dw = cw; dh = cw / ia; dx = 0; dy = (ch - dh) / 2; }
    else          { dh = ch; dw = ch * ia; dx = (cw - dw) / 2; dy = 0; }
    return { sx: 0, sy: 0, sw: img.width, sh: img.height, dx, dy, dw, dh };
  };

  // 中尺寸: 从原图中央裁剪竖条
  const fitMidSize = (img: HTMLImageElement, cw: number, ch: number) => {
    const canvasAspect = cw / ch;
    const imgAspect = img.width / img.height;
    if (imgAspect > canvasAspect) {
      const cropW = img.height * canvasAspect;
      const cropX = (img.width - cropW) / 2;
      return { sx: cropX, sy: 0, sw: cropW, sh: img.height, dx: 0, dy: 0, dw: cw, dh: ch };
    } else {
      const cropH = img.width / canvasAspect;
      const cropY = (img.height - cropH) / 2;
      return { sx: 0, sy: cropY, sw: img.width, sh: cropH, dx: 0, dy: 0, dw: cw, dh: ch };
    }
  };

  // 小尺寸: 基于中尺寸裁剪区域，从顶部偏移 83px 处开始裁切（非居中）
  // 在中尺寸坐标系(290×536)中，小尺寸顶部距图片顶端 83px
  const fitSmallSize = (img: HTMLImageElement, cw: number, ch: number) => {
    const midSize = config.portrait.sizes.mid; // 290×536
    const midAspect = midSize.width / midSize.height;
    const imgAspect = img.width / img.height;

    // 第一步：计算中尺寸裁剪区域
    let midSx: number, midSy: number, midSw: number, midSh: number;
    if (imgAspect > midAspect) {
      midSw = img.height * midAspect;
      midSx = (img.width - midSw) / 2;
      midSy = 0;
      midSh = img.height;
    } else {
      midSw = img.width;
      midSx = 0;
      midSh = img.width / midAspect;
      midSy = (img.height - midSh) / 2;
    }

    // 第二步：从中尺寸区域顶部偏移 83px 处裁切（转换到原图坐标）
    const topOffsetInMid = 83; // 中尺寸坐标系中的顶部偏移量
    const scale = midSh / midSize.height; // 原图像素 / 中尺寸像素
    const heightRatio = ch / midSize.height; // 246/536
    const smallSh = midSh * heightRatio;
    const smallSy = midSy + topOffsetInMid * scale;

    return { sx: midSx, sy: smallSy, sw: midSw, sh: smallSh, dx: 0, dy: 0, dw: cw, dh: ch };
  };

  // 最短边撑满（居中裁剪）
  const fitShortestSide = (img: HTMLImageElement, cw: number, ch: number) => {
    const ia = img.width / img.height;
    const ca = cw / ch;
    if (ia > ca) {
      // 图片更宽 → 高度撑满，宽度居中裁剪
      const cropW = img.height * ca;
      const cropX = (img.width - cropW) / 2;
      return { sx: cropX, sy: 0, sw: cropW, sh: img.height, dx: 0, dy: 0, dw: cw, dh: ch };
    } else {
      // 图片更高 → 宽度撑满，高度居中裁剪
      const cropH = img.width / ca;
      const cropY = (img.height - cropH) / 2;
      return { sx: 0, sy: cropY, sw: img.width, sh: cropH, dx: 0, dy: 0, dw: cw, dh: ch };
    }
  };

  // ---- 渲染逻辑 ----

  // 通用立绘渲染（固定输出尺寸，固定边距，内容区带投影和圆角裁剪）
  const renderPortrait = useCallback(async (
    canvasRef: React.RefObject<HTMLCanvasElement>,
    size: { width: number; height: number },
    outputSize: { width: number; height: number },
    sizeType: 'big' | 'mid' | 'small'
  ) => {
    if (!canvasRef.current || !portraitImage) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 画布 = 固定输出尺寸
    canvas.width = outputSize.width;
    canvas.height = outputSize.height;

    try {
      const img = await loadImage(portraitImage.file);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 计算内容区域内的图片适配
      const params =
        sizeType === 'big' ? fitBigSize(img, size.width, size.height) :
        sizeType === 'mid' ? fitMidSize(img, size.width, size.height) :
                             fitSmallSize(img, size.width, size.height);

      // 内容绘制位置 = 固定边距偏移
      const contentX = margin.left;
      const contentY = margin.top;
      const drawX = contentX + params.dx;
      const drawY = contentY + params.dy;

      // 1. 绘制投影：在内容区域画一个实心圆角矩形，Canvas shadow 自动在周围生成投影
      ctx.save();
      ctx.shadowOffsetX = config.portrait.shadow.offsetX;
      ctx.shadowOffsetY = config.portrait.shadow.offsetY;
      ctx.shadowBlur = config.portrait.shadow.blur;
      ctx.shadowColor = config.portrait.shadow.color;
      ctx.fillStyle = '#1b1b1b';
      drawRoundedRect(ctx, contentX, contentY, size.width, size.height,
        config.portrait.borderRadius, config.portrait.smoothBorderRadius);
      ctx.fill();
      ctx.restore();

      // 2. 裁剪并绘制图片
      ctx.save();
      drawRoundedRect(ctx, contentX, contentY, size.width, size.height,
        config.portrait.borderRadius, config.portrait.smoothBorderRadius);
      ctx.clip();
      ctx.drawImage(img, params.sx, params.sy, params.sw, params.sh, drawX, drawY, params.dw, params.dh);
      ctx.restore();
    } catch (e) {
      console.error('渲染预览失败:', e);
    }
  }, [portraitImage, config.portrait, margin]);

  // 弹窗渲染（无投影，平滑圆角裁剪，最长边撑满）
  const renderPopup = useCallback(async () => {
    if (!popupCanvasRef.current || !popupImage) return;
    const canvas = popupCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = config.popup.width;   // 1009
    canvas.height = config.popup.height; // 567
    try {
      const img = await loadImage(popupImage.file);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 平滑圆角裁剪
      ctx.save();
      drawRoundedRect(ctx, 0, 0, canvas.width, canvas.height,
        config.portrait.borderRadius, config.portrait.smoothBorderRadius);
      ctx.clip();

      // 最长边撑满，保持比例
      const p = fitBigSize(img, canvas.width, canvas.height);
      ctx.drawImage(img, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh);
      ctx.restore();
    } catch (e) { console.error('渲染弹窗预览失败:', e); }
  }, [popupImage, config.popup, config.portrait.borderRadius, config.portrait.smoothBorderRadius]);

  // APPicon 渲染（无投影，平滑圆角裁剪，最短边撑满）
  const renderAppIcon = useCallback(async () => {
    if (!appIconCanvasRef.current || !appIconImage) return;
    const canvas = appIconCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = config.appIcon.width;   // 72
    canvas.height = config.appIcon.height; // 72
    try {
      const img = await loadImage(appIconImage.file);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 平滑圆角裁剪
      ctx.save();
      drawRoundedRect(ctx, 0, 0, canvas.width, canvas.height,
        config.appIcon.borderRadius, config.appIcon.smoothBorderRadius);
      ctx.clip();

      // 最短边撑满，居中裁剪
      const p = fitShortestSide(img, canvas.width, canvas.height);
      ctx.drawImage(img, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh);
      ctx.restore();
    } catch (e) { console.error('渲染APPicon预览失败:', e); }
  }, [appIconImage, config.appIcon]);

  useEffect(() => {
    if (portraitImage) {
      renderPortrait(portraitBigCanvasRef, config.portrait.sizes.big, config.portrait.outputSizes.big, 'big');
      renderPortrait(portraitMidCanvasRef, config.portrait.sizes.mid, config.portrait.outputSizes.mid, 'mid');
      renderPortrait(portraitSmallCanvasRef, config.portrait.sizes.small, config.portrait.outputSizes.small, 'small');
    }
  }, [portraitImage, config.portrait, renderPortrait]);

  useEffect(() => { renderPopup(); }, [popupImage, renderPopup]);
  useEffect(() => { renderAppIcon(); }, [appIconImage, renderAppIcon]);

  // ---- 文件选择 ----

  const handleFileUpload = (file: File, type: 'portrait' | 'popup' | 'appIcon') => {
    if (!file.type.startsWith('image/')) { showToast('请上传图片文件', 'error'); return; }
    const imageFile: ImageFile = { file, preview: URL.createObjectURL(file), name: file.name };
    if (type === 'portrait') setPortraitImage(imageFile);
    else if (type === 'popup') setPopupImage(imageFile);
    else setAppIconImage(imageFile);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, type: 'portrait' | 'popup' | 'appIcon') => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file, type);
    e.target.value = '';
  };

  const handleReset = () => { setConfig(DEFAULT_CONFIG); setCustomName(''); showToast('已恢复默认设置', 'success'); };

  const generateFileName = (prefix: string, suffix?: string): string => {
    const name = customName || '';
    let fn = prefix.replace('@', name);
    if (suffix) fn += `_${suffix}`;
    return `${fn}.png`;
  };

  // 渲染带绿色高亮的文件名（@ 或被替换的自定义名称用绿色显示）
  const renderHighlightedName = (prefix: string, suffix?: string) => {
    const name = customName || '@';
    const parts = prefix.split('@');
    const suffixStr = suffix ? `_${suffix}` : '';
    return (
      <span>
        {parts[0]}<span className="text-green-400">{name}</span>{parts[1] || ''}{suffixStr}.png
      </span>
    );
  };

  // 渲染默认资产名称（仅 @ 字符用绿色高亮，后缀保持普通颜色）
  const renderDefaultName = (prefix: string, suffix?: string) => {
    const parts = prefix.split('@');
    return (
      <span>
        {parts[0]}<span className="text-green-400">@</span>{suffix || ''}{parts[1] || ''}
      </span>
    );
  };

  // ---- 导出 ----

  const handleExport = async () => {
    if (!portraitImage || !popupImage || !appIconImage) { showToast('请先上传所有三张图片', 'error'); return; }
    try {
      showToast('正在生成图片...', 'info');
      await new Promise(r => setTimeout(r, 300));
      const images: GeneratedImage[] = [];

      const canvasToBlob = (ref: React.RefObject<HTMLCanvasElement>, name: string) =>
        new Promise<void>(resolve => {
          if (!ref.current) { resolve(); return; }
          ref.current.toBlob(blob => {
            if (blob) images.push({ name, blob });
            resolve();
          }, 'image/png');
        });

      await Promise.all([
        canvasToBlob(portraitBigCanvasRef, generateFileName(config.portrait.namePrefix, 'big')),
        canvasToBlob(portraitMidCanvasRef, generateFileName(config.portrait.namePrefix, 'mid')),
        canvasToBlob(portraitSmallCanvasRef, generateFileName(config.portrait.namePrefix, 'small')),
        canvasToBlob(popupCanvasRef, generateFileName(config.popup.namePrefix)),
        canvasToBlob(appIconCanvasRef, generateFileName(config.appIcon.namePrefix)),
      ]);

      if (isTauri) {
        // Tauri 环境：选择目录后保存到本地文件系统
        const selectedDir = await open({ directory: true, multiple: false, title: '选择导出目录' });
        if (!selectedDir || typeof selectedDir !== 'string') return;
        const sep = (selectedDir as string).includes('/') ? '/' : '\\';
        for (const img of images) {
          const buf = await img.blob.arrayBuffer();
          const filePath = `${selectedDir}${sep}${img.name}`;
          await invoke('write_binary_file_with_path', {
            filePath: filePath,
            content: Array.from(new Uint8Array(buf)),
          });
        }
        showToast(`成功导出 ${images.length} 张图片`, 'success');
        // 导出完成后自动打开目标文件夹
        try { await invoke('open_folder', { path: selectedDir }); } catch (_) { /* 静默 */ }
      } else {
        // 浏览器环境：打包为 zip 一次下载
        const zip = new JSZip();
        for (const img of images) {
          zip.file(img.name, img.blob);
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipName = `CPS_${customName || 'export'}.zip`;
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = zipName;
        a.click();
        URL.revokeObjectURL(url);
        showToast(`成功导出 ${images.length} 张图片（${zipName}）`, 'success');
      }
    } catch (error) {
      console.error('导出失败:', error);
      showToast('导出失败: ' + (error instanceof Error ? error.message : String(error)), 'error');
    }
  };

  const canExport = portraitImage && popupImage && appIconImage;

  // ---- 参数禁用状态 ----
  const paramDisabled = !customMode;

  // ---- 小型输入组件 ----
  const numInput = (label: string, value: number, onChange: (v: number) => void, disabled = false) => (
    <div className={`flex items-center gap-1.5 transition-opacity ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <span className="text-xs text-[#888888] shrink-0">{label}</span>
      <input type="number" value={value} onChange={e => onChange(parseInt(e.target.value) || 0)}
        disabled={disabled}
        className="w-16 px-2 py-1 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-white text-xs disabled:cursor-not-allowed" />
    </div>
  );

  // ---- 尺寸输入（禁用时显示为静态文本，启用时变为可编辑输入框） ----
  const dimInput = (value: number, onChange: (v: number) => void) => (
    paramDisabled ? (
      <span className="text-xs text-white">{value}</span>
    ) : (
      <input type="number" value={value} onChange={e => onChange(parseInt(e.target.value) || 1)}
        className="w-14 px-1.5 py-0.5 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-white text-xs text-center" />
    )
  );

  // ---- 上传区域 ----
  const renderUploadBox = (
    type: 'portrait' | 'popup' | 'appIcon',
    image: ImageFile | null,
    canvasRef?: React.RefObject<HTMLCanvasElement>,
    extraStyle?: React.CSSProperties
  ) => {
    const isDragOver = dragOverTarget === type;
    return (
      <div
        data-drop-target={type}
        className={`w-full h-full border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors relative overflow-hidden ${
          isDragOver ? 'border-blue-500 bg-blue-500/10' : 'border-[#444444] hover:border-[#555555]'
        }`}
        style={extraStyle}
        onMouseEnter={() => { hoverTargetRef.current = type; }}
        onMouseLeave={() => { if (hoverTargetRef.current === type) hoverTargetRef.current = null; }}
      >
        {image && canvasRef ? (
          <>
            <canvas ref={canvasRef} className="w-full h-full" />
            <label className="absolute bottom-2 right-2 text-xs text-blue-400 cursor-pointer hover:underline bg-black/60 px-2 py-0.5 rounded">
              更换
              <input type="file" accept="image/*" onChange={e => handleFileSelect(e, type)} className="hidden" />
            </label>
          </>
        ) : (
          <label className="flex flex-col items-center justify-center w-full h-full cursor-pointer">
            <Plus size={28} className="text-[#555555] mb-1.5" />
            <span className="text-xs text-[#555555]">拖入或点击</span>
            <input type="file" accept="image/*" onChange={e => handleFileSelect(e, type)} className="hidden" />
          </label>
        )}
      </div>
    );
  };

  // ---- 输出尺寸宽高比（用于预览容器） ----
  const outputAspect = (outputSize: { width: number; height: number }) => {
    return `${outputSize.width}/${outputSize.height}`;
  };

  // ---- 预览布局（紧凑模式：固定高度 + 等比宽度，仅影响显示，不影响导出） ----
  const PORTRAIT_PREVIEW_H = 220;  // 通用立绘大/中预览高度 (px)
  const POPUP_PREVIEW_H = 140;     // 弹窗预览高度 (px)
  const ICON_PREVIEW_H = 80;       // APPicon 预览高度 (px)

  // 小尺寸立绘预览高度（与大/中保持同一缩放比例）
  const smallPreviewH = useMemo(() => {
    const bigH = config.portrait.outputSizes.big.height;
    const smallH = config.portrait.outputSizes.small.height;
    return Math.round(PORTRAIT_PREVIEW_H * smallH / bigH);
  }, [config.portrait.outputSizes]);

  // ---- 渲染 ----
  return (
    <div className="h-full overflow-y-auto bg-[#0a0a0a] text-white p-5">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-end gap-8 mb-4">
        {/* "自定义参数"开关 */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#a0a0a0] select-none">自定义参数</span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={customMode}
              onChange={(e) => setCustomMode(e.target.checked)}
              className="sr-only peer"
            />
            <div className="
              w-9 h-5 rounded-full
              bg-[#39393d] peer-checked:bg-blue-500
              after:content-[''] after:absolute after:top-[2px] after:left-[2px]
              after:bg-white after:rounded-full after:h-4 after:w-4
              after:shadow-sm
              after:transition-all after:duration-200
              peer-checked:after:translate-x-4
              transition-colors duration-200
            "></div>
          </label>
        </div>

        <button onClick={handleReset}
          className="px-3 py-1.5 rounded bg-[#2a2a2a] hover:bg-[#3a3a3a] text-xs text-white transition-colors flex items-center gap-1.5 shrink-0">
          <RotateCcw size={12} /> 恢复默认
        </button>
      </div>

      {/* ====== 通用立绘 ====== */}
      <div className="bg-[#1a1a1a] rounded-lg p-5 mb-4">
        <h2 className="text-base font-semibold mb-3">通用立绘 <span className="text-xs text-[#666] font-normal ml-2">导出含投影</span></h2>

        {/* 参数行 */}
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3 mb-7">
          {/* 圆角（可禁用） */}
          <div className={`transition-opacity ${paramDisabled ? 'opacity-40 pointer-events-none' : ''}`}>
            <div className="text-xs text-[#888888] mb-1">圆角</div>
            <input type="number" value={config.portrait.borderRadius}
              disabled={paramDisabled}
              onChange={e => setConfig({ ...config, portrait: { ...config.portrait, borderRadius: parseInt(e.target.value) || 0 } })}
              className="w-16 px-2 py-1 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-white text-xs disabled:cursor-not-allowed" />
          </div>

          {/* 平滑圆角（可禁用） */}
          <div className={`transition-opacity ${paramDisabled ? 'opacity-40 pointer-events-none' : ''}`}>
            <div className="text-xs text-[#888888] mb-1">平滑圆角</div>
            <div className="flex items-center gap-2">
              <input type="range" min="0" max="100" value={config.portrait.smoothBorderRadius}
                disabled={paramDisabled}
                onChange={e => setConfig({ ...config, portrait: { ...config.portrait, smoothBorderRadius: parseInt(e.target.value) } })}
                className="w-24 accent-blue-500 appearance-none h-1 rounded-full bg-[#333333] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:cursor-pointer disabled:cursor-not-allowed" />
              <span className="text-xs text-white w-8">{config.portrait.smoothBorderRadius}%</span>
            </div>
          </div>

          {/* 投影（可禁用） */}
          <div className={`transition-opacity ${paramDisabled ? 'opacity-40 pointer-events-none' : ''}`}>
            <div className="text-xs text-[#888888] mb-1">投影</div>
            <div className="flex items-center gap-2">
              {numInput('X', config.portrait.shadow.offsetX, v => setConfig({ ...config, portrait: { ...config.portrait, shadow: { ...config.portrait.shadow, offsetX: v } } }), paramDisabled)}
              {numInput('Y', config.portrait.shadow.offsetY, v => setConfig({ ...config, portrait: { ...config.portrait, shadow: { ...config.portrait.shadow, offsetY: v } } }), paramDisabled)}
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              {numInput('B', config.portrait.shadow.blur, v => setConfig({ ...config, portrait: { ...config.portrait, shadow: { ...config.portrait.shadow, blur: v } } }), paramDisabled)}
              {numInput('S', config.portrait.shadow.spread, v => setConfig({ ...config, portrait: { ...config.portrait, shadow: { ...config.portrait.shadow, spread: v } } }), paramDisabled)}
            </div>
          </div>

          {/* 颜色（可禁用） */}
          <div className={`transition-opacity ${paramDisabled ? 'opacity-40 pointer-events-none' : ''}`}>
            <div className="text-xs text-[#888888] mb-1">颜色</div>
            <div className="flex items-center gap-1.5">
              <input type="color"
                disabled={paramDisabled}
                value={(() => {
                  const m = config.portrait.shadow.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                  if (m) return `#${parseInt(m[1]).toString(16).padStart(2,'0')}${parseInt(m[2]).toString(16).padStart(2,'0')}${parseInt(m[3]).toString(16).padStart(2,'0')}`;
                  return '#000000';
                })()}
                onChange={e => {
                  const h = e.target.value;
                  const r = parseInt(h.slice(1,3),16), g = parseInt(h.slice(3,5),16), b = parseInt(h.slice(5,7),16);
                  const op = config.portrait.shadow.color.match(/,\s*([\d.]+)\)/)?.[1] || '0.2';
                  setConfig({ ...config, portrait: { ...config.portrait, shadow: { ...config.portrait.shadow, color: `rgba(${r}, ${g}, ${b}, ${op})` } } });
                }}
                className="w-8 h-7 bg-[#2a2a2a] border border-[#3a3a3a] rounded cursor-pointer disabled:cursor-not-allowed" />
              <input type="number" min="0" max="100"
                disabled={paramDisabled}
                value={Math.round(parseFloat(config.portrait.shadow.color.match(/,\s*([\d.]+)\)/)?.[1] || '0.2') * 100)}
                onChange={e => {
                  const op = parseInt(e.target.value) / 100;
                  const m = config.portrait.shadow.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                  if (m) setConfig({ ...config, portrait: { ...config.portrait, shadow: { ...config.portrait.shadow, color: `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${op})` } } });
                }}
                className="w-12 px-1.5 py-1 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-white text-xs disabled:cursor-not-allowed" />
              <span className="text-xs text-[#666666]">%</span>
            </div>
          </div>

          {/* 命名区域（始终可用） */}
          <div className="ml-auto">
            <div className="text-xs text-[#888888] mb-1">默认资产名称</div>
            <div className="text-xs text-white bg-[#2a2a2a] border border-[#3a3a3a] rounded px-2 py-1 mb-1.5">
              {renderDefaultName(config.portrait.namePrefix, '_mid')}
            </div>
            <div className="text-xs text-[#888888] mb-1">自定义命名</div>
            <input type="text" value={customName} onChange={e => setCustomName(e.target.value)}
              placeholder="输入名称" className="w-40 px-2 py-1 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-white text-xs" />
          </div>
        </div>

        {/* 分割线 */}
        <div className="h-px bg-[#2a2a2a] mb-8"></div>

        {/* 三张图预览区 - 紧凑等比布局：固定高度 + aspect-ratio 自动算宽度 */}
        <div className="flex gap-3 items-end">
          {/* 大 */}
          <div className="shrink-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-[#888888]">W</span>
              {dimInput(config.portrait.outputSizes.big.width, v => setConfig({ ...config, portrait: { ...config.portrait, outputSizes: { ...config.portrait.outputSizes, big: { ...config.portrait.outputSizes.big, width: v } } } }))}
              <span className="text-xs text-[#888888] ml-2">H</span>
              {dimInput(config.portrait.outputSizes.big.height, v => setConfig({ ...config, portrait: { ...config.portrait, outputSizes: { ...config.portrait.outputSizes, big: { ...config.portrait.outputSizes.big, height: v } } } }))}
              <span className="text-xs text-[#555555] ml-1">(含投影)</span>
            </div>
            <div className="text-xs text-[#555555] mb-1">{renderHighlightedName(config.portrait.namePrefix, 'big')}</div>
            <div className="bg-[#222222] rounded-lg overflow-hidden"
              style={{ height: `${PORTRAIT_PREVIEW_H}px`, aspectRatio: outputAspect(config.portrait.outputSizes.big) }}>
              {renderUploadBox('portrait', portraitImage, portraitBigCanvasRef)}
            </div>
          </div>

          {/* 中 */}
          <div className="shrink-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-[#888888]">W</span>
              {dimInput(config.portrait.outputSizes.mid.width, v => setConfig({ ...config, portrait: { ...config.portrait, outputSizes: { ...config.portrait.outputSizes, mid: { ...config.portrait.outputSizes.mid, width: v } } } }))}
              <span className="text-xs text-[#888888] ml-2">H</span>
              {dimInput(config.portrait.outputSizes.mid.height, v => setConfig({ ...config, portrait: { ...config.portrait, outputSizes: { ...config.portrait.outputSizes, mid: { ...config.portrait.outputSizes.mid, height: v } } } }))}
            </div>
            <div className="text-xs text-[#555555] mb-1">{renderHighlightedName(config.portrait.namePrefix, 'mid')}</div>
            <div className="bg-[#222222] rounded-lg overflow-hidden"
              style={{ height: `${PORTRAIT_PREVIEW_H}px`, aspectRatio: outputAspect(config.portrait.outputSizes.mid) }}>
              {portraitImage ? (
                <canvas ref={portraitMidCanvasRef} className="w-full h-full" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-xs text-[#444444]">自动</span>
                </div>
              )}
            </div>
          </div>

          {/* 小 */}
          <div className="shrink-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-[#888888]">W</span>
              {dimInput(config.portrait.outputSizes.small.width, v => setConfig({ ...config, portrait: { ...config.portrait, outputSizes: { ...config.portrait.outputSizes, small: { ...config.portrait.outputSizes.small, width: v } } } }))}
              <span className="text-xs text-[#888888] ml-2">H</span>
              {dimInput(config.portrait.outputSizes.small.height, v => setConfig({ ...config, portrait: { ...config.portrait, outputSizes: { ...config.portrait.outputSizes, small: { ...config.portrait.outputSizes.small, height: v } } } }))}
            </div>
            <div className="text-xs text-[#555555] mb-1">{renderHighlightedName(config.portrait.namePrefix, 'small')}</div>
            <div className="bg-[#222222] rounded-lg overflow-hidden"
              style={{ height: `${smallPreviewH}px`, aspectRatio: outputAspect(config.portrait.outputSizes.small) }}>
              {portraitImage ? (
                <canvas ref={portraitSmallCanvasRef} className="w-full h-full" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-xs text-[#444444]">自动</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ====== 弹窗 + APPicon 并排 ====== */}
      <div className="flex gap-4 mb-4 items-start">
        {/* 弹窗 */}
        <div className="bg-[#1a1a1a] rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-2">弹窗</h2>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-[#888888]">W</span>
            {dimInput(config.popup.width, v => setConfig({ ...config, popup: { ...config.popup, width: v } }))}
            <span className="text-xs text-[#888888] ml-2">H</span>
            {dimInput(config.popup.height, v => setConfig({ ...config, popup: { ...config.popup, height: v } }))}
            <span className="text-xs text-[#555555] ml-1">R{config.portrait.borderRadius}</span>
          </div>
          <div className="text-xs text-[#555555] mb-1">{renderHighlightedName(config.popup.namePrefix)}</div>
          <div className="bg-[#222222] rounded-lg overflow-hidden"
            data-drop-target="popup"
            style={{ height: `${POPUP_PREVIEW_H}px`, aspectRatio: `${config.popup.width}/${config.popup.height}` }}
            onMouseEnter={() => { hoverTargetRef.current = 'popup'; }}
            onMouseLeave={() => { if (hoverTargetRef.current === 'popup') hoverTargetRef.current = null; }}
          >
            {renderUploadBox('popup', popupImage, popupCanvasRef)}
          </div>
        </div>

        {/* APPicon */}
        <div className="bg-[#1a1a1a] rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-2">APPicon</h2>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-[#888888]">W</span>
            {dimInput(config.appIcon.width, v => setConfig({ ...config, appIcon: { ...config.appIcon, width: v } }))}
            <span className="text-xs text-[#888888] ml-2">H</span>
            {dimInput(config.appIcon.height, v => setConfig({ ...config, appIcon: { ...config.appIcon, height: v } }))}
            <span className="text-xs text-[#555555] ml-1">R{config.appIcon.borderRadius}</span>
          </div>

          {/* 圆角参数（可禁用） */}
          <div className={`flex flex-wrap items-end gap-x-4 gap-y-2 mb-2 transition-opacity ${paramDisabled ? 'opacity-40 pointer-events-none' : ''}`}>
            <div>
              <div className="text-xs text-[#888888] mb-1">圆角</div>
              <input type="number" value={config.appIcon.borderRadius}
                disabled={paramDisabled}
                onChange={e => setConfig({ ...config, appIcon: { ...config.appIcon, borderRadius: parseInt(e.target.value) || 0 } })}
                className="w-14 px-2 py-1 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-white text-xs disabled:cursor-not-allowed" />
            </div>
            <div>
              <div className="text-xs text-[#888888] mb-1">平滑</div>
              <div className="flex items-center gap-1.5">
                <input type="range" min="0" max="100" value={config.appIcon.smoothBorderRadius}
                  disabled={paramDisabled}
                  onChange={e => setConfig({ ...config, appIcon: { ...config.appIcon, smoothBorderRadius: parseInt(e.target.value) } })}
                  className="w-16 accent-blue-500 appearance-none h-1 rounded-full bg-[#333333] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:cursor-pointer disabled:cursor-not-allowed" />
                <span className="text-xs text-white w-7">{config.appIcon.smoothBorderRadius}%</span>
              </div>
            </div>
          </div>

          <div className="text-xs text-[#555555] mb-2">{renderHighlightedName(config.appIcon.namePrefix)}</div>
          <div className="bg-[#222222] rounded-lg overflow-hidden"
            data-drop-target="appIcon"
            style={{ height: `${ICON_PREVIEW_H}px`, aspectRatio: `${config.appIcon.width}/${config.appIcon.height}` }}
            onMouseEnter={() => { hoverTargetRef.current = 'appIcon'; }}
            onMouseLeave={() => { if (hoverTargetRef.current === 'appIcon') hoverTargetRef.current = null; }}
          >
            {renderUploadBox('appIcon', appIconImage, appIconCanvasRef)}
          </div>
        </div>
      </div>

      {/* ====== 打包导出 ====== */}
      <div className="flex justify-end mb-4">
        <button onClick={handleExport} disabled={!canExport}
          className={`px-6 py-2.5 rounded-lg font-medium transition-colors flex items-center gap-2 text-sm ${
            canExport ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-[#2a2a2a] text-[#555555] cursor-not-allowed'
          }`}>
          <Download size={16} /> 打包导出
        </button>
      </div>
    </div>
  );
};

export default CPSAutomation;
