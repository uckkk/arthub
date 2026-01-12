/**
 * 控制台日志服务
 * 拦截并保存所有 console 输出
 */

import { LogEntry } from '../components/Console';

class ConsoleService {
  private logs: LogEntry[] = [];
  private listeners: Set<(logs: LogEntry[]) => void> = new Set();
  private maxLogs = 10000; // 最大日志数量
  private originalConsole: {
    log: typeof console.log;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
    debug: typeof console.debug;
  };

  constructor() {
    // 保存原始的 console 方法
    this.originalConsole = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: console.debug.bind(console),
    };

    // 拦截 console 方法
    this.interceptConsole();
  }

  private interceptConsole() {
    // 拦截 console.log
    console.log = (...args: any[]) => {
      this.addLog('log', args);
      this.originalConsole.log(...args);
    };

    // 拦截 console.info
    console.info = (...args: any[]) => {
      this.addLog('info', args);
      this.originalConsole.info(...args);
    };

    // 拦截 console.warn
    console.warn = (...args: any[]) => {
      this.addLog('warn', args);
      this.originalConsole.warn(...args);
    };

    // 拦截 console.error
    console.error = (...args: any[]) => {
      this.addLog('error', args);
      this.originalConsole.error(...args);
    };

    // 拦截 console.debug
    console.debug = (...args: any[]) => {
      this.addLog('debug', args);
      this.originalConsole.debug(...args);
    };

    // 拦截未捕获的错误
    window.addEventListener('error', (event) => {
      this.addLog('error', [
        `Uncaught Error: ${event.message}`,
        `File: ${event.filename}:${event.lineno}:${event.colno}`,
        event.error,
      ]);
    });

    // 拦截未处理的 Promise 拒绝
    window.addEventListener('unhandledrejection', (event) => {
      this.addLog('error', [
        `Unhandled Promise Rejection: ${event.reason}`,
        event.reason,
      ]);
    });
  }

  private addLog(type: LogEntry['type'], args: any[]) {
    // 将参数转换为消息字符串
    let message = '';
    const logArgs: any[] = [];

    args.forEach((arg, index) => {
      if (index === 0) {
        // 第一个参数作为主消息
        if (typeof arg === 'string') {
          message = arg;
        } else {
          try {
            message = JSON.stringify(arg);
          } catch {
            message = String(arg);
          }
        }
      } else {
        // 其他参数作为附加参数
        logArgs.push(arg);
      }
    });

    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      type,
      message,
      args: logArgs.length > 0 ? logArgs : undefined,
    };

    this.logs.push(entry);

    // 限制日志数量
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // 通知监听器
    this.notifyListeners();
  }

  private notifyListeners() {
    this.listeners.forEach(listener => {
      try {
        listener([...this.logs]);
      } catch (error) {
        // 忽略监听器错误
      }
    });
  }

  // 订阅日志更新
  subscribe(listener: (logs: LogEntry[]) => void) {
    this.listeners.add(listener);
    // 立即通知当前日志
    listener([...this.logs]);
    // 返回取消订阅函数
    return () => {
      this.listeners.delete(listener);
    };
  }

  // 获取所有日志
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  // 清空日志
  clearLogs() {
    this.logs = [];
    this.notifyListeners();
  }

  // 恢复原始 console（如果需要）
  restoreConsole() {
    console.log = this.originalConsole.log;
    console.info = this.originalConsole.info;
    console.warn = this.originalConsole.warn;
    console.error = this.originalConsole.error;
    console.debug = this.originalConsole.debug;
  }
}

// 创建单例
export const consoleService = new ConsoleService();
