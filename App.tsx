import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { 
  Type, Menu, User, Settings, 
  Code, Home, CheckSquare, Grid3X3
} from 'lucide-react';
import { getStorageConfig, formatSyncTime } from './services/fileStorageService';
import { getUserInfo, clearUserInfo, UserInfo } from './services/userAuthService';
import { initAutoSync } from './utils/autoSync';
import { preloadAllData } from './services/preloadService';
import { initHotkey } from './services/hotkeyService';
import { ToastProvider } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Sidebar, MenuGroup } from './components/ui';
import { CURRENT_VERSION } from './services/updateService';
import { consoleService } from './services/consoleService';
import Console from './components/Console';
import ErrorNotification from './components/ErrorNotification';

// 懒加载组件以提升初始加载性能
const PathManager = lazy(() => import('./components/PathManager'));
const NamingTool = lazy(() => import('./components/NamingTool/index'));
const NamingHistory = lazy(() => import('./components/NamingHistory'));
const SettingsPanel = lazy(() => import('./components/SettingsPanel'));
const UserAuthModal = lazy(() => import('./components/UserAuthModal'));
const AITool = lazy(() => import('./components/AITool'));
const UpdateNotification = lazy(() => import('./components/UpdateNotification'));
const HomePage = lazy(() => import('./components/HomePage'));
const QuadrantTodo = lazy(() => import('./components/QuadrantTodo'));
const AppLauncher = lazy(() => import('./components/AppLauncher'));

// 预加载所有组件的函数
const preloadComponents = () => {
  // 使用 requestIdleCallback 在浏览器空闲时预加载，如果浏览器不支持则使用 setTimeout
  const schedulePreload = (callback: () => void, delay = 0) => {
    if (delay > 0) {
      setTimeout(() => {
        if ('requestIdleCallback' in window) {
          requestIdleCallback(callback, { timeout: 2000 });
        } else {
          callback();
        }
      }, delay);
    } else {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(callback, { timeout: 2000 });
      } else {
        setTimeout(callback, 100);
      }
    }
  };

  // 立即预加载主要页面组件（高优先级）
  schedulePreload(() => {
    import('./components/HomePage').catch(() => {});
  }, 0);

  schedulePreload(() => {
    import('./components/AITool').catch(() => {});
  }, 50);

  schedulePreload(() => {
    import('./components/PathManager').catch(() => {});
  }, 100);

  schedulePreload(() => {
    import('./components/NamingTool/index').catch(() => {});
  }, 150);

  schedulePreload(() => {
    import('./components/NamingHistory').catch(() => {});
  }, 200);

  // 预加载设置面板（提前加载，因为用户可能会快速打开设置）
  schedulePreload(() => {
    import('./components/SettingsPanel').catch(() => {});
    // 同时预加载设置面板依赖的服务
    import('./services/fileStorageService').catch(() => {});
    import('./services/translationService').catch(() => {});
  }, 250);

  // 预加载其他辅助组件（延迟更久，优先级较低）
  schedulePreload(() => {
    import('./components/UpdateNotification').catch(() => {});
  }, 600);
};

// 加载占位符组件
const LoadingPlaceholder = () => (
  <div className="flex items-center justify-center h-full bg-[#0a0a0a]">
    <div className="flex flex-col items-center gap-4">
      <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <span className="text-[#666666] text-sm">加载中...</span>
    </div>
  </div>
);

// 定义菜单项
const createMenuGroups = (): MenuGroup[] => [
  {
    items: [
      { id: 'home', label: '首页', icon: Home, draggable: false }, // 首页固定，不可拖动
    ],
  },
  {
    items: [
      { id: 'api', label: 'AI工作流', icon: Code },
      { id: 'naming', label: '资产命名', icon: Type },
      { id: 'paths', label: '常用入口', icon: Menu },
      { id: 'todo', label: '待办工作', icon: CheckSquare },
      { id: 'apps', label: '常用应用', icon: Grid3X3 },
    ],
  },
];

