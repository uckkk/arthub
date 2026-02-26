/**
 * Tauri Invoke 拦截器
 * 拦截所有 Tauri invoke 调用，记录错误和性能数据
 */

import { invoke as originalInvoke } from '@tauri-apps/api/tauri';
import { consoleService } from './consoleService';

// 性能阈值配置
const PERFORMANCE_THRESHOLDS = {
  slow: 1000, // 1秒以上视为慢操作（降低阈值，更敏感）
  verySlow: 5000, // 5秒以上视为非常慢
};

// 重要命令列表（这些命令的调用会详细记录）
const IMPORTANT_COMMANDS = [
  'ai_index_embeddings',
  'ai_search',
  'asset_scan_folder',
  'asset_query',
  'asset_batch_export',
  'ffmpeg_extract_thumbnail',
];

// 统计信息
interface InvokeStats {
  command: string;
  count: number;
  totalTime: number;
  errors: number;
  lastError?: string;
}

const stats = new Map<string, InvokeStats>();

// 标记已拦截，避免 consoleService 重复拦截
if (typeof window !== 'undefined') {
  (window as any).__arthub_tauri_intercepted = true;
}

/**
 * 增强的 invoke 函数，自动记录错误和性能
 */
export async function invoke<T>(cmd: string, args?: Record<string, any>): Promise<T> {
  const startTime = Date.now();
  const startMemory = (performance as any).memory?.usedJSHeapSize;
  const isImportant = IMPORTANT_COMMANDS.includes(cmd);
  const requestId = Math.random().toString(36).substr(2, 9);
  
  // 记录重要命令的开始
  if (isImportant) {
    consoleService.addLog('info', [
      `[Tauri] 开始调用: ${cmd}`,
      args ? `参数: ${JSON.stringify(args).substring(0, 150)}` : '无参数',
      `请求ID: ${requestId}`,
    ]);
  }
  
  try {
    const result = await originalInvoke<T>(cmd, args);
    const duration = Date.now() - startTime;
    const endMemory = (performance as any).memory?.usedJSHeapSize;
    const memoryDelta = endMemory && startMemory ? endMemory - startMemory : undefined;
    
    // 更新统计信息
    const stat = stats.get(cmd) || { command: cmd, count: 0, totalTime: 0, errors: 0 };
    stat.count++;
    stat.totalTime += duration;
    stats.set(cmd, stat);
    
    // 记录重要命令的完成
    if (isImportant) {
      consoleService.addLog('info', [
        `[Tauri] 调用完成: ${cmd}`,
        `耗时: ${duration}ms`,
        memoryDelta ? `内存变化: ${Math.round(memoryDelta / 1024 / 1024)}MB` : '',
        `请求ID: ${requestId}`,
        `结果类型: ${typeof result}`,
      ]);
    }
    
    // 记录慢操作
    if (duration > PERFORMANCE_THRESHOLDS.verySlow) {
      consoleService.addLog('warn', [
        `[性能警告] Tauri 调用耗时过长`,
        `命令: ${cmd}`,
        `耗时: ${duration}ms (${Math.round(duration / 1000)}秒)`,
        memoryDelta ? `内存变化: ${Math.round(memoryDelta / 1024 / 1024)}MB` : '',
        `参数: ${args ? JSON.stringify(args).substring(0, 200) : '无'}`,
        `请求ID: ${requestId}`,
      ]);
    } else if (duration > PERFORMANCE_THRESHOLDS.slow) {
      consoleService.addLog('warn', [
        `[性能提示] Tauri 调用较慢`,
        `命令: ${cmd}`,
        `耗时: ${duration}ms`,
        memoryDelta ? `内存变化: ${Math.round(memoryDelta / 1024 / 1024)}MB` : '',
        `请求ID: ${requestId}`,
      ]);
    }
    
    // 检查结果中是否包含错误
    if (result && typeof result === 'object' && 'error' in result) {
      const errorResult = result as any;
      consoleService.addLog('error', [
        `[Tauri] 命令返回错误结果`,
        `命令: ${cmd}`,
        `错误: ${JSON.stringify(errorResult.error)}`,
        `耗时: ${duration}ms`,
        `请求ID: ${requestId}`,
      ]);
    }
    
    return result;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const errorMessage = error?.message || String(error);
    const errorStack = error?.stack;
    
    // 更新统计信息
    const stat = stats.get(cmd) || { command: cmd, count: 0, totalTime: 0, errors: 0 };
    stat.count++;
    stat.errors++;
    stat.lastError = errorMessage;
    stat.totalTime += duration;
    stats.set(cmd, stat);
    
    // 记录错误详情（详细版本）- 这是关键的错误记录点
    const errorCode = error?.code;
    const errorName = error?.name;
    const endMemory = (performance as any).memory?.usedJSHeapSize;
    const memoryDelta = endMemory && startMemory ? endMemory - startMemory : undefined;
    
    consoleService.addLog('error', [
      `[Tauri 调用失败] ${cmd}`,
      `错误类型: ${errorName || 'Unknown'}`,
      `错误消息: ${errorMessage}`,
      errorCode ? `错误代码: ${errorCode}` : '',
      `耗时: ${duration}ms`,
      `参数: ${args ? JSON.stringify(args).substring(0, 200) : '无'}`,
      `调用次数: ${stat.count}, 错误次数: ${stat.errors}`,
      memoryDelta ? `内存变化: ${Math.round(memoryDelta / 1024 / 1024)}MB` : '',
      `请求ID: ${requestId}`,
      errorStack ? `堆栈:\n${errorStack}` : '',
      { 
        error, 
        stack: errorStack, 
        command: cmd, 
        args,
        duration,
        memoryDelta,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent
      },
    ]);
    
    throw error;
  }
}

/**
 * 获取调用统计信息
 */
export function getInvokeStats(): InvokeStats[] {
  return Array.from(stats.values()).sort((a, b) => b.totalTime - a.totalTime);
}

/**
 * 重置统计信息
 */
export function resetInvokeStats() {
  stats.clear();
}
