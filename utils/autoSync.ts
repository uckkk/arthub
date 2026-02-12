// 自动同步工具 - 监听 localStorage 变化并自动同步到文件

import { autoSyncToFile, getStorageConfig } from '../services/fileStorageService';

let syncTimer: NodeJS.Timeout | null = null;
let isSyncing = false; // 防止重复同步
let isAuthReady = false; // 认证是否就绪（阻止未认证时触发文件写入）
const SYNC_DELAY = 100; // 100ms 延迟，批量操作时避免频繁同步

// 设置认证就绪状态（由 App.tsx 认证成功后调用）
export function setAutoSyncAuthReady(ready: boolean) {
  isAuthReady = ready;
}

// 立即同步函数（使用微任务队列确保立即执行）
async function immediateSync() {
  // 如果认证未就绪，静默跳过（避免未登录时触发文件写入失败）
  if (!isAuthReady) {
    return;
  }

  // 如果正在同步，跳过
  if (isSyncing) {
    return;
  }

  // 清除之前的延迟同步
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }

  // 使用微任务队列立即执行同步
  await Promise.resolve();
  
  const config = getStorageConfig();
  if (config.enabled) {
    isSyncing = true;
    try {
      await autoSyncToFile();
    } catch (error) {
      console.error('自动同步失败:', error);
    } finally {
      isSyncing = false;
    }
  }
}

// 防抖同步函数（用于批量操作）
function debouncedSync() {
  if (syncTimer) {
    clearTimeout(syncTimer);
  }
  
  syncTimer = setTimeout(async () => {
    await immediateSync();
  }, SYNC_DELAY);
}

// 包装 localStorage.setItem，添加自动同步
const originalSetItem = Storage.prototype.setItem;
// 保存原始方法引用，供导入数据时使用
(Storage.prototype as any).__originalSetItem = originalSetItem;

Storage.prototype.setItem = function(key: string, value: string) {
  originalSetItem.call(this, key, value);
  
  // 如果是 arthub_ 开头的键，立即触发自动同步
  if (key.startsWith('arthub_') && key !== 'arthub_file_storage_config') {
    immediateSync();
  }
};

// 包装 localStorage.removeItem，添加自动同步
const originalRemoveItem = Storage.prototype.removeItem;
Storage.prototype.removeItem = function(key: string) {
  originalRemoveItem.call(this, key);
  
  // 如果是 arthub_ 开头的键，立即触发自动同步
  if (key.startsWith('arthub_') && key !== 'arthub_file_storage_config') {
    immediateSync();
  }
};

// 包装 localStorage.clear，添加自动同步
const originalClear = Storage.prototype.clear;
Storage.prototype.clear = function() {
  originalClear.call(this);
  
  // clear 操作后立即同步
  immediateSync();
};

// 初始化时执行一次同步（如果已启用）
export function initAutoSync() {
  // 标记认证已就绪（initAutoSync 只在认证成功后调用）
  isAuthReady = true;

  const config = getStorageConfig();
  if (config.enabled) {
    // 延迟执行，确保页面加载完成
    setTimeout(async () => {
      await immediateSync();
    }, 2000);
  }
}

// 导出立即同步函数，供外部调用
export { immediateSync as syncNow };

