import React from 'react';
import { ChevronRight, ChevronDown, Check, Star, Pencil, Copy, Trash2, Tag as TagIcon, Folder, Globe, Server, Play } from 'lucide-react';
import { PathItem, PathType } from '../types';

const S_L = '/';

const OPACITY_CLASSES = {
  bgGreen50090: 'bg-green-500' + S_L + '90',
  bgRed50010: 'hover:bg-red-500' + S_L + '10',
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
        className="w-4 h-4 object-contain"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }
  switch (item.type) {
    case 'app': return <Play size={16} className="text-green-400" />;
    case 'web': return <Globe size={16} className="text-cyan-400" />;
    case 'network': return <Server size={16} className="text-purple-400" />;
    case 'local': return <Folder size={16} className="text-orange-400" />;
  }
};

interface PathGroupItemProps {
  groupName: string;
  groupIndex: number;
  items: PathItem[];
  isCollapsed: boolean;
  columnsPerRow: number;
  copiedId: string | null;
  justFavoritedId: string | null;
  isFavorited: (id: string) => boolean;
  showDivider: boolean;
  onToggleGroup: () => void;
  onJump: (item: PathItem) => void;
  onAddToFavorites: (item: PathItem, e: React.MouseEvent) => void;
  onEdit: (item: PathItem, e: React.MouseEvent) => void;
  onCopy: (item: PathItem, e: React.MouseEvent) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}

export const PathGroupItem: React.FC<PathGroupItemProps> = ({
  groupName,
  groupIndex,
  items,
  isCollapsed,
  columnsPerRow,
  copiedId,
  justFavoritedId,
  isFavorited,
  showDivider,
  onToggleGroup,
  onJump,
  onAddToFavorites,
  onEdit,
  onCopy,
  onDelete,
}) => {
  return (
    <React.Fragment key={groupName}>
      {showDivider && <div className="my-3 border-t border-[#2a2a2a]" />}
      <div className="space-y-1" data-group-name={groupName}>
        <div onClick={onToggleGroup} className="flex items-center gap-2 px-2 py-1 rounded-lg cursor-pointer select-none text-[#808080] hover:text-white hover:bg-[#1a1a1a] transition-all duration-150">
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span className="text-[11px] font-medium uppercase tracking-wider">{groupName}</span>
          <span className={['px-1.5 py-0.5 rounded text-[10px] font-medium', 'bg-[#1a1a1a] text-[#666666]'].join(' ')}>{items.length}</span>
        </div>
        {!isCollapsed && (
          <div className={[columnsPerRow === 1 ? 'space-y-2' : 'grid gap-2.5'].filter(Boolean).join(' ')} style={columnsPerRow > 1 ? { gridTemplateColumns: `repeat(${columnsPerRow}, minmax(0, 1fr))` } : undefined}>
            {items.map((item, index) => {
              return (
                <div key={item.id} onClick={() => onJump(item)} className={['group relative bg-[#1a1a1a] hover:bg-[#222222]', 'border border-[#2a2a2a] hover:border-[#3a3a3a]', 'rounded px-2.5 py-2.5 flex items-center gap-2', 'cursor-pointer transition-all duration-150', columnsPerRow > 1 ? 'min-w-0' : ''].filter(Boolean).join(' ')}>
                  {copiedId === item.id && (
                    <div className={'absolute inset-0 rounded ' + OPACITY_CLASSES.bgGreen50090 + ' flex items-center justify-center text-white text-xs font-medium animate-fade-in z-20'}>
                      <Check size={12} className="mr-1" />
                      已复制
                    </div>
                  )}
                  <div className={'p-1 rounded bg-[#0f0f0f] group-hover:bg-[#151515] transition-colors flex items-center justify-center shrink-0'}>{getIcon(item)}</div>
                  <span className={'flex-1 min-w-0 text-[12px] font-medium text-white group-hover:text-blue-400 transition-colors truncate'} title={item.name}>{item.name}</span>
                  {isFavorited(item.id) && (
                    <Star size={9} fill="currentColor" className="text-yellow-400 shrink-0" />
                  )}
                  {columnsPerRow <= 2 && item.tags && item.tags.length > 0 && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      {item.tags.slice(0, 1).map((tag, tagIndex) => {
                        const color = getTagColor(tag);
                        return (
                          <span key={tagIndex} className={'px-1 py-px rounded text-[8px] font-medium whitespace-nowrap ' + color.bg + ' ' + color.text} title={tag}>{tag}</span>
                        );
                      })}
                      {item.tags.length > 1 && <span className="text-[8px] text-[#555]">+{item.tags.length - 1}</span>}
                    </div>
                  )}
                  <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 hidden group-hover:flex items-center gap-0.5 bg-[#222] border border-[#3a3a3a] rounded-md px-1 py-0.5 shadow-lg z-30" onClick={(e) => e.stopPropagation()}>
                    <button onClick={(e) => { e.stopPropagation(); onAddToFavorites(item, e); }} className={['p-1 rounded transition-all duration-150', isFavorited(item.id) ? 'text-yellow-400' : 'text-[#888] hover:text-yellow-400', justFavoritedId === item.id ? 'scale-125' : ''].filter(Boolean).join(' ')} title={isFavorited(item.id) ? "取消收藏" : "收藏"}>
                      <Star size={12} fill={isFavorited(item.id) ? "currentColor" : "none"} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onEdit(item, e); }} className="p-1 rounded text-[#888] hover:text-white hover:bg-[#333] transition-colors" title="编辑">
                      <Pencil size={12} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onCopy(item, e); }} className="p-1 rounded text-[#888] hover:text-white hover:bg-[#333] transition-colors" title="复制路径">
                      <Copy size={12} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onDelete(item.id, e); }} className={'p-1 rounded text-[#888] hover:text-red-400 ' + OPACITY_CLASSES.bgRed50010 + ' transition-colors'} title="删除">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </React.Fragment>
  );
};
