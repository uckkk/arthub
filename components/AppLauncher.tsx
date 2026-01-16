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

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    console.log('[AppLauncher] Drop event:', {
      types: Array.from(e.dataTransfer.types),
      filesCount: e.dataTransfer.files.length,
    });

    // 优先处理 text/uri-list（Windows 开始菜单拖拽常用）
    const textUriList = e.dataTransfer.getData('text/uri-list');
    if (textUriList) {
      console.log('[AppLauncher] text/uri-list:', textUriList);
      let filePath = textUriList.replace(/^file:\/\//, '').replace(/^file:\/\/\//, '');
      // Windows 路径格式: file:///C:/path/to/file.exe
      // 需要移除开头的斜杠
      if (filePath.startsWith('/') && /^\/[A-Za-z]:/.test(filePath)) {
        filePath = filePath.substring(1);
      }
      try {
        filePath = decodeURIComponent(filePath);
      } catch {
        // 解码失败，使用原始路径
      }
      filePath = filePath.replaceAll(S_L, B_L);
      const lowerPath = filePath.toLowerCase();
      console.log('[AppLauncher] Processed path from uri-list:', filePath);
      
      if (lowerPath.endsWith('.exe') || lowerPath.endsWith('.lnk') || lowerPath.endsWith('.bat')) {
        console.log('[AppLauncher] Detected app file:', filePath);
        const appInfo = await handleDroppedAppFile(filePath);
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
          console.warn('[AppLauncher] handleDroppedAppFile returned null for:', filePath);
        }
      }
    }

    // 处理 files 数组
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      const filePath = (file as any).path || (file as any).webkitRelativePath || file.name;
      const fileName = file.name.toLowerCase();
      
      console.log('[AppLauncher] File dropped:', {
        name: file.name,
        path: filePath,
        hasPath: !!(file as any).path,
      });

      if (fileName.endsWith('.exe') || fileName.endsWith('.lnk') || fileName.endsWith('.bat')) {
        // 如果只有文件名没有路径，尝试从 text/plain 获取完整路径
        let finalPath = filePath;
        if (!filePath.includes(B_L) && !filePath.includes(S_L) && !filePath.match(/^[A-Za-z]:/)) {
          const textPlain = e.dataTransfer.getData('text/plain');
          if (textPlain && (textPlain.includes(B_L) || textPlain.includes(S_L) || textPlain.match(/^[A-Za-z]:/))) {
            finalPath = textPlain.trim();
            console.log('[AppLauncher] Using path from text/plain:', finalPath);
          }
        }
        
        const appInfo = await handleDroppedAppFile(finalPath);
        if (appInfo) {
          console.log('[AppLauncher] App info from files:', appInfo);
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
          console.warn('[AppLauncher] handleDroppedAppFile returned null for:', finalPath);
        }
      }
    }

    // 最后尝试 text/plain
    const textPlain = e.dataTransfer.getData('text/plain');
    if (textPlain) {
      console.log('[AppLauncher] text/plain:', textPlain);
      const text = textPlain.trim();
      const lowerText = text.toLowerCase();
      
      // 检查是否是文件路径
      if ((text.includes(B_L) || text.includes(S_L) || text.match(/^[A-Za-z]:/)) && 
          (lowerText.endsWith('.exe') || lowerText.endsWith('.lnk') || lowerText.endsWith('.bat'))) {
        const cleanPath = text.replaceAll(S_L, B_L);
        console.log('[AppLauncher] Detected app file from text/plain:', cleanPath);
        const appInfo = await handleDroppedAppFile(cleanPath);
        if (appInfo) {
          console.log('[AppLauncher] App info from text/plain:', appInfo);
          const icon = await getAppIcon(appInfo.path);
          const newApp: AppItem = {
            id: Date.now().toString(),
            name: appInfo.name,
            path: appInfo.path,
            icon: icon,
          };
          setApps([...apps, newApp]);
          return;
        }
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
