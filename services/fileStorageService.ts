// 文件存储服务 - 使用 File System Access API 将数据存储到用户指定的目录

// File System Access API 类型定义
declare global {
  interface Window {
    showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
  }
}

interface FileSystemDirectoryHandle {
  name: string;
  kind: 'directory';
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
  createWritable?(): Promise<FileSystemWritableStream>;
}

interface FileSystemFileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableStream>;
}

interface FileSystemWritableStream {
  write(data: string | Blob): Promise<void>;
  close(): Promise<void>;
}

export interface FileStorageConfig {
  enabled: boolean;
  directoryPath: string | null; // 存储路径显示
  lastSyncTime: number | null; // 最后同步时间戳
}

const STORAGE_CONFIG_KEY = 'arthub_file_storage_config';
const DIRECTORY_HANDLE_KEY = 'arthub_directory_handle';
let cachedDirectoryHandle: FileSystemDirectoryHandle | null = null;

// 使用 IndexedDB 存储 directoryHandle
async function saveDirectoryHandleToIndexedDB(handle: FileSystemDirectoryHandle): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('arthub_storage', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['handles'], 'readwrite');
      const store = transaction.objectStore('handles');
      store.put(handle, DIRECTORY_HANDLE_KEY);
      resolve();
    };
    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('handles')) {
        db.createObjectStore('handles');
      }
    };
  });
}

async function getDirectoryHandleFromIndexedDB(): Promise<FileSystemDirectoryHandle | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('arthub_storage', 1);
    
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('handles')) {
        resolve(null);
        return;
      }
      const transaction = db.transaction(['handles'], 'readonly');
      const store = transaction.objectStore('handles');
      const getRequest = store.get(DIRECTORY_HANDLE_KEY);
      getRequest.onsuccess = () => resolve(getRequest.result || null);
      getRequest.onerror = () => resolve(null);
    };
    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('handles')) {
        db.createObjectStore('handles');
      }
    };
  });
}

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

// 检查浏览器是否支持 File System Access API
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

// 尝试获取目录的完整路径
async function getDirectoryPath(handle: FileSystemDirectoryHandle): Promise<string> {
  try {
    // File System Access API 不直接提供完整路径
    // 尝试通过其他方式获取
    if ((handle as any).getDirectoryHandle) {
      // 如果支持，尝试获取路径
      const name = handle.name;
      
      // 在某些浏览器中，可以通过 query 获取路径信息
      // 但大多数情况下只能获取目录名
      return name;
    }
    return handle.name;
  } catch {
    return handle.name;
  }
}

// 让用户选择存储目录
export async function selectStorageDirectory(): Promise<{ handle: FileSystemDirectoryHandle; path: string } | null> {
  if (!isFileSystemAccessSupported()) {
    throw new Error('您的浏览器不支持文件系统访问 API，请使用 Chrome 86+、Edge 86+ 或 Opera 72+');
  }

  try {
    const directoryHandle = await window.showDirectoryPicker({
      mode: 'readwrite'
    }) as any;
    
    // 保存到 IndexedDB
    await saveDirectoryHandleToIndexedDB(directoryHandle);
    cachedDirectoryHandle = directoryHandle;
    
    // 尝试获取完整路径
    const fullPath = await getDirectoryPath(directoryHandle);
    
    // 更新配置
    saveStorageConfig({
      enabled: true,
      directoryPath: fullPath,
      lastSyncTime: Date.now()
    });
    
    return { handle: directoryHandle, path: fullPath };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return null; // 用户取消了选择
    }
    throw error;
  }
}

// 获取已保存的目录句柄
export async function getSavedDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (cachedDirectoryHandle) {
    return cachedDirectoryHandle;
  }
  
  const handle = await getDirectoryHandleFromIndexedDB();
  if (handle) {
    cachedDirectoryHandle = handle;
  }
  return handle;
}

// 自动同步所有数据到文件（静默导出）
export async function autoSyncToFile(): Promise<boolean> {
  const config = getStorageConfig();
  if (!config.enabled) {
    return false;
  }

  try {
    const directoryHandle = await getSavedDirectoryHandle();
    if (!directoryHandle) {
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

    // 写入文件
    const fileHandle = await directoryHandle.getFileHandle('arthub_data.json', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(allData, null, 2));
    await writable.close();

    // 更新同步时间
    saveStorageConfig({ lastSyncTime: Date.now() });
    
    return true;
  } catch (error) {
    console.error('Auto sync failed:', error);
    return false;
  }
}

// 从文件导入所有数据到 localStorage
export async function importAllDataFromFile(directoryHandle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const fileHandle = await directoryHandle.getFileHandle('arthub_data.json');
    const file = await fileHandle.getFile();
    const text = await file.text();
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
    if (error.name === 'NotFoundError') {
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

