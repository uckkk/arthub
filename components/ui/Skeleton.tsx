import React, { useState, useCallback, useEffect, useRef, CSSProperties } from 'react';

const SHIMMER = 'skeleton-shimmer rounded bg-[#1a1a1a]';

export const Skeleton: React.FC<{
  className?: string;
  style?: CSSProperties;
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full';
}> = ({ className = '', style, rounded }) => {
  const rc = rounded === 'full' ? 'rounded-full'
    : rounded === 'xl' ? 'rounded-xl'
    : rounded === 'lg' ? 'rounded-lg'
    : rounded === 'sm' ? 'rounded-sm'
    : rounded === 'none' ? 'rounded-none' : '';
  return <div className={[SHIMMER, rc, className].filter(Boolean).join(' ')} style={style} />;
};

export const SkeletonCircle: React.FC<{
  size?: number; className?: string;
}> = ({ size = 40, className = '' }) => (
  <div
    className={[SHIMMER, 'rounded-full shrink-0', className].filter(Boolean).join(' ')}
    style={{ width: size, height: size }}
  />
);

export const SkeletonText: React.FC<{
  lines?: number; className?: string; lastLineWidth?: number;
}> = ({ lines = 3, className = '', lastLineWidth = 0.6 }) => (
  <div className={'space-y-2 ' + className}>
    {Array.from({ length: lines }).map((_, i) => (
      <div
        key={i}
        className={SHIMMER}
        style={{ height: 12, width: i === lines - 1 ? (lastLineWidth * 100) + '%' : '100%' }}
      />
    ))}
  </div>
);

export const SkeletonImage: React.FC<{
  src: string;
  alt?: string;
  className?: string;
  imgClassName?: string;
  skeletonClassName?: string;
  style?: CSSProperties;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
  draggable?: boolean;
  onLoad?: () => void;
  onError?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
  fadeDuration?: number;
  children?: React.ReactNode;
  /** Content to show when image fails to load */
  fallback?: React.ReactNode;
}> = ({
  src, alt = '', className = '', imgClassName = '', skeletonClassName = '',
  style, loading = 'lazy', decoding = 'async', draggable = true,
  onLoad, onError, fadeDuration = 300, children, fallback,
}) => {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => { setLoaded(false); setErrored(false); }, [src]);
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) setLoaded(true);
  }, [src]);

  const handleLoad = useCallback(() => { setLoaded(true); onLoad?.(); }, [onLoad]);
  const handleError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    setErrored(true); onError?.(e);
  }, [onError]);

  return (
    <div className={'relative overflow-hidden ' + className} style={style}>
      {!loaded && !errored && (
        <div className={['skeleton-shimmer bg-[#1a1a1a] absolute inset-0', skeletonClassName].join(' ')} />
      )}
      {errored && fallback ? (
        <div className="w-full h-full flex items-center justify-center">{fallback}</div>
      ) : !errored ? (
        <img
          ref={imgRef} src={src} alt={alt} className={imgClassName}
          loading={loading} decoding={decoding} draggable={draggable}
          onLoad={handleLoad} onError={handleError}
          style={{
            opacity: loaded ? 1 : 0,
            transition: 'opacity ' + fadeDuration + 'ms ease-in-out',
            contentVisibility: 'auto',
          }}
        />
      ) : null}
      {children}
    </div>
  );
};

export const SkeletonCard: React.FC<{
  thumbHeight?: number; className?: string;
}> = ({ thumbHeight = 140, className = '' }) => (
  <div className={'bg-[#111] rounded-lg overflow-hidden ' + className}>
    <Skeleton className="w-full rounded-none" style={{ height: thumbHeight }} />
    <div className="p-2 space-y-1.5">
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-2.5 w-1/2" />
    </div>
  </div>
);

export const SkeletonMasonryGrid: React.FC<{
  columns?: number; items?: number; gap?: number; className?: string;
}> = ({ columns = 4, items = 12, gap = 12, className = '' }) => {
  const heights = React.useMemo(() => {
    const h: number[] = [];
    for (let i = 0; i < items; i++) h.push(100 + ((i * 73 + 37) % 120));
    return h;
  }, [items]);

  const cols = React.useMemo(() => {
    const c: { h: number; idx: number }[][] = Array.from({ length: columns }, () => []);
    const ch = new Array(columns).fill(0);
    for (let i = 0; i < items; i++) {
      const s = ch.indexOf(Math.min(...ch));
      c[s].push({ h: heights[i], idx: i });
      ch[s] += heights[i] + gap + 36;
    }
    return c;
  }, [columns, items, heights, gap]);

  return (
    <div className={'flex ' + className} style={{ gap }}>
      {cols.map((col, ci) => (
        <div key={ci} className="flex-1 flex flex-col" style={{ gap }}>
          {col.map(({ h, idx }) => (
            <div key={idx}>
              <Skeleton className="w-full rounded-lg" style={{ height: h }} />
              <div className="mt-1 px-0.5 space-y-1">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export const SkeletonList: React.FC<{
  rows?: number; className?: string; showIcon?: boolean;
}> = ({ rows = 5, className = '', showIcon = true }) => (
  <div className={'space-y-2 ' + className}>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-[#111]">
        {showIcon && <SkeletonCircle size={32} />}
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3" style={{ width: (60 + (i * 17 % 30)) + '%' }} />
          <Skeleton className="h-2.5 w-1/3" />
        </div>
      </div>
    ))}
  </div>
);

export const SkeletonDetailPanel: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={'w-72 flex flex-col ' + className}>
    <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a1a1a]">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-3.5 w-3.5 rounded" />
    </div>
    <div className="p-3">
      <Skeleton className="w-full rounded-lg" style={{ height: 200 }} />
    </div>
    <div className="px-3 pb-3 space-y-2">
      <Skeleton className="h-3 w-4/5" />
      <Skeleton className="h-2.5 w-full" />
      <div className="flex gap-3 mt-2">
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="h-2.5 w-12" />
        <Skeleton className="h-2.5 w-20" />
      </div>
    </div>
    {[1, 2, 3].map(i => (
      <React.Fragment key={i}>
        <div className="border-t border-[#1a1a1a]" />
        <div className="px-3 py-3 space-y-2">
          <Skeleton className="h-3 w-20" />
          <div className="flex gap-1.5">
            {Array.from({ length: 3 }).map((_, j) => (
              <Skeleton key={j} className="h-5 w-12 rounded-full" />
            ))}
          </div>
        </div>
      </React.Fragment>
    ))}
  </div>
);

export const SkeletonPreview: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={'flex items-center justify-center ' + className}>
    <div className="w-64 h-64">
      <Skeleton className="w-full h-full rounded-lg" />
    </div>
  </div>
);

export const ContentTransition: React.FC<{
  loaded: boolean; skeleton: React.ReactNode; children: React.ReactNode;
  className?: string; duration?: number;
}> = ({ loaded, skeleton, children, className = '', duration = 300 }) => (
  <div className={'relative ' + className}>
    {!loaded && skeleton}
    <div
      style={{
        opacity: loaded ? 1 : 0,
        transition: 'opacity ' + duration + 'ms ease-in-out',
        pointerEvents: loaded ? 'auto' : 'none',
      }}
    >
      {loaded && children}
    </div>
  </div>
);

export default Skeleton;
