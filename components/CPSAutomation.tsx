import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Download, RotateCcw, Plus, Save, ChevronDown, Share2, X, Copy, Check } from 'lucide-react';
import { useToast } from './Toast';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/dialog';
import { listen } from '@tauri-apps/api/event';
import { appWindow } from '@tauri-apps/api/window';
import UPNG from 'upng-js';
import JSZip from 'jszip';

// ---- 无损 PNG 压缩（UPNG 多滤波策略，0 = 不量化）----
function canvasToBlob(canvas: HTMLCanvasElement): Blob {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const buf = UPNG.encode([imageData.data.buffer], width, height, 0);
  return new Blob([buf], { type: 'image/png' });
}

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

interface CPSTemplate {
  id: string;
  name: string;
  config: typeof DEFAULT_CONFIG;
  createdAt: number;
}

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

  // ---- 产品介绍 & 标签 ----
  const [productDesc, setProductDesc] = useState('');
  const [tags, setTags] = useState<[string, string, string, string]>(['', '', '', '']);
  const TAG_COLORS = ['#FF6B6B', '#4ECDC4', '#FFD93D', '#6C5CE7'] as const;

  // ---- 输入校验 ----
  const nameError = customName !== '' && !/^\d{0,4}$/.test(customName) ? '序号仅限4位数字' : '';
  const descError = Array.from(productDesc).length > 10 ? `产品介绍最多10个字（当前${Array.from(productDesc).length}个）` : '';
  const tagErrors = tags.map((t, i) => Array.from(t).length > 4 ? `标签${i + 1}最多4个字` : '');
  const hasValidationError = !!(nameError || descError || tagErrors.some(e => e));

  // ---- 模板系统 ----
  const [templates, setTemplates] = useState<CPSTemplate[]>(() => {
    try {
      const saved = localStorage.getItem('arthub_cps_templates');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [activeTemplateId, setActiveTemplateId] = useState<string>('default');
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareTemplateId, setShareTemplateId] = useState<string>('default');
  const [shareUrl, setShareUrl] = useState<string>('');
  const [shareCopied, setShareCopied] = useState(false);
  const templateDropdownRef = useRef<HTMLDivElement>(null);

  // 导出目录设置（绝对路径，仅主应用使用，独立页无此功能）
  const [exportDirectory, setExportDirectory] = useState<string>(() => {
    try { return localStorage.getItem('arthub_cps_export_dir') || ''; } catch { return ''; }
  });
  useEffect(() => {
    try { localStorage.setItem('arthub_cps_export_dir', exportDirectory); } catch (_) {}
  }, [exportDirectory]);

  // 保存模板到localStorage
  useEffect(() => {
    localStorage.setItem('arthub_cps_templates', JSON.stringify(templates));
  }, [templates]);

  // 点击外部关闭模板下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(e.target as Node)) {
        setShowTemplateDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 检测配置是否被修改（相对于当前活动模板）
  const configDirty = useMemo(() => {
    if (activeTemplateId === 'default') {
      return JSON.stringify(config) !== JSON.stringify(DEFAULT_CONFIG);
    }
    const tpl = templates.find(t => t.id === activeTemplateId);
    return tpl ? JSON.stringify(config) !== JSON.stringify(tpl.config) : false;
  }, [config, activeTemplateId, templates]);

  // 保存为模板
  const handleSaveTemplate = () => {
    const name = newTemplateName.trim();
    if (!name) return;
    const newTpl: CPSTemplate = {
      id: Date.now().toString(),
      name,
      config: JSON.parse(JSON.stringify(config)),
      createdAt: Date.now(),
    };
    setTemplates([...templates, newTpl]);
    setActiveTemplateId(newTpl.id);
    setShowSaveTemplateModal(false);
    setNewTemplateName('');
    showToast('success', `模板「${name}」已保存`);
  };

  // 切换模板
  const handleSwitchTemplate = (id: string) => {
    if (id === 'default') {
      setConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
      setActiveTemplateId('default');
    } else {
      const tpl = templates.find(t => t.id === id);
      if (tpl) {
        setConfig(JSON.parse(JSON.stringify(tpl.config)));
        setActiveTemplateId(tpl.id);
      }
    }
    setShowTemplateDropdown(false);
  };

  // 删除模板
  const handleDeleteTemplate = (id: string) => {
    setTemplates(templates.filter(t => t.id !== id));
    if (activeTemplateId === id) {
      setConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
      setActiveTemplateId('default');
    }
    showToast('success', '模板已删除');
  };

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
      if (!file.type.startsWith('image/')) showToast('error', '请拖入图片文件');
      return;
    }
    const preview = URL.createObjectURL(file);
    const imageFile: ImageFile = { file, preview, name: file.name };
    if (target === 'portrait') setPortraitImage(imageFile);
    else if (target === 'popup') setPopupImage(imageFile);
    else if (target === 'appIcon') setAppIconImage(imageFile);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        if (!isImage) { showToast('error', '请拖入图片文件'); return; }

        let target = hoverTargetRef.current;
        if (!target) target = await findDropTargetUnderCursor();
        if (!target) {
          const emptySlots: DropTarget[] = [];
          if (!portraitImageRef.current) emptySlots.push('portrait');
          if (!popupImageRef.current) emptySlots.push('popup');
          if (!appIconImageRef.current) emptySlots.push('appIcon');
          if (emptySlots.length === 1) target = emptySlots[0];
          else { showToast('info', '请将图片拖入指定的输入框区域'); return; }
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
          showToast('error', '读取文件失败');
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

      // 3. 绘制标签和产品介绍文字叠加层（按高度缩放，big/mid 同高所以文字等大）
      const hScale = size.height / config.portrait.sizes.big.height;

      // 标签：big / mid 显示，small 不显示
      if (sizeType !== 'small') {
        const filledTags = tags.filter(t => t.trim());
        if (filledTags.length > 0) {
          const tagFontSize = Math.round(22 * hScale);
          const tagH = Math.round(34 * hScale);
          const tagPadX = Math.round(14 * hScale);
          const tagGap = Math.round(10 * hScale);
          const tagR = Math.round(6 * hScale);
          const startX = contentX + Math.round(16 * hScale);
          let curY = contentY + Math.round(24 * hScale);

          ctx.save();
          ctx.textBaseline = 'middle';
          ctx.font = `bold ${tagFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;

          for (let i = 0; i < tags.length; i++) {
            if (!tags[i].trim()) continue;
            const text = tags[i].trim();
            const tw = ctx.measureText(text).width;
            const boxW = tw + tagPadX * 2;

            ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
            ctx.beginPath();
            ctx.roundRect(startX, curY, boxW, tagH, tagR);
            ctx.fill();

            ctx.fillStyle = TAG_COLORS[i];
            ctx.textAlign = 'left';
            ctx.fillText(text, startX + tagPadX, curY + tagH / 2);

            curY += tagH + tagGap;
          }
          ctx.restore();
        }
      }

      // 产品介绍：big/mid/small 都显示，白字 + 半透明黑底
      if (productDesc.trim()) {
        const descFontSize = Math.round(20 * hScale);
        const descH = Math.round(32 * hScale);
        const descPadX = Math.round(12 * hScale);
        const descR = Math.round(6 * hScale);
        const descX = contentX + Math.round(16 * hScale);
        const descY = contentY + size.height - Math.round(24 * hScale) - descH;

        ctx.save();
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${descFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        const tw = ctx.measureText(productDesc).width;
        const boxW = tw + descPadX * 2;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.beginPath();
        ctx.roundRect(descX, descY, boxW, descH, descR);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.fillText(productDesc, descX + descPadX, descY + descH / 2);
        ctx.restore();
      }
    } catch (e) {
      console.error('渲染预览失败:', e);
    }
  }, [portraitImage, config.portrait, margin, tags, productDesc]);

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
    if (!file.type.startsWith('image/')) { showToast('error', '请上传图片文件'); return; }
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

  const handleReset = () => { setConfig(DEFAULT_CONFIG); setCustomName(''); setProductDesc(''); setTags(['', '', '', '']); showToast('success', '已恢复默认设置'); };

  // 自定义命名：输入为多位数字，取后3位并去除前导0作为实际命名值
  // 示例：1008 → 后3位 008 → 去前导0 → 8；1012 → 012 → 12；1108 → 108 → 108
  const extractNameFromInput = (input: string): string => {
    if (!input) return '';
    const digits = input.replace(/\D/g, '');
    if (!digits) return '';
    // 不足4位时按原数字（去前导0）处理；≥4位时取后3位再去前导0
    const lastThree = digits.length >= 4 ? digits.slice(-3) : digits;
    const value = lastThree.replace(/^0+/, '');
    return value || '0';
  };

  const generateFileName = (prefix: string, suffix?: string): string => {
    const rawName = customName || '';
    const name = extractNameFromInput(rawName);
    let fn = prefix.replace('@', name);
    if (suffix) fn += `_${suffix}`;
    return `${fn}.png`;
  };

  // 渲染带绿色高亮的文件名（仅显示最终用于命名的数字，不显示输入或箭头）
  const renderHighlightedName = (prefix: string, suffix?: string) => {
    const rawName = customName || '@';
    const name = rawName === '@' ? '@' : extractNameFromInput(rawName);
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

  // ---- 生成产品信息 .txt 内容 ----
  const generateInfoTxt = (): string | null => {
    const hasDesc = productDesc.trim();
    const filledTags = tags.filter(t => t.trim());
    if (!hasDesc && filledTags.length === 0) return null;
    const lines: string[] = [];
    if (hasDesc) lines.push(`产品介绍：${productDesc.trim()}`);
    if (filledTags.length > 0) {
      lines.push(`标签：${filledTags.join('、')}`);
    }
    return lines.join('\n');
  };

  // ---- 导出（zip 打包）----

  const handleExport = async () => {
    if (!portraitImage || !popupImage || !appIconImage) { showToast('error', '请先上传所有三张图片'); return; }
    try {
      // 导出前强制重新渲染立绘（确保标签和介绍文字已绘制到 canvas 上）
      await renderPortrait(portraitBigCanvasRef, config.portrait.sizes.big, config.portrait.outputSizes.big, 'big');
      await renderPortrait(portraitMidCanvasRef, config.portrait.sizes.mid, config.portrait.outputSizes.mid, 'mid');
      await renderPortrait(portraitSmallCanvasRef, config.portrait.sizes.small, config.portrait.outputSizes.small, 'small');
      await renderPopup();
      await renderAppIcon();

      const zip = new JSZip();

      const refs: [React.RefObject<HTMLCanvasElement>, string][] = [
        [portraitBigCanvasRef, generateFileName(config.portrait.namePrefix, 'big')],
        [portraitMidCanvasRef, generateFileName(config.portrait.namePrefix, 'mid')],
        [portraitSmallCanvasRef, generateFileName(config.portrait.namePrefix, 'small')],
        [popupCanvasRef, generateFileName(config.popup.namePrefix)],
        [appIconCanvasRef, generateFileName(config.appIcon.namePrefix)],
      ];
      for (const [ref, name] of refs) {
        if (!ref.current) continue;
        const blob = canvasToBlob(ref.current);
        zip.file(name, blob);
      }

      // 产品信息 .txt
      const infoTxt = generateInfoTxt();
      if (infoTxt) {
        const nameVal = extractNameFromInput(customName || '');
        zip.file(`产品信息_${nameVal || 'cps'}.txt`, infoTxt);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const nameVal = extractNameFromInput(customName || '');
      const zipFileName = `CPS素材_${nameVal || 'export'}.zip`;

      if (isTauri) {
        let selectedDir: string | null = exportDirectory.trim() || null;
        if (!selectedDir) {
          const chosen = await open({ directory: true, multiple: false, title: '选择导出目录' });
          selectedDir = chosen && typeof chosen === 'string' ? chosen : null;
        }
        if (!selectedDir) return;
        const dir = selectedDir.replace(/[/\\]+$/, '');
        const sep = dir.includes('/') ? '/' : '\\';
        try {
          const buf = await zipBlob.arrayBuffer();
          const filePath = `${dir}${sep}${zipFileName}`;
          await invoke('write_binary_file_with_path', {
            filePath,
            content: Array.from(new Uint8Array(buf)),
          });
          showToast('success', `已导出 ${zipFileName}`);
          try { await invoke('open_folder', { path: dir }); } catch (_) { /* 静默 */ }
        } catch (err: any) {
          const msg = err?.message || String(err);
          const isPermission = /permission|denied|access|eacces|eperm|权限|拒绝|无法写入|read-only/i.test(msg);
          if (isPermission) {
            showToast('error', '缺少目录写入权限请联系管理员');
          } else {
            showToast('error', '导出失败：' + msg);
          }
          return;
        }
      } else {
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = zipFileName;
        a.click();
        URL.revokeObjectURL(url);
        showToast('success', `已导出 ${zipFileName}`);
      }
    } catch (error) {
      console.error('导出失败:', error);
      showToast('error', '导出失败：' + (error instanceof Error ? error.message : String(error)));
    }
  };

  // ---- 生成分享页面 ----
  const generateSharePage = useCallback((templateConfig: typeof DEFAULT_CONFIG) => {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>边锋掼蛋CPS图片处理</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0a;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}
.header{text-align:center;margin-bottom:20px;display:flex;align-items:baseline;justify-content:center;gap:12px}
.header h1{font-size:18px;font-weight:600;color:#ccc;margin:0}
.upload-section{max-width:640px;width:100%;margin:0 auto 24px}
.upload-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:18px}
.upload-box{border:2px dashed #444;border-radius:12px;aspect-ratio:3/4;min-height:180px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:border-color .2s;position:relative;overflow:hidden}
.upload-box:hover{border-color:#666}
.upload-box.drag-over{border-color:#3b82f6;background:rgba(59,130,246,0.08)}
.upload-box.has-image{border-color:#333;border-style:solid}
.upload-box img{width:100%;height:100%;object-fit:cover;position:absolute;inset:0}
.upload-box .label{font-size:14px;color:#fff;margin-top:6px}
.upload-box .plus{font-size:30px;color:#fff}
.upload-box .file-size{position:absolute;bottom:6px;left:0;right:0;text-align:center;font-size:11px;color:#aaa;background:rgba(0,0,0,0.55);padding:2px 0;z-index:1}
.ctrl-row{display:flex;gap:10px;align-items:center}
.ctrl-row label{font-size:13px;color:#888;white-space:nowrap}
.ctrl-row input{flex:1;padding:9px 12px;background:#1a1a1a;border:1px solid #333;border-radius:8px;color:#fff;font-size:14px;outline:none}
.ctrl-row input:focus{border-color:#3b82f6}
.ctrl-row .btn{flex:none;width:auto;padding:9px 20px}
.btn{padding:10px 20px;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;transition:all .2s}
.btn-primary{background:#2563eb;color:#fff}.btn-primary:hover{background:#1d4ed8}
.btn-primary:disabled{background:#333;color:#555;cursor:not-allowed}
.status{text-align:center;font-size:12px;color:#888;margin-top:12px}
canvas{display:none}
.ctrl-row input::placeholder{color:#e53e3e;opacity:0.85}
.input-hint{font-size:11px;color:#e53e3e;margin-top:4px;display:none;text-align:left;padding-left:42px}
.input-hint.show{display:block}
@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}
.shake{animation:shake .4s ease}
.extra-row{display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap}
.extra-row label{font-size:13px;color:#888;white-space:nowrap}
.extra-row input{padding:9px 12px;background:#1a1a1a;border:1px solid #333;border-radius:8px;color:#fff;font-size:14px;outline:none}
.extra-row input:focus{border-color:#3b82f6}
.tag-input{width:72px!important;text-align:center}
.desc-input{width:160px!important}
.input-error{border-color:#ef4444!important}
.validation-msg{font-size:11px;color:#ef4444;margin-top:6px;display:none}
.validation-msg.show{display:block}
</style>
<script src="https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/upng-js@2.1.0/UPNG.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"><\/script>
</head>
<body>
<div class="header"><h1>边锋掼蛋CPS图片处理</h1><a href="https://rcn6u2y4zn7a.feishu.cn/wiki/RDF1wn74riHdzYkEMViccVxtnfl?from=from_copylink" target="_blank" style="font-size:13px;color:#3b82f6;text-decoration:none;margin-left:12px">规范要求</a></div>
<div class="upload-section">
  <div class="upload-grid">
    <div class="upload-box" id="box-portrait" onclick="triggerUpload('portrait')"><canvas id="previewCvs" style="display:none;width:100%;height:100%;position:absolute;inset:0"></canvas><span class="plus">+</span><span class="label">通用立绘</span></div>
    <div class="upload-box" id="box-popup" onclick="triggerUpload('popup')"><span class="plus">+</span><span class="label">弹窗</span></div>
    <div class="upload-box" id="box-appIcon" onclick="triggerUpload('appIcon')"><span class="plus">+</span><span class="label">APP图标</span></div>
  </div>
  <input type="file" id="fileInput" accept="image/*" style="display:none">
  <div class="ctrl-row">
    <label>序号</label>
    <input id="customName" placeholder="输入四位数字" maxlength="4" style="max-width:120px">
    <label style="margin-left:8px">产品介绍</label>
    <input id="productDesc" placeholder="输入十个汉字" maxlength="10" class="desc-input">
  </div>
  <div class="extra-row">
    <label>标签</label>
    <input id="tag0" class="tag-input" placeholder="标签1" maxlength="4" style="color:#FF6B6B">
    <input id="tag1" class="tag-input" placeholder="标签2" maxlength="4" style="color:#4ECDC4">
    <input id="tag2" class="tag-input" placeholder="标签3" maxlength="4" style="color:#FFD93D">
    <input id="tag3" class="tag-input" placeholder="标签4" maxlength="4" style="color:#6C5CE7">
  </div>
  <div class="validation-msg" id="validationMsg"></div>
  <div style="margin-top:12px;text-align:center">
    <button class="btn btn-primary" id="exportBtn" disabled onclick="doExport()">生成并下载</button>
  </div>
  <div class="input-hint" id="inputHint">请输入数字，4位时取后3位并去前导0</div>
  <div class="status" id="status"></div>
</div>
<canvas id="cvs"></canvas>
<script>
const CFG=${JSON.stringify(templateConfig)};
const files={portrait:null,popup:null,appIcon:null};
let currentType='';
function triggerUpload(type){currentType=type;document.getElementById('fileInput').click()}
(function(){
  var inp=document.getElementById('customName'),hint=document.getElementById('inputHint');
  inp.addEventListener('input',function(){
    var v=inp.value.replace(/[^0-9]/g,'');
    if(v.length>4) v=v.slice(0,4);
    if(inp.value!==v||inp.value.length>4){
      inp.value=v;
      inp.classList.remove('shake');void inp.offsetWidth;inp.classList.add('shake');
      hint.classList.add('show');
    }else{
      hint.classList.remove('show');
    }
    checkReady();
  });
  inp.addEventListener('animationend',function(){inp.classList.remove('shake')});
})();
// 与主应用一致：取后3位并去前导0。例 1008→8，1012→12，1108→108
function extractNameFromInput(val){
  if(!val) return '';
  var digits=val.replace(/\\D/g,'');
  if(!digits) return '';
  var lastThree=digits.length>=4?digits.slice(-3):digits;
  var value=lastThree.replace(/^0+/,'');
  return value||'0';
}
// 无损 PNG 压缩（UPNG 多滤波策略，0 = 不量化）
function canvasToPNG(canvas){
  var ctx=canvas.getContext('2d');
  var imgData=ctx.getImageData(0,0,canvas.width,canvas.height);
  var buf=UPNG.encode([imgData.data.buffer],canvas.width,canvas.height,0);
  return new Blob([buf],{type:'image/png'});
}
function fmtSize(bytes){if(bytes<1024)return bytes+'B';if(bytes<1048576)return (bytes/1024).toFixed(1)+'KB';return (bytes/1048576).toFixed(1)+'MB'}
function handleFile(type,f){
  if(!f||!f.type.startsWith('image/'))return;
  files[type]=f;
  var box=document.getElementById('box-'+type);
  box.classList.add('has-image');
  if(type==='portrait'){
    box.innerHTML='<canvas id="previewCvs" style="width:100%;height:100%;position:absolute;inset:0"></canvas><span class="file-size">'+fmtSize(f.size)+'</span>';
    updatePreview();
  }else{
    box.innerHTML='<img src="'+URL.createObjectURL(f)+'"><span class="file-size">'+fmtSize(f.size)+'</span>';
  }
  checkReady();
}
document.getElementById('fileInput').onchange=function(e){
  var f=e.target.files[0];if(!f)return;
  handleFile(currentType,f);
  e.target.value='';
};
// 拖拽上传
['portrait','popup','appIcon'].forEach(function(type){
  var box=document.getElementById('box-'+type);
  box.addEventListener('dragover',function(e){e.preventDefault();e.stopPropagation();box.classList.add('drag-over')});
  box.addEventListener('dragleave',function(e){e.preventDefault();e.stopPropagation();box.classList.remove('drag-over')});
  box.addEventListener('drop',function(e){
    e.preventDefault();e.stopPropagation();box.classList.remove('drag-over');
    var f=e.dataTransfer&&e.dataTransfer.files[0];
    if(f) handleFile(type,f);
  });
});
// 阻止页面级拖拽打开文件
document.addEventListener('dragover',function(e){e.preventDefault()});
document.addEventListener('drop',function(e){e.preventDefault()});
function charLen(s){return Array.from(s).length}
function checkReady(){
  var nameInp=document.getElementById('customName');
  var descInp=document.getElementById('productDesc');
  var v=nameInp.value;
  var errors=[];
  // 序号校验
  var nameOk=/^\\d{0,4}$/.test(v);
  if(v&&!nameOk){errors.push('序号仅限4位数字');nameInp.classList.add('input-error')}else{nameInp.classList.remove('input-error')}
  // 产品介绍校验
  var dLen=charLen(descInp.value);
  if(dLen>10){errors.push('产品介绍最多10个字（当前'+dLen+'个）');descInp.classList.add('input-error')}else{descInp.classList.remove('input-error')}
  // 标签校验
  for(var i=0;i<4;i++){var ti=document.getElementById('tag'+i);var tl=charLen(ti.value);
    if(tl>4){errors.push('标签'+(i+1)+'最多4个字');ti.classList.add('input-error')}else{ti.classList.remove('input-error')}}
  var vm=document.getElementById('validationMsg');
  if(errors.length>0){vm.textContent=errors.join('；');vm.classList.add('show')}else{vm.textContent='';vm.classList.remove('show')}
  var digits=v.replace(/\\D/g,'');
  var ok=files.portrait&&files.popup&&files.appIcon&&digits.length>=1&&digits.length<=4&&errors.length===0;
  document.getElementById('exportBtn').disabled=!ok;
}
// 标签/介绍输入触发 checkReady + 预览刷新
['productDesc','tag0','tag1','tag2','tag3'].forEach(function(id){
  document.getElementById(id).addEventListener('input',function(){checkReady();updatePreview()});
});
var _previewImg=null;
function updatePreview(){
  if(!files.portrait)return;
  var pc=document.getElementById('previewCvs');
  if(!pc)return;
  var midSize=CFG.portrait.sizes.mid,midOut=CFG.portrait.outputSizes.mid;
  pc.width=midOut.width;pc.height=midOut.height;pc.style.display='block';
  loadImg(files.portrait).then(function(img){
    _previewImg=img;
    var ctx=pc.getContext('2d');ctx.clearRect(0,0,pc.width,pc.height);
    drawPortrait(ctx,img,midOut.width,midOut.height,midSize,'mid');
  });
}
function loadImg(file){return new Promise((r,j)=>{const i=new Image();i.onload=()=>r(i);i.onerror=j;i.src=URL.createObjectURL(file)})}
function drawRoundedRect(ctx,x,y,w,h,radius,sp){
  const maxR=Math.min(w,h)/2;if(radius<=0){ctx.beginPath();ctx.rect(x,y,w,h);return}
  const s=Math.max(0,Math.min(100,sp))/100,n=2+s*3,e=2/n;
  let r;if(s>0.01){const kC=Math.SQRT1_2,kS=Math.pow(Math.SQRT1_2,e);r=Math.min(radius*(1-kC)/(1-kS),maxR)}else{r=Math.min(radius,maxR)}
  const S=48;ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);
  for(let i=S;i>=0;i--){const t=i/S*Math.PI/2;ctx.lineTo(x+w-r+r*Math.pow(Math.abs(Math.cos(t)),e),y+r-r*Math.pow(Math.abs(Math.sin(t)),e))}
  ctx.lineTo(x+w,y+h-r);
  for(let i=0;i<=S;i++){const t=i/S*Math.PI/2;ctx.lineTo(x+w-r+r*Math.pow(Math.abs(Math.cos(t)),e),y+h-r+r*Math.pow(Math.abs(Math.sin(t)),e))}
  ctx.lineTo(x+r,y+h);
  for(let i=S;i>=0;i--){const t=i/S*Math.PI/2;ctx.lineTo(x+r-r*Math.pow(Math.abs(Math.cos(t)),e),y+h-r+r*Math.pow(Math.abs(Math.sin(t)),e))}
  ctx.lineTo(x,y+r);
  for(let i=0;i<=S;i++){const t=i/S*Math.PI/2;ctx.lineTo(x+r-r*Math.pow(Math.abs(Math.cos(t)),e),y+r-r*Math.pow(Math.abs(Math.sin(t)),e))}
  ctx.closePath();
}
function fitBig(img,cw,ch){const ia=img.width/img.height,ca=cw/ch;let dw,dh,dx,dy;if(ia>ca){dw=cw;dh=cw/ia;dx=0;dy=(ch-dh)/2}else{dh=ch;dw=ch*ia;dx=(cw-dw)/2;dy=0}return{sx:0,sy:0,sw:img.width,sh:img.height,dx,dy,dw,dh}}
function fitMid(img,cw,ch){const ca=cw/ch,ia=img.width/img.height;if(ia>ca){const w=img.height*ca,x=(img.width-w)/2;return{sx:x,sy:0,sw:w,sh:img.height,dx:0,dy:0,dw:cw,dh:ch}}else{const h=img.width/ca,y=(img.height-h)/2;return{sx:0,sy:y,sw:img.width,sh:h,dx:0,dy:0,dw:cw,dh:ch}}}
function fitSmall(img,cw,ch){const ms=CFG.portrait.sizes.mid,ma=ms.width/ms.height,ia=img.width/img.height;let msx,msy,msw,msh;if(ia>ma){msw=img.height*ma;msx=(img.width-msw)/2;msy=0;msh=img.height}else{msw=img.width;msx=0;msh=img.width/ma;msy=(img.height-msh)/2}const sc=msh/ms.height,hr=ch/ms.height;return{sx:msx,sy:msy+83*sc,sw:msw,sh:msh*hr,dx:0,dy:0,dw:cw,dh:ch}}
function fitShortest(img,cw,ch){const ia=img.width/img.height,ca=cw/ch;if(ia>ca){const w=img.height*ca,x=(img.width-w)/2;return{sx:x,sy:0,sw:w,sh:img.height,dx:0,dy:0,dw:cw,dh:ch}}else{const h=img.width/ca,y=(img.height-h)/2;return{sx:0,sy:y,sw:img.width,sh:h,dx:0,dy:0,dw:cw,dh:ch}}}
const TAG_COLORS=['#FF6B6B','#4ECDC4','#FFD93D','#6C5CE7'];
function getTagValues(){return [0,1,2,3].map(function(i){return document.getElementById('tag'+i).value.trim()})}
function getDescValue(){return (document.getElementById('productDesc').value||'').trim()}
function drawPortrait(ctx,img,outW,outH,size,type){
  const m=CFG.portrait.margin;
  const p=type==='big'?fitBig(img,size.width,size.height):type==='mid'?fitMid(img,size.width,size.height):fitSmall(img,size.width,size.height);
  ctx.save();ctx.shadowOffsetX=CFG.portrait.shadow.offsetX;ctx.shadowOffsetY=CFG.portrait.shadow.offsetY;
  ctx.shadowBlur=CFG.portrait.shadow.blur;ctx.shadowColor=CFG.portrait.shadow.color;
  ctx.fillStyle='#1b1b1b';drawRoundedRect(ctx,m.left,m.top,size.width,size.height,CFG.portrait.borderRadius,CFG.portrait.smoothBorderRadius);ctx.fill();ctx.restore();
  ctx.save();drawRoundedRect(ctx,m.left,m.top,size.width,size.height,CFG.portrait.borderRadius,CFG.portrait.smoothBorderRadius);ctx.clip();
  ctx.drawImage(img,p.sx,p.sy,p.sw,p.sh,m.left+p.dx,m.top+p.dy,p.dw,p.dh);ctx.restore();
  var hs=size.height/CFG.portrait.sizes.big.height;
  if(type!=='small'){
    var tvs=getTagValues().filter(function(t){return t});
    if(tvs.length>0){
      var tFs=Math.round(22*hs),tH=Math.round(34*hs),tPx=Math.round(14*hs),tGap=Math.round(10*hs),tR=Math.round(6*hs);
      var sX=m.left+Math.round(16*hs),cY=m.top+Math.round(24*hs);
      ctx.save();ctx.textBaseline='middle';ctx.font='bold '+tFs+'px -apple-system,BlinkMacSystemFont,sans-serif';
      var allTags=getTagValues();
      for(var ti=0;ti<allTags.length;ti++){
        if(!allTags[ti])continue;
        var tw=ctx.measureText(allTags[ti]).width,bW=tw+tPx*2;
        ctx.fillStyle='rgba(0,0,0,0.65)';ctx.beginPath();ctx.roundRect(sX,cY,bW,tH,tR);ctx.fill();
        ctx.fillStyle=TAG_COLORS[ti];ctx.textAlign='left';ctx.fillText(allTags[ti],sX+tPx,cY+tH/2);
        cY+=tH+tGap;
      }
      ctx.restore();
    }
  }
  var desc=getDescValue();
  if(desc){
    var dFs=Math.round(20*hs),dH=Math.round(32*hs),dPx=Math.round(12*hs),dR=Math.round(6*hs);
    var dX=m.left+Math.round(16*hs),dY=m.top+size.height-Math.round(24*hs)-dH;
    ctx.save();ctx.textBaseline='middle';ctx.font='bold '+dFs+'px -apple-system,BlinkMacSystemFont,sans-serif';
    var dtw=ctx.measureText(desc).width,dbW=dtw+dPx*2;
    ctx.fillStyle='rgba(0,0,0,0.55)';ctx.beginPath();ctx.roundRect(dX,dY,dbW,dH,dR);ctx.fill();
    ctx.fillStyle='#ffffff';ctx.textAlign='left';ctx.fillText(desc,dX+dPx,dY+dH/2);
    ctx.restore();
  }
}
function genName(prefix,suffix){const raw=document.getElementById('customName').value||'';const n=extractNameFromInput(raw);let fn=prefix.replace('@',n);if(suffix)fn+='_'+suffix;return fn+'.png'}
async function doExport(){
  const st=document.getElementById('status');st.textContent='正在生成图片...';
  document.getElementById('exportBtn').disabled=true;
  try{
    const[pImg,popImg,iconImg]=await Promise.all([loadImg(files.portrait),loadImg(files.popup),loadImg(files.appIcon)]);
    const tasks=[
      {outSize:CFG.portrait.outputSizes.big,size:CFG.portrait.sizes.big,type:'big',prefix:CFG.portrait.namePrefix,suffix:'big'},
      {outSize:CFG.portrait.outputSizes.mid,size:CFG.portrait.sizes.mid,type:'mid',prefix:CFG.portrait.namePrefix,suffix:'mid'},
      {outSize:CFG.portrait.outputSizes.small,size:CFG.portrait.sizes.small,type:'small',prefix:CFG.portrait.namePrefix,suffix:'small'},
      {outSize:{width:CFG.popup.width,height:CFG.popup.height},type:'popup',prefix:CFG.popup.namePrefix,suffix:null},
      {outSize:{width:CFG.appIcon.width,height:CFG.appIcon.height},type:'icon',prefix:CFG.appIcon.namePrefix,suffix:null},
    ];
    var zip=new JSZip();
    for(var ti=0;ti<tasks.length;ti++){
      var t=tasks[ti];
      st.textContent='正在处理 ('+(ti+1)+'/'+tasks.length+')...';
      const cvs=document.getElementById('cvs'),ctx=cvs.getContext('2d');
      cvs.width=t.outSize.width;cvs.height=t.outSize.height;ctx.clearRect(0,0,cvs.width,cvs.height);
      if(t.type==='popup'){
        ctx.save();drawRoundedRect(ctx,0,0,cvs.width,cvs.height,CFG.portrait.borderRadius,CFG.portrait.smoothBorderRadius);ctx.clip();
        const p=fitBig(popImg,cvs.width,cvs.height);ctx.drawImage(popImg,p.sx,p.sy,p.sw,p.sh,p.dx,p.dy,p.dw,p.dh);ctx.restore();
      }else if(t.type==='icon'){
        ctx.save();drawRoundedRect(ctx,0,0,cvs.width,cvs.height,CFG.appIcon.borderRadius,CFG.appIcon.smoothBorderRadius);ctx.clip();
        const p=fitShortest(iconImg,cvs.width,cvs.height);ctx.drawImage(iconImg,p.sx,p.sy,p.sw,p.sh,p.dx,p.dy,p.dw,p.dh);ctx.restore();
      }else{
        drawPortrait(ctx,pImg,cvs.width,cvs.height,t.size,t.type);
      }
      var blob=canvasToPNG(cvs);
      var name=genName(t.prefix,t.suffix);
      zip.file(name,blob);
    }
    var desc=getDescValue(),tvs=getTagValues().filter(function(t){return t});
    if(desc||tvs.length>0){
      var lines=[];
      if(desc) lines.push('产品介绍：'+desc);
      if(tvs.length>0) lines.push('标签：'+tvs.join('、'));
      var nv=extractNameFromInput(document.getElementById('customName').value||'');
      zip.file('产品信息_'+(nv||'cps')+'.txt',lines.join('\\n'));
    }
    st.textContent='正在打包...';
    var zipBlob=await zip.generateAsync({type:'blob'});
    var nv2=extractNameFromInput(document.getElementById('customName').value||'');
    var zipName='CPS素材_'+(nv2||'export')+'.zip';
    var a=document.createElement('a');a.href=URL.createObjectURL(zipBlob);a.download=zipName;a.click();URL.revokeObjectURL(a.href);
    st.textContent='';
  }catch(e){st.textContent='处理失败: '+e.message;console.error(e)}
  document.getElementById('exportBtn').disabled=false;
}
<\/script>
<div style="text-align:center;padding:32px 0 16px;font-size:13px;color:#6b6b6b">边锋掼蛋@2026</div>
</body>
</html>`;
  }, []);

  // 处理分享
  const handleShare = useCallback(async () => {
    const tplConfig = shareTemplateId === 'default'
      ? DEFAULT_CONFIG
      : templates.find(t => t.id === shareTemplateId)?.config || DEFAULT_CONFIG;

    const html = generateSharePage(tplConfig);
    const blob = new Blob([html], { type: 'text/html' });

    if (isTauri) {
      // Tauri: 保存 HTML 文件到选择的目录
      try {
        const selectedDir = await open({ directory: true, multiple: false, title: '选择保存目录' });
        if (!selectedDir || typeof selectedDir !== 'string') return;
        const sep = (selectedDir as string).includes('/') ? '/' : '\\';
        const filePath = `${selectedDir}${sep}边锋掼蛋CPS素材生成.html`;
        const buf = await blob.arrayBuffer();
        await invoke('write_binary_file_with_path', {
          filePath,
          content: Array.from(new Uint8Array(buf)),
        });
        setShareUrl(filePath);
        showToast('success', '分享页面已生成');
        try { await invoke('open_folder', { path: selectedDir }); } catch (_) {}
      } catch (err) {
        console.error('保存分享页面失败:', err);
        showToast('error', '保存失败');
      }
    } else {
      // 浏览器: 直接下载 HTML
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '边锋掼蛋CPS素材生成.html';
      a.click();
      URL.revokeObjectURL(url);
      setShareUrl('边锋掼蛋CPS素材生成.html（已下载）');
      showToast('success', '分享页面已下载');
    }
  }, [shareTemplateId, templates, isTauri, generateSharePage, showToast]);

  const canExport = portraitImage && popupImage && appIconImage && !hasValidationError;

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
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {/* 模板选择器 */}
        <div className="relative" ref={templateDropdownRef}>
          <button
            onClick={() => setShowTemplateDropdown(!showTemplateDropdown)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#1a1a1a] border border-[#333] hover:border-[#444] text-xs text-white transition-colors"
          >
            <span className="text-[#888] mr-0.5">模板:</span>
            <span className="max-w-[120px] truncate">
              {activeTemplateId === 'default' ? '默认' : (templates.find(t => t.id === activeTemplateId)?.name || '默认')}
            </span>
            <ChevronDown size={12} className={`text-[#666] transition-transform ${showTemplateDropdown ? 'rotate-180' : ''}`} />
          </button>
          {showTemplateDropdown && (
            <div className="absolute top-full left-0 mt-1 w-56 bg-[#1a1a1a] border border-[#333] rounded-lg shadow-xl z-50 py-1 max-h-64 overflow-y-auto">
              <button
                onClick={() => handleSwitchTemplate('default')}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between ${
                  activeTemplateId === 'default' ? 'bg-blue-500/15 text-blue-400' : 'text-[#ccc] hover:bg-[#222]'
                }`}
              >
                <span>默认模板</span>
                {activeTemplateId === 'default' && <Check size={12} />}
              </button>
              {templates.length > 0 && <div className="h-px bg-[#2a2a2a] my-1" />}
              {templates.map(tpl => (
                <div key={tpl.id} className={`flex items-center group ${
                  activeTemplateId === tpl.id ? 'bg-blue-500/15' : 'hover:bg-[#222]'
                }`}>
                  <button
                    onClick={() => handleSwitchTemplate(tpl.id)}
                    className={`flex-1 text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between ${
                      activeTemplateId === tpl.id ? 'text-blue-400' : 'text-[#ccc]'
                    }`}
                  >
                    <span className="truncate">{tpl.name}</span>
                    {activeTemplateId === tpl.id && <Check size={12} />}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(tpl.id); }}
                    className="p-1 mr-1.5 rounded text-[#555] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 保存为模板按钮 */}
        {configDirty && (
          <button
            onClick={() => setShowSaveTemplateModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-green-600/20 border border-green-600/30 hover:bg-green-600/30 text-xs text-green-400 transition-colors"
          >
            <Save size={12} /> 保存为模板
          </button>
        )}

        <div className="flex-1" />

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

        {/* 分享按钮 */}
        <button
          onClick={() => { setShareUrl(''); setShareCopied(false); setShowShareModal(true); }}
          className="px-3 py-1.5 rounded bg-[#2a2a2a] hover:bg-[#3a3a3a] text-xs text-white transition-colors flex items-center gap-1.5 shrink-0"
        >
          <Share2 size={12} /> 分享
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

          {/* 命名区域 */}
          <div className={`ml-auto transition-opacity ${paramDisabled ? 'opacity-40 pointer-events-none' : ''}`}>
            <div className="text-xs text-[#888888] mb-1">默认资产名称</div>
            {customMode ? (
              <input type="text" 
                value={config.portrait.namePrefix} 
                onChange={e => setConfig({ ...config, portrait: { ...config.portrait, namePrefix: e.target.value } })}
                className="w-40 px-2 py-1 bg-[#2a2a2a] border border-[#3a3a3a] rounded text-white text-xs" />
            ) : (
              <div className="text-xs text-white bg-[#2a2a2a] border border-[#3a3a3a] rounded px-2 py-1 opacity-40">
                {renderDefaultName(config.portrait.namePrefix, '_mid')}
              </div>
            )}
          </div>
        </div>

        {/* ---- 产品介绍 & 标签输入 ---- */}
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3 mb-2">
          <div>
            <div className="text-xs text-[#888888] mb-1">序号</div>
            <input type="text" value={customName}
              onChange={e => setCustomName(e.target.value)}
              placeholder="输入四位数字"
              className={`w-36 px-2 py-1.5 bg-[#2a2a2a] border rounded text-white text-sm transition-colors ${nameError ? 'border-red-500' : 'border-[#3a3a3a]'}`} />
          </div>
          <div>
            <div className="text-xs text-[#888888] mb-1">产品介绍 <span className="text-[#555]">({Array.from(productDesc).length}/10)</span></div>
            <input type="text" value={productDesc}
              onChange={e => setProductDesc(e.target.value)}
              placeholder="输入十个汉字"
              className={`w-44 px-2 py-1.5 bg-[#2a2a2a] border rounded text-white text-sm transition-colors ${descError ? 'border-red-500' : 'border-[#3a3a3a]'}`} />
          </div>
          <div className="flex items-end gap-2">
            <div className="text-xs text-[#888888] mb-1.5 self-center">标签</div>
            {tags.map((tag, i) => (
              <input key={i} type="text" value={tag}
                onChange={e => { const next = [...tags] as [string, string, string, string]; next[i] = e.target.value; setTags(next); }}
                placeholder={`标签${i + 1}`}
                className={`w-20 px-2 py-1.5 bg-[#2a2a2a] border rounded text-sm transition-colors ${tagErrors[i] ? 'border-red-500' : 'border-[#3a3a3a]'}`}
                style={{ color: TAG_COLORS[i] }} />
            ))}
          </div>
        </div>
        {/* 校验错误提示 */}
        {hasValidationError && (
          <div className="text-xs text-red-400 mb-3 flex flex-wrap gap-x-4 gap-y-1">
            {nameError && <span>{nameError}</span>}
            {descError && <span>{descError}</span>}
            {tagErrors.map((err, i) => err ? <span key={i}>{err}</span> : null)}
          </div>
        )}

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
            {portraitImage && (
              <div className="text-[10px] text-[#555] text-center mt-1">{(portraitImage.file.size / 1024).toFixed(0)} KB</div>
            )}
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
          {popupImage && (
            <div className="text-[10px] text-[#555] text-center mt-1">{(popupImage.file.size / 1024).toFixed(0)} KB</div>
          )}
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
          {appIconImage && (
            <div className="text-[10px] text-[#555] text-center mt-1">{(appIconImage.file.size / 1024).toFixed(0)} KB</div>
          )}
        </div>
      </div>

      {/* ====== 导出目录 + 打包导出：桌面端同一行（输入框内选择目录，右侧打包导出）；浏览器仅打包导出 ====== */}
      <div className="mb-4 flex gap-2 items-center flex-wrap">
        {isTauri && (
          <div className="flex-1 min-w-[200px] flex items-center rounded-lg bg-[#0f0f0f] border border-[#2a2a2a] focus-within:border-blue-500 transition-colors">
            <input
              type="text"
              value={exportDirectory}
              onChange={e => setExportDirectory(e.target.value)}
              placeholder="导出目录（可选，绝对路径。留空则每次导出时选择目录）"
              className="flex-1 min-w-0 px-3 py-2 bg-transparent text-white text-sm placeholder-[#555] focus:outline-none"
            />
            <button
              type="button"
              onClick={async () => {
                const chosen = await open({ directory: true, multiple: false, title: '选择导出目录' });
                if (chosen && typeof chosen === 'string') setExportDirectory(chosen);
              }}
              className="px-3 py-2 rounded-r-md bg-[#2a2a2a] hover:bg-[#3a3a3a] text-white text-sm transition-colors shrink-0 border-l border-[#2a2a2a]"
            >
              选择目录
            </button>
          </div>
        )}
        <button onClick={handleExport} disabled={!canExport}
          className={`px-6 py-2.5 rounded-lg font-medium transition-colors flex items-center gap-2 text-sm shrink-0 ${isTauri ? '' : 'ml-auto'} ${
            canExport ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-[#2a2a2a] text-[#555555] cursor-not-allowed'
          }`}>
          <Download size={16} /> 导出 ZIP
        </button>
      </div>

      {/* ====== 保存模板模态框 ====== */}
      {showSaveTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setShowSaveTemplateModal(false)}>
          <div className="w-full max-w-sm mx-4 bg-[#151515] border border-[#2a2a2a] rounded-xl shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#2a2a2a]">
              <h3 className="text-sm font-semibold text-white">保存为模板</h3>
              <button onClick={() => setShowSaveTemplateModal(false)} className="p-1 rounded text-[#666] hover:text-white hover:bg-[#252525] transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="p-5">
              <label className="block text-xs text-[#888] mb-1.5">模板名称</label>
              <input
                type="text"
                value={newTemplateName}
                onChange={e => setNewTemplateName(e.target.value)}
                placeholder="输入模板名称..."
                className="w-full px-3 py-2 rounded-lg bg-[#0f0f0f] border border-[#2a2a2a] text-white text-sm placeholder-[#555] focus:outline-none focus:border-blue-500"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') handleSaveTemplate(); else if (e.key === 'Escape') setShowSaveTemplateModal(false); }}
              />
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-[#2a2a2a]">
              <button onClick={() => setShowSaveTemplateModal(false)}
                className="px-3 py-1.5 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#999] hover:text-white text-xs transition-colors">
                取消
              </button>
              <button onClick={handleSaveTemplate} disabled={!newTemplateName.trim()}
                className="px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5">
                <Save size={12} /> 保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====== 分享模态框 ====== */}
      {showShareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setShowShareModal(false)}>
          <div className="w-full max-w-md mx-4 bg-[#151515] border border-[#2a2a2a] rounded-xl shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#2a2a2a]">
              <h3 className="text-sm font-semibold text-white">分享 CPS 处理页面</h3>
              <button onClick={() => setShowShareModal(false)} className="p-1 rounded text-[#666] hover:text-white hover:bg-[#252525] transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-[#888] mb-1.5">选择模板</label>
                <select
                  value={shareTemplateId}
                  onChange={e => setShareTemplateId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0f0f0f] border border-[#2a2a2a] text-white text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="default">默认模板</option>
                  {templates.map(tpl => (
                    <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                  ))}
                </select>
              </div>
              <div className="p-3 rounded-lg bg-[#0d0d0d] border border-[#222] text-xs text-[#888] space-y-1">
                <p>将生成一个自包含的 HTML 页面，包含：</p>
                <ul className="list-disc list-inside space-y-0.5 text-[#666]">
                  <li>3 个图片上传框（能用立绘、弹窗、APP图标）</li>
                  <li>自定义命名输入</li>
                  <li>处理后 5 张图片预览 + 逐张下载</li>
                </ul>
                <p className="text-[#555] mt-1.5">所有模板参数已内嵌，无需安装任何工具，不依赖外部CDN。</p>
              </div>
              {shareUrl && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-green-500/10 border border-green-500/20">
                  <span className="text-xs text-green-400 flex-1 truncate">{shareUrl}</span>
                  <button onClick={() => { navigator.clipboard.writeText(shareUrl); setShareCopied(true); setTimeout(() => setShareCopied(false), 2000); }}
                    className="p-1 rounded text-green-400 hover:bg-green-500/20 transition-colors">
                    {shareCopied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-[#2a2a2a]">
              <button onClick={() => setShowShareModal(false)}
                className="px-3 py-1.5 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#999] hover:text-white text-xs transition-colors">
                取消
              </button>
              <button onClick={handleShare}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors flex items-center gap-1.5">
                <Share2 size={12} /> 生成分享页面
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CPSAutomation;
