// 备注服务 - 管理备注内容，保存到文件存储路径

import { getStorageConfig, getSavedStoragePath, autoSyncToFile } from './fileStorageService';
import { readTextFile, writeTextFile, exists } from '@tauri-apps/api/fs';
import { join } from '@tauri-apps/api/path';

const NOTES_LOCAL_STORAGE_KEY = 'arthub_notes_content';

// 获取当前模板ID
function getCurrentPresetId(): string {
  return localStorage.getItem('arthub_naming_preset') || 'fgui_card';
}

// 获取模板相关的存储键
function getNotesKey(presetId?: string): string {
  const id = presetId || getCurrentPresetId();
  return `${NOTES_LOCAL_STORAGE_KEY}_${id}`;
}

// 获取模板相关的文件名
function getNotesFileName(presetId?: string): string {
  const id = presetId || getCurrentPresetId();
  return `arthub_notes_${id}.txt`;
}

// 获取备注文件完整路径
async function getNotesFilePath(presetId?: string): Promise<string | null> {
  const storagePath = await getSavedStoragePath();
  if (!storagePath) {
    return null;
  }

  try {
    const fileName = getNotesFileName(presetId);
    const filePath = await join(storagePath, fileName);
    return filePath;
  } catch (error) {
    console.error('获取备注文件路径失败:', error);
    const fileName = getNotesFileName(presetId);
    return `${storagePath}/${fileName}`;
  }
}

// 从 localStorage 加载备注内容（与模板关联）
export function loadNotesFromLocalStorage(presetId?: string): string {
  const key = getNotesKey(presetId);
  return localStorage.getItem(key) || '';
}

// 保存备注内容到 localStorage（与模板关联）
export function saveNotesToLocalStorage(content: string, presetId?: string): void {
  const key = getNotesKey(presetId);
  localStorage.setItem(key, content);
}

// 保存备注内容到文件（如果已启用文件存储，按模板区分）
export async function saveNotesToFile(content: string, presetId?: string): Promise<boolean> {
  const config = getStorageConfig();
  if (!config.enabled) {
    return false;
  }

  // 检查是否在 Tauri 环境中
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return false;
  }

  try {
    const filePath = await getNotesFilePath(presetId);
    if (!filePath) {
      return false;
    }

    await writeTextFile(filePath, content);
    return true;
  } catch (error) {
    console.error('保存备注到文件失败:', error);
    return false;
  }
}

// 从文件加载备注内容（按模板区分）
export async function loadNotesFromFile(presetId?: string): Promise<string | null> {
  const config = getStorageConfig();
  if (!config.enabled) {
    return null;
  }

  // 检查是否在 Tauri 环境中
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return null;
  }

  try {
    const filePath = await getNotesFilePath(presetId);
    if (!filePath) {
      return null;
    }

    // 检查文件是否存在
    const fileExists = await exists(filePath);
    if (!fileExists) {
      return null;
    }

    const text = await readTextFile(filePath);
    return text;
  } catch (error: any) {
    if (error.message?.includes('未找到') || error.message?.includes('NotFound')) {
      return null; // 文件不存在
    }
    console.error('从文件加载备注失败:', error);
    return null;
  }
}

// 自动保存备注（同时保存到 localStorage 和文件，按模板区分）
export async function autoSaveNotes(content: string, presetId?: string): Promise<void> {
  // 先保存到 localStorage（即时，与模板关联）
  saveNotesToLocalStorage(content, presetId);
  
  // 如果启用了文件存储，也保存到文件（按模板区分）
  const config = getStorageConfig();
  if (config.enabled) {
    await saveNotesToFile(content, presetId);
  }
}
