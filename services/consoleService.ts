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
  private maxLogs = 10000;
  private originalConsole: {
    log: typeof console.log;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
    debug: typeof console.debug;
  };
  private originalLog: typeof console.log;
  private _persistTimer: ReturnType<typeof setTimeout> | null = null;
  private _notifyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // 保存原始的 console 方法
    this.originalLog = console.log.bind(console);
    this.originalConsole = {
      log: this.originalLog,
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
      // 过滤掉预期的错误（如开发者工具打开失败）
      const firstArg = args[0];
      if (typeof firstArg === 'string' && 
          (firstArg.includes('无法打开开发者工具') || 
           firstArg.includes('Failed to open developer tools'))) {
        // 这是预期的错误，只输出到原始控制台，不记录到日志服务
        this.originalConsole.error(...args);
        return;
      }
      this.addLog('error', args, this.getStackTrace());
      this.originalConsole.error(...args);
    };

    // 拦截 console.warn（警告日志）- 警告也可能表示潜在问题
    console.warn = (...args: any[]) => {
      // 过滤内部库的常见警告，只输出到原始控制台
      const firstArg = args[0];
      if (typeof firstArg === 'string' && (
        firstArg.includes('ToggleGroup is changing from') ||
        firstArg.startsWith('THREE.') ||
        firstArg.includes('Image analysis skipped')
      )) {
        this.originalConsole.warn(...args);
        return;
      }
      this.addLog('warn', args, this.getStackTrace());
      this.originalConsole.warn(...args);
    };

    // 拦截 console.log（普通日志）- 记录调试信息和重要操作
    console.log = (...args: any[]) => {
      const firstArg = args[0];
      // 记录包含调试标记的日志
      if (typeof firstArg === 'string' && 
          (firstArg.includes('[PathManager]') ||
           firstArg.includes('[调试]') ||
           firstArg.includes('[DEBUG]') ||
           firstArg.includes('[AI Index]') ||
           firstArg.includes('[AI 索引]') ||
           firstArg.includes('[Tauri]'))) {
        this.addLog('info', args);
      }
      this.originalLog(...args);
    };

    // 拦截 console.info（信息日志）- 记录重要操作和状态变化
    console.info = (...args: any[]) => {
      const firstArg = args[0];
      // 记录包含关键词的 info，或所有包含标记的 info
      if (typeof firstArg === 'string' && 
          (firstArg.toLowerCase().includes('error') || 
           firstArg.toLowerCase().includes('fail') || 
           firstArg.includes('异常') ||
           firstArg.includes('失败') ||
           firstArg.includes('[AI') ||
           firstArg.includes('[索引]') ||
           firstArg.includes('[性能]') ||
           firstArg.includes('[内存]'))) {
        this.addLog('info', args);
      }
      this.originalConsole.info(...args);
    };

    // 拦截未捕获的错误（包含更详细的堆栈信息）
    window.addEventListener('error', (event) => {
      // Skip resource loading errors (handled by the dedicated listener below)
      if (event.target && (event.target as any).tagName && !event.message) return;
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
        name: reason?.name,
        code: reason?.code,
      };
      this.addLog('error', [
        `[未处理的 Promise 拒绝]`,
        `错误类型: ${errorDetails.name || 'Unknown'}`,
        `错误消息: ${errorDetails.message}`,
        errorDetails.code ? `错误代码: ${errorDetails.code}` : '',
        errorDetails.stack ? `堆栈:\n${errorDetails.stack}` : '',
        errorDetails,
      ]);
    });
    
    // 添加崩溃检测（内存泄漏、性能问题）
    this.startCrashDetection();

    // 拦截资源加载错误（忽略 Tauri asset:// 协议的图片加载失败，这些由组件自行处理）
    window.addEventListener('error', (event) => {
      if (event.target && (event.target as any).tagName) {
        const target = event.target as HTMLElement;
        const tagName = target.tagName;
        if (['IMG', 'SCRIPT', 'LINK', 'IFRAME'].includes(tagName)) {
          const src = (target as any).src || (target as any).href || 'unknown';
          // Skip Tauri asset protocol image errors (handled by components with SkeletonImage/onError)
          if (tagName === 'IMG' && (typeof src === 'string') && (src.startsWith('https://asset.localhost') || src.startsWith('asset://'))) {
            return;
          }
          this.addLog('error', [
            `[资源加载失败] ${tagName}`,
            `资源: ${typeof src === 'string' ? src : 'unknown'}`,
          ]);
        }
      }
    }, true);

    // 拦截 fetch 请求错误
    this.interceptFetch();

    // 拦截 XMLHttpRequest 错误
    this.interceptXHR();

    // 拦截 Tauri invoke 调用（如果可用）
    this.interceptTauriInvoke();

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
                `元素: ${(el.className || el.tagName).substring(0, 120)}`,
                `容器高度: ${elHeight}px, 父容器: ${parentHeight}px, 内容: ${el.scrollHeight}px`,
                `建议: 检查是否需要添加 min-h-0 或 overflow-hidden 到父容器`,
              ]);
            }
          }
        }
      });

      // 检测2: h-full 但高度为0的元素（跳过不可见元素）
      const fullHeightElements = document.querySelectorAll('[class*="h-full"]');
      fullHeightElements.forEach((el) => {
        const element = el as HTMLElement;
        // 跳过不可见元素
        if (element.offsetParent === null && window.getComputedStyle(element).position !== 'fixed') return;
        const height = element.clientHeight;
        const parent = element.parentElement;
        
        if (height === 0 && parent && parent.clientHeight > 50) {
          // 检查是否是 flex 布局问题
          const parentStyle = window.getComputedStyle(parent);
          const isFlex = parentStyle.display === 'flex';
          const isColumn = parentStyle.flexDirection === 'column';
          
          // 只在 flex-col 且父容器有明确高度时警告
          if (isFlex && isColumn) {
            // 跳过宽度也为 0 的元素（可能是完全折叠的）
            if (element.clientWidth === 0) return;
            this.addLog('warn', [
              `[布局问题] h-full 元素高度为0`,
              `元素: ${(element.className || element.tagName).substring(0, 120)}`,
              `父容器: ${(parent.className || parent.tagName).substring(0, 80)} (${parent.clientHeight}px)`,
              `建议: 检查父容器是否需要 overflow-hidden 或 flex-1`,
            ]);
          }
        }
      });

      // 检测3: flex-1 但高度异常的容器（跳过不可见元素，避免隐藏 tab 误报）
      const flex1Elements = document.querySelectorAll('[class*="flex-1"]');
      flex1Elements.forEach((el) => {
        const element = el as HTMLElement;
        const parent = element.parentElement;
        
        if (parent) {
          // 跳过不可见元素（display:none 或 hidden 的 tab 内容）
          const elStyle = window.getComputedStyle(element);
          if (elStyle.display === 'none' || elStyle.visibility === 'hidden') return;
          // 跳过祖先不可见的元素
          if (element.offsetParent === null && elStyle.position !== 'fixed') return;

          const parentStyle = window.getComputedStyle(parent);
          const isFlex = parentStyle.display === 'flex';
          // 只在父容器 flex-direction: column 时检测高度问题
          // row 方向的 flex-1 控制的是宽度，高度为0是正常的
          const isColumn = parentStyle.flexDirection === 'column';
          if (!isFlex || !isColumn) return;

          const elementHeight = element.clientHeight;
          const parentHeight = parent.clientHeight;
          
          // 如果父容器是 flex-col，且父容器有足够高度（>50px），但 flex-1 子元素高度为0
          if (elementHeight === 0 && parentHeight > 50) {
            // 跳过内联元素（span 等）和非块级子项
            if (elStyle.display === 'inline' || elStyle.display === 'inline-block') return;
            // 跳过有 grid 布局的元素（grid 容器的 flex-1 行为不同）
            if (elStyle.display === 'grid' || elStyle.display === 'inline-grid') return;
            // 跳过本身也是 hidden/collapsed 的元素
            if (element.clientWidth === 0) return;

            const hasMinH0 = element.className.includes('min-h-0');
            const classSnippet = (element.className || element.tagName).substring(0, 120);
            const parentClassSnippet = (parent.className || parent.tagName).substring(0, 80);
            this.addLog('warn', [
              `[布局问题] flex-1 元素高度为0`,
              `元素: ${classSnippet}`,
              `父容器: ${parentClassSnippet} (${parentHeight}px)`,
              `建议: ${hasMinH0 ? '检查父容器布局' : '尝试添加 min-h-0 类'}`,
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
    
    // GitHub API 的 403 rate limit 错误应该静默处理
    if (status === 403 && url.includes('api.github.com')) {
      return true;
    }
    
    // 可以添加更多预期的错误模式
    // 例如：检查更新的 API、健康检查端点等
    
    return false;
  }

  // 拦截 Tauri invoke 调用
  // 注意：大部分组件已使用 tauriInvokeInterceptor，这里只作为备用拦截
  // 如果 tauriInvokeInterceptor 已加载，则跳过拦截以避免冲突
  private interceptTauriInvoke() {
    // 检查是否已有拦截器（通过检查 window 上的标记）
    if ((window as any).__arthub_tauri_intercepted) {
      // 已有拦截器，跳过
      return;
    }
    
    try {
      // 动态导入 Tauri API
      import('@tauri-apps/api/tauri').then((tauriModule) => {
        // 再次检查（可能在导入过程中其他拦截器已加载）
        if ((window as any).__arthub_tauri_intercepted) {
          return;
        }
        
        const originalInvoke = tauriModule.invoke;
        const service = this;
        
        // 尝试拦截 invoke 方法
        try {
          // 先尝试直接赋值（最简单的方式）
          const wrappedInvoke = async function(command: string, args?: any) {
            return service.wrapInvoke(originalInvoke.bind(this), command, args);
          };
          
          // 检查是否可以重定义
          const descriptor = Object.getOwnPropertyDescriptor(tauriModule, 'invoke');
          if (descriptor) {
            if (descriptor.configurable) {
              // 可以配置，使用 defineProperty
              Object.defineProperty(tauriModule, 'invoke', {
                value: wrappedInvoke,
                writable: true,
                configurable: true
              });
              (window as any).__arthub_tauri_intercepted = true;
            } else if (descriptor.writable) {
              // 可写但不可配置，直接赋值
              (tauriModule as any).invoke = wrappedInvoke;
              (window as any).__arthub_tauri_intercepted = true;
            } else {
              // 不可写也不可配置，无法拦截，静默失败
              // 不记录警告，因为这是预期的行为
              return;
            }
          } else {
            // 没有描述符，直接赋值
            (tauriModule as any).invoke = wrappedInvoke;
            (window as any).__arthub_tauri_intercepted = true;
          }
        } catch (e: any) {
          // 拦截失败，静默处理（不记录警告，避免日志污染）
          // 因为 tauriInvokeInterceptor 可能已经拦截了
          const errorMsg = e?.message || String(e);
          if (!errorMsg.includes('Cannot redefine property') && !errorMsg.includes('redefine')) {
            // 只有非重定义错误才记录（但降低日志级别）
            console.debug('[日志服务] 拦截 Tauri invoke 失败（可能已有其他拦截器）:', errorMsg);
          }
        }
      }).catch((importError) => {
        // Tauri API 不可用，静默处理（不记录警告）
        console.debug('[日志服务] Tauri API 不可用:', importError?.message || String(importError));
      });
    } catch (e) {
      // 拦截失败，静默处理
      console.debug('[日志服务] 拦截 Tauri invoke 失败:', e instanceof Error ? e.message : String(e));
    }
  }
  
  // 包装 invoke 调用的通用方法
  private wrapInvoke(originalInvoke: any, command: string, args?: any): Promise<any> {
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substr(2, 9);
    const memoryBefore = this.getMemoryUsage();
    
    // 记录调用开始（仅对重要命令）
    const importantCommands = ['ai_index_embeddings', 'ai_search', 'asset_scan_folder', 'asset_query', 'ai_embedding_stats'];
    if (importantCommands.includes(command)) {
      const memory = this.getMemoryUsage();
      this.addLog('info', [
        `[Tauri] 调用命令: ${command}`,
        args ? `参数: ${JSON.stringify(args).substring(0, 200)}` : '无参数',
        `请求ID: ${requestId}`,
        memory ? `内存使用: ${Math.round(memory.usedJSHeapSize / 1024 / 1024)}MB` : ''
      ]);
    }
    
    try {
      const resultPromise = originalInvoke.call(this, command, args);
      return resultPromise.then((result: any) => {
        const duration = Date.now() - startTime;
        const memoryAfter = this.getMemoryUsage();
        const memoryDelta = memoryBefore && memoryAfter 
          ? memoryAfter.usedJSHeapSize - memoryBefore.usedJSHeapSize 
          : null;
        
        // 记录慢调用（>1秒）
        if (duration > 1000) {
          this.addLog('warn', [
            `[Tauri] 命令执行较慢: ${command}`,
            `耗时: ${duration}ms`,
            `请求ID: ${requestId}`,
            `结果类型: ${typeof result}`,
            memoryDelta ? `内存变化: ${memoryDelta > 0 ? '+' : ''}${Math.round(memoryDelta / 1024 / 1024)}MB` : ''
          ]);
        }
        
        // 记录性能瓶颈（>5秒）
        if (duration > 5000) {
          this.addLog('warn', [
            `[性能瓶颈] Tauri 命令执行超时: ${command}`,
            `耗时: ${duration}ms (${Math.round(duration / 1000)}秒)`,
            `请求ID: ${requestId}`,
            `建议: 检查后端处理逻辑或数据量`,
            memoryDelta ? `内存变化: ${memoryDelta > 0 ? '+' : ''}${Math.round(memoryDelta / 1024 / 1024)}MB` : ''
          ]);
        }
        
        // 记录错误结果
        if (result && typeof result === 'object' && 'error' in result) {
          this.addLog('error', [
            `[Tauri] 命令返回错误: ${command}`,
            `错误: ${JSON.stringify(result.error)}`,
            `耗时: ${duration}ms`,
            `请求ID: ${requestId}`,
            { result, command, args }
          ]);
        }
        
        return result;
      }).catch((error: any) => {
        const duration = Date.now() - startTime;
        const errorMessage = error?.message || String(error);
        const errorCode = error?.code;
        const errorStack = error?.stack;
        const errorName = error?.name;
        const memoryAfter = this.getMemoryUsage();
        const memoryDelta = memoryBefore && memoryAfter 
          ? memoryAfter.usedJSHeapSize - memoryBefore.usedJSHeapSize 
          : null;
        
        // 记录所有 invoke 错误（详细）- 这是关键的错误记录点
        this.addLog('error', [
          `[Tauri] 命令调用失败: ${command}`,
          `错误类型: ${errorName || 'Unknown'}`,
          `错误消息: ${errorMessage}`,
          errorCode ? `错误代码: ${errorCode}` : '',
          `耗时: ${duration}ms`,
          `请求ID: ${requestId}`,
          args ? `参数: ${JSON.stringify(args).substring(0, 200)}` : '',
          memoryDelta ? `内存变化: ${memoryDelta > 0 ? '+' : ''}${Math.round(memoryDelta / 1024 / 1024)}MB` : '',
          errorStack ? `堆栈:\n${errorStack}` : '',
          { 
            error, 
            stack: errorStack, 
            command, 
            args, 
            duration, 
            memoryDelta,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent
          }
        ]);
        
        throw error;
      });
    } catch (error: any) {
      // 同步错误处理
      const duration = Date.now() - startTime;
      const errorMessage = error?.message || String(error);
      this.addLog('error', [
        `[Tauri] 命令调用同步失败: ${command}`,
        `错误: ${errorMessage}`,
        `耗时: ${duration}ms`,
        `请求ID: ${requestId}`,
        { error, command, args }
      ]);
      throw error;
    }
  }
  
  
  // 启动崩溃检测
  private startCrashDetection() {
    // 内存监控
    this.startMemoryMonitoring();
    
    // 性能监控
    this.startPerformanceMonitoring();
    
    // 页面可见性变化检测（可能表示应用挂起）
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // 页面隐藏，记录状态
        const memory = this.getMemoryUsage();
        if (memory) {
          this.addLog('info', [
            `[应用状态] 页面隐藏`,
            `内存使用: ${Math.round(memory.usedJSHeapSize / 1024 / 1024)}MB / ${Math.round(memory.jsHeapSizeLimit / 1024 / 1024)}MB`,
            `使用率: ${Math.round((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100)}%`
          ]);
        }
      } else {
        // 页面重新可见，检查是否有异常
        const memory = this.getMemoryUsage();
        if (memory) {
          const usagePercent = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;
          if (usagePercent > 90) {
            this.addLog('warn', [
              `[应用状态] 页面重新可见，但内存使用率很高`,
              `内存使用: ${Math.round(memory.usedJSHeapSize / 1024 / 1024)}MB / ${Math.round(memory.jsHeapSizeLimit / 1024 / 1024)}MB`,
              `使用率: ${Math.round(usagePercent)}%`,
              `建议: 检查是否有内存泄漏`
            ]);
          }
        }
      }
    });
    
    // 页面卸载前记录状态
    window.addEventListener('beforeunload', () => {
      const memory = this.getMemoryUsage();
      if (memory) {
        this.addLog('info', [
          `[应用状态] 页面即将卸载`,
          `内存使用: ${Math.round(memory.usedJSHeapSize / 1024 / 1024)}MB / ${Math.round(memory.jsHeapSizeLimit / 1024 / 1024)}MB`,
          `日志总数: ${this.logs.length}`
        ]);
      }
    });
    
    // 检测页面冻结（长时间无响应）
    this.detectPageFreeze();
  }
  
  // 检测页面冻结（仅在前台报告；同一问题 5 分钟内只报一次，避免刷屏）
  private detectPageFreeze() {
    let lastHeartbeat = Date.now();
    let lastFreezeReportAt = 0;
    const heartbeatInterval = 5000; // 5秒心跳
    const freezeReportCooldownMs = 5 * 60 * 1000; // 5 分钟内不重复报同一类冻结

    setInterval(() => {
      const now = Date.now();
      const timeSinceLastHeartbeat = now - lastHeartbeat;

      // 仅当页面可见时判定冻结：后台 tab 下 setInterval 会被节流到约 1 分钟，会误报
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        lastHeartbeat = now;
        return;
      }
      if (timeSinceLastHeartbeat > 10000 && now - lastFreezeReportAt >= freezeReportCooldownMs) {
        lastFreezeReportAt = now;
        const memory = this.getMemoryUsage();
        this.addLog('error', [
          `[崩溃检测] 检测到可能的页面冻结`,
          `无响应时间: ${Math.round(timeSinceLastHeartbeat / 1000)}秒`,
          memory ? `内存使用: ${Math.round(memory.usedJSHeapSize / 1024 / 1024)}MB / ${Math.round(memory.jsHeapSizeLimit / 1024 / 1024)}MB` : '',
          `建议: 检查是否有长时间运行的同步任务或内存泄漏`
        ]);
      }

      lastHeartbeat = now;
    }, heartbeatInterval);

    ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(eventType => {
      document.addEventListener(eventType, () => {
        lastHeartbeat = Date.now();
      }, { passive: true });
    });
  }
  
  // 内存监控
  private startMemoryMonitoring() {
    setInterval(() => {
      const memory = this.getMemoryUsage();
      if (memory) {
        const usedMB = memory.usedJSHeapSize / 1024 / 1024;
        const limitMB = memory.jsHeapSizeLimit / 1024 / 1024;
        const usagePercent = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;
        
        // 内存使用超过 80% 时警告
        if (usagePercent > 80) {
          this.addLog('warn', [
            `[内存警告] 内存使用率过高`,
            `使用: ${Math.round(usedMB)}MB / ${Math.round(limitMB)}MB`,
            `使用率: ${Math.round(usagePercent)}%`,
            `建议: 检查内存泄漏或关闭不必要的标签页`
          ]);
        }
        
        // 内存使用超过 95% 时严重警告
        if (usagePercent > 95) {
          this.addLog('error', [
            `[内存严重警告] 内存即将耗尽`,
            `使用: ${Math.round(usedMB)}MB / ${Math.round(limitMB)}MB`,
            `使用率: ${Math.round(usagePercent)}%`,
            `风险: 应用可能崩溃，建议立即保存工作并重启`
          ]);
        }
      }
    }, 30000); // 每30秒检查一次
  }
  
  // 性能监控
  private startPerformanceMonitoring() {
    // 最优策略：严重仅 ≥5 秒、5 分钟节流；较长 1s～5s、2 分钟节流，减少 2～3 秒任务的告警噪音
    let lastSevereLongTaskAt = 0;
    let lastMediumLongTaskAt = 0;
    const severeLongTaskThresholdMs = 5000;
    const severeLongTaskCooldownMs = 5 * 60 * 1000;
    const mediumLongTaskThresholdMs = 1000;
    const mediumLongTaskCooldownMs = 2 * 60 * 1000;

    // 监控长任务（可能阻塞 UI）
    if ('PerformanceObserver' in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const duration = entry.duration;
            const name = entry.name || 'Unknown';
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

            const isExpectedLongTask =
              name.includes('ImageCompressor') ||
              name.includes('compress') ||
              name.includes('encode') ||
              name.includes('optimise') ||
              name.includes('zopfli') ||
              name.includes('oxipng') ||
              name.includes('pngquant') ||
              name.includes('avif') ||
              name.includes('webp') ||
              name.includes('AI') ||
              name.includes('embedding');

            if (duration > 200 && !isExpectedLongTask) {
              if (duration > severeLongTaskThresholdMs) {
                const now = Date.now();
                if (now - lastSevereLongTaskAt >= severeLongTaskCooldownMs) {
                  lastSevereLongTaskAt = now;
                  this.addLog('warn', [
                    `[性能瓶颈] 检测到严重长任务`,
                    `耗时: ${Math.round(duration)}ms (${Math.round(duration / 1000)}秒)`,
                    `名称: ${name}`,
                    `建议: 检查是否有阻塞主线程的同步操作，考虑使用 Web Worker`
                  ]);
                }
              } else if (duration > mediumLongTaskThresholdMs) {
                const now = Date.now();
                if (now - lastMediumLongTaskAt >= mediumLongTaskCooldownMs) {
                  lastMediumLongTaskAt = now;
                  this.addLog('warn', [
                    `[性能提示] 检测到较长任务`,
                    `耗时: ${Math.round(duration)}ms`,
                    `名称: ${name}`,
                    `建议: 若频繁出现可考虑优化`
                  ]);
                }
              }
            }
          }
        });
        observer.observe({ entryTypes: ['longtask'] });
      } catch (e) {
        // 浏览器不支持 longtask，忽略
      }
    }
    
    // 监控页面加载性能
    window.addEventListener('load', () => {
      setTimeout(() => {
        const perfData = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        if (perfData) {
          const loadTime = perfData.loadEventEnd - perfData.fetchStart;
          const domContentLoaded = perfData.domContentLoadedEventEnd - perfData.fetchStart;
          
          if (loadTime > 3000) {
            this.addLog('warn', [
              `[性能] 页面加载较慢`,
              `总耗时: ${Math.round(loadTime)}ms`,
              `DOM 就绪: ${Math.round(domContentLoaded)}ms`,
              `建议: 检查资源加载速度或代码优化`
            ]);
          }
        }
      }, 1000);
    });
  }
  
  // 获取内存使用情况（如果可用）
  private getMemoryUsage(): { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } | null {
    try {
      if ('memory' in performance) {
        const memory = (performance as any).memory;
        return {
          usedJSHeapSize: memory.usedJSHeapSize,
          totalJSHeapSize: memory.totalJSHeapSize,
          jsHeapSizeLimit: memory.jsHeapSizeLimit,
        };
      }
    } catch (e) {
      // 忽略错误
    }
    return null;
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

  // 公开的日志添加方法（供外部调用）
  addLog(type: LogEntry['type'], args: any[], stackTrace?: string) {
    // 将参数转换为消息字符串
    let message = '';
    const logArgs: any[] = [];

    const serializeArg = (arg: any): any => {
      if (arg instanceof Error) {
        return { message: arg.message, name: arg.name, stack: arg.stack?.split('\n').slice(0, 5).join('\n') };
      }
      return arg;
    };

    args.forEach((arg, index) => {
      if (index === 0) {
        if (typeof arg === 'string') {
          message = arg;
        } else if (arg instanceof Error) {
          message = `${arg.name}: ${arg.message}`;
        } else {
          try {
            message = JSON.stringify(arg);
          } catch {
            message = String(arg);
          }
        }
      } else {
        logArgs.push(serializeArg(arg));
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

    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    this.schedulePersist();
    this.scheduleNotify();
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
    const msg = error?.message ?? String(error);
    const stack = error?.stack ?? '';
    this.addLog('error', [
      `[React 错误边界] ${msg}`,
      errorInfo?.componentStack ? `组件堆栈:\n${errorInfo.componentStack}` : '',
      stack ? `堆栈: ${stack.slice(0, 500)}` : '',
    ].filter(Boolean));
  }

  private schedulePersist() {
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      try {
        localStorage.setItem('arthub_console_logs', JSON.stringify(this.logs));
      } catch (_) { /* ignore */ }
    }, 2000);
  }

  private scheduleNotify() {
    if (this._notifyTimer) return;
    this._notifyTimer = setTimeout(() => {
      this._notifyTimer = null;
      this.notifyListeners();
    }, 500);
  }

  private notifyListeners() {
    const snapshot = [...this.logs];
    this.listeners.forEach(listener => {
      try {
        listener(snapshot);
      } catch (_) { /* ignore */ }
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
