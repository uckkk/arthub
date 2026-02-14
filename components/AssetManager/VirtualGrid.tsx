import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';

export interface VirtualGridProps<T> {
  items: T[];
  columnCount: number;
  rowHeight: number;
  gap: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  keyExtractor: (item: T) => string | number;
  overscan?: number;
  onEndReached?: () => void;
  endReachedThreshold?: number;
  className?: string;
}

export default function VirtualGrid<T>({
  items,
  columnCount,
  rowHeight,
  gap,
  renderItem,
  keyExtractor,
  overscan = 4,
  onEndReached,
  endReachedThreshold = 500,
  className = '',
}: VirtualGridProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const endReachedRef = useRef(false);

  // 计算布局参数
  const totalRows = Math.ceil(items.length / columnCount);
  const cellHeight = rowHeight + gap;
  const totalHeight = totalRows * cellHeight - gap; // 最后一行不需要 gap

  // ResizeObserver 监听容器高度变化
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    setContainerHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // 滚动处理
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const st = e.currentTarget.scrollTop;
    setScrollTop(st);

    // 触底加载
    if (onEndReached) {
      const distanceToEnd = totalHeight - st - containerHeight;
      if (distanceToEnd < endReachedThreshold && !endReachedRef.current) {
        endReachedRef.current = true;
        onEndReached();
      } else if (distanceToEnd >= endReachedThreshold) {
        endReachedRef.current = false;
      }
    }
  }, [totalHeight, containerHeight, endReachedThreshold, onEndReached]);

  // 计算可见行范围
  const visibleItems = useMemo(() => {
    if (containerHeight === 0) return [];

    const startRow = Math.max(0, Math.floor(scrollTop / cellHeight) - overscan);
    const endRow = Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / cellHeight) + overscan);

    const result: { item: T; index: number; row: number; col: number }[] = [];
    for (let row = startRow; row < endRow; row++) {
      for (let col = 0; col < columnCount; col++) {
        const index = row * columnCount + col;
        if (index < items.length) {
          result.push({ item: items[index], index, row, col });
        }
      }
    }
    return result;
  }, [items, scrollTop, containerHeight, columnCount, cellHeight, totalRows, overscan]);

  // 计算列宽（百分比方式，容器自适应）
  const colWidthPercent = 100 / columnCount;

  return (
    <div
      ref={containerRef}
      className={`overflow-y-auto overflow-x-hidden ${className}`}
      onScroll={handleScroll}
      style={{ height: '100%', willChange: 'transform' }}
    >
      <div
        style={{
          height: Math.max(totalHeight, 0),
          position: 'relative',
          width: '100%',
        }}
      >
        {visibleItems.map(({ item, index, row, col }) => (
          <div
            key={keyExtractor(item)}
            style={{
              position: 'absolute',
              top: row * cellHeight,
              left: `calc(${col * colWidthPercent}% + ${col > 0 ? gap / 2 : 0}px)`,
              width: `calc(${colWidthPercent}% - ${gap * (columnCount - 1) / columnCount}px)`,
              height: rowHeight,
              contain: 'layout style paint',
            }}
          >
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    </div>
  );
}
