import React, { useState, useEffect, useRef } from 'react';
import { Settings, Save, ExternalLink, AlertCircle, PlayCircle, Loader2, Folder, X } from 'lucide-react';
import { testApiConnection } from '../services/translationService';
import { 
  isTauriEnvironment, 
  selectStorageDirectory,
  getStorageConfig,
  saveStorageConfig,
  formatSyncTime,
  getSavedStoragePath,
  autoSyncToFile
} from '../services/fileStorageService';
import { Input } from './common';
import { getSavedHotkey, registerHotkey, validateHotkey, isRegistered } from '../services/hotkeyService';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLButtonElement>;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, onClose, triggerRef }) => {
  const [activeGroup, setActiveGroup] = useState<'api' | 'storage' | 'hotkey'>('api');
  
  // API 配置状态
  const [geminiKey, setGeminiKey] = useState('');
  const [baiduAppId, setBaiduAppId] = useState('');
  const [baiduSecret, setBaiduSecret] = useState('');
  
  // 存储配置状态
  const [storageEnabled, setStorageEnabled] = useState(false);
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
  
  // 快捷键配置状态
  const [hotkey, setHotkey] = useState('');
  const [isRegisteringHotkey, setIsRegisteringHotkey] = useState(false);
  
  const [statusMsg, setStatusMsg] = useState<{type: 'success' | 'error' | 'info', text: string} | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // 静默加载设置数据（即使面板未打开也加载）
  useEffect(() => {
    // 立即加载所有设置数据
    const loadSettings = () => {
      setGeminiKey(localStorage.getItem('arthub_gemini_key') || '');
      setBaiduAppId(localStorage.getItem('arthub_baidu_appid') || '');
      setBaiduSecret(localStorage.getItem('arthub_baidu_secret') || '');
      
      const config = getStorageConfig();
      setStorageEnabled(config.enabled);
      setSelectedDirectory(config.directoryPath);
      setLastSyncTime(config.lastSyncTime);
      
      // 加载快捷键配置
      setHotkey(getSavedHotkey());
      
      if (config.enabled) {
        getSavedStoragePath().then(path => {
          if (path) {
            setSelectedDirectory(path);
          }
        }).catch(() => {});
      }
    };
    
    // 立即加载
    loadSettings();
    
    // 监听localStorage变化（仅在其他标签页或窗口修改时触发）
    const handleStorageChange = (e: StorageEvent) => {
      // 只响应其他窗口/标签页的变化，避免覆盖用户正在输入的内容
      if (e.key === 'arthub_gemini_key' || e.key === 'arthub_baidu_appid' || e.key === 'arthub_baidu_secret') {
        // 只在输入框没有焦点时更新（避免覆盖用户正在输入的内容）
        const activeElement = document.activeElement;
        const isInputFocused = activeElement && (
          activeElement.tagName === 'INPUT' || 
          activeElement.tagName === 'TEXTAREA'
        );
        
        if (!isInputFocused) {
          loadSettings();
        }
      } else if (e.key === 'arthub_file_storage_config') {
        // 存储配置变化时总是更新
        const config = getStorageConfig();
        setStorageEnabled(config.enabled);
        setSelectedDirectory(config.directoryPath);
        setLastSyncTime(config.lastSyncTime);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    
    // 定期更新同步时间（但不更新输入框状态，避免覆盖用户输入）
    const interval = setInterval(() => {
      const currentConfig = getStorageConfig();
      setLastSyncTime(currentConfig.lastSyncTime);
      // 注意：不再更新输入框状态，避免覆盖用户正在输入的内容
    }, 1000); // 每秒更新一次同步时间
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []); // 组件挂载时立即加载，不依赖 isOpen

  const showStatus = (type: 'success' | 'error' | 'info', text: string) => {
    setStatusMsg({ type, text });
    setTimeout(() => setStatusMsg(null), 3000);
  };

  const handleSave = () => {
    localStorage.setItem('arthub_gemini_key', geminiKey.trim());
    localStorage.setItem('arthub_baidu_appid', baiduAppId.trim());
    localStorage.setItem('arthub_baidu_secret', baiduSecret.trim());
    localStorage.removeItem('arthub_translation_service');
    showStatus('success', 'API 配置已保存');
  };

  useEffect(() => {
    if (activeGroup === 'storage') {
      saveStorageConfig({ 
        enabled: storageEnabled,
        directoryPath: selectedDirectory,
        lastSyncTime: lastSyncTime
      });
    }
  }, [storageEnabled, selectedDirectory, lastSyncTime, activeGroup]);

  const handleSelectDirectory = async () => {
    try {
      const result = await selectStorageDirectory();
      if (result) {
        setSelectedDirectory(result.path);
        await autoSyncToFile();
        const config = getStorageConfig();
        setLastSyncTime(config.lastSyncTime);
        showStatus('success', `已选择目录: ${result.path}`);
      }
    } catch (error: any) {
      showStatus('error', error.message || '选择目录失败');
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setStatusMsg(null);
    
    const baiduConfig = (baiduAppId && baiduSecret) ? { appId: baiduAppId, secretKey: baiduSecret } : undefined;
    
    try {
      const result = await testApiConnection(geminiKey || undefined, baiduConfig);
      if (result.success) {
        showStatus('success', result.message);
      } else {
        showStatus('error', result.message);
      }
    } catch {
      showStatus('error', '测试过程中发生未知错误');
    } finally {
      setIsTesting(false);
    }
  };

  const panelRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        panelRef.current && 
        !panelRef.current.contains(target) &&
        triggerRef?.current &&
        !triggerRef.current.contains(target)
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose, triggerRef]);

  // 即使面板未打开也渲染（静默加载数据），但隐藏显示
  // 这样useEffect会在组件挂载时立即执行，加载数据
  if (!isOpen) {
    // 返回一个隐藏的div，保持组件挂载状态
    return <div style={{ display: 'none' }} />;
  }

  return (
    <>
      {/* 遮罩层 */}
      <div 
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* 设置面板 - 居中显示 */}
      <div 
        ref={panelRef}
        className="
          fixed z-50 
          top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-[420px] max-w-[90vw]
          bg-[#151515] border border-[#2a2a2a] rounded-xl 
          shadow-2xl shadow-black/50 
          overflow-hidden
          animate-scale-in
        "
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2a]">
          <div className="flex items-center gap-3">
            <Settings size={18} className="text-blue-400" />
            <h3 className="font-semibold text-white">系统设置</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#666666] hover:text-white hover:bg-[#252525] transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        
        {/* 分组切换 */}
        <div className="flex gap-2 px-5 py-3 border-b border-[#2a2a2a]">
          <button
            onClick={() => setActiveGroup('api')}
            className={`
              flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors
              ${activeGroup === 'api'
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                : 'bg-[#1a1a1a] text-[#808080] border border-[#2a2a2a] hover:border-[#3a3a3a]'
              }
            `}
          >
            翻译 API
          </button>
          <button
            onClick={() => setActiveGroup('storage')}
            className={`
              flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors
              ${activeGroup === 'storage'
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                : 'bg-[#1a1a1a] text-[#808080] border border-[#2a2a2a] hover:border-[#3a3a3a]'
              }
            `}
          >
            本地存储
          </button>
          <button
            onClick={() => setActiveGroup('hotkey')}
            className={`
              flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors
              ${activeGroup === 'hotkey'
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                : 'bg-[#1a1a1a] text-[#808080] border border-[#2a2a2a] hover:border-[#3a3a3a]'
              }
            `}
          >
            快捷键
          </button>
        </div>
        
        {/* 内容区域 */}
        <div className="p-5 space-y-5 max-h-[60vh] overflow-y-auto">
          {/* 组1：翻译 API 配置 */}
          {activeGroup === 'api' && (
            <>
              {/* Gemini Section */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-[#a0a0a0]">Google Gemini API</label>
                  <a 
                    href="https://aistudio.google.com/app/apikey" 
                    target="_blank" 
                    rel="noreferrer" 
                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                  >
                    申请 Key <ExternalLink size={10} />
                  </a>
                </div>
                <Input
                  type="password"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder="AI Studio API Key"
                />
              </div>

              <div className="h-px bg-[#2a2a2a]"></div>

              {/* Baidu Section */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-[#a0a0a0]">百度翻译 API</label>
                  <a 
                    href="https://api.fanyi.baidu.com/manage/developer" 
                    target="_blank" 
                    rel="noreferrer" 
                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                  >
                    申请 ID <ExternalLink size={10} />
                  </a>
                </div>
                <div className="space-y-2">
                  <Input
                    type="text"
                    value={baiduAppId}
                    onChange={(e) => setBaiduAppId(e.target.value)}
                    placeholder="APP ID"
                  />
                  <Input
                    type="password"
                    value={baiduSecret}
                    onChange={(e) => setBaiduSecret(e.target.value)}
                    placeholder="密钥 (Secret Key)"
                  />
                </div>
              </div>

              <div className="
                p-3 rounded-lg
                bg-blue-500/10 border border-blue-500/20
                text-xs text-blue-300
                flex gap-2
              ">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <p>优先使用 Gemini，失败时自动降级到百度翻译。</p>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={handleTest}
                  disabled={isTesting}
                  className="
                    flex-1 py-2.5 rounded-lg
                    bg-[#1a1a1a] border border-[#2a2a2a]
                    text-[#a0a0a0] hover:text-white hover:border-[#3a3a3a]
                    text-sm font-medium
                    flex items-center justify-center gap-2
                    transition-colors
                    disabled:opacity-50
                  "
                >
                  {isTesting ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}
                  测试连接
                </button>
                <button 
                  onClick={handleSave}
                  className="
                    flex-1 py-2.5 rounded-lg
                    bg-blue-600 hover:bg-blue-700
                    text-white text-sm font-medium
                    flex items-center justify-center gap-2
                    transition-colors
                  "
                >
                  <Save size={16} /> 保存
                </button>
              </div>
            </>
          )}

          {/* 组2：本地存储路径设置 */}
          {activeGroup === 'storage' && (
            <>
              {!isTauriEnvironment() && (
                <div className="
                  p-3 rounded-lg
                  bg-yellow-500/10 border border-yellow-500/20
                  text-xs text-yellow-300
                ">
                  <p>此功能仅在桌面应用中可用</p>
                </div>
              )}

              {isTauriEnvironment() && (
                <div className="space-y-4">
                  {/* 启用开关 */}
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-[#a0a0a0]">启用文件存储</label>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={storageEnabled}
                        onChange={(e) => setStorageEnabled(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="
                        w-11 h-6 rounded-full
                        bg-[#2a2a2a] peer-checked:bg-blue-600
                        peer-focus:outline-none
                        after:content-[''] after:absolute after:top-[2px] after:left-[2px]
                        after:bg-white after:rounded-full after:h-5 after:w-5
                        after:transition-all
                        peer-checked:after:translate-x-full
                      "></div>
                    </label>
                  </div>

                  {/* 路径选择 */}
                  {storageEnabled && (
                    <div className="space-y-3">
                      <button
                        onClick={handleSelectDirectory}
                        className="
                          w-full p-4 rounded-lg text-left
                          bg-[#0f0f0f] border border-[#2a2a2a]
                          hover:bg-[#1a1a1a] hover:border-blue-500/50
                          transition-all group
                        "
                      >
                        <div className="flex items-start gap-3">
                          <Folder 
                            size={20} 
                            className="text-[#666666] group-hover:text-blue-400 transition-colors mt-0.5 shrink-0" 
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-[#666666] mb-1.5">
                              {selectedDirectory ? '存储路径' : '选择存储路径'}
                            </div>
                            {selectedDirectory ? (
                              <div className="text-sm text-[#e0e0e0] break-all font-mono leading-relaxed">
                                {selectedDirectory}
                              </div>
                            ) : (
                              <div className="text-sm text-[#555555]">点击选择目录</div>
                            )}
                          </div>
                        </div>
                      </button>
                      
                      {/* 同步时间 */}
                      {selectedDirectory && (
                        <div className="text-center">
                          <div className="text-xs text-[#555555]">
                            {formatSyncTime(lastSyncTime)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* 组3：快捷键设置 */}
          {activeGroup === 'hotkey' && (
            <>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#a0a0a0]">主窗口呼出快捷键</label>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      value={hotkey}
                      onChange={(e) => setHotkey(e.target.value)}
                      placeholder="例如: Ctrl+Alt+H"
                      onKeyDown={(e) => {
                        // 阻止默认行为，捕获按键组合
                        e.preventDefault();
                        const parts: string[] = [];
                        if (e.ctrlKey) parts.push('Ctrl');
                        if (e.altKey) parts.push('Alt');
                        if (e.shiftKey) parts.push('Shift');
                        if (e.metaKey) parts.push('Meta');
                        
                        // 获取按键名称
                        let key = e.key;
                        if (key === ' ') key = 'Space';
                        if (key.length === 1 && key.match(/[a-zA-Z0-9]/)) {
                          key = key.toUpperCase();
                        }
                        
                        if (key && !['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
                          parts.push(key);
                          const newHotkey = parts.join('+');
                          setHotkey(newHotkey);
                        }
                      }}
                    />
                    <button
                      onClick={async () => {
                        setIsRegisteringHotkey(true);
                        setStatusMsg(null);
                        
                        // 验证快捷键格式
                        const validation = validateHotkey(hotkey);
                        if (!validation.valid) {
                          showStatus('error', validation.error || '快捷键格式不正确');
                          setIsRegisteringHotkey(false);
                          return;
                        }

                        try {
                          // 检查快捷键是否已被注册
                          const alreadyRegistered = await isRegistered(hotkey);
                          if (alreadyRegistered) {
                            showStatus('error', '该快捷键已被其他程序使用');
                            setIsRegisteringHotkey(false);
                            return;
                          }

                          // 注册快捷键
                          const success = await registerHotkey(hotkey);
                          if (success) {
                            showStatus('success', `快捷键已设置: ${hotkey}`);
                          } else {
                            showStatus('error', '快捷键设置失败');
                          }
                        } catch (error: any) {
                          showStatus('error', error.message || '快捷键设置失败');
                        } finally {
                          setIsRegisteringHotkey(false);
                        }
                      }}
                      disabled={isRegisteringHotkey || !hotkey.trim()}
                      className="
                        px-4 py-2 rounded-lg
                        bg-blue-600 hover:bg-blue-700 disabled:bg-[#2a2a2a] disabled:opacity-50
                        text-white text-sm font-medium
                        transition-colors
                        whitespace-nowrap
                      "
                    >
                      {isRegisteringHotkey ? '设置中...' : '保存'}
                    </button>
                  </div>
                  <div className="text-xs text-[#666666]">
                    在输入框中按下快捷键组合即可设置。例如：Ctrl+Alt+H
                  </div>
                </div>

                <div className="
                  p-3 rounded-lg
                  bg-blue-500/10 border border-blue-500/20
                  text-xs text-blue-300
                ">
                  <p>• 快捷键可以在应用隐藏时呼出主界面</p>
                  <p>• 主界面显示时按快捷键可以隐藏窗口</p>
                  <p>• 呼出时主界面会自动置顶</p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* 状态提示 */}
        {statusMsg && (
          <div className={`
            mx-5 mb-5 p-3 rounded-lg text-sm
            ${statusMsg.type === 'success' 
              ? 'bg-green-500/10 border border-green-500/20 text-green-400' 
              : 'bg-red-500/10 border border-red-500/20 text-red-400'
            }
          `}>
            {statusMsg.text}
          </div>
        )}
      </div>
    </>
  );
};

export default SettingsPanel;
