import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { 
  Type, Menu, User, Settings, 
  Code, HardDrive, Home
} from 'lucide-react';
import { getStorageConfig, saveStorageConfig } from './services/fileStorageService';
import { getUserInfo, clearUserInfo, UserInfo } from './services/userAuthService';
import { initAutoSync } from './utils/autoSync';
import { preloadAllData } from './services/preloadService';
import { ToastProvider } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Sidebar, MenuGroup } from './components/ui';
import { CURRENT_VERSION } from './services/updateService';
import { consoleService } from './services/consoleService';
import Console from './components/Console';

// 懒加载组件以提升初始加载性能
const PathManager = lazy(() => import('./components/PathManager'));
const NamingTool = lazy(() => import('./components/NamingTool/index'));
const NamingHistory = lazy(() => import('./components/NamingHistory'));
const SettingsPanel = lazy(() => import('./components/SettingsPanel'));
const UserAuthModal = lazy(() => import('./components/UserAuthModal'));
const AITool = lazy(() => import('./components/AITool'));
const UpdateNotification = lazy(() => import('./components/UpdateNotification'));
const HomePage = lazy(() => import('./components/HomePage'));

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
      { id: 'home', label: '首页', icon: Home },
    ],
  },
  {
    title: '常用工具',
    items: [
      { id: 'api', label: 'AI盒子', icon: Code },
      { id: 'naming', label: '资产命名', icon: Type },
      { id: 'paths', label: '路径管理', icon: Menu },
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
  
  // 本地存储开关状态
  const [storageEnabled, setStorageEnabled] = useState(() => {
    return getStorageConfig().enabled;
  });

  // 版本号点击状态
  const [versionClickCount, setVersionClickCount] = useState(0);
  const versionClickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
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

  // 处理版本号点击
  const handleVersionClick = () => {
    // 清除之前的超时
    if (versionClickTimeoutRef.current) {
      clearTimeout(versionClickTimeoutRef.current);
    }

    // 增加点击计数
    const newCount = versionClickCount + 1;
    setVersionClickCount(newCount);

    // 如果达到5次，打开控制台窗口
    if (newCount >= 5) {
      openConsoleWindow();
      setVersionClickCount(0);
    } else {
      // 设置超时，如果2秒内没有继续点击，重置计数
      versionClickTimeoutRef.current = setTimeout(() => {
        setVersionClickCount(0);
      }, 2000);
    }
  };

  // 清理超时
  useEffect(() => {
    return () => {
      if (versionClickTimeoutRef.current) {
        clearTimeout(versionClickTimeoutRef.current);
      }
    };
  }, []);

  const menuGroups = createMenuGroups();

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
    const savedUserInfo = getUserInfo();
    if (savedUserInfo) {
      setIsUserVerified(true);
      setUserInfo(savedUserInfo);
      // 用户验证通过后，开始预加载所有组件和数据
      preloadComponents();
      preloadAllData();
    }
    initAutoSync();
  }, []);

  // 监听打开设置事件（从命名工具的翻译提示触发）
  useEffect(() => {
    const handleOpenSettings = () => setShowSettings(true);
    window.addEventListener('openSettings', handleOpenSettings);
    return () => window.removeEventListener('openSettings', handleOpenSettings);
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

                {/* 本地存储快捷开关 */}
                <div className="
                  flex items-center justify-between px-3 py-2 rounded-lg
                  bg-[#0a0a0a] border border-[#1a1a1a]
                ">
                  <div className="flex items-center gap-2">
                    <HardDrive size={14} className="text-[#666666]" />
                    <span className="text-xs text-[#808080]">本地存储</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={storageEnabled}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        setStorageEnabled(enabled);
                        const config = getStorageConfig();
                        saveStorageConfig({ ...config, enabled });
                      }}
                      className="sr-only peer"
                    />
                    <div className="
                      w-8 h-4 rounded-full
                      bg-[#2a2a2a] peer-checked:bg-blue-600
                      after:content-[''] after:absolute after:top-[2px] after:left-[2px]
                      after:bg-white after:rounded-full after:h-3 after:w-3
                      after:transition-all
                      peer-checked:after:translate-x-4
                    "></div>
                  </label>
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

                {/* 版本号 - 显示在左下角，很弱的样式，连续点击5次打开控制台 */}
                <div className="px-3 py-1.5 border-t border-[#1a1a1a] mt-2">
                  <span 
                    onClick={handleVersionClick}
                    className="text-[10px] text-[#333333] font-mono cursor-pointer hover:text-[#555555] transition-colors select-none"
                    title="连续点击5次打开控制台"
                  >
                    v{CURRENT_VERSION}
                  </span>
                </div>
              </div>
            }
          />

          {/* 主内容区域 */}
          <main className="flex-1 flex flex-col overflow-hidden">
            {renderContent()}
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
        </div>
      </ToastProvider>
    </ErrorBoundary>
  );
};

export default App;
