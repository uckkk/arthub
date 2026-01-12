import React, { useState, useEffect, useMemo } from 'react';
import { 
  Star, Folder, Globe, Server, Sparkles, 
  X, Image as ImageIcon, Play
} from 'lucide-react';
import { FavoriteItem, getAllFavorites, removeFavorite } from '../services/favoritesService';
import { PathItem } from '../types';
import { Tag } from './ui';
import { useMiddleMouseScroll } from '../utils/useMiddleMouseScroll';

const HomePage: React.FC = () => {
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // 加载收藏列表
  useEffect(() => {
    const loadFavorites = () => {
      setFavorites(getAllFavorites());
    };
    
    loadFavorites();
    
    // 监听收藏更新事件
    const handleFavoritesUpdate = () => loadFavorites();
    window.addEventListener('favoritesUpdated', handleFavoritesUpdate);
    
    // 定期检查更新（用于跨标签页同步）
    const interval = setInterval(loadFavorites, 500);
    
    return () => {
      window.removeEventListener('favoritesUpdated', handleFavoritesUpdate);
      clearInterval(interval);
    };
  }, []);

  // 按类型分组收藏
  const groupedFavorites = useMemo(() => {
    const paths: FavoriteItem[] = [];
    const workflows: FavoriteItem[] = [];
    
    favorites.forEach(fav => {
      if (fav.type === 'path') {
        paths.push(fav);
      } else if (fav.type === 'ai_workflow') {
        workflows.push(fav);
      }
    });
    
    return { paths, workflows };
  }, [favorites]);

  // 处理路径跳转
  const handlePathJump = async (item: PathItem) => {
    try {
      if (item.type === 'web') {
        window.open(item.path, '_blank');
      } else if (item.type === 'local' || item.type === 'network') {
        try {
          const { open } = await import('@tauri-apps/api/shell');
          await open(item.path);
        } catch (shellError) {
          console.warn('shell.open failed, trying file:// protocol:', shellError);
          try {
            let pathToOpen = item.path;
            if (item.type === 'local') {
              pathToOpen = 'file:///' + item.path.replace(/\\/g, '/');
            } else {
              pathToOpen = 'file:' + item.path.replace(/\\/g, '/');
            }
            const w = window.open(pathToOpen);
            setTimeout(() => {
              if (!w || w.closed) {
                navigator.clipboard.writeText(item.path);
              }
            }, 100);
          } catch {
            navigator.clipboard.writeText(item.path);
          }
        }
      }
    } catch {
      navigator.clipboard.writeText(item.path);
    }
  };

  // 处理AI工作流打开
  const handleWorkflowOpen = async (workflow: FavoriteItem['aiWorkflow']) => {
    if (!workflow) return;
    
    try {
      const isTauri = typeof window !== 'undefined' && (window as any).__TAURI__;
      
      if (isTauri && workflow.url) {
        try {
          const { invoke } = await import('@tauri-apps/api/tauri');
          const { open } = await import('@tauri-apps/api/shell');
          
          // 这里可以添加JSON工作流注入逻辑（如果需要）
          await open(workflow.url);
        } catch (error) {
          console.error('Tauri error:', error);
          window.open(workflow.url, '_blank');
        }
      } else {
        window.open(workflow.url, '_blank');
      }
    } catch (error) {
      console.error('Failed to open workflow:', error);
    }
  };

  // 删除收藏
  const handleRemoveFavorite = (fav: FavoriteItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('确定要取消收藏吗？')) {
      const id = fav.type === 'path' ? fav.pathItem!.id : fav.aiWorkflow!.id;
      removeFavorite(fav.type, id);
      setFavorites(getAllFavorites());
    }
  };

  // 获取路径图标（紧凑尺寸）
  const getPathIcon = (type: PathItem['type']) => {
    switch (type) {
      case 'web': return <Globe size={16} className="text-cyan-400" />;
      case 'network': return <Server size={16} className="text-purple-400" />;
      case 'local': return <Folder size={16} className="text-orange-400" />;
    }
  };

  const totalCount = favorites.length;
  const pathsCount = groupedFavorites.paths.length;
  const workflowsCount = groupedFavorites.workflows.length;

  return (
    <div className="w-full h-full flex flex-col bg-[#0a0a0a]">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between p-6 border-b border-[#1a1a1a]">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#1a1a1a] rounded-lg">
            <Star size={20} className="text-yellow-400" fill="currentColor" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">首页</h2>
            <p className="text-sm text-[#666666]">
              我的收藏 ({totalCount})
            </p>
          </div>
        </div>
      </div>

      {/* 内容区域 */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-6"
        style={{ scrollbarWidth: 'thin' }}
      >
        {totalCount === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-20 h-20 rounded-full bg-[#1a1a1a] flex items-center justify-center mb-4">
              <Star size={32} className="text-[#333333]" />
            </div>
            <h3 className="text-lg font-medium text-white mb-2">还没有收藏</h3>
            <p className="text-[#666666] mb-6">
              在路径管理或AI盒子中收藏内容，它们会显示在这里
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* 快捷路径区域 - 紧凑标签式网格布局 */}
            {pathsCount > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Folder size={18} className="text-orange-400" />
                  <h3 className="text-base font-semibold text-white">快捷路径</h3>
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-[#1a1a1a] text-[#666666]">
                    {pathsCount}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                  {groupedFavorites.paths.map((fav) => {
                    const path = fav.pathItem!;
                    return (
                      <div
                        key={fav.id}
                        onMouseEnter={() => setHoveredId(fav.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        onClick={() => handlePathJump(path)}
                        className="
                          group relative
                          bg-[#1a1a1a] rounded-lg
                          border border-[#2a2a2a]
                          transition-all duration-150
                          hover:border-[#3a3a3a] hover:bg-[#1f1f1f]
                          hover:shadow-md hover:shadow-black/20
                          cursor-pointer
                          px-3 py-2.5
                          flex items-center gap-2.5
                          min-h-[56px]
                        "
                      >
                        {/* 图标 */}
                        <div className="shrink-0">
                          <div className="p-1.5 rounded-md bg-[#0f0f0f] group-hover:bg-[#151515] transition-colors">
                            {getPathIcon(path.type)}
                          </div>
                        </div>

                        {/* 内容区域 */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <h3 className="
                              text-[13px] font-medium text-white
                              truncate
                              group-hover:text-blue-400
                              transition-colors duration-150
                            ">
                              {path.name}
                            </h3>
                            {/* 收藏标识 */}
                            <Star size={11} className="text-yellow-400 fill-current shrink-0" />
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {path.group && (
                              <span className="
                                px-1.5 py-0.5 rounded text-[10px] font-medium
                                bg-blue-500/20 text-blue-400 border border-blue-500/30
                                shrink-0
                              ">
                                {path.group}
                              </span>
                            )}
                            <p className="
                              text-[11px] text-[#666666] font-mono
                              truncate flex-1 min-w-0
                            " title={path.path}>
                              {path.path}
                            </p>
                          </div>
                        </div>

                        {/* 删除按钮 */}
                        {hoveredId === fav.id && (
                          <button
                            onClick={(e) => handleRemoveFavorite(fav, e)}
                            className="
                              shrink-0
                              p-1 rounded-md
                              bg-[#2a2a2a] hover:bg-red-500/20
                              text-[#666666] hover:text-red-400
                              transition-colors duration-150
                              opacity-0 group-hover:opacity-100
                            "
                            title="取消收藏"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* AI工作流区域 */}
            {workflowsCount > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles size={18} className="text-blue-400" />
                  <h3 className="text-base font-semibold text-white">AI工作流</h3>
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-[#1a1a1a] text-[#666666]">
                    {workflowsCount}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                  {groupedFavorites.workflows.map((fav) => {
                    const workflow = fav.aiWorkflow!;
                    return (
                      <div
                        key={fav.id}
                        onMouseEnter={() => setHoveredId(fav.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        onClick={() => handleWorkflowOpen(workflow)}
                        className="
                          group relative
                          bg-[#1a1a1a] rounded-xl overflow-hidden
                          border border-[#2a2a2a]
                          transition-all duration-200
                          hover:border-[#3a3a3a] hover:bg-[#1f1f1f]
                          hover:shadow-lg hover:shadow-black/30
                          hover:-translate-y-0.5
                          cursor-pointer
                        "
                      >
                        {/* 收藏标识 */}
                        <div className="absolute top-3 right-3 z-10">
                          <div className="
                            p-1.5 rounded-lg
                            bg-yellow-500/20 backdrop-blur-sm
                            border border-yellow-500/30
                          ">
                            <Star size={14} className="text-yellow-400" fill="currentColor" />
                          </div>
                        </div>

                        {/* 缩略图区域 */}
                        <div className="relative aspect-[16/10] bg-[#0f0f0f] overflow-hidden">
                          {workflow.thumbnail ? (
                            <img
                              src={workflow.thumbnail}
                              alt={workflow.name}
                              className="
                                w-full h-full object-cover
                                transition-transform duration-300
                                group-hover:scale-105
                              "
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <ImageIcon size={48} className="text-[#333333]" />
                            </div>
                          )}

                          {/* 标签覆盖层 */}
                          {workflow.tags && workflow.tags.length > 0 && (
                            <div className="
                              absolute bottom-2 left-2 right-2
                              flex flex-wrap gap-1.5
                            ">
                              {workflow.tags.slice(0, 2).map((tag, index) => {
                                // 尝试匹配预定义的标签类型
                                let tagType: 'product' | 'api' | 'image' | 'video' | 'design' | 'workflow' | 'custom' = 'custom';
                                const tagLower = tag.toLowerCase();
                                if (tagLower.includes('product')) tagType = 'product';
                                else if (tagLower.includes('api')) tagType = 'api';
                                else if (tagLower.includes('image') || tagLower.includes('图片')) tagType = 'image';
                                else if (tagLower.includes('video') || tagLower.includes('视频')) tagType = 'video';
                                else if (tagLower.includes('design') || tagLower.includes('设计')) tagType = 'design';
                                else if (tagLower.includes('workflow') || tagLower.includes('工作流')) tagType = 'workflow';
                                
                                return (
                                  <Tag 
                                    key={index} 
                                    type={tagType}
                                    className="backdrop-blur-sm bg-opacity-90"
                                  >
                                    {tag}
                                  </Tag>
                                );
                              })}
                            </div>
                          )}

                          {/* 播放按钮悬浮层 */}
                          <div className="
                            absolute inset-0
                            flex items-center justify-center
                            bg-black/40 opacity-0 group-hover:opacity-100
                            transition-opacity duration-200
                          ">
                            <div className="
                              w-12 h-12 rounded-full
                              bg-white/20 backdrop-blur-sm
                              flex items-center justify-center
                              border border-white/30
                            ">
                              <Play size={24} className="text-white ml-1" fill="white" />
                            </div>
                          </div>
                        </div>

                        {/* 内容区域 */}
                        <div className="p-4">
                          <h3 className="
                            text-[15px] font-medium text-white
                            line-clamp-1 mb-1.5
                            group-hover:text-blue-400
                            transition-colors duration-150
                          ">
                            {workflow.name}
                          </h3>
                          {workflow.description && (
                            <p className="
                              text-[13px] text-[#808080]
                              line-clamp-2
                              leading-relaxed
                            ">
                              {workflow.description}
                            </p>
                          )}
                          {workflow.category && (
                            <div className="mt-2">
                              <span className="
                                px-2 py-0.5 rounded text-[10px] font-medium
                                bg-blue-500/20 text-blue-400 border border-blue-500/30
                              ">
                                {workflow.category}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* 删除按钮 */}
                        {hoveredId === fav.id && (
                          <button
                            onClick={(e) => handleRemoveFavorite(fav, e)}
                            className="
                              absolute top-3 left-3 z-10
                              p-1.5 rounded-lg
                              bg-black/60 backdrop-blur-sm
                              text-red-400 hover:bg-red-500/30 hover:text-red-300
                              transition-colors duration-150
                              opacity-0 group-hover:opacity-100
                            "
                            title="取消收藏"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default HomePage;
