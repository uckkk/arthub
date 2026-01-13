/**
 * 错误通知组件
 * 在右下角自动弹出显示错误信息，支持一键复制
 */

import React, { useState, useEffect } from 'react';
import { X, Copy, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { consoleService } from '../services/consoleService';
import { LogEntry } from './Console';

interface ErrorNotificationProps {
  maxHeight?: number;
  autoHideDelay?: number; // 自动隐藏延迟（毫秒），0 表示不自动隐藏
}

const ErrorNotification: React.FC<ErrorNotificationProps> = ({
  maxHeight = 400,
  autoHideDelay = 0, // 默认不自动隐藏
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [errorLogs, setErrorLogs] = useState<LogEntry[]>([]);
  const [newErrorCount, setNewErrorCount] = useState(0);
  const autoHideTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // 订阅日志更新
    const unsubscribe = consoleService.subscribe((logs) => {
      // 只显示错误和警告日志
      const errors = logs.filter(log => log.type === 'error' || log.type === 'warn');
      
      if (errors.length > 0) {
        setErrorLogs(errors);
        setIsVisible(true);
        
        // 如果有新错误，增加计数
        if (errors.length > errorLogs.length) {
          setNewErrorCount(errors.length - errorLogs.length);
        }
        
        // 如果设置了自动隐藏延迟，重置定时器
        if (autoHideDelay > 0) {
          if (autoHideTimeoutRef.current) {
            clearTimeout(autoHideTimeoutRef.current);
          }
          autoHideTimeoutRef.current = setTimeout(() => {
            setIsVisible(false);
          }, autoHideDelay);
        }
      }
    });

    return () => {
      unsubscribe();
      if (autoHideTimeoutRef.current) {
        clearTimeout(autoHideTimeoutRef.current);
      }
    };
  }, [errorLogs.length, autoHideDelay]);

  // 格式化错误消息
  const formatError = (log: LogEntry): string => {
    let message = log.message;
    if (log.args && log.args.length > 0) {
      try {
        const argsStr = log.args.map(arg => {
          if (typeof arg === 'object') {
            return JSON.stringify(arg, null, 2);
          }
          return String(arg);
        }).join(' ');
        message += ' ' + argsStr;
      } catch (e) {
        message += ' [无法序列化参数]';
      }
    }
    return message;
  };

  // 复制单个错误
  const copyError = (log: LogEntry) => {
    const time = new Date(log.timestamp).toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
    const typeLabel = log.type === 'error' ? 'ERROR' : 'WARN';
    const errorText = `[${time}] [${typeLabel}] ${formatError(log)}`;
    
    navigator.clipboard.writeText(errorText).then(() => {
      // 可以添加一个短暂的提示
    }).catch(err => {
      console.error('复制失败:', err);
    });
  };

  // 复制所有错误
  const copyAllErrors = () => {
    const errorText = errorLogs.map(log => {
      const time = new Date(log.timestamp).toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
      });
      const typeLabel = log.type === 'error' ? 'ERROR' : 'WARN';
      return `[${time}] [${typeLabel}] ${formatError(log)}`;
    }).join('\n');
    
    navigator.clipboard.writeText(errorText).then(() => {
      // 可以添加一个短暂的提示
    }).catch(err => {
      console.error('复制失败:', err);
    });
  };

  // 关闭通知
  const handleClose = () => {
    setIsVisible(false);
    setNewErrorCount(0);
  };

  if (!isVisible || errorLogs.length === 0) {
    return null;
  }

  const latestError = errorLogs[errorLogs.length - 1];
  const displayErrors = isExpanded ? errorLogs.slice(-5) : [latestError]; // 展开时显示最近5条

  return (
    <div className="fixed bottom-4 right-4 z-[9999] animate-slide-up">
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
            <span className="text-sm font-semibold text-white">
              错误通知
            </span>
            {newErrorCount > 0 && (
              <span className="
                px-1.5 py-0.5 rounded text-xs font-medium
                bg-red-500/20 text-red-400
              ">
                +{newErrorCount}
              </span>
            )}
            <span className="
              px-1.5 py-0.5 rounded text-xs font-medium
              bg-[#2a2a2a] text-[#666666]
            ">
              {errorLogs.length} 条
            </span>
          </div>
          <div className="flex items-center gap-1">
            {errorLogs.length > 1 && (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="
                  p-1 rounded text-[#666666] hover:text-white hover:bg-[#252525]
                  transition-colors
                "
                title={isExpanded ? '收起' : '展开'}
              >
                {isExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              </button>
            )}
            <button
              onClick={copyAllErrors}
              className="
                p-1 rounded text-[#666666] hover:text-white hover:bg-[#252525]
                transition-colors
              "
              title="复制所有错误"
            >
              <Copy size={16} />
            </button>
            <button
              onClick={handleClose}
              className="
                p-1 rounded text-[#666666] hover:text-white hover:bg-[#252525]
                transition-colors
              "
              title="关闭"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 错误列表 */}
        <div
          className="overflow-y-auto"
          style={{ maxHeight: isExpanded ? `${maxHeight}px` : 'auto' }}
        >
          {displayErrors.map((log, index) => (
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
                      ${log.type === 'error' 
                        ? 'bg-red-500/20 text-red-400' 
                        : 'bg-yellow-500/20 text-yellow-400'}
                    `}>
                      {log.type === 'error' ? 'ERROR' : 'WARN'}
                    </span>
                    <span className="text-xs text-[#666666]">
                      {new Date(log.timestamp).toLocaleTimeString('zh-CN', {
                        hour12: false,
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="text-sm text-[#a0a0a0] break-words whitespace-pre-wrap">
                    {formatError(log)}
                  </p>
                </div>
                <button
                  onClick={() => copyError(log)}
                  className="
                    p-1 rounded text-[#666666] hover:text-white hover:bg-[#252525]
                    transition-colors shrink-0
                  "
                  title="复制此错误"
                >
                  <Copy size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* 底部操作栏 */}
        {errorLogs.length > 1 && (
          <div className="
            px-4 py-2 border-t border-[#2a2a2a]
            bg-[#151515] flex items-center justify-between
          ">
            <span className="text-xs text-[#666666]">
              显示 {displayErrors.length} / {errorLogs.length} 条错误
            </span>
            <button
              onClick={() => {
                // 打开完整控制台（如果可用）
                const event = new CustomEvent('open-console');
                window.dispatchEvent(event);
              }}
              className="
                text-xs text-blue-400 hover:text-blue-300
                transition-colors
              "
            >
              查看全部
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ErrorNotification;
