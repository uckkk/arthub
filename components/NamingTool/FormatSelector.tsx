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
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(opt => opt.value === value);

  return (
    <div ref={dropdownRef} className="relative" title={title}>
      <button
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
          className="
            absolute top-full left-0 mt-1 w-full min-w-[100px]
            bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg
            shadow-lg shadow-black/50
            z-50 overflow-hidden
            animate-scale-in
            max-h-[300px] overflow-y-auto
          "
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#2a2a2a #1a1a1a' }}
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
