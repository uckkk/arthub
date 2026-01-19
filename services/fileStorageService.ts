// 文件存储服务 - 使用 Tauri 文件系统 API 将数据存储到用户指定的目录

import { open } from '@tauri-apps/api/dialog';
import { readTextFile, writeTextFile, exists } from '@tauri-apps/api/fs';
import { join } from '@tauri-apps/api/path';

export interface FileStorageConfig {
  enabled: boolean;
  directoryPath: string | null; // 存储路径显示
  lastSyncTime: number | null; // 最后同步时间戳
}

const STORAGE_CONFIG_KEY = 'arthub_file_storage_config';
let cachedStoragePath: string | null = null;

// 获取存储配置
export function getStorageConfig(): FileStorageConfig {
  const saved = localStorage.getItem(STORAGE_CONFIG_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      return { enabled: false, directoryPath: null, lastSyncTime: null };
    }
  }
  return { enabled: false, directoryPath: null, lastSyncTime: null };
}

// 保存存储配置
export function saveStorageConfig(config: Partial<FileStorageConfig>): void {
  const current = getStorageConfig();
  const newConfig: FileStorageConfig = {
    enabled: config.enabled !== undefined ? config.enabled : current.enabled,
    directoryPath: config.directoryPath !== undefined ? config.directoryPath : current.directoryPath,
    lastSyncTime: config.lastSyncTime !== undefined ? config.lastSyncTime : current.lastSyncTime
  };
  localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(newConfig));
}

// 检查是否在 Tauri 环境中
export function isTauriEnvironment(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  // 多种方式检测 Tauri 环境，提高可靠性
  const win = window as any;
  return !!(win.__TAURI__ || win.__TAURI_INTERNALS__ || win.__TAURI_METADATA__);
}

// 让用户选择存储目录
export async function selectStorageDirectory(): Promise<{ path: string } | null> {
  if (!isTauriEnvironment()) {
    throw new Error('此功能仅在 Tauri 桌面应用中可用');
  }

  try {
    const selectedPath = await open({
      directory: true,
      multiple: false,
      title: '选择数据存储目录',
    });

    if (!selectedPath || Array.isArray(selectedPath)) {
      return null; // 用户取消了选择
    }

    const directoryPath = selectedPath as string;
    cachedStoragePath = directoryPath;


    // 更新配置
    saveStorageConfig({
      enabled: true,
      directoryPath: directoryPath,
      lastSyncTime: Date.now()
    });

    return { path: directoryPath };
  } catch (error: any) {
    console.error('选择目录失败:', error);
    throw new Error(`选择目录失败: ${error.message || '未知错误'}`);
  }
}

// 获取已保存的存储路径
export async function getSavedStoragePath(): Promise<string | null> {
  if (cachedStoragePath) {
    return cachedStoragePath;
  }

  const config = getStorageConfig();
  if (config.directoryPath) {
    cachedStoragePath = config.directoryPath;
    return config.directoryPath;
  }

  return null;
}

// 获取数据文件路径
async function getDataFilePath(): Promise<string | null> {
  const storagePath = await getSavedStoragePath();
  if (!storagePath) {
    return null;
  }

  try {
    // 使用 Tauri path API 拼接路径
    const dataFilePath = await join(storagePath, 'arthub_data.json');
    return dataFilePath;
  } catch (error) {
    console.error('获取数据文件路径失败:', error);
    // 如果 join 失败，使用简单拼接
    return `${storagePath}/arthub_data.json`;
  }
}

