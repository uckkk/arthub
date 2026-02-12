// 用户验证服务
// 认证核心逻辑已下沉到 Rust 后端，前端无法绕过

export interface UserInfo {
  username: string;
  userId: string;
}

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_IPC__;

// 验证用户（优先通过 Rust 后端，浏览器环境降级为前端验证）
export async function verifyUser(username: string, userId: string): Promise<boolean> {
  if (isTauri) {
    // Tauri 环境：通过 Rust 后端验证（CSV URL 仅存在于 Rust 中，前端不可见）
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      const result = await invoke<boolean>('verify_user', { username, userId });
      return result;
    } catch (error) {
      console.error('Rust 验证失败:', error);
      return false;
    }
  } else {
    // 浏览器环境：降级为前端验证（仅开发调试用）
    try {
      const response = await fetch(
        'https://raw.githubusercontent.com/uckkk/ArtAssetNamingConfig/main/useID.csv'
      );
      if (!response.ok) return false;
      const csvText = await response.text();
      const lines = csvText.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
      for (const line of lines) {
        const [u, id] = line.split(',').map(s => s.trim());
        if (u === username && id === userId) return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

// 检查 Rust 端认证状态（Tauri 环境专用）
export async function checkRustAuth(): Promise<boolean> {
  if (!isTauri) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/tauri');
    return await invoke<boolean>('check_auth');
  } catch {
    return false;
  }
}

// Rust 端登出
export async function rustLogout(): Promise<void> {
  if (!isTauri) return;
  try {
    const { invoke } = await import('@tauri-apps/api/tauri');
    await invoke('auth_logout');
  } catch {
    // 静默
  }
}

// 保存用户信息到localStorage（仅用于 UI 展示和自动填充，不决定实际权限）
export function saveUserInfo(userInfo: UserInfo): void {
  localStorage.setItem('arthub_user_info', JSON.stringify(userInfo));
}

// 从localStorage获取用户信息
export function getUserInfo(): UserInfo | null {
  const stored = localStorage.getItem('arthub_user_info');
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

// 清除用户信息
export function clearUserInfo(): void {
  localStorage.removeItem('arthub_user_info');
}
