import React, { useState, useRef, useCallback, useEffect } from 'react';
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
    namePrefix: 'cps_image@',
  },
  appIcon: {
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

// 当前等待接收文件拖拽的输入框类型
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

  // 记录鼠标最后悬停在哪个上传区域上
  const hoverTargetRef = useRef<DropTarget>(null);

  // ---- Tauri 文件拖拽支持 ----
  useEffect(() => {
    let unlistenDrop: (() => void) | null = null;
    let unlistenHover: (() => void) | null = null;
    let unlistenCancel: (() => void) | null = null;

    const setup = async () => {
      // 监听文件拖入悬停
      unlistenHover = await listen<string[]>('tauri://file-drop-hover', () => {
        // 高亮当前鼠标所在的上传区域
        if (hoverTargetRef.current) {
          setDragOverTarget(hoverTargetRef.current);
        }
      });

      // 监听文件放下
      unlistenDrop = await listen<string[]>('tauri://file-drop', async (event) => {
        setDragOverTarget(null);
        const paths = event.payload;
        if (!paths || paths.length === 0) return;

        const filePath = paths[0];
        const lowerPath = filePath.toLowerCase();

        // 检查是否是图片文件
        const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.svg'].some(
          ext => lowerPath.endsWith(ext)
        );
        if (!isImage) {
          showToast('请拖入图片文件', 'error');
          return;
        }

        // 确定目标区域
        const target = hoverTargetRef.current;
        if (!target) {
          showToast('请将图片拖入指定的输入框区域', 'info');
          return;
        }

        try {
          // 通过 Rust 读取文件内容，创建 File 对象
          const fileBytes: number[] = await invoke('read_binary_file_with_path', { filePath });
          const uint8Array = new Uint8Array(fileBytes);

          // 根据扩展名确定 MIME 类型
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

      // 监听拖拽取消
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

  const drawRoundedRect = (
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number,
    radius: number, smooth: number = 100
  ) => {
    const r = radius * (smooth / 100);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  const fitBigSize = (img: HTMLImageElement, cw: number, ch: number) => {
    const ia = img.width / img.height;
    const ca = cw / ch;
    let dw, dh, dx, dy;
    if (ia > ca) { dw = cw; dh = cw / ia; dx = 0; dy = (ch - dh) / 2; }
    else          { dh = ch; dw = ch * ia; dx = (cw - dw) / 2; dy = 0; }
    return { sx: 0, sy: 0, sw: img.width, sh: img.height, dx, dy, dw, dh };
  };

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

  // 小尺寸：基于中尺寸裁剪结果再裁剪（参考图：紫色区域从绿色区域中截取）
  // 1. 先计算中尺寸的裁剪区域（绿色竖条）
  // 2. 在中尺寸裁剪区域内，保持宽度不变，高度按比例居中截短
  const fitSmallSize = (img: HTMLImageElement, cw: number, ch: number) => {
    const midSize = config.portrait.sizes.mid; // 290×536
    const midAspect = midSize.width / midSize.height;
    const imgAspect = img.width / img.height;

    // 第一步：计算中尺寸裁剪区域（和 fitMidSize 逻辑一致）
    let midSx: number, midSy: number, midSw: number, midSh: number;
    if (imgAspect > midAspect) {
      // 原图更宽 → 居中取竖条，高度全取
      midSw = img.height * midAspect;
      midSx = (img.width - midSw) / 2;
      midSy = 0;
      midSh = img.height;
    } else {
      // 原图更窄 → 宽度全取，高度居中裁剪
      midSw = img.width;
      midSx = 0;
      midSh = img.width / midAspect;
      midSy = (img.height - midSh) / 2;
    }

    // 第二步：从中尺寸区域中，按小尺寸比例垂直居中裁剪
    // 小尺寸和中尺寸宽度相同(290)，只是高度更短(246 vs 536)
    const heightRatio = ch / midSize.height; // 246/536 ≈ 0.459
    const smallSh = midSh * heightRatio;
    const smallSy = midSy + (midSh - smallSh) / 2;

    return { sx: midSx, sy: smallSy, sw: midSw, sh: smallSh, dx: 0, dy: 0, dw: cw, dh: ch };
  };

  // ---- 渲染逻辑 ----

  const renderPortrait = useCallback(async (
    canvasRef: React.RefObject<HTMLCanvasElement>,
    size: { width: number; height: number },
    sizeType: 'big' | 'mid' | 'small'
  ) => {
    if (!canvasRef.current || !portraitImage) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = size.width;
    canvas.height = size.height;
    try {
      const img = await loadImage(portraitImage.file);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const params =
        sizeType === 'big' ? fitBigSize(img, canvas.width, canvas.height) :
        sizeType === 'mid' ? fitMidSize(img, canvas.width, canvas.height) :
                             fitSmallSize(img, canvas.width, canvas.height);
      const { sx, sy, sw, sh, dx, dy, dw, dh } = params;

      ctx.save();
      ctx.shadowOffsetX = config.portrait.shadow.offsetX;
      ctx.shadowOffsetY = config.portrait.shadow.offsetY;
      ctx.shadowBlur = config.portrait.shadow.blur;
      ctx.shadowColor = config.portrait.shadow.color;
      ctx.fillStyle = config.portrait.shadow.color;
      drawRoundedRect(ctx, dx, dy, dw, dh, config.portrait.borderRadius, config.portrait.smoothBorderRadius);
      ctx.fill();
      ctx.restore();

      ctx.save();
      drawRoundedRect(ctx, dx, dy, dw, dh, config.portrait.borderRadius, config.portrait.smoothBorderRadius);
      ctx.clip();
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
      ctx.restore();
    } catch (e) {
      console.error('渲染预览失败:', e);
    }
  }, [portraitImage, config.portrait]);

  const renderPopup = useCallback(async () => {
    if (!popupCanvasRef.current || !popupImage) return;
    const canvas = popupCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = 800;
    canvas.height = 600;
    try {
      const img = await loadImage(popupImage.file);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const p = fitBigSize(img, canvas.width, canvas.height);
      ctx.drawImage(img, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh);
    } catch (e) { console.error('渲染弹窗预览失败:', e); }
  }, [popupImage]);

  const renderAppIcon = useCallback(async () => {
    if (!appIconCanvasRef.current || !appIconImage) return;
    const canvas = appIconCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = 512;
    canvas.height = 512;
    try {
      const img = await loadImage(appIconImage.file);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const ia = img.width / img.height;
      if (ia > 1) {
        const cropW = img.height;
        const cropX = (img.width - cropW) / 2;
        ctx.drawImage(img, cropX, 0, cropW, img.height, 0, 0, 512, 512);
      } else {
        const cropH = img.width;
        const cropY = (img.height - cropH) / 2;
        ctx.drawImage(img, 0, cropY, img.width, cropH, 0, 0, 512, 512);
      }
    } catch (e) { console.error('渲染APPicon预览失败:', e); }
  }, [appIconImage]);

  useEffect(() => {
    if (portraitImage) {
      renderPortrait(portraitBigCanvasRef, config.portrait.sizes.big, 'big');
      renderPortrait(portraitMidCanvasRef, config.portrait.sizes.mid, 'mid');
      renderPortrait(portraitSmallCanvasRef, config.portrait.sizes.small, 'small');
    }
  }, [portraitImage, config.portrait, renderPortrait]);

  useEffect(() => { renderPopup(); }, [popupImage, renderPopup]);
  useEffect(() => { renderAppIcon(); }, [appIconImage, renderAppIcon]);

  // ---- 文件选择（点击方式） ----

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

      // 自动检测路径分隔符
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

  // ---- 上传区域（内联渲染，不用子组件避免 remount） ----
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
        <h2 className="text-base font-semibold mb-3">通用立绘</h2>

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
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-[#888888]">W</span>
              <span className="text-xs text-white">{config.portrait.sizes.big.width}</span>
              <span className="text-xs text-[#888888] ml-2">H</span>
              <span className="text-xs text-white">{config.portrait.sizes.big.height}</span>
            </div>
            <div className="text-xs text-[#555555] mb-1">{generateFileName(config.portrait.namePrefix, 'big')}</div>
            <div className="bg-[#222222] rounded-lg overflow-hidden" style={{ aspectRatio: '619/536' }}>
              {renderUploadBox('portrait', portraitImage, portraitBigCanvasRef)}
            </div>
          </div>

          <div className="shrink-0" style={{ width: '25%' }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-[#888888]">W</span>
              <span className="text-xs text-white">{config.portrait.sizes.mid.width}</span>
              <span className="text-xs text-[#888888] ml-2">H</span>
              <span className="text-xs text-white">{config.portrait.sizes.mid.height}</span>
            </div>
            <div className="text-xs text-[#555555] mb-1">{generateFileName(config.portrait.namePrefix, 'mid')}</div>
            <div className="bg-[#222222] rounded-lg overflow-hidden" style={{ aspectRatio: '290/536' }}>
              {portraitImage ? (
                <canvas ref={portraitMidCanvasRef} className="w-full h-full" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-xs text-[#444444]">自动</span>
                </div>
              )}
            </div>
          </div>

          <div className="shrink-0" style={{ width: '25%' }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-[#888888]">W</span>
              <span className="text-xs text-white">{config.portrait.sizes.small.width}</span>
              <span className="text-xs text-[#888888] ml-2">H</span>
              <span className="text-xs text-white">{config.portrait.sizes.small.height}</span>
            </div>
            <div className="text-xs text-[#555555] mb-1">{generateFileName(config.portrait.namePrefix, 'small')}</div>
            <div className="bg-[#222222] rounded-lg overflow-hidden" style={{ aspectRatio: '290/246' }}>
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
        <div className="bg-[#1a1a1a] rounded-lg p-5">
          <h2 className="text-base font-semibold mb-3">弹窗</h2>
          <div className="mb-2">
            <div className="text-xs text-[#888888] mb-1">默认资产名称</div>
            <div className="text-xs text-white bg-[#2a2a2a] border border-[#3a3a3a] rounded px-2 py-1 inline-block">
              {config.popup.namePrefix.replace('@', '')}
            </div>
          </div>
          <div className="text-xs text-[#555555] mb-2">{generateFileName(config.popup.namePrefix)}</div>
          <div className="bg-[#222222] rounded-lg overflow-hidden" style={{ aspectRatio: '4/3' }}
            onMouseEnter={() => { hoverTargetRef.current = 'popup'; }}
            onMouseLeave={() => { if (hoverTargetRef.current === 'popup') hoverTargetRef.current = null; }}
          >
            {renderUploadBox('popup', popupImage, popupCanvasRef)}
          </div>
        </div>

        <div className="bg-[#1a1a1a] rounded-lg p-5">
          <h2 className="text-base font-semibold mb-3">APPicon</h2>
          <div className="mb-2">
            <div className="text-xs text-[#888888] mb-1">默认资产名称</div>
            <div className="text-xs text-white bg-[#2a2a2a] border border-[#3a3a3a] rounded px-2 py-1 inline-block">
              {config.appIcon.namePrefix.replace('@', '')}
            </div>
          </div>
          <div className="text-xs text-[#555555] mb-2">{generateFileName(config.appIcon.namePrefix)}</div>
          <div className="bg-[#222222] rounded-lg overflow-hidden mx-auto" style={{ aspectRatio: '1/1', maxWidth: '280px' }}
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
