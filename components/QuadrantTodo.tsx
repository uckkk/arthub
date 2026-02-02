import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, X, Edit2, Trash2, GripVertical, Link as LinkIcon, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { useMiddleMouseScroll } from '../utils/useMiddleMouseScroll';
import { PathItem } from '../types';
import { launchApp } from '../services/appService';
import { openUrl } from '../services/windowService';

interface TodoItem {
  id: string;
  text: string;
  quadrant: 'urgent-important' | 'not-urgent-important' | 'urgent-not-important' | 'not-urgent-not-important';
  createdAt: number;
  updatedAt: number;
  linkedPaths?: string[]; // 关联的路径ID列表
  url?: string; // 关联的URL链接
}

const QuadrantTodo: React.FC = () => {
  const [todos, setTodos] = useState<TodoItem[]>(() => {
    const saved = localStorage.getItem('arthub_quadrant_todos');
    return saved ? JSON.parse(saved) : [];
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [newTodoQuadrant, setNewTodoQuadrant] = useState<TodoItem['quadrant']>('urgent-important');
  const [newTodoText, setNewTodoText] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [draggedTodo, setDraggedTodo] = useState<TodoItem | null>(null);
  const [dragOverQuadrant, setDragOverQuadrant] = useState<TodoItem['quadrant'] | null>(null);
  const [dragOverTodoId, setDragOverTodoId] = useState<string | null>(null); // 用于象限内排序
  const [dragOverPosition, setDragOverPosition] = useState<'above' | 'below' | null>(null); // 插入位置：上方或下方
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ todoId: string; startY: number; startX: number } | null>(null);
  const [dragStartState, setDragStartState] = useState<{ todoId: string; startY: number; startX: number } | null>(null);
  const [showPathSelector, setShowPathSelector] = useState(false);
  const [showPathSelectorEdit, setShowPathSelectorEdit] = useState(false);
  const [quickAddTexts, setQuickAddTexts] = useState<Record<TodoItem['quadrant'], string>>({
    'urgent-important': '',
    'not-urgent-important': '',
    'urgent-not-important': '',
    'not-urgent-not-important': '',
  });
  const [showQuickAdd, setShowQuickAdd] = useState<Record<TodoItem['quadrant'], boolean>>({
    'urgent-important': false,
    'not-urgent-important': false,
    'urgent-not-important': false,
    'not-urgent-not-important': false,
  });
  const [showPathSelectorQuick, setShowPathSelectorQuick] = useState<Record<TodoItem['quadrant'], boolean>>({
    'urgent-important': false,
    'not-urgent-important': false,
    'urgent-not-important': false,
    'not-urgent-not-important': false,
  });

  const scrollContainerRef = useMiddleMouseScroll<HTMLDivElement>({
    enabled: true,
    scrollSpeed: 1.5
  });

  // 保存到本地存储
  useEffect(() => {
    localStorage.setItem('arthub_quadrant_todos', JSON.stringify(todos));
  }, [todos]);

  // 从常用入口加载路径列表
  const availablePaths = useMemo<PathItem[]>(() => {
    try {
      const saved = localStorage.getItem('arthub_paths');
      if (saved) {
        const paths: PathItem[] = JSON.parse(saved);
        return paths;
      }
    } catch (error) {
      console.error('Failed to load paths:', error);
    }
    return [];
  }, []);

  // 提取文本中的路径引用（格式：[path:路径ID]）
  const extractPathReferences = (text: string): string[] => {
    const pathRegex = /\[path:([^\]]+)\]/g;
    const matches = [];
    let match;
    while ((match = pathRegex.exec(text)) !== null) {
      matches.push(match[1]);
    }
    return matches;
  };

  // 提取文本中的URL
  const extractUrl = (text: string): string | null => {
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    const match = text.match(urlRegex);
    return match ? match[0] : null;
  };

  // 检查文本是否包含URL
  const hasUrl = (text: string): boolean => {
    return extractUrl(text) !== null;
  };

  // 处理路径跳转
  const handlePathJump = async (path: PathItem, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    try {
      const lowerPath = path.path.toLowerCase();
      const isAppFilePath = lowerPath.endsWith('.lnk') || lowerPath.endsWith('.exe') || lowerPath.endsWith('.bat');
      
      if (path.type === 'app' || isAppFilePath) {
        try {
          await launchApp(path.path);
          return;
        } catch (error) {
          console.error('启动应用失败:', error);
          // 失败时复制路径到剪贴板
          navigator.clipboard.writeText(path.path);
          return;
        }
      }
      
      if (path.type === 'web') {
        if (path.path.startsWith('http://') || path.path.startsWith('https://')) {
          await openUrl(path.path, '_blank');
          return;
        }
      }
      
      if (path.type === 'local' || path.type === 'network') {
        try {
          const { invoke } = await import('@tauri-apps/api/tauri');
          await invoke('open_folder', { path: path.path });
          return;
        } catch (error: any) {
          console.error('打开文件夹失败:', error);
          // 失败时复制路径到剪贴板
          navigator.clipboard.writeText(path.path);
        }
        return;
      }
      
      // 默认处理：尝试打开URL或文件夹
      if (path.path.startsWith('http://') || path.path.startsWith('https://')) {
        await openUrl(path.path, '_blank');
      } else {
        try {
          const { invoke } = await import('@tauri-apps/api/tauri');
          await invoke('open_folder', { path: path.path });
        } catch (error: any) {
          console.error('打开路径失败:', error);
          navigator.clipboard.writeText(path.path);
        }
      }
    } catch (error) {
      console.error('路径跳转失败:', error);
      navigator.clipboard.writeText(path.path);
    }
  };

  // 处理任务点击跳转
  const handleTodoClick = async (todo: TodoItem, e: React.MouseEvent) => {
    // 如果正在拖动，不触发点击
    if (isDragging || draggedTodo) {
      return;
    }
    
    // 如果点击的是链接、按钮或拖动图标，不触发跳转
    const target = e.target as HTMLElement;
    if (
      target.closest('button') || 
      target.closest('a') || 
      target.closest('[class*="cursor-pointer"]') ||
      target.closest('svg') ||
      target.closest('[class*="GripVertical"]')
    ) {
      return;
    }
    
    // 如果有URL，直接跳转
    const todoUrl = todo.url || extractUrl(todo.text);
    if (todoUrl) {
      e.preventDefault();
      e.stopPropagation();
      try {
        await openUrl(todoUrl, '_blank');
      } catch (error) {
        console.error('打开URL失败:', error);
      }
      return;
    }
    
    // 如果有路径链接，跳转到第一个路径
    if (todo.linkedPaths && todo.linkedPaths.length > 0) {
      const pathId = todo.linkedPaths[0];
      const path = availablePaths.find(p => p.id === pathId);
      if (path) {
        e.preventDefault();
        e.stopPropagation();
        await handlePathJump(path, e);
      }
    }
  };

  // 渲染带路径链接的文本
  const renderTextWithPaths = (text: string) => {
    const pathRegex = /\[path:([^\]]+)\]/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = pathRegex.exec(text)) !== null) {
      // 添加匹配前的文本
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      
      // 查找对应的路径
      const pathId = match[1];
      const path = availablePaths.find(p => p.id === pathId);
      
      if (path) {
        // 添加换行符，确保链接换行显示
        parts.push(<br key={`br-${match.index}`} />);
        parts.push(
          <span
            key={match.index}
            onClick={(e) => handlePathJump(path, e)}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 text-xs cursor-pointer hover:bg-blue-500/30 hover:text-blue-300 transition-colors"
            title={`点击跳转到: ${path.path}`}
          >
            <LinkIcon size={12} />
            <span>{path.name}</span>
          </span>
        );
      } else {
        // 如果路径不存在，显示原始文本
        parts.push(match[0]);
      }
      
      lastIndex = match.index + match[0].length;
    }
    
    // 添加剩余文本
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }
    
    return parts.length > 0 ? parts : text;
  };

  // 插入路径到文本
  const insertPathToText = (path: PathItem, isEdit: boolean = false) => {
    const pathRef = `[path:${path.id}]`;
    if (isEdit) {
      const cursorPos = (document.activeElement as HTMLTextAreaElement)?.selectionStart || editText.length;
      const newText = editText.slice(0, cursorPos) + pathRef + editText.slice(cursorPos);
      setEditText(newText);
      // 恢复光标位置
      setTimeout(() => {
        const textarea = document.activeElement as HTMLTextAreaElement;
        if (textarea && textarea.tagName === 'TEXTAREA') {
          const newPos = cursorPos + pathRef.length;
          textarea.setSelectionRange(newPos, newPos);
          textarea.focus();
        }
      }, 0);
    } else {
      const cursorPos = (document.activeElement as HTMLTextAreaElement)?.selectionStart || newTodoText.length;
      const newText = newTodoText.slice(0, cursorPos) + pathRef + newTodoText.slice(cursorPos);
      setNewTodoText(newText);
      // 恢复光标位置
      setTimeout(() => {
        const textarea = document.activeElement as HTMLTextAreaElement;
        if (textarea && textarea.tagName === 'TEXTAREA') {
          const newPos = cursorPos + pathRef.length;
          textarea.setSelectionRange(newPos, newPos);
          textarea.focus();
        }
      }, 0);
    }
  };

  const quadrants: { key: TodoItem['quadrant']; title: string; color: string; bgColor: string }[] = [
    { key: 'urgent-important', title: '重要且紧急', color: 'text-red-400', bgColor: 'bg-red-500/10' },
    { key: 'not-urgent-important', title: '重要不紧急', color: 'text-blue-400', bgColor: 'bg-blue-500/10' },
    { key: 'urgent-not-important', title: '紧急不重要', color: 'text-yellow-400', bgColor: 'bg-yellow-500/10' },
    { key: 'not-urgent-not-important', title: '不紧急不重要', color: 'text-gray-400', bgColor: 'bg-gray-500/10' },
  ];

  const handleAddTodo = async () => {
    if (!newTodoText.trim()) return;
    
    const linkedPathIds = extractPathReferences(newTodoText);
    let url = extractUrl(newTodoText);
    
    // 如果文本中包含URL，尝试获取标题并更新文本
    let finalText = newTodoText.trim();
    if (url) {
      const title = await fetchPageTitle(url);
      if (title) {
        // 如果成功获取标题，用标题替换URL（URL保留在url字段中）
        finalText = newTodoText.replace(url, title).trim();
      }
    }
    
    const newTodo: TodoItem = {
      id: Date.now().toString(),
      text: finalText,
      quadrant: newTodoQuadrant,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      linkedPaths: linkedPathIds.length > 0 ? linkedPathIds : undefined,
      url: url || undefined,
    };
    
    setTodos([...todos, newTodo]);
    setNewTodoText('');
    setShowAddModal(false);
    setShowPathSelector(false);
  };

  // 快速添加TODO到指定象限
  const handleQuickAddTodo = async (quadrant: TodoItem['quadrant']) => {
    const text = quickAddTexts[quadrant].trim();
    if (!text) return;
    
    const linkedPathIds = extractPathReferences(text);
    let url = extractUrl(text);
    
    // 如果文本中包含URL，尝试获取标题并更新文本
    let finalText = text;
    if (url) {
      const title = await fetchPageTitle(url);
      if (title) {
        // 如果成功获取标题，用标题替换URL（URL保留在url字段中）
        finalText = text.replace(url, title).trim();
      }
    }
    
    const newTodo: TodoItem = {
      id: Date.now().toString(),
      text: finalText,
      quadrant: quadrant,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      linkedPaths: linkedPathIds.length > 0 ? linkedPathIds : undefined,
      url: url || undefined,
    };
    
    setTodos([...todos, newTodo]);
    setQuickAddTexts({ ...quickAddTexts, [quadrant]: '' });
    setShowQuickAdd({ ...showQuickAdd, [quadrant]: false });
    setShowPathSelectorQuick({ ...showPathSelectorQuick, [quadrant]: false });
  };

  // 快速插入路径到指定象限的输入框
  const insertPathToQuickAdd = (path: PathItem, quadrant: TodoItem['quadrant']) => {
    const pathRef = `[path:${path.id}]`;
    const currentText = quickAddTexts[quadrant];
    const textarea = document.getElementById(`quick-add-${quadrant}`) as HTMLTextAreaElement;
    const cursorPos = textarea?.selectionStart || currentText.length;
    const newText = currentText.slice(0, cursorPos) + pathRef + currentText.slice(cursorPos);
    setQuickAddTexts({ ...quickAddTexts, [quadrant]: newText });
    
    // 恢复光标位置
    setTimeout(() => {
      if (textarea) {
        const newPos = cursorPos + pathRef.length;
        textarea.setSelectionRange(newPos, newPos);
        textarea.focus();
      }
    }, 0);
  };

  const handleDelete = (id: string) => {
    if (window.confirm('确定要删除这个TODO吗？')) {
      setTodos(todos.filter(t => t.id !== id));
    }
  };

  const handleStartEdit = (todo: TodoItem) => {
    setEditingId(todo.id);
    setEditText(todo.text);
  };

  const handleSaveEdit = async () => {
    if (!editText.trim()) return;
    
    const linkedPathIds = extractPathReferences(editText);
    let url = extractUrl(editText);
    
    // 如果文本中包含URL，尝试获取标题并更新文本
    let finalText = editText.trim();
    if (url) {
      const title = await fetchPageTitle(url);
      if (title) {
        // 如果成功获取标题，用标题替换URL（URL保留在url字段中）
        finalText = editText.replace(url, title).trim();
      }
    }
    
    setTodos(todos.map(t => 
      t.id === editingId 
        ? { 
            ...t, 
            text: finalText, 
            updatedAt: Date.now(), 
            linkedPaths: linkedPathIds.length > 0 ? linkedPathIds : undefined,
            url: url || undefined,
          }
        : t
    ));
    setEditingId(null);
    setEditText('');
    setShowPathSelectorEdit(false);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  // 获取网页标题的辅助函数
  const fetchPageTitle = async (url: string): Promise<string | null> => {
    try {
      // 由于CORS限制，直接fetch可能失败
      // 尝试使用no-cors模式获取部分HTML（但无法读取响应内容）
      // 或者使用代理服务（如果有的话）
      
      // 方案1：尝试直接fetch（可能因CORS失败）
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3秒超时
        
        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          mode: 'no-cors', // 使用no-cors模式，但无法读取响应
        });
        
        clearTimeout(timeoutId);
      } catch (fetchError) {
        // CORS错误是预期的，继续使用备选方案
        console.debug('直接fetch失败（CORS限制）:', fetchError);
      }
      
      // 方案2：从URL解析友好的标题
      try {
        const urlObj = new URL(url);
        let title = urlObj.hostname.replace('www.', '');
        
        // 尝试从路径中提取更友好的标题
        const pathParts = urlObj.pathname.split('/').filter(p => p);
        if (pathParts.length > 0) {
          const lastPart = pathParts[pathParts.length - 1];
          // 如果最后一部分看起来像标题（不包含特殊字符），使用它
          if (lastPart && !lastPart.includes('.') && lastPart.length < 50) {
            title = decodeURIComponent(lastPart).replace(/[-_]/g, ' ');
          }
        }
        
        // 清理标题
        title = title.trim().substring(0, 100);
        
        return title || null;
      } catch (parseError) {
        console.debug('URL解析失败:', parseError);
        return null;
      }
    } catch (error) {
      // 静默失败，返回null，使用备选方案
      console.debug('获取网页标题失败:', error);
      return null;
    }
  };

  // 自定义鼠标拖动实现
  useEffect(() => {
    if (!dragStartState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dragStart = dragStartRef.current;
      if (!dragStart) return;

      const { todoId, startY, startX } = dragStart;
      const currentY = e.clientY;
      const currentX = e.clientX;
      const dy = currentY - startY;
      const dx = currentX - startX;

      // 如果移动距离超过5px，确认是拖动操作
      if (Math.abs(dy) > 5 || Math.abs(dx) > 5) {
        const todo = todos.find(t => t.id === todoId);
        if (!todo) return;

        if (!isDragging) {
          setIsDragging(true);
          setDraggedTodo(todo);
        }

        // 查找当前鼠标位置下的元素
        const elements = document.elementsFromPoint(e.clientX, e.clientY);
        let targetQuadrant: TodoItem['quadrant'] | null = null;
        let targetTodoId: string | null = null;

        // 优先查找任务项（用于象限内排序）
        for (const el of elements) {
          const todoElement = el.closest('[data-todo-id]') as HTMLElement;
          if (todoElement) {
            const id = todoElement.dataset.todoId;
            if (id && id !== todoId) {
              targetTodoId = id;
              // 判断插入位置：比较鼠标Y坐标和元素中心Y坐标
              const rect = todoElement.getBoundingClientRect();
              const elementCenterY = rect.top + rect.height / 2;
              setDragOverPosition(e.clientY < elementCenterY ? 'above' : 'below');
              break;
            }
          }
        }

        // 查找象限（用于跨象限移动）
        for (const el of elements) {
          const quadrantElement = el.closest('[data-quadrant]') as HTMLElement;
          if (quadrantElement) {
            const quadrant = quadrantElement.dataset.quadrant as TodoItem['quadrant'];
            if (quadrant) {
              targetQuadrant = quadrant;
              break;
            }
          }
        }

        // 如果找到目标任务项，检查是否在同一象限
        if (targetTodoId) {
          const targetTodo = todos.find(t => t.id === targetTodoId);
          if (targetTodo && targetTodo.quadrant === todo.quadrant) {
            // 同一象限内，进行排序
            setDragOverTodoId(targetTodoId);
            setDragOverQuadrant(null); // 清除象限高亮
          } else {
            // 不同象限，进行跨象限移动
            setDragOverTodoId(null);
            setDragOverPosition(null);
            if (targetQuadrant) {
              setDragOverQuadrant(targetQuadrant);
            }
          }
        } else if (targetQuadrant) {
          // 只找到象限，没有找到任务项，进行跨象限移动
          setDragOverTodoId(null);
          setDragOverPosition(null);
          setDragOverQuadrant(targetQuadrant);
        } else {
          // 都没有找到，清除状态
          setDragOverTodoId(null);
          setDragOverPosition(null);
          setDragOverQuadrant(null);
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      const dragStart = dragStartRef.current;
      if (dragStart && isDragging && draggedTodo) {
        // 再次查找目标元素（确保准确性）
        const elements = document.elementsFromPoint(e.clientX, e.clientY);
        let targetQuadrant: TodoItem['quadrant'] | null = dragOverQuadrant;
        let targetTodoId: string | null = dragOverTodoId;

        // 如果状态为空，尝试从鼠标位置查找
        if (!targetTodoId) {
          for (const el of elements) {
            const todoElement = el.closest('[data-todo-id]') as HTMLElement;
            if (todoElement) {
              const id = todoElement.dataset.todoId;
              if (id && id !== draggedTodo.id) {
                targetTodoId = id;
                break;
              }
            }
          }
        }

        if (!targetQuadrant) {
          for (const el of elements) {
            const quadrantElement = el.closest('[data-quadrant]') as HTMLElement;
            if (quadrantElement) {
              const quadrant = quadrantElement.dataset.quadrant as TodoItem['quadrant'];
              if (quadrant) {
                targetQuadrant = quadrant;
                break;
              }
            }
          }
        }

        // 优先处理象限内排序
        if (targetTodoId) {
          const targetTodo = todos.find(t => t.id === targetTodoId);
          if (targetTodo && targetTodo.quadrant === draggedTodo.quadrant) {
            // 同一象限内排序
            const quadrantTodos = todos.filter(t => t.quadrant === draggedTodo.quadrant);
            const draggedIndex = quadrantTodos.findIndex(t => t.id === draggedTodo.id);
            let targetIndex = quadrantTodos.findIndex(t => t.id === targetTodoId);

            if (draggedIndex !== -1 && targetIndex !== -1 && draggedIndex !== targetIndex) {
              // 根据插入位置调整目标索引
              if (dragOverPosition === 'below' && draggedIndex < targetIndex) {
                targetIndex += 1;
              } else if (dragOverPosition === 'above' && draggedIndex > targetIndex) {
                // 保持targetIndex不变
              } else if (dragOverPosition === 'below' && draggedIndex > targetIndex) {
                targetIndex += 1;
              }

              // 创建新的排序数组
              const newQuadrantTodos = [...quadrantTodos];
              const [removed] = newQuadrantTodos.splice(draggedIndex, 1);
              newQuadrantTodos.splice(targetIndex, 0, removed);

              // 更新整个todos数组，保持其他象限不变
              const otherTodos = todos.filter(t => t.quadrant !== draggedTodo.quadrant);
              const updatedTodos = [...otherTodos, ...newQuadrantTodos].map(t => ({
                ...t,
                updatedAt: t.id === draggedTodo.id ? Date.now() : t.updatedAt
              }));
              setTodos(updatedTodos);
            }
          } else if (targetQuadrant && draggedTodo.quadrant !== targetQuadrant) {
            // 跨象限移动
            const updatedTodos = todos.map(t => 
              t.id === draggedTodo.id 
                ? { ...t, quadrant: targetQuadrant!, updatedAt: Date.now() }
                : t
            );
            setTodos(updatedTodos);
          }
        } else if (targetQuadrant && draggedTodo.quadrant !== targetQuadrant) {
          // 跨象限移动（没有找到目标任务项）
          const updatedTodos = todos.map(t => 
            t.id === draggedTodo.id 
              ? { ...t, quadrant: targetQuadrant!, updatedAt: Date.now() }
              : t
          );
          setTodos(updatedTodos);
        }
      }

      // 清除拖动状态
      dragStartRef.current = null;
      setDragStartState(null);
      setTimeout(() => {
        setIsDragging(false);
        setDraggedTodo(null);
        setDragOverQuadrant(null);
        setDragOverTodoId(null);
        setDragOverPosition(null);
      }, 100);
    };

    document.addEventListener('mousemove', handleMouseMove, { passive: false });
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragStartState, isDragging, draggedTodo, dragOverQuadrant, todos]);

  const handleDragOver = (e: React.DragEvent, quadrant: TodoItem['quadrant']) => {
    // 只处理外部链接拖拽（HTML5拖放）
    e.preventDefault();
    e.stopPropagation();
    
    // 检查是否是外部链接拖拽
    const types = Array.from(e.dataTransfer.types);
    const hasUrl = types.includes('text/uri-list') || types.includes('text/plain') || types.includes('text/html');
    
    if (hasUrl && !draggedTodo) {
      // 外部链接拖拽
      e.dataTransfer.dropEffect = 'copy';
      setDragOverQuadrant(quadrant);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // 检查是否真的离开了象限区域
    const relatedTarget = e.relatedTarget as HTMLElement;
    const currentTarget = e.currentTarget as HTMLElement;
    
    // 如果鼠标移动到象限内的其他元素，不清除dragOver状态
    if (relatedTarget && currentTarget.contains(relatedTarget)) {
      return;
    }
    
    // 只在外部链接拖拽时清除
    if (!draggedTodo) {
      setDragOverQuadrant(null);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetQuadrant: TodoItem['quadrant']) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 只处理外部链接拖拽（任务拖动由自定义鼠标事件处理）
    const types = Array.from(e.dataTransfer.types);
    const hasUrlType = types.includes('text/uri-list') || types.includes('text/plain') || types.includes('text/html');
    
    if (hasUrlType && !draggedTodo) {
      // 处理外部链接拖拽
      let url = '';
      
      // 优先尝试获取 uri-list 格式
      if (types.includes('text/uri-list')) {
        url = e.dataTransfer.getData('text/uri-list');
      } else if (types.includes('text/html')) {
        // 从HTML中提取URL
        const html = e.dataTransfer.getData('text/html');
        const urlMatch = html.match(/href=["']([^"']+)["']/i);
        if (urlMatch) {
          url = urlMatch[1];
        } else {
          url = e.dataTransfer.getData('text/plain');
        }
      } else {
        url = e.dataTransfer.getData('text/plain');
      }
      
      // 清理URL（移除换行符等）
      url = url.trim().split('\n')[0].trim();
      
      // 验证是否是有效的URL
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        try {
          // 尝试获取网页标题
          let title = await fetchPageTitle(url);
          
          // 如果获取失败，使用URL解析作为备选
          if (!title) {
            const urlObj = new URL(url);
            title = urlObj.hostname.replace('www.', '');
            
            // 尝试从路径中提取更友好的标题
            const pathParts = urlObj.pathname.split('/').filter(p => p);
            if (pathParts.length > 0) {
              const lastPart = pathParts[pathParts.length - 1];
              // 如果最后一部分看起来像标题（不包含特殊字符），使用它
              if (lastPart && !lastPart.includes('.') && lastPart.length < 50) {
                title = decodeURIComponent(lastPart).replace(/[-_]/g, ' ');
              }
            }
          }
          
          // 只将标题作为任务名，URL存储在url字段中
          const newTodo: TodoItem = {
            id: Date.now().toString(),
            text: title || url, // 如果标题获取失败，使用URL作为任务名
            quadrant: targetQuadrant,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            url: url,
          };
          
          setTodos([...todos, newTodo]);
        } catch (error) {
          console.error('解析URL失败:', error);
          // 即使解析失败，也创建任务
          const newTodo: TodoItem = {
            id: Date.now().toString(),
            text: url,
            quadrant: targetQuadrant,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            url: url,
          };
          setTodos([...todos, newTodo]);
        }
      }
      // 清除拖动状态
      setDragOverQuadrant(null);
    }
  };

  const getTodosByQuadrant = (quadrant: TodoItem['quadrant']) => {
    return todos.filter(t => t.quadrant === quadrant);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0a0a0a]">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between p-6 border-b border-[#1a1a1a] shrink-0">
        <h1 className="text-xl font-semibold text-white">待办工作</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
        >
          <Plus size={18} />
          添加TODO
        </button>
      </div>

      {/* 四象限网格 */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 grid grid-cols-2 gap-4 p-6 overflow-auto"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#2a2a2a #0a0a0a' }}
      >
        {quadrants.map((quadrant) => {
          const quadrantTodos = getTodosByQuadrant(quadrant.key);
          const isDragOver = dragOverQuadrant === quadrant.key;
          
          return (
            <div
              key={quadrant.key}
              data-quadrant={quadrant.key}
              className={
                'rounded-lg border-2 border-dashed p-4 min-h-[300px] transition-all duration-200 ' +
                (isDragOver ? 'border-blue-500 bg-blue-500/10' : 'border-[#2a2a2a] bg-[#0f0f0f]')
              }
              onDragOver={(e) => handleDragOver(e, quadrant.key)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, quadrant.key)}
            >
              {/* 象限标题 */}
              <div className={`flex items-center justify-between mb-4 pb-3 border-b border-[#2a2a2a]`}>
                <h2 className={`text-lg font-semibold ${quadrant.color}`}>
                  {quadrant.title}
                </h2>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[#666666]">
                    {quadrantTodos.length} 项
                  </span>
                  {!showQuickAdd[quadrant.key] && (
                    <button
                      onClick={() => setShowQuickAdd({ ...showQuickAdd, [quadrant.key]: true })}
                      className="p-1.5 rounded text-[#666666] hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                      title="快速添加"
                    >
                      <Plus size={16} />
                    </button>
                  )}
                </div>
              </div>

              {/* 快速添加输入框 */}
              {showQuickAdd[quadrant.key] && (
                <div className="mb-3 p-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-[#a0a0a0]">快速添加</span>
                    {availablePaths.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowPathSelectorQuick({ ...showPathSelectorQuick, [quadrant.key]: !showPathSelectorQuick[quadrant.key] })}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 transition-colors"
                      >
                        <LinkIcon size={10} />
                        <span>路径</span>
                        {showPathSelectorQuick[quadrant.key] ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                      </button>
                    )}
                  </div>
                  {showPathSelectorQuick[quadrant.key] && availablePaths.length > 0 && (
                    <div className="mb-2 p-2 rounded-lg bg-[#0f0f0f] border border-[#2a2a2a] max-h-32 overflow-y-auto">
                      <div className="space-y-1">
                        {availablePaths.map((path) => (
                          <button
                            key={path.id}
                            type="button"
                            onClick={() => {
                              insertPathToQuickAdd(path, quadrant.key);
                              setShowPathSelectorQuick({ ...showPathSelectorQuick, [quadrant.key]: false });
                            }}
                            className="w-full text-left px-2 py-1 rounded text-xs text-[#a0a0a0] hover:text-white hover:bg-[#1a1a1a] transition-colors flex items-center gap-2"
                          >
                            <LinkIcon size={10} className="text-blue-400 flex-shrink-0" />
                            <span className="flex-1 truncate">{path.name}</span>
                            <span className="text-[10px] text-[#666666] truncate max-w-[120px]">{path.path}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <textarea
                    id={`quick-add-${quadrant.key}`}
                    value={quickAddTexts[quadrant.key]}
                    onChange={(e) => setQuickAddTexts({ ...quickAddTexts, [quadrant.key]: e.target.value })}
                    className="w-full px-2 py-1.5 rounded-lg bg-[#0f0f0f] border border-[#2a2a2a] text-white placeholder-[#666666] focus:outline-none focus:border-blue-500 resize-none text-sm"
                    rows={2}
                    placeholder="输入TODO内容，按Enter创建..."
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        handleQuickAddTodo(quadrant.key);
                      } else if (e.key === 'Escape') {
                        setShowQuickAdd({ ...showQuickAdd, [quadrant.key]: false });
                        setQuickAddTexts({ ...quickAddTexts, [quadrant.key]: '' });
                        setShowPathSelectorQuick({ ...showPathSelectorQuick, [quadrant.key]: false });
                      }
                    }}
                  />
                  <div className="flex items-center justify-end gap-2 mt-2">
                    <button
                      onClick={() => {
                        setShowQuickAdd({ ...showQuickAdd, [quadrant.key]: false });
                        setQuickAddTexts({ ...quickAddTexts, [quadrant.key]: '' });
                        setShowPathSelectorQuick({ ...showPathSelectorQuick, [quadrant.key]: false });
                      }}
                      className="px-2 py-1 rounded text-xs text-[#666666] hover:text-white hover:bg-[#2a2a2a] transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={() => handleQuickAddTodo(quadrant.key)}
                      disabled={!quickAddTexts[quadrant.key].trim()}
                      className="px-2 py-1 rounded text-xs bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                    >
                      <Plus size={12} />
                      添加
                    </button>
                  </div>
                </div>
              )}

              {/* TODO列表 */}
              <div className="space-y-2 min-h-[100px]">
                {quadrantTodos.length === 0 ? (
                  <div className={`text-center py-8 text-sm transition-colors ${
                    isDragOver ? 'text-blue-400' : 'text-[#666666]'
                  }`}>
                    {isDragOver ? '松开以添加任务' : '暂无TODO，点击右上角添加或拖拽链接到这里'}
                  </div>
                ) : (
                  quadrantTodos.map((todo, todoIndex) => {
                    const todoUrl = todo.url || extractUrl(todo.text);
                    const isClickable = !!todoUrl || (todo.linkedPaths && todo.linkedPaths.length > 0);
                    const isDragged = draggedTodo?.id === todo.id;
                    const isDragOver = dragOverTodoId === todo.id;
                    const isSameQuadrantDrag = draggedTodo && draggedTodo.quadrant === quadrant.key;
                    
                    return (
                      <React.Fragment key={todo.id}>
                        {/* 插入位置指示器（在目标任务项上方） */}
                        {isDragOver && isSameQuadrantDrag && !isDragged && dragOverPosition === 'above' && (
                          <div className="h-0.5 bg-blue-500 rounded-full mx-2 my-1 animate-pulse" />
                        )}
                        <div
                          data-todo-id={todo.id}
                          onClick={(e) => {
                            // 拖动时不触发点击
                            if (isDragging || draggedTodo || dragStartRef.current) {
                              e.preventDefault();
                              e.stopPropagation();
                              return;
                            }
                            if (isClickable) {
                              handleTodoClick(todo, e);
                            }
                          }}
                          className={`
                            group relative p-3 rounded-lg bg-[#1a1a1a] border transition-all
                            ${isDragged 
                              ? 'opacity-50 cursor-move border-blue-500/50' 
                              : isDragOver && isSameQuadrantDrag
                              ? 'border-blue-500 bg-blue-500/10'
                              : isClickable 
                              ? 'cursor-pointer border-[#2a2a2a] hover:border-[#3a3a3a] hover:bg-[#1f1f1f]' 
                              : 'cursor-move border-[#2a2a2a] hover:border-[#3a3a3a]'
                            }
                          `}
                        >
                          {/* 插入位置指示器（在目标任务项下方） */}
                          {isDragOver && isSameQuadrantDrag && !isDragged && dragOverPosition === 'below' && (
                            <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-blue-500 rounded-full animate-pulse" />
                          )}
                      {editingId === todo.id ? (
                        <div className="space-y-2">
                          {availablePaths.length > 0 && (
                            <div className="flex items-center justify-end">
                              <button
                                type="button"
                                onClick={() => setShowPathSelectorEdit(!showPathSelectorEdit)}
                                className="flex items-center gap-1 px-2 py-1 rounded text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 transition-colors"
                              >
                                <LinkIcon size={12} />
                                <span>插入路径</span>
                                {showPathSelectorEdit ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              </button>
                            </div>
                          )}
                          {showPathSelectorEdit && availablePaths.length > 0 && (
                            <div className="p-2 rounded-lg bg-[#0f0f0f] border border-[#2a2a2a] max-h-32 overflow-y-auto">
                              <div className="space-y-1">
                                {availablePaths.map((path) => (
                                  <button
                                    key={path.id}
                                    type="button"
                                    onClick={() => {
                                      insertPathToText(path, true);
                                      setShowPathSelectorEdit(false);
                                    }}
                                    className="w-full text-left px-2 py-1 rounded text-xs text-[#a0a0a0] hover:text-white hover:bg-[#1a1a1a] transition-colors flex items-center gap-2"
                                  >
                                    <LinkIcon size={10} className="text-blue-400 flex-shrink-0" />
                                    <span className="flex-1 truncate">{path.name}</span>
                                    <span className="text-[10px] text-[#666666] truncate max-w-[150px]">{path.path}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-[#0f0f0f] border border-[#2a2a2a] text-white placeholder-[#666666] focus:outline-none focus:border-blue-500 resize-none"
                            rows={3}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                handleSaveEdit();
                              } else if (e.key === 'Escape') {
                                handleCancelEdit();
                              }
                            }}
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={handleSaveEdit}
                              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm transition-colors"
                            >
                              保存
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="px-3 py-1.5 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#a0a0a0] hover:text-white text-sm transition-colors"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start gap-2">
                            <GripVertical 
                              size={16} 
                              data-drag-handle
                              className="text-[#666666] mt-1 cursor-grab active:cursor-grabbing flex-shrink-0"
                              onMouseDown={(e) => {
                                // 启动自定义拖动
                                if (e.button === 0) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const dragInfo = { todoId: todo.id, startY: e.clientY, startX: e.clientX };
                                  dragStartRef.current = dragInfo;
                                  setDragStartState(dragInfo);
                                  setDraggedTodo(todo);
                                }
                              }}
                            />
                            <div className="flex-1 text-white text-sm break-words">
                              <div className="flex items-start gap-1.5">
                                <span className="flex-1">{renderTextWithPaths(todo.text)}</span>
                                {todoUrl && (
                                  <ExternalLink 
                                    size={14} 
                                    className="text-blue-400 flex-shrink-0 mt-0.5 opacity-70 hover:opacity-100 transition-opacity"
                                    title={`点击打开: ${todoUrl}`}
                                  />
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => handleStartEdit(todo)}
                              className="p-1.5 rounded text-[#666666] hover:text-blue-400 hover:bg-[#2a2a2a] transition-colors"
                              title="编辑"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => handleDelete(todo.id)}
                              className="p-1.5 rounded text-[#666666] hover:text-red-400 hover:bg-[#2a2a2a] transition-colors"
                              title="删除"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                    </React.Fragment>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 添加TODO模态框 */}
      {showAddModal && (
        <div 
          className={'fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm'}
          onClick={() => setShowAddModal(false)}
        >
          <div 
            className={'w-full max-w-md mx-4 bg-[#151515] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50 animate-scale-in'}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
              <h3 className="text-lg font-semibold text-white">添加TODO</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1.5 rounded-lg text-[#666666] hover:text-white hover:bg-[#252525] transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#a0a0a0] mb-2">象限</label>
                <select
                  value={newTodoQuadrant}
                  onChange={(e) => setNewTodoQuadrant(e.target.value as TodoItem['quadrant'])}
                  className="w-full px-4 py-2.5 rounded-lg bg-[#0f0f0f] border border-[#2a2a2a] text-white focus:outline-none focus:border-blue-500 transition-colors"
                >
                  {quadrants.map(q => (
                    <option key={q.key} value={q.key}>{q.title}</option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-[#a0a0a0]">内容</label>
                  {availablePaths.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowPathSelector(!showPathSelector)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 transition-colors"
                    >
                      <LinkIcon size={12} />
                      <span>插入路径</span>
                      {showPathSelector ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                  )}
                </div>
                {showPathSelector && availablePaths.length > 0 && (
                  <div className="mb-3 p-3 rounded-lg bg-[#0f0f0f] border border-[#2a2a2a] max-h-40 overflow-y-auto">
                    <div className="space-y-1">
                      {availablePaths.map((path) => (
                        <button
                          key={path.id}
                          type="button"
                          onClick={() => {
                            insertPathToText(path, false);
                            setShowPathSelector(false);
                          }}
                          className="w-full text-left px-2 py-1.5 rounded text-sm text-[#a0a0a0] hover:text-white hover:bg-[#1a1a1a] transition-colors flex items-center gap-2"
                        >
                          <LinkIcon size={12} className="text-blue-400 flex-shrink-0" />
                          <span className="flex-1 truncate">{path.name}</span>
                          <span className="text-xs text-[#666666] truncate max-w-[200px]">{path.path}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <textarea
                  value={newTodoText}
                  onChange={(e) => setNewTodoText(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg bg-[#0f0f0f] border border-[#2a2a2a] text-white placeholder-[#666666] focus:outline-none focus:border-blue-500 resize-none"
                  rows={4}
                  placeholder="输入TODO内容..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      handleAddTodo();
                    }
                  }}
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#2a2a2a]">
              <button 
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2.5 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#a0a0a0] hover:text-white hover:border-[#3a3a3a] transition-colors font-medium"
              >
                取消
              </button>
              <button 
                onClick={handleAddTodo}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
              >
                <Plus size={16} />
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuadrantTodo;
