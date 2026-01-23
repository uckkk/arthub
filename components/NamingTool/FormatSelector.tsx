/**
 * 格式选择器组件
 * 用于选择命名格式（大小写、分隔符）
 */

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

interface DropdownProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  title?: string;
}

// 单个下拉框组件（与 FilterDropdown 样式一致）
const Dropdown: React.FC<DropdownProps> = ({ options, value, onChange, disabled, title }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 计算下拉菜单的最大高度
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const buttonRect = buttonRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - buttonRect.bottom - 4; // 4px 是 mt-1 的间距
      
      // 计算每个选项的高度（大约 40px，包括 padding）
      const itemHeight = 40;
      const contentHeight = options.length * itemHeight;
      
      // 如果内容高度小于可用空间，不限制高度；否则限制为可用空间
      if (contentHeight <= spaceBelow) {
        setMaxHeight(undefined);
      } else {
        // 至少显示一个选项，最多显示到视口底部
        setMaxHeight(Math.max(itemHeight, Math.min(spaceBelow, contentHeight)));
      }
    }
  }, [isOpen, options.length]);

  const selectedOption = options.find(opt => opt.value === value);

  return (
    <div ref={dropdownRef} className="relative" title={title}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          flex items-center gap-2 px-3 py-2
          bg-[#0f0f0f] border border-[#2a2a2a] rounded-lg
          text-white hover:border-[#3a3a3a]
          transition-all duration-150
          min-w-[90px]
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        <span className="flex-1 text-left text-sm">
          {selectedOption?.label || '选择'}
        </span>
        <ChevronDown 
          size={14} 
          className={`text-[#666666] transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div 
          ref={menuRef}
          className="
            absolute top-full left-0 mt-1 w-full min-w-[100px]
            bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg
            shadow-lg shadow-black/50
            z-50 overflow-hidden
            animate-scale-in
          "
          style={{ 
            scrollbarWidth: 'thin', 
            scrollbarColor: '#2a2a2a #1a1a1a',
            ...(maxHeight !== undefined ? { maxHeight: `${maxHeight}px`, overflowY: 'auto' } : {})
          }}
          onWheel={(e) => {
            // 阻止滚动事件冒泡到父容器
            e.stopPropagation();
          }}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`
                w-full flex items-center gap-2 px-3 py-2
                text-sm text-left
                transition-colors duration-150
                ${option.value === value 
                  ? 'bg-[#252525] text-white' 
                  : 'text-[#a0a0a0] hover:bg-[#222222] hover:text-white'
                }
              `}
            >
              <span className="flex-1">{option.label}</span>
              {option.value === value && (
                <Check size={12} className="text-blue-400" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

interface FormatSelectorProps {
  caseFormat: 'pascal' | 'camel' | 'lower';
  separatorFormat: 'underscore' | 'hyphen' | 'none';
  onCaseFormatChange: (format: 'pascal' | 'camel' | 'lower') => void;
  onSeparatorFormatChange: (format: 'underscore' | 'hyphen' | 'none') => void;
  disabled?: boolean;
}

const caseOptions = [
  { value: 'pascal', label: '大驼峰' },
  { value: 'camel', label: '小驼峰' },
  { value: 'lower', label: '全小写' },
];

const separatorOptions = [
  { value: 'underscore', label: '下划线' },
  { value: 'hyphen', label: '中划线' },
  { value: 'none', label: '无划线' },
];

export const FormatSelector: React.FC<FormatSelectorProps> = ({
  caseFormat,
  separatorFormat,
  onCaseFormatChange,
  onSeparatorFormatChange,
  disabled = false,
}) => {
  return (
    <div className="flex gap-2">
      <Dropdown
        options={caseOptions}
        value={caseFormat}
        onChange={(v) => onCaseFormatChange(v as 'pascal' | 'camel' | 'lower')}
        disabled={disabled}
        title="大小写格式"
      />
      <Dropdown
        options={separatorOptions}
        value={separatorFormat}
        onChange={(v) => onSeparatorFormatChange(v as 'underscore' | 'hyphen' | 'none')}
        disabled={disabled}
        title="分隔符格式"
      />
    </div>
  );
};
