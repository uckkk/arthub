/**
 * 错误通知组件
 * 右下角显示小图标+角标，点击展开错误详情面板
 */

import React, { useState, useEffect, useRef } from 'react';
import { X, Copy, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { consoleService } from '../services/consoleService';
import { LogEntry } from './Console';

interface ErrorNotificationProps {
  maxHeight?: number;
}

const ErrorNotification: React.FC<ErrorNotificationProps> = ({
  maxHeight = 400,
}) => {
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [errorLogs, setErrorLogs] = useState<LogEntry[]>([]);
  const [seenCount, setSeenCount] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = consoleService.subscribe((logs) => {
      const errors = logs.filter(log => log.type === 'error' || log.type === 'warn');
      setErrorLogs(errors);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isPanelOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isPanelOpen]);

  const newCount = Math.max(0, errorLogs.length - seenCount);

  const formatError = (log: LogEntry): string => {
    let message = log.message;
    if (log.args && log.args.length > 0) {
      try {
        const argsStr = log.args.map(arg =>
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');
        message += ' ' + argsStr;
      } catch {
        message += ' [无法序列化参数]';
      }
    }
    return message;
  };

  const copyError = (log: LogEntry) => {
    const time = new Date(log.timestamp).toLocaleTimeString('zh-CN', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
      fractionalSecondDigits: 3,
    });
    const typeLabel = log.type === 'error' ? 'ERROR' : 'WARN';
    navigator.clipboard.writeText(`[${time}] [${typeLabel}] ${formatError(log)}`).catch(() => {});
  };

  const copyAllErrors = () => {
    const text = errorLogs.map(log => {
      const time = new Date(log.timestamp).toLocaleTimeString('zh-CN', {
        hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
        fractionalSecondDigits: 3,
      });
      const typeLabel = log.type === 'error' ? 'ERROR' : 'WARN';
      return `[${time}] [${typeLabel}] ${formatError(log)}`;
    }).join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const togglePanel = () => {
    const willOpen = !isPanelOpen;
    setIsPanelOpen(willOpen);
    if (willOpen) {
      setSeenCount(errorLogs.length);
    }
  };

  if (errorLogs.length === 0) return null;

  const latestError = errorLogs[errorLogs.length - 1];
  const displayErrors = isExpanded ? errorLogs.slice(-5) : [latestError];

  return (
    <div ref={panelRef} className="fixed bottom-4 right-4 z-[9999]">
      {/* 折叠态：小图标 + 角标 */}
      {!isPanelOpen && (
        <button
          onClick={togglePanel}
          className="
            relative w-10 h-10 rounded-full flex items-center justify-center
            bg-[#1a1a1a] border border-red-500/30 shadow-lg shadow-black/40
            hover:bg-[#252525] hover:border-red-500/50 transition-colors
          "
          title={`${errorLogs.length} 条错误/警告`}
        >
          <AlertCircle size={18} className="text-red-400" />
          {newCount > 0 && (
            <span className="
              absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px]
              flex items-center justify-center
              rounded-full bg-red-500 text-white text-[10px] font-bold px-1
            ">
              {newCount > 99 ? '99+' : newCount}
            </span>
          )}
        </button>
      )}

      {/* 展开态：详情面板 */}
      {isPanelOpen && (
        <div className="animate-slide-up">
          <div className="
            bg-[#1a1a1a] border border-red-500/30 rounded-lg
            shadow-2xl shadow-black/50
            w-[400px] max-w-[calc(100vw-2rem)]
            overflow-hidden
          ">
            {/* 标题栏 */}
            <div className="
              flex items-center justify-between px-4 py-3
              bg-red-500/10 border-b border-red-500/20
            ">
              <div className="flex items-center gap-2">
                <AlertCircle size={18} className="text-red-400" />
                <span className="text-sm font-semibold text-white">错误通知</span>
                <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-[#2a2a2a] text-[#666]">
                  {errorLogs.length} 条
                </span>
              </div>
              <div className="flex items-center gap-1">
                {errorLogs.length > 1 && (
                  <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="p-1 rounded text-[#666] hover:text-white hover:bg-[#252525] transition-colors"
                    title={isExpanded ? '收起' : '展开'}
                  >
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                  </button>
                )}
                <button
                  onClick={copyAllErrors}
                  className="p-1 rounded text-[#666] hover:text-white hover:bg-[#252525] transition-colors"
                  title="复制所有错误"
                >
                  <Copy size={16} />
                </button>
                <button
                  onClick={() => setIsPanelOpen(false)}
                  className="p-1 rounded text-[#666] hover:text-white hover:bg-[#252525] transition-colors"
                  title="关闭"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* 错误列表 */}
            <div className="overflow-y-auto" style={{ maxHeight: isExpanded ? `${maxHeight}px` : 'auto' }}>
              {displayErrors.map((log) => (
                <div
                  key={log.id}
                  className={`
                    px-4 py-3 border-b border-[#2a2a2a] last:border-b-0
                    ${log.type === 'error' ? 'bg-red-500/5' : 'bg-yellow-500/5'}
                    hover:bg-[#252525] transition-colors
                  `}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`
                          text-xs font-medium px-1.5 py-0.5 rounded
                          ${log.type === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}
                        `}>
                          {log.type === 'error' ? 'ERROR' : 'WARN'}
                        </span>
                        <span className="text-xs text-[#666]">
                          {new Date(log.timestamp).toLocaleTimeString('zh-CN', {
                            hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-sm text-[#a0a0a0] break-words whitespace-pre-wrap">
                        {formatError(log)}
                      </p>
                    </div>
                    <button
                      onClick={() => copyError(log)}
                      className="p-1 rounded text-[#666] hover:text-white hover:bg-[#252525] transition-colors shrink-0"
                      title="复制此错误"
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* 底部 */}
            {errorLogs.length > 1 && (
              <div className="px-4 py-2 border-t border-[#2a2a2a] bg-[#151515] flex items-center justify-between">
                <span className="text-xs text-[#666]">
                  显示 {displayErrors.length} / {errorLogs.length} 条错误
                </span>
                <button
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('open-console'));
                    setIsPanelOpen(false);
                  }}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  查看全部
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ErrorNotification;
