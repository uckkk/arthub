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
            // 检查数据大小
            if (value.length > 5 * 1024 * 1024) {
              console.warn(`数据太大，跳过导出 ${key} (${(value.length / 1024 / 1024).toFixed(2)}MB)`);
              continue;
            }
            
            // 尝试解析 JSON，如果失败则作为字符串存储
            try {
              const parsed = JSON.parse(value);
              allData[key] = parsed;
            } catch {
              // 不是有效的 JSON，作为字符串存储
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
    
    let allData: Record<string, any>;
    try {
      allData = JSON.parse(text);
    } catch (parseError: any) {
      console.error('解析数据文件失败:', parseError);
      throw new Error(`数据文件格式错误: ${parseError.message}`);
    }

    // 导入到 localStorage（使用原始方法避免触发自动同步，避免循环）
    // 获取真正的原始方法（绕过 autoSync 的包装）
    const originalSetItem = (Storage.prototype as any).__originalSetItem || Storage.prototype.setItem;
    
    let importCount = 0;
    let skipCount = 0;
    const errors: string[] = [];
    
    for (const [key, value] of Object.entries(allData)) {
      if (key.startsWith('arthub_')) {
        try {
          let valueToStore: string;
          
          if (typeof value === 'string') {
            valueToStore = value;
          } else {
            // 尝试序列化，如果失败则跳过
            try {
              valueToStore = JSON.stringify(value);
            } catch (stringifyError: any) {
              console.warn(`序列化数据失败 ${key}:`, stringifyError);
              errors.push(`${key}: 序列化失败 - ${stringifyError.message}`);
              skipCount++;
              continue;
            }
          }
          
          // 检查数据大小（localStorage 通常限制为 5-10MB）
          if (valueToStore.length > 5 * 1024 * 1024) {
            console.warn(`数据太大，跳过 ${key} (${(valueToStore.length / 1024 / 1024).toFixed(2)}MB)`);
            errors.push(`${key}: 数据太大 (${(valueToStore.length / 1024 / 1024).toFixed(2)}MB)`);
            skipCount++;
            continue;
          }
          
          // 关键修复：对于 API 配置等关键设置，如果 localStorage 中已有非空值，优先保留
          // 这确保用户最新输入的值不会被文件中的旧值覆盖
          const existingValue = localStorage.getItem(key);
          const isApiConfig = key === 'arthub_gemini_key' || 
                             key === 'arthub_baidu_appid' || 
                             key === 'arthub_baidu_secret';
          
          if (isApiConfig && existingValue && existingValue.trim() !== '') {
            // localStorage 中已有非空的 API 配置，优先保留用户的最新输入
            // 只有当文件中的值明显不同且不是空字符串时，才考虑更新
            // 但为了安全，我们完全保留 localStorage 中的值
            console.log(`保留 localStorage 中的 ${key} 值，跳过文件导入（用户最新输入优先）`);
            skipCount++;
            continue;
          }
          
          // 对于其他数据，如果 localStorage 中已有值且文件中的值相同，跳过（避免不必要的写入）
          if (existingValue === valueToStore) {
            skipCount++;
            continue;
          }
          
          originalSetItem.call(localStorage, key, valueToStore);
          importCount++;
        } catch (error: any) {
          console.warn(`导入数据失败 ${key}:`, error);
          errors.push(`${key}: ${error.message || String(error)}`);
          skipCount++;
        }
      }
    }
    
    if (importCount > 0) {
      console.log(`成功从文件导入 ${importCount} 条数据`);
    }
    if (skipCount > 0) {
      console.warn(`跳过 ${skipCount} 条数据（错误或数据过大）`);
      if (errors.length > 0) {
        console.warn('导入错误详情:', errors);
      }
    }
  } catch (error: any) {
    if (error.message?.includes('未找到') || error.message?.includes('NotFound')) {
      throw new Error('未找到数据文件，请先导出数据');
    }
    throw error;
  }
}

// 自动从文件导入数据（静默执行，不抛出错误）
// 如果本地文件夹存在但配置未启用，会自动启用配置
// 返回导入结果详情
export interface ImportResult {
  success: boolean;
  imported: boolean; // 是否实际导入了数据
  message?: string; // 提示消息
}

