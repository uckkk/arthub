/**
 * 传统模板组件（棋牌、通用RPG）
 * 从原 NamingTool.tsx 迁移的传统模板逻辑
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, ChevronDown, Check } from 'lucide-react';
import { SpecialSuffix, NamingSubType } from '../../types';
import { getPresetLabel } from '../../services/namingDataService';
import { usePresetLoader } from './hooks/usePresetLoader';
import { useTranslation } from './hooks/useTranslation';
import { formatName } from './utils/nameFormatter';
import { SpecialSuffixSelector } from './SpecialSuffixSelector';
import { NamingPreview } from './NamingPreview';
import { Input } from '../common';

interface TraditionalNamingToolProps {
  presetId: string;
  caseFormat: 'pascal' | 'camel' | 'lower';
  separatorFormat: 'underscore' | 'hyphen' | 'none';
  specialSuffixes: SpecialSuffix[];
}

// 分类下拉组件（与 FormatSelector 中的 Dropdown 样式一致）
interface CategoryDropdownProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const CategoryDropdown: React.FC<CategoryDropdownProps> = ({ options, value, onChange, disabled }) => {
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
    <div ref={dropdownRef} className="relative w-full">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          w-full flex items-center gap-2 px-3 py-2
          bg-[#0f0f0f] border border-[#2a2a2a] rounded-lg
          text-white hover:border-[#3a3a3a]
          transition-all duration-150
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
            absolute top-full left-0 mt-1 w-full
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

const TraditionalNamingTool: React.FC<TraditionalNamingToolProps> = ({
  presetId,
  caseFormat,
  separatorFormat,
  specialSuffixes,
}) => {
  const {
    preset,
    isLoading,
    error,
    selectedControlCategory,
    selectedAssetType,
    setSelectedControlCategory,
    setSelectedAssetType,
  } = usePresetLoader(presetId);

  const [rawInput, setRawInput] = useState('');
  const { translatedPart, isTranslating, needsApiSetup } = useTranslation(rawInput);
  const [finalName, setFinalName] = useState('');
  const [chineseName, setChineseName] = useState('');
  const [copied, setCopied] = useState(false);
  const [activeSuffixes, setActiveSuffixes] = useState<Set<string>>(new Set());

  const controlCategoryGroup = preset?.categories.find(c => c.id === 'control_categories');
  const assetTypeGroup = preset?.categories.find(c => c.id === 'asset_types');

  // 构建最终命名
  useEffect(() => {
    if (!preset) return;

    // 资产分类的前缀存储在suffix字段中，子类型/变体的后缀也存储在suffix字段中
    const rawPrefix = selectedControlCategory?.suffix || '';
    const rawSuffix = selectedAssetType?.suffix || '';
    
    let namePart = 'AssetName';
    
    if (rawInput.trim()) {
      if (translatedPart && !isTranslating) {
        namePart = translatedPart;
      } else if (translatedPart && isTranslating) {
        namePart = rawInput.replace(/\s+/g, '');
      } else {
        namePart = rawInput.replace(/\s+/g, '');
      }
    }

    // 应用格式选项到所有字段
    const formattedPrefix = rawPrefix ? formatName(rawPrefix, caseFormat, separatorFormat) : '';
    const rawSuffixClean = rawSuffix ? rawSuffix.replace(/^_/, '') : '';
    const formattedSuffix = rawSuffixClean ? formatName(rawSuffixClean, caseFormat, separatorFormat) : '';
    const formattedNamePart = formatName(namePart, caseFormat, separatorFormat);

    // 构建特殊后缀部分
    const specialSuffixParts = Array.from(activeSuffixes)
      .map(id => specialSuffixes.find(s => s.id === id))
      .filter((s): s is SpecialSuffix => s !== undefined)
      .map(s => {
        const formattedSuffix = formatName(s.suffix, caseFormat, separatorFormat);
        // 棋牌模板中Ns前面不加下划线，其它模板加下划线
        if (presetId === 'fgui_card' && s.suffix === 'Ns') {
          return formattedSuffix;
        }
        return `_${formattedSuffix}`;
      })
      .join('');

    // 确定各部分之间的分隔符
    let separator = '_';
    if (separatorFormat === 'hyphen') {
      separator = '-';
    } else if (separatorFormat === 'none') {
      separator = '';
    }

    // 构建最终名称
    const parts: string[] = [];
    if (formattedPrefix) parts.push(formattedPrefix);
    if (formattedSuffix) parts.push(formattedSuffix);
    if (formattedNamePart) parts.push(formattedNamePart);
    
    const mainName = parts.join(separator);
    const final = `${mainName}${specialSuffixParts}`;
    setFinalName(final);
    
    // 生成中文命名
    const chineseParts: string[] = [];
    if (selectedControlCategory) {
      chineseParts.push(selectedControlCategory.label);
    }
    if (selectedAssetType) {
      chineseParts.push(selectedAssetType.label);
    }
    if (rawInput.trim() && /[\u4e00-\u9fa5]/.test(rawInput)) {
      chineseParts.push(rawInput.trim());
    }
    Array.from(activeSuffixes).forEach(id => {
      const suffix = specialSuffixes.find(s => s.id === id);
      if (suffix) {
        chineseParts.push(suffix.label);
      }
    });
    
    setChineseName(chineseParts.length > 0 ? chineseParts.join('') : '');
  }, [selectedControlCategory, selectedAssetType, translatedPart, rawInput, isTranslating, activeSuffixes, caseFormat, separatorFormat, preset, presetId, specialSuffixes]);

  const handleCopy = useCallback((text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(err => {
      console.error('复制失败:', err);
    });
  }, []);

  const saveToHistory = useCallback(() => {
    if (!finalName.trim()) return;

    try {
      const historyItem = {
        id: `history_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        presetId: presetId,
        presetLabel: getPresetLabel(presetId),
        controlCategory: selectedControlCategory?.label,
        assetType: selectedAssetType?.label,
        rawInput: rawInput,
        translatedPart: translatedPart || undefined,
        finalName: finalName,
        chineseName: chineseName || undefined,
        caseFormat: caseFormat,
        separatorFormat: separatorFormat,
        specialSuffixes: Array.from(activeSuffixes),
      };

      const historyKey = `arthub_naming_history_${presetId}`;
      const saved = localStorage.getItem(historyKey);
      let history: typeof historyItem[] = [];
      
      if (saved) {
        try {
          history = JSON.parse(saved);
        } catch (error) {
          console.error('解析历史记录失败:', error);
          history = [];
        }
      }

      history.unshift(historyItem);
      if (history.length > 10) {
        history = history.slice(0, 10);
      }

      localStorage.setItem(historyKey, JSON.stringify(history));
    } catch (error) {
      console.error('保存历史记录失败:', error);
    }
  }, [finalName, presetId, selectedControlCategory, selectedAssetType, rawInput, translatedPart, chineseName, caseFormat, separatorFormat, activeSuffixes]);

  const toggleSpecialSuffix = (suffixId: string) => {
    const newActiveSuffixes = new Set(activeSuffixes);
    if (newActiveSuffixes.has(suffixId)) {
      newActiveSuffixes.delete(suffixId);
    } else {
      newActiveSuffixes.add(suffixId);
    }
    setActiveSuffixes(newActiveSuffixes);
  };

  if (isLoading) {
    return (
      <div className="text-center py-12 text-slate-400">
        <p>正在加载数据...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-400 text-sm">
        {error}
      </div>
    );
  }

  if (!preset) {
    return (
      <div className="text-center py-12 text-slate-400">
        <p>未找到预设数据</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 flex-1">
      {/* 资产分类和子类型/变体选择 */}
      {(controlCategoryGroup || assetTypeGroup) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 资产分类选择器 */}
          {controlCategoryGroup && (
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">资产分类</label>
              <CategoryDropdown
                options={controlCategoryGroup.subTypes?.map(sub => ({
                  value: sub.id,
                  label: sub.label,
                })) || []}
                value={selectedControlCategory?.id || ''}
                onChange={(id) => {
                  const selected = controlCategoryGroup.subTypes?.find(s => s.id === id);
                  if (selected) {
                    setSelectedControlCategory(selected);
                    localStorage.setItem(`arthub_${presetId}_control_category_id`, selected.id);
                  }
                }}
                disabled={!controlCategoryGroup.subTypes?.length}
              />
            </div>
          )}

          {/* 子类型/变体选择器 */}
          {assetTypeGroup && (
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">子类型 / 变体</label>
              <CategoryDropdown
                options={assetTypeGroup.subTypes?.map(sub => ({
                  value: sub.id,
                  label: sub.label,
                })) || []}
                value={selectedAssetType?.id || ''}
                onChange={(id) => {
                  const selected = assetTypeGroup.subTypes?.find(s => s.id === id);
                  if (selected) {
                    setSelectedAssetType(selected);
                    localStorage.setItem(`arthub_${presetId}_asset_type_id`, selected.id);
                  }
                }}
                disabled={!assetTypeGroup.subTypes?.length}
              />
            </div>
          )}
        </div>
      )}

      {/* 名称输入 */}
      <div>
        <label className="block text-sm font-medium text-slate-400 mb-2">
          名称 (中文/英文)
          {isTranslating && <span className="ml-2 text-blue-400 text-xs animate-pulse">翻译中...</span>}
        </label>
        <div className="relative">
          <Input
            type="text"
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            placeholder="例如：扑克牌 或 Poker"
          />
          {needsApiSetup && (
            <div className="mt-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-400 text-xs flex items-center justify-between">
              <span>检测到中文输入，需配置翻译 API 才能自动翻译</span>
              <button 
                onClick={() => {
                  // 触发设置面板打开 - 通过自定义事件
                  window.dispatchEvent(new CustomEvent('openSettings'));
                }}
                className="ml-2 px-2 py-1 bg-yellow-500/20 hover:bg-yellow-500/30 rounded text-yellow-300 transition-colors"
              >
                去配置
              </button>
            </div>
          )}
          {rawInput && (
            <button 
              onClick={() => setRawInput('')}
              className="absolute right-3 top-3 text-slate-500 hover:text-white"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* 特殊后缀选项 */}
      <SpecialSuffixSelector
        suffixes={specialSuffixes}
        activeSuffixes={activeSuffixes}
        onToggle={toggleSpecialSuffix}
        currentPresetId={presetId}
      />

      {/* 命名预览 */}
      <NamingPreview
        finalName={finalName}
        chineseName={chineseName}
        isTranslating={isTranslating}
        onCopy={() => {
          handleCopy(finalName);
          saveToHistory();
        }}
        copied={copied}
      />
    </div>
  );
};

export default TraditionalNamingTool;
