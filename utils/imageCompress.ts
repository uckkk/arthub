// 图片压缩工具
// 用于压缩 base64 编码的图片，减小存储大小

interface CompressOptions {
  maxWidth?: number;      // 最大宽度（默认 800px）
  maxHeight?: number;     // 最大高度（默认 800px）
  quality?: number;       // 压缩质量 0-1（默认 0.8）
  maxSizeKB?: number;     // 目标最大大小（KB，默认 100KB）
}

/**
 * 压缩 base64 编码的图片
 * @param base64Image base64 编码的图片字符串（data:image/...）
 * @param options 压缩选项
 * @returns 压缩后的 base64 字符串
 */
export async function compressImage(
  base64Image: string,
  options: CompressOptions = {}
): Promise<string> {
  const {
    maxWidth = 800,
    maxHeight = 800,
    quality = 0.8,
    maxSizeKB = 100
  } = options;

  // 如果不是 base64 图片，直接返回
  if (!base64Image.startsWith('data:image')) {
    return base64Image;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      try {
        // 计算压缩后的尺寸
        let width = img.width;
        let height = img.height;
        
        // 如果图片尺寸超过限制，按比例缩放
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.floor(width * ratio);
          height = Math.floor(height * ratio);
        }
        
        // 创建 canvas
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        
        // 绘制图片到 canvas
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('无法创建 canvas 上下文'));
          return;
        }
        
        ctx.drawImage(img, 0, 0, width, height);
        
        // 获取压缩后的 base64
        let compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        
        // 如果仍然太大，逐步降低质量
        let currentQuality = quality;
        const minQuality = 0.3;
        const maxSizeBytes = maxSizeKB * 1024;
        
        // 计算 base64 字符串的实际大小（base64 编码会增加约 33% 的大小）
        const base64Size = (compressedBase64.length * 3) / 4;
        
        while (base64Size > maxSizeBytes && currentQuality > minQuality) {
          currentQuality = Math.max(minQuality, currentQuality - 0.1);
          compressedBase64 = canvas.toDataURL('image/jpeg', currentQuality);
          
          // 重新计算大小
          const newBase64Size = (compressedBase64.length * 3) / 4;
          if (newBase64Size <= maxSizeBytes) {
            break;
          }
        }
        
        // 如果还是太大，进一步缩小尺寸
        if ((compressedBase64.length * 3) / 4 > maxSizeBytes) {
          const scaleFactor = Math.sqrt(maxSizeBytes / ((compressedBase64.length * 3) / 4));
          const newWidth = Math.floor(width * scaleFactor);
          const newHeight = Math.floor(height * scaleFactor);
          
          canvas.width = newWidth;
          canvas.height = newHeight;
          ctx.drawImage(img, 0, 0, newWidth, newHeight);
          compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
        }
        
        resolve(compressedBase64);
      } catch (error) {
        reject(error);
      }
    };
    
    img.onerror = () => {
      reject(new Error('图片加载失败'));
    };
    
    img.src = base64Image;
  });
}

/**
 * 检查 base64 图片是否需要压缩
 * @param base64Image base64 编码的图片字符串
 * @param maxSizeKB 最大大小（KB，默认 100KB）
 * @returns 是否需要压缩
 */
export function needsCompression(base64Image: string, maxSizeKB: number = 100): boolean {
  if (!base64Image.startsWith('data:image')) {
    return false;
  }
  
  // 计算 base64 字符串的实际大小
  const base64Size = (base64Image.length * 3) / 4;
  return base64Size > maxSizeKB * 1024;
}
