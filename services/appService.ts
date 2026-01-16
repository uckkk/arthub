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
    const { basename, extname } = await import('@tauri-apps/api/path');
    
    // 规范化路径：确保使用正确的路径分隔符
    let normalizedPath = filePath.replaceAll('/', '\\');
    
    // 尝试获取文件信息
    let fileName: string;
    let ext: string;
    try {
      fileName = await basename(normalizedPath);
      ext = await extname(normalizedPath);
    } catch (error) {
      // 如果路径解析失败，使用简单提取
      console.warn('[appService] Failed to parse path, using fallback:', error);
      const pathParts = normalizedPath.split('\\');
      fileName = pathParts[pathParts.length - 1] || normalizedPath;
      const lastDot = fileName.lastIndexOf('.');
      ext = lastDot >= 0 ? fileName.substring(lastDot) : '';
    }
    
    const lowerExt = ext.toLowerCase();
    console.log('[appService] Processing file:', {
      originalPath: filePath,
      normalizedPath,
      fileName,
      ext: lowerExt,
    });
    
    let targetPath = normalizedPath;
    let appName = extractAppName(fileName);
    
    // 如果是快捷方式 (.lnk)，需要读取目标路径
    if (lowerExt === '.lnk') {
      // 在 Windows 上，.lnk 文件是二进制文件
      // 暂时使用快捷方式路径本身，启动时会正确处理
      appName = extractAppName(fileName);
      targetPath = normalizedPath;
      console.log('[appService] LNK file detected:', { appName, targetPath });
    } else if (lowerExt === '.exe' || lowerExt === '.bat') {
      // 可执行文件或批处理文件，直接使用
      targetPath = normalizedPath;
      appName = extractAppName(fileName);
      console.log('[appService] EXE/BAT file detected:', { appName, targetPath });
    } else {
      // 不支持的文件类型
      console.warn('[appService] Unsupported file type:', lowerExt, normalizedPath);
      return null;
    }
    
    return {
      name: appName,
      path: targetPath,
    };
  } catch (error) {
    console.error('[appService] Error processing app file:', error, filePath);
    // 降级处理：直接使用路径
    const fallbackName = extractAppName(filePath);
    return {
      name: fallbackName,
      path: filePath.replaceAll('/', '\\'),
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
