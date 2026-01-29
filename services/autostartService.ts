// 自启动服务 - 管理应用开机自动启动

import { invoke } from '@tauri-apps/api/tauri';

const AUTOSTART_STORAGE_KEY = 'arthub_autostart_enabled';

// 检查是否在 Tauri 环境中
export function isTauriEnvironment(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const win = window as any;
  return !!(win.__TAURI__ || win.__TAURI_INTERNALS__ || win.__TAURI_METADATA__);
}

// 获取保存的自启动状态
export function getAutostartEnabled(): boolean {
  const saved = localStorage.getItem(AUTOSTART_STORAGE_KEY);
  return saved === 'true';
}

// 保存自启动状态
export function saveAutostartEnabled(enabled: boolean): void {
  localStorage.setItem(AUTOSTART_STORAGE_KEY, enabled ? 'true' : 'false');
}

// 启用自启动
export async function enableAutostart(): Promise<boolean> {
  if (!isTauriEnvironment()) {
    console.warn('自启动功能仅在 Tauri 桌面应用中可用');
    return false;
  }

  try {
    const result = await invoke<boolean>('enable_autostart');
    if (result) {
      saveAutostartEnabled(true);
    }
    return result;
  } catch (error) {
    console.error('启用自启动失败:', error);
    return false;
  }
}

// 禁用自启动
export async function disableAutostart(): Promise<boolean> {
  if (!isTauriEnvironment()) {
    console.warn('自启动功能仅在 Tauri 桌面应用中可用');
    return false;
  }

  try {
    const result = await invoke<boolean>('disable_autostart');
    if (result) {
      saveAutostartEnabled(false);
    }
    return result;
  } catch (error) {
    console.error('禁用自启动失败:', error);
    return false;
  }
}

// 检查自启动是否已启用
export async function isAutostartEnabled(): Promise<boolean> {
  if (!isTauriEnvironment()) {
    return getAutostartEnabled();
  }

  try {
    const result = await invoke<boolean>('is_autostart_enabled');
    // 同步到 localStorage
    saveAutostartEnabled(result);
    return result;
  } catch (error) {
    console.error('检查自启动状态失败:', error);
    // 如果检查失败，返回 localStorage 中的值
    return getAutostartEnabled();
  }
}

// 切换自启动状态
export async function toggleAutostart(): Promise<boolean> {
  const current = await isAutostartEnabled();
  if (current) {
    return await disableAutostart();
  } else {
    return await enableAutostart();
  }
}
