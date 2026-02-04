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
    console.error('tldraw 组件错误:', error, errorInfo);
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
  saveAssetToProject,
  convertFilePathToUrl,
  WhiteboardProject
} from '../services/whiteboardProjectService';
import { getSavedStoragePath } from '../services/fileStorageService';
import { Edit2, X, Plus, Folder, Save } from 'lucide-react';
import { useToast } from './Toast';

const Whiteboard: React.FC = () => {
  const { showToast } = useToast();
  const [currentProject, setCurrentProjectState] = useState<WhiteboardProject | null>(null);
  const [projects, setProjects] = useState<WhiteboardProject[]>([]);
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [projectNameInput, setProjectNameInput] = useState('');
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const editorRef = useRef<Editor | null>(null);

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
      handleCreateProject();
    }
  }, [storagePath, projects.length, currentProject]);

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

  // 切换项目
  const handleSelectProject = async (projectId: string) => {
    try {
      setCurrentProject(projectId);
      const project = projects.find(p => p.id === projectId);
      if (project) {
        setCurrentProjectState(project);
        setProjectNameInput(project.name);
        setShowProjectSelector(false);
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

    for (const file of fileArray) {
      const isImage = imageTypes.includes(file.type);
      const isVideo = videoTypes.includes(file.type) || file.name.toLowerCase().endsWith('.mp4');

      if (!isImage && !isVideo) {
        showToast('warning', `不支持的文件类型: ${file.name}`);
        continue;
      }

      // 检查文件大小
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

      try {
        // 保存文件到项目目录
        const filePath = await saveAssetToProject(currentProject.id, file);
        
        // 转换为可访问的 URL
        const fileUrl = await convertFilePathToUrl(filePath);
        
        // 添加到 tldraw 画布
        if (editorRef.current) {
          const editor = editorRef.current;
          
          if (isImage) {
            // 创建图片资源
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
                
                // 创建图片形状
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
            image.onerror = () => {
              showToast('error', `加载图片失败: ${file.name}`);
            };
            image.src = fileUrl;
          } else if (isVideo) {
            // 创建视频资源
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
                
                // 创建视频形状
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
            video.onerror = () => {
              showToast('error', `加载视频失败: ${file.name}`);
            };
            video.src = fileUrl;
          }
        }
        
        showToast('success', `文件 "${file.name}" 已上传并添加到画布`);
      } catch (error: any) {
        showToast('error', `上传文件失败: ${error.message}`);
      }
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
    <div className="h-full flex flex-col bg-[#0a0a0a]">
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

        {/* 文件上传按钮 */}
        <div className="flex items-center gap-2">
          <label className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors cursor-pointer flex items-center gap-2">
            <Plus size={16} />
            上传文件
            <input
              type="file"
              multiple
              accept="image/*,video/mp4,video/webm,video/ogg"
              onChange={handleFileSelect}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* 画布区域 */}
      <div
        className="flex-1 relative"
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <TldrawErrorBoundary onReset={() => {
          editorRef.current = null;
        }}>
          <Tldraw
            onMount={(editor) => {
              editorRef.current = editor;
              
              // 隐藏水印
              const hideWatermark = () => {
                try {
                  // 检查是否已经添加了样式
                  if (document.getElementById('tldraw-hide-watermark')) {
                    return;
                  }
                  const style = document.createElement('style');
                  style.id = 'tldraw-hide-watermark';
                  style.textContent = `
                    .tlui-menu-zone [data-testid="made-with-tldraw"],
                    .tlui-menu-zone a[href*="tldraw"],
                    .tlui-menu-zone .tlui-menu__group:has(a[href*="tldraw"]),
                    .tlui-menu-zone a[href*="tldraw.com"],
                    .tlui-menu-zone .tlui-menu__group:has(a[href*="tldraw.com"]) {
                      display: none !important;
                      visibility: hidden !important;
                      opacity: 0 !important;
                      height: 0 !important;
                      width: 0 !important;
                    }
                  `;
                  document.head.appendChild(style);
                } catch (err) {
                  console.warn('隐藏水印失败:', err);
                }
              };
              
              // 立即隐藏
              hideWatermark();
              
              // 延迟再次隐藏（确保DOM渲染后）
              setTimeout(hideWatermark, 100);
              setTimeout(hideWatermark, 500);
              setTimeout(hideWatermark, 1000);
            }}
          />
        </TldrawErrorBoundary>
      </div>
    </div>
  );
};

export default Whiteboard;
