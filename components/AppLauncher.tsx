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

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      const filePath = (file as any).path || file.name;
      const fileName = file.name.toLowerCase();

      if (fileName.endsWith('.exe') || fileName.endsWith('.lnk') || fileName.endsWith('.bat')) {
        const appInfo = await handleDroppedAppFile(filePath);
        if (appInfo) {
          const icon = await getAppIcon(appInfo.path);
          const newApp: AppItem = {
            id: Date.now().toString(),
            name: appInfo.name,
            path: appInfo.path,
            icon: icon,
          };
          setApps([...apps, newApp]);
        }
      }
    }

    const textUriList = e.dataTransfer.getData('text/uri-list');
    const textPlain = e.dataTransfer.getData('text/plain');
    const text = textPlain || e.dataTransfer.getData('text');

    if (textUriList) {
      let filePath = textUriList.replace(/^file:\/\/\//, '');
      try {
        filePath = decodeURIComponent(filePath);
      } catch {
      }
      filePath = filePath.replaceAll(S_L, B_L);
      const lowerPath = filePath.toLowerCase();
      if (lowerPath.endsWith('.exe') || lowerPath.endsWith('.lnk') || lowerPath.endsWith('.bat')) {
        const appInfo = await handleDroppedAppFile(filePath);
        if (appInfo) {
          const icon = await getAppIcon(appInfo.path);
          const newApp: AppItem = {
            id: Date.now().toString(),
            name: appInfo.name,
            path: appInfo.path,
            icon: icon,
          };
          setApps([...apps, newApp]);
        }
      }
    }

    if (text) {
      const lowerText = text.toLowerCase();
      if (lowerText.endsWith('.exe') || lowerText.endsWith('.lnk') || lowerText.endsWith('.bat')) {
        const appInfo = await handleDroppedAppFile(text);
        if (appInfo) {
          const icon = await getAppIcon(appInfo.path);
          const newApp: AppItem = {
            id: Date.now().toString(),
            name: appInfo.name,
            path: appInfo.path,
            icon: icon,
          };
          setApps([...apps, newApp]);
        }
      }
    }
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
