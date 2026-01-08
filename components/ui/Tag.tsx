import React from 'react';

// 预定义的标签类型和颜色
export type TagType = 
  | 'product' 
  | 'api' 
  | 'replacement' 
  | 'image' 
  | 'video' 
  | 'design' 
  | 'workflow'
  | 'template'
  | 'custom';

interface TagProps {
  children: React.ReactNode;
  type?: TagType;
  color?: string; // 自定义颜色 (用于 custom 类型)
  className?: string;
  onClick?: () => void;
}

// 标签颜色映射
const tagStyles: Record<TagType, { bg: string; text: string }> = {
  product: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  api: { bg: 'bg-teal-500/20', text: 'text-teal-400' },
  replacement: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
  image: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  video: { bg: 'bg-green-500/20', text: 'text-green-400' },
  design: { bg: 'bg-pink-500/20', text: 'text-pink-400' },
  workflow: { bg: 'bg-cyan-500/20', text: 'text-cyan-400' },
  template: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  custom: { bg: 'bg-gray-500/20', text: 'text-gray-400' },
};

export const Tag: React.FC<TagProps> = ({ 
  children, 
  type = 'custom', 
  color,
  className = '',
  onClick
}) => {
  const style = tagStyles[type];
  
  // 如果有自定义颜色
  const customStyle = color ? {
    backgroundColor: `${color}20`,
    color: color,
  } : undefined;

  return (
    <span
      onClick={onClick}
      className={`
        inline-flex items-center px-2 py-0.5 rounded text-xs font-medium
        ${!customStyle ? `${style.bg} ${style.text}` : ''}
        ${onClick ? 'cursor-pointer hover:opacity-80' : ''}
        transition-opacity duration-150
        ${className}
      `}
      style={customStyle}
    >
      {children}
    </span>
  );
};

export default Tag;
