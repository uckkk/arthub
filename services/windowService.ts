/**
 * 窗口管理服务
 * 用于管理已打开的网页窗口，避免重复打开相同URL
 */

// 存储URL到窗口引用的映射
const openWindows = new Map<string, Window | null>();

// 存储正在打开的URL（用于防抖）
const openingUrls = new Set<string>();

/**
 * 规范化URL（去除hash和query参数，只保留基础URL用于匹配）
 * 或者保留完整URL用于精确匹配
 */
function normalizeUrl(url: string, exactMatch: boolean = false): string {
  try {
    const urlObj = new URL(url);
    if (exactMatch) {
      // 精确匹配：保留完整URL
      return urlObj.href;
    } else {
      // 基础匹配：只保留协议、主机和路径
      return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
    }
  } catch {
    // 如果不是有效URL，直接返回原字符串
    return url;
  }
}

/**
 * 生成窗口名称（用于window.open的第二个参数）
 */
function generateWindowName(url: string): string {
  // 使用URL的hash作为窗口名称，确保相同URL使用相同名称
  try {
    const urlObj = new URL(url);
    // 使用协议+主机+路径作为窗口名称的基础
    const base = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
    // 生成一个简短的hash
    let hash = 0;
    for (let i = 0; i < base.length; i++) {
      const char = base.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为32位整数
    }
    return `arthub_window_${Math.abs(hash)}`;
  } catch {
    // 如果URL无效，使用URL字符串的hash
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `arthub_window_${Math.abs(hash)}`;
  }
}

/**
 * 检查窗口是否仍然打开（处理跨域情况）
 */
function isWindowOpen(windowRef: Window | null): boolean {
  if (!windowRef) {
    return false;
  }
  
  try {
    // 首先尝试访问closed属性
    // 注意：对于跨域窗口，访问closed可能会抛出异常
    let closed: boolean;
    try {
      closed = windowRef.closed;
      if (closed) {
        return false;
      }
    } catch (e) {
      // 跨域窗口：无法访问closed属性
      // 尝试其他方法来检测
    }
    
    // 尝试访问窗口的其他属性来检测跨域情况
    try {
      // 尝试访问窗口的location（跨域会抛出异常）
      const _ = windowRef.location;
      // 如果能访问location，说明同源，可以正常检查closed
      return !windowRef.closed;
    } catch (e) {
      // 跨域情况：无法访问location
      // 尝试focus窗口，如果成功说明窗口还存在
      try {
        windowRef.focus();
        // 如果能focus，说明窗口还存在
        // 但为了更可靠，我们再尝试一次focus
        windowRef.focus();
        return true;
      } catch (focusError) {
        // 无法focus，窗口可能已关闭
        // 但有些浏览器在跨域情况下也无法focus，所以这不是100%可靠
        // 我们假设如果无法focus，窗口可能已关闭
        return false;
      }
    }
  } catch (error) {
    // 任何其他错误都认为窗口已关闭
    return false;
  }
}

/**
 * 检查并激活已打开的窗口
 */
function tryFocusWindow(windowRef: Window | null, url: string): boolean {
  if (!isWindowOpen(windowRef)) {
    return false;
  }
  
  try {
    windowRef.focus();
    console.log(`[WindowService] 窗口已存在，已激活: ${url}`);
    return true;
  } catch (error) {
    // 跨域或其他原因无法访问窗口
    console.warn('[WindowService] 无法激活窗口:', error);
    return false;
  }
}

/**
 * 打开URL，如果已打开则激活窗口
 * @param url 要打开的URL
 * @param target 窗口目标（默认为 '_blank'）
 * @param exactMatch 是否精确匹配URL（包括query和hash），默认false（只匹配基础URL）
 * @returns 窗口引用
 */
