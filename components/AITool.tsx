import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Plus, Edit2, Trash2, ExternalLink, Image as ImageIcon, 
  Save, X, Sparkles, Star, Grid3X3, SortAsc
} from 'lucide-react';
import { useToast } from './Toast';
import { TemplateCard, TemplateTag, SearchBar, FilterDropdown, Tag } from './ui';
import { 
  addFavorite, 
  removeFavorite, 
  isFavorited as checkIsFavorited,
  FavoriteItem 
} from '../services/favoritesService';
import { useMiddleMouseScroll } from '../utils/useMiddleMouseScroll';
import { openUrl, openUrlWithShell } from '../services/windowService';

interface AIConfig {
  id: string;
  name: string;
  url: string;
  description?: string;
  jsonFile?: string;
  jsonFileName?: string;
  thumbnail?: string;
  tags?: string[];
  category?: string;
  createdAt: number;
  updatedAt: number;
}

// 预定义的标签选项
const TAG_OPTIONS = [
  { value: 'product', label: 'Product' },
  { value: 'api', label: 'API' },
  { value: 'image', label: '图片编辑' },
  { value: 'video', label: '视频生成' },
  { value: 'design', label: '品牌设计' },
  { value: 'workflow', label: '工作流' },
];

// 分类选项
const CATEGORY_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'image', label: '图像' },
  { value: 'video', label: '视频' },
  { value: '3d', label: '3D模型' },
  { value: 'audio', label: '音频' },
  { value: 'api', label: 'AI盒子' },
];

// 排序选项
const SORT_OPTIONS = [
  { value: 'newest', label: '最新' },
  { value: 'oldest', label: '最早' },
  { value: 'name', label: '名称' },
];

