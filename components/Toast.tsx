/**
 * Toast 通知组件 - ComfyUI 风格
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextType {
  showToast: (type: ToastType, message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((type: ToastType, message: string, duration = 3000) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    const newToast: Toast = { id, type, message, duration };
    
    setToasts(prev => [...prev, newToast]);
    
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
};

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onRemove }) => {
  return (
    <div className="fixed top-4 right-4 z-[9999] space-y-2 pointer-events-none">
      {toasts.map((toast, index) => (
        <ToastItem 
          key={toast.id} 
          toast={toast} 
          onRemove={onRemove}
          index={index}
        />
      ))}
    </div>
  );
};

interface ToastItemProps {
  toast: Toast;
  onRemove: (id: string) => void;
  index: number;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onRemove, index }) => {
  const icons = {
    success: <CheckCircle size={18} className="text-green-400" />,
    error: <XCircle size={18} className="text-red-400" />,
    warning: <AlertCircle size={18} className="text-amber-400" />,
    info: <Info size={18} className="text-blue-400" />,
  };

  const borderColors = {
    success: 'border-l-green-500',
    error: 'border-l-red-500',
    warning: 'border-l-amber-500',
    info: 'border-l-blue-500',
  };

  return (
    <div
      className={`
        bg-[#1a1a1a] border border-[#2a2a2a] ${borderColors[toast.type]}
        border-l-[3px] rounded-lg
        shadow-xl shadow-black/40
        flex items-center gap-3 
        min-w-[320px] max-w-[450px]
        px-4 py-3
        pointer-events-auto
        animate-slide-up
      `}
      style={{ 
        animationDelay: `${index * 50}ms`,
        animationFillMode: 'both'
      }}
    >
      {icons[toast.type]}
      <p className="flex-1 text-[13px] text-[#e0e0e0] leading-relaxed">
        {toast.message}
      </p>
      <button
        onClick={() => onRemove(toast.id)}
        className="
          p-1 rounded
          text-[#666666] hover:text-white hover:bg-[#252525]
          transition-colors duration-150
        "
      >
        <X size={14} />
      </button>
    </div>
  );
};
