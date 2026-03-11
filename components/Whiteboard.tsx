import React, { useState, useEffect, useCallback, useRef, Component, ErrorInfo } from 'react';
import { Tldraw, Editor, AssetRecordType, createShapeId } from 'tldraw';
import 'tldraw/tldraw.css';

// tldraw 错误边界组件
interface TldrawErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class TldrawErrorBoundary extends Component<
  { children: React.ReactNode; onReset?: () => void },
  TldrawErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; onReset?: () => void }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): TldrawErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    const fullMsg = `tldraw 组件错误: ${errMsg}${errStack ? '\n' + errStack : ''}${errorInfo?.componentStack ? '\n组件堆栈:\n' + errorInfo.componentStack : ''}`;
    console.error(fullMsg);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full flex items-center justify-center bg-[#0a0a0a]">
          <div className="text-center p-8 max-w-md">
            <div className="text-red-500 text-4xl mb-4">⚠️</div>
            <h3 className="text-white text-lg font-medium mb-2">画布加载出错</h3>
            <p className="text-[#666666] text-sm mb-4">
              {this.state.error?.message || '未知错误'}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                this.props.onReset?.();
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              重试
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
import { 
  createProject, 
  getAllProjects, 
  getCurrentProject, 
  setCurrentProject,
  renameProject,
  deleteProject,
  saveAssetToProjectFromBuffer,
  convertFilePathToUrl,
  saveCanvasData,
  loadCanvasData,
  WhiteboardProject
} from '../services/whiteboardProjectService';
import { getSavedStoragePath, openSettingsAndHighlightPath } from '../services/fileStorageService';
import { Edit2, X, Plus, Save, Download, Share2, Sun, Moon } from 'lucide-react';
import { useToast } from './Toast';
import { invoke } from '@tauri-apps/api/tauri';
import { getPendingImports, clearPendingImports, addPendingImport } from '../services/whiteboardPendingImport';

// 主题存储 key
const THEME_STORAGE_KEY = 'arthub_whiteboard_theme';

const IMPORT_GAP = 24;
function getNextPlacePosition(editor: Editor, w: number, h: number): { x: number; y: number } {
  const ids = editor.getCurrentPageShapeIds();
  let maxX = 0;
  ids.forEach((id) => {
    const s = editor.getShape(id);
    if (!s || (s.type !== 'image' && s.type !== 'video')) return;
    const right = s.x + (Number((s.props as any)?.w) || 0);
    maxX = Math.max(maxX, right);
  });
  return { x: maxX + IMPORT_GAP, y: 0 };
}

const Whiteboard: React.FC = () => {
  const { showToast } = useToast();
  const [currentProject, setCurrentProjectState] = useState<WhiteboardProject | null>(null);
  const [projects, setProjects] = useState<WhiteboardProject[]>([]);
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [projectNameInput, setProjectNameInput] = useState('');
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const whiteboardContainerRef = useRef<HTMLDivElement>(null);

  // 仅在容器可见（用户停留在白板 tab）时才挂载 tldraw，避免在其他 tab 下触发 2s+ 同步阻塞
  const [tldrawReady, setTldrawReady] = useState(false);
  useEffect(() => {
    if (tldrawReady) return;
    const id = setInterval(() => {
      const el = whiteboardContainerRef.current;
      if (el && el.offsetParent !== null) setTldrawReady(true);
    }, 250);
    return () => clearInterval(id);
  }, [tldrawReady]);
  
  // 进度条状态（加载/上传时显示）
  const [progress, setProgress] = useState<{ visible: boolean; percent: number; message: string }>({
    visible: false,
    percent: 0,
    message: '',
  });
  
  // 主题状态：'dark' | 'light'（兼容 Safari 隐私模式）
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      return saved !== 'light';
    } catch { return true; }
  });

  // 切换主题
  const handleToggleTheme = useCallback(() => {
    const newIsDark = !isDarkMode;
    setIsDarkMode(newIsDark);
    try { localStorage.setItem(THEME_STORAGE_KEY, newIsDark ? 'dark' : 'light'); } catch { /* Safari 隐私模式 */ }
    
    // 更新 tldraw 编辑器的主题
    if (editorRef.current) {
      editorRef.current.user.updateUserPreferences({
        colorScheme: newIsDark ? 'dark' : 'light',
      });
    }
  }, [isDarkMode]);

  // 初始化：加载项目和存储路径
  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    loadStoragePath();
  }, []);

  // 加载项目列表
  const loadProjects = () => {
    const allProjects = getAllProjects();
    setProjects(allProjects);
    
    const current = getCurrentProject();
    if (current) {
      setCurrentProjectState(current);
      setProjectNameInput(current.name);
    } else if (allProjects.length > 0) {
      // 如果没有当前项目，使用第一个项目
      setCurrentProject(allProjects[0].id);
      setCurrentProjectState(allProjects[0]);
      setProjectNameInput(allProjects[0].name);
    }
  };

  // 加载存储路径
  const loadStoragePath = async () => {
    try {
      const path = await getSavedStoragePath();
      setStoragePath(path);
    } catch (error) {
      console.error('加载存储路径失败:', error);
    }
  };

  // 检查并创建默认项目
  useEffect(() => {
    if (storagePath && projects.length === 0 && !currentProject) {
      handleCreateProject().catch(console.error);
    }
  }, [storagePath]);

  // 创建新项目
  const handleCreateProject = async () => {
    try {
      const newProject = await createProject();
      loadProjects();
      setCurrentProjectState(newProject);
      setProjectNameInput(newProject.name);
      showToast('success', `项目 "${newProject.name}" 创建成功`);
    } catch (error: any) {
      showToast('error', `创建项目失败: ${error.message}`);
    }
  };

  // 手动保存当前画布（未关联本地目录时提示并跳转设置；延后执行避免阻塞主线程导致崩溃）
  const [savingCanvas, setSavingCanvas] = useState(false);
  const handleSaveCanvas = useCallback(() => {
    if (savingCanvas || !currentProject?.id || !editorRef.current) return;
    getSavedStoragePath().then((path) => {
      if (!path) {
        showToast('info', '请先关联本地目录以保存画布');
        openSettingsAndHighlightPath();
        return;
      }
      setSavingCanvas(true);
      showToast('info', '正在保存画布，请勿关闭…');
      const projectId = String(currentProject.id);
      const runSave = () => {
        try {
          if (!editorRef.current) {
            setSavingCanvas(false);
            return;
          }
          let snapshot: unknown;
          try {
            snapshot = editorRef.current.getSnapshot();
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast('error', `获取画布失败: ${msg}`);
            setSavingCanvas(false);
            return;
          }
          if (snapshot === undefined) {
            showToast('error', '无法获取画布数据');
            setSavingCanvas(false);
            return;
          }
          // 让出主线程再序列化+写入，避免 getSnapshot 与 JSON.stringify 连续阻塞导致卡死/闪退
          const doWrite = () => {
            Promise.resolve()
              .then(() => saveCanvasData(projectId, snapshot))
              .then(() => showToast('success', '画布已保存'))
              .catch((error: unknown) => {
                const msg = error instanceof Error ? error.message : String(error);
                showToast('error', `保存失败: ${msg}`);
                console.error('[Whiteboard] handleSaveCanvas', error);
              })
              .finally(() => setSavingCanvas(false));
          };
          if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(doWrite, { timeout: 2000 });
          } else {
            setTimeout(doWrite, 0);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          showToast('error', `保存失败: ${msg}`);
          console.error('[Whiteboard] handleSaveCanvas sync', err);
          setSavingCanvas(false);
        }
      };
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(runSave, { timeout: 3000 });
      } else {
        setTimeout(runSave, 0);
      }
    }).catch((err) => {
      showToast('error', err instanceof Error ? err.message : '获取存储路径失败');
    });
  }, [currentProject, showToast, savingCanvas]);

  // 监听「截图/录屏」导入画板：单路径时入队并触发处理（不跳转）；处理时整齐排列不叠加
  useEffect(() => {
    const handler = (e: Event) => {
      const filePath = (e as CustomEvent<{ filePath: string }>).detail?.filePath;
      if (!filePath || typeof filePath !== 'string') return;
      addPendingImport(filePath);
    };
    window.addEventListener('importFileToWhiteboard', handler);
    return () => window.removeEventListener('importFileToWhiteboard', handler);
  }, []);

  // 处理待导入队列：从 sessionStorage 取列表，逐个加入画布并整齐排列
  useEffect(() => {
    const processOne = async (filePath: string) => {
      const project = getCurrentProject();
      if (!project || !editorRef.current) return;
      const editor = editorRef.current;
      const imageTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
      const videoTypes = ['video/mp4', 'video/webm', 'video/ogg'];
      const fileName = filePath.replace(/^.*[/\\]/, '') || 'screenshot.png';
      const ext = (fileName.split('.').pop() || '').toLowerCase();
      const mimeMap: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
        mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg',
      };
      const mimeType = mimeMap[ext] || 'image/png';
      const isImage = imageTypes.includes(mimeType);
      const isVideo = videoTypes.includes(mimeType);
      if (!isImage && !isVideo) return;
      try {
        const content = await invoke<number[]>('read_binary_file_with_path', { filePath });
        const arrayBuffer = new Uint8Array(content).buffer;
        const savedPath = await saveAssetToProjectFromBuffer(project.id, arrayBuffer, fileName, mimeType);
        const fileUrl = await convertFilePathToUrl(savedPath);
        if (isImage) {
          const imageAssetId = AssetRecordType.createId();
          const image = new Image();
          image.onload = () => {
            try {
              editor.createAssets([{
                id: imageAssetId,
                type: 'image',
                typeName: 'asset',
                props: { w: image.width, h: image.height, name: fileName, src: fileUrl, mimeType, isAnimated: false },
                meta: {},
              }]);
              const pos = getNextPlacePosition(editor, image.width, image.height);
              editor.createShape({
                id: createShapeId(),
                type: 'image',
                x: pos.x,
                y: pos.y,
                props: { w: image.width, h: image.height, assetId: imageAssetId },
              });
              showToast('success', `已导入到画板: ${fileName}`);
            } catch (err) {
              console.error('创建图片资源失败:', err);
              showToast('error', `导入失败: ${fileName}`);
            }
          };
          image.onerror = () => showToast('error', `加载图片失败: ${fileName}`);
          image.src = fileUrl;
        } else {
          const videoAssetId = AssetRecordType.createId();
          const video = document.createElement('video');
          video.preload = 'metadata';
          video.onloadedmetadata = () => {
            try {
              editor.createAssets([{
                id: videoAssetId,
                type: 'video',
                typeName: 'asset',
                props: {
                  w: video.videoWidth || 640,
                  h: video.videoHeight || 360,
                  name: fileName,
                  src: fileUrl,
                  mimeType,
                  isAnimated: true,
                },
                meta: {},
              }]);
              const vw = video.videoWidth || 640;
              const vh = video.videoHeight || 360;
              const pos = getNextPlacePosition(editor, vw, vh);
              editor.createShape({
                id: createShapeId(),
                type: 'video',
                x: pos.x,
                y: pos.y,
                props: { w: vw, h: vh, assetId: videoAssetId },
              });
              showToast('success', `已导入到画板: ${fileName}`);
            } catch (err) {
              console.error('创建视频资源失败:', err);
              showToast('error', `导入失败: ${fileName}`);
            }
          };
          video.onerror = () => showToast('error', `加载视频失败: ${fileName}`);
          video.src = fileUrl;
        }
      } catch (err: any) {
        showToast('error', `导入到画板失败: ${err?.message || err}`);
      }
    };
    const runQueue = async () => {
      const paths = getPendingImports();
      if (paths.length === 0) return;
      if (!getCurrentProject() || !editorRef.current) {
        showToast('info', '请先创建或选择画板项目，待导入文件已入队');
        return;
      }
      for (const p of paths) await processOne(p);
      clearPendingImports();
    };
    const onProcess = () => { runQueue(); };
    window.addEventListener('arthub-process-pending-imports', onProcess);
    runQueue();
    return () => window.removeEventListener('arthub-process-pending-imports', onProcess);
  }, [showToast]);

  // 切换项目（不卸载 Tldraw，手动加载数据，避免 tldraw 内部 dispose 时 "h is not a function" 错误）
  const handleSelectProject = async (projectId: string) => {
    try {
      // 切换前保存当前画布
      if (currentProject && editorRef.current) {
        try {
          const snapshot = editorRef.current.getSnapshot();
          await saveCanvasData(currentProject.id, snapshot);
          console.log('切换项目前已保存当前画布');
        } catch (error) {
          console.error('保存当前画布失败:', error);
        }
      }

      setCurrentProject(projectId);
      const project = projects.find(p => p.id === projectId);
      if (project) {
        setCurrentProjectState(project);
        setProjectNameInput(project.name);
        setShowProjectSelector(false);

        // 手动加载新项目数据到画布（不通过 key 触发 remount，避免 tldraw dispose bug）
        if (editorRef.current) {
          try {
            const savedData = await loadCanvasData(projectId);
            if (savedData) {
              editorRef.current.loadSnapshot(savedData as any);
              console.log('已加载项目画布:', project.name);
            } else {
              const shapeIds = editorRef.current.getCurrentPageShapeIds();
              if (shapeIds.size > 0) {
                editorRef.current.deleteShapes([...shapeIds]);
              }
            }
          } catch (error) {
            console.error('加载项目画布失败:', error);
            const shapeIds = editorRef.current.getCurrentPageShapeIds();
            if (shapeIds.size > 0) {
              editorRef.current.deleteShapes([...shapeIds]);
            }
          }
        }

        showToast('success', `已切换到项目 "${project.name}"`);
      }
    } catch (error: any) {
      showToast('error', `切换项目失败: ${error.message}`);
    }
  };

  // 开始编辑项目名
  const handleStartEditProjectName = () => {
    if (currentProject) {
      setIsEditingProjectName(true);
      setProjectNameInput(currentProject.name);
    }
  };

  // 保存项目名
  const handleSaveProjectName = async () => {
    if (!currentProject || !projectNameInput.trim()) {
      setIsEditingProjectName(false);
      return;
    }

    if (projectNameInput.trim() === currentProject.name) {
      setIsEditingProjectName(false);
      return;
    }

    try {
      const updatedProject = await renameProject(currentProject.id, projectNameInput.trim());
      setCurrentProjectState(updatedProject);
      loadProjects();
      setIsEditingProjectName(false);
      showToast('success', `项目已重命名为 "${updatedProject.name}"`);
    } catch (error: any) {
      showToast('error', `重命名失败: ${error.message}`);
      setProjectNameInput(currentProject.name);
    }
  };

  // 取消编辑项目名
  const handleCancelEditProjectName = () => {
    if (currentProject) {
      setProjectNameInput(currentProject.name);
    }
    setIsEditingProjectName(false);
  };

  // 使用 FileReader 读取文件并报告进度
  const readFileWithProgress = (
    file: File,
    onProgress?: (percent: number) => void
  ): Promise<ArrayBuffer> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });

  // 处理文件上传
  const handleFileUpload = useCallback(async (files: FileList | File[]) => {
    if (!currentProject) {
      showToast('error', '请先创建或选择项目');
      return;
    }

    const fileArray = Array.from(files);
    const imageTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    const videoTypes = ['video/mp4', 'video/webm', 'video/ogg'];
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    const videoExts = ['.mp4', '.webm', '.ogg', '.mov'];
    
    // 文件大小限制（单位：字节）
    const MAX_VIDEO_SIZE = 20 * 1024 * 1024; // 20MB
    const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

    const validFiles: File[] = [];
    for (const file of fileArray) {
      const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
      const mimeType = (file.type || '').toLowerCase();
      const isImage = imageTypes.includes(mimeType) || imageExts.includes(ext);
      const isVideo = videoTypes.includes(mimeType) || videoExts.includes(ext);

      if (!isImage && !isVideo) {
        showToast('warning', `不支持的文件类型: ${file.name}`);
        continue;
      }

      if (isVideo && file.size > MAX_VIDEO_SIZE) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        showToast('error', `视频文件过大 (${sizeMB}MB)，请压缩到 20MB 以下: ${file.name}`);
        continue;
      }
      if (isImage && file.size > MAX_IMAGE_SIZE) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        showToast('error', `图片文件过大 (${sizeMB}MB)，请压缩到 10MB 以下: ${file.name}`);
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) return;

    const total = validFiles.length;
    setProgress({ visible: true, percent: 0, message: `准备上传 ${total} 个文件...` });

    try {
      for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        const basePercent = (i / total) * 100;
        const rangePercent = 100 / total;
        const isImage = imageTypes.includes(file.type);
        const isVideo = videoTypes.includes(file.type) || file.name.toLowerCase().endsWith('.mp4');

        // 阶段1: 读取文件 (占该文件进度的 0-40%)
        const arrayBuffer = await readFileWithProgress(file, (readPercent) => {
          const pct = basePercent + (readPercent / 100) * rangePercent * 0.4;
          setProgress({ visible: true, percent: pct, message: `读取 ${file.name} ${readPercent}% (${i + 1}/${total})` });
        });

        // 阶段2: 保存到磁盘 (40-70%)
        setProgress({ visible: true, percent: basePercent + rangePercent * 0.4, message: `保存 ${file.name} (${i + 1}/${total})` });
        const filePath = await saveAssetToProjectFromBuffer(currentProject.id, arrayBuffer, file.name, file.type);

        // 阶段3: 转换为 URL (70-85%)
        setProgress({ visible: true, percent: basePercent + rangePercent * 0.7, message: `处理 ${file.name} (${i + 1}/${total})` });
        const fileUrl = await convertFilePathToUrl(filePath);

        // 阶段4: 添加到画布 (85-100%)
        setProgress({ visible: true, percent: basePercent + rangePercent * 0.85, message: `添加到画布 ${file.name} (${i + 1}/${total})` });
        
        if (editorRef.current) {
          const editor = editorRef.current;
          
          if (isImage) {
            const imageAssetId = AssetRecordType.createId();
            const image = new Image();
            image.onload = () => {
              try {
                editor.createAssets([
                  {
                    id: imageAssetId,
                    type: 'image',
                    typeName: 'asset',
                    props: {
                      w: image.width,
                      h: image.height,
                      name: file.name,
                      src: fileUrl,
                      mimeType: file.type || 'image/png',
                      isAnimated: false,
                    },
                    meta: {},
                  },
                ]);
                editor.createShape({
                  id: createShapeId(),
                  type: 'image',
                  x: Math.random() * 400,
                  y: Math.random() * 400,
                  props: {
                    w: image.width,
                    h: image.height,
                    assetId: imageAssetId,
                  },
                });
              } catch (err) {
                console.error('创建图片资源失败:', err);
                showToast('error', `创建图片资源失败: ${file.name}`);
              }
            };
            image.onerror = () => showToast('error', `加载图片失败: ${file.name}`);
            image.src = fileUrl;
          } else if (isVideo) {
            const videoAssetId = AssetRecordType.createId();
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.onloadedmetadata = () => {
              try {
                editor.createAssets([
                  {
                    id: videoAssetId,
                    type: 'video',
                    typeName: 'asset',
                    props: {
                      w: video.videoWidth || 640,
                      h: video.videoHeight || 360,
                      name: file.name,
                      src: fileUrl,
                      mimeType: file.type || 'video/mp4',
                      isAnimated: true,
                    },
                    meta: {},
                  },
                ]);
                editor.createShape({
                  id: createShapeId(),
                  type: 'video',
                  x: Math.random() * 400,
                  y: Math.random() * 400,
                  props: {
                    w: video.videoWidth || 640,
                    h: video.videoHeight || 360,
                    assetId: videoAssetId,
                  },
                });
              } catch (err) {
                console.error('创建视频资源失败:', err);
                showToast('error', `创建视频资源失败: ${file.name}`);
              }
            };
            video.onerror = () => showToast('error', `加载视频失败: ${file.name}`);
            video.src = fileUrl;
          }
        }
        
        showToast('success', `文件 "${file.name}" 已上传并添加到画布`);
      }
      setProgress({ visible: true, percent: 100, message: '上传完成' });
      setTimeout(() => setProgress(p => ({ ...p, visible: false })), 500);
    } catch (error: any) {
      showToast('error', `上传文件失败: ${error.message}`);
      setProgress(p => ({ ...p, visible: false }));
    }
  }, [currentProject, showToast]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await handleFileUpload(files);
    }
  }, [handleFileUpload]);

  // 处理文件选择
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await handleFileUpload(files);
    }
    e.target.value = '';
  }, [handleFileUpload]);

  // Tauri 原生文件拖拽：支持从系统资源管理器直接拖入图片/视频
  useEffect(() => {
    if (typeof window === 'undefined' || !(window as any).__TAURI__) return;
    let cleanups: (() => void)[] = [];
    const ACCEPTED_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.mp4', '.webm', '.ogg', '.mov'];
    const MIME_MAP: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
      bmp: 'image/bmp', gif: 'image/gif',
      mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', mov: 'video/mp4',
    };
    const setup = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/tauri');
      const isVisible = () => whiteboardContainerRef.current ? whiteboardContainerRef.current.offsetWidth > 0 : false;

      const unDrop = await listen<string[]>('tauri://file-drop', async (event) => {
        if (!isVisible()) return;
        let paths = (Array.isArray(event.payload) ? event.payload : []).filter(
          p => ACCEPTED_EXTS.some(ext => p.toLowerCase().endsWith(ext))
        );
        if (paths.length === 0) return;
        const files: File[] = [];
        for (const p of paths) {
          try {
            const data: number[] = await invoke('read_binary_file_with_path', { filePath: p });
            const ext = p.split('.').pop()?.toLowerCase() || 'png';
            const name = p.split(/[\\/]/).pop() || 'file';
            files.push(new File([new Uint8Array(data)], name, { type: MIME_MAP[ext] || 'application/octet-stream' }));
          } catch (err) {
            console.error('[Whiteboard] Failed to read file:', p, err);
          }
        }
        if (files.length > 0) handleFileUpload(files);
      });
      const unHover = await listen('tauri://file-drop-hover', () => {});
      const unCancel = await listen('tauri://file-drop-cancelled', () => {});
      cleanups = [unDrop, unHover, unCancel];
    };
    setup();
    return () => cleanups.forEach(fn => fn());
  }, [handleFileUpload]);

  // 导出画布为 PNG
  const handleExportPng = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) {
      showToast('error', '画布未加载');
      return;
    }

    try {
      // 获取所有形状的 ID
      const shapeIds = editor.getCurrentPageShapeIds();
      if (shapeIds.size === 0) {
        showToast('error', '画布为空，无法导出');
        return;
      }

      // 导出为 PNG blob
      const blob = await editor.toImage([...shapeIds], {
        format: 'png',
        background: true,
      });

      if (!blob) {
        showToast('error', '导出失败');
        return;
      }

      // 创建下载链接
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentProject?.name || 'whiteboard'}-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast('success', '已导出为 PNG');
    } catch (error: any) {
      console.error('导出失败:', error);
      showToast('error', `导出失败: ${error.message}`);
    }
  }, [currentProject, showToast]);

  // 导出画布数据为 JSON（可分享）
  const handleExportJson = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) {
      showToast('error', '画布未加载');
      return;
    }

    try {
      // 获取画布数据快照
      const snapshot = editor.getSnapshot();
      
      const exportData = {
        version: 1,
        projectName: currentProject?.name || 'whiteboard',
        exportTime: new Date().toISOString(),
        data: snapshot,
      };

      // 创建下载链接
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentProject?.name || 'whiteboard'}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast('success', '已导出画布数据，可分享给他人导入');
    } catch (error: any) {
      console.error('导出失败:', error);
      showToast('error', `导出失败: ${error.message}`);
    }
  }, [currentProject, showToast]);

  // 导入画布数据
  const handleImportJson = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const editor = editorRef.current;
    if (!editor) {
      showToast('error', '画布未加载');
      return;
    }

    setProgress({ visible: true, percent: 0, message: '正在读取导入文件...' });

    try {
      setProgress({ visible: true, percent: 20, message: '正在解析画布数据...' });
      const text = await file.text();
      const importData = JSON.parse(text);

      if (!importData.data) {
        showToast('error', '无效的画布数据文件');
        setProgress(p => ({ ...p, visible: false }));
        return;
      }

      setProgress({ visible: true, percent: 70, message: '正在加载到画布...' });
      editor.loadSnapshot(importData.data);
      setProgress({ visible: true, percent: 100, message: '导入完成' });
      showToast('success', `已导入画布: ${importData.projectName || '未命名'}`);
      setTimeout(() => setProgress(p => ({ ...p, visible: false })), 500);
    } catch (error: any) {
      console.error('导入失败:', error);
      showToast('error', `导入失败: ${error.message}`);
      setProgress(p => ({ ...p, visible: false }));
    }

    e.target.value = '';
  }, [showToast]);

  if (!currentProject) {
    return (
      <div className="h-full flex items-center justify-center bg-[#0a0a0a]">
        <div className="text-center max-w-sm">
          <p className="text-white text-lg mb-4">创建第一个画布项目</p>
          {!storagePath && (
            <p className="text-[#888] text-sm mb-3">
              保存项目前需在设置中选择存储路径。
              <button
                type="button"
                onClick={openSettingsAndHighlightPath}
                className="ml-1.5 text-blue-400 hover:text-blue-300 underline"
              >
                去设置
              </button>
            </p>
          )}
          <button
            onClick={async () => {
              if (!storagePath) {
                showToast('info', '请先关联本地目录以保存画布项目');
                openSettingsAndHighlightPath();
                return;
              }
              await handleCreateProject();
            }}
            className="px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors flex items-center gap-2 mx-auto"
          >
            <Plus size={20} />
            创建项目
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={whiteboardContainerRef} className="h-full flex flex-col bg-[#0a0a0a] relative">
      {/* 悬浮工具栏 */}
      <div className="absolute top-3 right-3 z-[1000] flex items-center gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
        {/* 项目选择器 */}
        <div className="relative">
          <div className="flex items-center bg-[#1a1a1a]/90 backdrop-blur-sm rounded-lg border border-[#2a2a2a] shadow-lg overflow-hidden">
            {isEditingProjectName ? (
              <div className="flex items-center px-3 py-1.5 gap-1">
                <input
                  type="text"
                  value={projectNameInput}
                  onChange={(e) => setProjectNameInput(e.target.value)}
                  onBlur={handleSaveProjectName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveProjectName();
                    else if (e.key === 'Escape') handleCancelEditProjectName();
                  }}
                  className="bg-transparent border-none outline-none text-white text-sm min-w-[140px]"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
                <button onClick={handleCancelEditProjectName} className="p-0.5 text-[#666] hover:text-white transition-colors">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => setShowProjectSelector(!showProjectSelector)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-white text-sm hover:bg-[#2a2a2a] transition-colors"
                >
                  <span className="max-w-[160px] truncate">{currentProject.name}</span>
                  <svg width="10" height="10" viewBox="0 0 10 10" className="opacity-50 shrink-0"><path d="M2 4l3 3 3-3" stroke="currentColor" fill="none" strokeWidth="1.5" /></svg>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleStartEditProjectName(); }}
                  className="px-1.5 py-1.5 text-[#666] hover:text-white hover:bg-[#2a2a2a] transition-colors border-l border-[#2a2a2a]"
                  title="重命名项目"
                >
                  <Edit2 size={13} />
                </button>
              </>
            )}
          </div>

          {/* 项目列表下拉菜单 */}
          {showProjectSelector && (
            <>
              <div className="fixed inset-0 z-[999]" onClick={() => setShowProjectSelector(false)} />
              <div className="absolute top-full right-0 mt-2 w-64 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg shadow-xl z-[1001] max-h-96 overflow-y-auto">
                <div className="p-2">
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      onClick={() => handleSelectProject(project.id)}
                      className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                        project.id === currentProject.id
                          ? 'bg-blue-600 text-white'
                          : 'text-[#a0a0a0] hover:bg-[#2a2a2a] hover:text-white'
                      }`}
                    >
                      {project.name}
                    </button>
                  ))}
                  <div className="border-t border-[#2a2a2a] mt-1 pt-1">
                    <button
                      onClick={() => { setShowProjectSelector(false); handleCreateProject(); }}
                      className="w-full text-left px-3 py-2 rounded text-sm text-blue-400 hover:bg-[#2a2a2a] transition-colors flex items-center gap-2"
                    >
                      <Plus size={14} />
                      新建项目
                    </button>
                    <label
                      className="w-full text-left px-3 py-2 rounded text-sm text-blue-400 hover:bg-[#2a2a2a] transition-colors flex items-center gap-2 cursor-pointer"
                      onClick={() => setShowProjectSelector(false)}
                    >
                      <Download size={14} />
                      导入项目
                      <input type="file" accept=".json" onChange={handleImportJson} className="hidden" />
                    </label>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center bg-[#1a1a1a]/90 backdrop-blur-sm rounded-lg border border-[#2a2a2a] shadow-lg overflow-hidden">
          <label className="p-2 text-white hover:bg-[#2a2a2a] transition-colors cursor-pointer" title="上传图片或视频">
            <Plus size={15} />
            <input type="file" multiple accept="image/*,video/mp4,video/webm,video/ogg" onChange={handleFileSelect} className="hidden" />
          </label>
          <button onClick={handleSaveCanvas} className="p-2 text-white hover:bg-green-600 transition-colors" title="保存画布">
            <Save size={15} />
          </button>
          <button onClick={handleExportPng} className="p-2 text-white hover:bg-[#2a2a2a] transition-colors" title="导出为PNG图片">
            <Download size={15} />
          </button>
          <button onClick={handleExportJson} className="p-2 text-white hover:bg-[#2a2a2a] transition-colors" title="分享画布数据">
            <Share2 size={15} />
          </button>
          <button onClick={handleToggleTheme} className="p-2 text-white hover:bg-[#2a2a2a] transition-colors" title={isDarkMode ? '切换到浅色模式' : '切换到深色模式'}>
            {isDarkMode ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </div>

      {/* 底部进度条 - 加载/上传时显示 */}
      {progress.visible && (
        <div className="absolute bottom-0 left-0 right-0 z-50 bg-[#1a1a1a] border-t border-[#2a2a2a] px-4 py-2">
          <div className="flex items-center gap-3">
            <div
              className="flex-1 h-2 bg-[#2a2a2a] rounded-full overflow-hidden"
              role="progressbar"
              aria-valuenow={Math.round(progress.percent)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={progress.message}
            >
              <div
                className="h-full bg-blue-500 transition-all duration-200 ease-out"
                style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
              />
            </div>
            <span className="text-sm text-[#a0a0a0] shrink-0 min-w-[100px] sm:min-w-[140px] truncate">
              {progress.message}
            </span>
          </div>
        </div>
      )}

      {/* 画布区域 - tldraw 需要明确的容器尺寸 */}
      <div
        className="flex-1 relative"
        style={{ minHeight: 0 }} /* 确保 flex 子元素可以正确收缩 */
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div style={{ position: 'absolute', inset: 0 }}>
          {!tldrawReady ? (
            <div className="h-full flex items-center justify-center bg-[#0a0a0a]">
              <div className="text-[#666] text-sm">正在加载画布…</div>
            </div>
          ) : (
          <TldrawErrorBoundary onReset={() => {
            editorRef.current = null;
          }}>
            <Tldraw
              onMount={(editor) => {
                const projectId = currentProject.id;
                editorRef.current = editor;
                console.log('tldraw 画布已加载，项目:', currentProject.name);

                const hideWatermark = () => {
                  let style = document.getElementById('tldraw-hide-watermark');
                  if (!style) {
                    style = document.createElement('style');
                    style.id = 'tldraw-hide-watermark';
                    document.head.appendChild(style);
                  }
                  style.textContent = `
                    .tlui-menu-zone [data-testid="made-with-tldraw"],
                    .tlui-menu-zone a[href*="tldraw"],
                    .tlui-menu-zone .tlui-menu__group:has(a[href*="tldraw"]),
                    .tlui-menu-zone a[href*="tldraw.com"],
                    .tlui-menu-zone .tlui-menu__group:has(a[href*="tldraw.com"]),
                    .tlui-menu-zone a[href*="made with tldraw"],
                    .tlui-menu-zone .tlui-menu__group:has(a[href*="made with tldraw"]) {
                      display: none !important;
                      visibility: hidden !important;
                      opacity: 0 !important;
                      height: 0 !important;
                      width: 0 !important;
                      pointer-events: none !important;
                    }
                    .tlui-layout__top__right {
                      padding-top: 48px !important;
                    }
                  `;
                  const watermarkElements = document.querySelectorAll(
                    '[data-testid="made-with-tldraw"], a[href*="tldraw"], a[href*="tldraw.com"]'
                  );
                  watermarkElements.forEach(el => {
                    if (el.parentElement) {
                      el.parentElement.removeChild(el);
                    }
                  });
                };
                
                hideWatermark();
                const wmTimers = [
                  setTimeout(hideWatermark, 100),
                  setTimeout(hideWatermark, 500),
                  setTimeout(hideWatermark, 1000),
                  setTimeout(hideWatermark, 2000),
                ];
                
                const tldrawContainer = document.querySelector('.tl-container') || document.body;
                const watermarkObserver = new MutationObserver(() => {
                  hideWatermark();
                });
                watermarkObserver.observe(tldrawContainer, {
                  childList: true,
                  subtree: true,
                });

                let savedTheme: string | null = null;
                try { savedTheme = localStorage.getItem(THEME_STORAGE_KEY); } catch { /* ignore */ }
                editor.user.updateUserPreferences({
                  colorScheme: savedTheme === 'light' ? 'light' : 'dark',
                });

                // 异步加载画布数据（不阻塞 onMount 返回，避免返回 Promise 导致 tldraw 内部 "p is not a function"）
                loadCanvasData(projectId, (percent, message) => {
                  setProgress({ visible: true, percent, message });
                }).then((savedData) => {
                  if (savedData && editorRef.current) {
                    editorRef.current.loadSnapshot(savedData as any);
                    console.log('已从本地文件加载画布数据');
                  }
                }).catch((error) => {
                  console.error('加载画布数据失败:', error);
                }).finally(() => {
                  setProgress(p => ({ ...p, visible: false }));
                });

                const AUTO_SAVE_INTERVAL_MS = 600000;
                const intervalId = setInterval(() => {
                  if (!editorRef.current) return;
                  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
                  const runSave = () => {
                    if (!editorRef.current) return;
                    try {
                      const snapshot = editorRef.current.getSnapshot();
                      saveCanvasData(projectId, snapshot).catch((error: unknown) => {
                        console.error('[Whiteboard] 自动保存失败:', error);
                      });
                    } catch (error: unknown) {
                      console.error('[Whiteboard] 自动保存(同步)失败:', error);
                    }
                  };
                  if (typeof requestIdleCallback !== 'undefined') {
                    requestIdleCallback(runSave, { timeout: 4000 });
                  } else {
                    setTimeout(runSave, 0);
                  }
                }, AUTO_SAVE_INTERVAL_MS);

                return () => {
                  clearInterval(intervalId);
                  wmTimers.forEach(clearTimeout);
                  watermarkObserver.disconnect();

                  if (editorRef.current) {
                    try {
                      const snapshot = editorRef.current.getSnapshot();
                      saveCanvasData(projectId, snapshot).catch((e: unknown) => {
                        console.error('[Whiteboard] 卸载前保存失败:', e);
                      });
                    } catch (e: unknown) {
                      console.error('[Whiteboard] 获取快照失败:', e);
                    }
                  }
                  editorRef.current = null;
                };
              }}
            />
          </TldrawErrorBoundary>
          )}
        </div>
      </div>
    </div>
  );
};

export default Whiteboard;