export function openUrl(url: string, target: string = '_blank', exactMatch: boolean = false): Window | null {
  // 立即输出明显的日志
  console.log('🔵 [WindowService] ========== openUrl 被调用 ==========');
  console.log('🔵 [WindowService] URL:', url);
  console.log('🔵 [WindowService] target:', target);
  console.log('🔵 [WindowService] exactMatch:', exactMatch);
  
  if (!url) {
    console.warn('[WindowService] URL为空，无法打开');
    return null;
  }

  const normalizedUrl = normalizeUrl(url, exactMatch);
  const windowName = generateWindowName(normalizedUrl);
  
  console.log(`🔵 [WindowService] 准备打开URL: ${url}`);
  console.log(`🔵 [WindowService] 规范化URL: ${normalizedUrl}`);
  console.log(`🔵 [WindowService] 窗口名称: ${windowName}`);
  console.log(`🔵 [WindowService] 当前打开的窗口映射:`, Array.from(openWindows.keys()));
  console.log(`🔵 [WindowService] 正在打开的URL:`, Array.from(openingUrls));
  
  // 检查是否正在打开此URL（防抖）
  if (openingUrls.has(normalizedUrl)) {
    console.log(`🔵 [WindowService] URL正在打开中，跳过重复请求: ${url}`);
    // 尝试获取已存在的窗口引用并激活
    const existingWindow = openWindows.get(normalizedUrl);
    if (existingWindow) {
      if (isWindowOpen(existingWindow)) {
        console.log(`🔵 [WindowService] 激活已存在的窗口: ${url}`);
        tryFocusWindow(existingWindow, url);
        return existingWindow;
      } else {
        // 窗口已关闭，清除标记，允许重新打开
        console.log(`🔵 [WindowService] 窗口已关闭，清除打开标记: ${url}`);
        openingUrls.delete(normalizedUrl);
        openWindows.delete(normalizedUrl);
      }
    } else {
      // 没有窗口引用，但正在打开中，等待一下
      console.log(`🔵 [WindowService] 等待窗口打开完成: ${url}`);
      return null;
    }
  }
  
  // 检查是否已有窗口打开此URL
  const existingWindow = openWindows.get(normalizedUrl);
  
  if (existingWindow) {
    console.log(`🔵 [WindowService] 找到已存在的窗口引用，检查窗口状态...`);
    // 检查窗口是否仍然打开
    if (isWindowOpen(existingWindow)) {
      console.log(`🔵 [WindowService] 窗口仍然打开，尝试激活...`);
      // 窗口已存在且未关闭，尝试激活
      if (tryFocusWindow(existingWindow, url)) {
        console.log(`🔵 [WindowService] 成功激活已存在的窗口: ${url}`);
        return existingWindow;
      } else {
        // 窗口引用无效，从映射中移除
        console.log(`🔵 [WindowService] 窗口引用无效，从映射中移除: ${normalizedUrl}`);
        openWindows.delete(normalizedUrl);
      }
    } else {
      // 窗口已关闭，从映射中移除
      console.log(`🔵 [WindowService] 窗口已关闭，从映射中移除: ${normalizedUrl}`);
      openWindows.delete(normalizedUrl);
    }
  } else {
    console.log(`🔵 [WindowService] 没有找到已存在的窗口引用`);
  }
  
  // 标记为正在打开
  openingUrls.add(normalizedUrl);

  // 使用窗口名称打开（如果窗口已存在，会复用该窗口）
  // 关键：使用相同的窗口名称，浏览器会自动复用已存在的窗口
  let newWindow: Window | null = null;
  try {
    console.log(`[WindowService] 调用 window.open(${url}, ${windowName})`);
    // 使用窗口名称打开，如果窗口名称已存在且窗口仍然打开，浏览器会复用
    // 这是关键：浏览器会自动处理窗口复用，我们只需要使用相同的窗口名称
    newWindow = window.open(url, windowName);
    
    if (newWindow) {
      console.log(`[WindowService] window.open 返回窗口引用`);
      
      // 检查这是新窗口还是已存在的窗口
      const wasExisting = openWindows.has(normalizedUrl);
      const previousWindow = openWindows.get(normalizedUrl);
      
      // 更新映射中的窗口引用
      openWindows.set(normalizedUrl, newWindow);
      
      // 判断是否是新窗口
      if (wasExisting && previousWindow && newWindow === previousWindow) {
        // 这是已存在的窗口，已经被激活（浏览器复用了窗口）
        console.log(`[WindowService] 浏览器复用已存在的窗口（引用相同）: ${url}`);
      } else {
        // 可能是新窗口，也可能是浏览器返回了新的引用
        // 尝试检查新窗口的URL来判断（仅用于日志）
        let isNewWindow = true;
        try {
          // 尝试访问location来判断（仅用于日志）
          const currentUrl = newWindow.location.href;
          console.log(`[WindowService] 窗口当前URL: ${currentUrl}`);
          // 如果URL匹配，说明可能是同一个窗口
          if (currentUrl === url || currentUrl.startsWith(normalizeUrl(url, false))) {
            console.log(`[WindowService] 可能是复用窗口（URL匹配）: ${url}`);
            isNewWindow = false;
          }
        } catch (e) {
          // 跨域，无法访问location
          console.log(`[WindowService] 跨域窗口，无法判断URL: ${url}`);
        }
        
        if (isNewWindow) {
          console.log(`[WindowService] 打开新窗口: ${url}`);
          setupWindowCloseListener(normalizedUrl, newWindow, url);
        } else {
          console.log(`[WindowService] 可能是复用窗口: ${url}`);
          // 即使是复用窗口，也设置监听器（以防万一）
          setupWindowCloseListener(normalizedUrl, newWindow, url);
        }
      }
      
      // 窗口打开后，移除"正在打开"标记（延迟一点，确保窗口完全打开）
      // 增加延迟时间，确保在窗口完全加载之前不会重复打开
      setTimeout(() => {
        openingUrls.delete(normalizedUrl);
        console.log(`🔵 [WindowService] 移除打开标记: ${normalizedUrl}`);
      }, 1000); // 增加到1秒
    } else {
      console.warn('[WindowService] 无法打开窗口，可能被浏览器阻止');
      // 移除"正在打开"标记
      openingUrls.delete(normalizedUrl);
    }
  } catch (error) {
    console.error('[WindowService] 打开窗口时出错:', error);
    // 移除"正在打开"标记
    openingUrls.delete(normalizedUrl);
  }
  
  return newWindow;
}

