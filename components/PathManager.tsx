import React, { useState, useEffect, useMemo } from 'react';
import { 
  Folder, Globe, Server, ExternalLink, Copy, Trash2, Plus, 
  AlertCircle, Check, ChevronDown, ChevronRight, Pencil, Star, X, Save, Upload, Play, Grid3X3, Settings
} from 'lucide-react';
import { PathItem, PathType } from '../types';
import { MOCK_PATHS } from '../constants';
import { 
  addFavorite, 
  removeFavorite, 
  isFavorited as checkIsFavorited,
  FavoriteItem 
} from '../services/favoritesService';
import { handleDroppedAppFile, launchApp, isAppFile } from '../services/appService';

// 检查是否在 Tauri 环境中
const isTauriEnvironment = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

const PathManager: React.FC = () => {
  const [paths, setPaths] = useState<PathItem[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  
  // 快速路径状态（已迁移到收藏服务，保留用于兼容）
  const [quickPaths, setQuickPaths] = useState<PathItem[]>([]);
  const [justFavoritedId, setJustFavoritedId] = useState<string | null>(null);
  
  // 拖拽创建路径状态
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [showDragModal, setShowDragModal] = useState(false);
  const [draggedPath, setDraggedPath] = useState<{ path: string; name?: string; type?: PathType } | null>(null);
  
  // 编辑模态框状态
  const [editingItem, setEditingItem] = useState<PathItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editPath, setEditPath] = useState('');
  const [editType, setEditType] = useState<PathType>('local');
  const [editGroup, setEditGroup] = useState('');
  
  // 拖拽状态
  const [draggedItem, setDraggedItem] = useState<PathItem | null>(null);
  const [draggedGroup, setDraggedGroup] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // 表单状态
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [newType, setNewType] = useState<PathType>('local');
  const [newGroup, setNewGroup] = useState('');
  
  // 分组顺序状态
  const [groupOrder, setGroupOrder] = useState<string[]>([]);
  
  // 列数设置状态
  const [columnsPerRow, setColumnsPerRow] = useState<number>(() => {
    const saved = localStorage.getItem('arthub_path_columns');
    return saved ? parseInt(saved, 10) : 1;
  });
  
  // 显示列数设置菜单
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);

  // 从本地存储加载或使用 Mock 数据
  useEffect(() => {
    const saved = localStorage.getItem('arthub_paths');
    const savedOrder = localStorage.getItem('arthub_group_order');
    if (saved) {
      setPaths(JSON.parse(saved));
    } else {
      setPaths([...MOCK_PATHS]);
    }
    if (savedOrder) {
      try {
        setGroupOrder(JSON.parse(savedOrder));
      } catch (e) {
        console.warn('Failed to parse group order:', e);
      }
    }
    
    // 加载快速路径
    const currentPresetId = localStorage.getItem('arthub_naming_preset') || 'fgui_card';
    const quickPathsKey = `arthub_quick_paths_${currentPresetId}`;
    const savedQuickPaths = localStorage.getItem(quickPathsKey);
    if (savedQuickPaths) {
      try {
        setQuickPaths(JSON.parse(savedQuickPaths));
      } catch (error) {
        console.error('加载快速路径失败:', error);
      }
    }
  }, []);

  // 监听快速路径更新事件和模板切换
  useEffect(() => {
    const loadQuickPaths = () => {
      const currentPresetId = localStorage.getItem('arthub_naming_preset') || 'fgui_card';
      const quickPathsKey = `arthub_quick_paths_${currentPresetId}`;
      const saved = localStorage.getItem(quickPathsKey);
      if (saved) {
        try {
          setQuickPaths(JSON.parse(saved));
        } catch (error) {
          console.error('加载快速路径失败:', error);
          setQuickPaths([]);
        }
      } else {
        setQuickPaths([]);
      }
    };
    
    loadQuickPaths();
    
    const handleQuickPathsUpdate = () => loadQuickPaths();
    const handlePresetChange = () => loadQuickPaths();
    
    window.addEventListener('quickPathsUpdated', handleQuickPathsUpdate);
    window.addEventListener('storage', handlePresetChange);
    
    const interval = setInterval(loadQuickPaths, 500);
    
    return () => {
      window.removeEventListener('quickPathsUpdated', handleQuickPathsUpdate);
      window.removeEventListener('storage', handlePresetChange);
      clearInterval(interval);
    };
  }, []);

  // 检查路径是否已收藏（使用新的收藏服务）
  const isFavorited = (itemId: string): boolean => {
    return checkIsFavorited('path', itemId);
  };

  // 处理拖拽进入
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  // 处理拖拽离开
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  // 处理拖拽悬停（创建新路径）
  const handleDragOverCreatePath = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  // 处理拖拽放下（创建新路径）
  const handleDropCreatePath = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    try {
      // 辅助函数：从路径字符串中提取并检查是否是应用文件
      const checkAndHandleAppFile = async (filePath: string): Promise<boolean> => {
        if (!filePath) return false;
        
        // 统一路径分隔符并清理
        let cleanPath = filePath.trim().replace(/\//g, '\\');
        
        // 优先检查是否是应用文件（.exe, .lnk）- 必须在判断URL之前
        if (isAppFile(cleanPath)) {
          const appInfo = await handleDroppedAppFile(cleanPath);
          if (appInfo) {
            setDraggedPath({ 
              path: appInfo.path, 
              name: appInfo.name, 
              type: 'app' 
            });
            setShowDragModal(true);
            return true;
          }
        }
        return false;
      };

      // 首先检查是否是文件拖拽（优先级最高）
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        const file = files[0];
        // 在 Tauri 环境中，文件对象可能有 path 属性
        // 在浏览器环境中，只能获取文件名
        const filePath = (file as any).path || file.name;
        const fileName = file.name.toLowerCase();
        
        // 优先检查是否是应用文件（通过扩展名判断）
        if (await checkAndHandleAppFile(filePath) || await checkAndHandleAppFile(fileName)) {
          return;
        }
        
        // 如果不是应用文件，尝试作为普通路径处理
        if (filePath && (filePath.match(/^[A-Za-z]:/) || filePath.startsWith('/'))) {
          await handleDroppedPath(filePath, 'local');
          return;
        }
      }
      
      // 尝试获取拖拽的文本（可能是URL或路径）
      // 注意：在 Windows 上拖拽文件时，可能会同时有 files 和 text/uri-list
      // 在Windows上，快捷方式(.lnk)可能只出现在text/uri-list中
      const textUriList = e.dataTransfer.getData('text/uri-list');
      const textPlain = e.dataTransfer.getData('text/plain');
      const text = textPlain || e.dataTransfer.getData('text');
      
      // 优先处理 text/uri-list（Windows 文件拖拽常用，特别是.lnk快捷方式）
      if (textUriList) {
        // 检查是否是文件路径（file:// 协议）
        if (textUriList.startsWith('file://')) {
          // 提取文件路径（Windows 路径格式）
          let filePath = textUriList.replace(/^file:\/\/\//, '').replace(/^file:\/\//, '');
          // Windows 路径可能需要解码
          try {
            filePath = decodeURIComponent(filePath);
          } catch {
            // 解码失败，使用原始路径
          }
          // 统一路径分隔符
          filePath = filePath.replace(/\//g, '\\');
          
          // 优先检查是否是应用文件（.exe, .lnk）- 必须在判断URL之前
          if (await checkAndHandleAppFile(filePath)) {
            return;
          }
          // 本地文件路径（非应用文件）
          await handleDroppedPath(filePath, 'local');
          return;
        }
        // 检查是否是网页 URL（只有明确的 http:// 或 https:// 才识别为网页）
        if (textUriList.startsWith('http://') || textUriList.startsWith('https://')) {
          await handleDroppedPath(textUriList, 'web');
          return;
        }
      }
      
      // 处理 text/plain 数据
      if (text) {
        // 优先检查是否是应用文件路径（.exe, .lnk）
        if (await checkAndHandleAppFile(text)) {
          return;
        }

        // 判断是URL还是路径
        // 只有明确的 http:// 或 https:// 开头才识别为网页
        if (text.startsWith('http://') || text.startsWith('https://')) {
          await handleDroppedPath(text, 'web');
        } else if (text.startsWith('\\\\') || text.startsWith('//')) {
          // 网络路径
          await handleDroppedPath(text, 'network');
        } else if (text.match(/^[A-Za-z]:[\\/]/) || text.startsWith('/') || text.match(/^[A-Za-z]:$/)) {
          // 本地路径（Windows 路径如 C:\ 或 C:/，或 Unix 路径）
          await handleDroppedPath(text, 'local');
        } else if (text.includes('\\') || text.includes('/')) {
          // 包含路径分隔符，优先识别为本地路径
          await handleDroppedPath(text, 'local');
        } else {
          // 其他情况，尝试作为URL处理（但只有明确的协议才识别为网页）
          try {
            const url = new URL(text);
            // 只有 http 或 https 协议才识别为网页
            if (url.protocol === 'http:' || url.protocol === 'https:') {
              await handleDroppedPath(text, 'web');
            } else {
              // 其他协议（如 file://）识别为本地路径
              await handleDroppedPath(text, 'local');
            }
          } catch {
            // 不是有效的URL，识别为本地路径
            await handleDroppedPath(text, 'local');
          }
        }
        return;
      }
      
      // 最后尝试从浏览器地址栏拖拽
      const url = e.dataTransfer.getData('URL');
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        await handleDroppedPath(url, 'web');
        return;
      }
    } catch (error) {
      console.error('处理拖拽失败:', error);
    }
  };

  // 处理拖拽的路径
  const handleDroppedPath = async (path: string, type: PathType) => {
    // 尝试获取路径名称
    let name = '';
    
    if (type === 'web') {
      try {
        // 尝试获取网页标题
        const response = await fetch(path, { mode: 'no-cors' });
        // 由于CORS限制，我们只能使用路径本身
        const url = new URL(path);
        name = url.hostname || path;
      } catch {
        try {
          const url = new URL(path);
          name = url.hostname || path;
        } catch {
          name = path;
        }
      }
    } else {
      // 对于本地路径，使用文件夹名
      const parts = path.replace(/\\/g, '/').split('/').filter(p => p);
      name = parts[parts.length - 1] || path;
    }

    setDraggedPath({ path, name, type });
    setShowDragModal(true);
  };

  // 确认添加拖拽的路径
  const handleConfirmDragPath = () => {
    if (!draggedPath) return;
    
    const groupName = newGroup.trim() || '默认分组';
    let finalPath = draggedPath.path.trim();
    
    if (draggedPath.type === 'network' && !finalPath.startsWith('\\\\')) {
      finalPath = '\\\\' + finalPath.replace(/^\\+/, '');
    }
    
    const item: PathItem = {
      id: Date.now().toString(),
      name: draggedPath.name || finalPath,
      path: finalPath,
      type: draggedPath.type || 'local',
      group: groupName
    };
    
    setPaths([item, ...paths]);
    
    if (!groupOrder.includes(groupName)) {
      setGroupOrder([...groupOrder, groupName]);
    }
    
    setShowDragModal(false);
    setDraggedPath(null);
    setNewGroup('');
  };

  // 获取所有唯一的分组名称
  const existingGroups = useMemo(() => {
    return Array.from(new Set(paths.map(p => p.group || '默认分组')));
  }, [paths]);

  const groupedPaths = useMemo(() => {
    const groups: Record<string, PathItem[]> = {};
    paths.forEach(p => {
      const g = p.group || '默认分组';
      if (!groups[g]) groups[g] = [];
      groups[g].push(p);
    });
    
    if (groupOrder.length === 0) return groups;
    
    const orderedGroups: Record<string, PathItem[]> = {};
    const allGroups = new Set([...groupOrder, ...Object.keys(groups)]);
    allGroups.forEach(g => {
      if (groups[g]) orderedGroups[g] = groups[g];
    });
    
    return orderedGroups;
  }, [paths, groupOrder]);
  
  // 初始化分组顺序
  useEffect(() => {
    if (groupOrder.length === 0 && paths.length > 0) {
      const groups = Array.from(new Set(paths.map(p => p.group || '默认分组'))).sort();
      setGroupOrder(groups);
    }
  }, [paths.length, groupOrder.length]);

  // 保存到本地存储
  useEffect(() => {
    if (paths.length > 0) {
      localStorage.setItem('arthub_paths', JSON.stringify(paths));
    }
  }, [paths]);

  useEffect(() => {
    if (groupOrder.length > 0) {
      localStorage.setItem('arthub_group_order', JSON.stringify(groupOrder));
    }
  }, [groupOrder]);
  
  // 保存列数设置
  useEffect(() => {
    localStorage.setItem('arthub_path_columns', columnsPerRow.toString());
  }, [columnsPerRow]);

  const handleAddPath = () => {
    if (!newName || !newPath) return;
    const groupName = newGroup.trim() || '默认分组';
    
    let finalPath = newPath.trim();
    if (newType === 'network' && !finalPath.startsWith('\\\\')) {
      finalPath = '\\\\' + finalPath.replace(/^\\+/, '');
    }
    
    const item: PathItem = {
      id: Date.now().toString(),
      name: newName.trim(),
      path: finalPath,
      type: newType,
      group: groupName
    };
    
    setPaths([item, ...paths]);
    
    if (!groupOrder.includes(groupName)) {
      setGroupOrder([...groupOrder, groupName]);
    }
    
    setNewName('');
    setNewPath('');
    setNewGroup('');
    setIsModalOpen(false);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('确定要删除这个路径吗？')) {
      setPaths(paths.filter(p => p.id !== id));
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopy = (item: PathItem, e: React.MouseEvent) => {
    e.stopPropagation();
    copyToClipboard(item.path, item.id);
  };

  const handleEdit = (item: PathItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingItem(item);
    setEditName(item.name);
    setEditPath(item.path);
    setEditType(item.type);
    setEditGroup(item.group || '');
  };

  const handleEditSave = () => {
    if (!editingItem || !editName.trim() || !editPath.trim()) return;
    
    const groupName = editGroup.trim() || '默认分组';
    let finalPath = editPath.trim();
    if (editType === 'network' && !finalPath.startsWith('\\\\')) {
      finalPath = '\\\\' + finalPath.replace(/^\\+/, '');
    }
    
    const updatedItem: PathItem = {
      ...editingItem,
      name: editName.trim(),
      path: finalPath,
      type: editType,
      group: groupName
    };
    
    setPaths(paths.map(p => p.id === editingItem.id ? updatedItem : p));
    
    if (!groupOrder.includes(groupName)) {
      setGroupOrder([...groupOrder, groupName]);
    }
    
    setEditingItem(null);
    setEditName('');
    setEditPath('');
    setEditGroup('');
  };

  const handleEditCancel = () => {
    setEditingItem(null);
    setEditName('');
    setEditPath('');
    setEditGroup('');
  };

  const handleJump = async (item: PathItem) => {
    try {
      if (item.type === 'app') {
        // 应用类型：启动应用（.exe 或 .lnk）
        try {
          await launchApp(item.path);
        } catch (error) {
          console.error('启动应用失败:', error);
          copyToClipboard(item.path, item.id);
        }
      } else if (item.type === 'web') {
        // 网页类型：直接在新标签页打开（只有明确的 URL 类型才打开网页）
        window.open(item.path, '_blank');
      } else if (item.type === 'local') {
        // 本地路径：必须直接打开本地的资源管理器，不打开网页
        // 检查是否是应用文件（.exe, .lnk），如果是则启动应用
        if (isAppFile(item.path)) {
          try {
            await launchApp(item.path);
            return;
          } catch (error) {
            console.error('启动应用失败:', error);
          }
        }
        // 否则打开资源管理器
        try {
          if (isTauriEnvironment()) {
            const { open } = await import('@tauri-apps/api/shell');
            // shell.open 会自动识别是文件夹还是文件，并打开相应的资源管理器或应用
            await open(item.path);
          } else {
            // 非 Tauri 环境，使用 file:// 协议打开本地路径
            const pathToOpen = 'file:///' + item.path.replace(/\\/g, '/');
            window.open(pathToOpen, '_blank');
          }
        } catch (shellError) {
          console.warn('打开路径失败:', shellError);
          // 如果失败，复制到剪贴板
          copyToClipboard(item.path, item.id);
        }
      } else if (item.type === 'network') {
        // 局域网路径：使用 Tauri shell.open 打开网络资源管理器
        try {
          if (isTauriEnvironment()) {
            const { open } = await import('@tauri-apps/api/shell');
            await open(item.path);
          } else {
            // 非 Tauri 环境，使用 file:// 协议
            const pathToOpen = 'file:' + item.path.replace(/\\/g, '/');
            window.open(pathToOpen, '_blank');
          }
        } catch (shellError) {
          console.warn('打开网络路径失败:', shellError);
          copyToClipboard(item.path, item.id);
        }
      }
    } catch (error) {
      console.error('打开路径失败:', error);
      copyToClipboard(item.path, item.id);
    }
  };

  // 添加到收藏（使用新的收藏服务）
  const handleAddToFavorites = (item: PathItem, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const favoriteItem: FavoriteItem = {
      id: `path_${item.id}`,
      type: 'path',
      pathItem: item,
      createdAt: Date.now()
    };
    
    const wasAdded = checkIsFavorited('path', item.id);
    if (wasAdded) {
      removeFavorite('path', item.id);
    } else {
      addFavorite(favoriteItem);
      setJustFavoritedId(item.id);
      setTimeout(() => setJustFavoritedId(null), 1000);
    }
    
    // 同时更新旧的快捷路径（兼容性）
    const currentPresetId = localStorage.getItem('arthub_naming_preset') || 'fgui_card';
    const quickPathsKey = `arthub_quick_paths_${currentPresetId}`;
    const saved = localStorage.getItem(quickPathsKey);
    let newQuickPaths: PathItem[] = [];
    if (saved) {
      try {
        newQuickPaths = JSON.parse(saved);
      } catch {}
    }
    
    const isAlreadyFavorited = newQuickPaths.some(p => p.id === item.id);
    if (isAlreadyFavorited) {
      newQuickPaths = newQuickPaths.filter(p => p.id !== item.id);
    } else {
      newQuickPaths.push(item);
    }
    
    setQuickPaths(newQuickPaths);
    if (newQuickPaths.length > 0) {
      localStorage.setItem(quickPathsKey, JSON.stringify(newQuickPaths));
    } else {
      localStorage.removeItem(quickPathsKey);
    }
    
    window.dispatchEvent(new CustomEvent('quickPathsUpdated'));
  };

  const toggleGroup = (groupName: string) => {
    const newCollapsed = new Set(collapsedGroups);
    if (newCollapsed.has(groupName)) {
      newCollapsed.delete(groupName);
    } else {
      newCollapsed.add(groupName);
    }
    setCollapsedGroups(newCollapsed);
  };

  const getIcon = (item: PathItem) => {
    // 如果有自定义图标，显示图标
    if (item.icon) {
      return (
        <img 
          src={item.icon} 
          alt={item.name}
          className="w-[18px] h-[18px] object-contain"
          onError={(e) => {
            // 如果图标加载失败，显示默认图标
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      );
    }
    
    // 根据类型显示默认图标
    switch (item.type) {
      case 'app': return <Play size={18} className="text-green-400" />;
      case 'web': return <Globe size={18} className="text-cyan-400" />;
      case 'network': return <Server size={18} className="text-purple-400" />;
      case 'local': return <Folder size={18} className="text-orange-400" />;
    }
  };

  // 拖拽处理函数
  const handleDragStart = (item: PathItem, e: React.DragEvent) => {
    e.stopPropagation(); // 阻止事件冒泡，避免触发点击事件
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.dropEffect = 'move';
    setDraggedItem(item);
    // 设置拖拽数据，支持跨组拖动
    e.dataTransfer.setData('text/plain', item.id);
    // 设置自定义数据格式
    e.dataTransfer.setData('application/x-path-item', JSON.stringify({ id: item.id, type: 'path-item' }));
  };

  const handleDragStartGroup = (groupName: string, e: React.DragEvent) => {
    e.stopPropagation(); // 阻止事件冒泡，避免触发点击事件
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.dropEffect = 'move';
    setDraggedGroup(groupName);
    // 设置拖拽数据
    e.dataTransfer.setData('text/plain', groupName);
    e.dataTransfer.setData('application/x-group', JSON.stringify({ name: groupName, type: 'group' }));
  };

  const handleDragOver = (groupName: string, index: number, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 检查是否是路径项拖拽（使用状态而不是 getData，因为 dragOver 事件中无法读取数据）
    if (draggedItem) {
      e.dataTransfer.dropEffect = 'move';
      setDragOverGroup(groupName);
      setDragOverIndex(index);
    } else {
      // 检查拖拽类型（通过 types 数组）
      const types = Array.from(e.dataTransfer.types);
      if (types.includes('application/x-path-item') || types.includes('text/plain')) {
        e.dataTransfer.dropEffect = 'move';
      } else {
        e.dataTransfer.dropEffect = 'none';
      }
    }
  };

  const handleDragOverGroup = (groupName: string, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 检查是否是分组拖拽（使用状态而不是 getData）
    if (draggedGroup) {
      e.dataTransfer.dropEffect = 'move';
      if (draggedGroup !== groupName) {
        setDragOverGroup(groupName);
      }
    } else {
      // 检查拖拽类型（通过 types 数组）
      const types = Array.from(e.dataTransfer.types);
      if (types.includes('application/x-group') || types.includes('text/plain')) {
        e.dataTransfer.dropEffect = 'move';
      } else {
        e.dataTransfer.dropEffect = 'none';
      }
    }
  };

  const handleDrop = (targetGroup: string, targetIndex: number, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedItem) {
      setDraggedItem(null);
      setDragOverGroup(null);
      setDragOverIndex(null);
      return;
    }

    const sourceGroup = draggedItem.group || '默认分组';
    
    // 确保目标分组在分组顺序中
    if (!groupOrder.includes(targetGroup)) {
      setGroupOrder([...groupOrder, targetGroup]);
    }
    
    // 更新路径项的分组
    const updatedPaths = paths.map(p => {
      if (p.id === draggedItem.id) {
        return { ...p, group: targetGroup };
      }
      return p;
    });
    
    // 分离目标分组和其他分组的项
    const targetGroupItems = updatedPaths.filter(p => (p.group || '默认分组') === targetGroup);
    const otherItems = updatedPaths.filter(p => (p.group || '默认分组') !== targetGroup);
    
    // 获取被拖拽的项（已更新分组）
    const draggedItemUpdated = updatedPaths.find(p => p.id === draggedItem.id)!;
    
    // 如果项已经在目标分组中，从目标分组中移除
    const currentIndexInTarget = targetGroupItems.findIndex(p => p.id === draggedItem.id);
    if (currentIndexInTarget >= 0) {
      targetGroupItems.splice(currentIndexInTarget, 1);
    } else {
      // 如果项不在目标分组中，从源分组中移除
      const sourceGroupItems = otherItems.filter(p => (p.group || '默认分组') === sourceGroup);
      const remainingItems = otherItems.filter(p => (p.group || '默认分组') !== sourceGroup);
      const itemIndexInSource = sourceGroupItems.findIndex(p => p.id === draggedItem.id);
      if (itemIndexInSource >= 0) {
        sourceGroupItems.splice(itemIndexInSource, 1);
      }
      // 重新组合其他项
      otherItems.splice(0, otherItems.length, ...remainingItems, ...sourceGroupItems);
    }
    
    // 将项插入到目标位置
    const insertIndex = Math.min(targetIndex, targetGroupItems.length);
    targetGroupItems.splice(insertIndex, 0, draggedItemUpdated);
    
    // 更新路径列表
    setPaths([...otherItems, ...targetGroupItems]);
    
    setDraggedItem(null);
    setDragOverGroup(null);
    setDragOverIndex(null);
  };

  const handleDropGroup = (targetGroup: string, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (draggedGroup && draggedGroup !== targetGroup) {
      // 确保分组顺序数组包含所有分组
      const allGroups = Array.from(new Set([...groupOrder, ...Object.keys(groupedPaths)]));
      const newOrder = [...allGroups];
      const draggedIndex = newOrder.indexOf(draggedGroup);
      const targetIndex = newOrder.indexOf(targetGroup);
      
      if (draggedIndex >= 0 && targetIndex >= 0) {
        newOrder.splice(draggedIndex, 1);
        newOrder.splice(targetIndex, 0, draggedGroup);
        setGroupOrder(newOrder);
      }
    }
    
    setDraggedGroup(null);
    setDragOverGroup(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDraggedGroup(null);
    setDragOverGroup(null);
    setDragOverIndex(null);
  };

  // 类型选择按钮组件
  const TypeSelector = ({ value, onChange }: { value: PathType; onChange: (t: PathType) => void }) => (
    <div className="flex gap-2 flex-wrap">
      {(['local', 'network', 'web', 'app'] as PathType[]).map(t => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`
            flex-1 py-2 text-sm font-medium rounded-lg
            transition-colors duration-150
            ${value === t 
              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50' 
              : 'bg-[#1a1a1a] text-[#808080] border border-[#2a2a2a] hover:border-[#3a3a3a]'
            }
          `}
        >
          {t === 'local' ? '本地' : t === 'network' ? '局域网' : t === 'web' ? '网页' : '应用'}
        </button>
      ))}
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a]">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between p-6 border-b border-[#1a1a1a]">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#1a1a1a] rounded-lg">
            <Folder size={20} className="text-orange-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">路径管理</h2>
            <p className="text-sm text-[#666666]">管理本地、网络和网页路径</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 列数设置按钮 */}
          <div className="relative">
            <button
              onClick={() => setShowColumnsMenu(!showColumnsMenu)}
              className="
                flex items-center gap-2 px-4 py-2.5
                bg-[#1a1a1a] hover:bg-[#222222]
                text-[#a0a0a0] hover:text-white
                border border-[#2a2a2a] hover:border-[#3a3a3a]
                rounded-lg
                transition-colors duration-150
              "
              title="设置列数"
            >
              <Grid3X3 size={18} />
              <span className="text-sm">{columnsPerRow}列</span>
            </button>
            
            {/* 列数选择菜单 */}
            {showColumnsMenu && (
              <>
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setShowColumnsMenu(false)}
                />
                <div className="
                  absolute top-full right-0 mt-2 z-50
                  bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg
                  shadow-lg shadow-black/50
                  min-w-[120px]
                  overflow-hidden
                ">
                  {[1, 2, 3, 4].map(cols => (
                    <button
                      key={cols}
                      onClick={() => {
                        setColumnsPerRow(cols);
                        setShowColumnsMenu(false);
                      }}
                      className={`
                        w-full px-4 py-2.5 text-left text-sm
                        transition-colors duration-150
                        ${columnsPerRow === cols
                          ? 'bg-blue-500/20 text-blue-400'
                          : 'text-[#a0a0a0] hover:bg-[#222222] hover:text-white'
                        }
                      `}
                    >
                      {cols} 列
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          
          <button 
            onClick={() => setIsModalOpen(true)}
            className="
              flex items-center gap-2 px-4 py-2.5
              bg-blue-600 hover:bg-blue-700
              text-white font-medium rounded-lg
              transition-colors duration-150
            "
          >
            <Plus size={18} />
            添加路径
          </button>
        </div>
      </div>

      {/* 拖拽区域 */}
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOverCreatePath}
        onDrop={handleDropCreatePath}
        className={`
          flex-1 overflow-y-auto p-6 transition-colors duration-200
          ${isDraggingOver ? 'bg-blue-500/10 border-2 border-dashed border-blue-500' : ''}
        `}
      >
        {paths.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-full bg-[#1a1a1a] flex items-center justify-center mb-4">
              <Folder size={28} className="text-[#333333]" />
            </div>
            <h3 className="text-lg font-medium text-white mb-2">暂无路径</h3>
            <p className="text-[#666666] mb-6">点击"添加路径"开始管理你的目录，或直接拖入应用快捷方式（.lnk）或可执行文件（.exe）</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groupOrder.map(groupName => {
              if (!groupedPaths[groupName]) return null;
              
              return (
                <div key={groupName} className="space-y-2">
                  {/* 分组标题 */}
                  <div 
                    draggable={true}
                    onDragStart={(e) => {
                      handleDragStartGroup(groupName, e);
                    }}
                    onDragOver={(e) => {
                      handleDragOverGroup(groupName, e);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDropGroup(groupName, e);
                    }}
                    onDragEnd={handleDragEnd}
                    onClick={(e) => {
                      // 如果正在拖拽，不触发折叠/展开
                      if (!draggedGroup) {
                        toggleGroup(groupName);
                      }
                    }}
                    className={`
                      flex items-center gap-2 px-2 py-1.5 rounded-lg
                      cursor-move select-none
                      text-[#808080] hover:text-white hover:bg-[#1a1a1a]
                      transition-all duration-150
                      ${draggedGroup === groupName ? 'opacity-50 scale-95' : ''}
                      ${dragOverGroup === groupName && draggedGroup && draggedGroup !== groupName ? 'border-2 border-blue-500 bg-blue-500/10' : ''}
                    `}
                  >
                    {collapsedGroups.has(groupName) 
                      ? <ChevronRight size={16} /> 
                      : <ChevronDown size={16} />
                    }
                    <span className="text-xs font-medium uppercase tracking-wider">
                      {groupName}
                    </span>
                    <span className="
                      px-1.5 py-0.5 rounded text-[10px] font-medium
                      bg-[#1a1a1a] text-[#666666]
                    ">
                      {groupedPaths[groupName].length}
                    </span>
                  </div>

                  {/* 分组内容 */}
                  {!collapsedGroups.has(groupName) && (
                    <div 
                      className={`ml-2 ${
                        columnsPerRow === 1 
                          ? 'space-y-1.5' 
                          : 'grid gap-3'
                      }`}
                      style={columnsPerRow > 1 ? { gridTemplateColumns: `repeat(${columnsPerRow}, minmax(0, 1fr))` } : undefined}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (draggedItem) {
                          setDragOverGroup(groupName);
                          setDragOverIndex(groupedPaths[groupName].length);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDrop(groupName, groupedPaths[groupName].length, e);
                      }}
                    >
                      {groupedPaths[groupName].map((item, index) => (
                        <div 
                          key={item.id} 
                          draggable={true}
                          onDragStart={(e) => handleDragStart(item, e)}
                          onDragOver={(e) => handleDragOver(groupName, index, e)}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDrop(groupName, index, e);
                          }}
                          onDragEnd={handleDragEnd}
                          onClick={(e) => {
                            // 如果正在拖拽，不触发跳转
                            // 使用setTimeout确保拖拽状态已清除
                            setTimeout(() => {
                              if (!draggedItem) {
                                handleJump(item);
                              }
                            }, 50);
                          }}
                          className={`
                            group relative
                            bg-[#1a1a1a] hover:bg-[#222222]
                            border border-[#2a2a2a] hover:border-[#3a3a3a]
                            rounded-lg p-3
                            flex items-center gap-3
                            cursor-pointer
                            transition-all duration-150
                            ${draggedItem?.id === item.id ? 'opacity-50' : ''}
                            ${dragOverGroup === groupName && dragOverIndex === index ? 'border-blue-500' : ''}
                            ${columnsPerRow > 1 ? 'min-w-0' : ''}
                          `}
                          style={columnsPerRow > 1 ? {} : undefined}
                        >
                          {/* 复制成功反馈 */}
                          {copiedId === item.id && (
                            <div className="
                              absolute inset-0 rounded-lg
                              bg-green-500/90 
                              flex items-center justify-center 
                              text-white text-sm font-medium
                              animate-fade-in z-20
                            ">
                              <Check size={16} className="mr-2" />
                              已复制到剪贴板
                            </div>
                          )}

                          {/* 图标 */}
                          <div className="
                            p-2 rounded-lg
                            bg-[#0f0f0f] group-hover:bg-[#151515]
                            transition-colors flex items-center justify-center
                          ">
                            {getIcon(item)}
                          </div>

                          {/* 内容 */}
                          <div className={`flex-1 min-w-0 ${columnsPerRow > 1 ? 'overflow-hidden' : ''}`}>
                            <h3 className="
                              text-[14px] font-medium text-white
                              group-hover:text-blue-400
                              truncate transition-colors
                            " title={item.name}>
                              {item.name}
                            </h3>
                            <p className="
                              text-[12px] text-[#666666] font-mono
                              truncate
                            " title={item.path}>
                              {item.path}
                            </p>
                          </div>

                          {/* 操作按钮 */}
                          <div className="flex items-center gap-1">
                            {/* 收藏按钮 */}
                            <button 
                              onClick={(e) => handleAddToFavorites(item, e)}
                              className={`
                                p-2 rounded-lg transition-all duration-150
                                ${isFavorited(item.id)
                                  ? 'text-yellow-400'
                                  : 'text-[#666666] opacity-0 group-hover:opacity-100 hover:text-yellow-400'
                                }
                                ${justFavoritedId === item.id ? 'scale-125' : ''}
                              `}
                              title={isFavorited(item.id) ? "取消收藏" : "添加到收藏"}
                            >
                              <Star size={16} fill={isFavorited(item.id) ? "currentColor" : "none"} />
                            </button>

                            {/* 其他按钮 */}
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button 
                                onClick={(e) => handleEdit(item, e)}
                                className="p-2 rounded-lg text-[#666666] hover:text-white hover:bg-[#2a2a2a] transition-colors"
                                title="编辑"
                              >
                                <Pencil size={14} />
                              </button>
                              <button 
                                onClick={(e) => handleCopy(item, e)}
                                className="p-2 rounded-lg text-[#666666] hover:text-white hover:bg-[#2a2a2a] transition-colors"
                                title="复制路径"
                              >
                                <Copy size={14} />
                              </button>
                              {item.type === 'web' && (
                                <ExternalLink size={14} className="text-[#444444] mx-1" />
                              )}
                              <button 
                                onClick={(e) => handleDelete(item.id, e)}
                                className="p-2 rounded-lg text-[#666666] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                title="删除"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 提示信息 */}
      <div className="mx-6 mb-6 p-3 bg-[#0f0f0f] rounded-lg border border-[#1a1a1a] flex gap-2 items-start">
        <AlertCircle size={14} className="text-blue-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-[12px] text-[#666666] mb-1">
            点击任意行即可打开。应用类型会直接启动，路径类型会打开资源管理器。如果浏览器阻止直接打开本地路径，它将自动复制到剪贴板。
          </p>
          <p className="text-[12px] text-[#666666]">
            💡 提示：可以直接将桌面上的应用快捷方式（.lnk）或可执行文件（.exe）拖入此界面，系统会自动识别应用名称。
          </p>
        </div>
      </div>

      {/* 添加模态框 */}
      {isModalOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setIsModalOpen(false)}
        >
          <div 
            className="
              w-full max-w-md mx-4
              bg-[#151515] border border-[#2a2a2a] rounded-xl
              shadow-2xl shadow-black/50
              animate-scale-in
            "
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
              <h3 className="text-lg font-semibold text-white">添加新路径</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-lg text-[#666666] hover:text-white hover:bg-[#252525] transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#a0a0a0] mb-2">类型</label>
                <TypeSelector value={newType} onChange={setNewType} />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#a0a0a0] mb-2">分组名称</label>
                <input 
                  list="groups-list"
                  value={newGroup}
                  onChange={(e) => setNewGroup(e.target.value)}
                  className="
                    w-full px-4 py-2.5 rounded-lg
                    bg-[#0f0f0f] border border-[#2a2a2a]
                    text-white placeholder-[#666666]
                    focus:outline-none focus:border-blue-500
                    transition-colors
                  "
                  placeholder="例如：工作目录（留空则为默认分组）"
                />
                <datalist id="groups-list">
                  {existingGroups.map(g => <option key={g} value={g} />)}
                </datalist>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-[#a0a0a0] mb-2">名称</label>
                <input 
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="
                    w-full px-4 py-2.5 rounded-lg
                    bg-[#0f0f0f] border border-[#2a2a2a]
                    text-white placeholder-[#666666]
                    focus:outline-none focus:border-blue-500
                    transition-colors
                  "
                  placeholder="例如：角色工作目录"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#a0a0a0] mb-2">路径 / URL</label>
                <input 
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  className="
                    w-full px-4 py-2.5 rounded-lg font-mono
                    bg-[#0f0f0f] border border-[#2a2a2a]
                    text-white placeholder-[#666666]
                    focus:outline-none focus:border-blue-500
                    transition-colors
                  "
                  placeholder={newType === 'web' ? "https://..." : newType === 'network' ? "\\\\192.168.1.100\\Share" : newType === 'app' ? "C:\\Program Files\\App\\app.exe" : "D:\\Projects\\..."}
                />
                {newType === 'network' && (
                  <p className="text-[11px] text-[#666666] mt-1.5">
                    系统会自动添加局域网前缀（\\\\）
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#2a2a2a]">
              <button 
                onClick={() => setIsModalOpen(false)}
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
                onClick={handleAddPath}
                className="
                  flex items-center gap-2 px-4 py-2.5 rounded-lg
                  bg-blue-600 hover:bg-blue-700
                  text-white font-medium
                  transition-colors
                "
              >
                <Save size={16} />
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑模态框 */}
      {editingItem && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={handleEditCancel}
        >
          <div 
            className="
              w-full max-w-md mx-4
              bg-[#151515] border border-[#2a2a2a] rounded-xl
              shadow-2xl shadow-black/50
              animate-scale-in
            "
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
              <h3 className="text-lg font-semibold text-white">编辑路径</h3>
              <button
                onClick={handleEditCancel}
                className="p-1.5 rounded-lg text-[#666666] hover:text-white hover:bg-[#252525] transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#a0a0a0] mb-2">类型</label>
                <TypeSelector value={editType} onChange={setEditType} />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#a0a0a0] mb-2">分组名称</label>
                <input 
                  list="edit-groups-list"
                  value={editGroup}
                  onChange={(e) => setEditGroup(e.target.value)}
                  className="
                    w-full px-4 py-2.5 rounded-lg
                    bg-[#0f0f0f] border border-[#2a2a2a]
                    text-white placeholder-[#666666]
                    focus:outline-none focus:border-blue-500
                    transition-colors
                  "
                  placeholder="例如：工作目录（留空则为默认分组）"
                />
                <datalist id="edit-groups-list">
                  {existingGroups.map(g => <option key={g} value={g} />)}
                </datalist>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-[#a0a0a0] mb-2">名称</label>
                <input 
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="
                    w-full px-4 py-2.5 rounded-lg
                    bg-[#0f0f0f] border border-[#2a2a2a]
                    text-white placeholder-[#666666]
                    focus:outline-none focus:border-blue-500
                    transition-colors
                  "
                  placeholder="例如：角色工作目录"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#a0a0a0] mb-2">路径 / URL</label>
                <input 
                  value={editPath}
                  onChange={(e) => setEditPath(e.target.value)}
                  className="
                    w-full px-4 py-2.5 rounded-lg font-mono
                    bg-[#0f0f0f] border border-[#2a2a2a]
                    text-white placeholder-[#666666]
                    focus:outline-none focus:border-blue-500
                    transition-colors
                  "
                  placeholder={editType === 'web' ? "https://..." : editType === 'network' ? "\\\\192.168.1.100\\Share" : editType === 'app' ? "C:\\Program Files\\App\\app.exe" : "D:\\Projects\\..."}
                />
                {editType === 'network' && (
                  <p className="text-[11px] text-[#666666] mt-1.5">
                    系统会自动添加局域网前缀（\\\\）
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#2a2a2a]">
              <button 
                onClick={handleEditCancel}
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
                onClick={handleEditSave}
                className="
                  flex items-center gap-2 px-4 py-2.5 rounded-lg
                  bg-blue-600 hover:bg-blue-700
                  text-white font-medium
                  transition-colors
                "
              >
                <Save size={16} />
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 拖拽创建路径模态框 */}
      {showDragModal && draggedPath && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => {
            setShowDragModal(false);
            setDraggedPath(null);
          }}
        >
          <div 
            className="
              w-full max-w-md mx-4
              bg-[#151515] border border-[#2a2a2a] rounded-xl
              shadow-2xl shadow-black/50
              animate-scale-in
            "
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
              <h3 className="text-lg font-semibold text-white">添加路径</h3>
              <button
                onClick={() => {
                  setShowDragModal(false);
                  setDraggedPath(null);
                }}
                className="p-1.5 rounded-lg text-[#666666] hover:text-white hover:bg-[#252525] transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="p-4 bg-[#0f0f0f] rounded-lg border border-[#2a2a2a]">
                <div className="flex items-center gap-2 mb-2">
                  <Upload size={16} className="text-blue-400" />
                  <span className="text-sm font-medium text-[#a0a0a0]">检测到的路径</span>
                </div>
                <p className="text-sm text-white font-mono break-all">{draggedPath.path}</p>
                {draggedPath.name && (
                  <p className="text-xs text-[#666666] mt-1">建议名称: {draggedPath.name}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-[#a0a0a0] mb-2">分组名称</label>
                <input 
                  list="drag-groups-list"
                  value={newGroup}
                  onChange={(e) => setNewGroup(e.target.value)}
                  className="
                    w-full px-4 py-2.5 rounded-lg
                    bg-[#0f0f0f] border border-[#2a2a2a]
                    text-white placeholder-[#666666]
                    focus:outline-none focus:border-blue-500
                    transition-colors
                  "
                  placeholder="例如：工作目录（留空则为默认分组）"
                />
                <datalist id="drag-groups-list">
                  {existingGroups.map(g => <option key={g} value={g} />)}
                </datalist>
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#2a2a2a]">
              <button 
                onClick={() => {
                  setShowDragModal(false);
                  setDraggedPath(null);
                }}
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
                onClick={handleConfirmDragPath}
                className="
                  flex items-center gap-2 px-4 py-2.5 rounded-lg
                  bg-blue-600 hover:bg-blue-700
                  text-white font-medium
                  transition-colors
                "
              >
                <Save size={16} />
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PathManager;
