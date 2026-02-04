import React from 'react';

/** 骨架块 - 带 shimmer 动画 */
const SkeletonBlock: React.FC<{
  className?: string;
  style?: React.CSSProperties;
}> = ({ className = '', style }) => (
  <div className={`skeleton-shimmer rounded bg-[#1a1a1a] ${className}`} style={style} />
);

/** 骨架屏变体类型 - 与各页面布局对应 */
export type SkeletonVariant =
  | 'home'
  | 'naming'
  | 'paths'
  | 'todo'
  | 'apps'
  | 'ai'
  | 'whiteboard'
  | 'default';

const SkeletonBlockMemo = React.memo(SkeletonBlock);

/** 首页骨架 - 分区 + 卡片网格 */
const SkeletonHome: React.FC = () => (
  <div className="flex-1 flex flex-col min-h-0 bg-[#0a0a0a]">
    <div className="flex-1 overflow-y-auto p-6" style={{ scrollbarWidth: 'thin' }}>
      <div className="space-y-8">
        {/* AI工作流区域 */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <SkeletonBlockMemo className="w-5 h-5 rounded" />
            <SkeletonBlockMemo className="h-4 w-24" />
            <SkeletonBlockMemo className="h-5 w-8 rounded" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-[#1a1a1a] rounded-xl overflow-hidden p-4">
                <SkeletonBlockMemo className="w-full aspect-video rounded-lg mb-3" />
                <SkeletonBlockMemo className="h-4 w-3/4 mb-2" />
                <SkeletonBlockMemo className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        </div>
        {/* 常用路径区域 */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <SkeletonBlockMemo className="w-5 h-5 rounded" />
            <SkeletonBlockMemo className="h-4 w-20" />
            <SkeletonBlockMemo className="h-5 w-8 rounded" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-[#1a1a1a]">
                <SkeletonBlockMemo className="w-10 h-10 rounded-lg shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                  <SkeletonBlockMemo className="h-4 w-2/3" />
                  <SkeletonBlockMemo className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>
);

/** 资产命名骨架 - 左右两栏 */
const SkeletonNaming: React.FC = () => (
  <div className="flex-1 flex flex-col min-h-0 bg-[#0a0a0a]">
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full p-6 min-h-0">
      {/* 左栏 - 命名工具 */}
      <div className="flex flex-col gap-4">
        <div className="flex gap-2 mb-2">
          <SkeletonBlockMemo className="h-9 w-32 rounded-lg" />
          <SkeletonBlockMemo className="h-9 w-24 rounded-lg" />
        </div>
        <SkeletonBlockMemo className="h-10 w-full rounded-lg" />
        <SkeletonBlockMemo className="h-24 w-full rounded-lg" />
        <div className="grid grid-cols-2 gap-2">
          <SkeletonBlockMemo className="h-9 rounded-lg" />
          <SkeletonBlockMemo className="h-9 rounded-lg" />
        </div>
        <SkeletonBlockMemo className="h-32 flex-1 min-h-[120px] rounded-lg" />
      </div>
      {/* 右栏 - 命名历史 */}
      <div className="hidden lg:flex flex-col">
        <SkeletonBlockMemo className="h-6 w-24 mb-4" />
        <div className="space-y-3 flex-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-3 p-3 rounded-lg bg-[#1a1a1a]">
              <SkeletonBlockMemo className="h-4 flex-1" />
              <SkeletonBlockMemo className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

/** 常用入口骨架 - 顶部栏 + 分组列表 */
const SkeletonPaths: React.FC = () => (
  <div className="flex-1 flex flex-col min-h-0 bg-[#0a0a0a]">
    <div className="flex items-center justify-between p-6 border-b border-[#1a1a1a] shrink-0">
      <div className="flex gap-2">
        <SkeletonBlockMemo className="h-10 w-24 rounded-lg" />
        <SkeletonBlockMemo className="h-10 w-20 rounded-lg" />
      </div>
      <div className="flex gap-2">
        <SkeletonBlockMemo className="h-10 w-28 rounded-lg" />
        <SkeletonBlockMemo className="h-10 w-10 rounded-lg" />
      </div>
    </div>
    <div className="flex-1 overflow-y-auto p-6" style={{ scrollbarWidth: 'thin' }}>
      <div className="space-y-6">
        {Array.from({ length: 3 }).map((_, gi) => (
          <div key={gi}>
            <div className="flex items-center gap-2 mb-3">
              <SkeletonBlockMemo className="h-5 w-4 rounded" />
              <SkeletonBlockMemo className="h-5 w-28" />
            </div>
            <div className="space-y-2 pl-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-2">
                  <SkeletonBlockMemo className="w-8 h-8 rounded-lg shrink-0" />
                  <div className="flex-1 space-y-1">
                    <SkeletonBlockMemo className="h-4 w-40" />
                    <SkeletonBlockMemo className="h-3 w-64" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

/** 待办工作骨架 - 顶部栏 + 四象限 */
const SkeletonTodo: React.FC = () => (
  <div className="flex-1 flex flex-col min-h-0 bg-[#0a0a0a]">
    <div className="flex items-center justify-between p-6 border-b border-[#1a1a1a] shrink-0">
      <SkeletonBlockMemo className="h-6 w-24" />
      <SkeletonBlockMemo className="h-10 w-28 rounded-lg" />
    </div>
    <div className="flex-1 grid grid-cols-2 gap-4 p-6 overflow-auto min-h-0">
      {['重要且紧急', '重要不紧急', '紧急不重要', '不紧急不重要'].map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-[#2a2a2a] bg-[#0f0f0f] p-4 flex flex-col min-h-[180px]"
        >
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#2a2a2a]">
            <SkeletonBlockMemo className="h-5 w-24" />
            <SkeletonBlockMemo className="h-6 w-12 rounded" />
          </div>
          <div className="space-y-2 flex-1">
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="flex gap-2 items-center p-2 rounded bg-[#1a1a1a]">
                <SkeletonBlockMemo className="w-4 h-4 rounded shrink-0" />
                <SkeletonBlockMemo className="h-4 flex-1" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
);

/** 常用应用骨架 - 顶部栏 + 应用卡片网格 */
const SkeletonApps: React.FC = () => (
  <div className="flex-1 flex flex-col min-h-0 bg-[#0a0a0a]">
    <div className="flex items-center justify-between p-6 border-b border-[#1a1a1a] shrink-0">
      <SkeletonBlockMemo className="h-6 w-24" />
      <div className="flex gap-2">
        <SkeletonBlockMemo className="h-10 w-24 rounded-lg" />
        <SkeletonBlockMemo className="h-10 w-28 rounded-lg" />
      </div>
    </div>
    <div
      className="flex-1 min-h-0 overflow-y-auto px-6 py-6"
      style={{ scrollbarWidth: 'thin' }}
    >
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
      >
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-4 flex flex-col items-center gap-3"
          >
            <SkeletonBlockMemo className="w-16 h-16 rounded-lg shrink-0" />
            <SkeletonBlockMemo className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

/** AI工作流骨架 - 与首页类似 */
const SkeletonAi: React.FC = () => <SkeletonHome />;

/** 无限画布骨架 - 顶部工具栏 + 画布区域 */
const SkeletonWhiteboard: React.FC = () => (
  <div className="flex-1 flex flex-col min-h-0 bg-[#0a0a0a]">
    <div className="flex items-center justify-between p-4 border-b border-[#1a1a1a] shrink-0">
      <div className="flex gap-2">
        <SkeletonBlockMemo className="h-10 w-40 rounded-lg" />
        <SkeletonBlockMemo className="h-10 w-24 rounded-lg" />
      </div>
      <div className="flex gap-2">
        <SkeletonBlockMemo className="h-10 w-16 rounded-lg" />
        <SkeletonBlockMemo className="h-10 w-16 rounded-lg" />
        <SkeletonBlockMemo className="h-10 w-16 rounded-lg" />
        <SkeletonBlockMemo className="h-10 w-16 rounded-lg" />
      </div>
    </div>
    <div className="flex-1 relative min-h-0">
      <div className="absolute inset-0 bg-[#0f0f0f] flex items-center justify-center">
        <SkeletonBlockMemo className="w-64 h-8 rounded" />
      </div>
    </div>
  </div>
);

/** 默认骨架 - 通用布局 */
const SkeletonDefault: React.FC = () => (
  <div className="flex-1 flex flex-col min-h-0 bg-[#0a0a0a]">
    <div className="flex items-center justify-between p-6 border-b border-[#1a1a1a] shrink-0">
      <SkeletonBlockMemo className="h-6 w-32" />
      <SkeletonBlockMemo className="h-10 w-24 rounded-lg" />
    </div>
    <div className="flex-1 overflow-y-auto p-6" style={{ scrollbarWidth: 'thin' }}>
      <div className="space-y-4 max-w-3xl">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-4 p-4 border-b border-[#2a2a2a]">
            <SkeletonBlockMemo className="w-10 h-10 rounded-full shrink-0" />
            <div className="flex-1 space-y-3">
              <SkeletonBlockMemo className="h-4 w-3/5" />
              <SkeletonBlockMemo className="h-3 w-full" />
              <SkeletonBlockMemo className="h-3 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const VARIANT_MAP: Record<string, React.FC> = {
  home: SkeletonHome,
  naming: SkeletonNaming,
  paths: SkeletonPaths,
  todo: SkeletonTodo,
  apps: SkeletonApps,
  ai: SkeletonAi,
  whiteboard: SkeletonWhiteboard,
  default: SkeletonDefault,
};

/**
 * 骨架屏 - 按页面变体匹配实际布局
 * @param variant 页面类型，与 activeTab 对应
 */
export const SkeletonScreen: React.FC<{ variant?: SkeletonVariant | string }> = ({
  variant = 'default',
}) => {
  const Component = VARIANT_MAP[variant] || VARIANT_MAP.default;
  return <Component />;
};

/**
 * 内容淡入包装器 - 骨架屏到真实内容的过渡
 */
export const ContentFadeIn: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="animate-skeleton-fade-in flex-1 flex flex-col min-h-0">{children}</div>
);
