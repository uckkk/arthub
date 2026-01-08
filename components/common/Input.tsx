/**
 * 统一的输入框组件 - ComfyUI 风格
 */

import React from 'react';
import { LucideIcon } from 'lucide-react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: LucideIcon;
  fullWidth?: boolean;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  hint,
  icon: Icon,
  fullWidth = true,
  className = '',
  ...props
}) => {
  return (
    <div className={`${fullWidth ? 'w-full' : ''}`}>
      {label && (
        <label className="block text-sm font-medium text-[#a0a0a0] mb-2">
          {label}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <Icon 
            size={18} 
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#666666]" 
          />
        )}
        <input
          className={`
            w-full px-4 py-2.5 rounded-lg
            bg-[#0f0f0f] border
            ${error ? 'border-red-500' : 'border-[#2a2a2a]'}
            text-white placeholder-[#666666]
            transition-all duration-150
            focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
            disabled:opacity-50 disabled:cursor-not-allowed
            ${Icon ? 'pl-10' : ''}
            ${className}
          `}
          {...props}
        />
      </div>
      {error && (
        <p className="mt-1.5 text-sm text-red-400">{error}</p>
      )}
      {hint && !error && (
        <p className="mt-1.5 text-sm text-[#666666]">{hint}</p>
      )}
    </div>
  );
};

// 文本域组件
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  fullWidth?: boolean;
}

export const Textarea: React.FC<TextareaProps> = ({
  label,
  error,
  hint,
  fullWidth = true,
  className = '',
  ...props
}) => {
  return (
    <div className={`${fullWidth ? 'w-full' : ''}`}>
      {label && (
        <label className="block text-sm font-medium text-[#a0a0a0] mb-2">
          {label}
        </label>
      )}
      <textarea
        className={`
          w-full px-4 py-2.5 rounded-lg resize-none
          bg-[#0f0f0f] border
          ${error ? 'border-red-500' : 'border-[#2a2a2a]'}
          text-white placeholder-[#666666]
          transition-all duration-150
          focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
          disabled:opacity-50 disabled:cursor-not-allowed
          ${className}
        `}
        {...props}
      />
      {error && (
        <p className="mt-1.5 text-sm text-red-400">{error}</p>
      )}
      {hint && !error && (
        <p className="mt-1.5 text-sm text-[#666666]">{hint}</p>
      )}
    </div>
  );
};
