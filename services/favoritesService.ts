// 统一的收藏服务
// 管理所有类型的收藏项：路径、AI工作流等

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

// 优化收藏项：移除大的缩略图（base64 图片通常很大）
function optimizeFavoriteItem(item: FavoriteItem): FavoriteItem {
  const optimized = { ...item };
  
  // 如果工作流有缩略图且是 base64 编码的，移除它（base64 图片通常很大）
  if (optimized.aiWorkflow?.thumbnail) {
    const thumbnail = optimized.aiWorkflow.thumbnail;
    // 检查是否是 base64 编码的图片（通常以 data:image 开头）
    if (thumbnail.startsWith('data:image') && thumbnail.length > 50000) {
      // 如果 base64 图片超过 50KB，移除它
      optimized.aiWorkflow = {
        ...optimized.aiWorkflow,
        thumbnail: undefined
      };
    }
  }
  
  return optimized;
}

// 保存收藏列表
function saveFavorites(favorites: FavoriteItem[]): void {
  try {
    // 先优化所有收藏项（移除大的缩略图）
    const optimizedFavorites = favorites.map(optimizeFavoriteItem);
    let jsonString = JSON.stringify(optimizedFavorites);
    
    // 检查数据大小（localStorage 通常限制为 5-10MB）
    const maxSize = 3 * 1024 * 1024; // 3MB 限制（更保守）
    
    if (jsonString.length > maxSize) {
      console.warn(`收藏数据太大 (${(jsonString.length / 1024 / 1024).toFixed(2)}MB)，尝试清理`);
      
      // 策略1：移除所有缩略图
      const noThumbnailFavorites = optimizedFavorites.map(fav => {
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
      
      // 策略2：如果仍然太大，清理旧数据
      if (jsonString.length > maxSize) {
        const sortedFavorites = [...noThumbnailFavorites].sort((a, b) => b.createdAt - a.createdAt);
        
        // 逐步减少保留数量，直到数据大小合适
        let maxItems = 50;
        let trimmedFavorites = sortedFavorites.slice(0, maxItems);
        let trimmedJson = JSON.stringify(trimmedFavorites);
        
        while (trimmedJson.length > maxSize && maxItems > 10) {
          maxItems = Math.max(10, Math.floor(maxItems * 0.8));
          trimmedFavorites = sortedFavorites.slice(0, maxItems);
          trimmedJson = JSON.stringify(trimmedFavorites);
        }
        
        if (trimmedJson.length > maxSize) {
          // 最后尝试：只保留基本信息，移除所有可选字段
          trimmedFavorites = trimmedFavorites.map(fav => {
            if (fav.type === 'ai_workflow' && fav.aiWorkflow) {
              return {
                ...fav,
                aiWorkflow: {
                  id: fav.aiWorkflow.id,
                  name: fav.aiWorkflow.name,
                  url: fav.aiWorkflow.url,
                  // 移除 description, thumbnail, tags, category
                }
              };
            }
            return fav;
          });
          trimmedJson = JSON.stringify(trimmedFavorites);
        }
        
        jsonString = trimmedJson;
        console.warn(`已清理旧收藏项，仅保留最近的 ${trimmedFavorites.length} 个`);
      } else {
        console.warn('已移除所有缩略图以减小数据大小');
      }
    }
    
    // 最终保存
    localStorage.setItem(FAVORITES_STORAGE_KEY, jsonString);
    window.dispatchEvent(new CustomEvent('favoritesUpdated'));
  } catch (error: any) {
    if (error.name === 'QuotaExceededError' || error.message?.includes('quota')) {
      console.error('localStorage 配额超限，尝试清理旧数据');
      
      // 更激进的清理策略
      const sortedFavorites = [...favorites]
        .map(optimizeFavoriteItem)
        .map(fav => {
          // 移除所有可选字段
          if (fav.type === 'ai_workflow' && fav.aiWorkflow) {
            return {
              ...fav,
              aiWorkflow: {
                id: fav.aiWorkflow.id,
                name: fav.aiWorkflow.name,
                url: fav.aiWorkflow.url,
              }
            };
          }
          return fav;
        })
        .sort((a, b) => b.createdAt - a.createdAt);
      
      // 逐步减少数量
      let maxItems = 30;
      let success = false;
      
      while (maxItems >= 5 && !success) {
        const trimmedFavorites = sortedFavorites.slice(0, maxItems);
        try {
          localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(trimmedFavorites));
          console.warn(`已清理旧收藏项，仅保留最近的 ${maxItems} 个`);
          window.dispatchEvent(new CustomEvent('favoritesUpdated'));
          success = true;
        } catch (retryError) {
          maxItems = Math.max(5, Math.floor(maxItems * 0.7));
        }
      }
      
      if (!success) {
        console.error('清理后仍然无法保存，可能需要手动清理 localStorage');
        // 尝试清空并重新开始
        try {
          localStorage.removeItem(FAVORITES_STORAGE_KEY);
          console.warn('已清空收藏数据，请重新收藏');
        } catch (clearError) {
          console.error('无法清空收藏数据:', clearError);
        }
      }
    } else {
      console.error('保存收藏失败:', error);
      throw error;
    }
  }
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
