import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { 
  LayoutGrid, Type, Menu, User, Settings, 
  Image, Video, Mic, Box, Code, Star, HardDrive
} from 'lucide-react';
import { getStorageConfig, saveStorageConfig } from './services/fileStorageService';
import { getUserInfo, clearUserInfo, UserInfo } from './services/userAuthService';
import { initAutoSync } from './utils/autoSync';
import { ToastProvider } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Sidebar, MenuGroup } from './components/ui';

// 懒加载组件以提升初始加载性能
const PathManager = lazy(() => import('./components/PathManager'));
const NamingTool = lazy(() => import('./components/NamingTool/index'));
const NamingHistory = lazy(() => import('./components/NamingHistory'));
const SettingsPanel = lazy(() => import('./components/SettingsPanel'));
const UserAuthModal = lazy(() => import('./components/UserAuthModal'));
const AITool = lazy(() => import('./components/AITool'));

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
      { id: 'all', label: '所有模板', icon: LayoutGrid },
    ],
  },
  {
    title: '生成类型',
    items: [
      { id: 'favorites', label: '使用案例', icon: Star },
      { id: 'ai', label: '图像', icon: Image },
      { id: 'video', label: '视频', icon: Video },
      { id: 'audio', label: '音频', icon: Mic },
      { id: '3d', label: '3D模型', icon: Box },
    ],
  },
  {
    title: '工具',
    items: [
      { id: 'naming', label: '资产命名', icon: Type },
      { id: 'paths', label: '路径管理', icon: Menu },
      { id: 'api', label: 'AI盒子', icon: Code },
    ],
  },
];

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('ai');
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
    }
    initAutoSync();
  }, []);

  const handleUserVerified = () => {
    setIsUserVerified(true);
    const savedUserInfo = getUserInfo();
    if (savedUserInfo) {
      setUserInfo(savedUserInfo);
    }
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
    // 将多个 ID 映射到实际的标签
    const tabMapping: Record<string, string> = {
      'all': 'ai',
      'favorites': 'ai',
      'ai': 'ai',
      'video': 'ai',
      'audio': 'ai',
      '3d': 'ai',
      'naming': 'naming',
      'paths': 'paths',
      'api': 'ai',
    };
    setActiveTab(tabMapping[id] || 'ai');
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
            <div className="p-6">
              <PathManager />
            </div>
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
            activeId={activeTab === 'naming' ? 'naming' : activeTab === 'paths' ? 'paths' : 'ai'}
            onSelect={handleMenuSelect}
            footer={
              <div className="space-y-2">
                {/* 设置按钮 */}
                <button
                  ref={settingsButtonRef}
                  onClick={() => setShowSettings(!showSettings)}
                  className="
                    w-full flex items-center gap-3 px-3 py-2 rounded-lg
                    text-[#808080] hover:text-white hover:bg-[#151515]
                    transition-colors duration-150 text-sm
                  "
                >
                  <Settings size={16} />
                  <span>设置</span>
                </button>

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
              </div>
            }
          />

          {/* 主内容区域 */}
          <main className="flex-1 flex flex-col overflow-hidden">
            {renderContent()}
          </main>

          {/* 设置面板 */}
          {showSettings && (
            <Suspense fallback={<LoadingPlaceholder />}>
              <SettingsPanel 
                isOpen={showSettings} 
                onClose={() => setShowSettings(false)}
                triggerRef={settingsButtonRef}
              />
            </Suspense>
          )}
        </div>
      </ToastProvider>
    </ErrorBoundary>
  );
};

export default App;
