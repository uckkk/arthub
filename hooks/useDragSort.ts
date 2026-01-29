import { useState, useCallback, useRef } from 'react';

export interface DragSortItem {
  id: string;
  [key: string]: any;
}

export interface UseDragSortOptions<T extends DragSortItem> {
  items: T[];
  onReorder: (newItems: T[]) => void;
  enabled?: boolean;
}

export interface DragSortState {
  draggedIndex: number | null;
  dragOverIndex: number | null;
}

export interface DragSortHandlers {
  onDragStart: (index: number, e: React.DragEvent) => void;
  onDragOver: (index: number, e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (index: number, e: React.DragEvent) => void;
  onDragEnd: () => void;
}

/**
 * 通用的拖动排序 Hook
 * 用于实现列表项的拖动排序功能
 */
export function useDragSort<T extends DragSortItem>(
  options: UseDragSortOptions<T>
): [DragSortState, DragSortHandlers] {
  const { items, onReorder, enabled = true } = options;
  
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const draggedIndexRef = useRef<number | null>(null);

  const handleDragStart = useCallback((index: number, e: React.DragEvent) => {
    if (!enabled) {
      e.preventDefault();
      return;
    }
    
    draggedIndexRef.current = index;
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', items[index].id);
  }, [enabled, items]);

  const handleDragOver = useCallback((index: number, e: React.DragEvent) => {
    if (!enabled || draggedIndexRef.current === null) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    
    if (draggedIndexRef.current !== index) {
      setDragOverIndex(index);
    }
  }, [enabled]);

  const handleDragLeave = useCallback(() => {
    // 延迟清除，避免快速移动时闪烁
    setTimeout(() => {
      setDragOverIndex(null);
    }, 50);
  }, []);

  const handleDrop = useCallback((index: number, e: React.DragEvent) => {
    if (!enabled || draggedIndexRef.current === null) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    const fromIndex = draggedIndexRef.current;
    const toIndex = index;
    
    if (fromIndex !== toIndex && fromIndex !== null && toIndex !== null) {
      const newItems = [...items];
      const [removed] = newItems.splice(fromIndex, 1);
      newItems.splice(toIndex, 0, removed);
      onReorder(newItems);
    }
    
    setDraggedIndex(null);
    setDragOverIndex(null);
    draggedIndexRef.current = null;
  }, [enabled, items, onReorder]);

  const handleDragEnd = useCallback(() => {
    setTimeout(() => {
      setDraggedIndex(null);
      setDragOverIndex(null);
      draggedIndexRef.current = null;
    }, 100);
  }, []);

  return [
    { draggedIndex, dragOverIndex },
    {
      onDragStart: handleDragStart,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
      onDragEnd: handleDragEnd,
    }
  ];
}