const App: React.FC = () => {
  // 默认显示首页
  const [activeTab, setActiveTab] = useState<string>('home');
  const [isUserVerified, setIsUserVerified] = useState(false);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const [currentPresetId, setCurrentPresetId] = useState<string>(() => {
    return localStorage.getItem('arthub_naming_preset') || 'fgui_card';
  });
  
  // 本地存储同步时间
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(() => {
    return getStorageConfig().lastSyncTime;
  });

  // 控制台显示状态（使用模态框，不打开新窗口）
  const [showConsole, setShowConsole] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState(consoleService.getLogs());

  // 订阅控制台日志更新
  useEffect(() => {
    const unsubscribe = consoleService.subscribe((logs) => {
      setConsoleLogs(logs);
    });
    return unsubscribe;
  }, []);

  // 打开控制台（切换显示状态）
  const openConsoleWindow = () => {
    setShowConsole(true);
  };

  // 监听打开控制台事件（从 ErrorNotification 触发）
  useEffect(() => {
    const handleOpenConsole = () => {
      openConsoleWindow();
    };
    window.addEventListener('open-console', handleOpenConsole);
    return () => {
      window.removeEventListener('open-console', handleOpenConsole);
    };
  }, []);

  // 菜单顺序管理
  const [menuItemOrder, setMenuItemOrder] = useState<Record<number, string[]>>(() => {
    const saved = localStorage.getItem('arthub_menu_item_order');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse menu item order:', e);
      }
    }
    return {};
  });

  // 应用菜单顺序
  const applyMenuOrder = (groups: MenuGroup[]): MenuGroup[] => {
    return groups.map((group, groupIndex) => {
      const order = menuItemOrder[groupIndex];
      if (!order || order.length === 0) {
        return group;
      }
      
      const orderedItems: MenuItem[] = [];
      const itemMap = new Map(group.items.map(item => [item.id, item]));
      
      // 按顺序添加存在的项目
      order.forEach(id => {
        const item = itemMap.get(id);
        if (item) {
          orderedItems.push(item);
          itemMap.delete(id);
        }
      });
      
      // 添加新项目（不在顺序中的）
      itemMap.forEach(item => orderedItems.push(item));
      
      return { ...group, items: orderedItems };
    });
  };

  const baseMenuGroups = createMenuGroups();
  const menuGroups = applyMenuOrder(baseMenuGroups);

  // 处理菜单项重新排序
  const handleMenuReorder = (groupId: number, fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    
    const group = baseMenuGroups[groupId];
    if (!group) return;
    
    const newOrder = [...(menuItemOrder[groupId] || group.items.map(item => item.id))];
    const [removed] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, removed);
    
    const updatedOrder = { ...menuItemOrder, [groupId]: newOrder };
    setMenuItemOrder(updatedOrder);
    localStorage.setItem('arthub_menu_item_order', JSON.stringify(updatedOrder));
  };

  // 监听存储配置变化，更新同步时间
  useEffect(() => {
    const updateSyncTime = () => {
      const config = getStorageConfig();
      setLastSyncTime(config.lastSyncTime);
    };
    
    // 立即更新
    updateSyncTime();
    
    // 监听localStorage变化
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'arthub_file_storage_config') {
        updateSyncTime();
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    
    // 定期更新同步时间
    const interval = setInterval(updateSyncTime, 1000);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  // 监听模板切换
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'arthub_naming_preset' && e.newValue) {
        setCurrentPresetId(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    
    const interval = setInterval(() => {
      const presetId = localStorage.getItem('arthub_naming_preset') || 'fgui_card';
      if (presetId !== currentPresetId) {
        setCurrentPresetId(presetId);
      }
    }, 500);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, [currentPresetId]);

  useEffect(() => {
    const loadData = async () => {
      // 先尝试从文件导入数据（如果已启用文件存储）
      try {
        const { autoImportFromFile } = await import('./services/fileStorageService');
        await autoImportFromFile();
      } catch (error) {
        // 静默处理导入错误
        console.warn('启动时导入文件数据失败:', error);
      }
      
      const savedUserInfo = getUserInfo();
      if (savedUserInfo) {
        setIsUserVerified(true);
        setUserInfo(savedUserInfo);
        // 用户验证通过后，开始预加载所有组件和数据
        preloadComponents();
        await preloadAllData();
      } else {
        // 即使没有用户信息，也预加载数据
        preloadComponents();
        await preloadAllData();
      }
    };
    
    loadData();
    initAutoSync();
    
    // 初始化全局快捷键（仅在 Tauri 环境中）
    if (typeof window !== 'undefined' && (window as any).__TAURI__) {
      initHotkey().catch((error) => {
        console.error('初始化快捷键失败:', error);
      });
    }
  }, []);

  // 监听打开设置事件（从命名工具的翻译提示触发）
  useEffect(() => {
    const handleOpenSettings = () => setShowSettings(true);
    window.addEventListener('openSettings', handleOpenSettings);
    return () => window.removeEventListener('openSettings', handleOpenSettings);
  }, []);

  // 监听键盘快捷键打开开发者工具（F12 或 Ctrl+Shift+I）
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // F12 或 Ctrl+Shift+I
      if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key === 'I')) {
        e.preventDefault();
        try {
          // 尝试使用 Tauri 命令打开开发者工具
          if (window.__TAURI__) {
            const { invoke } = await import('@tauri-apps/api/tauri');
            await invoke('open_devtools');
          } else {
            // 如果 Tauri API 不可用，尝试打开控制台模态框
            setShowConsole(true);
          }
        } catch (error) {
          console.error('无法打开开发者工具:', error);
          // 如果打开开发者工具失败，打开控制台模态框
          setShowConsole(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleUserVerified = () => {
    setIsUserVerified(true);
    const savedUserInfo = getUserInfo();
    if (savedUserInfo) {
      setUserInfo(savedUserInfo);
    }
    // 用户验证通过后，开始预加载所有组件和数据
    preloadComponents();
    preloadAllData();
  };

  const handleLogout = () => {
    try {
      clearUserInfo();
      setUserInfo(null);
      setIsUserVerified(false);
    } catch (error) {
      console.error('退出时出错:', error);
    }
  };

  // 处理菜单选择
  const handleMenuSelect = (id: string) => {
    // 将菜单 ID 映射到实际的标签
    const tabMapping: Record<string, string> = {
      'home': 'home',
      'naming': 'naming',
      'paths': 'paths',
      'api': 'ai',
      'todo': 'todo',
      'apps': 'apps',
    };
    setActiveTab(tabMapping[id] || 'home');
  };

  if (!isUserVerified) {
    return (
      <Suspense fallback={<LoadingPlaceholder />}>
        <UserAuthModal onVerified={handleUserVerified} />
      </Suspense>
    );
  }

  // 渲染主内容
  const renderContent = () => {
    switch (activeTab) {
      case 'home':
        return (
          <Suspense fallback={<LoadingPlaceholder />}>
            <HomePage />
          </Suspense>
        );
      case 'naming':
        return (
          <Suspense fallback={<LoadingPlaceholder />}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full p-6">
              <NamingTool />
              <div className="hidden lg:block">
                <NamingHistory />
              </div>
            </div>
          </Suspense>
        );
      case 'paths':
        return (
          <Suspense fallback={<LoadingPlaceholder />}>
            <PathManager />
          </Suspense>
        );
      case 'todo':
        return (
          <Suspense fallback={<LoadingPlaceholder />}>
            <QuadrantTodo />
          </Suspense>
        );
      case 'apps':
        return (
          <Suspense fallback={<LoadingPlaceholder />}>
            <AppLauncher />
          </Suspense>
        );
      default:
        return (
          <Suspense fallback={<LoadingPlaceholder />}>
            <AITool />
          </Suspense>
        );
    }
  };

  return (
    <ErrorBoundary>
      <ToastProvider>
        <div className="h-screen flex bg-[#0a0a0a] text-white overflow-hidden">
          {/* 左侧边栏 */}
          <Sidebar
            groups={menuGroups}
            activeId={activeTab}
            onSelect={handleMenuSelect}
            onReorder={handleMenuReorder}
            footer={
              <div className="space-y-2">
                {/* 设置和更新按钮行 */}
                <div className="flex items-center gap-2">
                  <button
                    ref={settingsButtonRef}
                    onClick={() => setShowSettings(!showSettings)}
                    className="
                      flex-1 flex items-center gap-3 px-3 py-2 rounded-lg
                      text-[#808080] hover:text-white hover:bg-[#151515]
                      transition-colors duration-150 text-sm
                    "
                  >
                    <Settings size={16} />
                    <span>设置</span>
                  </button>
                  <Suspense fallback={null}>
                    <UpdateNotification />
                  </Suspense>
                </div>

                {/* 用户信息和退出 */}
                {userInfo && (
                  <div className="
                    flex items-center justify-between px-3 py-2 
                    border-t border-[#1a1a1a] mt-2 pt-3
                  ">
                    <div className="flex items-center gap-2">
                      <User size={14} className="text-[#666666]" />
                      <span className="text-xs text-[#808080] truncate max-w-[100px]">
                        {userInfo.username}
                      </span>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="text-xs text-[#666666] hover:text-red-400 transition-colors"
                    >
                      退出
                    </button>
                  </div>
                )}

              </div>
            }
          />

          {/* 主内容区域 */}
          <main className="flex-1 flex flex-col overflow-hidden relative">
            {renderContent()}
            
            {/* 版本号和同步时间 - 显示在右下角 */}
            <div className="absolute bottom-0 right-0 px-4 py-2 z-0 pointer-events-none">
              <div className="flex items-center gap-2 text-[10px] text-[#333333] font-mono select-none">
                {lastSyncTime && (
                  <span>已同步.{formatSyncTime(lastSyncTime)}</span>
                )}
                <span>v{CURRENT_VERSION}</span>
              </div>
            </div>
          </main>

          {/* 设置面板 - 始终渲染以静默加载数据，但只在 showSettings 为 true 时显示 */}
          {/* 即使isOpen=false也渲染，这样组件会挂载并执行useEffect加载数据 */}
          <Suspense fallback={null}>
            <SettingsPanel 
              isOpen={showSettings} 
              onClose={() => setShowSettings(false)}
              triggerRef={settingsButtonRef}
            />
          </Suspense>

          {/* 控制台面板 - 在主窗口中显示，不打开新窗口 */}
          <Console
            isOpen={showConsole}
            onClose={() => setShowConsole(false)}
            logs={consoleLogs}
            onClear={() => consoleService.clearLogs()}
          />

          {/* 错误通知 - 右下角自动弹出 */}
          <ErrorNotification maxHeight={400} />
        </div>
      </ToastProvider>
    </ErrorBoundary>
  );
};

export default App;
