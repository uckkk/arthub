/**
 * 传统模板组件（棋牌、通用RPG）
 * 从原 NamingTool.tsx 迁移的传统模板逻辑
 */

import React, { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
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
  const { translatedPart, isTranslating } = useTranslation(rawInput);
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
              <select 
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                value={selectedControlCategory?.id || ''}
                onChange={(e) => {
                  const selected = controlCategoryGroup.subTypes?.find(s => s.id === e.target.value);
                  if (selected) {
                    setSelectedControlCategory(selected);
                    localStorage.setItem(`arthub_${presetId}_control_category_id`, selected.id);
                  }
                }}
                disabled={!controlCategoryGroup.subTypes?.length}
              >
                {controlCategoryGroup.subTypes?.map(sub => (
                  <option key={sub.id} value={sub.id}>{sub.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* 子类型/变体选择器 */}
          {assetTypeGroup && (
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">子类型 / 变体</label>
              <select 
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                value={selectedAssetType?.id || ''}
                onChange={(e) => {
                  const selected = assetTypeGroup.subTypes?.find(s => s.id === e.target.value);
                  if (selected) {
                    setSelectedAssetType(selected);
                    localStorage.setItem(`arthub_${presetId}_asset_type_id`, selected.id);
                  }
                }}
                disabled={!assetTypeGroup.subTypes?.length}
              >
                {assetTypeGroup.subTypes?.map(sub => (
                  <option key={sub.id} value={sub.id}>{sub.label}</option>
                ))}
              </select>
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