const AITool: React.FC = () => {
  const { showToast } = useToast();
  const [configs, setConfigs] = useState<AIConfig[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState<Partial<AIConfig>>({
    name: '',
    url: '',
    description: '',
    jsonFile: '',
    jsonFileName: '',
    thumbnail: '',
    tags: [],
    category: 'image',
  });
  
  // 搜索和筛选状态
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');

  const jsonFileInputRef = useRef<HTMLInputElement>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  
  // 鼠标中键滚动
  const scrollContainerRef = useMiddleMouseScroll<HTMLDivElement>({
    enabled: true,
    scrollSpeed: 1.5
  });

  const STORAGE_KEY = 'arthub_ai_configs';

  // 加载配置
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // 迁移旧数据格式
        const migrated = parsed.map((config: any) => ({
          ...config,
          description: config.description || '',
          tags: config.tags || [],
          category: config.category || 'image',
        }));
        setConfigs(migrated);
      } catch (e) {
        console.error('Failed to load AI configs:', e);
      }
    }
  }, []);

  // 筛选和排序后的配置
  const filteredConfigs = useMemo(() => {
    let result = [...configs];

    // 搜索过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(config => 
        config.name.toLowerCase().includes(query) ||
        config.description?.toLowerCase().includes(query) ||
        config.tags?.some(tag => tag.toLowerCase().includes(query))
      );
    }

    // 分类过滤
    if (categoryFilter !== 'all') {
      result = result.filter(config => config.category === categoryFilter);
    }

    // 排序
    result.sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return b.createdAt - a.createdAt;
        case 'oldest':
          return a.createdAt - b.createdAt;
        case 'name':
          return a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });

    return result;
  }, [configs, searchQuery, categoryFilter, sortBy]);

  // 保存配置
  const saveConfigs = (newConfigs: AIConfig[]) => {
    setConfigs(newConfigs);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfigs));
  };

  // 生成ID
  const generateId = () => {
    return `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  // 处理文件转base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // 处理缩略图上传
  const handleThumbnailChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type.startsWith('image/')) {
        try {
          const base64 = await fileToBase64(file);
          setFormData({ ...formData, thumbnail: base64 });
        } catch (error) {
          console.error('Failed to convert thumbnail to base64:', error);
          showToast('error', '缩略图上传失败');
        }
      } else {
        showToast('warning', '请选择图片文件');
      }
    }
  };

  // 处理JSON文件选择
  const handleJsonFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const text = await file.text();
        const fileName = file.name;
        
        const isTauri = typeof window !== 'undefined' && (window as any).__TAURI__;
        
        if (isTauri) {
          try {
            const { writeTextFile, createDir, exists, BaseDirectory } = await import('@tauri-apps/api/fs');
            const { appDataDir, join } = await import('@tauri-apps/api/path');
            
            if (!writeTextFile || !BaseDirectory) {
              throw new Error('Tauri fs API 导入失败');
            }
            
            const fileId = editingId || `temp_${Date.now()}`;
            const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
            const uniqueFileName = `${fileId}_${safeFileName}`;
            const relativePath = `comfyui工作流/${uniqueFileName}`;
            
            try {
              await createDir('comfyui工作流', { 
                dir: BaseDirectory.AppData, 
                recursive: true 
              });
            } catch (dirError: any) {
              console.log('Directory check:', dirError.message);
            }
            
            await writeTextFile(relativePath, text, { 
              dir: BaseDirectory.AppData 
            });
            
            const appDataDirPath = await appDataDir();
            const fullPath = await join(appDataDirPath, relativePath);
            
            const fileExists = await exists(relativePath, { 
              dir: BaseDirectory.AppData 
            });
            
            if (!fileExists) {
              throw new Error('文件保存后验证失败');
            }
            
            setFormData({ 
              ...formData, 
              jsonFile: fullPath,
              jsonFileName: fileName
            });
            
            showToast('success', `JSON文件已保存`);
          } catch (error: any) {
            console.error('Failed to save JSON file:', error);
            const base64 = btoa(unescape(encodeURIComponent(text)));
            setFormData({ 
              ...formData, 
              jsonFile: `data:application/json;base64,${base64}`,
              jsonFileName: fileName
            });
            showToast('warning', '使用内存模式保存');
          }
        } else {
          const base64 = btoa(unescape(encodeURIComponent(text)));
          setFormData({ 
            ...formData, 
            jsonFile: `data:application/json;base64,${base64}`,
            jsonFileName: fileName
          });
        }
      } catch (error) {
        console.error('Failed to read JSON file:', error);
        showToast('error', '读取JSON文件失败');
      }
    }
  };

  // 打开AI网站
  const handleOpenAI = async (config: AIConfig) => {
    try {
      if (!config.url) {
        showToast('error', 'URL不能为空');
        return;
      }

      const isTauri = typeof window !== 'undefined' && (window as any).__TAURI__;
      
      if (isTauri) {
        try {
          const { invoke } = await import('@tauri-apps/api/tauri');
          
          let jsonContent: string | null = null;
          
          if (config.jsonFile) {
            try {
              if (config.jsonFile.startsWith('data:application/json;base64,')) {
                const base64 = config.jsonFile.replace('data:application/json;base64,', '');
                jsonContent = decodeURIComponent(escape(atob(base64)));
              } else {
                const { readTextFile, BaseDirectory } = await import('@tauri-apps/api/fs');
                const { appDataDir, join } = await import('@tauri-apps/api/path');
                
                try {
                  jsonContent = await readTextFile(config.jsonFile);
                } catch (readError) {
                  const appDataDirPath = await appDataDir();
                  const workflowDir = await join(appDataDirPath, 'comfyui工作流');
                  const fileName = config.jsonFile.split(/[/\\]/).pop() || '';
                  const fallbackPath = await join(workflowDir, fileName);
                  
                  try {
                    const relativePath = `comfyui工作流/${fileName}`;
                    jsonContent = await readTextFile(relativePath, { dir: BaseDirectory.AppData });
                  } catch {
                    jsonContent = await readTextFile(fallbackPath);
                  }
                }
              }
            } catch (error) {
              console.error('Failed to read JSON file:', error);
              showToast('warning', `读取JSON文件失败: ${config.jsonFileName || '未知文件'}`, 5000);
            }
          }

          // 验证 JSON
          if (jsonContent) {
            try {
              JSON.parse(jsonContent);
            } catch (e) {
              showToast('error', '工作流 JSON 格式无效');
              return;
            }
          }

          // 复制到剪贴板
          let clipboardSuccess = false;
          if (jsonContent) {
            try {
              await navigator.clipboard.writeText(jsonContent);
              clipboardSuccess = true;
              showToast('success', '工作流已复制到剪贴板', 2000);
            } catch (error) {
              console.warn('Clipboard copy failed:', error);
            }
          }

          // 发送到 ComfyUI
          if (jsonContent && config.url) {
            const comfyuiBaseUrl = new URL(config.url).origin;
            invoke('send_workflow_to_comfyui', {
              comfyUrl: comfyuiBaseUrl,
              workflowJson: jsonContent,
            }).then((result) => {
              if (result === 'extension') {
                showToast('success', '工作流已自动加载!', 3000);
              } else if (result === 'userdata') {
                // userdata API 成功，但不显示提示（用户需要手动加载）
              }
              // 其他情况（如剪贴板方案）静默处理，避免控制台噪音
            }).catch((err) => {
              // 静默处理错误，这些错误是正常的（ComfyUI 未运行或扩展未安装时）
              // 只在开发模式下输出日志
              if (process.env.NODE_ENV === 'development') {
                console.debug('[AITool] ComfyUI API failed (this is normal if ComfyUI is not running):', err);
              }
            });
          }

          // 打开浏览器
          try {
            await openUrlWithShell(config.url);
          } catch {
            openUrl(config.url, '_blank');
          }

          // 键盘模拟
          if (clipboardSuccess && jsonContent) {
            invoke('simulate_paste', { delayMs: 4000 })
              .then(() => {
                showToast('info', '已发送粘贴命令', 3000);
              })
              .catch(() => {
                showToast('info', '请在ComfyUI中按 Ctrl+V', 5000);
              });
          }
        } catch (error) {
          console.error('Tauri error:', error);
          openUrl(config.url, '_blank');
        }
      } else {
        openUrl(config.url, '_blank');
        
        if (config.jsonFile && config.jsonFile.startsWith('data:application/json;base64,')) {
          setTimeout(async () => {
            try {
              const base64 = config.jsonFile!.replace('data:application/json;base64,', '');
              const jsonContent = decodeURIComponent(escape(atob(base64)));
              await navigator.clipboard.writeText(jsonContent);
              showToast('success', 'JSON已复制到剪贴板', 5000);
            } catch (error) {
              console.error('Failed to copy JSON:', error);
            }
          }, 1000);
        }
      }
    } catch (error) {
      console.error('Failed to open AI:', error);
      showToast('error', '打开失败');
    }
  };

  // 添加配置
  const handleAdd = async () => {
    if (!formData.name || !formData.url) {
      showToast('warning', '请填写名称和URL');
      return;
    }

    const newId = generateId();
    
    // 处理临时文件重命名
    if (formData.jsonFile && formData.jsonFile.includes('temp_')) {
      const isTauri = typeof window !== 'undefined' && (window as any).__TAURI__;
      if (isTauri) {
        try {
          const { readTextFile, writeTextFile, removeFile, BaseDirectory } = await import('@tauri-apps/api/fs');
          const { appDataDir, join } = await import('@tauri-apps/api/path');
          
          let content: string;
          try {
            content = await readTextFile(formData.jsonFile);
          } catch {
            const fileName = formData.jsonFile.split(/[/\\]/).pop() || '';
            const relativePath = `comfyui工作流/${fileName}`;
            content = await readTextFile(relativePath, { dir: BaseDirectory.AppData });
          }
          
          const safeFileName = (formData.jsonFileName || 'workflow.json').replace(/[^a-zA-Z0-9._-]/g, '_');
          const newFileName = `${newId}_${safeFileName}`;
          const relativePath = `comfyui工作流/${newFileName}`;
          
          await writeTextFile(relativePath, content, { dir: BaseDirectory.AppData });
          
          const appDataDirPath = await appDataDir();
          const newFilePath = await join(appDataDirPath, relativePath);
          
          try {
            await removeFile(formData.jsonFile);
          } catch {
            try {
              const oldFileName = formData.jsonFile.split(/[/\\]/).pop() || '';
              const oldRelativePath = `comfyui工作流/${oldFileName}`;
              await removeFile(oldRelativePath, { dir: BaseDirectory.AppData });
            } catch {}
          }
          
          formData.jsonFile = newFilePath;
        } catch (error) {
          console.error('Failed to rename JSON file:', error);
        }
      }
    }

    const newConfig: AIConfig = {
      id: newId,
      name: formData.name!,
      url: formData.url!,
      description: formData.description || '',
      jsonFile: formData.jsonFile,
      jsonFileName: formData.jsonFileName,
      thumbnail: formData.thumbnail,
      tags: formData.tags || [],
      category: formData.category || 'image',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    saveConfigs([...configs, newConfig]);
    resetForm();
    setShowAddModal(false);
    showToast('success', '添加成功');
  };

  // 开始编辑
  const handleStartEdit = (config: AIConfig) => {
    setEditingId(config.id);
    setFormData({
      name: config.name,
      url: config.url,
      description: config.description || '',
      jsonFile: config.jsonFile,
      jsonFileName: config.jsonFileName,
      thumbnail: config.thumbnail,
      tags: config.tags || [],
      category: config.category || 'image',
    });
    setShowAddModal(true);
  };

  // 保存编辑
  const handleSaveEdit = async () => {
    if (!formData.name || !formData.url) {
      showToast('warning', '请填写名称和URL');
      return;
    }

    // 处理临时文件
    if (formData.jsonFile && formData.jsonFile.includes('temp_') && editingId) {
      const isTauri = typeof window !== 'undefined' && (window as any).__TAURI__;
      if (isTauri) {
        try {
          const { readTextFile, writeTextFile, removeFile, BaseDirectory } = await import('@tauri-apps/api/fs');
          const { appDataDir, join } = await import('@tauri-apps/api/path');
          
          let content: string;
          try {
            content = await readTextFile(formData.jsonFile);
          } catch {
            const fileName = formData.jsonFile.split(/[/\\]/).pop() || '';
            const relativePath = `comfyui工作流/${fileName}`;
            content = await readTextFile(relativePath, { dir: BaseDirectory.AppData });
          }
          
          const safeFileName = (formData.jsonFileName || 'workflow.json').replace(/[^a-zA-Z0-9._-]/g, '_');
          const newFileName = `${editingId}_${safeFileName}`;
          const relativePath = `comfyui工作流/${newFileName}`;
          
          await writeTextFile(relativePath, content, { dir: BaseDirectory.AppData });
          
          const appDataDirPath = await appDataDir();
          const newFilePath = await join(appDataDirPath, relativePath);
          
          try {
            await removeFile(formData.jsonFile);
          } catch {
            try {
              const oldFileName = formData.jsonFile.split(/[/\\]/).pop() || '';
              const oldRelativePath = `comfyui工作流/${oldFileName}`;
              await removeFile(oldRelativePath, { dir: BaseDirectory.AppData });
            } catch {}
          }
          
          formData.jsonFile = newFilePath;
        } catch (error) {
          console.error('Failed to rename JSON file:', error);
        }
      }
    }

    const updated = configs.map(c => 
      c.id === editingId 
        ? { ...c, ...formData, updatedAt: Date.now() }
        : c
    );

    saveConfigs(updated);
    resetForm();
    setShowAddModal(false);
    showToast('success', '保存成功');
  };

  // 删除配置
  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('确定要删除这个配置吗？')) {
      saveConfigs(configs.filter(c => c.id !== id));
      showToast('success', '已删除');
    }
  };

  // 重置表单
  const resetForm = () => {
    setEditingId(null);
    setFormData({ 
      name: '', 
      url: '', 
      description: '',
      jsonFile: '', 
      jsonFileName: '', 
      thumbnail: '',
      tags: [],
      category: 'image',
    });
  };

  // 取消编辑
  const handleCancel = () => {
    resetForm();
    setShowAddModal(false);
  };

  // 切换标签
  const toggleTag = (tagValue: string) => {
    const currentTags = formData.tags || [];
    if (currentTags.includes(tagValue)) {
      setFormData({ ...formData, tags: currentTags.filter(t => t !== tagValue) });
    } else {
      setFormData({ ...formData, tags: [...currentTags, tagValue] });
    }
  };

  // 获取配置的标签
  const getConfigTags = (config: AIConfig): TemplateTag[] => {
    const tags: TemplateTag[] = [];
    
    if (config.tags) {
      config.tags.forEach(tag => {
        const tagOption = TAG_OPTIONS.find(t => t.value === tag);
        if (tagOption) {
          tags.push({ label: tagOption.label, type: tag as any });
        }
      });
    }
    
    if (config.jsonFile) {
      tags.push({ label: 'Workflow', type: 'workflow' });
    }
    
    return tags;
  };

  // 处理收藏
  const handleToggleFavorite = (config: AIConfig, e: React.MouseEvent) => {
    e.stopPropagation();
    const favoriteItem: FavoriteItem = {
      id: `ai_workflow_${config.id}`,
      type: 'ai_workflow',
      aiWorkflow: {
        id: config.id,
        name: config.name,
        url: config.url,
        description: config.description,
        thumbnail: config.thumbnail,
        tags: config.tags,
        category: config.category,
      },
      createdAt: Date.now()
    };
    
    const wasAdded = checkIsFavorited('ai_workflow', config.id);
    if (wasAdded) {
      removeFavorite('ai_workflow', config.id);
      showToast('info', '已取消收藏');
    } else {
      addFavorite(favoriteItem);
      showToast('success', '已添加到收藏');
    }
  };

  // 检查是否已收藏
  const isFavorited = (configId: string): boolean => {
    return checkIsFavorited('ai_workflow', configId);
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#0a0a0a]">
      {/* 顶部筛选栏 */}
      <div className="flex flex-col gap-4 p-6 border-b border-[#1a1a1a]">
        {/* 第一行：搜索和排序 */}
        <div className="flex items-center gap-4">
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="搜索模板..."
            className="w-80"
          />
          
          <div className="flex-1" />
          
          <FilterDropdown
            label="排序"
            options={SORT_OPTIONS}
            value={sortBy}
            onChange={setSortBy}
          />
        </div>
        
        {/* 第二行：分类标签 */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-[#808080] font-medium mr-2">分类：</span>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_OPTIONS.map((category) => (
              <button
                key={category.value}
                onClick={() => setCategoryFilter(category.value)}
                className={`
                  inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium
                  transition-all duration-150 cursor-pointer
                  ${categoryFilter === category.value
                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50 shadow-sm'
                    : 'bg-[#1a1a1a] text-[#808080] border border-[#2a2a2a] hover:border-[#3a3a3a] hover:text-[#a0a0a0] hover:bg-[#222222]'
                  }
                `}
              >
                {category.label}
              </button>
            ))}
          </div>
        </div>
        
        <div className="flex justify-end">
          <button
            onClick={() => {
              resetForm();
              setShowAddModal(true);
            }}
            className="
              flex items-center gap-2 px-4 py-2.5
              bg-blue-600 hover:bg-blue-700
              text-white font-medium rounded-lg
              transition-colors duration-150
            "
          >
            <Plus size={18} />
            添加工作流
          </button>
        </div>
      </div>

      {/* 内容区域 */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-auto p-6"
        style={{ scrollbarWidth: 'thin' }}
      >
        {filteredConfigs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-20 h-20 rounded-full bg-[#1a1a1a] flex items-center justify-center mb-4">
              <Sparkles size={32} className="text-[#333333]" />
            </div>
            <h3 className="text-lg font-medium text-white mb-2">
              {searchQuery || categoryFilter !== 'all' ? '没有找到匹配的模板' : '还没有工作流模板'}
            </h3>
            <p className="text-[#666666] mb-6">
              {searchQuery || categoryFilter !== 'all' 
                ? '尝试调整搜索条件' 
                : '点击"添加工作流"开始创建你的第一个模板'}
            </p>
            {!searchQuery && categoryFilter === 'all' && (
              <button
                onClick={() => {
                  resetForm();
                  setShowAddModal(true);
                }}
                className="
                  flex items-center gap-2 px-6 py-3
                  bg-blue-600 hover:bg-blue-700
                  text-white font-medium rounded-lg
                  transition-colors duration-150
                "
              >
                <Plus size={18} />
                添加工作流
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filteredConfigs.map((config, index) => (
              <div 
                key={config.id} 
                className="relative group animate-fade-in"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <TemplateCard
                  title={config.name}
                  description={config.description || config.url}
                  thumbnail={config.thumbnail}
                  tags={getConfigTags(config)}
                  onClick={() => handleOpenAI(config)}
                  showPlayButton={!!config.jsonFile}
                />
                
                {/* 收藏按钮 - 左上角 */}
                <button
                  onClick={(e) => handleToggleFavorite(config, e)}
                  className={`
                    absolute top-3 left-3 z-10
                    p-2 rounded-lg
                    transition-all duration-150
                    ${isFavorited(config.id)
                      ? 'bg-yellow-500/20 backdrop-blur-sm text-yellow-400 opacity-100'
                      : 'bg-black/60 backdrop-blur-sm text-white opacity-0 group-hover:opacity-100 hover:bg-yellow-500/20 hover:text-yellow-400'
                    }
                  `}
                  title={isFavorited(config.id) ? "取消收藏" : "添加到收藏"}
                >
                  <Star size={14} fill={isFavorited(config.id) ? "currentColor" : "none"} />
                </button>

                {/* 悬浮操作按钮 - 右上角 */}
                <div className="
                  absolute top-3 right-3 z-10
                  flex gap-1.5
                  opacity-0 group-hover:opacity-100
                  transition-opacity duration-150
                ">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStartEdit(config);
                    }}
                    className="
                      p-2 rounded-lg
                      bg-black/60 backdrop-blur-sm
                      text-white hover:bg-black/80
                      transition-colors duration-150
                    "
                    title="编辑"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={(e) => handleDelete(config.id, e)}
                    className="
                      p-2 rounded-lg
                      bg-black/60 backdrop-blur-sm
                      text-red-400 hover:bg-red-500/30 hover:text-red-300
                      transition-colors duration-150
                    "
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 添加/编辑模态框 */}
      {showAddModal && (
        <div 
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleCancel();
            }
          }}
        >
          <div 
            className="
              w-full max-w-lg mx-4
              bg-[#151515] border border-[#2a2a2a] rounded-xl
              shadow-2xl shadow-black/50
              animate-scale-in
            "
            onClick={(e) => e.stopPropagation()}
          >
            {/* 模态框头部 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
              <h2 className="text-lg font-semibold text-white">
                {editingId ? '编辑工作流' : '添加工作流'}
              </h2>
              <button
                onClick={handleCancel}
                className="p-1.5 rounded-lg text-[#666666] hover:text-white hover:bg-[#252525] transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* 模态框内容 */}
            <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
              {/* 名称 */}
              <div>
                <label className="block text-sm font-medium text-[#a0a0a0] mb-2">
                  名称 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="例如：产品图生成"
                  className="
                    w-full px-4 py-2.5 rounded-lg
                    bg-[#0f0f0f] border border-[#2a2a2a]
                    text-white placeholder-[#666666]
                    focus:outline-none focus:border-blue-500
                    transition-colors
                  "
                />
              </div>

              {/* URL */}
              <div>
                <label className="block text-sm font-medium text-[#a0a0a0] mb-2">
                  网站链接 <span className="text-red-400">*</span>
                </label>
                <input
                  type="url"
                  value={formData.url || ''}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  placeholder="https://example.com"
                  className="
                    w-full px-4 py-2.5 rounded-lg
                    bg-[#0f0f0f] border border-[#2a2a2a]
                    text-white placeholder-[#666666]
                    focus:outline-none focus:border-blue-500
                    transition-colors
                  "
                />
              </div>

              {/* 描述 */}
              <div>
                <label className="block text-sm font-medium text-[#a0a0a0] mb-2">
                  描述
                </label>
                <textarea
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="简要描述这个工作流的用途..."
                  rows={2}
                  className="
                    w-full px-4 py-2.5 rounded-lg resize-none
                    bg-[#0f0f0f] border border-[#2a2a2a]
                    text-white placeholder-[#666666]
                    focus:outline-none focus:border-blue-500
                    transition-colors
                  "
                />
              </div>

              {/* 分类 */}
              <div>
                <label className="block text-sm font-medium text-[#a0a0a0] mb-2">
                  分类
                </label>
                <div className="flex flex-wrap gap-2">
                  {CATEGORY_OPTIONS.filter(c => c.value !== 'all').map(category => (
                    <button
                      key={category.value}
                      onClick={() => setFormData({ ...formData, category: category.value })}
                      className={`
                        px-3 py-1.5 rounded-lg text-sm font-medium
                        transition-colors duration-150
                        ${formData.category === category.value
                          ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50'
                          : 'bg-[#1a1a1a] text-[#808080] border border-[#2a2a2a] hover:border-[#3a3a3a]'
                        }
                      `}
                    >
                      {category.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 标签 */}
              <div>
                <label className="block text-sm font-medium text-[#a0a0a0] mb-2">
                  标签
                </label>
                <div className="flex flex-wrap gap-2">
                  {TAG_OPTIONS.map(tag => (
                    <button
                      key={tag.value}
                      onClick={() => toggleTag(tag.value)}
                      className={`
                        px-3 py-1.5 rounded-lg text-sm font-medium
                        transition-colors duration-150
                        ${formData.tags?.includes(tag.value)
                          ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50'
                          : 'bg-[#1a1a1a] text-[#808080] border border-[#2a2a2a] hover:border-[#3a3a3a]'
                        }
                      `}
                    >
                      {tag.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* JSON文件 */}
              <div>
                <label className="block text-sm font-medium text-[#a0a0a0] mb-2">
                  工作流文件
                </label>
                <div className="flex gap-2">
                  <input
                    ref={jsonFileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleJsonFileChange}
                    className="hidden"
                  />
                  <input
                    type="text"
                    value={formData.jsonFileName || (formData.jsonFile ? '已选择文件' : '')}
                    readOnly
                    className="
                      flex-1 px-4 py-2.5 rounded-lg
                      bg-[#0f0f0f] border border-[#2a2a2a]
                      text-[#808080]
                    "
                    placeholder="未选择文件"
                  />
                  <button
                    onClick={() => jsonFileInputRef.current?.click()}
                    className="
                      px-4 py-2.5 rounded-lg
                      bg-[#1a1a1a] border border-[#2a2a2a]
                      text-[#a0a0a0] hover:text-white hover:border-[#3a3a3a]
                      transition-colors
                    "
                  >
                    选择
                  </button>
                </div>
              </div>

              {/* 缩略图 */}
              <div>
                <label className="block text-sm font-medium text-[#a0a0a0] mb-2">
                  缩略图
                </label>
                <div className="flex gap-4">
                  <input
                    ref={thumbnailInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleThumbnailChange}
                    className="hidden"
                  />
                  <div 
                    onClick={() => thumbnailInputRef.current?.click()}
                    className="
                      w-32 aspect-video rounded-lg overflow-hidden
                      bg-[#0f0f0f] border border-[#2a2a2a] border-dashed
                      flex items-center justify-center
                      cursor-pointer hover:border-[#3a3a3a]
                      transition-colors
                    "
                  >
                    {formData.thumbnail ? (
                      <img
                        src={formData.thumbnail}
                        alt="缩略图"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ImageIcon size={24} className="text-[#333333]" />
                    )}
                  </div>
                  <div className="flex-1 flex items-center">
                    <p className="text-xs text-[#666666]">
                      点击上传缩略图<br />
                      推荐尺寸 16:9
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* 模态框底部 */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#2a2a2a]">
              <button
                onClick={handleCancel}
                className="
                  px-4 py-2.5 rounded-lg
                  bg-[#1a1a1a] border border-[#2a2a2a]
                  text-[#a0a0a0] hover:text-white hover:border-[#3a3a3a]
                  transition-colors font-medium
                "
              >
                取消
              </button>
              <button
                onClick={editingId ? handleSaveEdit : handleAdd}
                className="
                  flex items-center gap-2 px-4 py-2.5 rounded-lg
                  bg-blue-600 hover:bg-blue-700
                  text-white font-medium
                  transition-colors
                "
              >
                <Save size={16} />
                {editingId ? '保存' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AITool;
