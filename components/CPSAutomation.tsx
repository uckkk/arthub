import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Download, RotateCcw, Plus } from 'lucide-react';
import { useToast } from './Toast';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/dialog';
import { listen } from '@tauri-apps/api/event';

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
    sizes: {
      big: { width: 619, height: 536 },
      mid: { width: 290, height: 536 },
      small: { width: 290, height: 246 },
    },
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

  const portraitBigCanvasRef = useRef<HTMLCanvasElement>(null);
  const portraitMidCanvasRef = useRef<HTMLCanvasElement>(null);
  const portraitSmallCanvasRef = useRef<HTMLCanvasElement>(null);
  const popupCanvasRef = useRef<HTMLCanvasElement>(null);
  const appIconCanvasRef = useRef<HTMLCanvasElement>(null);

  const hoverTargetRef = useRef<DropTarget>(null);

  // ---- 投影 padding 计算（通用立绘专用，弹窗和icon无投影） ----
  const shadowPadding = useMemo(() => {
    const { offsetX, offsetY, blur } = config.portrait.shadow;
    return {
      left: blur + Math.max(0, -offsetX),
      right: blur + Math.max(0, offsetX),
      top: blur + Math.max(0, -offsetY),
      bottom: blur + Math.max(0, offsetY),
    };
  }, [config.portrait.shadow]);

  // ---- Tauri 文件拖拽支持 ----
  useEffect(() => {
    let unlistenDrop: (() => void) | null = null;
    let unlistenHover: (() => void) | null = null;
    let unlistenCancel: (() => void) | null = null;

    const setup = async () => {
      unlistenHover = await listen<string[]>('tauri://file-drop-hover', () => {
        if (hoverTargetRef.current) {
          setDragOverTarget(hoverTargetRef.current);
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
        if (!isImage) {
          showToast('请拖入图片文件', 'error');
          return;
        }

        const target = hoverTargetRef.current;
        if (!target) {
          showToast('请将图片拖入指定的输入框区域', 'info');
          return;
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
          const preview = URL.createObjectURL(file);

          const imageFile: ImageFile = { file, preview, name: fileName };

          if (target === 'portrait') setPortraitImage(imageFile);
          else if (target === 'popup') setPopupImage(imageFile);
          else if (target === 'appIcon') setAppIconImage(imageFile);

          showToast(`已导入: ${fileName}`, 'success');
        } catch (err) {
          console.error('读取拖拽文件失败:', err);
          showToast('读取文件失败', 'error');
        }
      });

      unlistenCancel = await listen('tauri://file-drop-cancelled', () => {
        setDragOverTarget(null);
      });
    };

    setup();
    return () => {
      unlistenDrop?.();
      unlistenHover?.();
      unlistenCancel?.();
    };
  }, [showToast]);

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

  // 小尺寸: 基于中尺寸裁剪区域再垂直居中截短
  const fitSmallSize = (img: HTMLImageElement, cw: number, ch: number) => {
    const midSize = config.portrait.sizes.mid;
    const midAspect = midSize.width / midSize.height;
    const imgAspect = img.width / img.height;

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

    const heightRatio = ch / midSize.height;
    const smallSh = midSh * heightRatio;
    const smallSy = midSy + (midSh - smallSh) / 2;

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

  // 通用立绘渲染（包含投影，画布比内容大）
  const renderPortrait = useCallback(async (
    canvasRef: React.RefObject<HTMLCanvasElement>,
    size: { width: number; height: number },
    sizeType: 'big' | 'mid' | 'small'
  ) => {
    if (!canvasRef.current || !portraitImage) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 画布 = 内容尺寸 + 投影 padding
    const pad = shadowPadding;
    canvas.width = size.width + pad.left + pad.right;
    canvas.height = size.height + pad.top + pad.bottom;

    try {
      const img = await loadImage(portraitImage.file);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 计算内容区域内的图片适配
      const params =
        sizeType === 'big' ? fitBigSize(img, size.width, size.height) :
        sizeType === 'mid' ? fitMidSize(img, size.width, size.height) :
                             fitSmallSize(img, size.width, size.height);

      // 内容绘制位置 = padding 偏移 + 适配偏移
      const contentX = pad.left;
      const contentY = pad.top;
      const drawX = contentX + params.dx;
      const drawY = contentY + params.dy;

      // 1. 绘制投影：在内容区域画一个实心圆角矩形，Canvas shadow 自动在周围生成投影
      ctx.save();
      ctx.shadowOffsetX = config.portrait.shadow.offsetX;
      ctx.shadowOffsetY = config.portrait.shadow.offsetY;
      ctx.shadowBlur = config.portrait.shadow.blur;
      ctx.shadowColor = config.portrait.shadow.color;
      ctx.fillStyle = '#1b1b1b'; // 卡片底色 (来自 CSS: UIColor(0.106, 0.106, 0.106))
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
  }, [portraitImage, config.portrait, shadowPadding]);

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
        config.appIcon.borderRadius, config.portrait.smoothBorderRadius);
      ctx.clip();

      // 最短边撑满，居中裁剪
      const p = fitShortestSide(img, canvas.width, canvas.height);
      ctx.drawImage(img, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh);
      ctx.restore();
    } catch (e) { console.error('渲染APPicon预览失败:', e); }
  }, [appIconImage, config.appIcon, config.portrait.smoothBorderRadius]);

  useEffect(() => {
    if (portraitImage) {
      renderPortrait(portraitBigCanvasRef, config.portrait.sizes.big, 'big');
      renderPortrait(portraitMidCanvasRef, config.portrait.sizes.mid, 'mid');
      renderPortrait(portraitSmallCanvasRef, config.portrait.sizes.small, 'small');
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

  // ---- 导出 ----

  const handleExport = async () => {
    if (!portraitImage || !popupImage || !appIconImage) { showToast('请先上传所有三张图片', 'error'); return; }
    try {
      const selectedDir = await open({ directory: true, multiple: false, title: '选择导出目录' });
      if (!selectedDir || typeof selectedDir !== 'string') return;
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
    } catch (error) {
      console.error('导出失败:', error);
      showToast('导出失败: ' + (error instanceof Error ? error.message : String(error)), 'error');
    }
  };

  const canExport = portraitImage && popupImage && appIconImage;

  // ---- 小型输入组件 ----
  const numInput = (label: string, value: number, onChange: (v: number) => void) => (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-[#888888] shrink-0">{label}</span>
      <input type="number" value={value} onChange={e => onChange(parseInt(e.target.value) || 0)}
        className="w-16 px-2 py-1 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-white text-xs" />
    </div>
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

  // ---- 计算含投影的画布宽高比（用于预览容器） ----
  const paddedAspect = (size: { width: number; height: number }) => {
    const w = size.width + shadowPadding.left + shadowPadding.right;
    const h = size.height + shadowPadding.top + shadowPadding.bottom;
    return `${w}/${h}`;
  };

  // ---- 渲染 ----
  return (
    <div className="h-full overflow-y-auto bg-[#0a0a0a] text-white p-5">
      {/* 顶部提示 + 恢复默认 */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs text-[#888888]">
          用户共输入3张图片，输入一次自定义名称，自动生成五张不同规范的图片，一键导出
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
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3 mb-4">
          <div>
            <div className="text-xs text-[#888888] mb-1">圆角</div>
            <input type="number" value={config.portrait.borderRadius}
              onChange={e => setConfig({ ...config, portrait: { ...config.portrait, borderRadius: parseInt(e.target.value) || 0 } })}
              className="w-16 px-2 py-1 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-white text-xs" />
          </div>

          <div>
            <div className="text-xs text-[#888888] mb-1">平滑圆角</div>
            <div className="flex items-center gap-2">
              <input type="range" min="0" max="100" value={config.portrait.smoothBorderRadius}
                onChange={e => setConfig({ ...config, portrait: { ...config.portrait, smoothBorderRadius: parseInt(e.target.value) } })}
                className="w-24 accent-blue-500" />
              <span className="text-xs text-white w-8">{config.portrait.smoothBorderRadius}%</span>
            </div>
          </div>

          <div>
            <div className="text-xs text-[#888888] mb-1">投影</div>
            <div className="flex items-center gap-2">
              {numInput('X', config.portrait.shadow.offsetX, v => setConfig({ ...config, portrait: { ...config.portrait, shadow: { ...config.portrait.shadow, offsetX: v } } }))}
              {numInput('Y', config.portrait.shadow.offsetY, v => setConfig({ ...config, portrait: { ...config.portrait, shadow: { ...config.portrait.shadow, offsetY: v } } }))}
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              {numInput('B', config.portrait.shadow.blur, v => setConfig({ ...config, portrait: { ...config.portrait, shadow: { ...config.portrait.shadow, blur: v } } }))}
              {numInput('S', config.portrait.shadow.spread, v => setConfig({ ...config, portrait: { ...config.portrait, shadow: { ...config.portrait.shadow, spread: v } } }))}
            </div>
          </div>

          <div>
            <div className="text-xs text-[#888888] mb-1">颜色</div>
            <div className="flex items-center gap-1.5">
              <input type="color"
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
                className="w-8 h-7 bg-[#2a2a2a] border border-[#3a3a3a] rounded cursor-pointer" />
              <input type="number" min="0" max="100"
                value={Math.round(parseFloat(config.portrait.shadow.color.match(/,\s*([\d.]+)\)/)?.[1] || '0.2') * 100)}
                onChange={e => {
                  const op = parseInt(e.target.value) / 100;
                  const m = config.portrait.shadow.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                  if (m) setConfig({ ...config, portrait: { ...config.portrait, shadow: { ...config.portrait.shadow, color: `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${op})` } } });
                }}
                className="w-12 px-1.5 py-1 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-white text-xs" />
              <span className="text-xs text-[#666666]">%</span>
            </div>
          </div>

          <div className="ml-auto">
            <div className="text-xs text-[#888888] mb-1">默认资产名称</div>
            <div className="text-xs text-white bg-[#2a2a2a] border border-[#3a3a3a] rounded px-2 py-1 mb-1.5">
              {config.portrait.namePrefix.replace('@', '_mid')}
            </div>
            <div className="text-xs text-[#888888] mb-1">自定义命名</div>
            <input type="text" value={customName} onChange={e => setCustomName(e.target.value)}
              placeholder="输入名称" className="w-40 px-2 py-1 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-white text-xs" />
          </div>
        </div>

        {/* 三张图预览区 */}
        <div className="flex gap-3 items-end">
          {/* 大 */}
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-[#888888]">W</span>
              <span className="text-xs text-white">{config.portrait.sizes.big.width}</span>
              <span className="text-xs text-[#888888] ml-2">H</span>
              <span className="text-xs text-white">{config.portrait.sizes.big.height}</span>
              <span className="text-xs text-[#555555] ml-1">(+投影)</span>
            </div>
            <div className="text-xs text-[#555555] mb-1">{generateFileName(config.portrait.namePrefix, 'big')}</div>
            <div className="bg-[#222222] rounded-lg overflow-hidden"
              style={{ aspectRatio: paddedAspect(config.portrait.sizes.big) }}>
              {renderUploadBox('portrait', portraitImage, portraitBigCanvasRef)}
            </div>
          </div>

          {/* 中 */}
          <div className="shrink-0" style={{ width: '25%' }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-[#888888]">W</span>
              <span className="text-xs text-white">{config.portrait.sizes.mid.width}</span>
              <span className="text-xs text-[#888888] ml-2">H</span>
              <span className="text-xs text-white">{config.portrait.sizes.mid.height}</span>
            </div>
            <div className="text-xs text-[#555555] mb-1">{generateFileName(config.portrait.namePrefix, 'mid')}</div>
            <div className="bg-[#222222] rounded-lg overflow-hidden"
              style={{ aspectRatio: paddedAspect(config.portrait.sizes.mid) }}>
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
          <div className="shrink-0" style={{ width: '25%' }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-[#888888]">W</span>
              <span className="text-xs text-white">{config.portrait.sizes.small.width}</span>
              <span className="text-xs text-[#888888] ml-2">H</span>
              <span className="text-xs text-white">{config.portrait.sizes.small.height}</span>
            </div>
            <div className="text-xs text-[#555555] mb-1">{generateFileName(config.portrait.namePrefix, 'small')}</div>
            <div className="bg-[#222222] rounded-lg overflow-hidden"
              style={{ aspectRatio: paddedAspect(config.portrait.sizes.small) }}>
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
      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* 弹窗 */}
        <div className="bg-[#1a1a1a] rounded-lg p-5">
          <h2 className="text-base font-semibold mb-3">弹窗 <span className="text-xs text-[#666] font-normal ml-2">{config.popup.width}×{config.popup.height} R{config.portrait.borderRadius}</span></h2>
          <div className="mb-2">
            <div className="text-xs text-[#888888] mb-1">默认资产名称</div>
            <div className="text-xs text-white bg-[#2a2a2a] border border-[#3a3a3a] rounded px-2 py-1 inline-block">
              {config.popup.namePrefix.replace('@', '')}
            </div>
          </div>
          <div className="text-xs text-[#555555] mb-2">{generateFileName(config.popup.namePrefix)}</div>
          <div className="bg-[#222222] rounded-lg overflow-hidden"
            style={{ aspectRatio: `${config.popup.width}/${config.popup.height}` }}
            onMouseEnter={() => { hoverTargetRef.current = 'popup'; }}
            onMouseLeave={() => { if (hoverTargetRef.current === 'popup') hoverTargetRef.current = null; }}
          >
            {renderUploadBox('popup', popupImage, popupCanvasRef)}
          </div>
        </div>

        {/* APPicon */}
        <div className="bg-[#1a1a1a] rounded-lg p-5">
          <h2 className="text-base font-semibold mb-3">APPicon <span className="text-xs text-[#666] font-normal ml-2">{config.appIcon.width}×{config.appIcon.height} R{config.appIcon.borderRadius}</span></h2>
          <div className="mb-2">
            <div className="text-xs text-[#888888] mb-1">默认资产名称</div>
            <div className="text-xs text-white bg-[#2a2a2a] border border-[#3a3a3a] rounded px-2 py-1 inline-block">
              {config.appIcon.namePrefix.replace('@', '')}
            </div>
          </div>
          <div className="text-xs text-[#555555] mb-2">{generateFileName(config.appIcon.namePrefix)}</div>
          <div className="bg-[#222222] rounded-lg overflow-hidden mx-auto"
            style={{ aspectRatio: `${config.appIcon.width}/${config.appIcon.height}`, maxWidth: '200px' }}
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
