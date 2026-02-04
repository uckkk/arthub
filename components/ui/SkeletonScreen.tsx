import React from 'react';

/**
 * 知乎信息流风格骨架屏
 * 布局：头像 + 标题 + 两行正文
 * 含 Shimmer 扫光动画
 */
const SkeletonCard: React.FC = () => (
  <div className="flex gap-4 p-4 border-b border-[#2a2a2a]">
    {/* 头像 */}
    <div className="skeleton-shimmer flex-shrink-0 w-10 h-10 rounded-full bg-[#1a1a1a]" />
    {/* 内容区 */}
    <div className="flex-1 min-w-0 space-y-3">
      {/* 标题 */}
      <div className="skeleton-shimmer h-4 rounded bg-[#1a1a1a] w-3/5" />
      {/* 正文两行 */}
      <div className="skeleton-shimmer h-3 rounded bg-[#1a1a1a] w-full" />
      <div className="skeleton-shimmer h-3 rounded bg-[#1a1a1a] w-4/5" />
    </div>
  </div>
);

export const SkeletonScreen: React.FC = () => (
  <div className="h-full bg-[#0a0a0a] overflow-hidden">
    <div className="max-w-2xl mx-auto py-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  </div>
);

/**
 * 内容淡入包装器 - 骨架屏到真实内容的过渡
 */
export const ContentFadeIn: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="animate-skeleton-fade-in flex-1 flex flex-col min-h-0">{children}</div>
);
