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
  if (!appPath || typeof appPath !== 'string') {
    const errorMsg = `无效的应用路径: ${appPath}`;
    console.error('[appService]', errorMsg);
    throw new Error(errorMsg);
  }

  // 规范化路径：确保使用正确的路径分隔符
  let normalizedPath = appPath.trim().replaceAll('/', '\\');
  
  // 检查路径是否为空
  if (!normalizedPath) {
    const errorMsg = '应用路径为空';
    console.error('[appService]', errorMsg);
    throw new Error(errorMsg);
  }

  console.log('[appService] Launching app:', normalizedPath);

  if (!isTauriEnvironment()) {
    // 非 Tauri 环境，尝试使用 window.open
    console.warn('[appService] Not in Tauri environment, using window.open');
    window.open(normalizedPath, '_blank');
    return;
  }

  try {
    // 使用 Rust 后端命令来启动应用（最可靠的方法）
    const { invoke } = await import('@tauri-apps/api/tauri');
    
    console.log('[appService] Invoking launch_app command with path:', normalizedPath);
    
    await invoke('launch_app', { appPath: normalizedPath });
    
    console.log('[appService] App launched successfully via Rust backend');
  } catch (error: any) {
    // 改进错误日志，显示更多信息
    const errorDetails = {
      message: error?.message || String(error),
      code: error?.code,
      path: normalizedPath,
      errorType: error?.constructor?.name,
      stack: error?.stack,
    };
    
    console.error('[appService] 启动应用失败:', errorDetails);
    
    // 抛出包含详细信息的错误
    const finalError = new Error(`无法启动应用: ${normalizedPath}. 原因: ${errorDetails.message || '未知错误'}`);
    (finalError as any).originalError = error;
    throw finalError;
  }
}

// 检查文件是否是应用文件
export function isAppFile(filePath: string): boolean {
  const lowerPath = filePath.toLowerCase();
  return lowerPath.endsWith('.lnk') || lowerPath.endsWith('.exe') || lowerPath.endsWith('.app');
}
