/**
 * 日志诊断收集服务
 * 汇总 consoleService 日志、性能指标、崩溃记录，生成一键复制的诊断报告
 */

import { consoleService } from './consoleService';
import { LogEntry } from '../components/Console';

interface PerfSnapshot {
  heapUsedMB: number;
  heapTotalMB: number;
  timestamp: number;
}

interface CrashRecord {
  message: string;
  stack?: string;
  timestamp: string;
  url: string;
}

const CRASH_STORAGE_KEY = 'arthub_last_crash';
const SESSION_START = Date.now();

class LogCollectorService {
  private perfSnapshots: PerfSnapshot[] = [];
  private perfTimer: ReturnType<typeof setInterval> | null = null;
  private longTaskCount = 0;
  private maxRenderMs = 0;

  constructor() {
    try {
      this.loadCrashFromPreviousSession();
      this.startPerfMonitor();
      this.observeLongTasks();
      this.installCrashGuard();
    } catch {
      // 初始化失败不影响主应用
    }
  }

  /** 记录内存快照（每 30 秒） */
  private startPerfMonitor() {
    const snap = () => {
      const perf = (performance as any).memory;
      if (perf) {
        this.perfSnapshots.push({
          heapUsedMB: +(perf.usedJSHeapSize / 1048576).toFixed(1),
          heapTotalMB: +(perf.totalJSHeapSize / 1048576).toFixed(1),
          timestamp: Date.now(),
        });
        if (this.perfSnapshots.length > 60) this.perfSnapshots.shift();
      }
    };
    snap();
    this.perfTimer = setInterval(snap, 30000);
  }

  /** 监控长任务（>50ms 的主线程阻塞） */
  private observeLongTasks() {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.longTaskCount++;
          if (entry.duration > this.maxRenderMs) {
            this.maxRenderMs = Math.round(entry.duration);
          }
        }
      });
      obs.observe({ type: 'longtask', buffered: true });
    } catch {
      // longtask observer not supported
    }
  }

  /** 是否为可忽略的“崩溃”（如 ResizeObserver 良性提示，不记为崩溃） */
  private isBenignError(message: string): boolean {
    const m = (message || '').toLowerCase();
    return m.includes('resizeobserver loop') || m.includes('resizeobserver loop completed');
  }

  /** 崩溃守卫：在 unload 前保存最后的错误 */
  private installCrashGuard() {
    window.addEventListener('error', (e) => {
      try {
        const message = e.message || 'Unknown error';
        if (this.isBenignError(message)) return;
        const record: CrashRecord = {
          message,
          stack: e.error?.stack,
          timestamp: new Date().toISOString(),
          url: e.filename || location.href,
        };
        localStorage.setItem(CRASH_STORAGE_KEY, JSON.stringify(record));
      } catch { /* ignore */ }
    });

    window.addEventListener('unhandledrejection', (e) => {
      try {
        const message = e.reason?.message || String(e.reason);
        if (this.isBenignError(message)) return;
        const record: CrashRecord = {
          message,
          stack: e.reason?.stack,
          timestamp: new Date().toISOString(),
          url: location.href,
        };
        localStorage.setItem(CRASH_STORAGE_KEY, JSON.stringify(record));
      } catch { /* ignore */ }
    });
  }

  private lastCrash: CrashRecord | null = null;

  private loadCrashFromPreviousSession() {
    try {
      const raw = localStorage.getItem(CRASH_STORAGE_KEY);
      if (raw) {
        this.lastCrash = JSON.parse(raw);
        localStorage.removeItem(CRASH_STORAGE_KEY);
      }
    } catch { /* ignore */ }
  }

  /** 获取统计摘要 */
  getStats() {
    const logs = consoleService.getLogs();
    const errors = logs.filter((l) => l.type === 'error');
    const warns = logs.filter((l) => l.type === 'warn');
    return {
      total: logs.length,
      errors: errors.length,
      warns: warns.length,
      hasLastCrash: !!this.lastCrash,
    };
  }

  /** 生成完整的诊断报告文本 */
  generateReport(): string {
    const logs = consoleService.getLogs();
    const errors = logs.filter((l) => l.type === 'error');
    const warns = logs.filter((l) => l.type === 'warn');

    const lines: string[] = [];
    const hr = '─'.repeat(60);

    // ── 系统信息 ──
    lines.push(`${hr}`);
    lines.push(`ArtHub 诊断报告`);
    lines.push(`生成时间: ${new Date().toLocaleString()}`);
    lines.push(`${hr}`);
    lines.push('');
    lines.push('## 系统环境');
    lines.push(`  UA: ${navigator.userAgent}`);
    lines.push(`  屏幕: ${screen.width}×${screen.height} (DPI: ${devicePixelRatio})`);
    lines.push(`  运行时长: ${Math.round((Date.now() - SESSION_START) / 1000)}s`);

    // ── 性能 ──
    lines.push('');
    lines.push('## 性能指标');
    const lastSnap = this.perfSnapshots[this.perfSnapshots.length - 1];
    if (lastSnap) {
      lines.push(`  内存: ${lastSnap.heapUsedMB} / ${lastSnap.heapTotalMB} MB`);
    }
    lines.push(`  长任务(>50ms): ${this.longTaskCount} 次`);
    if (this.maxRenderMs > 0) {
      lines.push(`  最长阻塞: ${this.maxRenderMs}ms`);
    }

    // ── 上次崩溃 ──
    if (this.lastCrash) {
      lines.push('');
      lines.push('## 上次崩溃');
      lines.push(`  时间: ${this.lastCrash.timestamp}`);
      lines.push(`  消息: ${this.lastCrash.message}`);
      if (this.lastCrash.stack) {
        lines.push(`  堆栈:\n    ${this.lastCrash.stack.split('\n').join('\n    ')}`);
      }
    }

    // ── 日志统计 ──
    lines.push('');
    lines.push(`## 日志统计  (共 ${logs.length} 条, ${errors.length} 错误, ${warns.length} 警告)`);

    // ── 错误日志（全量） ──
    if (errors.length > 0) {
      lines.push('');
      lines.push('## 错误日志');
      errors.forEach((e) => {
        lines.push(this.fmtEntry(e));
      });
    }

    // ── 警告日志（最近 30 条） ──
    if (warns.length > 0) {
      lines.push('');
      lines.push('## 警告日志 (最近 30)');
      warns.slice(-30).forEach((w) => {
        lines.push(this.fmtEntry(w));
      });
    }

    // ── 全量日志（最近 200 条） ──
    lines.push('');
    lines.push('## 完整日志 (最近 200)');
    logs.slice(-200).forEach((l) => {
      lines.push(this.fmtEntry(l));
    });

    lines.push('');
    lines.push(`${hr}`);
    lines.push('报告结束');
    return lines.join('\n');
  }

  private fmtEntry(entry: LogEntry): string {
    const t = new Date(entry.timestamp).toLocaleTimeString();
    const tag = entry.type.toUpperCase().padEnd(5);
    let line = `  [${t}] [${tag}] ${entry.message}`;
    if (entry.args && entry.args.length > 0) {
      for (const arg of entry.args) {
        if (arg && typeof arg === 'object') {
          if (arg._stackTrace) {
            line += `\n    stack: ${arg._stackTrace}`;
          } else if (arg._context) {
            continue;
          } else {
            try { line += `\n    ${JSON.stringify(arg)}`; } catch { /* skip */ }
          }
        }
      }
    }
    return line;
  }

  dispose() {
    if (this.perfTimer) clearInterval(this.perfTimer);
  }
}

export const logCollectorService = new LogCollectorService();
