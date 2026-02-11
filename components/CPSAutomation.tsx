import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, Download, RotateCcw, Plus } from 'lucide-react';
import { useToast } from './Toast';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/dialog';

// 默认参数配置
const DEFAULT_CONFIG = {
  // 通用立绘参数
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
  // 弹窗参数
  popup: {
    namePrefix: 'cps_image@',
  },
  // APPicon参数
  appIcon: {
    namePrefix: 'ylg_cps_icon@',
  },
};

// 图片文件类型
interface ImageFile {
  file: File;
  preview: string;
  name: string;
}

// 生成的图片数据
interface GeneratedImage {
  name: string;
  dataUrl: string;
  blob: Blob;
}

const CPSAutomation: React.FC = () => {
  const { showToast } = useToast();
  
  // 图片状态
  const [portraitImage, setPortraitImage] = useState<ImageFile | null>(null);
  const [popupImage, setPopupImage] = useState<ImageFile | null>(null);
  const [appIconImage, setAppIconImage] = useState<ImageFile | null>(null);
  
  // 配置参数
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  
  // 自定义命名
  const [customName, setCustomName] = useState('');
  
  // 预览画布引用
  const portraitBigCanvasRef = useRef<HTMLCanvasElement>(null);
  const portraitMidCanvasRef = useRef<HTMLCanvasElement>(null);
  const portraitSmallCanvasRef = useRef<HTMLCanvasElement>(null);
  const popupCanvasRef = useRef<HTMLCanvasElement>(null);
  const appIconCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // 图片加载函数
  const loadImage = (file: File): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  };
  
  // 绘制圆角矩形路径
  const drawRoundedRect = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    smooth: number = 100
  ) => {
    ctx.beginPath();
    const smoothRadius = radius * (smooth / 100);
    ctx.moveTo(x + smoothRadius, y);
    ctx.lineTo(x + width - smoothRadius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + smoothRadius);
    ctx.lineTo(x + width, y + height - smoothRadius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - smoothRadius, y + height);
    ctx.lineTo(x + smoothRadius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - smoothRadius);
    ctx.lineTo(x, y + smoothRadius);
    ctx.quadraticCurveTo(x, y, x + smoothRadius, y);
    ctx.closePath();
  };
  
  // 绘制阴影
  const drawShadow = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    shadow: typeof DEFAULT_CONFIG.portrait.shadow
  ) => {
    ctx.save();
    ctx.shadowOffsetX = shadow.offsetX;
    ctx.shadowOffsetY = shadow.offsetY;
    ctx.shadowBlur = shadow.blur;
    ctx.shadowColor = shadow.color;
    ctx.shadowSpread = shadow.spread;
    ctx.fillStyle = 'transparent';
    ctx.fillRect(x, y, width, height);
    ctx.restore();
  };
  
  // 处理图片：最长边撑满画布，保持宽高比
  const fitImageLongestSide = (
    img: HTMLImageElement,
    canvasWidth: number,
    canvasHeight: number
  ): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } => {
    const imgAspect = img.width / img.height;
    const canvasAspect = canvasWidth / canvasHeight;
    
    let sw, sh, sx, sy, dw, dh, dx, dy;
    
    if (imgAspect > canvasAspect) {
      // 图片更宽，以宽度为准
      dw = canvasWidth;
      dh = canvasWidth / imgAspect;
      dx = 0;
      dy = (canvasHeight - dh) / 2;
      
      sw = img.width;
      sh = img.height;
      sx = 0;
      sy = 0;
    } else {
      // 图片更高，以高度为准
      dh = canvasHeight;
      dw = canvasHeight * imgAspect;
      dx = (canvasWidth - dw) / 2;
      dy = 0;
      
      sw = img.width;
      sh = img.height;
      sx = 0;
      sy = 0;
    }
    
    return { sx, sy, sw, sh, dx, dy, dw, dh };
  };
  
  // 处理图片：最短边撑满画布，保持宽高比
  const fitImageShortestSide = (
    img: HTMLImageElement,
    canvasWidth: number,
    canvasHeight: number
  ): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } => {
    const imgAspect = img.width / img.height;
    const canvasAspect = canvasWidth / canvasHeight;
    
    let sw, sh, sx, sy, dw, dh, dx, dy;
    
    if (imgAspect > canvasAspect) {
      // 图片更宽，以高度为准（最短边）
      dh = canvasHeight;
      dw = canvasHeight * imgAspect;
      dx = (canvasWidth - dw) / 2;
      dy = 0;
      
      sw = img.width;
      sh = img.height;
      sx = 0;
      sy = 0;
    } else {
      // 图片更高，以宽度为准（最短边）
      dw = canvasWidth;
      dh = canvasWidth / imgAspect;
      dx = 0;
      dy = (canvasHeight - dh) / 2;
      
      sw = img.width;
      sh = img.height;
      sx = 0;
      sy = 0;
    }
    
    return { sx, sy, sw, sh, dx, dy, dw, dh };
  };
  
  // 渲染通用立绘预览
  const renderPortraitPreview = useCallback(async (
    canvasRef: React.RefObject<HTMLCanvasElement>,
    size: { width: number; height: number },
    suffix: string
  ) => {
    if (!canvasRef.current || !portraitImage) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    canvas.width = size.width;
    canvas.height = size.height;
    
    try {
      const img = await loadImage(portraitImage.file);
      
      // 清空画布
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // 绘制图片（填充整个画布）
      const { sx, sy, sw, sh, dx, dy, dw, dh } = fitImageLongestSide(img, canvas.width, canvas.height);
      
      // 绘制阴影（先绘制阴影，再绘制图片）
      ctx.save();
      ctx.shadowOffsetX = config.portrait.shadow.offsetX;
      ctx.shadowOffsetY = config.portrait.shadow.offsetY;
      ctx.shadowBlur = config.portrait.shadow.blur;
      ctx.shadowColor = config.portrait.shadow.color;
      
      // 绘制圆角矩形作为阴影源
      ctx.fillStyle = config.portrait.shadow.color;
      drawRoundedRect(ctx, dx, dy, dw, dh, config.portrait.borderRadius, config.portrait.smoothBorderRadius);
      ctx.fill();
      ctx.restore();
      
      // 绘制圆角图片（覆盖阴影）
      ctx.save();
      drawRoundedRect(ctx, dx, dy, dw, dh, config.portrait.borderRadius, config.portrait.smoothBorderRadius);
      ctx.clip();
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
      ctx.restore();
      
    } catch (error) {
      console.error('渲染预览失败:', error);
    }
  }, [portraitImage, config.portrait]);
  
  // 渲染弹窗预览
  const renderPopupPreview = useCallback(async () => {
    if (!popupCanvasRef.current || !popupImage) return;
    
    const canvas = popupCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // 弹窗尺寸（需要根据实际需求设置，这里假设为 800x600）
    canvas.width = 800;
    canvas.height = 600;
    
    try {
      const img = await loadImage(popupImage.file);
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const { sx, sy, sw, sh, dx, dy, dw, dh } = fitImageLongestSide(img, canvas.width, canvas.height);
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
      
    } catch (error) {
      console.error('渲染弹窗预览失败:', error);
    }
  }, [popupImage]);
  
  // 渲染APPicon预览
  const renderAppIconPreview = useCallback(async () => {
    if (!appIconCanvasRef.current || !appIconImage) return;
    
    const canvas = appIconCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // APPicon尺寸（假设为正方形，如 512x512）
    canvas.width = 512;
    canvas.height = 512;
    
    try {
      const img = await loadImage(appIconImage.file);
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const { sx, sy, sw, sh, dx, dy, dw, dh } = fitImageShortestSide(img, canvas.width, canvas.height);
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
      
    } catch (error) {
      console.error('渲染APPicon预览失败:', error);
    }
  }, [appIconImage]);
  
  // 更新预览
  useEffect(() => {
    renderPortraitPreview(portraitBigCanvasRef, config.portrait.sizes.big, 'big');
  }, [portraitImage, config.portrait, renderPortraitPreview]);
  
  useEffect(() => {
    renderPortraitPreview(portraitMidCanvasRef, config.portrait.sizes.mid, 'mid');
  }, [portraitImage, config.portrait, renderPortraitPreview]);
  
  useEffect(() => {
    renderPortraitPreview(portraitSmallCanvasRef, config.portrait.sizes.small, 'small');
  }, [portraitImage, config.portrait, renderPortraitPreview]);
  
  useEffect(() => {
    renderPopupPreview();
  }, [popupImage, renderPopupPreview]);
  
  useEffect(() => {
    renderAppIconPreview();
  }, [appIconImage, renderAppIconPreview]);
  
  // 处理文件上传
  const handleFileUpload = (
    file: File,
    type: 'portrait' | 'popup' | 'appIcon'
  ) => {
    if (!file.type.startsWith('image/')) {
      showToast('请上传图片文件', 'error');
      return;
    }
    
    const preview = URL.createObjectURL(file);
    const imageFile: ImageFile = {
      file,
      preview,
      name: file.name,
    };
    
    switch (type) {
      case 'portrait':
        setPortraitImage(imageFile);
        break;
      case 'popup':
        setPopupImage(imageFile);
        break;
      case 'appIcon':
        setAppIconImage(imageFile);
        break;
    }
  };
  
  // 处理拖放
  const handleDrop = (
    e: React.DragEvent,
    type: 'portrait' | 'popup' | 'appIcon'
  ) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileUpload(file, type);
    }
  };
  
  // 处理文件选择
  const handleFileSelect = (
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'portrait' | 'popup' | 'appIcon'
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file, type);
    }
  };
  
  // 恢复默认
  const handleReset = () => {
    setConfig(DEFAULT_CONFIG);
    setCustomName('');
    showToast('已恢复默认设置', 'success');
  };
  
  // 生成文件名
  const generateFileName = (prefix: string, suffix?: string): string => {
    const name = customName || '';
    let fileName = prefix.replace('@', name);
    if (suffix) {
      fileName += `_${suffix}`;
    }
    return `${fileName}.png`;
  };
  
  // 导出所有图片
  const handleExport = async () => {
    if (!portraitImage || !popupImage || !appIconImage) {
      showToast('请先上传所有三张图片', 'error');
      return;
    }
    
    try {
      // 选择导出目录
      const selectedDir = await open({
        directory: true,
        multiple: false,
        title: '选择导出目录',
      });
      
      if (!selectedDir || typeof selectedDir !== 'string') {
        return;
      }
      
      showToast('正在生成图片...', 'info');
      
      // 等待所有画布渲染完成
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const images: GeneratedImage[] = [];
      
      // 生成通用立绘三张图片
      const portraitSizes = [
        { ref: portraitBigCanvasRef, suffix: 'big' },
        { ref: portraitMidCanvasRef, suffix: 'mid' },
        { ref: portraitSmallCanvasRef, suffix: 'small' },
      ];
      
      // 使用 Promise 等待所有图片生成完成
      const portraitPromises = portraitSizes.map(({ ref, suffix }) => {
        return new Promise<void>((resolve) => {
          if (ref.current) {
            ref.current.toBlob((blob) => {
              if (blob) {
                images.push({
                  name: generateFileName(config.portrait.namePrefix, suffix),
                  dataUrl: ref.current!.toDataURL('image/png'),
                  blob,
                });
              }
              resolve();
            }, 'image/png');
          } else {
            resolve();
          }
        });
      });
      
      // 生成弹窗图片
      const popupPromise = new Promise<void>((resolve) => {
        if (popupCanvasRef.current) {
          popupCanvasRef.current.toBlob((blob) => {
            if (blob) {
              images.push({
                name: generateFileName(config.popup.namePrefix),
                dataUrl: popupCanvasRef.current!.toDataURL('image/png'),
                blob,
              });
            }
            resolve();
          }, 'image/png');
        } else {
          resolve();
        }
      });
      
      // 生成APPicon图片
      const appIconPromise = new Promise<void>((resolve) => {
        if (appIconCanvasRef.current) {
          appIconCanvasRef.current.toBlob((blob) => {
            if (blob) {
              images.push({
                name: generateFileName(config.appIcon.namePrefix),
                dataUrl: appIconCanvasRef.current!.toDataURL('image/png'),
                blob,
              });
            }
            resolve();
          }, 'image/png');
        } else {
          resolve();
        }
      });
      
      // 等待所有图片生成完成
      await Promise.all([...portraitPromises, popupPromise, appIconPromise]);
      
      // 保存所有图片
      await saveImages(images, selectedDir);
      
    } catch (error) {
      console.error('导出失败:', error);
      showToast('导出失败', 'error');
    }
  };
  
  // 保存图片到文件
  const saveImages = async (images: GeneratedImage[], dir: string) => {
    try {
      const path = await import('@tauri-apps/api/path');
      const pathSeparator = await path.separator();
      
      for (const img of images) {
        const arrayBuffer = await img.blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        const filePath = `${dir}${pathSeparator}${img.name}`;
        
        await invoke('write_binary_file_with_path', {
          filePath,
          data: Array.from(uint8Array),
        });
      }
      
      showToast(`成功导出 ${images.length} 张图片`, 'success');
    } catch (error) {
      console.error('保存图片失败:', error);
      showToast('保存图片失败', 'error');
    }
  };
  
  // 检查是否可以导出
  const canExport = portraitImage && popupImage && appIconImage;
  
  return (
    <div className="h-full overflow-y-auto bg-[#0a0a0a] text-white p-6">
      {/* 顶部标题和控制 */}
      <div className="flex items-center justify-between mb-6">
        <div className="text-sm text-[#888888]">
          用户共输入3张图片,输入一次自定义名称,自动生成五张不同规范的图片,一键导出
        </div>
        <button
          onClick={handleReset}
          className="px-4 py-2 rounded-lg bg-[#2a2a2a] hover:bg-[#3a3a3a] text-white transition-colors flex items-center gap-2"
        >
          <RotateCcw size={16} />
          恢复默认
        </button>
      </div>
      
      {/* 通用立绘区域 */}
      <div className="bg-[#1a1a1a] rounded-lg p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">通用立绘</h2>
        
        {/* 参数控制 */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm text-[#888888] mb-2">圆角</label>
            <input
              type="number"
              value={config.portrait.borderRadius}
              onChange={(e) => setConfig({
                ...config,
                portrait: {
                  ...config.portrait,
                  borderRadius: parseInt(e.target.value) || 0,
                },
              })}
              className="w-full px-3 py-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-[#888888] mb-2">平滑圆角 (%)</label>
            <input
              type="number"
              value={config.portrait.smoothBorderRadius}
              onChange={(e) => setConfig({
                ...config,
                portrait: {
                  ...config.portrait,
                  smoothBorderRadius: parseInt(e.target.value) || 0,
                },
              })}
              className="w-full px-3 py-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-[#888888] mb-2">投影位置 X</label>
            <input
              type="number"
              value={config.portrait.shadow.offsetX}
              onChange={(e) => setConfig({
                ...config,
                portrait: {
                  ...config.portrait,
                  shadow: {
                    ...config.portrait.shadow,
                    offsetX: parseInt(e.target.value) || 0,
                  },
                },
              })}
              className="w-full px-3 py-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-[#888888] mb-2">投影位置 Y</label>
            <input
              type="number"
              value={config.portrait.shadow.offsetY}
              onChange={(e) => setConfig({
                ...config,
                portrait: {
                  ...config.portrait,
                  shadow: {
                    ...config.portrait.shadow,
                    offsetY: parseInt(e.target.value) || 0,
                  },
                },
              })}
              className="w-full px-3 py-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-[#888888] mb-2">投影模糊 (B)</label>
            <input
              type="number"
              value={config.portrait.shadow.blur}
              onChange={(e) => setConfig({
                ...config,
                portrait: {
                  ...config.portrait,
                  shadow: {
                    ...config.portrait.shadow,
                    blur: parseInt(e.target.value) || 0,
                  },
                },
              })}
              className="w-full px-3 py-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-[#888888] mb-2">投影扩散 (S)</label>
            <input
              type="number"
              value={config.portrait.shadow.spread}
              onChange={(e) => setConfig({
                ...config,
                portrait: {
                  ...config.portrait,
                  shadow: {
                    ...config.portrait.shadow,
                    spread: parseInt(e.target.value) || 0,
                  },
                },
              })}
              className="w-full px-3 py-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg text-white"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm text-[#888888] mb-2">投影颜色</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={(() => {
                  const rgbaMatch = config.portrait.shadow.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                  if (rgbaMatch) {
                    const r = parseInt(rgbaMatch[1]).toString(16).padStart(2, '0');
                    const g = parseInt(rgbaMatch[2]).toString(16).padStart(2, '0');
                    const b = parseInt(rgbaMatch[3]).toString(16).padStart(2, '0');
                    return `#${r}${g}${b}`;
                  }
                  return '#000000';
                })()}
                onChange={(e) => {
                  const hex = e.target.value;
                  const r = parseInt(hex.slice(1, 3), 16);
                  const g = parseInt(hex.slice(3, 5), 16);
                  const b = parseInt(hex.slice(5, 7), 16);
                  const opacityMatch = config.portrait.shadow.color.match(/,\s*([\d.]+)\)/);
                  const opacity = opacityMatch ? opacityMatch[1] : '0.2';
                  setConfig({
                    ...config,
                    portrait: {
                      ...config.portrait,
                      shadow: {
                        ...config.portrait.shadow,
                        color: `rgba(${r}, ${g}, ${b}, ${opacity})`,
                      },
                    },
                  });
                }}
                className="w-16 h-10 bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg cursor-pointer"
              />
              <input
                type="number"
                min="0"
                max="100"
                value={(() => {
                  const opacityMatch = config.portrait.shadow.color.match(/,\s*([\d.]+)\)/);
                  return opacityMatch ? Math.round(parseFloat(opacityMatch[1]) * 100) : 20;
                })()}
                onChange={(e) => {
                  const opacity = parseInt(e.target.value) / 100;
                  const rgbaMatch = config.portrait.shadow.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                  if (rgbaMatch) {
                    setConfig({
                      ...config,
                      portrait: {
                        ...config.portrait,
                        shadow: {
                          ...config.portrait.shadow,
                          color: `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${opacity})`,
                        },
                      },
                    });
                  }
                }}
                className="w-20 px-3 py-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg text-white"
                placeholder="透明度 %"
              />
              <span className="text-xs text-[#666666]">%</span>
            </div>
          </div>
        </div>
        
        {/* 资产名称 */}
        <div className="mb-6">
          <label className="block text-sm text-[#888888] mb-2">默认资产名称</label>
          <div className="text-sm text-white mb-2">{config.portrait.namePrefix}</div>
          <label className="block text-sm text-[#888888] mb-2">自定义命名</label>
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="输入自定义名称"
            className="w-full px-3 py-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg text-white"
          />
          <div className="text-xs text-[#666666] mt-2">
            大: {generateFileName(config.portrait.namePrefix, 'big')} | 
            中: {generateFileName(config.portrait.namePrefix, 'mid')} | 
            小: {generateFileName(config.portrait.namePrefix, 'small')}
          </div>
        </div>
        
        {/* 图片预览区域 */}
        <div className="grid grid-cols-3 gap-4">
          {['big', 'mid', 'small'].map((size) => {
            const sizeConfig = config.portrait.sizes[size as keyof typeof config.portrait.sizes];
            const canvasRef = size === 'big' ? portraitBigCanvasRef : size === 'mid' ? portraitMidCanvasRef : portraitSmallCanvasRef;
            
            return (
              <div key={size} className="bg-[#2a2a2a] rounded-lg p-4">
                <div
                  className="w-full border-2 border-dashed border-[#444444] rounded-lg flex items-center justify-center cursor-pointer hover:border-blue-500 transition-colors mb-2"
                  style={{ aspectRatio: `${sizeConfig.width} / ${sizeConfig.height}` }}
                  onDrop={(e) => handleDrop(e, 'portrait')}
                  onDragOver={(e) => e.preventDefault()}
                >
                  {portraitImage ? (
                    <canvas ref={canvasRef} className="w-full h-full" />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8">
                      <Plus size={32} className="text-[#666666] mb-2" />
                      <span className="text-sm text-[#666666]">拖入图片</span>
                    </div>
                  )}
                </div>
                <div className="text-xs text-[#888888] text-center">
                  W {sizeConfig.width} H {sizeConfig.height}
                </div>
                <div className="text-xs text-[#666666] text-center mt-1">
                  {generateFileName(config.portrait.namePrefix, size)}
                </div>
                {!portraitImage && (
                  <label className="block mt-2">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleFileSelect(e, 'portrait')}
                      className="hidden"
                    />
                    <span className="text-xs text-blue-500 cursor-pointer hover:underline text-center block">
                      点击选择
                    </span>
                  </label>
                )}
              </div>
            );
          })}
        </div>
      </div>
      
      {/* 弹窗区域 */}
      <div className="bg-[#1a1a1a] rounded-lg p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">弹窗</h2>
        
        <div className="mb-4">
          <label className="block text-sm text-[#888888] mb-2">默认资产名称</label>
          <div className="text-sm text-white mb-2">{config.popup.namePrefix}</div>
          <div className="text-sm text-white">{generateFileName(config.popup.namePrefix)}</div>
        </div>
        
        <div className="bg-[#2a2a2a] rounded-lg p-4">
          <div
            className="w-full border-2 border-dashed border-[#444444] rounded-lg flex items-center justify-center cursor-pointer hover:border-blue-500 transition-colors"
            style={{ aspectRatio: '4/3' }}
            onDrop={(e) => handleDrop(e, 'popup')}
            onDragOver={(e) => e.preventDefault()}
          >
            {popupImage ? (
              <canvas ref={popupCanvasRef} className="w-full h-full" />
            ) : (
              <div className="flex flex-col items-center justify-center py-12">
                <Plus size={32} className="text-[#666666] mb-2" />
                <span className="text-sm text-[#666666]">拖入图片（支持透明背景）</span>
              </div>
            )}
          </div>
          {!popupImage && (
            <label className="block mt-2">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleFileSelect(e, 'popup')}
                className="hidden"
              />
              <span className="text-xs text-blue-500 cursor-pointer hover:underline text-center block">
                点击选择
              </span>
            </label>
          )}
        </div>
      </div>
      
      {/* APPicon区域 */}
      <div className="bg-[#1a1a1a] rounded-lg p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">APPicon</h2>
        
        <div className="mb-4">
          <label className="block text-sm text-[#888888] mb-2">默认资产名称</label>
          <div className="text-sm text-white mb-2">{config.appIcon.namePrefix}</div>
          <div className="text-sm text-white">{generateFileName(config.appIcon.namePrefix)}</div>
        </div>
        
        <div className="bg-[#2a2a2a] rounded-lg p-4">
          <div
            className="w-full border-2 border-dashed border-[#444444] rounded-lg flex items-center justify-center cursor-pointer hover:border-blue-500 transition-colors"
            style={{ aspectRatio: '1/1', maxWidth: '300px', margin: '0 auto' }}
            onDrop={(e) => handleDrop(e, 'appIcon')}
            onDragOver={(e) => e.preventDefault()}
          >
            {appIconImage ? (
              <canvas ref={appIconCanvasRef} className="w-full h-full" />
            ) : (
              <div className="flex flex-col items-center justify-center py-12">
                <Plus size={32} className="text-[#666666] mb-2" />
                <span className="text-sm text-[#666666]">拖入图片</span>
              </div>
            )}
          </div>
          {!appIconImage && (
            <label className="block mt-2">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleFileSelect(e, 'appIcon')}
                className="hidden"
              />
              <span className="text-xs text-blue-500 cursor-pointer hover:underline text-center block">
                点击选择
              </span>
            </label>
          )}
        </div>
      </div>
      
      {/* 打包导出按钮 */}
      <div className="flex justify-center">
        <button
          onClick={handleExport}
          disabled={!canExport}
          className={`px-8 py-3 rounded-lg font-medium transition-colors flex items-center gap-2 ${
            canExport
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-[#2a2a2a] text-[#666666] cursor-not-allowed'
          }`}
        >
          <Download size={20} />
          打包导出
        </button>
      </div>
    </div>
  );
};

export default CPSAutomation;
