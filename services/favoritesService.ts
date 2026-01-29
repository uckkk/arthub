// 统一的收藏服务
// 管理所有类型的收藏项：路径、AI工作流等

import { compressImage, needsCompression } from '../utils/imageCompress';

export type FavoriteType = 'path' | 'ai_workflow';

export interface FavoriteItem {
  id: string;
  type: FavoriteType;
  // 路径类型的数据
  pathItem?: {
    id: string;
    name: string;
    path: string;
    type: 'web' | 'local' | 'network';
    group?: string;
    description?: string;
  };
  // AI工作流类型的数据
  aiWorkflow?: {
    id: string;
    name: string;
    url: string;
    description?: string;
    thumbnail?: string;
    tags?: string[];
    category?: string;
  };
  createdAt: number;
}

const FAVORITES_STORAGE_KEY = 'arthub_favorites';

// 获取所有收藏
export function getAllFavorites(): FavoriteItem[] {
  const saved = localStorage.getItem(FAVORITES_STORAGE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      return [];
    }
  }
  return [];
}

// 优化收藏项：压缩大的缩略图
async function optimizeFavoriteItem(item: FavoriteItem): Promise<FavoriteItem> {
  const optimized = { ...item };
  
  // 如果工作流有缩略图且是 base64 编码的，检查是否需要压缩
  if (optimized.aiWorkflow?.thumbnail) {
    const thumbnail = optimized.aiWorkflow.thumbnail;
    // 检查是否需要压缩（超过 100KB）
    if (needsCompression(thumbnail, 100)) {
      try {
        // 压缩图片：最大 800x800，质量 0.8，目标大小 100KB
        const compressedThumbnail = await compressImage(thumbnail, {
          maxWidth: 800,
          maxHeight: 800,
          quality: 0.8,
          maxSizeKB: 100
        });
        optimized.aiWorkflow = {
          ...optimized.aiWorkflow,
          thumbnail: compressedThumbnail
        };
      } catch (error) {
        console.warn('压缩缩略图失败，保留原图:', error);
        // 压缩失败时保留原图
      }
    }
  }
  
  return optimized;
}

// 保存收藏列表
async function saveFavoritesAsync(favorites: FavoriteItem[]): Promise<void> {
  try {
    // 先优化所有收藏项（压缩大的缩略图）
    const optimizedFavorites = await Promise.all(
      favorites.map(item => optimizeFavoriteItem(item))
    );
    
    let jsonString = JSON.stringify(optimizedFavorites);
    
    // 检查数据大小（localStorage 通常限制为 5-10MB）
    const maxSize = 4 * 1024 * 1024; // 4MB 限制
    
    // 如果数据仍然太大，对所有缩略图进行更激进的压缩
    if (jsonString.length > maxSize) {
      console.warn(`收藏数据太大 (${(jsonString.length / 1024 / 1024).toFixed(2)}MB)，进行更激进的压缩`);
      
      // 对所有缩略图进行更激进的压缩（更小的尺寸和质量）
      const aggressivelyCompressedFavorites = await Promise.all(
        optimizedFavorites.map(async (fav) => {
          if (fav.aiWorkflow?.thumbnail && needsCompression(fav.aiWorkflow.thumbnail, 50)) {
            try {
              const compressedThumbnail = await compressImage(fav.aiWorkflow.thumbnail, {
                maxWidth: 400,
                maxHeight: 400,
                quality: 0.6,
                maxSizeKB: 50
              });
              return {
                ...fav,
                aiWorkflow: {
                  ...fav.aiWorkflow,
                  thumbnail: compressedThumbnail
                }
              };
            } catch (error) {
              console.warn('激进压缩失败，保留原图:', error);
              return fav;
            }
          }
          return fav;
        })
      );
      
      jsonString = JSON.stringify(aggressivelyCompressedFavorites);
      
      // 如果还是太大，最后尝试：移除所有缩略图（但保留其他数据）
      if (jsonString.length > maxSize) {
        console.warn('数据仍然太大，移除所有缩略图');
        const noThumbnailFavorites = aggressivelyCompressedFavorites.map(fav => {
          if (fav.aiWorkflow) {
            return {
              ...fav,
              aiWorkflow: {
                ...fav.aiWorkflow,
                thumbnail: undefined
              }
            };
          }
          return fav;
        });
        jsonString = JSON.stringify(noThumbnailFavorites);
      }
    }
    
    // 最终保存
    localStorage.setItem(FAVORITES_STORAGE_KEY, jsonString);
    window.dispatchEvent(new CustomEvent('favoritesUpdated'));
  } catch (error: any) {
    if (error.name === 'QuotaExceededError' || error.message?.includes('quota')) {
      console.error('localStorage 配额超限，尝试移除所有缩略图');
      
      // 最后尝试：移除所有缩略图
      const noThumbnailFavorites = favorites.map(fav => {
        if (fav.aiWorkflow) {
          return {
            ...fav,
            aiWorkflow: {
              ...fav.aiWorkflow,
              thumbnail: undefined
            }
          };
        }
        return fav;
      });
      
      try {
        localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(noThumbnailFavorites));
        console.warn('已移除所有缩略图以保存收藏数据');
        window.dispatchEvent(new CustomEvent('favoritesUpdated'));
      } catch (retryError) {
        console.error('移除缩略图后仍然无法保存:', retryError);
        throw retryError;
      }
    } else {
      console.error('保存收藏失败:', error);
      throw error;
    }
  }
}