// 自动同步所有数据到文件（静默导出）
export async function autoSyncToFile(): Promise<boolean> {
  const config = getStorageConfig();
  if (!config.enabled) {
    return false;
  }

  if (!isTauriEnvironment()) {
    return false;
  }

  try {
    const dataFilePath = await getDataFilePath();
    if (!dataFilePath) {
      return false;
    }

    const allData: Record<string, any> = {};
    
    // 收集所有 arthub_ 开头的 localStorage 数据
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('arthub_') && key !== STORAGE_CONFIG_KEY) {
        try {
          const value = localStorage.getItem(key);
          if (value) {
            // 尝试解析 JSON，如果失败则作为字符串存储
            try {
              allData[key] = JSON.parse(value);
            } catch {
              allData[key] = value;
            }
          }
        } catch (error) {
          console.warn(`Failed to export ${key}:`, error);
        }
      }
    }

    // 确保目录存在
    const storagePath = await getSavedStoragePath();
    if (storagePath) {
      try {
        // 使用 Rust 命令写入文件，绕过文件系统作用域限制
        const { invoke } = await import('@tauri-apps/api/tauri');
        await invoke('write_file_with_path', {
          filePath: dataFilePath,
          content: JSON.stringify(allData, null, 2)
        });
      } catch (error: any) {
        // 如果 Rust 命令失败，尝试使用 Tauri FS API（可能受作用域限制）
        console.warn('使用 Rust 命令写入失败，尝试使用 FS API:', error);
        try {
          await writeTextFile(dataFilePath, JSON.stringify(allData, null, 2));
        } catch (fsError: any) {
          console.error('FS API 写入也失败:', fsError);
          throw fsError;
        }
      }
    } else {
      return false;
    }

    // 更新同步时间
    saveStorageConfig({ lastSyncTime: Date.now() });
    
    return true;
  } catch (error) {
    console.error('Auto sync failed:', error);
    return false;
  }
}

// 从文件导入所有数据到 localStorage
export async function importAllDataFromFile(): Promise<void> {
  if (!isTauriEnvironment()) {
    throw new Error('此功能仅在 Tauri 桌面应用中可用');
  }

  try {
    const dataFilePath = await getDataFilePath();
    if (!dataFilePath) {
      throw new Error('未选择存储目录');
    }

    // 检查文件是否存在（优先使用 Rust 命令，绕过作用域限制）
    let fileExists = false;
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      fileExists = await invoke('file_exists_with_path', { filePath: dataFilePath });
    } catch (error) {
      // 如果 Rust 命令失败，尝试使用 Tauri FS API
      try {
        fileExists = await exists(dataFilePath);
      } catch (fsError) {
        console.error('检查文件存在性失败:', fsError);
        throw new Error('无法检查文件是否存在');
      }
    }
    
    if (!fileExists) {
      throw new Error('未找到数据文件，请先导出数据');
    }

    // 读取文件内容（优先使用 Rust 命令）
    let text: string;
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      text = await invoke('read_file_with_path', { filePath: dataFilePath });
    } catch (error) {
      // 如果 Rust 命令失败，尝试使用 Tauri FS API
      try {
        text = await readTextFile(dataFilePath);
      } catch (fsError) {
        console.error('读取文件失败:', fsError);
        throw new Error('无法读取数据文件');
      }
    }
    
    const allData = JSON.parse(text);

    // 导入到 localStorage
    for (const [key, value] of Object.entries(allData)) {
      if (key.startsWith('arthub_')) {
        if (typeof value === 'string') {
          localStorage.setItem(key, value);
        } else {
          localStorage.setItem(key, JSON.stringify(value));
        }
      }
    }
  } catch (error: any) {
    if (error.message?.includes('未找到') || error.message?.includes('NotFound')) {
      throw new Error('未找到数据文件，请先导出数据');
    }
    throw error;
  }
}

// 格式化同步时间显示
export function formatSyncTime(timestamp: number | null): string {
  if (!timestamp) return '从未同步';
  
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  
  if (minutes < 1) return '刚刚同步';
  if (minutes < 60) return `${minutes}分钟前同步`;
  
  // 超过1小时，显示具体时间（精确到分钟）
  const hours = date.getHours().toString().padStart(2, '0');
  const mins = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${mins} 同步`;
}
