/**
 * Tauri invoke 包装器
 * 自动记录所有 invoke 调用，包括性能、错误等信息
 */

import { invoke as originalInvoke } from '@tauri-apps/api/tauri';
import { consoleService } from '../services/consoleService';

interface InvokeOptions {
  /** 是否记录日志（默认：true） */
  log?: boolean;
  /** 慢调用阈值（ms），超过此时间会记录警告（默认：1000） */
  slowThreshold?: number;
  /** 命令描述（用于日志） */
  description?: string;
}

/**
 * 增强的 invoke 函数，自动记录调用信息
 */
export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
  options?: InvokeOptions
): Promise<T> {
  const {
    log = true,
    slowThreshold = 1000,
    description,
  } = options || {};

  const startTime = Date.now();
  const requestId = Math.random().toString(36).substr(2, 9);
  const cmdDescription = description || cmd;

  // 记录调用开始（重要命令）
  const importantCommands = [
    'ai_index_embeddings',
    'ai_search',
    'asset_scan_folder',
    'asset_query',
    'asset_batch_export',
    'ffmpeg_extract_thumbnail',
  ];

  if (log && importantCommands.includes(cmd)) {
    consoleService.addLog('info', [
      `[Tauri] 调用: ${cmdDescription}`,
      args ? `参数: ${JSON.stringify(args).substring(0, 150)}` : '无参数',
      `请求ID: ${requestId}`,
    ]);
  }

  try {
    const result = await originalInvoke<T>(cmd, args);
    const duration = Date.now() - startTime;

    // 记录慢调用
    if (log && duration > slowThreshold) {
      consoleService.addLog('warn', [
        `[Tauri] 命令执行较慢: ${cmdDescription}`,
        `耗时: ${duration}ms (阈值: ${slowThreshold}ms)`,
        `请求ID: ${requestId}`,
        `结果类型: ${typeof result}`,
      ]);
    }

    // 检查结果中是否包含错误
    if (result && typeof result === 'object' && 'error' in result) {
      const errorResult = result as any;
      consoleService.addLog('error', [
        `[Tauri] 命令返回错误: ${cmdDescription}`,
        `错误: ${JSON.stringify(errorResult.error)}`,
        `耗时: ${duration}ms`,
        `请求ID: ${requestId}`,
      ]);
    }

    return result;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const errorMessage = error?.message || String(error);
    const errorCode = error?.code;
    const errorStack = error?.stack;

    // 记录所有错误
    consoleService.addLog('error', [
      `[Tauri] 命令调用失败: ${cmdDescription}`,
      `错误: ${errorMessage}`,
      errorCode ? `错误代码: ${errorCode}` : '',
      `耗时: ${duration}ms`,
      `请求ID: ${requestId}`,
      args ? `参数: ${JSON.stringify(args).substring(0, 200)}` : '',
      { error, stack: errorStack, command: cmd, args },
    ]);

    throw error;
  }
}
