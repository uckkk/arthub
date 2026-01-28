import React from 'react';
import { ChevronRight, ChevronDown, Check, Star, Pencil, Copy, ExternalLink, Trash2, Tag as TagIcon, Folder, Globe, Server, Play } from 'lucide-react';
import { PathItem, PathType } from '../types';

const S_L = '/';

const OPACITY_CLASSES = {
  bgGreen50090: 'bg-green-500' + S_L + '90',
  bgRed50010: 'hover:bg-red-500' + S_L + '10',
  borderWhite30: 'border-white' + S_L + '30',
  bgWhite5: 'bg-white' + S_L + '5',
} as const;

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

interface PathGroupItemProps {
  groupName: string;
  groupIndex: number;
  items: PathItem[];
  isCollapsed: boolean;
  columnsPerRow: number;
  draggedGroup: string | null;
  dragOverGroup: string | null;
  draggedItem: PathItem | null;
  dragOverIndex: number | null;
  copiedId: string | null;
  justFavoritedId: string | null;
  isDragging: boolean;
  isFavorited: (id: string) => boolean;
  isLastGroup: boolean;
  showDivider: boolean;
  showInsertBefore: boolean;
  onToggleGroup: () => void;
  onDragStartGroup: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragStart: (item: PathItem, e: React.DragEvent) => void;
  onDragOver: (groupName: string, index: number, e: React.DragEvent) => void;
  onDrop: (index: number, e: React.DragEvent) => void;
  onJump: (item: PathItem) => void;
  onAddToFavorites: (item: PathItem, e: React.MouseEvent) => void;
  onEdit: (item: PathItem, e: React.MouseEvent) => void;
  onCopy: (item: PathItem, e: React.MouseEvent) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onInsertBeforeDrop: (e: React.DragEvent) => void;
  onLastGroupDrop: (e: React.DragEvent) => void;
}