// 同步包装函数（内部使用异步）
function saveFavorites(favorites: FavoriteItem[]): void {
  // 使用 Promise.resolve().then() 确保异步执行，但不阻塞调用者
  Promise.resolve().then(() => saveFavoritesAsync(favorites)).catch(error => {
    console.error('异步保存收藏失败:', error);
  });
}

// 添加收藏
export function addFavorite(item: FavoriteItem): void {
  const favorites = getAllFavorites();
  // 检查是否已存在
  const exists = favorites.some(f => {
    if (f.type === 'path' && item.type === 'path') {
      return f.pathItem?.id === item.pathItem?.id;
    }
    if (f.type === 'ai_workflow' && item.type === 'ai_workflow') {
      return f.aiWorkflow?.id === item.aiWorkflow?.id;
    }
    return false;
  });
  
  if (!exists) {
    favorites.push(item);
    saveFavorites(favorites);
  }
}

// 移除收藏
export function removeFavorite(type: FavoriteType, id: string): void {
  const favorites = getAllFavorites();
  const filtered = favorites.filter(f => {
    if (f.type === 'path' && type === 'path') {
      return f.pathItem?.id !== id;
    }
    if (f.type === 'ai_workflow' && type === 'ai_workflow') {
      return f.aiWorkflow?.id !== id;
    }
    return true;
  });
  saveFavorites(filtered);
}

// 检查是否已收藏
export function isFavorited(type: FavoriteType, id: string): boolean {
  const favorites = getAllFavorites();
  return favorites.some(f => {
    if (f.type === 'path' && type === 'path') {
      return f.pathItem?.id === id;
    }
    if (f.type === 'ai_workflow' && type === 'ai_workflow') {
      return f.aiWorkflow?.id === id;
    }
    return false;
  });
}

// 切换收藏状态
export function toggleFavorite(item: FavoriteItem): boolean {
  const isCurrentlyFavorited = isFavorited(item.type, 
    item.type === 'path' ? item.pathItem!.id : item.aiWorkflow!.id
  );
  
  if (isCurrentlyFavorited) {
    removeFavorite(item.type, 
      item.type === 'path' ? item.pathItem!.id : item.aiWorkflow!.id
    );
    return false;
  } else {
    addFavorite(item);
    return true;
  }
}

// 重新排序收藏列表
export function reorderFavorites(newOrder: FavoriteItem[]): void {
  saveFavorites(newOrder);
}

// 迁移旧的快捷路径数据到新的收藏系统
export function migrateQuickPaths(): void {
  const currentPresetId = localStorage.getItem('arthub_naming_preset') || 'fgui_card';
  const quickPathsKey = `arthub_quick_paths_${currentPresetId}`;
  const saved = localStorage.getItem(quickPathsKey);
  
  if (saved) {
    try {
      const quickPaths = JSON.parse(saved);
      const favorites = getAllFavorites();
      
      // 检查是否有未迁移的快捷路径
      quickPaths.forEach((path: any) => {
        const exists = favorites.some(f => 
          f.type === 'path' && f.pathItem?.id === path.id
        );
        
        if (!exists) {
          const favoriteItem: FavoriteItem = {
            id: `path_${path.id}`,
            type: 'path',
            pathItem: path,
            createdAt: Date.now()
          };
          favorites.push(favoriteItem);
        }
      });
      
      saveFavorites(favorites);
    } catch (error) {
      console.error('迁移快捷路径失败:', error);
    }
  }
}

// 初始化时迁移数据
migrateQuickPaths();
