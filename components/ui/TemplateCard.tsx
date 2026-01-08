import React from 'react';
import { Image as ImageIcon, Play } from 'lucide-react';
import { Tag, TagType } from './Tag';

export interface TemplateTag {
  label: string;
  type: TagType;
}

interface TemplateCardProps {
  title: string;
  description?: string;
  thumbnail?: string;
  tags?: TemplateTag[];
  onClick?: () => void;
  onDoubleClick?: () => void;
  className?: string;
  showPlayButton?: boolean;
}

export const TemplateCard: React.FC<TemplateCardProps> = ({
  title,
  description,
  thumbnail,
  tags = [],
  onClick,
  onDoubleClick,
  className = '',
  showPlayButton = false,
}) => {
  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={`
        group relative
        bg-[#1a1a1a] rounded-xl overflow-hidden
        border border-[#2a2a2a]
        transition-all duration-200
        hover:border-[#3a3a3a] hover:bg-[#1f1f1f]
        hover:shadow-lg hover:shadow-black/30
        hover:-translate-y-0.5
        cursor-pointer
        ${className}
      `}
    >
      {/* 缩略图区域 */}
      <div className="relative aspect-[16/10] bg-[#0f0f0f] overflow-hidden">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={title}
            className="
              w-full h-full object-cover
              transition-transform duration-300
              group-hover:scale-105
            "
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon size={48} className="text-[#333333]" />
          </div>
        )}

        {/* 标签覆盖层 - 底部 */}
        {tags.length > 0 && (
          <div className="
            absolute bottom-2 left-2 right-2
            flex flex-wrap gap-1.5
          ">
            {tags.map((tag, index) => (
              <Tag 
                key={index} 
                type={tag.type}
                className="backdrop-blur-sm bg-opacity-90"
              >
                {tag.label}
              </Tag>
            ))}
          </div>
        )}

        {/* 播放按钮悬浮层 */}
        {showPlayButton && (
          <div className="
            absolute inset-0
            flex items-center justify-center
            bg-black/40 opacity-0 group-hover:opacity-100
            transition-opacity duration-200
          ">
            <div className="
              w-12 h-12 rounded-full
              bg-white/20 backdrop-blur-sm
              flex items-center justify-center
              border border-white/30
            ">
              <Play size={24} className="text-white ml-1" fill="white" />
            </div>
          </div>
        )}
      </div>

      {/* 内容区域 */}
      <div className="p-4">
        {/* 标题 */}
        <h3 className="
          text-[15px] font-medium text-white
          line-clamp-1
          group-hover:text-blue-400
          transition-colors duration-150
        ">
          {title}
        </h3>

        {/* 描述 */}
        {description && (
          <p className="
            mt-1.5 text-[13px] text-[#808080]
            line-clamp-2
            leading-relaxed
          ">
            {description}
          </p>
        )}
      </div>
    </div>
  );
};

export default TemplateCard;
