import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, Download, Loader2, Trash2, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { ImgComparisonSlider } from '@img-comparison-slider/react';
import { useToast } from './Toast';
import { encodeZopfliPNG, getZopfliStatus, resetZopfliStatus } from '../utils/zopflipng';

// ---- Types ----
interface UploadedImage {
  file: File;
  previewUrl: string;
  imageData: ImageData;
  pngBuffer: ArrayBuffer;
  width: number;
  height: number;
}

interface CompressionResult {
  blob: Blob;
  url: string;
  size: number;
  ratio: number;
  time: number;
}

type AlgorithmId = 'pngquant' | 'oxipng' | 'zopfli' | 'webp' | 'avif';

interface AlgorithmInfo {
  id: AlgorithmId;
  name: string;
  tag: string;
  tagColor: string;
  desc: string;
}

const ALGORITHMS: AlgorithmInfo[] = [
  { id: 'pngquant', name: '智能量化', tag: '有损·可控', tagColor: '#f59e0b', desc: 'pngquant — TinyPNG 核心算法，256 色索引 + 高级抖动，压缩率最高' },
  { id: 'oxipng', name: '无损优化', tag: '无损', tagColor: '#22c55e', desc: 'OxiPNG — Rust 编写的最快无损 PNG 优化器，像素级一致' },
  { id: 'zopfli', name: '极致压缩', tag: '极致无损', tagColor: '#3b82f6', desc: '最优行滤波 + 深度 deflate 压缩，像素级无损，自动选择最佳可用引擎' },
  { id: 'webp', name: 'WebP 无损', tag: '无损·新格式', tagColor: '#06b6d4', desc: 'Google WebP Lossless — 预测编码 + 熵编码，无损压缩率通常优于 PNG 26%' },
  { id: 'avif', name: 'AVIF', tag: '次世代', tagColor: '#a855f7', desc: 'AV1 图像格式 — 来自视频编码技术，压缩率天花板，低码率下画质远超 PNG/JPEG' },
];

const EMPTY_RESULTS: Record<AlgorithmId, CompressionResult | null> = { pngquant: null, oxipng: null, zopfli: null, webp: null, avif: null };

// ---- 主线程让步 ----
/** 让出主线程，确保浏览器能处理渲染/事件后再继续 */
function yieldToMain(): Promise<void> {
  return new Promise(resolve => {
    // requestAnimationFrame 保证浏览器完成一帧渲染
    // 之后再 setTimeout 0 让出宏任务队列
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

// 算法执行优先级：快的先跑，用户能更快看到结果
const ALGO_RUN_ORDER: AlgorithmId[] = ['webp', 'pngquant', 'oxipng', 'avif', 'zopfli'];

// ---- Helpers ----
function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fmtRatio(ratio: number): string {
  const pct = ((1 - ratio) * 100).toFixed(1);
  return `-${pct}%`;
}

function fmtTime(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function loadImageData(file: File): Promise<{ imageData: ImageData; pngBuffer: ArrayBuffer; width: number; height: number; previewUrl: string }> {
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = url;
  });
  const { width, height } = img;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);

  // Convert to PNG buffer for OxiPNG (it needs raw PNG bytes)
  const pngBuffer: ArrayBuffer = file.type === 'image/png'
    ? await file.arrayBuffer()
    : await new Promise<ArrayBuffer>((resolve) => {
        canvas.toBlob(blob => resolve(blob!.arrayBuffer()), 'image/png');
      });

  return { imageData, pngBuffer, width, height, previewUrl: url };
}

// ---- Alpha 通道 Floyd-Steinberg 预抖动 ----
// 在量化前将 alpha 离散到 N 级，FS 误差扩散让过渡依然平滑。
// 量化器只需覆盖更少的 alpha 种类 → 更多调色板条目给 RGB → 边缘更柔和。
function fsAlphaDither(pixels: Uint8Array, width: number, height: number, levels: number) {
  const step = 255 / (levels - 1);
  // 用独立误差缓冲，避免修改像素时干扰后续行
  const err = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const i = idx * 4 + 3; // alpha offset
      const orig = pixels[i];
      // 完全不透明 / 完全透明 不处理
      if (orig <= 2 || orig >= 253) continue;

      const adjusted = orig + err[idx];
      const quantized = Math.round(adjusted / step) * step;
      const clamped = Math.max(0, Math.min(255, Math.round(quantized)));
      pixels[i] = clamped;

      const error = adjusted - clamped;
      // Floyd-Steinberg 误差分配
      if (x + 1 < width)                          err[idx + 1]         += error * (7 / 16);
      if (y + 1 < height) {
        if (x > 0)                                 err[idx + width - 1] += error * (3 / 16);
                                                   err[idx + width]     += error * (5 / 16);
        if (x + 1 < width)                        err[idx + width + 1] += error * (1 / 16);
      }
    }
  }
}

