import React, { useState, useRef, useEffect } from 'react';
import { LucideIcon, GripVertical } from 'lucide-react';

// 菜单项类型
export interface MenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  draggable?: boolean; // 是否可拖动，默认 true
}

// 菜单分组类型
export interface MenuGroup {
  title?: string;
  items: MenuItem[];
}

interface SidebarProps {
  logo?: React.ReactNode;
  title?: string;
  groups: MenuGroup[];
  activeId: string;
  onSelect: (id: string) => void;
  onReorder?: (groupId: number, fromIndex: number, toIndex: number) => void;
  footer?: React.ReactNode;
  className?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  logo,
  title,
  groups,
  activeId,
  onSelect,
  onReorder,
  footer,
  className = '',
}) => {
  const [draggedItem, setDraggedItem] = useState<{ groupIndex: number; itemIndex: number } | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<{ groupIndex: number; itemIndex: number } | null>(null);
  const [pressedItem, setPressedItem] = useState<{ groupIndex: number; itemIndex: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ groupIndex: number; itemIndex: number; startY: number } | null>(null);
  const [dragStartState, setDragStartState] = useState<{ groupIndex: number; itemIndex: number; startY: number } | null>(null);

  // 处理鼠标移动事件，实现拖动排序
  useEffect(() => {
    // 只有当 dragStartState 有值时才添加事件监听器
    if (!dragStartState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dragStart = dragStartRef.current;
      if (!dragStart || !onReorder) return;

      const { groupIndex, itemIndex, startY } = dragStart;
      const currentY = e.clientY;
      const dy = currentY - startY;

      // 如果移动距离超过5px，确认是拖动操作
      if (Math.abs(dy) > 5) {
        if (!isDragging) {
          setIsDragging(true);
          setDraggedItem({ groupIndex, itemIndex });
        }

        // 查找当前鼠标位置下的菜单项
        const elements = document.elementsFromPoint(e.clientX, e.clientY);
        let targetItem: { groupIndex: number; itemIndex: number } | null = null;

        for (const el of elements) {
          const itemElement = el.closest('[data-menu-item]') as HTMLElement;
          if (itemElement) {
            const itemGroupIndex = parseInt(itemElement.dataset.groupIndex || '0');
            const itemItemIndex = parseInt(itemElement.dataset.itemIndex || '0');
            if (itemGroupIndex === groupIndex && itemItemIndex !== itemIndex) {
              targetItem = { groupIndex: itemGroupIndex, itemIndex: itemItemIndex };
              break;
            }
          }
        }

        if (targetItem) {
          setDragOverIndex(prev => {
            if (prev?.groupIndex !== targetItem?.groupIndex || prev?.itemIndex !== targetItem?.itemIndex) {
              return targetItem;
            }
            return prev;
          });
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      const dragStart = dragStartRef.current;
      if (dragStart && isDragging && draggedItem && dragOverIndex && onReorder) {
        const { groupIndex } = dragStart;
        if (dragOverIndex.groupIndex === groupIndex) {
          const fromIndex = draggedItem.itemIndex;
          const toIndex = dragOverIndex.itemIndex;
          if (fromIndex !== toIndex) {
            onReorder(groupIndex, fromIndex, toIndex);
          }
        }
      }

      // 清除拖动状态
      dragStartRef.current = null;
      setDragStartState(null);
      setIsDragging(false);
      setDraggedItem(null);
      setDragOverIndex(null);
      setPressedItem(null);
    };

    document.addEventListener('mousemove', handleMouseMove, { passive: false });
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragStartState, isDragging, draggedItem, dragOverIndex, onReorder]);

  return (
    <aside className={`
      flex flex-col h-full
      w-[220px] min-w-[220px]
      bg-[#0f0f0f] border-r border-[#1a1a1a]
      ${className}
    `}>
      {/* Logo 和标题 */}
      {(logo || title) && (
        <div className="flex items-center gap-3 px-5 py-5 border-b border-[#1a1a1a]">
          {logo}
          {title && (
            <span className="text-lg font-semibold text-white">{title}</span>
          )}
        </div>
      )}

      {/* 菜单内容 */}
      <nav 
        className="flex-1 overflow-y-auto py-4 px-3"
        onDragOver={(e) => {
          // 允许在整个菜单区域内拖拽
          if (onReorder && draggedItem) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {groups.map((group, groupIndex) => (
          <div key={groupIndex} className={groupIndex > 0 ? 'mt-6' : ''}>
            {/* 分组标题 */}
            {group.title && (
              <div className="
                px-3 py-2 mb-1
                text-[11px] font-medium text-[#666666]
                uppercase tracking-wider
              ">
                {group.title}
              </div>
            )}

            {/* 菜单项 */}
            <div className="space-y-1">
              {group.items.map((item, itemIndex) => {
                const Icon = item.icon;
                const isActive = activeId === item.id;
                const isDragging = draggedItem?.groupIndex === groupIndex && draggedItem?.itemIndex === itemIndex;
                const isDragOver = dragOverIndex?.groupIndex === groupIndex && dragOverIndex?.itemIndex === itemIndex;
                const isPressed = pressedItem?.groupIndex === groupIndex && pressedItem?.itemIndex === itemIndex;
                const isDraggable = onReorder !== undefined && (item.draggable !== false);

                return (
                  <div
                    key={item.id}
                    data-menu-item
                    data-group-index={groupIndex}
                    data-item-index={itemIndex}
                    className={`
                      ${isDragging && draggedItem?.groupIndex === groupIndex && draggedItem?.itemIndex === itemIndex ? 'opacity-50' : ''}
                      ${isDragOver ? 'border-t-2 border-blue-500' : ''}
                    `}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        // 如果正在拖动，阻止点击
                        if (isDragging || dragStartRef.current) {
                          e.preventDefault();
                          e.stopPropagation();
                          return;
                        }
                        onSelect(item.id);
                      }}
                      onMouseDown={(e) => {
                        if (isDraggable && e.button === 0) {
                          const target = e.target as HTMLElement;
                          // 如果点击的是拖动图标，立即开始拖动
                          if (target.closest('[data-drag-handle]')) {
                            e.preventDefault();
                            e.stopPropagation();
                            const dragInfo = { groupIndex, itemIndex, startY: e.clientY };
                            dragStartRef.current = dragInfo;
                            setDragStartState(dragInfo); // 触发 useEffect
                            setDraggedItem({ groupIndex, itemIndex });
                            setPressedItem({ groupIndex, itemIndex });
                          } else {
                            setPressedItem({ groupIndex, itemIndex });
                          }
                        }
                      }}
                      onMouseUp={() => {
                        // 如果不是拖动操作，清除 pressedItem
                        if (!dragStartRef.current) {
                          setPressedItem(null);
                        }
                      }}
                      onMouseLeave={() => {
                        // 如果不是拖动操作，清除 pressedItem
                        if (!dragStartRef.current) {
                          setPressedItem(null);
                        }
                      }}
                      className={`
                        w-full flex items-center gap-3 px-3 py-2.5 rounded-lg
                        text-[14px] font-medium
                        transition-all duration-150
                        ${isDragging && draggedItem?.groupIndex === groupIndex && draggedItem?.itemIndex === itemIndex ? 'cursor-move' : 'cursor-pointer'}
                        ${isActive 
                          ? 'bg-[#1a1a1a] text-white' 
                          : 'text-[#808080] hover:bg-[#151515] hover:text-[#a0a0a0]'
                        }
                      `}
                    >
                      {onReorder && isDraggable && (
                        <GripVertical 
                          size={14} 
                          data-drag-handle
                          className="text-[#444444] hover:text-[#666666] cursor-move flex-shrink-0 transition-colors"
                        />
                      )}
                      <Icon 
                        size={18} 
                        className={isActive ? 'text-blue-400' : ''} 
                      />
                      <span className="flex-1 text-left">{item.label}</span>
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className="
                          px-1.5 py-0.5 rounded text-[10px] font-medium
                          bg-blue-500/20 text-blue-400
                        ">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* 底部区域 */}
      {footer && (
        <div className="shrink-0 border-t border-[#1a1a1a] p-3">
          {footer}
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
