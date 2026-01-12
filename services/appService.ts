// 应用服务 - 处理本地应用的快捷方式和可执行文件

interface AppInfo {
  name: string;
  path: string;
  icon?: string; // base64 图标
}

// 检查是否在 Tauri 环境中
function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// 从文件路径提取应用名称
function extractAppName(filePath: string): string {
  const fileName = filePath.split(/[/\\]/).pop() || '';
  // 移除扩展名
  const nameWithoutExt = fileName.replace(/\.(lnk|exe|app)$/i, '');
  return nameWithoutExt || '未知应用';
}

// 处理拖拽的文件
export async function handleDroppedAppFile(filePath: string): Promise<AppInfo | null> {
  if (!isTauriEnvironment()) {
    // 非 Tauri 环境，使用简单处理
    return {
      name: extractAppName(filePath),
      path: filePath,
    };
  }

  try {
    const { readTextFile, exists } = await import('@tauri-apps/api/fs');
    const { basename, extname } = await import('@tauri-apps/api/path');
    
    const fileName = await basename(filePath);
    const ext = await extname(filePath);
    const lowerExt = ext.toLowerCase();
    
    let targetPath = filePath;
    let appName = extractAppName(filePath);
    
    // 如果是快捷方式 (.lnk)，需要读取目标路径
    if (lowerExt === '.lnk') {
      try {
        // 在 Windows 上，.lnk 文件是二进制文件，需要使用 Tauri 命令来解析
        // 这里我们先尝试使用 shell.open 来获取目标路径
        // 或者我们可以直接使用快捷方式的文件名作为应用名
        appName = extractAppName(fileName);
        
        // 尝试从快捷方式读取目标路径（需要 Rust 后端支持）
        // 暂时使用快捷方式路径本身
        targetPath = filePath;
      } catch (error) {
        console.warn('读取快捷方式失败:', error);
      }
    } else if (lowerExt === '.exe') {
      // 可执行文件，直接使用
      targetPath = filePath;
      appName = extractAppName(fileName);
    } else {
      // 不支持的文件类型
      return null;
    }
    
    // 尝试提取图标（需要 Rust 后端支持）
    // 暂时返回基本信息
    return {
      name: appName,
      path: targetPath,
    };
  } catch (error) {
    console.error('处理应用文件失败:', error);
    return {
      name: extractAppName(filePath),
      path: filePath,
    };
  }
}

// 启动应用
export async function launchApp(appPath: string): Promise<void> {
  if (!isTauriEnvironment()) {
    // 非 Tauri 环境，尝试使用 window.open
    window.open(appPath, '_blank');
    return;
  }

  try {
    // 使用 shell.open 启动应用
    const { open } = await import('@tauri-apps/api/shell');
    await open(appPath);
  } catch (error) {
    console.error('启动应用失败:', error);
    // 降级方案：在 Windows 上使用 cmd start
    try {
      const { Command } = await import('@tauri-apps/api/shell');
      const command = Command.create('cmd', ['/c', 'start', '', `"${appPath}"`]);
      await command.execute();
    } catch (fallbackError) {
      console.error('降级启动方案也失败:', fallbackError);
      throw new Error('无法启动应用');
    }
  }
}

// 检查文件是否是应用文件
export function isAppFile(filePath: string): boolean {
  const lowerPath = filePath.toLowerCase();
  return lowerPath.endsWith('.lnk') || lowerPath.endsWith('.exe') || lowerPath.endsWith('.app');
}