/**
 * 设置窗口关闭监听器
 */
function setupWindowCloseListener(normalizedUrl: string, windowRef: Window | null, originalUrl: string): void {
  if (!windowRef) return;
  
  // 监听窗口关闭事件（通过轮询检查）
  const checkInterval = setInterval(() => {
    if (!isWindowOpen(windowRef)) {
      clearInterval(checkInterval);
      // 只有在映射中的引用仍然是这个窗口时才删除
      if (openWindows.get(normalizedUrl) === windowRef) {
        openWindows.delete(normalizedUrl);
        console.log(`[WindowService] 检测到窗口已关闭: ${normalizedUrl}`);
      }
    }
  }, 1000);
  
  // 30秒后停止检查（避免内存泄漏）
  setTimeout(() => {
    clearInterval(checkInterval);
  }, 30000);
}

/**
 * 使用Tauri shell.open打开URL（用于Tauri环境）
 * 在浏览器环境中会回退到window.open
 */
export async function openUrlWithShell(url: string, exactMatch: boolean = false): Promise<void> {
  if (!url) {
    console.warn('URL为空，无法打开');
    return;
  }

  const normalizedUrl = normalizeUrl(url, exactMatch);
  
  // 检查是否已有窗口打开此URL
  const existingWindow = openWindows.get(normalizedUrl);
  
  if (existingWindow) {
    // 检查窗口是否仍然打开
    if (isWindowOpen(existingWindow)) {
      // 窗口已存在且未关闭，尝试激活
      if (tryFocusWindow(existingWindow, url)) {
        return;
      } else {
        // 窗口引用无效，从映射中移除
        openWindows.delete(normalizedUrl);
      }
    } else {
      // 窗口已关闭，从映射中移除
      openWindows.delete(normalizedUrl);
    }
  }

  // 尝试使用Tauri shell.open
  try {
    const isTauri = typeof window !== 'undefined' && (window as any).__TAURI__;
    
    if (isTauri) {
      const { open } = await import('@tauri-apps/api/shell');
      await open(url);
      console.log(`使用Tauri打开: ${url}`);
      
      // 注意：Tauri的shell.open会在系统默认浏览器中打开，无法获取窗口引用
      // 所以这里我们使用一个标记来表示URL已打开
      // 但由于无法获取窗口引用，我们无法真正检测窗口是否关闭
      // 所以这里暂时不存储引用，让每次调用都打开新窗口
      // 如果需要更好的控制，可以考虑使用Tauri的Window API创建内嵌浏览器窗口
    } else {
      // 非Tauri环境，使用window.open
      const newWindow = openUrl(url, '_blank', exactMatch);
      if (!newWindow) {
        console.warn('无法打开窗口');
      }
    }
  } catch (error) {
    console.error('使用shell打开时出错:', error);
    // 回退到window.open
    try {
      const newWindow = openUrl(url, '_blank', exactMatch);
      if (!newWindow) {
        console.warn('回退到window.open也失败');
      }
    } catch (fallbackError) {
      console.error('回退打开方式也失败:', fallbackError);
    }
  }
}

/**
 * 清理所有窗口引用（用于应用关闭时）
 */
export function clearAllWindows(): void {
  openWindows.clear();
}

/**
 * 获取当前打开的窗口数量
 */
export function getOpenWindowCount(): number {
  // 清理已关闭的窗口引用
  for (const [url, windowRef] of openWindows.entries()) {
    if (!isWindowOpen(windowRef)) {
      openWindows.delete(url);
    }
  }
  return openWindows.size;
}
