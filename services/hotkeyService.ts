// 全局快捷键服务
// 管理主窗口呼出/隐藏的全局快捷键

import { register, unregister, isRegistered } from '@tauri-apps/api/globalShortcut';
import { appWindow } from '@tauri-apps/api/window';

const HOTKEY_STORAGE_KEY = 'arthub_main_window_hotkey';
const DEFAULT_HOTKEY = 'Ctrl+Alt+H'; // 默认快捷键

// 获取保存的快捷键
export function getSavedHotkey(): string {
  return localStorage.getItem(HOTKEY_STORAGE_KEY) || DEFAULT_HOTKEY;
}

// 保存快捷键
export function saveHotkey(hotkey: string): void {
  localStorage.setItem(HOTKEY_STORAGE_KEY, hotkey);
}

// 切换主窗口显示/隐藏
async function toggleMainWindow(): Promise<void> {
  try {
    const isVisible = await appWindow.isVisible();
    
    if (isVisible) {
      // 窗口可见，隐藏它
      await appWindow.hide();
    } else {
      // 窗口隐藏，显示并置顶
      await appWindow.show();
      await appWindow.setFocus();
      await appWindow.setAlwaysOnTop(true);
      
      // 短暂置顶后取消，避免一直置顶
      setTimeout(async () => {
        try {
          await appWindow.setAlwaysOnTop(false);
        } catch (error) {
          console.error('取消置顶失败:', error);
        }
      }, 1000);
    }
  } catch (error) {
    console.error('切换主窗口失败:', error);
  }
}

// 注册全局快捷键
export async function registerHotkey(hotkey: string): Promise<boolean> {
  try {
    // 先注销旧的快捷键（如果存在）
    const savedHotkey = getSavedHotkey();
    if (savedHotkey && savedHotkey !== hotkey) {
      try {
        const wasRegistered = await isRegistered(savedHotkey);
        if (wasRegistered) {
          await unregister(savedHotkey);
        }
      } catch (error) {
        console.warn('注销旧快捷键失败:', error);
      }
    }

    // 检查新快捷键是否已被注册
    const alreadyRegistered = await isRegistered(hotkey);
    if (alreadyRegistered) {
      console.warn(`快捷键 ${hotkey} 已被注册`);
      return false;
    }

    // 注册新快捷键
    await register(hotkey, async () => {
      await toggleMainWindow();
    });

    // 保存快捷键
    saveHotkey(hotkey);
    return true;
  } catch (error: any) {
    console.error('注册快捷键失败:', error);
    throw new Error(`注册快捷键失败: ${error.message || '未知错误'}`);
  }
}

// 注销全局快捷键
export async function unregisterHotkey(hotkey?: string): Promise<void> {
  try {
    const hotkeyToUnregister = hotkey || getSavedHotkey();
    if (hotkeyToUnregister) {
      const wasRegistered = await isRegistered(hotkeyToUnregister);
      if (wasRegistered) {
        await unregister(hotkeyToUnregister);
      }
    }
  } catch (error) {
    console.error('注销快捷键失败:', error);
  }
}

// 初始化快捷键（应用启动时调用）
export async function initHotkey(): Promise<void> {
  try {
    const savedHotkey = getSavedHotkey();
    if (savedHotkey) {
      await registerHotkey(savedHotkey);
      console.log(`全局快捷键已注册: ${savedHotkey}`);
    }
  } catch (error) {
    console.error('初始化快捷键失败:', error);
  }
}

// 验证快捷键格式
export function validateHotkey(hotkey: string): { valid: boolean; error?: string } {
  if (!hotkey || !hotkey.trim()) {
    return { valid: false, error: '快捷键不能为空' };
  }

  // 基本格式检查：至少需要一个修饰键和一个普通键
  const parts = hotkey.split('+').map(p => p.trim());
  if (parts.length < 2) {
    return { valid: false, error: '快捷键格式不正确，需要至少一个修饰键和一个普通键' };
  }

  // 检查修饰键
  const modifiers = ['Ctrl', 'Alt', 'Shift', 'Command', 'Super', 'Meta'];
  const hasModifier = parts.some(p => modifiers.includes(p));
  if (!hasModifier) {
    return { valid: false, error: '快捷键必须包含至少一个修饰键（Ctrl、Alt、Shift等）' };
  }

  return { valid: true };
}
