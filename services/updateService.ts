/**
 * 更新检查服务
 * 检查 GitHub Releases 获取最新版本
 */

const GITHUB_REPO = 'uckkk/arthub';

// 从 package.json 读取版本号（构建时会被替换）
// 如果无法读取，使用默认值
let CURRENT_VERSION = '1.0.1';

// 尝试从环境变量或 window 对象读取版本号（构建时注入）
try {
  // 优先使用构建时注入的版本号（process.env 在 Vite 构建时会被替换为字符串字面量）
  // 注意：在浏览器环境中，process.env 可能不存在，但 Vite 会在构建时替换
  if (typeof process !== 'undefined' && (process as any).env) {
    const envVersion = (process as any).env.APP_VERSION;
    // Vite 会将 process.env.APP_VERSION 替换为 JSON.stringify(APP_VERSION)
    // 所以这里需要检查是否是有效的字符串（不是 "undefined"）
    if (envVersion && typeof envVersion === 'string' && envVersion !== 'undefined' && envVersion !== 'null') {
      // 移除可能的引号（Vite 可能已经添加了）
      CURRENT_VERSION = envVersion.replace(/^["']|["']$/g, '');
    }
  }
  
  // 尝试从 window 对象读取（构建时注入）
  // Vite 会将 window.__APP_VERSION__ 替换为 JSON.stringify(APP_VERSION)
  if (typeof window !== 'undefined') {
    const windowVersion = (window as any).__APP_VERSION__;
    if (windowVersion && typeof windowVersion === 'string' && windowVersion !== 'undefined' && windowVersion !== 'null') {
      // 移除可能的引号
      CURRENT_VERSION = windowVersion.replace(/^["']|["']$/g, '');
    }
  }
} catch (e) {
  // 如果读取失败，使用默认值
  console.warn('无法读取版本号，使用默认值:', e);
}

// 确保版本号是字符串类型且不为空
if (typeof CURRENT_VERSION !== 'string' || !CURRENT_VERSION || CURRENT_VERSION === 'undefined' || CURRENT_VERSION === 'null') {
  CURRENT_VERSION = '1.0.1';
}

interface ReleaseInfo {
  version: string;
  tagName: string;
  publishedAt: string;
  releaseNotes: string;
  downloadUrl: string;
  assets: {
    name: string;
    downloadUrl: string;
    size: number;
  }[];
}

interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string | null;
  releaseInfo: ReleaseInfo | null;
  error: string | null;
}

/**
 * 比较版本号
 * @returns 1 如果 v1 > v2, -1 如果 v1 < v2, 0 如果相等
 */
const compareVersions = (v1: string, v2: string): number => {
  const parts1 = v1.replace(/^v/, '').split('.').map(Number);
  const parts2 = v2.replace(/^v/, '').split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
};

/**
 * 获取当前操作系统
 */
const getCurrentPlatform = (): 'windows' | 'macos' | 'linux' | 'unknown' => {
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes('win')) return 'windows';
  if (userAgent.includes('mac')) return 'macos';
  if (userAgent.includes('linux')) return 'linux';
  return 'unknown';
};

/**
 * 检查更新
 */
export const checkForUpdates = async (): Promise<UpdateCheckResult> => {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        // 404 是正常情况（没有发布版本），静默处理，不记录错误
        return {
          hasUpdate: false,
          currentVersion: CURRENT_VERSION,
          latestVersion: null,
          releaseInfo: null,
          error: null, // 改为 null，表示没有错误
        };
      }
      throw new Error(`GitHub API 错误: ${response.status}`);
    }

    const data = await response.json();
    const latestVersion = data.tag_name.replace(/^v/, '');
    
    const releaseInfo: ReleaseInfo = {
      version: latestVersion,
      tagName: data.tag_name,
      publishedAt: data.published_at,
      releaseNotes: data.body || '',
      downloadUrl: data.html_url,
      assets: data.assets.map((asset: any) => ({
        name: asset.name,
        downloadUrl: asset.browser_download_url,
        size: asset.size,
      })),
    };

    const hasUpdate = compareVersions(latestVersion, CURRENT_VERSION) > 0;

    return {
      hasUpdate,
      currentVersion: CURRENT_VERSION,
      latestVersion,
      releaseInfo,
      error: null,
    };
  } catch (error: any) {
    console.error('检查更新失败:', error);
    return {
      hasUpdate: false,
      currentVersion: CURRENT_VERSION,
      latestVersion: null,
      releaseInfo: null,
      error: error.message || '检查更新失败',
    };
  }
};

/**
 * 获取当前平台对应的下载链接
 */
export const getPlatformDownloadUrl = (releaseInfo: ReleaseInfo): string | null => {
  const platform = getCurrentPlatform();
  
  // 根据平台筛选资源
  const platformPatterns: Record<string, RegExp[]> = {
    windows: [/\.msi$/i, /\.exe$/i],
    macos: [/\.dmg$/i, /arm64.*\.dmg$/i, /x64.*\.dmg$/i],
    linux: [/\.AppImage$/i, /\.deb$/i],
  };

  const patterns = platformPatterns[platform];
  if (!patterns) return releaseInfo.downloadUrl;

  for (const pattern of patterns) {
    const asset = releaseInfo.assets.find(a => pattern.test(a.name));
    if (asset) return asset.downloadUrl;
  }

  // 如果没找到匹配的资源，返回 Release 页面
  return releaseInfo.downloadUrl;
};

/**
 * 获取上次检查更新的时间
 */
export const getLastCheckTime = (): number | null => {
  const time = localStorage.getItem('arthub_last_update_check');
  return time ? parseInt(time, 10) : null;
};

/**
 * 保存检查更新时间
 */
export const saveLastCheckTime = (): void => {
  localStorage.setItem('arthub_last_update_check', Date.now().toString());
};

/**
 * 获取忽略的版本
 */
export const getIgnoredVersion = (): string | null => {
  return localStorage.getItem('arthub_ignored_version');
};

/**
 * 忽略某个版本
 */
export const ignoreVersion = (version: string): void => {
  localStorage.setItem('arthub_ignored_version', version);
};

/**
 * 是否应该显示更新提示
 */
export const shouldShowUpdate = (latestVersion: string): boolean => {
  const ignoredVersion = getIgnoredVersion();
  return ignoredVersion !== latestVersion;
};

export { CURRENT_VERSION };
