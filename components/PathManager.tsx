import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { 
  Folder, Globe, Server, ExternalLink, Copy, Trash2, Plus, 
  AlertCircle, Check, ChevronDown, ChevronRight, Pencil, Star, X, Save, Upload, Play, Grid3X3, Settings, 
  LayoutGrid, Tag as TagIcon, Layers
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
import { useMiddleMouseScroll } from '../utils/useMiddleMouseScroll';
import { openUrl } from '../services/windowService';
import { TagEditor } from './common';

// 定义斜杠常量，避免在字符串和正则中使用字面量斜杠
const S_L = '/';
const B_L = '\\';

// 检查是否在 Tauri 环境中
const isTauriEnvironment = (): boolean => {
  if (typeof window === 'undefined') return false;
  return !!(window as any).__TAURI__ || 
         !!(window as any).__TAURI_INTERNALS__ ||
         !!(window as any).__TAURI_METADATA__;
};

// 从文件路径提取应用名称
const extractAppName = (filePath: string): string => {
  // FIX: 使用 new RegExp 避免 regex 字面量在 TSX 中引起的解析错误
  const separatorRegex = new RegExp('[\\\\/]'); 
  const fileName = filePath.split(separatorRegex).pop() || '';
  // 移除扩展名
  const extRegex = new RegExp('\\.(lnk|exe|app)$', 'i');
  const nameWithoutExt = fileName.replace(extRegex, '');
  return nameWithoutExt || '未知应用';
};

// 标签颜色配置
// 定义常用的 opacity 类名常量，使用字符串拼接避免斜杠解析问题
const OPACITY_CLASSES = {
  bgBlack70: 'bg-black' + S_L + '70',
  bgGreen50090: 'bg-green-500' + S_L + '90',
  bgRed50010: 'hover:bg-red-500' + S_L + '10',
  shadowBlack50: 'shadow-black' + S_L + '50',
  bgBlue50010: 'bg-blue-500' + S_L + '10',
  borderWhite30: 'border-white' + S_L + '30',
  bgWhite5: 'bg-white' + S_L + '5',
  bgBlue50020: 'bg-blue-500' + S_L + '20',
  borderBlue50050: 'border-blue-500' + S_L + '50',
  hoverBgBlue50030: 'hover:bg-blue-500' + S_L + '30',
} as const;

// 标签颜色配置
const TAG_COLORS = [
  { bg: 'bg-blue-500' + S_L + '20', text: 'text-blue-400', border: 'border-blue-500' + S_L + '30' },
  { bg: 'bg-green-500' + S_L + '20', text: 'text-green-400', border: 'border-green-500' + S_L + '30' },
  { bg: 'bg-purple-500' + S_L + '20', text: 'text-purple-400', border: 'border-purple-500' + S_L + '30' },
  { bg: 'bg-orange-500' + S_L + '20', text: 'text-orange-400', border: 'border-orange-500' + S_L + '30' },
  { bg: 'bg-pink-500' + S_L + '20', text: 'text-pink-400', border: 'border-pink-500' + S_L + '30' },
  { bg: 'bg-cyan-500' + S_L + '20', text: 'text-cyan-400', border: 'border-cyan-500' + S_L + '30' },
  { bg: 'bg-yellow-500' + S_L + '20', text: 'text-yellow-400', border: 'border-yellow-500' + S_L + '30' },
  { bg: 'bg-red-500' + S_L + '20', text: 'text-red-400', border: 'border-red-500' + S_L + '30' },
  { bg: 'bg-indigo-500' + S_L + '20', text: 'text-indigo-400', border: 'border-indigo-500' + S_L + '30' },
  { bg: 'bg-teal-500' + S_L + '20', text: 'text-teal-400', border: 'border-teal-500' + S_L + '30' },
];

// 根据标签名称获取颜色
const getTagColor = (tagName: string) => {
  let hash = 0;
  for (let i = 0; i < tagName.length; i++) {
    const char = tagName.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const index = Math.abs(hash) % TAG_COLORS.length;
  return TAG_COLORS[index];
};

const PathManager: React.FC = () => {
  const [paths, setPaths] = useState<PathItem[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  
  // 快速路径状态
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
  const [isDragging, setIsDragging] = useState(false);
  
  const draggedGroupRef = useRef<string | null>(null);
  const dragOverGroupRef = useRef<string | null>(null);
  
  const mouseDragStateRef = useRef<{
    isDragging: boolean;
    draggedGroup: string | null;
    startY: number;
    startGroup: string | null;
  }>({
    isDragging: false,
    draggedGroup: null,
    startY: 0,
    startGroup: null
  });

  // 表单状态
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [newType, setNewType] = useState<PathType>('local');
  const [newGroup, setNewGroup] = useState('');
  const [newTags, setNewTags] = useState<string[]>([]);
  
  // 分组顺序状态
  const [groupOrder, setGroupOrder] = useState<string[]>([]);
  
  // 列数设置状态
  const [columnsPerRow, setColumnsPerRow] = useState<number>(() => {
    const saved = localStorage.getItem('arthub_path_columns');
    return saved ? parseInt(saved, 10) : 1;
  });
  
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);
  
  const [sortMode, setSortMode] = useState<'group' | 'tag'>(() => {
    const saved = localStorage.getItem('arthub_path_sort_mode');
    return (saved === 'tag' || saved === 'group') ? saved : 'group';
  });
  
  const [selectedTags, setSelectedTags] = useState<string[]>(() => {
    const saved = localStorage.getItem('arthub_path_selected_tags');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [editTags, setEditTags] = useState<string[]>([]);
  
  const scrollContainerRef = useMiddleMouseScroll<HTMLDivElement>({
    enabled: true,
    scrollSpeed: 1.5
  });

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

  const reorderGroups = useCallback((draggedGroupName: string, targetGroupName: string, insertBefore: boolean) => {
    if (!draggedGroupName || !targetGroupName || draggedGroupName === targetGroupName) {
      return;
    }
    
    setGroupOrder((currentOrder) => {
      const allGroups = Array.from(new Set([...currentOrder]));
      const newOrder = [...allGroups];
      
      const draggedIndex = newOrder.indexOf(draggedGroupName);
      const targetIndex = newOrder.indexOf(targetGroupName);
      
      if (draggedIndex === -1 || targetIndex === -1) {
        return currentOrder;
      }
      
      newOrder.splice(draggedIndex, 1);
      
      let insertIndex: number;
      if (insertBefore) {
        insertIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
      } else {
        insertIndex = draggedIndex < targetIndex ? targetIndex : targetIndex + 1;
      }
      
      newOrder.splice(insertIndex, 0, draggedGroupName);
      localStorage.setItem('arthub_group_order', JSON.stringify(newOrder));
      return newOrder;
    });
  }, []);

  useEffect(() => {
    draggedGroupRef.current = draggedGroup;
  }, [draggedGroup]);
  
  useEffect(() => {
    dragOverGroupRef.current = dragOverGroup;
  }, [dragOverGroup]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const groupHeader = target.closest('[data-drag-group]');
      if (groupHeader && e.button === 0) {
        const groupName = groupHeader.getAttribute('data-drag-group');
        if (groupName) {
          mouseDragStateRef.current = {
            isDragging: true,
            draggedGroup: groupName,
            startY: e.clientY,
            startGroup: groupName
          };
          setDraggedGroup(groupName);
          draggedGroupRef.current = groupName;
          setIsDragging(true);
          e.preventDefault();
        }
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const state = mouseDragStateRef.current;
      if (state.isDragging && state.draggedGroup) {
        const groupContainers = document.querySelectorAll('[data-group-name]');
        let hoveredGroup: string | null = null;
        
        groupContainers.forEach((container) => {
          const rect = container.getBoundingClientRect();
          if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
            hoveredGroup = container.getAttribute('data-group-name');
          }
        });
        
        if (hoveredGroup && hoveredGroup !== state.draggedGroup) {
          if (dragOverGroupRef.current !== hoveredGroup) {
            setDragOverGroup(hoveredGroup);
            dragOverGroupRef.current = hoveredGroup;
          }
        } else if (hoveredGroup === state.draggedGroup) {
          if (dragOverGroupRef.current !== null) {
            setDragOverGroup(null);
            dragOverGroupRef.current = null;
          }
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      const state = mouseDragStateRef.current;
      if (state.isDragging && state.draggedGroup) {
        const groupContainers = document.querySelectorAll('[data-group-name]');
        let targetGroup: string | null = null;
        let targetRect: DOMRect | null = null;
        
        groupContainers.forEach((container) => {
          const rect = container.getBoundingClientRect();
          if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
            targetGroup = container.getAttribute('data-group-name');
            targetRect = rect;
          }
        });
        
        if (targetGroup && targetGroup !== state.draggedGroup && targetRect) {
          const midpoint = targetRect.top + targetRect.height / 2;
          const insertBefore = e.clientY < midpoint;
          reorderGroups(state.draggedGroup, targetGroup, insertBefore);
        }
        
        mouseDragStateRef.current = {
          isDragging: false,
          draggedGroup: null,
          startY: 0,
          startGroup: null
        };
        setDraggedGroup(null);
        setDragOverGroup(null);
        draggedGroupRef.current = null;
        dragOverGroupRef.current = null;
        setIsDragging(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [reorderGroups]);

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

  const isFavorited = (itemId: string): boolean => {
    return checkIsFavorited('path', itemId);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDragOverCreatePath = (e: React.DragEvent) => {
    if (draggedGroup) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDropCreatePath = async (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    const isGroupDrag = draggedGroup || types.includes('application/x-group');
    
    if (isGroupDrag) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    try {
      const checkAndHandleAppFile = async (filePath: string): Promise<boolean> => {
        if (!filePath) return false;
        
        let cleanPath = filePath.trim().replaceAll(S_L, B_L);
        
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

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        const file = files[0];
        const filePath = (file as any).path || file.name;
        const fileName = file.name;
        const lowerFileName = fileName.toLowerCase();
        
        if (lowerFileName.endsWith('.exe') || lowerFileName.endsWith('.lnk')) {
          if (await checkAndHandleAppFile(filePath)) {
            return;
          }
          const appName = extractAppName(filePath || fileName);
          setDraggedPath({ 
            path: filePath || fileName, 
            name: appName, 
            type: 'app' 
          });
          setShowDragModal(true);
          return;
        }
        
        // FIX: 使用 new RegExp 替代字面量
        const driveRegex = new RegExp('^[A-Za-z]:');
        if (filePath && (driveRegex.test(filePath) || filePath.startsWith('/'))) {
          await handleDroppedPath(filePath, 'local');
          return;
        }
      }
      
      const textUriList = e.dataTransfer.getData('text/uri-list');
      const textPlain = e.dataTransfer.getData('text/plain');
      const text = textPlain || e.dataTransfer.getData('text');
      
      if (textUriList) {
        if (textUriList.startsWith('file://')) {
          // FIX: 使用 new RegExp 构造，避免字面量
          const fileProtocolRegex = new RegExp('^file:' + S_L + S_L + S_L + '?');
          let filePath = textUriList.replace(fileProtocolRegex, '');
          
          try {
            filePath = decodeURIComponent(filePath);
          } catch {
            // ignore
          }
          filePath = filePath.replaceAll(S_L, B_L);
          
          const lowerPath = filePath.toLowerCase();
          if (lowerPath.endsWith('.lnk') || lowerPath.endsWith('.exe')) {
            if (await checkAndHandleAppFile(filePath)) {
              return;
            }
            setDraggedPath({ 
              path: filePath, 
              name: extractAppName(filePath), 
              type: 'app' 
            });
            setShowDragModal(true);
            return;
          }
          
          await handleDroppedPath(filePath, 'local');
          return;
        }
        
        if (textUriList.startsWith('http://') || textUriList.startsWith('https://')) {
          await handleDroppedPath(textUriList, 'web');
          return;
        }
        
        if (textUriList.includes('\\') || textUriList.includes('/')) {
          const lowerUri = textUriList.toLowerCase();
          if (lowerUri.endsWith('.lnk') || lowerUri.endsWith('.exe')) {
            if (await checkAndHandleAppFile(textUriList)) {
              return;
            }
          }
          await handleDroppedPath(textUriList, 'local');
          return;
        }
      }
      
      // 处理 text/plain 数据
      if (text) {
        const lowerText = text.toLowerCase();
        if (lowerText.endsWith('.lnk') || lowerText.endsWith('.exe')) {
          if (await checkAndHandleAppFile(text)) {
            return;
          }
        }

        // FIX: 最关键的修复 - 将包含斜杠的正则字面量改为 new RegExp
        const winPathRegex = new RegExp('^[A-Za-z]:[' + B_L + B_L + B_L + S_L + ']');
        const winDriveRegex = new RegExp('^[A-Za-z]:$');

        if (text.startsWith('http://') || text.startsWith('https://')) {
          await handleDroppedPath(text, 'web');
        } else if (text.startsWith('\\\\') || text.startsWith('//')) {
          await handleDroppedPath(text, 'network');
        } else if (winPathRegex.test(text) || text.startsWith('/') || winDriveRegex.test(text)) {
          // 命中了本地路径规则
          await handleDroppedPath(text, 'local');
        } else if (text.includes('\\') || text.includes('/')) {
          await handleDroppedPath(text, 'local');
        } else {
          try {
            const url = new URL(text);
            if (url.protocol === 'http:' || url.protocol === 'https:') {
              await handleDroppedPath(text, 'web');
            } else {
              await handleDroppedPath(text, 'local');
            }
          } catch {
            await handleDroppedPath(text, 'local');
          }
        }
        return;
      }
      
      const url = e.dataTransfer.getData('URL');
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        await handleDroppedPath(url, 'web');
        return;
      }
    } catch (error) {
      console.error('处理拖拽失败:', error);
    }
  };

  const handleDroppedPath = async (path: string, type: PathType) => {
    let name = '';
    
    if (type === 'web') {
      try {
        const response = await fetch(path, { mode: 'no-cors' });
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
      const parts = path.replaceAll(B_L, S_L).split(S_L).filter(p => p);
      name = parts[parts.length - 1] || path;
    }

    setDraggedPath({ path, name, type });
    setShowDragModal(true);
  };

  const handleConfirmDragPath = () => {
    if (!draggedPath) return;
    
    const groupName = newGroup.trim() || '默认分组';
    let finalPath = draggedPath.path.trim();
    
    if (draggedPath.type === 'network' && !finalPath.startsWith('\\\\')) {
      const leadingBackslashRegex = new RegExp('^' + B_L + '+');
      finalPath = '\\\\' + finalPath.replace(leadingBackslashRegex, '');
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

  const existingGroups = useMemo(() => {
    return Array.from(new Set(paths.map(p => p.group || '默认分组')));
  }, [paths]);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    paths.forEach(p => {
      if (p.tags && p.tags.length > 0) {
        p.tags.forEach(tag => tagSet.add(tag));
      }
    });
    return Array.from(tagSet).sort();
  }, [paths]);

  const groupedPaths = useMemo(() => {
    if (sortMode === 'tag') {
      const groups: Record<string, PathItem[]> = {};
      
      if (selectedTags.length > 0) {
        const selectedTagPaths = paths.filter(p => 
          p.tags && p.tags.some(tag => selectedTags.includes(tag))
        );
        if (selectedTagPaths.length > 0) {
          const groupName = selectedTags.length === 1 
            ? `标签: ${selectedTags[0]}`
            : `标签: ${selectedTags.join(', ')}`;
          groups[groupName] = selectedTagPaths;
        }
      }
      
      allTags.forEach(tag => {
        if (!selectedTags.includes(tag)) {
          const tagPaths = paths.filter(p => 
            p.tags && p.tags.includes(tag) && 
            !selectedTags.some(selectedTag => p.tags?.includes(selectedTag))
          );
          if (tagPaths.length > 0) {
            groups[`标签: ${tag}`] = tagPaths;
          }
        }
      });
      
      const noTagPaths = paths.filter(p => !p.tags || p.tags.length === 0);
      if (noTagPaths.length > 0) {
        groups['无标签'] = noTagPaths;
      }
      
      return groups;
    } else {
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
    }
  }, [paths, groupOrder, sortMode, selectedTags, allTags]);
  
  useEffect(() => {
    if (groupOrder.length === 0 && paths.length > 0) {
      const groups = Array.from(new Set(paths.map(p => p.group || '默认分组'))).sort();
      setGroupOrder(groups);
    }
  }, [paths.length, groupOrder.length]);

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
  
  useEffect(() => {
    localStorage.setItem('arthub_path_columns', columnsPerRow.toString());
  }, [columnsPerRow]);

  useEffect(() => {
    localStorage.setItem('arthub_path_sort_mode', sortMode);
  }, [sortMode]);

  useEffect(() => {
    localStorage.setItem('arthub_path_selected_tags', JSON.stringify(selectedTags));
  }, [selectedTags]);

  const handleCloseAddModal = () => {
    setIsModalOpen(false);
    setNewName('');
    setNewPath('');
    setNewGroup('');
    setNewTags([]);
  };

  const handleAddPath = () => {
    if (!newName || !newPath) return;
    const groupName = newGroup.trim() || '默认分组';
    
    let finalPath = newPath.trim();
    if (newType === 'network' && !finalPath.startsWith('\\\\')) {
      const leadingBackslashRegex = new RegExp('^' + B_L + '+');
      finalPath = '\\\\' + finalPath.replace(leadingBackslashRegex, '');
    }
    
    const item: PathItem = {
      id: Date.now().toString(),
      name: newName.trim(),
      path: finalPath,
      type: newType,
      group: groupName,
      tags: newTags || []
    };
    
    setPaths([item, ...paths]);
    
    if (!groupOrder.includes(groupName)) {
      setGroupOrder([...groupOrder, groupName]);
    }
    
    handleCloseAddModal();
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
    setEditTags(item.tags || []);
  };

  const handleEditSave = () => {
    if (!editingItem || !editName.trim() || !editPath.trim()) return;
    
    const groupName = editGroup.trim() || '默认分组';
    let finalPath = editPath.trim();
    if (editType === 'network' && !finalPath.startsWith('\\\\')) {
      const leadingBackslashRegex = new RegExp('^' + B_L + '+');
      finalPath = '\\\\' + finalPath.replace(leadingBackslashRegex, '');
    }
    
    const updatedItem: PathItem = {
      ...editingItem,
      name: editName.trim(),
      path: finalPath,
      type: editType,
      group: groupName,
      tags: editTags
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
    setEditTags([]);
  };

  const handleJump = async (item: PathItem) => {
    try {
      const lowerPath = item.path.toLowerCase();
      const isAppFilePath = lowerPath.endsWith('.lnk') || lowerPath.endsWith('.exe');
      
      if (item.type === 'app' || isAppFilePath) {
        try {
          await launchApp(item.path);
          return;
        } catch (error) {
          copyToClipboard(item.path, item.id);
          return;
        }
      }
      
      if (item.type === 'web') {
        if (item.path.startsWith('http://') || item.path.startsWith('https://')) {
          openUrl(item.path, '_blank');
          return;
        }
      }
      
      if (item.type === 'local' || item.type === 'network') {
        try {
          const { invoke } = await import('@tauri-apps/api/tauri');
          await invoke('open_folder', { path: item.path });
          return;
        } catch (error: any) {
          const errorMsg = error?.message || String(error);
          if (errorMsg.includes('Tauri API') || errorMsg.includes('__TAURI__') || errorMsg.includes('not available')) {
            copyToClipboard(item.path, item.id);
          } else {
            copyToClipboard(item.path, item.id);
          }
        }
        return;
      }
      
      if (item.path.startsWith('http://') || item.path.startsWith('https://')) {
        openUrl(item.path, '_blank');
      } else {
        try {
          const { invoke } = await import('@tauri-apps/api/tauri');
          await invoke('open_folder', { path: item.path });
        } catch (error: any) {
          copyToClipboard(item.path, item.id);
        }
      }
    } catch (error) {
      copyToClipboard(item.path, item.id);
    }
  };

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
    if (item.icon) {
      return (
        <img 
          src={item.icon} 
          alt={item.name}
          className="w-[18px] h-[18px] object-contain"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      );
    }
    
    switch (item.type) {
      case 'app': return <Play size={18} className="text-green-400" />;
      case 'web': return <Globe size={18} className="text-cyan-400" />;
      case 'network': return <Server size={18} className="text-purple-400" />;
      case 'local': return <Folder size={18} className="text-orange-400" />;
    }
  };

  const handleDragStart = (item: PathItem, e: React.DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.dropEffect = 'move';
    setDraggedItem(item);
    setIsDragging(true);
    e.dataTransfer.setData('text/plain', item.id);
    e.dataTransfer.setData('application/x-path-item', JSON.stringify({ id: item.id, type: 'path-item' }));
  };

  const handleDragStartGroup = (groupName: string, e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.dropEffect = 'move';
    
    try {
      e.dataTransfer.setData('text/plain', groupName);
      e.dataTransfer.setData('application/x-group', 'true');
    } catch (err) {
      console.warn('设置拖拽数据失败:', err);
    }
    
    setDraggedGroup(groupName);
    draggedGroupRef.current = groupName;
    setIsDragging(true);
  };

  const handleDragOver = (groupName: string, index: number, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedItem) {
      e.dataTransfer.dropEffect = 'move';
      setDragOverGroup(groupName);
      setDragOverIndex(index);
    } else {
      const types = Array.from(e.dataTransfer.types);
      if (types.includes('application/x-path-item') || types.includes('text/plain')) {
        e.dataTransfer.dropEffect = 'move';
      } else {
        e.dataTransfer.dropEffect = 'none';
      }
    }
  };

  const handleDragOverGroup = (groupName: string, e: React.DragEvent) => {
    if (!draggedGroup || draggedGroup === groupName) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverGroup(groupName);
  };

  const handleDrop = (targetGroup: string, targetIndex: number, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const types = Array.from(e.dataTransfer.types);
    const isPathItemDrag = draggedItem || types.includes('application/x-path-item');
    
    if (!isPathItemDrag || !draggedItem) {
      setDraggedItem(null);
      setDragOverGroup(null);
      setDragOverIndex(null);
      return;
    }

    if (!groupOrder.includes(targetGroup)) {
      setGroupOrder([...groupOrder, targetGroup]);
    }
    
    const updatedPaths = [...paths];
    const draggedIndex = updatedPaths.findIndex(p => p.id === draggedItem.id);
    if (draggedIndex === -1) {
      setDraggedItem(null);
      setDragOverGroup(null);
      setDragOverIndex(null);
      return;
    }
    
    const [draggedItemData] = updatedPaths.splice(draggedIndex, 1);
    draggedItemData.group = targetGroup;
    
    const targetGroupIndices: number[] = [];
    updatedPaths.forEach((p, idx) => {
      if ((p.group || '默认分组') === targetGroup) {
        targetGroupIndices.push(idx);
      }
    });
    
    let insertIndex: number;
    if (targetGroupIndices.length === 0) {
      insertIndex = updatedPaths.length;
    } else {
      const targetActualIndex = targetIndex < targetGroupIndices.length 
        ? targetGroupIndices[targetIndex]
        : targetGroupIndices[targetGroupIndices.length - 1] + 1;
      insertIndex = targetActualIndex;
    }
    
    updatedPaths.splice(insertIndex, 0, draggedItemData);
    setPaths(updatedPaths);
    setDraggedItem(null);
    setDragOverGroup(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setTimeout(() => {
      setDraggedItem(null);
      setDraggedGroup(null);
      setDragOverGroup(null);
      setDragOverIndex(null);
      setIsDragging(false);
      draggedGroupRef.current = null;
      dragOverGroupRef.current = null;
    }, 100);
  };

  const TypeSelector = ({ value, onChange }: { value: PathType; onChange: (t: PathType) => void }) => (
    <div className="flex gap-2 flex-wrap">
      {(['local', 'network', 'web', 'app'] as PathType[]).map(t => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={[
            'flex-1 py-2 text-sm font-medium rounded-lg',
            'transition-colors duration-150',
            value === t 
              ? OPACITY_CLASSES.bgBlue50020 + ' text-blue-400 border ' + OPACITY_CLASSES.borderBlue50050
              : 'bg-[#1a1a1a] text-[#808080] border border-[#2a2a2a] hover:border-[#3a3a3a]'
          ].filter(Boolean).join(' ')}
        >
          {t === 'local' ? '本地' : t === 'network' ? '局域网' : t === 'web' ? '网页' : '应用'}
        </button>
      ))}
    </div>
  );

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0a0a0a]">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between p-6 border-b border-[#1a1a1a] shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSortMode(sortMode === 'group' ? 'tag' : 'group')}
            className={[
              'p-2.5 rounded-lg',
              'border transition-colors duration-150',
              sortMode === 'group' 
                ? 'bg-[#1a1a1a] hover:bg-[#222222] text-[#a0a0a0] hover:text-white border-[#2a2a2a] hover:border-[#3a3a3a]'
                : OPACITY_CLASSES.bgBlue50020 + ' text-blue-400 ' + OPACITY_CLASSES.borderBlue50050 + ' ' + OPACITY_CLASSES.hoverBgBlue50030
            ].filter(Boolean).join(' ')}
            title={sortMode === 'group' ? '切换到按标签排序' : '切换到按分类分组'}
          >
            {sortMode === 'group' ? (
              <TagIcon size={18} />
            ) : (
              <Layers size={18} />
            )}
          </button>
          
          {sortMode === 'tag' && allTags.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {allTags.map(tag => {
                const isSelected = selectedTags.includes(tag);
                const color = getTagColor(tag);
                const selectedClassName = 'px-2.5 py-1 rounded-md text-xs font-medium transition-colors duration-150 border ' + color.bg + ' ' + color.text + ' ' + color.border;
                const unselectedClassName = 'px-2.5 py-1 rounded-md text-xs font-medium transition-colors duration-150 border bg-[#1a1a1a] text-[#808080] border-[#2a2a2a] hover:border-[#3a3a3a] hover:text-white';
                return (
                  <button
                    key={tag}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedTags(selectedTags.filter(t => t !== tag));
                      } else {
                        setSelectedTags([...selectedTags, tag]);
                      }
                    }}
                      className={isSelected ? selectedClassName : unselectedClassName}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-2">
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
            
            {showColumnsMenu && (
              <>
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setShowColumnsMenu(false)}
                />
                <div className={[
                  'absolute top-full right-0 mt-2 z-50',
                  'bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg',
                  'shadow-lg',
                  OPACITY_CLASSES.shadowBlack50,
                  'min-w-[120px]',
                  'overflow-hidden'
                ].join(' ')}>
                  {[1, 2, 3, 4].map(cols => (
                    <button
                      key={cols}
                      onClick={() => {
                        setColumnsPerRow(cols);
                        setShowColumnsMenu(false);
                      }}
                      className={[
                        'w-full px-4 py-2.5 text-left text-sm',
                        'transition-colors duration-150',
                        columnsPerRow === cols
                          ? OPACITY_CLASSES.bgBlue50020 + ' text-blue-400'
                          : 'text-[#a0a0a0] hover:bg-[#222222] hover:text-white'
                      ].filter(Boolean).join(' ')}
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

      <div
        ref={scrollContainerRef}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={(e) => {
          const types = Array.from(e.dataTransfer.types);
          const isGroupDrag = draggedGroupRef.current || types.includes('application/x-group') || types.includes('text/plain');
          if (isGroupDrag) {
            return;
          }
          handleDragOverCreatePath(e);
        }}
        onDrop={(e) => {
          const types = Array.from(e.dataTransfer.types);
          const isGroupDrag = draggedGroupRef.current || types.includes('application/x-group');
          if (isGroupDrag) {
            return;
          }
          handleDropCreatePath(e);
        }}
        className={[
          'flex-1 min-h-0 overflow-y-auto px-6 py-6',
          'transition-colors duration-200',
          isDraggingOver ? OPACITY_CLASSES.bgBlue50010 + ' border-2 border-dashed border-blue-500' : ''
        ].filter(Boolean).join(' ')}
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#2a2a2a #0a0a0a' }}
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
          <div 
            className="space-y-4"
            onDragOver={(e) => {
              const types = Array.from(e.dataTransfer.types);
              const isGroupDrag = draggedGroup || types.includes('application/x-group');
              
              if (isGroupDrag && draggedGroup) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }
            }}
          >
            {(sortMode === 'group' ? groupOrder : Object.keys(groupedPaths)).map((groupName, groupIndex) => {
              if (!groupedPaths[groupName]) return null;
              
              const selectedGroupName = selectedTags.length > 0 
                ? (selectedTags.length === 1 
                    ? `标签: ${selectedTags[0]}`
                    : `标签: ${selectedTags.join(', ')}`)
                : '';
              const groupKeys = Object.keys(groupedPaths);
              const firstNonSelectedIndex = groupKeys.findIndex(key => key !== selectedGroupName);
              const isDividerNeeded = sortMode === 'tag' && 
                groupIndex === firstNonSelectedIndex && 
                firstNonSelectedIndex > 0 &&
                selectedTags.length > 0;
              
              const showInsertBefore = draggedGroup && draggedGroup !== groupName && dragOverGroup === groupName;
              
              return (
                <React.Fragment key={groupName}>
                  {isDividerNeeded && (
                    <div className="my-4 border-t border-[#2a2a2a]" />
                  )}
                  
                  {showInsertBefore && (
                    <div
                      className="h-1 bg-blue-500 rounded-full mx-2 my-1"
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const draggedGroupName = e.dataTransfer.getData('text/plain') || draggedGroup;
                        if (draggedGroupName && draggedGroupName !== groupName) {
                          reorderGroups(draggedGroupName, groupName, true);
                          setDraggedGroup(null);
                          setDragOverGroup(null);
                        }
                      }}
                    />
                  )}
                  
                  <div 
                    className="space-y-2"
                    data-group-name={groupName}
                  >
                    <div 
                      draggable={true}
                      data-drag-group={groupName}
                      onDragStart={(e) => {
                        handleDragStartGroup(groupName, e);
                      }}
                      onDragEnd={(e) => {
                        handleDragEnd();
                      }}
                    onClick={(e) => {
                      if (isDragging || draggedGroup) {
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                      }
                      toggleGroup(groupName);
                    }}
                    className={[
                      'flex items-center gap-2 px-2 py-1.5 rounded-lg',
                      'cursor-move select-none',
                      'text-[#808080] hover:text-white hover:bg-[#1a1a1a]',
                      'transition-all duration-150',
                      draggedGroup === groupName ? 'opacity-50 scale-95' : '',
                      dragOverGroup === groupName && draggedGroup && draggedGroup !== groupName ? 'border-2 ' + OPACITY_CLASSES.borderWhite30 + ' ' + OPACITY_CLASSES.bgWhite5 : ''
                    ].filter(Boolean).join(' ')}
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

                  {!collapsedGroups.has(groupName) && (
                    <div 
                      className={['ml-2', columnsPerRow === 1 ? 'space-y-1.5' : 'grid gap-3'].filter(Boolean).join(' ')}
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
                          onDragEnd={(e) => handleDragEnd()}
                          onClick={(e) => {
                            if (isDragging || draggedItem) {
                              e.preventDefault();
                              e.stopPropagation();
                              return;
                            }
                            handleJump(item);
                          }}
                          className={[
                            'group relative bg-[#1a1a1a] hover:bg-[#222222]',
                            'border border-[#2a2a2a] hover:border-[#3a3a3a]',
                            'rounded-lg p-3 flex items-start gap-3',
                            'cursor-pointer transition-all duration-150',
                            draggedItem?.id === item.id ? 'opacity-50' : '',
                            dragOverGroup === groupName && dragOverIndex === index ? 'border-blue-500' : '',
                            columnsPerRow > 1 ? 'min-w-0' : ''
                          ].filter(Boolean).join(' ')}
                        >
                          {copiedId === item.id && (
                            <div className={'absolute inset-0 rounded-lg ' + OPACITY_CLASSES.bgGreen50090 + ' flex items-center justify-center text-white text-sm font-medium animate-fade-in z-20'}>
                              <Check size={16} className="mr-2" />
                              已复制到剪贴板
                            </div>
                          )}

                          <div className="flex flex-col items-center gap-1 shrink-0">
                            <div className="
                              p-2 rounded-lg
                              bg-[#0f0f0f] group-hover:bg-[#151515]
                              transition-colors flex items-center justify-center
                            ">
                              {getIcon(item)}
                            </div>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddToFavorites(item, e);
                              }}
                              className={[
                                'p-1 rounded transition-all duration-150',
                                isFavorited(item.id)
                                  ? 'text-yellow-400 opacity-100'
                                  : 'text-[#666666] opacity-0 group-hover:opacity-100 hover:text-yellow-400',
                                justFavoritedId === item.id ? 'scale-125' : ''
                              ].filter(Boolean).join(' ')}
                              title={isFavorited(item.id) ? "取消收藏" : "添加到收藏"}
                            >
                              <Star size={12} fill={isFavorited(item.id) ? "currentColor" : "none"} />
                            </button>
                          </div>

                          <div className={['flex-1 min-w-0', columnsPerRow > 1 ? 'overflow-hidden' : ''].filter(Boolean).join(' ')}>
                            <h3 className="
                              text-[14px] font-medium text-white
                              group-hover:text-blue-400
                              transition-colors break-words
                            " title={item.name}>
                              {item.name}
                            </h3>
                            {item.tags && item.tags.length > 0 && (
                              <div className="flex items-center gap-1.5 flex-wrap mt-2">
                                {item.tags.map((tag, tagIndex) => {
                                  const color = getTagColor(tag);
                                  const tagClassName = 'inline-flex items-center gap-1 px-2 py-0.5 rounded ' + color.bg + ' ' + color.text + ' border ' + color.border + ' text-[10px] font-medium whitespace-nowrap';
                                  return (
                                    <span
                                      key={tagIndex}
                                      className={tagClassName}
                                      title={tag}
                                    >
                                      <TagIcon size={10} />
                                      {tag}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEdit(item, e);
                                }}
                                className="p-1.5 rounded text-[#666666] hover:text-white hover:bg-[#2a2a2a] transition-colors"
                                title="编辑"
                              >
                                <Pencil size={13} />
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopy(item, e);
                                }}
                                className="p-1.5 rounded text-[#666666] hover:text-white hover:bg-[#2a2a2a] transition-colors"
                                title="复制路径"
                              >
                                <Copy size={13} />
                              </button>
                              {item.type === 'web' && (
                                <ExternalLink size={13} className="text-[#444444] mx-0.5" />
                              )}
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(item.id, e);
                                }}
                                className={'p-1.5 rounded text-[#666666] hover:text-red-400 ' + OPACITY_CLASSES.bgRed50010 + ' transition-colors'}
                                title="删除"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                
                {groupIndex === groupOrder.length - 1 && draggedGroup && draggedGroup !== groupName && !dragOverGroup && (
                  <div
                    className="h-1 bg-blue-500 rounded-full mx-2 my-1"
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const draggedGroupName = e.dataTransfer.getData('text/plain') || draggedGroup;
                      if (draggedGroupName && draggedGroupName !== groupName) {
                        const allGroups = Array.from(new Set([...groupOrder, ...Object.keys(groupedPaths)]));
                        const newOrder = [...allGroups];
                        const draggedIndex = newOrder.indexOf(draggedGroupName);
                        if (draggedIndex >= 0) {
                          newOrder.splice(draggedIndex, 1);
                          newOrder.push(draggedGroupName);
                          setGroupOrder(newOrder);
                          localStorage.setItem('arthub_group_order', JSON.stringify(newOrder));
                        }
                        setDraggedGroup(null);
                        setDragOverGroup(null);
                      }
                    }}
                  />
                )}
              </React.Fragment>
              );
            })}
          </div>
        )}
      </div>

      {/* 添加模态框 */}
      {isModalOpen && (
        <div 
          className={'fixed inset-0 z-50 flex items-center justify-center ' + OPACITY_CLASSES.bgBlack70 + ' backdrop-blur-sm'}
          onClick={handleCloseAddModal}
        >
          <div 
            className={[
              'w-full max-w-md mx-4',
              'bg-[#151515] border border-[#2a2a2a] rounded-xl',
              'shadow-2xl',
              OPACITY_CLASSES.shadowBlack50,
              'animate-scale-in'
            ].join(' ')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
              <h3 className="text-lg font-semibold text-white">添加新路径</h3>
              <button
                onClick={handleCloseAddModal}
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
                <label className="block text-sm font-medium text-[#a0a0a0] mb-2">标签</label>
                <TagEditor
                  tags={newTags}
                  onChange={setNewTags}
                  suggestions={allTags}
                  placeholder="输入标签后按回车添加"
                  maxTags={10}
                />
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
                onClick={handleCloseAddModal}
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
          className={'fixed inset-0 z-50 flex items-center justify-center ' + OPACITY_CLASSES.bgBlack70 + ' backdrop-blur-sm'}
          onClick={handleEditCancel}
        >
          <div 
            className={[
              'w-full max-w-md mx-4',
              'bg-[#151515] border border-[#2a2a2a] rounded-xl',
              'shadow-2xl',
              OPACITY_CLASSES.shadowBlack50,
              'animate-scale-in'
            ].join(' ')}
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
                <label className="block text-sm font-medium text-[#a0a0a0] mb-2">标签</label>
                <TagEditor
                  tags={editTags}
                  onChange={setEditTags}
                  suggestions={allTags}
                  placeholder="输入标签后按回车添加"
                  maxTags={10}
                />
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
          className={'fixed inset-0 z-50 flex items-center justify-center ' + OPACITY_CLASSES.bgBlack70 + ' backdrop-blur-sm'}
          onClick={() => {
            setShowDragModal(false);
            setDraggedPath(null);
          }}
        >
          <div 
            className={[
              'w-full max-w-md mx-4',
              'bg-[#151515] border border-[#2a2a2a] rounded-xl',
              'shadow-2xl',
              OPACITY_CLASSES.shadowBlack50,
              'animate-scale-in'
            ].join(' ')}
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