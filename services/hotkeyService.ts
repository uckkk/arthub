// 全局快捷键服务
// 管理主窗口呼出/隐藏、截图、录屏的全局快捷键

import { register, unregister, isRegistered as checkIsRegistered } from '@tauri-apps/api/globalShortcut';
import { appWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/tauri';
import { addPendingImport } from './whiteboardPendingImport';

const HOTKEY_STORAGE_KEY = 'arthub_main_window_hotkey';
const DEFAULT_HOTKEY = 'Ctrl+Alt+H'; // 默认快捷键

const SCREENSHOT_HOTKEY_KEY = 'arthub_screenshot_hotkey';
const RECORD_HOTKEY_KEY = 'arthub_record_hotkey';
const CAPTURE_OUTPUT_DIR_KEY = 'arthub_capture_output_dir';
const LAST_RECORD_PATH_KEY = 'arthub_last_record_path';

// 将显示用按键字符转为 Tauri accelerator 可识别的 KeyCode（Tauri 使用数字键名 1-0，非 Digit1）
const DISPLAY_KEY_TO_ACCELERATOR: Record<string, string> = {
  '~': '`', '`': '`',
  '!': '1', '@': '2', '#': '3', '$': '4', '%': '5',
  '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
  '-': 'Minus', '_': 'Minus', '=': 'Equal', '+': 'Equal',
  '[': 'BracketLeft', '{': 'BracketLeft', ']': 'BracketRight', '}': 'BracketRight',
  ';': 'Semicolon', ':': 'Semicolon', "'": 'Quote', '"': 'Quote',
  ',': 'Comma', '<': 'Comma', '.': 'Period', '>': 'Period',
  '/': 'Slash', '?': 'Slash', '\\': 'Backslash', '|': 'Backslash',
};

function toAcceleratorKey(displayKey: string): string {
  const k = displayKey.trim();
  if (!k) return k;
  const mapped = DISPLAY_KEY_TO_ACCELERATOR[k];
  if (mapped) return mapped;
  // Tauri 不识别 Digit1 等，需转为数字键名 1-0
  const digitMap: Record<string, string> = { Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9', Digit0: '0' };
  if (digitMap[k]) return digitMap[k];
  if (k.length === 1 && /[A-Za-z0-9]/.test(k)) return k.length === 1 && k >= 'a' && k <= 'z' ? k.toUpperCase() : k;
  return k;
}

/** 将前端显示的快捷键字符串转为 Tauri register 可用的 accelerator 字符串 */
function toAcceleratorString(hotkey: string): string {
  const parts = hotkey.split('+').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return hotkey;
  const keyPart = parts[parts.length - 1];
  const keyCode = toAcceleratorKey(keyPart);
  if (parts.length === 1) return keyCode;
  return [...parts.slice(0, -1), keyCode].join('+');
}

// 重新导出 isRegistered 供外部使用
export const isRegistered = checkIsRegistered;

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
        const wasRegistered = await checkIsRegistered(savedHotkey);
        if (wasRegistered) {
          await unregister(savedHotkey);
          console.log(`已注销旧快捷键: ${savedHotkey}`);
        }
      } catch (error) {
        console.warn('注销旧快捷键失败:', error);
      }
    }

    // 检查新快捷键是否已被注册（包括当前应用已注册的情况）
    const alreadyRegistered = await checkIsRegistered(hotkey);
    if (alreadyRegistered) {
      // 如果已被注册，先尝试注销再重新注册（可能是应用重启导致的重复注册）
      try {
        await unregister(hotkey);
        console.log(`检测到快捷键 ${hotkey} 已被注册，已先注销`);
      } catch (unregisterError) {
        // 注销失败，可能是被其他应用占用
        console.warn(`快捷键 ${hotkey} 已被其他应用注册，无法使用`, unregisterError);
        return false;
      }
    }

    // 注册新快捷键
    await register(hotkey, async () => {
      await toggleMainWindow();
    });

    // 保存快捷键
    saveHotkey(hotkey);
    console.log(`快捷键 ${hotkey} 注册成功`);
    return true;
  } catch (error: any) {
    // 如果是重复注册错误，尝试先注销再注册
    if (error.message?.includes('already registered') || error.message?.includes('已被注册')) {
      try {
        await unregister(hotkey);
        await register(hotkey, async () => {
          await toggleMainWindow();
        });
        saveHotkey(hotkey);
        console.log(`快捷键 ${hotkey} 重新注册成功`);
        return true;
      } catch (retryError: any) {
        console.error('重新注册快捷键失败:', retryError);
        return false;
      }
    }
    console.error('注册快捷键失败:', error);
    return false;
  }
}

// 注销全局快捷键
export async function unregisterHotkey(hotkey?: string): Promise<void> {
  try {
    const hotkeyToUnregister = hotkey || getSavedHotkey();
    if (hotkeyToUnregister) {
      const wasRegistered = await checkIsRegistered(hotkeyToUnregister);
      if (wasRegistered) {
        await unregister(hotkeyToUnregister);
      }
    }
  } catch (error) {
    console.error('注销快捷键失败:', error);
  }
}

// 初始化快捷键（应用启动时调用）
let isInitializing = false; // 防止重复初始化

