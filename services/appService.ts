// 应用服务 - 处理本地应用的快捷方式和可执行文件

interface AppInfo {
  name: string;
  path: string;
  icon?: string; // base64 图标
}

// 检查是否在 Tauri 环境中
function isTauriEnvironment(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  // 多种方式检测 Tauri 环境，提高可靠性
  const win = window as any;
  return !!(win.__TAURI__ || win.__TAURI_INTERNALS__ || win.__TAURI_METADATA__);
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
  if (!filePath || typeof filePath !== 'string') {
    console.error('[appService] Invalid file path:', filePath);
    return null;
  }

  // 规范化路径：确保使用正确的路径分隔符
  let normalizedPath = filePath.trim().replaceAll('/', '\\');
  
  // 首先通过扩展名判断文件类型（最可靠的方法）
  const lowerPath = normalizedPath.toLowerCase();
  const isExe = lowerPath.endsWith('.exe');
  const isLnk = lowerPath.endsWith('.lnk');
  const isBat = lowerPath.endsWith('.bat');
  
  if (!isExe && !isLnk && !isBat) {
    console.warn('[appService] File is not an app file (missing .exe/.lnk/.bat extension):', normalizedPath);
    return null;
  }

  // 提取文件名和扩展名（不依赖 Tauri API，更可靠）
  const pathParts = normalizedPath.split('\\');
  const fileName = pathParts[pathParts.length - 1] || normalizedPath;
  const lastDot = fileName.lastIndexOf('.');
  const ext = lastDot >= 0 ? fileName.substring(lastDot).toLowerCase() : '';
  const appName = extractAppName(fileName);

  console.log('[appService] Processing app file:', {
    originalPath: filePath,
    normalizedPath,
    fileName,
    ext,
    appName,
    isExe,
    isLnk,
    isBat,
  });

  // 在 Tauri 环境中，尝试验证文件存在性
  if (isTauriEnvironment()) {
    try {
      const { exists } = await import('@tauri-apps/api/fs');
      const fileExists = await exists(normalizedPath);
      if (!fileExists) {
        console.warn('[appService] File does not exist:', normalizedPath);
        // 仍然返回，因为可能是路径格式问题但文件实际存在
      } else {
        console.log('[appService] File exists:', normalizedPath);
      }
    } catch (error) {
      console.warn('[appService] Failed to check file existence:', error);
      // 继续处理
    }
  }

  // 根据文件类型处理
  let targetPath = normalizedPath;
  
  if (isLnk) {
    // 快捷方式文件，使用路径本身（启动时会正确处理）
    console.log('[appService] LNK file detected:', { appName, targetPath });
  } else if (isExe || isBat) {
    // 可执行文件或批处理文件
    console.log('[appService] EXE/BAT file detected:', { appName, targetPath });
  }

  return {
    name: appName,
    path: targetPath,
  };
}

// 启动应用
export async function launchApp(appPath: string): Promise<void> {
  if (!isTauriEnvironment()) {
    // 非 Tauri 环境，尝试使用 window.open
    window.open(appPath, '_blank');
    return;
  }

  try {
    const lowerPath = appPath.toLowerCase();
    const isLnk = lowerPath.endsWith('.lnk');
    
    // 对于 .lnk 文件，在 Windows 上使用 cmd start 命令来正确启动
    // 这样可以确保启动的是快捷方式指向的应用，而不是打开快捷方式文件本身
    if (isLnk) {
      const { Command } = await import('@tauri-apps/api/shell');
      // 使用 start "" "path" 格式，空字符串表示使用默认窗口标题
      const command = Command.create('cmd', ['/c', 'start', '', `"${appPath}"`]);
      await command.execute();
      return;
    }
    
    // 对于 .exe 和 .bat 文件，使用 shell.open
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
