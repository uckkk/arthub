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

    // 启动布局问题检测（仅在开发模式或启用时）
    if (process.env.NODE_ENV === 'development' || this.shouldDetectLayoutIssues()) {
      this.startLayoutDetection();
    }
  }

  // 检查是否应该检测布局问题
  private shouldDetectLayoutIssues(): boolean {
    try {
      return localStorage.getItem('arthub_detect_layout_issues') === 'true';
    } catch {
      return false;
    }
  }

  // 启动布局问题检测
  private startLayoutDetection() {
    // 延迟启动，等待页面加载完成
    setTimeout(() => {
      this.detectLayoutIssues();
      // 定期检测（每5秒）
      setInterval(() => {
        this.detectLayoutIssues();
      }, 5000);
    }, 2000);
  }

  // 检测布局问题
  private detectLayoutIssues() {
    try {
      // 检测1: 滚动容器无法滚动的问题
      const scrollContainers = document.querySelectorAll('[class*="overflow-y-auto"], [class*="overflow-auto"]');
      scrollContainers.forEach((container) => {
        const el = container as HTMLElement;
        const hasOverflow = el.scrollHeight > el.clientHeight;
        const canScroll = el.scrollHeight > el.clientHeight && 
                         (el.scrollTop > 0 || el.scrollTop < el.scrollHeight - el.clientHeight - 1);
        
        // 如果内容超出但无法滚动，可能是布局问题
        if (hasOverflow && el.scrollHeight > el.clientHeight + 10) {
          // 检查父容器是否有高度约束
          const parent = el.parentElement;
          if (parent) {
            const parentHeight = parent.clientHeight;
            const elHeight = el.clientHeight;
            
            // 如果元素高度为0或非常小，可能是 flex 布局问题
            if (elHeight < 10 && parentHeight > 100) {
              this.addLog('warn', [
                `[布局问题] 滚动容器高度异常`,
                `元素: ${el.className || el.tagName}`,
                `容器高度: ${elHeight}px`,
                `父容器高度: ${parentHeight}px`,
                `内容高度: ${el.scrollHeight}px`,
                `建议: 检查是否需要添加 min-h-0 或 overflow-hidden 到父容器`,
                { element: el, parent },
              ]);
            }
          }
        }
      });

      // 检测2: h-full 但高度为0的元素
      const fullHeightElements = document.querySelectorAll('[class*="h-full"]');
      fullHeightElements.forEach((el) => {
        const element = el as HTMLElement;
        const height = element.clientHeight;
        const parent = element.parentElement;
        
        if (height === 0 && parent && parent.clientHeight > 0) {
          // 检查是否是 flex 布局问题
          const parentStyle = window.getComputedStyle(parent);
          const isFlex = parentStyle.display === 'flex';
          
          if (isFlex) {
            this.addLog('warn', [
              `[布局问题] h-full 元素高度为0`,
              `元素: ${element.className || element.tagName}`,
              `父容器: ${parent.className || parent.tagName}`,
              `父容器高度: ${parent.clientHeight}px`,
              `父容器 display: ${parentStyle.display}`,
              `建议: 检查父容器是否需要 overflow-hidden 或 flex-1`,
              { element, parent },
            ]);
          }
        }
      });

      // 检测3: flex-1 但高度异常的容器
      const flex1Elements = document.querySelectorAll('[class*="flex-1"]');
      flex1Elements.forEach((el) => {
        const element = el as HTMLElement;
        const parent = element.parentElement;
        
        if (parent) {
          const parentStyle = window.getComputedStyle(parent);
          const isFlex = parentStyle.display === 'flex';
          const elementHeight = element.clientHeight;
          const parentHeight = parent.clientHeight;
          
          // 如果父容器是 flex，但 flex-1 元素高度为0
          if (isFlex && elementHeight === 0 && parentHeight > 0) {
            const hasMinH0 = element.className.includes('min-h-0');
            this.addLog('warn', [
              `[布局问题] flex-1 元素高度为0`,
              `元素: ${element.className || element.tagName}`,
              `父容器高度: ${parentHeight}px`,
              `是否有 min-h-0: ${hasMinH0}`,
              `建议: ${hasMinH0 ? '检查父容器布局' : '尝试添加 min-h-0 类'}`,
              { element, parent },
            ]);
          }
        }
      });
    } catch (error) {
      // 静默失败，不影响应用运行
    }
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
      const urlString = typeof url === 'string' ? url : url.toString();
      const startTime = Date.now();
      
      try {
        const response = await originalFetch(...args);
        const duration = Date.now() - startTime;
        
        // 记录失败的请求
        if (!response.ok) {
          // 检查是否是预期的错误（应该被静默处理）
          const isExpectedError = this.isExpectedError(urlString, response.status);
          
          if (!isExpectedError) {
            const errorText = await response.clone().text().catch(() => '无法读取响应');
            // 404 和 403 通常是预期的错误，记录为警告
            const logType = (response.status === 404 || response.status === 403) ? 'warn' : 'error';
            this.addLog(logType, [
              `[网络请求失败] ${response.status} ${response.statusText}`,
              `URL: ${urlString}`,
              `方法: ${options?.method || 'GET'}`,
              `耗时: ${duration}ms`,
              { response: errorText.substring(0, 500) }, // 限制长度
            ]);
          }
        }
        
        return response;
      } catch (error: any) {
        const duration = Date.now() - startTime;
        this.addLog('error', [
          `[网络请求异常]`,
          `URL: ${urlString}`,
          `方法: ${options?.method || 'GET'}`,
          `耗时: ${duration}ms`,
          `错误: ${error.message || String(error)}`,
          error,
        ]);
        throw error;
      }
    };
  }

  // 判断是否是预期的错误（应该被静默处理）
  private isExpectedError(url: string, status: number): boolean {
    // GitHub API 的 404 通常是预期的（没有 release、仓库不存在等）
    if (status === 404 && url.includes('api.github.com')) {
      return true;
    }
    
    // 可以添加更多预期的错误模式
    // 例如：检查更新的 API、健康检查端点等
    
    return false;
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