export async function initHotkey(): Promise<void> {
  // 防止重复初始化
  if (isInitializing) {
    console.log('快捷键初始化正在进行中，跳过重复调用');
    return;
  }
  
  isInitializing = true;
  try {
    const savedHotkey = getSavedHotkey();
    if (savedHotkey) {
      const success = await registerHotkey(savedHotkey);
      if (success) {
        console.log(`全局快捷键已注册: ${savedHotkey}`);
      } else {
        console.warn(`全局快捷键注册失败: ${savedHotkey}（可能已被占用）`);
      }
    }
  } catch (error) {
    console.error('初始化快捷键失败:', error);
  } finally {
    isInitializing = false;
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

// ---------- 截图 / 录屏快捷键 ----------

export function getSavedScreenshotHotkey(): string {
  return localStorage.getItem(SCREENSHOT_HOTKEY_KEY) || '';
}

export function getSavedRecordHotkey(): string {
  return localStorage.getItem(RECORD_HOTKEY_KEY) || '';
}

export function saveScreenshotHotkey(hotkey: string): void {
  if (hotkey) localStorage.setItem(SCREENSHOT_HOTKEY_KEY, hotkey);
  else localStorage.removeItem(SCREENSHOT_HOTKEY_KEY);
}

export function saveRecordHotkey(hotkey: string): void {
  if (hotkey) localStorage.setItem(RECORD_HOTKEY_KEY, hotkey);
  else localStorage.removeItem(RECORD_HOTKEY_KEY);
}

export function getCaptureOutputDir(): string {
  return localStorage.getItem(CAPTURE_OUTPUT_DIR_KEY) || '';
}

export function saveCaptureOutputDir(dir: string): void {
  if (dir) localStorage.setItem(CAPTURE_OUTPUT_DIR_KEY, dir);
  else localStorage.removeItem(CAPTURE_OUTPUT_DIR_KEY);
}

export function getLastRecordPath(): string {
  return localStorage.getItem(LAST_RECORD_PATH_KEY) || '';
}

export function saveLastRecordPath(path: string): void {
  if (path) localStorage.setItem(LAST_RECORD_PATH_KEY, path);
  else localStorage.removeItem(LAST_RECORD_PATH_KEY);
}

function buildCapturePath(filename: string): string {
  const dir = getCaptureOutputDir().trim().replace(/[/\\]+$/, '');
  if (!dir) return '';
  const sep = dir.includes('/') ? '/' : '\\';
  return `${dir}${sep}${filename}`;
}

function onScreenshotShortcut(): void {
  window.dispatchEvent(new CustomEvent('arthub-trigger-screenshot', { detail: { type: 'screenshot' as const } }));
}

async function onRecordShortcut(): Promise<void> {
  try {
    const is = await invoke<boolean>('screen_record_is_recording');
    if (is) {
      const recordPath = getLastRecordPath();
      await invoke('screen_record_stop');
      if (recordPath) {
        addPendingImport(recordPath);
        window.dispatchEvent(new CustomEvent('arthub-capture-saved-to-canvas', { detail: { type: 'record' as const } }));
      }
      saveLastRecordPath('');
      window.dispatchEvent(new CustomEvent('arthub-capture-done', { detail: { type: 'record_stop' } }));
      return;
    }
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent('arthub-trigger-record', { detail: { type: 'record' as const } }));
}

export async function registerScreenshotHotkey(hotkey: string): Promise<boolean> {
  if (!hotkey.trim()) return true;
  const accelerator = toAcceleratorString(hotkey);
  try {
    await unregisterScreenshotHotkey();
    const existing = await checkIsRegistered(accelerator);
    if (existing) {
      try { await unregister(accelerator); } catch { return false; }
    }
    await register(accelerator, () => { onScreenshotShortcut(); });
    saveScreenshotHotkey(hotkey);
    return true;
  } catch (e) {
    console.error('注册截图快捷键失败:', e);
    return false;
  }
}

export async function registerRecordHotkey(hotkey: string): Promise<boolean> {
  if (!hotkey.trim()) return true;
  const accelerator = toAcceleratorString(hotkey);
  try {
    await unregisterRecordHotkey();
    const existing = await checkIsRegistered(accelerator);
    if (existing) {
      try { await unregister(accelerator); } catch { return false; }
    }
    await register(accelerator, () => { onRecordShortcut(); });
    saveRecordHotkey(hotkey);
    return true;
  } catch (e) {
    console.error('注册录屏快捷键失败:', e);
    return false;
  }
}

export async function unregisterScreenshotHotkey(): Promise<void> {
  const h = getSavedScreenshotHotkey();
  if (h) try { await unregister(toAcceleratorString(h)); } catch { /* ignore */ }
  localStorage.removeItem(SCREENSHOT_HOTKEY_KEY);
}

export async function unregisterRecordHotkey(): Promise<void> {
  const h = getSavedRecordHotkey();
  if (h) try { await unregister(toAcceleratorString(h)); } catch { /* ignore */ }
  localStorage.removeItem(RECORD_HOTKEY_KEY);
}

let screenCaptureHotkeysInitialized = false;

export async function initScreenCaptureHotkeys(): Promise<void> {
  if (screenCaptureHotkeysInitialized) return;
  screenCaptureHotkeysInitialized = true;
  try {
    const sh = getSavedScreenshotHotkey();
    const rh = getSavedRecordHotkey();
    if (sh) await registerScreenshotHotkey(sh);
    if (rh) await registerRecordHotkey(rh);
  } catch (e) {
    console.error('初始化截图/录屏快捷键失败:', e);
  }
}
