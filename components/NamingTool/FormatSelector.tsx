/**
 * 格式选择器组件
 * 用于选择命名格式（大小写、分隔符）
 */

import React from 'react';

interface FormatSelectorProps {
  caseFormat: 'pascal' | 'camel' | 'lower';
  separatorFormat: 'underscore' | 'hyphen' | 'none';
  onCaseFormatChange: (format: 'pascal' | 'camel' | 'lower') => void;
  onSeparatorFormatChange: (format: 'underscore' | 'hyphen' | 'none') => void;
  disabled?: boolean;
}

export const FormatSelector: React.FC<FormatSelectorProps> = ({
  caseFormat,
  separatorFormat,
  onCaseFormatChange,
  onSeparatorFormatChange,
  disabled = false,
}) => {
  return (
    <div className="flex gap-2">
      <select
        value={caseFormat}
        onChange={(e) => onCaseFormatChange(e.target.value as 'pascal' | 'camel' | 'lower')}
        disabled={disabled}
        className="
          bg-[#0f0f0f] border border-[#2a2a2a]
          rounded-lg px-3 py-2
          text-sm text-white
          focus:outline-none focus:border-blue-500
          cursor-pointer
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-colors
        "
        title="大小写格式"
      >
        <option value="pascal" className="bg-[#1a1a1a] text-white">大驼峰</option>
        <option value="camel" className="bg-[#1a1a1a] text-white">小驼峰</option>
        <option value="lower" className="bg-[#1a1a1a] text-white">全小写</option>
      </select>
      <select
        value={separatorFormat}
        onChange={(e) => onSeparatorFormatChange(e.target.value as 'underscore' | 'hyphen' | 'none')}
        disabled={disabled}
        className="
          bg-[#0f0f0f] border border-[#2a2a2a]
          rounded-lg px-3 py-2
          text-sm text-white
          focus:outline-none focus:border-blue-500
          cursor-pointer
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-colors
        "
        title="分隔符格式"
      >
        <option value="underscore" className="bg-[#1a1a1a] text-white">下划线</option>
        <option value="hyphen" className="bg-[#1a1a1a] text-white">中划线</option>
        <option value="none" className="bg-[#1a1a1a] text-white">无划线</option>
      </select>
    </div>
  );
};
