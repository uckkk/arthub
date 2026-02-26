import React, { useState, useEffect, useRef } from 'react';
import { X, Copy, Trash2, Download, TestTube } from 'lucide-react';
import { consoleService } from '../services/consoleService';

export interface LogEntry {
  id: string;
  timestamp: number;
  type: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  args?: any[];
}

interface ConsoleProps {
  isOpen: boolean;
  onClose: () => void;
  logs: LogEntry[];
  onClear: () => void;
}

const Console: React.FC<ConsoleProps> = ({ isOpen, onClose, logs, onClear }) => {
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filterType, setFilterType] = useState<LogEntry['type'] | 'all'>('all');

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

  // 过滤日志
  const filteredLogs = filterType === 'all' 
    ? logs 
    : logs.filter(log => log.type === filterType);

  // 统计各类型日志数量
  const logStats = {
    all: logs.length,
    error: logs.filter(l => l.type === 'error').length,
    warn: logs.filter(l => l.type === 'warn').length,
    info: logs.filter(l => l.type === 'info').length,
    debug: logs.filter(l => l.type === 'debug').length,
    log: logs.filter(l => l.type === 'log').length,
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

    const typeLabel = {
      log: 'LOG',
      info: 'INFO',
      warn: 'WARN',
      error: 'ERROR',
      debug: 'DEBUG',
    }[entry.type];

    return `[${time}] [${typeLabel}] ${entry.message}`;
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

  // 复制选中的日志
  const copySelectedLogs = () => {
    const selection = window.getSelection();
    if (selection && selection.toString()) {
      navigator.clipboard.writeText(selection.toString());
    }
  };

  // 导出日志
  const exportLogs = () => {
    const logText = logs.map(formatMessage).join('\n');
    const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arthub-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 测试日志系统
  const testLogSystem = () => {
    consoleService.addLog('info', ['[测试] 这是一条信息日志', '日志系统正常工作']);
    consoleService.addLog('warn', ['[测试] 这是一条警告日志', '用于测试警告显示']);
    consoleService.addLog('error', ['[测试] 这是一条错误日志', '用于测试错误显示']);
    consoleService.addLog('debug', ['[测试] 这是一条调试日志', '用于测试调试显示']);
    
    // 测试错误对象
    try {
      throw new Error('测试错误对象');
    } catch (e: any) {
      consoleService.addLog('error', [
        '[测试] 捕获的错误对象',
        `错误消息: ${e.message}`,
        `错误堆栈: ${e.stack}`,
        { error: e }
      ]);
    }
  };

  // 获取日志类型对应的样式
  const getLogStyle = (type: LogEntry['type']) => {
    switch (type) {
      case 'error':
        return 'text-red-400 bg-red-500/10 border-red-500/20';
      case 'warn':
        return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
      case 'info':
        return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
      case 'debug':
        return 'text-purple-400 bg-purple-500/10 border-purple-500/20';
      default:
        return 'text-[#a0a0a0] bg-[#1a1a1a] border-[#2a2a2a]';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="
        w-full max-w-6xl h-[80vh] max-h-[800px]
        bg-[#0f0f0f] border border-[#2a2a2a] rounded-xl
        shadow-2xl shadow-black/50
        flex flex-col
        animate-scale-in
      ">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2a] shrink-0">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-white">日志控制台</h3>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-[#1a1a1a] text-[#666666]">
                总计: {logStats.all}
              </span>
              {logStats.error > 0 && (
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                  错误: {logStats.error}
                </span>
              )}
              {logStats.warn > 0 && (
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                  警告: {logStats.warn}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* 日志类型过滤 */}
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a]">
              <button
                onClick={() => setFilterType('all')}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${
                  filterType === 'all' 
                    ? 'bg-[#2563eb] text-white' 
                    : 'text-[#666666] hover:text-white'
                }`}
                title="显示所有日志"
              >
                全部
              </button>
              {logStats.error > 0 && (
                <button
                  onClick={() => setFilterType('error')}
                  className={`px-2 py-0.5 rounded text-xs transition-colors ${
                    filterType === 'error' 
                      ? 'bg-red-500/30 text-red-400' 
                      : 'text-[#666666] hover:text-red-400'
                  }`}
                  title="仅显示错误"
                >
                  错误({logStats.error})
                </button>
              )}
              {logStats.warn > 0 && (
                <button
                  onClick={() => setFilterType('warn')}
                  className={`px-2 py-0.5 rounded text-xs transition-colors ${
                    filterType === 'warn' 
                      ? 'bg-yellow-500/30 text-yellow-400' 
                      : 'text-[#666666] hover:text-yellow-400'
                  }`}
                  title="仅显示警告"
                >
                  警告({logStats.warn})
                </button>
              )}
              {logStats.info > 0 && (
                <button
                  onClick={() => setFilterType('info')}
                  className={`px-2 py-0.5 rounded text-xs transition-colors ${
                    filterType === 'info' 
                      ? 'bg-blue-500/30 text-blue-400' 
                      : 'text-[#666666] hover:text-blue-400'
                  }`}
                  title="仅显示信息"
                >
                  信息({logStats.info})
                </button>
              )}
            </div>
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
              onClick={testLogSystem}
              className="
                px-3 py-1.5 rounded-lg text-sm
                bg-[#1a1a1a] hover:bg-[#222222]
                text-[#a0a0a0] hover:text-white
                border border-[#2a2a2a] hover:border-[#3a3a3a]
                transition-colors flex items-center gap-2
              "
              title="测试日志系统"
            >
              <TestTube size={14} />
              测试
            </button>
            <button
              onClick={onClear}
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
            <button
              onClick={onClose}
              className="
                p-1.5 rounded-lg
                text-[#666666] hover:text-white hover:bg-[#252525]
                transition-colors
              "
              title="关闭控制台"
            >
              <X size={18} />
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
          onCopy={copySelectedLogs}
        >
          {filteredLogs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[#666666]">
              <p>{filterType === 'all' ? '暂无日志' : `暂无${filterType === 'error' ? '错误' : filterType === 'warn' ? '警告' : filterType === 'info' ? '信息' : '调试'}日志`}</p>
            </div>
          ) : (
            filteredLogs.map((log) => (
              <div
                key={log.id}
                className={`
                  px-3 py-2 rounded border
                  ${getLogStyle(log.type)}
                  break-words
                  select-text
                  hover:opacity-80
                  transition-opacity
                `}
              >
                <div className="whitespace-pre-wrap">{formatMessage(log)}</div>
                {log.args && log.args.length > 0 && (
                  <div className="mt-1 pl-4 border-l-2 border-current/30">
                    {log.args.map((arg, idx) => (
                      <div key={idx} className="mt-1">
                        {typeof arg === 'object' ? (
                          <pre className="text-xs overflow-x-auto">
                            {(() => {
                              try {
                                return JSON.stringify(arg, (key, value) => {
                                  if (value instanceof HTMLElement) return `<${value.tagName.toLowerCase()} class="${value.className || ''}">`;
                                  if (value instanceof Node) return `[${value.nodeName}]`;
                                  return value;
                                }, 2);
                              } catch {
                                return String(arg);
                              }
                            })()}
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
        <div className="px-5 py-2 border-t border-[#2a2a2a] shrink-0 flex items-center justify-between">
          <p className="text-[10px] text-[#555555]">
            提示：可以选中文本复制，或使用"复制全部"按钮复制所有日志。日志自动保存，最多保留 {logs.length >= 10000 ? '10000' : logs.length} 条。
          </p>
          {filterType !== 'all' && (
            <button
              onClick={() => setFilterType('all')}
              className="text-[10px] text-[#666666] hover:text-white transition-colors"
            >
              清除过滤
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Console;
