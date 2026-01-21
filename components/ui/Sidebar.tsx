import React, { useState } from 'react';
import { LucideIcon, GripVertical } from 'lucide-react';

// 菜单项类型
export interface MenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
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
      <nav className="flex-1 overflow-y-auto py-4 px-3">
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

                return (
                  <div
                    key={item.id}
                    draggable={onReorder !== undefined}
                    onDragStart={(e) => {
                      if (onReorder) {
                        setDraggedItem({ groupIndex, itemIndex });
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', item.id);
                      }
                    }}
                    onDragOver={(e) => {
                      if (onReorder && draggedItem && draggedItem.groupIndex === groupIndex) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = 'move';
                        setDragOverIndex({ groupIndex, itemIndex });
                      }
                    }}
                    onDragLeave={() => {
                      if (dragOverIndex?.groupIndex === groupIndex && dragOverIndex?.itemIndex === itemIndex) {
                        setDragOverIndex(null);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (onReorder && draggedItem && draggedItem.groupIndex === groupIndex) {
                        onReorder(groupIndex, draggedItem.itemIndex, itemIndex);
                        setDraggedItem(null);
                        setDragOverIndex(null);
                      }
                    }}
                    onDragEnd={() => {
                      setDraggedItem(null);
                      setDragOverIndex(null);
                    }}
                    className={`
                      ${isDragging ? 'opacity-50' : ''}
                      ${isDragOver ? 'border-t-2 border-blue-500' : ''}
                    `}
                  >
                    <button
                      onClick={() => onSelect(item.id)}
                      className={`
                        w-full flex items-center gap-3 px-3 py-2.5 rounded-lg
                        text-[14px] font-medium
                        transition-all duration-150
                        ${isActive 
                          ? 'bg-[#1a1a1a] text-white' 
                          : 'text-[#808080] hover:bg-[#151515] hover:text-[#a0a0a0]'
                        }
                      `}
                    >
                      {onReorder && (
                        <GripVertical 
                          size={14} 
                          className="text-[#666666] cursor-move flex-shrink-0"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                          }}
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
