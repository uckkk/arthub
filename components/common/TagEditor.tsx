import React, { useState, useRef, useEffect } from 'react';
import { X, Plus, Tag as TagIcon } from 'lucide-react';

interface TagEditorProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  suggestions?: string[]; // 建议标签列表
  maxTags?: number; // 最大标签数量
  className?: string;
}

/**
 * 标签编辑组件（全局样式组件）
 * 支持添加、删除标签，以及从建议列表中选择
 */
export const TagEditor: React.FC<TagEditorProps> = ({
  tags = [],
  onChange,
  placeholder = '输入标签后按回车添加',
  suggestions = [],
  maxTags = 10,
  className = '',
}) => {
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 过滤建议标签（排除已添加的标签）
  useEffect(() => {
    if (inputValue.trim()) {
      const filtered = suggestions.filter(
        (suggestion) =>
          suggestion.toLowerCase().includes(inputValue.toLowerCase()) &&
          !tags.includes(suggestion)
      );
      setFilteredSuggestions(filtered.slice(0, 5)); // 最多显示5个建议
      setShowSuggestions(filtered.length > 0);
    } else {
      setFilteredSuggestions([]);
      setShowSuggestions(false);
    }
  }, [inputValue, suggestions, tags]);

  // 点击外部关闭建议列表
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault();
      addTag(inputValue.trim());
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      // 删除最后一个标签
      removeTag(tags.length - 1);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      inputRef.current?.blur();
    }
  };

  const addTag = (tag: string) => {
    if (!tag || tags.includes(tag)) return;
    if (tags.length >= maxTags) return;
    
    onChange([...tags, tag]);
    setInputValue('');
    setShowSuggestions(false);
  };

  const removeTag = (index: number) => {
    const newTags = tags.filter((_, i) => i !== index);
    onChange(newTags);
  };

  const handleSuggestionClick = (suggestion: string) => {
    addTag(suggestion);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* 标签显示区域 */}
      <div className="
        min-h-[44px] w-full px-3 py-2 rounded-lg
        bg-[#0f0f0f] border border-[#2a2a2a]
        focus-within:border-blue-500
        transition-colors
        flex flex-wrap gap-1.5 items-center
      ">
        {/* 已添加的标签 */}
        {tags.map((tag, index) => (
          <span
            key={index}
            className="
              inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md
              bg-blue-500/20 text-blue-400 border border-blue-500/30
              text-xs font-medium
            "
          >
            <TagIcon size={12} />
            {tag}
            <button
              onClick={() => removeTag(index)}
              className="
                ml-0.5 p-0.5 rounded hover:bg-blue-500/30
                transition-colors
              "
              type="button"
            >
              <X size={12} />
            </button>
          </span>
        ))}

        {/* 输入框 */}
        {tags.length < maxTags && (
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleInputKeyDown}
            onFocus={() => {
              if (filteredSuggestions.length > 0) {
                setShowSuggestions(true);
              }
            }}
            placeholder={tags.length === 0 ? placeholder : ''}
            className="
              flex-1 min-w-[120px] bg-transparent
              text-white placeholder-[#666666]
              outline-none text-sm
            "
          />
        )}

        {/* 标签数量提示 */}
        {tags.length >= maxTags && (
          <span className="text-xs text-[#666666]">
            已达到最大标签数（{maxTags}）
          </span>
        )}
      </div>

      {/* 建议标签下拉列表 */}
      {showSuggestions && filteredSuggestions.length > 0 && (
        <div className="
          absolute top-full left-0 right-0 mt-1 z-50
          bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg
          shadow-lg shadow-black/50
          max-h-[200px] overflow-y-auto
        ">
          {filteredSuggestions.map((suggestion, index) => (
            <button
              key={index}
              onClick={() => handleSuggestionClick(suggestion)}
              className="
                w-full px-4 py-2.5 text-left text-sm
                text-[#a0a0a0] hover:bg-[#222222] hover:text-white
                transition-colors
                flex items-center gap-2
              "
            >
              <TagIcon size={14} className="text-blue-400" />
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {/* 提示文本 */}
      {tags.length === 0 && !inputValue && (
        <p className="text-[11px] text-[#666666] mt-1.5">
          输入标签后按回车添加，最多 {maxTags} 个标签
        </p>
      )}
    </div>
  );
};

export default TagEditor;