// ---- Main Component ----
export default function ImageCompressor() {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [activeAlgo, setActiveAlgo] = useState<AlgorithmId>('pngquant');
  const [results, setResults] = useState<Record<string, Record<AlgorithmId, CompressionResult | null>>>({});
  const [processing, setProcessing] = useState<Record<AlgorithmId, boolean>>({ pngquant: false, oxipng: false, zopfli: false, webp: false, avif: false });

  // Settings
  const [pqQuality, setPqQuality] = useState(75);
  const [pqEdgeSmooth, setPqEdgeSmooth] = useState(true); // alpha 预抖动（边缘柔化）
  const [oxiLevel, setOxiLevel] = useState(4);
  const [zopfliIter, setZopfliIter] = useState(5);
  const [webpLossless, setWebpLossless] = useState(true); // WebP 无损模式
  const [webpQuality, setWebpQuality] = useState(90);    // WebP 有损画质 1-100
  const [avifQuality, setAvifQuality] = useState(80);     // AVIF 画质 1-100

  // Zopfli 真实进度追踪
  const [zopfliProgress, setZopfliProgress] = useState(0);   // 0-1 真实进度
  const [zopfliPhase, setZopfliPhase] = useState('');         // 当前阶段描述
  const [zopfliEta, setZopfliEta] = useState(0);             // 预计剩余毫秒
  const [zopfliEngine, setZopfliEngine] = useState<'untested' | 'available' | 'unavailable'>(getZopfliStatus);

  const selectedImage = images[selectedIdx] || null;
  const imageKey = selectedImage?.file.name ?? '';
  const currentResults = results[imageKey] || EMPTY_RESULTS;
  const activeResult = currentResults[activeAlgo];

  // ---- Upload handler ----
  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) { showToast('error', '请选择图片文件'); return; }


    const newImages: UploadedImage[] = [];
    for (const file of files) {
      try {
        const data = await loadImageData(file);
        newImages.push({ file, ...data });
      } catch {
        showToast('error', `图片读取失败：${file.name}`);
      }
    }
    setImages(prev => {
      // Revoke old URLs
      prev.forEach(img => URL.revokeObjectURL(img.previewUrl));
      return newImages;
    });
    setSelectedIdx(0);
    setResults({});

  }, [showToast]);

  // ---- Drop handler ----
  const [isDragOver, setIsDragOver] = useState(false);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  // ---- Compression runners ----
  const runPngquant = useCallback(async (img: UploadedImage): Promise<CompressionResult> => {
    const mod = await import('imagequant');
    const Imagequant = mod.Imagequant;
    const ImagequantImage = mod.ImagequantImage;
    if (!Imagequant || !ImagequantImage) throw new Error('imagequant WASM 模块加载失败');

    const t0 = performance.now();
    const pixels = new Uint8Array(img.imageData.data.length);
    pixels.set(img.imageData.data);

    // 边缘柔化：量化前对 alpha 通道做 Floyd-Steinberg 预抖动
    if (pqEdgeSmooth) {
      fsAlphaDither(pixels, img.width, img.height, 32);
    }

    let instance: InstanceType<typeof Imagequant> | null = null;
    let image: InstanceType<typeof ImagequantImage> | null = null;
    try {
      instance = new Imagequant();
      // min=0 表示 best-effort，永远不会因画质不达标而中止
      instance.set_quality(0, pqQuality);
      instance.set_speed(1); // 始终用最高质量
      image = new ImagequantImage(new Uint8Array(pixels), img.width, img.height, 0);
      const output = instance.process(image);
      const time = performance.now() - t0;
      const blob = new Blob([output], { type: 'image/png' });
      return { blob, url: URL.createObjectURL(blob), size: blob.size, ratio: blob.size / img.file.size, time };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message
        : typeof e === 'string' ? e
        : (e && typeof e === 'object' && 'message' in e) ? String((e as { message: unknown }).message)
        : String(e);
      throw new Error(`pngquant 量化失败: ${msg}`);
    } finally {
      try { image?.free(); } catch { /* ignore */ }
      try { instance?.free(); } catch { /* ignore */ }
    }
  }, [pqQuality, pqEdgeSmooth]);

  const runOxipng = useCallback(async (img: UploadedImage): Promise<CompressionResult> => {
    // @jsquash/oxipng 内部通过 import.meta.url 定位 .wasm 文件
    const oxipngModule = await import('@jsquash/oxipng');
    const optimise = oxipngModule.optimise || oxipngModule.default;
    if (!optimise) throw new Error('oxipng WASM 模块加载失败');

    const t0 = performance.now();
    const optimized = await optimise(img.pngBuffer.slice(0), { level: oxiLevel });
    const time = performance.now() - t0;
    const blob = new Blob([optimized], { type: 'image/png' });
    return { blob, url: URL.createObjectURL(blob), size: blob.size, ratio: blob.size / img.file.size, time };
  }, [oxiLevel]);

  const runZopfli = useCallback(async (img: UploadedImage): Promise<CompressionResult> => {
    setZopfliProgress(0);
    setZopfliPhase('初始化');
    setZopfliEta(0);
    const t0 = performance.now();
    const output = await encodeZopfliPNG(img.imageData, {
      numiterations: zopfliIter,
      onProgress: (progress, phase, etaMs) => {
        setZopfliProgress(progress);
        setZopfliPhase(phase);
        if (etaMs !== undefined) setZopfliEta(etaMs);
      },
    });
    const time = performance.now() - t0;
    setZopfliProgress(1);
    setZopfliPhase('完成');
    setZopfliEta(0);
    // 压缩完成后刷新引擎状态（可能已降级）
    setZopfliEngine(getZopfliStatus());
    const blob = new Blob([output], { type: 'image/png' });
    return { blob, url: URL.createObjectURL(blob), size: blob.size, ratio: blob.size / img.file.size, time };
  }, [zopfliIter]);

  const runWebp = useCallback(async (img: UploadedImage): Promise<CompressionResult> => {
    const t0 = performance.now();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(img.imageData, 0, 0);

    // quality = 1.0 → 无损 WebP；< 1.0 → 有损 WebP
    const quality = webpLossless ? 1.0 : webpQuality / 100;
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        b => b ? resolve(b) : reject(new Error('WebP 编码失败')),
        'image/webp',
        quality,
      );
    });

    const time = performance.now() - t0;
    return { blob, url: URL.createObjectURL(blob), size: blob.size, ratio: blob.size / img.file.size, time };
  }, [webpLossless, webpQuality]);

  const runAvif = useCallback(async (img: UploadedImage): Promise<CompressionResult> => {
    const t0 = performance.now();
    // 使用 @jsquash/avif WASM 编码器（基于 libavif / libaom）
    const avifModule = await import('@jsquash/avif');
    const encode = avifModule.encode || avifModule.default;
    if (!encode) throw new Error('AVIF WASM 模块加载失败');

    // avifQuality: 1-100 (越高画质越好) → cqLevel: 63-0 (越低画质越好)
    const cqLevel = Math.round(63 * (1 - avifQuality / 100));
    const avifBuffer: ArrayBuffer = await encode(img.imageData, {
      cqLevel,
      cqAlphaLevel: -1, // 自动
      speed: 6,          // 0(最慢最优) ~ 10(最快)，6 是较好平衡点
      subsample: 1,      // YUV420
    });

    const time = performance.now() - t0;
    const blob = new Blob([avifBuffer], { type: 'image/avif' });
    return { blob, url: URL.createObjectURL(blob), size: blob.size, ratio: blob.size / img.file.size, time };
  }, [avifQuality]);

  // ---- Run a specific algorithm ----
  const runAlgorithm = useCallback(async (algo: AlgorithmId, img: UploadedImage) => {
    setProcessing(prev => ({ ...prev, [algo]: true }));
    try {
      const runners: Record<AlgorithmId, (img: UploadedImage) => Promise<CompressionResult>> = {
        pngquant: runPngquant, oxipng: runOxipng, zopfli: runZopfli, webp: runWebp, avif: runAvif,
      };
      const result = await runners[algo](img);
      setResults(prev => {
        const key = img.file.name;
        const old = prev[key]?.[algo];
        if (old?.url) URL.revokeObjectURL(old.url);
        return { ...prev, [key]: { ...(prev[key] || EMPTY_RESULTS), [algo]: result } };
      });
    } catch (err: unknown) {
      // 提取错误信息（WASM 可能抛出非标准对象）
      let msg: string;
      if (err instanceof Error) msg = err.message;
      else if (typeof err === 'string') msg = err;
      else if (err && typeof err === 'object' && 'message' in err) msg = String((err as Record<string, unknown>).message);
      else msg = String(err) || '未知错误';
      const algoName = ALGORITHMS.find(a => a.id === algo)?.name || algo;
      console.error(`${algoName} 压缩失败:`, msg);
      showToast('error', `${algoName} 压缩出错：${msg}`);
    }
    setProcessing(prev => ({ ...prev, [algo]: false }));
  }, [runPngquant, runOxipng, runZopfli, runWebp, runAvif, showToast]);

  // ---- 串行自动压缩队列（带取消 + 让步）----
  const abortRef = useRef(false);
  useEffect(() => {
    if (!selectedImage) return;
    const key = selectedImage.file.name;
    // 每次 image 变化，取消上一轮队列
    abortRef.current = true;

    // 等一帧让 React 先渲染原图，再开始压缩
    let cancelled = false;
    const runQueue = async () => {
      await yieldToMain(); // 确保原图先显示
      abortRef.current = false;

      for (const algo of ALGO_RUN_ORDER) {
        if (cancelled || abortRef.current) break;
        if (!results[key]?.[algo]) {
          await runAlgorithm(algo, selectedImage);
          // 每个算法完成后让主线程喘口气
          if (!cancelled && !abortRef.current) {
            await yieldToMain();
          }
        }
      }
    };
    runQueue();

    return () => {
      cancelled = true;
      abortRef.current = true;
    };
  }, [selectedImage]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Re-run specific algorithm when its settings change ----
  const rerunAlgo = useCallback((algo: AlgorithmId) => {
    if (!selectedImage) return;
    runAlgorithm(algo, selectedImage);
  }, [selectedImage, runAlgorithm]);

  // ---- Download ----
  const handleDownload = useCallback((result: CompressionResult, originalName: string, algo: string) => {
    const ext = originalName.lastIndexOf('.');
    const baseName = ext > 0 ? originalName.substring(0, ext) : originalName;
    const outExt = algo === 'avif' ? '.avif' : algo === 'webp' ? '.webp' : '.png';
    const a = document.createElement('a');
    a.href = result.url;
    a.download = `${baseName}_${algo}${outExt}`;
    a.click();
  }, []);

  // ---- Batch download all ----
  const handleBatchDownload = useCallback(async (algo: AlgorithmId) => {
    for (const img of images) {
      const key = img.file.name;
      const r = results[key]?.[algo];
      if (!r) continue;
      handleDownload(r, img.file.name, algo);
      await new Promise(r => setTimeout(r, 400));
    }
  }, [images, results, handleDownload]);

  // ---- Cleanup ----
  useEffect(() => {
    return () => {
      images.forEach(img => URL.revokeObjectURL(img.previewUrl));
      Object.values(results).forEach(r => {
        Object.values(r).forEach(cr => { if (cr?.url) URL.revokeObjectURL(cr.url); });
      });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ==== RENDER ====
  return (
    <div className="h-full flex flex-col bg-[#0e0e0e] text-white overflow-hidden">
      {/* ---- Upload Zone ---- */}
      {images.length === 0 ? (
        <div
          className={`flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-2xl m-6 transition-colors cursor-pointer
            ${isDragOver ? 'border-blue-500 bg-blue-500/5' : 'border-[#333] hover:border-[#555]'}`}
          onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-12 h-12 text-[#555] mb-4" />
          <p className="text-sm text-[#888] mb-1">拖拽图片到此处，或点击上传</p>
          <p className="text-xs text-[#555]">支持 PNG / JPEG / WebP，可多选</p>
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
            onChange={e => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ''; }} />
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden p-4 gap-3">
          {/* ---- Image Strip ---- */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex gap-2 overflow-x-auto pb-1 flex-1" style={{ scrollbarWidth: 'thin' }}>
              {images.map((img, i) => (
                <button key={img.file.name + i}
                  onClick={() => setSelectedIdx(i)}
                  className={`shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-all
                    ${i === selectedIdx ? 'border-blue-500 ring-1 ring-blue-500/30' : 'border-[#333] hover:border-[#555]'}`}
                >
                  <img src={img.previewUrl} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
            <button onClick={() => fileInputRef.current?.click()}
              className="shrink-0 w-14 h-14 rounded-lg border-2 border-dashed border-[#333] hover:border-[#555] flex items-center justify-center transition-colors">
              <Upload className="w-4 h-4 text-[#555]" />
            </button>
            <button onClick={() => { images.forEach(img => URL.revokeObjectURL(img.previewUrl)); setImages([]); setResults({}); }}
              className="shrink-0 p-2 rounded-lg hover:bg-[#222] text-[#666] hover:text-red-400 transition-colors" title="清空全部">
              <Trash2 className="w-4 h-4" />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ''; }} />
          </div>

          {selectedImage && (
            <div className="flex-1 flex flex-col lg:flex-row gap-3 overflow-hidden">
              {/* ---- Comparison Slider ---- */}
              <div className="flex-1 flex flex-col overflow-hidden rounded-xl border border-[#222] bg-[#111]">
                <div className="flex-1 relative overflow-hidden flex items-center justify-center" style={{ minHeight: 200 }}>
                  {activeResult ? (
                    <>
                      {/*
                        关键：slider 内部 .second 是 position:relative（决定尺寸），
                        .first 是 position:absolute（覆盖全区域 + clip-path）。
                        两张图只设 width:100% 不设 height，让高度由宽度按比例自然计算，
                        确保两张图在各自容器内得到完全相同的渲染尺寸，完美重叠。
                      */}
                      <ImgComparisonSlider hover={true}
                        className="outline-none [--divider-width:1px] [--divider-color:rgba(255,255,255,0.4)]"
                        style={{ display: 'block', width: '100%', maxHeight: '100%', overflow: 'hidden' }}
                      >
                        <img slot="first" src={selectedImage.previewUrl} alt="Original"
                          style={{ display: 'block', width: '100%' }} />
                        <img slot="second" src={activeResult.url} alt="Compressed"
                          style={{ display: 'block', width: '100%' }} />
                        {/* Custom minimal handle */}
                        <div slot="handle" className="w-[1px] h-full bg-white/40 flex items-center justify-center">
                          <div className="w-8 h-8 bg-white/15 backdrop-blur-md border border-white/25 rounded-full flex items-center justify-center shadow-lg">
                            <div className="flex gap-0.5">
                              <ChevronLeft className="w-3 h-3 text-white/70" />
                              <ChevronRight className="w-3 h-3 text-white/70" />
                            </div>
                          </div>
                        </div>
                      </ImgComparisonSlider>
                      {/* 标签浮在容器上方，不进 Shadow DOM，避免布局干扰 */}
                      <div className="absolute top-3 left-3 px-2.5 py-1 bg-black/60 backdrop-blur-sm rounded-md text-xs font-serif tracking-wide text-white/80 pointer-events-none z-10">
                        Original · {fmtSize(selectedImage.file.size)}
                      </div>
                      <div className="absolute top-3 right-3 px-2.5 py-1 bg-black/60 backdrop-blur-sm rounded-md text-xs font-serif tracking-wide text-white/80 pointer-events-none z-10">
                        {ALGORITHMS.find(a => a.id === activeAlgo)?.name} · {fmtSize(activeResult.size)}
                      </div>
                    </>
                  ) : (
                    <>
                      {/* 始终展示原图（全不透明），压缩完成后才切换到对比滑块 */}
                      <img src={selectedImage.previewUrl} alt="Original"
                        className="w-full h-full object-contain" />
                      {/* 浮动进度指示器（叠加在原图上方） */}
                      {processing[activeAlgo] && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          {activeAlgo === 'zopfli' && zopfliProgress > 0 ? (
                            /* Zopfli 真实进度条 + ETA */
                            <div className="bg-black/70 backdrop-blur-md rounded-xl px-5 py-3 space-y-2 w-56">
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="text-[#ccc]">{zopfliPhase}</span>
                                <span className="text-blue-400 font-mono font-medium">{Math.round(zopfliProgress * 100)}%</span>
                              </div>
                              <div className="w-full h-1.5 bg-[#333] rounded-full overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-200 ease-out"
                                  style={{ width: `${Math.max(2, zopfliProgress * 100)}%` }} />
                              </div>
                              {zopfliEta > 1000 && (
                                <div className="text-[10px] text-[#888] text-center font-mono">
                                  预计剩余 {zopfliEta >= 60000
                                    ? `${Math.floor(zopfliEta / 60000)}分${Math.round((zopfliEta % 60000) / 1000)}秒`
                                    : `${Math.round(zopfliEta / 1000)}秒`}
                                </div>
                              )}
                            </div>
                          ) : (
                            /* 通用浮动加载指示 */
                            <div className="bg-black/70 backdrop-blur-md rounded-xl px-4 py-2.5 flex items-center gap-2.5">
                              <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                              <span className="text-xs text-[#ccc]">
                                {ALGORITHMS.find(a => a.id === activeAlgo)?.name} 压缩中...
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                      {/* 原图尺寸标签 */}
                      <div className="absolute top-3 left-3 px-2.5 py-1 bg-black/60 backdrop-blur-sm rounded-md text-xs font-serif tracking-wide text-white/80 pointer-events-none z-10">
                        Original · {fmtSize(selectedImage.file.size)}
                      </div>
                    </>
                  )}
                </div>

                {/* Image info bar */}
                <div className="shrink-0 px-3 py-1.5 border-t border-[#222] flex items-center justify-between text-[10px] text-[#666]">
                  <span>{selectedImage.file.name} · {selectedImage.width}×{selectedImage.height}</span>
                  <span>原始 {fmtSize(selectedImage.file.size)}</span>
                </div>
              </div>

              {/* ---- Right Panel: Algorithms & Results ---- */}
              <div className="lg:w-[320px] shrink-0 flex flex-col gap-3 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                {/* Algorithm tabs */}
                <div className="flex gap-0.5 p-1 bg-[#151515] rounded-lg overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                  {ALGORITHMS.map(algo => (
                    <button key={algo.id}
                      onClick={() => setActiveAlgo(algo.id)}
                      className={`shrink-0 py-1.5 px-2 rounded-md text-[11px] font-medium transition-all whitespace-nowrap
                        ${activeAlgo === algo.id ? 'bg-[#222] text-white shadow-sm' : 'text-[#666] hover:text-[#aaa]'}`}
                    >
                      {algo.name}
                    </button>
                  ))}
                </div>

                {/* Active algorithm settings */}
                <div className="bg-[#151515] rounded-xl p-3 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{ALGORITHMS.find(a => a.id === activeAlgo)?.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                      style={{ backgroundColor: ALGORITHMS.find(a => a.id === activeAlgo)!.tagColor + '20', color: ALGORITHMS.find(a => a.id === activeAlgo)!.tagColor }}>
                      {ALGORITHMS.find(a => a.id === activeAlgo)?.tag}
                    </span>
                  </div>
                  <p className="text-[10px] text-[#666] leading-relaxed flex items-start gap-1">
                    <Info className="w-3 h-3 mt-0.5 shrink-0" />
                    {ALGORITHMS.find(a => a.id === activeAlgo)?.desc}
                  </p>

                  {activeAlgo === 'pngquant' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] text-[#888]">画质</label>
                        <span className="text-[10px] text-[#aaa] font-mono">{pqQuality}</span>
                      </div>
                      <input type="range" min={10} max={100} value={pqQuality}
                        onChange={e => setPqQuality(Number(e.target.value))}
                        className="w-full h-1 bg-[#333] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber-500" />
                      <p className="text-[10px] text-[#555]">越低体积越小，越高画质越好</p>

                      <div className="flex items-center justify-between">
                        <label className="text-[10px] text-[#888]">边缘柔化</label>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" checked={pqEdgeSmooth}
                            onChange={e => setPqEdgeSmooth(e.target.checked)} className="sr-only peer" />
                          <div className="
                            w-9 h-5 rounded-full
                            bg-[#39393d] peer-checked:bg-amber-500
                            after:content-[''] after:absolute after:top-[2px] after:left-[2px]
                            after:bg-white after:rounded-full after:h-4 after:w-4
                            after:shadow-sm
                            after:transition-all after:duration-200
                            peer-checked:after:translate-x-4
                            transition-colors duration-200
                          "></div>
                        </label>
                      </div>
                      <p className="text-[10px] text-[#555]">
                        {pqEdgeSmooth
                          ? '量化前对 alpha 预抖动，半透明边缘更平滑'
                          : '直接量化，速度更快但边缘可能有阶梯'}
                      </p>

                      <button onClick={() => rerunAlgo('pngquant')} disabled={processing.pngquant}
                        className="w-full py-1.5 text-[10px] font-medium rounded-lg bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 disabled:opacity-50 transition-colors">
                        {processing.pngquant ? '压缩中...' : '重新压缩'}
                      </button>
                    </div>
                  )}

                  {activeAlgo === 'oxipng' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] text-[#888]">压缩等级</label>
                        <span className="text-[10px] text-[#aaa] font-mono">{oxiLevel}</span>
                      </div>
                      <input type="range" min={1} max={6} step={1} value={oxiLevel}
                        onChange={e => setOxiLevel(Number(e.target.value))}
                        className="w-full h-1 bg-[#333] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-green-500" />
                      <button onClick={() => rerunAlgo('oxipng')} disabled={processing.oxipng}
                        className="w-full py-1.5 text-[10px] font-medium rounded-lg bg-green-500/10 text-green-500 hover:bg-green-500/20 disabled:opacity-50 transition-colors">
                        {processing.oxipng ? '优化中...' : '重新优化'}
                      </button>
                    </div>
                  )}

                  {activeAlgo === 'zopfli' && (
                    <div className="space-y-2">
                      {/* 引擎状态指示 */}
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] text-[#888]">压缩引擎</label>
                        <span className={`text-[10px] font-medium ${zopfliEngine === 'available' ? 'text-blue-400' : 'text-[#888]'}`}>
                          {zopfliEngine === 'available' ? 'Zopfli WASM' : '原生 Deflate'}
                        </span>
                      </div>

                      {/* 迭代次数滑块仅在 Zopfli WASM 可用时显示 */}
                      {zopfliEngine === 'available' ? (
                        <>
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] text-[#888]">迭代次数</label>
                            <span className="text-[10px] text-[#aaa] font-mono">{zopfliIter}</span>
                          </div>
                          <input type="range" min={1} max={15} step={1} value={zopfliIter}
                            onChange={e => setZopfliIter(Number(e.target.value))}
                            className="w-full h-1 bg-[#333] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500" />
                          <p className="text-[10px] text-[#555]">迭代越多体积越小，但耗时线性增长</p>
                        </>
                      ) : (
                        <>
                          <p className="text-[10px] text-[#555] leading-relaxed">
                            Zopfli WASM 在当前环境不可用，已自动使用浏览器原生压缩引擎。原生引擎无迭代参数，但结合最优行滤波仍可获得不错的压缩率。
                          </p>
                          <button
                            onClick={async () => {
                              resetZopfliStatus();
                              setZopfliEngine('untested');
                              // 静默重试，无需提示
                              await rerunAlgo('zopfli');
                              setZopfliEngine(getZopfliStatus());
                            }}
                            disabled={processing.zopfli}
                            className="w-full py-1.5 text-[10px] font-medium rounded-lg border border-dashed border-[#333] text-[#666] hover:text-blue-400 hover:border-blue-500/30 disabled:opacity-50 transition-colors">
                            重试 Zopfli WASM
                          </button>
                        </>
                      )}

                      {/* 进度条 / 重新压缩按钮 */}
                      {processing.zopfli && zopfliProgress > 0 ? (
                        <div className="w-full space-y-1">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-blue-400">{zopfliPhase}</span>
                            <span className="text-blue-400 font-mono">{Math.round(zopfliProgress * 100)}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-[#222] rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-200 ease-out"
                              style={{ width: `${Math.max(2, zopfliProgress * 100)}%` }} />
                          </div>
                          {zopfliEta > 1000 && (
                            <div className="text-[10px] text-[#555] text-right font-mono">
                              预计剩余 {zopfliEta >= 60000
                                ? `${Math.floor(zopfliEta / 60000)}分${Math.round((zopfliEta % 60000) / 1000)}秒`
                                : `${Math.round(zopfliEta / 1000)}秒`}
                            </div>
                          )}
                        </div>
                      ) : !processing.zopfli ? (
                        <button onClick={() => rerunAlgo('zopfli')} disabled={processing.zopfli}
                          className="w-full py-1.5 text-[10px] font-medium rounded-lg bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 disabled:opacity-50 transition-colors">
                          重新压缩
                        </button>
                      ) : (
                        <div className="flex items-center justify-center gap-2 py-1">
                          <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />
                          <span className="text-[10px] text-[#666]">初始化中...</span>
                        </div>
                      )}
                    </div>
                  )}

                  {activeAlgo === 'webp' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] text-[#888]">无损模式</label>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" checked={webpLossless}
                            onChange={e => setWebpLossless(e.target.checked)} className="sr-only peer" />
                          <div className="
                            w-9 h-5 rounded-full
                            bg-[#39393d] peer-checked:bg-cyan-500
                            after:content-[''] after:absolute after:top-[2px] after:left-[2px]
                            after:bg-white after:rounded-full after:h-4 after:w-4
                            after:shadow-sm
                            after:transition-all after:duration-200
                            peer-checked:after:translate-x-4
                            transition-colors duration-200
                          "></div>
                        </label>
                      </div>
                      {!webpLossless && (
                        <>
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] text-[#888]">画质</label>
                            <span className="text-[10px] text-[#aaa] font-mono">{webpQuality}</span>
                          </div>
                          <input type="range" min={10} max={100} value={webpQuality}
                            onChange={e => setWebpQuality(Number(e.target.value))}
                            className="w-full h-1 bg-[#333] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-500" />
                        </>
                      )}
                      <p className="text-[10px] text-[#555]">{webpLossless ? '像素级无损，压缩率通常优于 PNG' : '越低体积越小，越高画质越好'}</p>
                      <button onClick={() => rerunAlgo('webp')} disabled={processing.webp}
                        className="w-full py-1.5 text-[10px] font-medium rounded-lg bg-cyan-500/10 text-cyan-500 hover:bg-cyan-500/20 disabled:opacity-50 transition-colors">
                        {processing.webp ? '编码中...' : '重新编码'}
                      </button>
                    </div>
                  )}

                  {activeAlgo === 'avif' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] text-[#888]">画质</label>
                        <span className="text-[10px] text-[#aaa] font-mono">{avifQuality}</span>
                      </div>
                      <input type="range" min={1} max={100} value={avifQuality}
                        onChange={e => setAvifQuality(Number(e.target.value))}
                        className="w-full h-1 bg-[#333] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-500" />
                      <p className="text-[10px] text-[#555]">80+ 肉眼几乎无损，体积远小于 PNG</p>
                      <button onClick={() => rerunAlgo('avif')} disabled={processing.avif}
                        className="w-full py-1.5 text-[10px] font-medium rounded-lg bg-purple-500/10 text-purple-500 hover:bg-purple-500/20 disabled:opacity-50 transition-colors">
                        {processing.avif ? '编码中...' : '重新编码'}
                      </button>
                    </div>
                  )}
                </div>

                {/* ---- Results Table ---- */}
                <div className="bg-[#151515] rounded-xl overflow-hidden">
                  <div className="px-3 py-2 border-b border-[#222]">
                    <span className="text-xs font-medium text-[#888]">压缩结果对比</span>
                  </div>
                  <div className="divide-y divide-[#1a1a1a]">
                    {ALGORITHMS.map(algo => {
                      const r = currentResults[algo.id];
                      const isActive = activeAlgo === algo.id;
                      const isRunning = processing[algo.id];
                      return (
                        <div key={algo.id} role="button" tabIndex={0}
                          onClick={() => setActiveAlgo(algo.id)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setActiveAlgo(algo.id); }}
                          className={`w-full px-3 py-2.5 flex items-center gap-3 transition-colors text-left cursor-pointer select-none
                            ${isActive ? 'bg-[#1a1a1a]' : 'hover:bg-[#131313]'}`}
                        >
                          {/* Status indicator */}
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isRunning ? 'bg-yellow-500 animate-pulse' : r ? 'bg-green-500' : 'bg-[#333]'}`} />
                          {/* Name */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-xs font-medium ${isActive ? 'text-white' : 'text-[#aaa]'}`}>{algo.name}</span>
                              <span className="text-[9px] px-1 py-px rounded" style={{ backgroundColor: algo.tagColor + '15', color: algo.tagColor }}>
                                {algo.tag}
                              </span>
                            </div>
                            {isRunning && algo.id === 'zopfli' && zopfliProgress > 0 ? (
                              /* Zopfli 迷你真实进度条 + ETA */
                              <div className="mt-0.5 space-y-0.5">
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-1 bg-[#222] rounded-full overflow-hidden">
                                    <div className="h-full bg-blue-500 rounded-full transition-all duration-200 ease-out"
                                      style={{ width: `${Math.max(2, zopfliProgress * 100)}%` }} />
                                  </div>
                                  <span className="text-[10px] text-blue-400 font-mono shrink-0">{Math.round(zopfliProgress * 100)}%</span>
                                </div>
                                {zopfliEta > 1000 && (
                                  <span className="text-[9px] text-[#555] font-mono">
                                    ~{zopfliEta >= 60000
                                      ? `${Math.floor(zopfliEta / 60000)}m${Math.round((zopfliEta % 60000) / 1000)}s`
                                      : `${Math.round(zopfliEta / 1000)}s`}
                                  </span>
                                )}
                              </div>
                            ) : isRunning ? (
                              <span className="text-[10px] text-[#666]">处理中...</span>
                            ) : null}
                          </div>
                          {/* Result */}
                          {r && !isRunning && (
                            <div className="text-right shrink-0">
                              <div className="text-xs font-mono text-white">{fmtSize(r.size)}</div>
                              <div className="flex items-center gap-2 text-[10px]">
                                <span className={r.ratio < 0.5 ? 'text-green-400' : r.ratio < 0.8 ? 'text-amber-400' : 'text-[#888]'}>
                                  {fmtRatio(r.ratio)}
                                </span>
                                <span className="text-[#555]">{fmtTime(r.time)}</span>
                              </div>
                            </div>
                          )}
                          {/* Download */}
                          {r && !isRunning && (
                            <button
                              onClick={e => { e.stopPropagation(); handleDownload(r, selectedImage!.file.name, algo.id); }}
                              className="shrink-0 p-1.5 rounded-md hover:bg-[#333] text-[#666] hover:text-white transition-colors"
                              title="下载"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Batch actions */}
                {images.length > 1 && (
                  <div className="bg-[#151515] rounded-xl p-3 space-y-2">
                    <span className="text-[10px] text-[#666]">批量操作 ({images.length} 张)</span>
                    <div className="flex gap-2">
                      {ALGORITHMS.map(algo => (
                        <button key={algo.id}
                          onClick={() => handleBatchDownload(algo.id)}
                          className="flex-1 py-1.5 text-[10px] font-medium rounded-lg border border-[#333] text-[#888] hover:text-white hover:border-[#555] transition-colors">
                          {algo.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
