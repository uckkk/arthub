import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, X, Edit2, Trash2, GripVertical, Link as LinkIcon, ChevronDown, ChevronUp } from 'lucide-react';
import { useMiddleMouseScroll } from '../utils/useMiddleMouseScroll';
import { PathItem } from '../types';

interface TodoItem {
  id: string;
  text: string;
  quadrant: 'urgent-important' | 'not-urgent-important' | 'urgent-not-important' | 'not-urgent-not-important';
  createdAt: number;
  updatedAt: number;
  linkedPaths?: string[]; // 关联的路径ID列表
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
  const [showPathSelector, setShowPathSelector] = useState(false);
  const [showPathSelectorEdit, setShowPathSelectorEdit] = useState(false);

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
        parts.push(
          <span key={match.index} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 text-xs">
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

  const handleAddTodo = () => {
    if (!newTodoText.trim()) return;
    
    const linkedPathIds = extractPathReferences(newTodoText);
    
    const newTodo: TodoItem = {
      id: Date.now().toString(),
      text: newTodoText.trim(),
      quadrant: newTodoQuadrant,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      linkedPaths: linkedPathIds.length > 0 ? linkedPathIds : undefined,
    };
    
    setTodos([...todos, newTodo]);
    setNewTodoText('');
    setShowAddModal(false);
    setShowPathSelector(false);
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

  const handleSaveEdit = () => {
    if (!editText.trim()) return;
    
    const linkedPathIds = extractPathReferences(editText);
    
    setTodos(todos.map(t => 
      t.id === editingId 
        ? { ...t, text: editText.trim(), updatedAt: Date.now(), linkedPaths: linkedPathIds.length > 0 ? linkedPathIds : undefined }
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

  const handleDragStart = (e: React.DragEvent, todo: TodoItem) => {
    setDraggedTodo(todo);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', todo.id);
  };

  const handleDragOver = (e: React.DragEvent, quadrant: TodoItem['quadrant']) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverQuadrant(quadrant);
  };

  const handleDragLeave = () => {
    setDragOverQuadrant(null);
  };

  const handleDrop = (e: React.DragEvent, targetQuadrant: TodoItem['quadrant']) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (draggedTodo && draggedTodo.quadrant !== targetQuadrant) {
      setTodos(todos.map(t => 
        t.id === draggedTodo.id 
          ? { ...t, quadrant: targetQuadrant, updatedAt: Date.now() }
          : t
      ));
    }
    
    setDraggedTodo(null);
    setDragOverQuadrant(null);
  };

  const getTodosByQuadrant = (quadrant: TodoItem['quadrant']) => {
    return todos.filter(t => t.quadrant === quadrant);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0a0a0a]">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between p-6 border-b border-[#1a1a1a] shrink-0">
        <h1 className="text-xl font-semibold text-white">四象限TODO</h1>
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
                <span className="text-sm text-[#666666]">
                  {quadrantTodos.length} 项
                </span>
              </div>

              {/* TODO列表 */}
              <div className="space-y-2">
                {quadrantTodos.length === 0 ? (
                  <div className="text-center py-8 text-[#666666] text-sm">
                    暂无TODO，点击右上角添加
                  </div>
                ) : (
                  quadrantTodos.map((todo) => (
                    <div
                      key={todo.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, todo)}
                      className={`
                        group relative p-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a]
                        hover:border-[#3a3a3a] transition-all cursor-move
                        ${draggedTodo?.id === todo.id ? 'opacity-50' : ''}
                      `}
                    >
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
                              className="text-[#666666] mt-1 cursor-grab active:cursor-grabbing"
                            />
                            <div className="flex-1 text-white text-sm break-words">
                              {renderTextWithPaths(todo.text)}
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
                  ))
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
