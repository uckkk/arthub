// 画布项目管理服务
// 管理画布项目：创建、重命名、目录管理

import { getSavedStoragePath, isTauriEnvironment } from './fileStorageService';

// 动态导入 Tauri API
async function getTauriPathApi() {
  const pathModule = await import('@tauri-apps/api/path');
  return pathModule;
}

// 使用自定义 Rust 命令绕过文件系统作用域限制
async function fileExistsWithPath(filePath: string): Promise<boolean> {
  const { invoke } = await import('@tauri-apps/api/tauri');
  return invoke('file_exists_with_path', { filePath });
}

async function createDirWithPath(dirPath: string, recursive: boolean = true): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/tauri');
  await invoke('create_dir_with_path', { dirPath, recursive });
}

// 统一错误消息提取
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return JSON.stringify(error) || '未知错误';
}

export interface WhiteboardProject {
  id: string;
  name: string;
  directoryPath: string; // 项目目录的完整路径
  createdAt: number;
  updatedAt: number;
}

const PROJECTS_STORAGE_KEY = 'arthub_whiteboard_projects';
const CURRENT_PROJECT_KEY = 'arthub_current_whiteboard_project';

// 生成默认项目名（按日期）
function generateDefaultProjectName(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  return `项目_${year}${month}${day}_${hour}${minute}`;
}

// 获取所有项目
export function getAllProjects(): WhiteboardProject[] {
  const saved = localStorage.getItem(PROJECTS_STORAGE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      return [];
    }
  }
  return [];
}

// 保存项目列表
function saveProjects(projects: WhiteboardProject[]): void {
  localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
}

// 获取当前项目
export function getCurrentProject(): WhiteboardProject | null {
  const projectId = localStorage.getItem(CURRENT_PROJECT_KEY);
  if (!projectId) return null;
  
  const projects = getAllProjects();
  return projects.find(p => p.id === projectId) || null;
}

// 设置当前项目
export function setCurrentProject(projectId: string | null): void {
  if (projectId) {
    localStorage.setItem(CURRENT_PROJECT_KEY, projectId);
  } else {
    localStorage.removeItem(CURRENT_PROJECT_KEY);
  }
}

