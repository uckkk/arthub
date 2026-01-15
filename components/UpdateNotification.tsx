/**
 * 更新提示组件
 * 显示红点和更新对话框
 */

import React, { useState, useEffect } from 'react';
import { Download, X, ExternalLink, RefreshCw, Bell } from 'lucide-react';
import {
  checkForUpdates,
  getPlatformDownloadUrl,
  saveLastCheckTime,
  shouldShowUpdate,
  ignoreVersion,
  CURRENT_VERSION,
} from '../services/updateService';
import { openUrlWithShell } from '../services/windowService';

interface UpdateNotificationProps {
  onHasUpdate?: (hasUpdate: boolean) => void;
}

const UpdateNotification: React.FC<UpdateNotificationProps> = ({ onHasUpdate }) => {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{
    latestVersion: string;
    releaseNotes: string;
    downloadUrl: string;
    publishedAt: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 检查更新
  const doCheckUpdate = async (showError = false) => {
    setIsChecking(true);
    setError(null);

    try {
      const result = await checkForUpdates();
      
      if (result.error && showError) {
        setError(result.error);
      }

      if (result.hasUpdate && result.releaseInfo) {
        const shouldShow = shouldShowUpdate(result.latestVersion!);
        setHasUpdate(shouldShow);
        onHasUpdate?.(shouldShow);
        
        if (shouldShow) {
          const downloadUrl = getPlatformDownloadUrl(result.releaseInfo);
          setUpdateInfo({
            latestVersion: result.latestVersion!,
            releaseNotes: result.releaseInfo.releaseNotes,
            downloadUrl: downloadUrl || result.releaseInfo.downloadUrl,
            publishedAt: result.releaseInfo.publishedAt,
          });
        }
      } else {
        setHasUpdate(false);
        onHasUpdate?.(false);
      }

      saveLastCheckTime();
    } catch (err) {
      if (showError) {
        setError('检查更新失败');
      }
    } finally {
      setIsChecking(false);
    }
  };

  // 启动时检查更新
  useEffect(() => {
    // 延迟 3 秒检查，避免影响启动速度
    const timer = setTimeout(() => {
      doCheckUpdate(false);
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  // 处理下载
  const handleDownload = async () => {
    if (updateInfo?.downloadUrl) {
      try {
        await openUrlWithShell(updateInfo.downloadUrl, true); // 使用精确匹配，因为下载URL通常每次都是唯一的
      } catch (error) {
        console.error('打开下载链接失败:', error);
      }
    }
    setShowModal(false);
  };

  // 忽略此版本
  const handleIgnore = () => {
    if (updateInfo?.latestVersion) {
      ignoreVersion(updateInfo.latestVersion);
      setHasUpdate(false);
      onHasUpdate?.(false);
    }
    setShowModal(false);
  };

  // 格式化日期
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <>
      {/* 更新按钮（带红点） */}
      <button
        onClick={() => setShowModal(true)}
        className="
          relative p-2 rounded-lg
          text-[#666666] hover:text-white hover:bg-[#151515]
          transition-colors
        "
        title={hasUpdate ? '有新版本可用' : '检查更新'}
      >
        <Bell size={16} />
        {hasUpdate && (
          <span className="
            absolute top-1 right-1
            w-2 h-2 rounded-full
            bg-red-500
            animate-pulse
          " />
        )}
      </button>

      {/* 更新模态框 */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setShowModal(false)}
        >
          <div
            className="
              w-full max-w-md mx-4
              bg-[#151515] border border-[#2a2a2a] rounded-xl
              shadow-2xl shadow-black/50
              animate-scale-in
            "
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <RefreshCw size={18} className={isChecking ? 'animate-spin' : ''} />
                软件更新
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-1.5 rounded-lg text-[#666666] hover:text-white hover:bg-[#252525] transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* 内容 */}
            <div className="p-6">
              {isChecking ? (
                <div className="flex flex-col items-center py-8">
                  <RefreshCw size={32} className="text-blue-400 animate-spin mb-4" />
                  <p className="text-[#808080]">正在检查更新...</p>
                </div>
              ) : error ? (
                <div className="text-center py-8">
                  <p className="text-red-400 mb-4">{error}</p>
                  <button
                    onClick={() => doCheckUpdate(true)}
                    className="px-4 py-2 bg-[#2a2a2a] hover:bg-[#3a3a3a] rounded-lg text-white transition-colors"
                  >
                    重试
                  </button>
                </div>
              ) : hasUpdate && updateInfo ? (
                <div className="space-y-4">
                  {/* 版本信息 */}
                  <div className="flex items-center justify-between p-4 bg-[#0f0f0f] rounded-lg">
                    <div>
                      <p className="text-sm text-[#808080]">当前版本</p>
                      <p className="text-white font-mono">v{CURRENT_VERSION}</p>
                    </div>
                    <div className="text-2xl text-[#444444]">→</div>
                    <div className="text-right">
                      <p className="text-sm text-[#808080]">最新版本</p>
                      <p className="text-green-400 font-mono font-semibold">
                        v{updateInfo.latestVersion}
                      </p>
                    </div>
                  </div>

                  {/* 发布日期 */}
                  <p className="text-sm text-[#666666]">
                    发布于 {formatDate(updateInfo.publishedAt)}
                  </p>

                  {/* 更新说明 */}
                  {updateInfo.releaseNotes && (
                    <div className="p-4 bg-[#0f0f0f] rounded-lg max-h-40 overflow-y-auto">
                      <p className="text-sm text-[#808080] mb-2">更新内容：</p>
                      <p className="text-sm text-[#a0a0a0] whitespace-pre-wrap">
                        {updateInfo.releaseNotes}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                    <Download size={28} className="text-green-400" />
                  </div>
                  <p className="text-white font-medium mb-2">已是最新版本</p>
                  <p className="text-sm text-[#666666]">当前版本：v{CURRENT_VERSION}</p>
                </div>
              )}
            </div>

            {/* 底部按钮 */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#2a2a2a]">
              {hasUpdate && updateInfo ? (
                <>
                  <button
                    onClick={handleIgnore}
                    className="
                      px-4 py-2.5 rounded-lg
                      bg-[#1a1a1a] border border-[#2a2a2a]
                      text-[#808080] hover:text-white hover:border-[#3a3a3a]
                      transition-colors text-sm
                    "
                  >
                    忽略此版本
                  </button>
                  <button
                    onClick={handleDownload}
                    className="
                      flex items-center gap-2 px-4 py-2.5 rounded-lg
                      bg-blue-600 hover:bg-blue-700
                      text-white font-medium text-sm
                      transition-colors
                    "
                  >
                    <ExternalLink size={16} />
                    前往下载
                  </button>
                </>
              ) : (
                <button
                  onClick={() => doCheckUpdate(true)}
                  disabled={isChecking}
                  className="
                    flex items-center gap-2 px-4 py-2.5 rounded-lg
                    bg-[#2a2a2a] hover:bg-[#3a3a3a]
                    text-white font-medium text-sm
                    transition-colors
                    disabled:opacity-50
                  "
                >
                  <RefreshCw size={16} className={isChecking ? 'animate-spin' : ''} />
                  检查更新
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default UpdateNotification;