export const PathGroupItem: React.FC<PathGroupItemProps> = ({
  groupName,
  groupIndex,
  items,
  isCollapsed,
  columnsPerRow,
  draggedGroup,
  dragOverGroup,
  draggedItem,
  dragOverIndex,
  copiedId,
  justFavoritedId,
  isDragging,
  isFavorited,
  isLastGroup,
  showDivider,
  showInsertBefore,
  onToggleGroup,
  onDragStartGroup,
  onDragEnd,
  onDragStart,
  onDragOver,
  onDrop,
  onJump,
  onAddToFavorites,
  onEdit,
  onCopy,
  onDelete,
  onInsertBeforeDrop,
  onLastGroupDrop,
}) => {
  return (
    <React.Fragment key={groupName}>
      {showDivider && <div className="my-4 border-t border-[#2a2a2a]" />}
      {showInsertBefore && (
        <div className="h-1 bg-blue-500 rounded-full mx-2 my-1" onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; }} onDrop={onInsertBeforeDrop} />
      )}
      <div className="space-y-2" data-group-name={groupName} onDragOver={(e) => { if (draggedGroup && draggedGroup !== groupName) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; } }} onDrop={(e) => { if (draggedGroup && draggedGroup !== groupName) { e.preventDefault(); e.stopPropagation(); if (onInsertBeforeDrop) { onInsertBeforeDrop(e); } } }}>
        <div draggable={true} data-drag-group={groupName} onDragStart={onDragStartGroup} onDragEnd={onDragEnd} onDragOver={(e) => { if (draggedGroup && draggedGroup !== groupName) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; } }} onDrop={(e) => { if (draggedGroup && draggedGroup !== groupName) { e.preventDefault(); e.stopPropagation(); if (onInsertBeforeDrop) { onInsertBeforeDrop(e); } } }} onClick={(e) => { if (isDragging || draggedGroup) { e.preventDefault(); e.stopPropagation(); return; } onToggleGroup(); }} className={['flex items-center gap-2 px-2 py-1.5 rounded-lg', 'cursor-move select-none', 'text-[#808080] hover:text-white hover:bg-[#1a1a1a]', 'transition-all duration-150', draggedGroup === groupName ? 'opacity-50 scale-95' : '', dragOverGroup === groupName && draggedGroup && draggedGroup !== groupName ? 'border-2 ' + OPACITY_CLASSES.borderWhite30 + ' ' + OPACITY_CLASSES.bgWhite5 : ''].filter(Boolean).join(' ')}>
          {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          <span className="text-xs font-medium uppercase tracking-wider">{groupName}</span>
          <span className={['px-1.5 py-0.5 rounded text-[10px] font-medium', 'bg-[#1a1a1a] text-[#666666]'].join(' ')}>{items.length}</span>
        </div>
        {!isCollapsed && (
          <div className={['ml-2', columnsPerRow === 1 ? 'space-y-1.5' : 'grid gap-3'].filter(Boolean).join(' ')} style={columnsPerRow > 1 ? { gridTemplateColumns: `repeat(${columnsPerRow}, minmax(0, 1fr))` } : undefined} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (draggedItem) { onDragOver(groupName, items.length, e); } }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDrop(items.length, e); }}>
            {items.map((item, index) => {
              return (
                <div key={item.id} draggable={true} onDragStart={(e) => { onDragStart(item, e); }} onDragOver={(e) => { onDragOver(groupName, index, e); }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDrop(index, e); }} onDragEnd={onDragEnd} onClick={(e) => { if (isDragging || draggedItem) { e.preventDefault(); e.stopPropagation(); return; } onJump(item); }} className={['group relative bg-[#1a1a1a] hover:bg-[#222222]', 'border border-[#2a2a2a] hover:border-[#3a3a3a]', 'rounded-lg p-3 flex items-start gap-3', 'cursor-pointer transition-all duration-150', draggedItem?.id === item.id ? 'opacity-50' : '', dragOverGroup === groupName && dragOverIndex === index ? 'border-blue-500' : '', columnsPerRow > 1 ? 'min-w-0' : ''].filter(Boolean).join(' ')}>
                  {copiedId === item.id && (
                    <div className={'absolute inset-0 rounded-lg ' + OPACITY_CLASSES.bgGreen50090 + ' flex items-center justify-center text-white text-sm font-medium animate-fade-in z-20'}>
                      <Check size={16} className="mr-2" />
                      已复制到剪贴板
                    </div>
                  )}
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <div className={'p-2 rounded-lg bg-[#0f0f0f] group-hover:bg-[#151515] transition-colors flex items-center justify-center'}>{getIcon(item)}</div>
                    <button onClick={(e) => { e.stopPropagation(); onAddToFavorites(item, e); }} className={['p-1 rounded transition-all duration-150', isFavorited(item.id) ? 'text-yellow-400 opacity-100' : 'text-[#666666] opacity-0 group-hover:opacity-100 hover:text-yellow-400', justFavoritedId === item.id ? 'scale-125' : ''].filter(Boolean).join(' ')} title={isFavorited(item.id) ? "取消收藏" : "添加到收藏"}>
                      <Star size={12} fill={isFavorited(item.id) ? "currentColor" : "none"} />
                    </button>
                  </div>
                  <div className={columnsPerRow > 1 ? 'flex-1 min-w-0 overflow-hidden' : 'flex-1 min-w-0'}>
                    <h3 className={'text-[14px] font-medium text-white group-hover:text-blue-400 transition-colors break-words'} title={item.name}>{item.name}</h3>
                    {item.tags && item.tags.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap mt-2">
                        {item.tags.map((tag, tagIndex) => {
                          const color = getTagColor(tag);
                          const tagClassName = 'inline-flex items-center gap-1 px-2 py-0.5 rounded ' + color.bg + ' ' + color.text + ' border ' + color.border + ' text-[10px] font-medium whitespace-nowrap';
                          return (
                            <span key={tagIndex} className={tagClassName} title={tag}>
                              <TagIcon size={10} />
                              {tag}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); onEdit(item, e); }} className="p-1.5 rounded text-[#666666] hover:text-white hover:bg-[#2a2a2a] transition-colors" title="编辑">
                      <Pencil size={13} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onCopy(item, e); }} className="p-1.5 rounded text-[#666666] hover:text-white hover:bg-[#2a2a2a] transition-colors" title="复制路径">
                      <Copy size={13} />
                    </button>
                    {item.type === 'web' && <ExternalLink size={13} className="text-[#444444] mx-0.5" />}
                    <button onClick={(e) => { e.stopPropagation(); onDelete(item.id, e); }} className={'p-1.5 rounded text-[#666666] hover:text-red-400 ' + OPACITY_CLASSES.bgRed50010 + ' transition-colors'} title="删除">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {isLastGroup && draggedGroup && draggedGroup !== groupName && !dragOverGroup && (
        <div className="h-1 bg-blue-500 rounded-full mx-2 my-1" onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; }} onDrop={onLastGroupDrop} />
      )}
    </React.Fragment>
  );
};
