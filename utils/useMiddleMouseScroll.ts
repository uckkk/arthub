// 鼠标中键滚动工具 Hook
import { useEffect, useRef } from 'react';

interface UseMiddleMouseScrollOptions {
  enabled?: boolean;
  scrollSpeed?: number;
}

/**
 * 鼠标中键滚动 Hook
 * 允许用户按住鼠标中键并移动鼠标来滚动内容
 */
export function useMiddleMouseScroll<T extends HTMLElement>(
  options: UseMiddleMouseScrollOptions = {}
): React.RefObject<T> {
  const { enabled = true, scrollSpeed = 1 } = options;
  const elementRef = useRef<T>(null);
  const isScrolling = useRef(false);
  const lastPosition = useRef({ x: 0, y: 0 });
  const scrollVelocity = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!enabled || !elementRef.current) return;

    const element = elementRef.current;

    const handleMouseDown = (e: MouseEvent) => {
      // 检查是否是鼠标中键（button === 1）
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        isScrolling.current = true;
        lastPosition.current = { x: e.clientX, y: e.clientY };
        scrollVelocity.current = { x: 0, y: 0 };
        
        // 改变鼠标样式
        element.style.cursor = 'grabbing';
        element.style.userSelect = 'none';
        
        // 阻止默认的鼠标中键行为（打开链接等）
        return false;
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isScrolling.current) return;

      e.preventDefault();
      e.stopPropagation();

      const deltaX = e.clientX - lastPosition.current.x;
      const deltaY = e.clientY - lastPosition.current.y;

      // 计算滚动速度
      scrollVelocity.current = {
        x: deltaX * scrollSpeed,
        y: deltaY * scrollSpeed,
      };

      // 执行滚动
      if (element) {
        element.scrollLeft -= scrollVelocity.current.x;
        element.scrollTop -= scrollVelocity.current.y;
      }

      lastPosition.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (isScrolling.current && e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        isScrolling.current = false;
        
        // 恢复鼠标样式
        element.style.cursor = '';
        element.style.userSelect = '';
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      // 如果正在使用中键滚动，阻止右键菜单
      if (isScrolling.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // 监听全局鼠标事件（因为鼠标可能移出元素）
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('contextmenu', handleContextMenu);

    // 清理函数
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('contextmenu', handleContextMenu);
      
      // 恢复样式
      if (element) {
        element.style.cursor = '';
        element.style.userSelect = '';
      }
    };
  }, [enabled, scrollSpeed]);

  return elementRef;
}
