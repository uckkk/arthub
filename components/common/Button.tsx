/**
 * 统一的按钮组件 - ComfyUI 风格
 */

import React from 'react';
import { LucideIcon } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  loading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconPosition = 'left',
  fullWidth = false,
  loading = false,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles = `
    inline-flex items-center justify-center gap-2
    font-medium rounded-lg
    transition-all duration-150
    focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#0a0a0a]
    disabled:opacity-50 disabled:cursor-not-allowed
  `;

  const variantStyles = {
    primary: `
      bg-blue-600 text-white
      hover:bg-blue-700 active:bg-blue-800
      focus:ring-blue-500/50
    `,
    secondary: `
      bg-[#1a1a1a] text-[#a0a0a0] border border-[#2a2a2a]
      hover:text-white hover:border-[#3a3a3a] hover:bg-[#222222]
      focus:ring-[#3a3a3a]
    `,
    danger: `
      bg-red-600/20 text-red-400 border border-red-600/30
      hover:bg-red-600/30 hover:text-red-300
      focus:ring-red-500/50
    `,
    ghost: `
      text-[#808080]
      hover:text-white hover:bg-[#1a1a1a]
      focus:ring-[#3a3a3a]
    `,
  };

  const sizeStyles = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  const iconSize = {
    sm: 14,
    md: 16,
    lg: 18,
  };

  return (
    <button
      className={`
        ${baseStyles}
        ${variantStyles[variant]}
        ${sizeStyles[size]}
        ${fullWidth ? 'w-full' : ''}
        ${className}
      `}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        <>
          {Icon && iconPosition === 'left' && <Icon size={iconSize[size]} />}
          {children}
          {Icon && iconPosition === 'right' && <Icon size={iconSize[size]} />}
        </>
      )}
    </button>
  );
};
