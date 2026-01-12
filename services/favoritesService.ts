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

// 保存收藏列表
function saveFavorites(favorites: FavoriteItem[]): void {
  localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  window.dispatchEvent(new CustomEvent('favoritesUpdated'));
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
