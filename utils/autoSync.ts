// 自动同步工具 - 监听 localStorage 变化并自动同步到文件

import { autoSyncToFile, getStorageConfig } from '../services/fileStorageService';

let syncTimer: NodeJS.Timeout | null = null;
const SYNC_DELAY = 1000; // 1秒延迟，避免频繁同步

// 防抖同步函数
function debouncedSync() {
  if (syncTimer) {
    clearTimeout(syncTimer);
  }
  
  syncTimer = setTimeout(async () => {
    const config = getStorageConfig();
    if (config.enabled) {
      await autoSyncToFile();
    }
  }, SYNC_DELAY);
}

// 包装 localStorage.setItem，添加自动同步
const originalSetItem = Storage.prototype.setItem;
Storage.prototype.setItem = function(key: string, value: string) {
  originalSetItem.call(this, key, value);
  
  // 如果是 arthub_ 开头的键，触发自动同步
  if (key.startsWith('arthub_') && key !== 'arthub_file_storage_config') {
    debouncedSync();
  }
};

// 包装 localStorage.removeItem，添加自动同步
const originalRemoveItem = Storage.prototype.removeItem;
Storage.prototype.removeItem = function(key: string) {
  originalRemoveItem.call(this, key);
  
  // 如果是 arthub_ 开头的键，触发自动同步
  if (key.startsWith('arthub_') && key !== 'arthub_file_storage_config') {
    debouncedSync();
  }
};

// 初始化时执行一次同步（如果已启用）
export function initAutoSync() {
  const config = getStorageConfig();
  if (config.enabled) {
    // 延迟执行，确保页面加载完成
    setTimeout(() => {
      autoSyncToFile();
    }, 2000);
  }
}

