// 备注服务 - 管理备注内容，保存到文件存储路径

import { getStorageConfig, getSavedDirectoryHandle, autoSyncToFile } from './fileStorageService';

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

  try {
    const directoryHandle = await getSavedDirectoryHandle();
    if (!directoryHandle) {
      return false;
    }

    // 使用模板相关的文件名
    const fileName = getNotesFileName(presetId);
    const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();

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

  try {
    const directoryHandle = await getSavedDirectoryHandle();
    if (!directoryHandle) {
      return null;
    }

    // 使用模板相关的文件名
    const fileName = getNotesFileName(presetId);
    const fileHandle = await directoryHandle.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return text;
  } catch (error: any) {
    if (error.name === 'NotFoundError') {
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

