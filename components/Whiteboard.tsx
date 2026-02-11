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
import { getSavedStoragePath } from '../services/fileStorageService';
import { Edit2, X, Plus, Folder, Save, Download, Share2, Sun, Moon } from 'lucide-react';
import { useToast } from './Toast';

// 主题存储 key
const THEME_STORAGE_KEY = 'arthub_whiteboard_theme';

const Whiteboard: React.FC = () => {
  const { showToast } = useToast();
  const [currentProject, setCurrentProjectState] = useState<WhiteboardProject | null>(null);
  const [projects, setProjects] = useState<WhiteboardProject[]>([]);
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [projectNameInput, setProjectNameInput] = useState('');
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const editorRef = useRef<Editor | null>(null);
  
  // 进度条状态（加载/上传时显示）
  const [progress, setProgress] = useState<{ visible: boolean; percent: number; message: string }>({
    visible: false,
    percent: 0,
    message: '',
  });
  
  // 主题状态：'dark' | 'light'
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved !== 'light'; // 默认深色
  });

  // 切换主题
  const handleToggleTheme = useCallback(() => {
    const newIsDark = !isDarkMode;
    setIsDarkMode(newIsDark);
    localStorage.setItem(THEME_STORAGE_KEY, newIsDark ? 'dark' : 'light');
    
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

  // 手动保存当前画布
  const handleSaveCanvas = useCallback(async () => {
    if (!currentProject || !editorRef.current) {
      return;
    }

    try {
      const snapshot = editorRef.current.getSnapshot();
      await saveCanvasData(currentProject.id, snapshot);
      showToast('success', '画布已保存');
    } catch (error: any) {
      showToast('error', `保存失败: ${error.message}`);
    }
  }, [currentProject, showToast]);

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
    
    // 文件大小限制（单位：字节）
    const MAX_VIDEO_SIZE = 20 * 1024 * 1024; // 20MB
    const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

    const validFiles: File[] = [];
    for (const file of fileArray) {
      const isImage = imageTypes.includes(file.type);
      const isVideo = videoTypes.includes(file.type) || file.name.toLowerCase().endsWith('.mp4');

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

  // 处理拖拽上传
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
    // 重置 input，允许重复选择同一文件
    e.target.value = '';
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

  if (!storagePath) {
    return (
      <div className="h-full flex items-center justify-center bg-[#0a0a0a]">
        <div className="text-center">
          <p className="text-white text-lg mb-4">请先在设置中选择存储路径</p>
          <p className="text-[#666666] text-sm">画布项目将保存在存储路径下的 whiteboard 目录中</p>
        </div>
      </div>
    );
  }

  if (!currentProject) {
    return (
      <div className="h-full flex items-center justify-center bg-[#0a0a0a]">
        <div className="text-center">
          <p className="text-white text-lg mb-4">创建第一个画布项目</p>
          <button
            onClick={handleCreateProject}
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
    <div className="h-full flex flex-col bg-[#0a0a0a] relative">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between p-4 border-b border-[#1a1a1a] shrink-0">
        <div className="flex items-center gap-3">
          {/* 项目选择器 */}
          <div className="relative">
            <button
              onClick={() => setShowProjectSelector(!showProjectSelector)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1a1a1a] hover:bg-[#2a2a2a] text-white transition-colors"
            >
              <Folder size={16} />
              {isEditingProjectName ? (
                <input
                  type="text"
                  value={projectNameInput}
                  onChange={(e) => setProjectNameInput(e.target.value)}
                  onBlur={handleSaveProjectName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSaveProjectName();
                    } else if (e.key === 'Escape') {
                      handleCancelEditProjectName();
                    }
                  }}
                  className="bg-transparent border-none outline-none text-white min-w-[200px]"
                  autoFocus
                />
              ) : (
                <>
                  <span>{currentProject.name}</span>
                  <Edit2 size={14} className="opacity-50" />
                </>
              )}
            </button>

            {/* 项目列表下拉菜单 */}
            {showProjectSelector && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowProjectSelector(false)}
                />
                <div className="absolute top-full left-0 mt-2 w-64 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg shadow-xl z-50 max-h-96 overflow-y-auto">
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
                    <button
                      onClick={() => {
                        setShowProjectSelector(false);
                        handleCreateProject();
                      }}
                      className="w-full text-left px-3 py-2 rounded text-sm text-blue-400 hover:bg-[#2a2a2a] transition-colors flex items-center gap-2 mt-1"
                    >
                      <Plus size={14} />
                      新建项目
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* 编辑项目名按钮 */}
          {/* 编辑按钮已集成到项目选择器中，不需要单独的按钮 */}
        </div>

        {/* 工具栏按钮 */}
        <div className="flex items-center gap-2">
          {/* 上传文件 */}
          <label className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors cursor-pointer flex items-center gap-2 text-sm">
            <Plus size={16} />
            上传
            <input
              type="file"
              multiple
              accept="image/*,video/mp4,video/webm,video/ogg"
              onChange={handleFileSelect}
              className="hidden"
            />
          </label>

          {/* 保存按钮 */}
          <button
            onClick={handleSaveCanvas}
            className="px-3 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium transition-colors flex items-center gap-2 text-sm"
            title="保存画布到本地文件（自动保存每30秒）"
          >
            <Save size={16} />
            保存
          </button>

          {/* 导出为 PNG */}
          <button
            onClick={handleExportPng}
            className="px-3 py-2 rounded-lg bg-[#2a2a2a] hover:bg-[#3a3a3a] text-white font-medium transition-colors flex items-center gap-2 text-sm"
            title="导出为 PNG 图片"
          >
            <Download size={16} />
            导出图片
          </button>

          {/* 导出/分享 JSON */}
          <button
            onClick={handleExportJson}
            className="px-3 py-2 rounded-lg bg-[#2a2a2a] hover:bg-[#3a3a3a] text-white font-medium transition-colors flex items-center gap-2 text-sm"
            title="导出画布数据，可分享给他人"
          >
            <Share2 size={16} />
            分享
          </button>

          {/* 导入 JSON */}
          <label className="px-3 py-2 rounded-lg bg-[#2a2a2a] hover:bg-[#3a3a3a] text-white font-medium transition-colors cursor-pointer flex items-center gap-2 text-sm" title="导入他人分享的画布数据">
            <Folder size={16} />
            导入
            <input
              type="file"
              accept=".json"
              onChange={handleImportJson}
              className="hidden"
            />
          </label>

          {/* 主题切换 */}
          <button
            onClick={handleToggleTheme}
            className="px-3 py-2 rounded-lg bg-[#2a2a2a] hover:bg-[#3a3a3a] text-white font-medium transition-colors flex items-center gap-2 text-sm"
            title={isDarkMode ? '切换到浅色模式' : '切换到深色模式'}
          >
            {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
            {isDarkMode ? '浅色' : '深色'}
          </button>
        </div>
      </div>

      {/* 底部进度条 - 加载/上传时显示 */}
      {progress.visible && (
        <div className="absolute bottom-0 left-0 right-0 z-50 bg-[#1a1a1a] border-t border-[#2a2a2a] px-4 py-2">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-[#2a2a2a] rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-200 ease-out"
                style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
              />
            </div>
            <span className="text-sm text-[#a0a0a0] shrink-0 min-w-[140px]">
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
        {/* tldraw 容器需要 position: absolute 来填充父元素 */}
        <div style={{ position: 'absolute', inset: 0 }}>
          <TldrawErrorBoundary onReset={() => {
            editorRef.current = null;
          }}>
            <Tldraw
              // 不使用 key 避免切换项目时卸载，防止 tldraw 内部 dispose 触发 "h is not a function"
              onMount={async (editor) => {
                const projectId = currentProject.id;
                editorRef.current = editor;
                console.log('tldraw 画布已加载，项目:', currentProject.name);

                const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
                editor.user.updateUserPreferences({
                  colorScheme: savedTheme === 'light' ? 'light' : 'dark',
                });

                try {
                  const savedData = await loadCanvasData(projectId, (percent, message) => {
                    setProgress({ visible: true, percent, message });
                  });
                  if (savedData) {
                    editor.loadSnapshot(savedData as any);
                    console.log('已从本地文件加载画布数据');
                  }
                } catch (error) {
                  console.error('加载画布数据失败:', error);
                } finally {
                  setProgress(p => ({ ...p, visible: false }));
                }

                // 使用定时器代替 store.listen，避免 tldraw 内部 dispose 时 "h is not a function" 错误
                const AUTO_SAVE_INTERVAL_MS = 600000; // 10 分钟
                const intervalId = setInterval(async () => {
                  if (!editorRef.current) return;
                  try {
                    const snapshot = editorRef.current.getSnapshot();
                    await saveCanvasData(projectId, snapshot);
                  } catch (error) {
                    console.error('自动保存失败:', error);
                  }
                }, AUTO_SAVE_INTERVAL_MS);

                return () => {
                  clearInterval(intervalId);

                  if (editorRef.current) {
                    try {
                      const snapshot = editorRef.current.getSnapshot();
                      saveCanvasData(projectId, snapshot).catch((e) =>
                        console.error('[Whiteboard] 卸载前保存失败:', e)
                      );
                    } catch (e) {
                      console.error('[Whiteboard] 获取快照失败:', e);
                    }
                  }
                  editorRef.current = null;
                };
              }}
            />
          </TldrawErrorBoundary>
        </div>
      </div>
    </div>
  );
};

export default Whiteboard;