export async function autoImportFromFile(): Promise<ImportResult> {
  if (!isTauriEnvironment()) {
    return false;
  }

  let config = getStorageConfig();
  
  // 如果配置未启用，先检查是否有已保存的路径
  if (!config.enabled && config.directoryPath) {
    // 检查数据文件是否存在
    try {
      const dataFilePath = await getDataFilePath();
      if (dataFilePath) {
        // 检查文件是否存在
        let fileExists = false;
        try {
          const { invoke } = await import('@tauri-apps/api/tauri');
          fileExists = await invoke('file_exists_with_path', { filePath: dataFilePath });
        } catch (error) {
          try {
            fileExists = await exists(dataFilePath);
          } catch (fsError) {
            console.warn('检查文件存在性失败:', fsError);
          }
        }
        
        // 如果文件存在，自动启用配置
        if (fileExists) {
          console.log('检测到本地数据文件，自动启用文件存储');
          saveStorageConfig({ enabled: true });
          config = getStorageConfig();
        }
      }
    } catch (error) {
      console.warn('检查本地数据文件失败:', error);
    }
  }

  // 如果配置仍未启用，尝试从常见位置查找数据文件
  if (!config.enabled) {
    // 尝试从应用数据目录查找
    try {
      const { appDataDir } = await import('@tauri-apps/api/path');
      const appDataPath = await appDataDir();
      const possiblePaths = [
        await join(appDataPath, 'arthub_data.json'),
        await join(appDataPath, '..', 'arthub_data.json'),
      ];
      
      for (const possiblePath of possiblePaths) {
        try {
          let fileExists = false;
          try {
            const { invoke } = await import('@tauri-apps/api/tauri');
            fileExists = await invoke('file_exists_with_path', { filePath: possiblePath });
          } catch {
            fileExists = await exists(possiblePath);
          }
          
          if (fileExists) {
            // 找到数据文件，自动启用配置并设置路径
            const directoryPath = possiblePath.substring(0, possiblePath.lastIndexOf('/') || possiblePath.lastIndexOf('\\'));
            console.log('在应用数据目录找到数据文件，自动启用文件存储:', directoryPath);
            saveStorageConfig({ 
              enabled: true, 
              directoryPath: directoryPath 
            });
            config = getStorageConfig();
            break;
          }
        } catch (error) {
          // 忽略单个路径检查错误
        }
      }
    } catch (error) {
      // 忽略自动查找错误
    }
  }

  // 如果配置已启用，尝试导入数据
  if (!config.enabled) {
    return { success: true, imported: false };
  }

  try {
    // 记录导入前的API配置状态（用于判断是否有新数据导入）
    const beforeImport = {
      geminiKey: localStorage.getItem('arthub_gemini_key') || '',
      baiduAppId: localStorage.getItem('arthub_baidu_appid') || '',
      baiduSecret: localStorage.getItem('arthub_baidu_secret') || '',
    };
    
    // 检查导入前是否有API配置
    const hadApiBeforeImport = !!(beforeImport.geminiKey || beforeImport.baiduAppId || beforeImport.baiduSecret);
    
    await importAllDataFromFile();
    
    // 检查导入后的API配置状态
    const afterImport = {
      geminiKey: localStorage.getItem('arthub_gemini_key') || '',
      baiduAppId: localStorage.getItem('arthub_baidu_appid') || '',
      baiduSecret: localStorage.getItem('arthub_baidu_secret') || '',
    };
    
    // 判断是否有API配置被导入（只在新导入时显示提示）
    // 如果导入前没有API配置，导入后有，说明是从文件恢复了
    const hasApiImported = !hadApiBeforeImport && 
      (!!afterImport.geminiKey || !!afterImport.baiduAppId || !!afterImport.baiduSecret);
    
    if (hasApiImported) {
      return { 
        success: true, 
        imported: true,
        message: '本地信息已同步'
      };
    }
    
    // 如果导入前已有API配置，说明用户已经设置过，不显示同步提示
    // 这样可以避免覆盖用户最新输入的值
    return { success: true, imported: false };
  } catch (error: any) {
    // 静默处理错误（文件不存在等是正常情况）
    if (error.message?.includes('未找到') || error.message?.includes('未选择')) {
      return { success: true, imported: false };
    }
    console.warn('自动导入数据失败:', error);
    return { success: false, imported: false };
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
