import React, { useState, useEffect, useRef } from 'react';
import { Trash2, Plus, Grid3X3 } from 'lucide-react';
import { handleDroppedAppFile, launchApp, isAppFile } from '../services/appService';
import { useMiddleMouseScroll } from '../utils/useMiddleMouseScroll';

const S_L = '/';
const B_L = '\\';

interface AppItem {
  id: string;
  name: string;
  path: string;
  icon?: string;
}

const extractAppName = (filePath: string): string => {
  const separatorRegex = new RegExp('[\\\\/]', 'g');
  const fileName = filePath.split(separatorRegex).pop() || '';
  const extRegex = new RegExp('\\.(lnk|exe|bat)$', 'i');
  const nameWithoutExt = fileName.replace(extRegex, '');
  return nameWithoutExt || '未知应用';
};

const getAppIcon = async (appPath: string): Promise<string | undefined> => {
  if (typeof window === 'undefined' || !(window as any).__TAURI__) {
    return undefined;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/tauri');
    try {
      const icon = await invoke('get_app_icon', { path: appPath }) as string;
      return icon;
    } catch {
      return undefined;
    }
  } catch {
    return undefined;
  }
};

const AppLauncher: React.FC = () => {
  const [apps, setApps] = useState<AppItem[]>(() => {
    const saved = localStorage.getItem('arthub_apps');
    return saved ? JSON.parse(saved) : [];
  });

  const [columnsPerRow, setColumnsPerRow] = useState<number>(() => {
    const saved = localStorage.getItem('arthub_app_columns');
    return saved ? parseInt(saved, 10) : 4;
  });

  const [showColumnsMenu, setShowColumnsMenu] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const scrollContainerRef = useMiddleMouseScroll<HTMLDivElement>({
    enabled: true,
    scrollSpeed: 1.5
  });

  useEffect(() => {
    localStorage.setItem('arthub_apps', JSON.stringify(apps));
  }, [apps]);

  useEffect(() => {
    localStorage.setItem('arthub_app_columns', columnsPerRow.toString());
  }, [columnsPerRow]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) {
      setIsDraggingOver(false);
    }
  };

  // 检查路径是否是应用文件（通过扩展名）
  const isAppFilePath = (path: string): boolean => {
    if (!path) return false;
    const lowerPath = path.toLowerCase().trim();
    return lowerPath.endsWith('.exe') || lowerPath.endsWith('.lnk') || lowerPath.endsWith('.bat');
  };

  // 规范化文件路径（处理各种格式）
  const normalizeFilePath = (rawPath: string): string => {
    if (!rawPath) return '';
    
    // 处理 file:// URI
    let path = rawPath.replace(/^file:\/\//, '').replace(/^file:\/\/\//, '');
    
    // Windows 路径格式: file:///C:/path/to/file.exe -> C:/path/to/file.exe
    if (path.startsWith('/') && /^\/[A-Za-z]:/.test(path)) {
      path = path.substring(1);
    }
    
    // URL 解码
    try {
      path = decodeURIComponent(path);
    } catch {
      // 解码失败，使用原始路径
    }
    
    // 统一路径分隔符
    path = path.replaceAll(S_L, B_L);
    
    return path.trim();
  };

  // 从拖拽事件中提取所有可能的文件路径
  const extractPathsFromDropEvent = (e: React.DragEvent): string[] => {
    const paths: string[] = [];
    
    // 1. 从 files 数组提取
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const filePath = (file as any).path || (file as any).webkitRelativePath;
        if (filePath) {
          paths.push(normalizeFilePath(filePath));
        }
        // 也添加文件名（可能包含扩展名信息）
        if (file.name) {
          paths.push(file.name);
        }
      }
    }
    
    // 2. 从 text/uri-list 提取
    const textUriList = e.dataTransfer.getData('text/uri-list');
    if (textUriList) {
      const uriPaths = textUriList.split('\n').map(uri => normalizeFilePath(uri));
      paths.push(...uriPaths);
    }
    
    // 3. 从 text/plain 提取
    const textPlain = e.dataTransfer.getData('text/plain');
    if (textPlain) {
      const plainPaths = textPlain.split('\n').map(text => normalizeFilePath(text));
      paths.push(...plainPaths);
    }
    
    // 去重并过滤空值
    return [...new Set(paths)].filter(p => p.length > 0);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    console.log('[AppLauncher] Drop event:', {
      types: Array.from(e.dataTransfer.types),
      filesCount: e.dataTransfer.files.length,
    });

    // 提取所有可能的路径
    const allPaths = extractPathsFromDropEvent(e);
    console.log('[AppLauncher] Extracted paths:', allPaths);

    // 查找第一个应用文件路径
    let appFilePath: string | null = null;
    
    for (const path of allPaths) {
      // 检查是否是应用文件（通过扩展名）
      if (isAppFilePath(path)) {
        // 验证路径格式（必须是完整路径，不能只是文件名）
        if (path.includes(B_L) || path.match(/^[A-Za-z]:/)) {
          appFilePath = path;
          console.log('[AppLauncher] Found app file path:', appFilePath);
          break;
        }
      }
    }

    // 如果没有找到完整路径，尝试从文件名和 text/plain 组合
    if (!appFilePath) {
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        const file = files[0];
        const fileName = file.name.toLowerCase();
        
        if (fileName.endsWith('.exe') || fileName.endsWith('.lnk') || fileName.endsWith('.bat')) {
          // 尝试从 text/plain 获取完整路径
          const textPlain = e.dataTransfer.getData('text/plain');
          if (textPlain) {
            const plainPath = normalizeFilePath(textPlain);
            if (isAppFilePath(plainPath) && (plainPath.includes(B_L) || plainPath.match(/^[A-Za-z]:/))) {
              appFilePath = plainPath;
              console.log('[AppLauncher] Found app file path from text/plain:', appFilePath);
            }
          }
        }
      }
    }

    // 如果找到了应用文件路径，处理它
    if (appFilePath) {
      console.log('[AppLauncher] Processing app file:', appFilePath);
      
      // 验证文件是否存在（在 Tauri 环境中）
      if (typeof window !== 'undefined' && (window as any).__TAURI__) {
        try {
          const { exists } = await import('@tauri-apps/api/fs');
          const fileExists = await exists(appFilePath);
          if (!fileExists) {
            console.warn('[AppLauncher] File does not exist:', appFilePath);
            // 继续处理，可能路径格式有问题但文件实际存在
          }
        } catch (error) {
          console.warn('[AppLauncher] Failed to check file existence:', error);
          // 继续处理
        }
      }
      
      const appInfo = await handleDroppedAppFile(appFilePath);
      if (appInfo) {
        console.log('[AppLauncher] App info:', appInfo);
        const icon = await getAppIcon(appInfo.path);
        const newApp: AppItem = {
          id: Date.now().toString(),
          name: appInfo.name,
          path: appInfo.path,
          icon: icon,
        };
        setApps([...apps, newApp]);
        return;
      } else {
        console.error('[AppLauncher] handleDroppedAppFile returned null for:', appFilePath);
      }
    }

    console.warn('[AppLauncher] No valid app file found in drop event');
  };

  const handleLaunch = async (app: AppItem) => {
    try {
      await launchApp(app.path);
    } catch (error) {
      console.error('启动应用失败:', error);
    }
  };

  const handleDelete = (id: string) => {
    setApps(apps.filter(app => app.id !== id));
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0a0a0a]">
      <div className="flex items-center justify-between p-6 border-b border-[#1a1a1a] shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-white">常用应用</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setShowColumnsMenu(!showColumnsMenu)}
              className={'flex items-center gap-2 px-4 py-2.5 bg-[#1a1a1a] hover:bg-[#222222] text-[#a0a0a0] hover:text-white border border-[#2a2a2a] hover:border-[#3a3a3a] rounded-lg transition-colors duration-150'}
              title="设置列数"
            >
              <Grid3X3 size={18} />
              <span className="text-sm">{columnsPerRow}列</span>
            </button>
            {showColumnsMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowColumnsMenu(false)} />
                <div className={'absolute top-full right-0 mt-2 z-50 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg shadow-lg shadow-black' + S_L + '50 min-w-[120px] overflow-hidden'}>
                  {[2, 3, 4, 5, 6].map(cols => (
                    <button
                      key={cols}
                      onClick={() => {
                        setColumnsPerRow(cols);
                        setShowColumnsMenu(false);
                      }}
                      className={'w-full px-4 py-2.5 text-left text-sm transition-colors duration-150 ' + (columnsPerRow === cols ? 'bg-blue-500' + S_L + '20 text-blue-400' : 'text-[#a0a0a0] hover:bg-[#222222] hover:text-white')}
                    >
                      {cols} 列
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={'flex-1 min-h-0 max-h-full overflow-y-auto px-6 py-6 transition-colors duration-200 ' + (isDraggingOver ? 'bg-blue-500' + S_L + '10 border-2 border-dashed border-blue-500' : '')}
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#2a2a2a #0a0a0a', maxHeight: '100%' }}
      >
        {apps.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-full bg-[#1a1a1a] flex items-center justify-center mb-4">
              <Plus size={28} className="text-[#333333]" />
            </div>
            <h3 className="text-lg font-medium text-white mb-2">暂无应用</h3>
            <p className="text-[#666666] mb-6">拖入 .exe、.lnk 或 .bat 文件来添加应用</p>
          </div>
        ) : (
          <div className={'grid gap-4'} style={{ gridTemplateColumns: `repeat(${columnsPerRow}, minmax(0, 1fr))` }}>
            {apps.map((app) => (
              <div
                key={app.id}
                onClick={() => handleLaunch(app)}
                className={'group relative bg-[#1a1a1a] hover:bg-[#222222] border border-[#2a2a2a] hover:border-[#3a3a3a] rounded-xl p-4 flex flex-col items-center gap-3 cursor-pointer transition-all duration-150 hover:scale-105'}
              >
                <div className={'w-16 h-16 rounded-lg bg-[#0f0f0f] group-hover:bg-[#151515] transition-colors flex items-center justify-center overflow-hidden'}>
                  {app.icon ? (
                    <img src={app.icon} alt={app.name} className="w-full h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-[#666666]">
                      {app.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="flex-1 w-full text-center">
                  <h3 className={'text-sm font-medium text-white group-hover:text-blue-400 transition-colors break-words line-clamp-2'} title={app.name}>
                    {app.name}
                  </h3>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(app.id);
                  }}
                  className={'absolute top-2 right-2 p-1.5 rounded text-[#666666] hover:text-red-400 hover:bg-red-500' + S_L + '10 opacity-0 group-hover:opacity-100 transition-all'}
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AppLauncher;
