import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { Copy, Trash2, Download } from 'lucide-react';
import { consoleService } from './services/consoleService';
import './index.css';

export interface LogEntry {
  id: string;
  timestamp: number;
  type: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  args?: any[];
}

const ConsoleWindow: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // 订阅日志更新
  useEffect(() => {
    const unsubscribe = consoleService.subscribe((newLogs) => {
      setLogs(newLogs);
    });
    return unsubscribe;
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // 处理滚动事件
  const handleScroll = () => {
    if (logContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
      setAutoScroll(isAtBottom);
    }
  };

  // 格式化日志消息
  const formatMessage = (entry: LogEntry): string => {
    const time = new Date(entry.timestamp).toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });

    let message = entry.message;
    if (entry.args && entry.args.length > 0) {
      try {
        const argsStr = entry.args.map(arg => {
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

    return `[${time}] ${message}`;
  };

  // 复制所有日志
  const copyAllLogs = () => {
    const logText = logs.map(formatMessage).join('\n');
    navigator.clipboard.writeText(logText).then(() => {
      // 可以添加一个提示
    }).catch(err => {
      console.error('复制失败:', err);
    });
  };

  // 导出日志
  const exportLogs = () => {
    const logText = logs.map(formatMessage).join('\n');
    const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arthub-errors-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-screen flex flex-col bg-[#0f0f0f] text-white">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2a] shrink-0">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-white">错误日志控制台</h3>
          <span className="
            px-2 py-0.5 rounded text-xs font-medium
            bg-[#1a1a1a] text-[#666666]
          ">
            {logs.length} 条错误
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={copyAllLogs}
            className="
              px-3 py-1.5 rounded-lg text-sm
              bg-[#1a1a1a] hover:bg-[#222222]
              text-[#a0a0a0] hover:text-white
              border border-[#2a2a2a] hover:border-[#3a3a3a]
              transition-colors flex items-center gap-2
            "
            title="复制所有日志"
          >
            <Copy size={14} />
            复制全部
          </button>
          <button
            onClick={exportLogs}
            className="
              px-3 py-1.5 rounded-lg text-sm
              bg-[#1a1a1a] hover:bg-[#222222]
              text-[#a0a0a0] hover:text-white
              border border-[#2a2a2a] hover:border-[#3a3a3a]
              transition-colors flex items-center gap-2
            "
            title="导出日志文件"
          >
            <Download size={14} />
            导出
          </button>
          <button
            onClick={() => consoleService.clearLogs()}
            className="
              px-3 py-1.5 rounded-lg text-sm
              bg-[#1a1a1a] hover:bg-[#222222]
              text-[#a0a0a0] hover:text-white
              border border-[#2a2a2a] hover:border-[#3a3a3a]
              transition-colors flex items-center gap-2
            "
            title="清空日志"
          >
            <Trash2 size={14} />
            清空
          </button>
        </div>
      </div>

      {/* 日志内容区域 */}
      <div
        ref={logContainerRef}
        onScroll={handleScroll}
        className="
          flex-1 overflow-y-auto p-4
          font-mono text-xs
          space-y-1
        "
        style={{ scrollbarWidth: 'thin' }}
      >
        {logs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[#666666]">
            <p>暂无错误日志</p>
          </div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className="
                px-3 py-2 rounded border
                text-red-400 bg-red-500/10 border-red-500/20
                break-words
                select-text
                hover:opacity-80
                transition-opacity
              "
            >
              <div className="whitespace-pre-wrap">{formatMessage(log)}</div>
              {log.args && log.args.length > 0 && (
                <div className="mt-1 pl-4 border-l-2 border-red-500/30">
                  {log.args.map((arg, idx) => (
                    <div key={idx} className="mt-1">
                      {typeof arg === 'object' ? (
                        <pre className="text-xs overflow-x-auto">
                          {JSON.stringify(arg, null, 2)}
                        </pre>
                      ) : (
                        <span>{String(arg)}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* 底部提示 */}
      <div className="px-5 py-2 border-t border-[#2a2a2a] shrink-0">
        <p className="text-[10px] text-[#555555]">
          提示：可以选中文本复制，或使用"复制全部"按钮复制所有错误日志
        </p>
      </div>
    </div>
  );
};

// 渲染应用
const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <ConsoleWindow />
    </React.StrictMode>
  );
}
