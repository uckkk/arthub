/**
 * 控制台日志服务
 * 拦截并保存所有 console 输出和错误
 */

import { LogEntry } from '../components/Console';

// React ErrorInfo 类型定义（避免依赖 React）
interface ReactErrorInfo {
  componentStack: string;
}

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
    // 拦截 console.error（错误日志）
    console.error = (...args: any[]) => {
      this.addLog('error', args, this.getStackTrace());
      this.originalConsole.error(...args);
    };

    // 拦截 console.warn（警告日志）- 警告也可能表示潜在问题
    console.warn = (...args: any[]) => {
      this.addLog('warn', args, this.getStackTrace());
      this.originalConsole.warn(...args);
    };

    // 拦截 console.info（信息日志）- 记录重要操作
    console.info = (...args: any[]) => {
      // 只记录包含 "error"、"fail"、"异常" 等关键词的 info
      const firstArg = args[0];
      if (typeof firstArg === 'string' && 
          (firstArg.toLowerCase().includes('error') || 
           firstArg.toLowerCase().includes('fail') || 
           firstArg.includes('异常') ||
           firstArg.includes('失败'))) {
        this.addLog('info', args);
      }
      this.originalConsole.info(...args);
    };

    // 拦截未捕获的错误（包含更详细的堆栈信息）
    window.addEventListener('error', (event) => {
      const errorDetails = {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error,
        stack: event.error?.stack,
      };
      this.addLog('error', [
        `[未捕获错误] ${event.message}`,
        `位置: ${event.filename}:${event.lineno}:${event.colno}`,
        errorDetails,
      ]);
    }, true); // 使用捕获阶段

    // 拦截未处理的 Promise 拒绝（包含更详细的信息）
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      const errorDetails = {
        reason: reason,
        stack: reason?.stack,
        message: reason?.message || String(reason),
      };
      this.addLog('error', [
        `[未处理的 Promise 拒绝]`,
        errorDetails.message,
        errorDetails,
      ]);
    });

    // 拦截资源加载错误
    window.addEventListener('error', (event) => {
      if (event.target && (event.target as any).tagName) {
        const target = event.target as HTMLElement;
        const tagName = target.tagName;
        if (['IMG', 'SCRIPT', 'LINK', 'IFRAME'].includes(tagName)) {
          const src = (target as any).src || (target as any).href || 'unknown';
          this.addLog('error', [
            `[资源加载失败] ${tagName}`,
            `资源: ${src}`,
            { target, error: event.error },
          ]);
        }
      }
    }, true);

    // 拦截 fetch 请求错误
    this.interceptFetch();

    // 拦截 XMLHttpRequest 错误
    this.interceptXHR();
  }

  // 获取调用栈信息
  private getStackTrace(): string | undefined {
    try {
      throw new Error();
    } catch (e: any) {
      const stack = e.stack;
      if (stack) {
        // 移除前3行（getStackTrace、addLog、console方法调用）
        const lines = stack.split('\n').slice(4);
        return lines.join('\n');
      }
    }
    return undefined;
  }

  // 拦截 fetch 请求
  private interceptFetch() {
    const originalFetch = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const [url, options] = args;
      const startTime = Date.now();
      
      try {
        const response = await originalFetch(...args);
        const duration = Date.now() - startTime;
        
        // 记录失败的请求
        if (!response.ok) {
          const errorText = await response.clone().text().catch(() => '无法读取响应');
          this.addLog('error', [
            `[网络请求失败] ${response.status} ${response.statusText}`,
            `URL: ${url}`,
            `方法: ${options?.method || 'GET'}`,
            `耗时: ${duration}ms`,
            { response: errorText.substring(0, 500) }, // 限制长度
          ]);
        }
        
        return response;
      } catch (error: any) {
        const duration = Date.now() - startTime;
        this.addLog('error', [
          `[网络请求异常]`,
          `URL: ${url}`,
          `方法: ${options?.method || 'GET'}`,
          `耗时: ${duration}ms`,
          `错误: ${error.message || String(error)}`,
          error,
        ]);
        throw error;
      }
    };
  }

  // 拦截 XMLHttpRequest
  private interceptXHR() {
    const service = this; // 保存服务实例的引用
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...rest: any[]) {
      (this as any)._arthub_method = method;
      (this as any)._arthub_url = url;
      (this as any)._arthub_startTime = Date.now();
      return originalOpen.apply(this, [method, url, ...rest] as any);
    };

    XMLHttpRequest.prototype.send = function(...args: any[]) {
      const xhr = this;
      const method = (xhr as any)._arthub_method;
      const url = (xhr as any)._arthub_url;
      const startTime = (xhr as any)._arthub_startTime;

      xhr.addEventListener('error', () => {
        const duration = Date.now() - startTime;
        service.addLog('error', [
          `[XHR 请求失败]`,
          `URL: ${url}`,
          `方法: ${method}`,
          `耗时: ${duration}ms`,
          `状态: ${xhr.status} ${xhr.statusText}`,
        ]);
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 400) {
          const duration = Date.now() - startTime;
          service.addLog('error', [
            `[XHR 请求错误] ${xhr.status} ${xhr.statusText}`,
            `URL: ${url}`,
            `方法: ${method}`,
            `耗时: ${duration}ms`,
          ]);
        }
      });

      return originalSend.apply(this, args);
    };
  }

  private addLog(type: LogEntry['type'], args: any[], stackTrace?: string) {
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

    // 如果有堆栈信息，添加到参数中
    if (stackTrace) {
      logArgs.push({ _stackTrace: stackTrace });
    }

    // 添加用户操作上下文（如果可用）
    const context = this.getUserContext();
    if (context) {
      logArgs.push({ _context: context });
    }

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

    // 保存到 localStorage（供控制台窗口读取）
    try {
      localStorage.setItem('arthub_console_logs', JSON.stringify(this.logs));
    } catch (e) {
      // 忽略存储错误
    }

    // 通知监听器
    this.notifyListeners();
  }

  // 获取用户操作上下文
  private getUserContext(): any {
    try {
      return {
        url: window.location.href,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
        // 可以添加更多上下文信息
      };
    } catch {
      return null;
    }
  }

  // 记录 React ErrorBoundary 错误（供外部调用）
  logErrorBoundary(error: Error, errorInfo: ReactErrorInfo) {
    this.addLog('error', [
      `[React 错误边界] ${error.message}`,
      `组件堆栈:\n${errorInfo.componentStack}`,
      { error, errorInfo },
    ]);
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
    try {
      localStorage.removeItem('arthub_console_logs');
    } catch (e) {
      // 忽略存储错误
    }
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

// 将服务实例暴露到全局，供 XHR 拦截器使用
if (typeof window !== 'undefined') {
  (window as any).__arthub_console_service__ = consoleService;
}
