/**
 * 统一的模态框组件 - ComfyUI 风格
 */

import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  showCloseButton?: boolean;
  closeOnOverlayClick?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-4xl',
  full: 'max-w-full',
};

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  showCloseButton = true,
  closeOnOverlayClick = true,
  className = '',
}) => {
  // ESC 键关闭
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="
        fixed inset-0 z-50 
        flex items-center justify-center 
        bg-black/70 backdrop-blur-sm 
        p-4
      "
      onClick={closeOnOverlayClick ? onClose : undefined}
    >
      <div
        className={`
          bg-[#151515] border border-[#2a2a2a] rounded-xl
          shadow-2xl shadow-black/50
          w-full ${sizeClasses[size]}
          flex flex-col max-h-[90vh]
          animate-scale-in
          ${className}
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        {(title || showCloseButton) && (
          <div className="
            flex items-center justify-between 
            px-6 py-4 
            border-b border-[#2a2a2a]
            shrink-0
          ">
            {title && (
              <h3 className="text-lg font-semibold text-white">{title}</h3>
            )}
            {showCloseButton && (
              <button
                onClick={onClose}
                className="
                  p-1.5 rounded-lg
                  text-[#666666] hover:text-white hover:bg-[#252525]
                  transition-colors duration-150
                "
                title="关闭"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
};
