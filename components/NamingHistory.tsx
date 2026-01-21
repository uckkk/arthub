import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Copy, Trash2, History as HistoryIcon, FileText, X, RefreshCw, Check } from 'lucide-react';
import { NamingHistoryItem } from '../types';
import { loadNotesFromLocalStorage, saveNotesToLocalStorage, saveNotesToFile, loadNotesFromFile } from '../services/notesService';
import { getStorageConfig } from '../services/fileStorageService';
import { useMiddleMouseScroll } from '../utils/useMiddleMouseScroll';
import { openUrl } from '../services/windowService';

// URL正则表达式
const URL_REGEX = /(https?:\/\/[^\s]+)/g;

const NamingHistory: React.FC = () => {
  const [history, setHistory] = useState<NamingHistoryItem[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  
  // 当前模板ID
  const [currentPresetId, setCurrentPresetId] = useState<string>(() => {
    return localStorage.getItem('arthub_naming_preset') || 'fgui_card';
  });
  
  // 备注功能状态
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const notesTextareaRef = useRef<HTMLDivElement>(null);
  const currentPresetIdRef = useRef<string>(currentPresetId);
  const isInitialLoadRef = useRef<boolean>(true);
  
  // 鼠标中键滚动
  const scrollContainerRef = useMiddleMouseScroll<HTMLDivElement>({
    enabled: true,
    scrollSpeed: 1.5
  });
  
  // 容器高度调整
  const [topHeight, setTopHeight] = useState<number>(50);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 获取模板相关的存储键
  const getHistoryKey = useCallback((presetId?: string): string => {
    const id = presetId || currentPresetId;
    return `arthub_naming_history_${id}`;
  }, [currentPresetId]);

  // 从 localStorage 加载历史记录
  useEffect(() => {
    const loadHistory = () => {
      const key = getHistoryKey(currentPresetId);
      const saved = localStorage.getItem(key);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          const sorted = parsed.sort((a: NamingHistoryItem, b: NamingHistoryItem) => b.timestamp - a.timestamp);
          setHistory(sorted);
        } catch {
          setHistory([]);
        }
      } else {
        setHistory([]);
      }
    };

    loadHistory();

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === getHistoryKey(currentPresetId)) {
        loadHistory();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    const interval = setInterval(loadHistory, 1000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, [currentPresetId, getHistoryKey]);

  // 保存当前模板的备注
  const saveCurrentTemplateNotes = useCallback(async () => {
    if (!notesTextareaRef.current) return;
    const text = notesTextareaRef.current.textContent || '';
    if (text.trim()) {
      saveNotesToLocalStorage(text, currentPresetIdRef.current);
      const config = getStorageConfig();
      if (config.enabled) {
        try {
          await saveNotesToFile(text, currentPresetIdRef.current);
        } catch (error) {
          console.error('保存备注到文件失败:', error);
        }
      }
    }
  }, []);

  // 加载指定模板的备注
  const loadTemplateNotes = useCallback(async (presetId: string) => {
    let content = loadNotesFromLocalStorage(presetId);
    
    if (!content) {
      const config = getStorageConfig();
      if (config.enabled) {
        try {
          const fileContent = await loadNotesFromFile(presetId);
          if (fileContent) {
            content = fileContent;
            saveNotesToLocalStorage(content, presetId);
          }
        } catch (error) {
          console.error('从文件加载备注失败:', error);
        }
      }
    }
    
    if (notesTextareaRef.current) {
      notesTextareaRef.current.textContent = content || '';
      if (content && content.match(URL_REGEX)) {
        updateContentWithLinks(notesTextareaRef.current, content);
      }
    }
  }, []);

  // 监听模板切换
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'arthub_naming_preset' && e.newValue) {
        const newPresetId = e.newValue;
        saveCurrentTemplateNotes().then(() => {
          currentPresetIdRef.current = newPresetId;
          loadTemplateNotes(newPresetId);
        });
        setCurrentPresetId(newPresetId);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    
    const interval = setInterval(() => {
      const presetId = localStorage.getItem('arthub_naming_preset') || 'fgui_card';
      if (presetId !== currentPresetIdRef.current) {
        saveCurrentTemplateNotes().then(() => {
          currentPresetIdRef.current = presetId;
          loadTemplateNotes(presetId);
        });
        setCurrentPresetId(presetId);
      }
    }, 300);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, [saveCurrentTemplateNotes, loadTemplateNotes]);

  // 初始化加载备注内容
  useEffect(() => {
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      currentPresetIdRef.current = currentPresetId;
      loadTemplateNotes(currentPresetId);
    }
  }, [loadTemplateNotes, currentPresetId]);

  // 防抖保存定时器
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  // 更新内容并转换URL为链接
  const updateContentWithLinks = (element: HTMLElement, text: string) => {
    const selection = window.getSelection();
    let range: Range | null = null;
    if (selection && selection.rangeCount > 0) {
      range = selection.getRangeAt(0).cloneRange();
    }
    
    const html = text.replace(URL_REGEX, (url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300 underline break-all">${url}</a>`;
    });
    
    element.innerHTML = html || '';
    
    if (range && selection) {
      try {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let currentOffset = 0;
        let targetOffset = range.startOffset;
        let targetNode: Node | null = null;
        
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const nodeLength = node.textContent?.length || 0;
          if (currentOffset + nodeLength >= targetOffset) {
            targetNode = node;
            break;
          }
          currentOffset += nodeLength;
        }
        
        if (targetNode) {
          const newRange = document.createRange();
          const offset = targetOffset - currentOffset;
          newRange.setStart(targetNode, Math.min(offset, targetNode.textContent?.length || 0));
          newRange.setEnd(targetNode, Math.min(offset, targetNode.textContent?.length || 0));
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
      } catch {
        // 忽略光标恢复错误
      }
    }
  };

  // 手动同步备注内容
  const handleSyncNotes = useCallback(async () => {
    if (!notesTextareaRef.current) return;
    
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    
    const text = notesTextareaRef.current.textContent || '';
    const presetId = currentPresetIdRef.current;
    
    setIsSavingNotes(true);
    try {
      saveNotesToLocalStorage(text, presetId);
      const config = getStorageConfig();
      if (config.enabled) {
        await saveNotesToFile(text, presetId);
      }
    } catch (error) {
      console.error('同步备注失败:', error);
    } finally {
      setIsSavingNotes(false);
    }
  }, []);

  // 备注内容变化时自动保存
  const handleNotesInput = useCallback((text: string) => {
    const presetId = currentPresetIdRef.current;
    
    saveNotesToLocalStorage(text, presetId);
    
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    
    saveTimerRef.current = setTimeout(async () => {
      const config = getStorageConfig();
      if (config.enabled) {
        setIsSavingNotes(true);
        try {
          await saveNotesToFile(text, presetId);
        } catch (error) {
          console.error('保存备注到文件失败:', error);
        } finally {
          setIsSavingNotes(false);
        }
      }
      saveTimerRef.current = null;
    }, 1000);
  }, []);

  // 显示的历史记录
  const displayedHistory = useMemo(() => {
    if (isExpanded) return history;
    return history.slice(0, 4);
  }, [history, isExpanded]);

  // 复制到剪贴板
  const handleCopy = async (item: NamingHistoryItem) => {
    try {
      await navigator.clipboard.writeText(item.finalName);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error('复制失败:', error);
    }
  };

  // 删除单条记录
  const handleDelete = (id: string) => {
    const newHistory = history.filter(item => item.id !== id);
    setHistory(newHistory);
    const key = getHistoryKey(currentPresetId);
    if (newHistory.length > 0) {
      localStorage.setItem(key, JSON.stringify(newHistory));
    } else {
      localStorage.removeItem(key);
    }
  };

  // 清空所有记录
  const handleClearAll = () => {
    if (window.confirm('确定要清空所有历史记录吗？此操作不可恢复。')) {
      setHistory([]);
      const key = getHistoryKey(currentPresetId);
      localStorage.removeItem(key);
    }
  };

  // 拖拽调整高度
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;
      
      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();
      const containerHeight = containerRect.height;
      const mouseY = e.clientY - containerRect.top;
      const newTopHeight = (mouseY / containerHeight) * 100;
      
      const clampedHeight = Math.max(20, Math.min(80, newTopHeight));
      setTopHeight(clampedHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  const maxNotesHeight = 30 * 24;

  return (
    <div ref={containerRef} className="h-full flex flex-col gap-1 bg-[#0a0a0a]">
      {/* 上半部分：备注功能 */}
      <div 
        className="flex flex-col bg-[#0f0f0f] rounded-xl border border-[#1a1a1a] overflow-hidden"
        style={{ height: `${topHeight}%`, minHeight: '150px', maxHeight: '80%' }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a] shrink-0">
          <div className="flex items-center gap-2">
            <FileText className="text-blue-400" size={16} />
            <span className="text-sm font-medium text-white">备注</span>
          </div>
          <div className="flex items-center gap-2">
            {isSavingNotes && (
              <span className="text-xs text-[#555555]">保存中...</span>
            )}
            <button
              onClick={handleSyncNotes}
              className="p-1.5 text-[#666666] hover:text-blue-400 hover:bg-[#1a1a1a] rounded-lg transition-colors"
              title="立即同步保存"
            >
              <RefreshCw size={14} className={isSavingNotes ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        <div className="flex-1 p-4 overflow-hidden min-h-0">
          <div
            ref={notesTextareaRef}
            contentEditable
            onBlur={(e) => {
              const text = e.currentTarget.textContent || '';
              if (text.match(URL_REGEX)) {
                updateContentWithLinks(e.currentTarget, text);
              }
            }}
            onInput={(e) => {
              const text = e.currentTarget.textContent || '';
              handleNotesInput(text);
            }}
            onPaste={(e) => {
              e.preventDefault();
              const text = e.clipboardData.getData('text/plain');
              document.execCommand('insertText', false, text);
            }}
            onMouseDown={async (e) => {
              const target = e.target as HTMLElement;
              if (target.tagName === 'A') {
                e.preventDefault();
                const url = (target as HTMLAnchorElement).href;
                if (url) {
                  await openUrl(url, '_blank');
                }
              }
            }}
            className="
              w-full h-full
              bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg
              p-3 text-sm text-[#e0e0e0]
              focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50
              font-mono leading-relaxed overflow-y-auto
              placeholder-[#555555]
            "
            style={{ 
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: `${maxNotesHeight}px`,
            }}
            data-placeholder="在此输入备注信息，支持换行和URL链接..."
            suppressContentEditableWarning={true}
          />
          <style dangerouslySetInnerHTML={{__html: `
            [contenteditable][data-placeholder]:empty:before {
              content: attr(data-placeholder);
              color: #555555;
              pointer-events: none;
            }
            [contenteditable] a {
              color: #60a5fa;
              text-decoration: underline;
              cursor: pointer;
            }
            [contenteditable] a:hover {
              color: #93c5fd;
            }
          `}} />
        </div>
      </div>

      {/* 可拖拽的分隔条 */}
      <div
        onMouseDown={handleMouseDown}
        className={`
          h-1 rounded-full mx-2
          bg-[#2a2a2a] hover:bg-blue-500/50 
          transition-colors shrink-0
          ${isResizing ? 'bg-blue-500' : ''}
        `}
        style={{ cursor: 'row-resize', userSelect: 'none' }}
        title="拖拽调整高度"
      />

      {/* 下半部分：简化的历史记录列表 */}
      <div 
        className="flex flex-col bg-[#0f0f0f] rounded-xl border border-[#1a1a1a] overflow-hidden"
        style={{ height: `${100 - topHeight}%`, minHeight: '150px' }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a] shrink-0">
          <div className="flex items-center gap-2">
            <HistoryIcon className="text-purple-400" size={16} />
            <span className="text-sm font-medium text-white">命名记录</span>
            {history.length > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#1a1a1a] text-[#666666]">
                {history.length}
              </span>
            )}
          </div>
          {history.length > 0 && (
            <button
              onClick={handleClearAll}
              className="text-xs text-[#666666] hover:text-red-400 transition-colors"
              title="清空所有记录"
            >
              清空
            </button>
          )}
        </div>
        <div 
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto p-4"
          style={{ scrollbarWidth: 'thin' }}
        >
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-12 h-12 rounded-full bg-[#1a1a1a] flex items-center justify-center mb-3">
                <HistoryIcon className="text-[#333333]" size={24} />
              </div>
              <p className="text-[#666666] text-sm mb-1">暂无历史记录</p>
              <p className="text-[#444444] text-xs">生成的命名将自动保存到这里</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {displayedHistory.map((item) => (
                  <div
                    key={item.id}
                    className="
                      relative
                      bg-[#0a0a0a] border border-[#2a2a2a]
                      hover:border-[#3a3a3a]
                      rounded-lg p-3
                      transition-all group
                    "
                  >
                    {/* 复制成功反馈 */}
                    {copiedId === item.id && (
                      <div className="absolute inset-0 rounded-lg bg-green-500/90 flex items-center justify-center text-white text-xs font-medium z-10">
                        <Check size={14} className="mr-1" />
                        已复制
                      </div>
                    )}
                    
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <code className="text-sm font-mono font-medium text-blue-400 break-all block">
                          {item.finalName}
                        </code>
                        {item.chineseName && (
                          <div className="text-[11px] text-[#555555] mt-1 line-clamp-2">
                            // {item.chineseName}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleCopy(item)}
                          className="p-1.5 rounded text-[#666666] hover:text-blue-400 hover:bg-[#1a1a1a] transition-colors"
                          title="复制"
                        >
                          <Copy size={12} />
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="p-1.5 rounded text-[#666666] hover:text-red-400 hover:bg-[#1a1a1a] transition-colors"
                          title="删除"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              {/* 展开/收起按钮 */}
              {history.length > 4 && (
                <div className="mt-3 flex justify-center">
                  <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="
                      text-xs text-[#666666] hover:text-white
                      px-4 py-2
                      bg-[#0a0a0a] hover:bg-[#1a1a1a]
                      border border-[#2a2a2a]
                      rounded-lg transition-colors
                    "
                  >
                    {isExpanded ? `收起 (${history.length - 4} 条已隐藏)` : `查看更多 (${history.length - 4} 条)`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default NamingHistory;