// 创建新项目
export async function createProject(name?: string): Promise<WhiteboardProject> {
  try {
    if (!isTauriEnvironment()) {
      throw new Error('此功能仅在 Tauri 桌面应用中可用');
    }

    const storagePath = await getSavedStoragePath();
    if (!storagePath) {
      throw new Error('请先在设置中选择存储路径');
    }

    const { join } = await getTauriPathApi();

    const projectName = name || generateDefaultProjectName();
    const projectId = `project_${Date.now()}`;
    const projectDir = await join(storagePath, 'whiteboard', projectName);

    // 确保 whiteboard 目录存在（使用自定义命令绕过作用域限制）
    const whiteboardDir = await join(storagePath, 'whiteboard');
    if (!(await fileExistsWithPath(whiteboardDir))) {
      await createDirWithPath(whiteboardDir, true);
    }

    // 创建项目目录
    if (!(await fileExistsWithPath(projectDir))) {
      await createDirWithPath(projectDir, true);
    }

    const project: WhiteboardProject = {
      id: projectId,
      name: projectName,
      directoryPath: projectDir,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const projects = getAllProjects();
    projects.push(project);
    saveProjects(projects);
    setCurrentProject(projectId);

    return project;
  } catch (error) {
    console.error('创建项目失败:', error);
    throw new Error(getErrorMessage(error));
  }
}

// 重命名项目
export async function renameProject(projectId: string, newName: string): Promise<WhiteboardProject> {
  try {
    if (!isTauriEnvironment()) {
      throw new Error('此功能仅在 Tauri 桌面应用中可用');
    }

    const projects = getAllProjects();
    const projectIndex = projects.findIndex(p => p.id === projectId);
    if (projectIndex === -1) {
      throw new Error('项目不存在');
    }

    const project = projects[projectIndex];
    const oldDir = project.directoryPath;
    
    // 计算新目录路径
    const storagePath = await getSavedStoragePath();
    if (!storagePath) {
      throw new Error('存储路径未设置');
    }
    
    const { join } = await getTauriPathApi();
    
    const newDir = await join(storagePath, 'whiteboard', newName);

    // 如果目录名改变，重命名目录（使用自定义命令绕过作用域限制）
    if (oldDir !== newDir && (await fileExistsWithPath(oldDir))) {
      // 确保新目录的父目录存在
      const whiteboardDir = await join(storagePath, 'whiteboard');
      if (!(await fileExistsWithPath(whiteboardDir))) {
        await createDirWithPath(whiteboardDir, true);
      }

      // 使用 Rust 命令重命名目录
      try {
        const { invoke } = await import('@tauri-apps/api/tauri');
        await invoke('rename_file_with_path', { 
          oldPath: oldDir, 
          newPath: newDir 
        });
      } catch (renameError) {
        // 如果重命名失败（可能是目录不存在或权限问题），尝试创建新目录
        console.warn('重命名目录失败，尝试创建新目录:', renameError);
        if (!(await fileExistsWithPath(newDir))) {
          await createDirWithPath(newDir, true);
        }
      }
    }

    // 更新项目信息
    project.name = newName;
    project.directoryPath = newDir;
    project.updatedAt = Date.now();

    projects[projectIndex] = project;
    saveProjects(projects);

    return project;
  } catch (error) {
    console.error('重命名项目失败:', error);
    throw new Error(getErrorMessage(error));
  }
}

// 删除项目
export async function deleteProject(projectId: string): Promise<void> {
  const projects = getAllProjects();
  const projectIndex = projects.findIndex(p => p.id === projectId);
  if (projectIndex === -1) {
    throw new Error('项目不存在');
  }

  // 如果删除的是当前项目，清除当前项目设置
  const currentProjectId = localStorage.getItem(CURRENT_PROJECT_KEY);
  if (currentProjectId === projectId) {
    setCurrentProject(null);
  }

  projects.splice(projectIndex, 1);
  saveProjects(projects);

  // 注意：这里不删除目录，保留用户文件
  // 如果需要删除目录，可以添加选项
}

// 获取项目资源目录（用于存储图片和视频）
export async function getProjectAssetsDir(projectId: string): Promise<string> {
  try {
    const projects = getAllProjects();
    const project = projects.find(p => p.id === projectId);
    if (!project) {
      throw new Error('项目不存在');
    }

    const { join } = await getTauriPathApi();

    const assetsDir = await join(project.directoryPath, 'assets');
    
    // 确保资源目录存在（使用自定义命令绕过作用域限制）
    if (!(await fileExistsWithPath(assetsDir))) {
      await createDirWithPath(assetsDir, true);
    }

    return assetsDir;
  } catch (error) {
    console.error('获取资源目录失败:', error);
    throw new Error(getErrorMessage(error));
  }
}

// 保存文件到项目资源目录
export async function saveAssetToProject(
  projectId: string,
  file: File,
  fileName?: string
): Promise<string> {
  return saveAssetToProjectFromBuffer(projectId, await file.arrayBuffer(), fileName || file.name, file.type);
}

// 从 ArrayBuffer 保存文件（供带进度的上传流程使用）
export async function saveAssetToProjectFromBuffer(
  projectId: string,
  arrayBuffer: ArrayBuffer,
  fileName: string,
  mimeType?: string
): Promise<string> {
  try {
    if (!isTauriEnvironment()) {
      throw new Error('此功能仅在 Tauri 桌面应用中可用');
    }

    const assetsDir = await getProjectAssetsDir(projectId);
    
    const { join } = await getTauriPathApi();
    const filePath = await join(assetsDir, fileName);

    const uint8Array = new Uint8Array(arrayBuffer);

    // 写入文件
    const { invoke } = await import('@tauri-apps/api/tauri');
    await invoke('write_binary_file_with_path', {
      filePath: filePath,
      content: Array.from(uint8Array),
    });

    return filePath;
  } catch (error) {
    console.error('保存资源失败:', error);
    throw new Error(getErrorMessage(error));
  }
}

// 将文件路径转换为可访问的 URL（用于 tldraw）
// 使用 data: URL（base64 编码），因为 tldraw 明确支持此格式
export async function convertFilePathToUrl(filePath: string): Promise<string> {
  if (!isTauriEnvironment()) {
    // 非 Tauri 环境，直接返回路径
    return filePath;
  }

  try {
    // 读取文件内容
    const { invoke } = await import('@tauri-apps/api/tauri');
    const content: number[] = await invoke('read_binary_file_with_path', { filePath });
    
    // 根据文件扩展名确定 MIME 类型
    const ext = filePath.toLowerCase().split('.').pop() || '';
    const mimeTypes: Record<string, string> = {
      'mp4': 'video/mp4',
      'webm': 'video/webm',
      'ogg': 'video/ogg',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'webp': 'image/webp',
    };
    const mimeType = mimeTypes[ext] || 'application/octet-stream';
    
    // 将字节数组转换为 base64（使用 Blob + FileReader，兼容大文件且无栈溢出风险）
    const uint8Array = new Uint8Array(content);
    const base64 = await new Promise<string>((resolve, reject) => {
      const blob = new Blob([uint8Array], { type: mimeType });
      const reader = new FileReader();
      reader.onload = () => {
        // readAsDataURL 返回 "data:mime;base64,xxx"，截取 base64 部分
        const dataUrl = reader.result as string;
        const commaIdx = dataUrl.indexOf(',');
        resolve(commaIdx >= 0 ? dataUrl.substring(commaIdx + 1) : dataUrl);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    
    // 返回 data: URL
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('转换文件路径为 URL 失败:', error);
    throw new Error(getErrorMessage(error));
  }
}

// 画布数据文件名
const CANVAS_DATA_FILE = 'canvas.json';

// 保存画布数据到项目目录
export async function saveCanvasData(projectId: string, data: unknown): Promise<void> {
  try {
    if (!isTauriEnvironment()) {
      throw new Error('此功能仅在 Tauri 桌面应用中可用');
    }

    const projects = getAllProjects();
    const project = projects.find(p => p.id === projectId);
    if (!project) {
      throw new Error('项目不存在');
    }

    const { join } = await getTauriPathApi();
    const filePath = await join(project.directoryPath, CANVAS_DATA_FILE);

    // 将数据序列化为 JSON
    const jsonContent = JSON.stringify(data, null, 2);
    const encoder = new TextEncoder();
    const uint8Array = encoder.encode(jsonContent);

    // 写入文件
    const { invoke } = await import('@tauri-apps/api/tauri');
    await invoke('write_binary_file_with_path', {
      filePath: filePath,
      content: Array.from(uint8Array),
    });

    // 更新项目更新时间
    project.updatedAt = Date.now();
    saveProjects(projects);

    console.log('画布数据已保存到:', filePath);
  } catch (error) {
    console.error('保存画布数据失败:', error);
    throw new Error(getErrorMessage(error));
  }
}

// 从项目目录加载画布数据
export async function loadCanvasData(
  projectId: string,
  onProgress?: (percent: number, message: string) => void
): Promise<unknown | null> {
  try {
    if (!isTauriEnvironment()) {
      return null;
    }

    onProgress?.(5, '正在加载画布...');

    const projects = getAllProjects();
    const project = projects.find(p => p.id === projectId);
    if (!project) {
      return null;
    }

    const { join } = await getTauriPathApi();
    const filePath = await join(project.directoryPath, CANVAS_DATA_FILE);

    // 检查文件是否存在
    if (!(await fileExistsWithPath(filePath))) {
      return null;
    }

    onProgress?.(30, '正在读取画布数据...');

    // 读取文件内容
    const { invoke } = await import('@tauri-apps/api/tauri');
    const content: number[] = await invoke('read_binary_file_with_path', { filePath });

    onProgress?.(70, '正在解析画布...');

    // 解析 JSON
    const decoder = new TextDecoder();
    const uint8Array = new Uint8Array(content);
    const jsonContent = decoder.decode(uint8Array);
    const data = JSON.parse(jsonContent);

    onProgress?.(100, '加载完成');

    console.log('画布数据已从文件加载:', filePath);
    return data;
  } catch (error) {
    console.error('加载画布数据失败:', error);
    return null;
  }
}
