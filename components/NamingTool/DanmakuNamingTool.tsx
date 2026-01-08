/**
 * 弹幕游戏模板组件
 * 从原 NamingTool.tsx 迁移的弹幕游戏模板逻辑
 */

import React, { useState, useEffect, useCallback } from 'react';
import { X, Wand2, Copy } from 'lucide-react';
import { DanmakuResourceType, DanmakuDictionary, SpecialSuffix } from '../../types';
import { getPresetLabel } from '../../services/namingDataService';
import { getDictionariesForResourceCategory } from '../../services/danmakuNamingService';
import { getRulesByCategory, generateEngineName } from '../../services/danmakuNamingRules';
import { generateSkillIdSuggestion, parseSkillId, getSkillTypeName } from '../../services/skillIdGenerator';
import { useTranslation } from './hooks/useTranslation';
import { formatName } from './utils/nameFormatter';
import { SpecialSuffixSelector } from './SpecialSuffixSelector';
import { NamingPreview } from './NamingPreview';
import { Input } from '../common';
import { useToast } from '../Toast';

interface DanmakuNamingToolProps {
  resourceTypes: DanmakuResourceType[];
  dictionaries: Map<string, DanmakuDictionary>;
  selectedResourceType: DanmakuResourceType | null;
  onResourceTypeChange: (type: DanmakuResourceType) => void;
  caseFormat: 'pascal' | 'camel' | 'lower';
  separatorFormat: 'underscore' | 'hyphen' | 'none';
  specialSuffixes: SpecialSuffix[];
}

const DanmakuNamingTool: React.FC<DanmakuNamingToolProps> = ({
  resourceTypes,
  dictionaries,
  selectedResourceType,
  onResourceTypeChange,
  caseFormat,
  separatorFormat,
  specialSuffixes,
}) => {
  const { showToast } = useToast();
  const [placeholderValues, setPlaceholderValues] = useState<Map<string, string>>(new Map());
  const [rawInput, setRawInput] = useState('');
  const { translatedPart, isTranslating, needsApiSetup } = useTranslation(rawInput);
  const [finalName, setFinalName] = useState('');
  const [chineseName, setChineseName] = useState('');
  const [copied, setCopied] = useState(false);
  const [activeSuffixes, setActiveSuffixes] = useState<Set<string>>(new Set());
  
  // 引擎环境专用状态
  const [skillId, setSkillId] = useState<string>('');
  const [upgradeLevel, setUpgradeLevel] = useState<number | undefined>(undefined);
  const [skillType, setSkillType] = useState<number>(1);
  const [starLevel, setStarLevel] = useState<number>(0);
  const [upgradeParam, setUpgradeParam] = useState<number>(0);
  const [unitId, setUnitId] = useState<string>('');
  const [itemId, setItemId] = useState<string>('');
  const [engineName, setEngineName] = useState('');
  const [engineNames, setEngineNames] = useState<Record<string, string>>({});
  const [copiedEngine, setCopiedEngine] = useState(false);
  const [copiedEngineTypes, setCopiedEngineTypes] = useState<Record<string, boolean>>({});

  // 当选择资源类型变化时，初始化词典选择
  useEffect(() => {
    if (!selectedResourceType) return;

    const newValues = new Map<string, string>();
    const neededDicts = getDictionariesForResourceCategory(selectedResourceType.category, dictionaries);
    
    if (selectedResourceType.category === '单位' || selectedResourceType.category === '物品') {
      setPlaceholderValues(new Map());
    } else {
      neededDicts.forEach(dict => {
        const dictKey = dict.category.split('(')[0].trim();
        if (dictKey === '怪物阶级') {
          return;
        }
        if (dict.items.length > 0) {
          const savedValue = localStorage.getItem(`arthub_danmaku_${selectedResourceType.id}_${dictKey}`);
          const savedItem = savedValue ? dict.items.find(item => item.abbr === savedValue) : null;
          newValues.set(dictKey, savedItem?.abbr || dict.items[0].abbr);
        }
      });
      setPlaceholderValues(newValues);
    }
    
    // 加载技能ID相关状态
    const savedSkillId = localStorage.getItem('arthub_danmaku_skill_id') || '';
    const savedUpgradeLevel = localStorage.getItem('arthub_danmaku_upgrade_level');
    const savedSkillType = localStorage.getItem('arthub_danmaku_skill_type');
    const savedStarLevel = localStorage.getItem('arthub_danmaku_star_level');
    const savedUpgradeParam = localStorage.getItem('arthub_danmaku_upgrade_param');
    
    if (savedSkillId) {
      setSkillId(savedSkillId);
      const parsed = parseSkillId(savedSkillId);
      if (parsed) {
        setSkillType(parsed.typeA);
        setStarLevel(parsed.typeB);
        setUpgradeParam(parsed.typeCD);
      }
    } else if (newValues.size > 0) {
      const suggestedId = generateSkillIdSuggestion(
        selectedResourceType,
        newValues,
        savedSkillType ? parseInt(savedSkillType, 10) : undefined,
        savedStarLevel ? parseInt(savedStarLevel, 10) : 0,
        savedUpgradeParam ? parseInt(savedUpgradeParam, 10) : 0
      );
      if (suggestedId) {
        setSkillId(suggestedId);
        localStorage.setItem('arthub_danmaku_skill_id', suggestedId);
      }
    }
    
    setSkillType(savedSkillType ? parseInt(savedSkillType, 10) : 1);
    setStarLevel(savedStarLevel ? parseInt(savedStarLevel, 10) : 0);
    setUpgradeParam(savedUpgradeParam ? parseInt(savedUpgradeParam, 10) : 0);
    setUpgradeLevel(savedUpgradeLevel !== null && savedUpgradeLevel !== '' ? parseInt(savedUpgradeLevel, 10) : undefined);
  }, [selectedResourceType, dictionaries]);

  // 构建最终命名（生产环境）
  useEffect(() => {
    if (!selectedResourceType) {
      setFinalName('');
      setChineseName('');
      return;
    }

    // "单位"和"物品"资源类型不需要生成生产环境命名
    if (selectedResourceType.category === '单位' || selectedResourceType.category === '物品') {
      setFinalName('');
      setChineseName('');
      return;
    }
    
    const parts: string[] = [selectedResourceType.prefix];
    const neededDicts = getDictionariesForResourceCategory(selectedResourceType.category, dictionaries);
    
    neededDicts.forEach(dict => {
      const dictKey = dict.category.split('(')[0].trim();
      if (dictKey === '怪物阶级') {
        return;
      }
      const value = placeholderValues.get(dictKey);
      if (value) {
        parts.push(value);
      }
    });
    
    if (rawInput.trim()) {
      let namePart = rawInput.trim();
      if (translatedPart && !isTranslating) {
        namePart = translatedPart;
      } else if (translatedPart && isTranslating) {
        namePart = rawInput.replace(/\s+/g, '');
      } else {
        namePart = rawInput.replace(/\s+/g, '');
      }
      if (namePart) {
        parts.push(namePart);
      }
    }
    
    let separator = '_';
    if (separatorFormat === 'hyphen') {
      separator = '-';
    } else if (separatorFormat === 'none') {
      separator = '';
    }
    
    let rawName = parts.join(separator);
    const formattedName = formatName(rawName, caseFormat, separatorFormat);
    
    const specialSuffixParts = Array.from(activeSuffixes)
      .map(id => specialSuffixes.find(s => s.id === id))
      .filter((s): s is SpecialSuffix => s !== undefined)
      .map(s => {
        const formattedSuffix = formatName(s.suffix, caseFormat, separatorFormat);
        return `_${formattedSuffix}`;
      })
      .join('');
    
    const final = `${formattedName}${specialSuffixParts}`;
    setFinalName(final);
    
    // 生成中文命名
    const chineseParts: string[] = [];
    const seenLabels = new Set<string>();
    
    const resourceTypeSubCategory = selectedResourceType?.subCategory || '';
    if (resourceTypeSubCategory && !seenLabels.has(resourceTypeSubCategory)) {
      chineseParts.push(resourceTypeSubCategory);
      seenLabels.add(resourceTypeSubCategory);
    }
    
    neededDicts.forEach(dict => {
      const dictKey = dict.category.split('(')[0].trim();
      if (dictKey === '怪物阶级') {
        return;
      }
      const value = placeholderValues.get(dictKey);
      if (value) {
        const dictItem = dict.items.find(item => item.abbr === value);
        if (dictItem) {
          if (resourceTypeSubCategory && resourceTypeSubCategory.includes(dictItem.label)) {
            return;
          }
          if (!seenLabels.has(dictItem.label)) {
            chineseParts.push(dictItem.label);
            seenLabels.add(dictItem.label);
          }
        }
      }
    });
    
    if (rawInput.trim() && /[\u4e00-\u9fa5]/.test(rawInput)) {
      const nameLabel = rawInput.trim();
      if (!seenLabels.has(nameLabel)) {
        chineseParts.push(nameLabel);
        seenLabels.add(nameLabel);
      }
    }
    
    Array.from(activeSuffixes).forEach(id => {
      const suffix = specialSuffixes.find(s => s.id === id);
      if (suffix && !seenLabels.has(suffix.label)) {
        chineseParts.push(suffix.label);
        seenLabels.add(suffix.label);
      }
    });
    
    setChineseName(chineseParts.length > 0 ? chineseParts.join('') : '');
  }, [selectedResourceType, placeholderValues, rawInput, translatedPart, isTranslating, activeSuffixes, caseFormat, separatorFormat, dictionaries, specialSuffixes]);

  // 生成引擎环境命名
  useEffect(() => {
    if (!selectedResourceType) {
      setEngineName('');
      setEngineNames({});
      return;
    }

    const rule = getRulesByCategory(selectedResourceType.category, selectedResourceType.subCategory);
    if (!rule || !rule.prefix) {
      setEngineName('');
      setEngineNames({});
      return;
    }

    const needsSkillId = rule.rules.some(r => r.requiresSkillId);
    const needsUnitId = rule.rules.some(r => r.requiresUnitId);
    const needsItemId = rule.rules.some(r => r.requiresItemId);
    
    // 子弹和技能资源需要生成5个引擎环境命名
    if (selectedResourceType.subCategory === '子弹和技能' && needsSkillId) {
      const currentSkillId = skillId && /^\d{9}$/.test(skillId) ? skillId : null;
      
      if (currentSkillId) {
        const names: Record<string, string> = {};
        rule.rules.forEach(r => {
          if (r.requiresSkillId && r.engineNameType) {
            const name = generateEngineName(
              r.prefix,
              currentSkillId,
              r.engineNameType === 'bullet' ? upgradeLevel : undefined,
              'skill'
            );
            if (name) {
              names[r.engineNameType] = name;
            }
          }
        });
        setEngineNames(names);
        setEngineName('');
      } else {
        setEngineNames({});
        setEngineName('');
      }
    } else if (needsSkillId) {
      if (skillId && /^\d{9}$/.test(skillId)) {
        const engineNameValue = generateEngineName(rule.prefix, skillId, upgradeLevel, 'skill');
        setEngineName(engineNameValue);
        setEngineNames({});
      } else {
        setEngineName('');
        setEngineNames({});
      }
    } else if (needsUnitId) {
      if (unitId && /^\d+$/.test(unitId)) {
        const engineNameValue = generateEngineName(rule.prefix, unitId, undefined, 'unit');
        setEngineName(engineNameValue);
        setEngineNames({});
      } else {
        setEngineName('');
        setEngineNames({});
      }
    } else if (needsItemId) {
      if (itemId && /^\d+$/.test(itemId)) {
        const engineNameValue = generateEngineName(rule.prefix, itemId, undefined, 'item');
        setEngineName(engineNameValue);
        setEngineNames({});
      } else {
        setEngineName('');
        setEngineNames({});
      }
    } else {
      setEngineName('');
      setEngineNames({});
    }
  }, [selectedResourceType, skillId, upgradeLevel, unitId, itemId]);

  // 自动生成技能ID
  useEffect(() => {
    if (!selectedResourceType || placeholderValues.size === 0) return;
    
    const rule = getRulesByCategory(selectedResourceType.category, selectedResourceType.subCategory);
    const needsSkillId = rule && rule.rules.some(r => r.requiresSkillId);
    
    if (needsSkillId) {
      const suggestedId = generateSkillIdSuggestion(
        selectedResourceType,
        placeholderValues,
        skillType,
        starLevel,
        upgradeParam
      );
      
      if (suggestedId) {
        setSkillId(prevId => {
          if (prevId !== suggestedId) {
            localStorage.setItem('arthub_danmaku_skill_id', suggestedId);
            return suggestedId;
          }
          return prevId;
        });
      }
    }
  }, [selectedResourceType?.id, selectedResourceType?.category, selectedResourceType?.subCategory, placeholderValues, skillType, starLevel, upgradeParam]);

  const handleCopy = useCallback((text: string, isEngine = false, engineType?: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      if (isEngine && engineType) {
        setCopiedEngineTypes(prev => ({ ...prev, [engineType]: true }));
        setTimeout(() => {
          setCopiedEngineTypes(prev => ({ ...prev, [engineType]: false }));
        }, 2000);
      } else if (isEngine) {
        setCopiedEngine(true);
        setTimeout(() => setCopiedEngine(false), 2000);
      } else {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        saveToHistory();
      }
    }).catch(err => {
      console.error('复制失败:', err);
      showToast('error', '复制失败');
    });
  }, []);

  const saveToHistory = useCallback(() => {
    if (!finalName.trim()) return;

    try {
      const historyItem = {
        id: `history_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        presetId: 'fgui_danmaku',
        presetLabel: getPresetLabel('fgui_danmaku'),
        controlCategory: selectedResourceType ? `${selectedResourceType.category} - ${selectedResourceType.subCategory}` : undefined,
        assetType: undefined,
        rawInput: rawInput,
        translatedPart: translatedPart || undefined,
        finalName: finalName,
        chineseName: chineseName || undefined,
        caseFormat: caseFormat,
        separatorFormat: separatorFormat,
        specialSuffixes: Array.from(activeSuffixes),
      };

      const historyKey = `arthub_naming_history_fgui_danmaku`;
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
  }, [finalName, selectedResourceType, rawInput, translatedPart, chineseName, caseFormat, separatorFormat, activeSuffixes]);

  const toggleSpecialSuffix = (suffixId: string) => {
    const newActiveSuffixes = new Set(activeSuffixes);
    if (newActiveSuffixes.has(suffixId)) {
      newActiveSuffixes.delete(suffixId);
    } else {
      newActiveSuffixes.add(suffixId);
    }
    setActiveSuffixes(newActiveSuffixes);
  };

  if (resourceTypes.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <p>正在加载资源类型...</p>
      </div>
    );
  }

  const neededDicts = selectedResourceType 
    ? getDictionariesForResourceCategory(selectedResourceType.category, dictionaries)
    : [];
  const filteredDicts = neededDicts.filter(dict => {
    const dictKey = dict.category.split('(')[0].trim();
    return dictKey !== '怪物阶级';
  });

  const rule = selectedResourceType 
    ? getRulesByCategory(selectedResourceType.category, selectedResourceType.subCategory)
    : null;
  const needsSkillId = rule && rule.rules.some(r => r.requiresSkillId);
  const needsUnitId = rule && rule.rules.some(r => r.requiresUnitId);
  const needsItemId = rule && rule.rules.some(r => r.requiresItemId);

  return (
    <div className="space-y-6 flex-1">
      {/* 资源类型选择 */}
      <div>
        <label className="block text-sm font-medium text-slate-400 mb-2">资源类型</label>
        <select 
          className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
          value={selectedResourceType?.id || ''}
          onChange={(e) => {
            const selected = resourceTypes.find(t => t.id === e.target.value);
            if (selected) {
              onResourceTypeChange(selected);
              localStorage.setItem('arthub_danmaku_resource_type_id', selected.id);
            }
          }}
        >
          {Array.from(new Map(resourceTypes.map(rt => [rt.category, rt])).entries()).map(([category, _]) => (
            <optgroup key={category} label={category}>
              {resourceTypes.filter(rt => rt.category === category).map(type => (
                <option key={type.id} value={type.id}>
                  {type.subCategory}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* 词典选择 */}
      {selectedResourceType && filteredDicts.length > 0 && (
        <div className="space-y-3">
          {filteredDicts.map(dict => {
            const dictKey = dict.category.split('(')[0].trim();
            const currentValue = placeholderValues.get(dictKey) || '';

            return (
              <div key={dict.category}>
                <label className="block text-sm font-medium text-slate-400 mb-2">
                  {dictKey}
                </label>
                <select 
                  value={currentValue}
                  onChange={(e) => {
                    const newValues = new Map(placeholderValues);
                    newValues.set(dictKey, e.target.value);
                    setPlaceholderValues(newValues);
                    if (selectedResourceType) {
                      localStorage.setItem(`arthub_danmaku_${selectedResourceType.id}_${dictKey}`, e.target.value);
                    }
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  {dict.items.map(item => (
                    <option key={item.id} value={item.abbr}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}

      {/* ID生成器 - 技能ID */}
      {needsSkillId && selectedResourceType && (
        <div className="space-y-3">
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-slate-400">
                技能ID生成器（引擎环境，9位数字）
              </label>
              <button
                onClick={() => {
                  if (!selectedResourceType || placeholderValues.size === 0) return;
                  const suggestedId = generateSkillIdSuggestion(
                    selectedResourceType,
                    placeholderValues,
                    skillType,
                    starLevel,
                    upgradeParam
                  );
                  if (suggestedId) {
                    setSkillId(suggestedId);
                    localStorage.setItem('arthub_danmaku_skill_id', suggestedId);
                    showToast('success', '技能ID已生成');
                  }
                }}
                className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-1"
              >
                <Wand2 size={14} />
                自动生成
              </button>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">A位：技能类型</label>
                <select
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={skillType}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10);
                    setSkillType(value);
                    setStarLevel(value);
                    localStorage.setItem('arthub_danmaku_skill_type', value.toString());
                    localStorage.setItem('arthub_danmaku_star_level', value.toString());
                  }}
                >
                  <option value={1}>1-地图技能</option>
                  <option value={2}>2-物品技能</option>
                  <option value={3}>3-怪物技能</option>
                  <option value={4}>4-英雄技能</option>
                </select>
              </div>
              
              <div>
                <label className="block text-xs text-slate-500 mb-1">B位：星级/合成次数</label>
                <input
                  type="number"
                  min="0"
                  max="9"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={starLevel}
                  onChange={(e) => {
                    const value = Math.max(0, Math.min(9, parseInt(e.target.value, 10) || 0));
                    setStarLevel(value);
                    localStorage.setItem('arthub_danmaku_star_level', value.toString());
                  }}
                />
              </div>
              
              <div>
                <label className="block text-xs text-slate-500 mb-1">CD位：升级参数</label>
                <input
                  type="number"
                  min="0"
                  max="99"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={upgradeParam}
                  onChange={(e) => {
                    const value = Math.max(0, Math.min(99, parseInt(e.target.value, 10) || 0));
                    setUpgradeParam(value);
                    localStorage.setItem('arthub_danmaku_upgrade_param', value.toString());
                  }}
                />
              </div>
              
              <div>
                <label className="block text-xs text-slate-500 mb-1">EFGHI位：常规字段</label>
                <div className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white text-sm text-slate-400 font-mono">
                  {parseSkillId(skillId)?.typeEFGHI || '00000'}
                </div>
              </div>
            </div>
            
            <div>
              <label className="block text-xs text-slate-500 mb-1">最终技能ID</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg p-2 text-white placeholder-slate-600 focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
                  placeholder="例如：100000001"
                  value={skillId}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '');
                    if (value.length <= 9) {
                      setSkillId(value);
                      localStorage.setItem('arthub_danmaku_skill_id', value);
                      const parsed = parseSkillId(value);
                      if (parsed) {
                        setSkillType(parsed.typeA);
                        setStarLevel(parsed.typeB);
                        setUpgradeParam(parsed.typeCD);
                      }
                    }
                  }}
                  maxLength={9}
                />
                {skillId && /^\d{9}$/.test(skillId) && (
                  <div className="flex items-center px-3 bg-green-900/30 border border-green-700 rounded-lg text-green-300 text-xs">
                    ✓ 有效
                  </div>
                )}
              </div>
              {skillId && !/^\d{9}$/.test(skillId) && (
                <div className="mt-1 text-xs text-red-400">技能ID必须是9位数字</div>
              )}
              {skillId && /^\d{9}$/.test(skillId) && (
                <div className="mt-1 text-xs text-slate-500">
                  解析：{getSkillTypeName(parseSkillId(skillId)!.typeA)} | 
                  星级：{parseSkillId(skillId)!.typeB} | 
                  升级参数：{parseSkillId(skillId)!.typeCD.toString().padStart(2, '0')}
                </div>
              )}
            </div>
          </div>
          
          {/* 升级等级（仅子弹和技能资源） */}
          {selectedResourceType.subCategory === '子弹和技能' && (
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">
                升级等级（可选，仅子弹资源）
              </label>
              <select
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                value={upgradeLevel === undefined ? '' : upgradeLevel.toString()}
                onChange={(e) => {
                  const value = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                  setUpgradeLevel(value);
                  localStorage.setItem('arthub_danmaku_upgrade_level', value === undefined ? '' : value.toString());
                }}
              >
                <option value="">0星（无后缀）</option>
                <option value="1">1星（_1后缀）</option>
                <option value="2">2星（_2后缀）</option>
              </select>
            </div>
          )}
        </div>
      )}

      {/* ID生成器 - 单位表ID */}
      {needsUnitId && (
        <div className="space-y-3">
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-slate-400">
                单位表ID生成器（引擎环境，unit_100x格式）
              </label>
            </div>
            
            <div>
              <label className="block text-xs text-slate-500 mb-1">单位表ID</label>
              <div className="flex gap-2">
                <div className="flex items-center px-3 bg-slate-800 border border-slate-700 rounded-lg text-slate-400 text-sm font-mono">
                  unit_100
                </div>
                <input
                  type="text"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg p-2 text-white placeholder-slate-600 focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
                  placeholder="例如：1"
                  value={unitId}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '');
                    setUnitId(value);
                    localStorage.setItem('arthub_danmaku_unit_id', value);
                  }}
                />
              </div>
              {unitId && /^\d+$/.test(unitId) && (
                <div className="mt-2 flex items-center px-3 bg-green-900/30 border border-green-700 rounded-lg text-green-300 text-xs font-mono">
                  ✓ 生成：unit_100{unitId}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ID生成器 - 物品表ID */}
      {needsItemId && (
        <div className="space-y-3">
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-slate-400">
                物品表ID生成器（引擎环境，item_10x格式）
              </label>
            </div>
            
            <div>
              <label className="block text-xs text-slate-500 mb-1">物品表ID</label>
              <div className="flex gap-2">
                <div className="flex items-center px-3 bg-slate-800 border border-slate-700 rounded-lg text-slate-400 text-sm font-mono">
                  item_10
                </div>
                <input
                  type="text"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg p-2 text-white placeholder-slate-600 focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
                  placeholder="例如：1"
                  value={itemId}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '');
                    setItemId(value);
                    localStorage.setItem('arthub_danmaku_item_id', value);
                  }}
                />
              </div>
              {itemId && /^\d+$/.test(itemId) && (
                <div className="mt-2 flex items-center px-3 bg-green-900/30 border border-green-700 rounded-lg text-green-300 text-xs font-mono">
                  ✓ 生成：item_10{itemId}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 名称输入 */}
      {selectedResourceType && (selectedResourceType.category !== '单位' && selectedResourceType.category !== '物品') && (
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
              placeholder="例如：追踪弹 或 Homing"
            />
            {needsApiSetup && (
              <div className="mt-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-400 text-xs flex items-center justify-between">
                <span>检测到中文输入，需配置翻译 API 才能自动翻译</span>
                <button 
                  onClick={() => {
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
      )}

      {/* 特殊后缀选项 */}
      {selectedResourceType && (selectedResourceType.category !== '单位' && selectedResourceType.category !== '物品') && (
        <SpecialSuffixSelector
          suffixes={specialSuffixes}
          activeSuffixes={activeSuffixes}
          onToggle={toggleSpecialSuffix}
          currentPresetId="fgui_danmaku"
        />
      )}

      {/* 生产环境命名预览 */}
      {selectedResourceType && (selectedResourceType.category !== '单位' && selectedResourceType.category !== '物品') && (
        <NamingPreview
          finalName={finalName}
          chineseName={chineseName}
          isTranslating={isTranslating}
          onCopy={() => handleCopy(finalName, false)}
          copied={copied}
        />
      )}

      {/* 引擎环境命名预览 - 子弹和技能资源（5个命名） */}
      {selectedResourceType?.subCategory === '子弹和技能' && Object.keys(engineNames).length > 0 && (
        <div className="space-y-3">
          <div className="text-xs text-slate-400 mb-2">引擎环境命名（生产环境）</div>
          {[
            { key: 'bullet', label: '子弹/投射物ID', prefix: 'bullet_' },
            { key: 'hit', label: '打击爆点ID', prefix: 'hit_' },
            { key: 'buff', label: 'BUFF状态ID', prefix: 'buff_' },
            { key: 'effect', label: 'EFFECT特效ID', prefix: 'effect_' },
            { key: 'icon', label: 'ICON图标ID', prefix: 'Icon_' }
          ].map(({ key, label }) => {
            const name = engineNames[key] || '';
            const isCopied = copiedEngineTypes[key] || false;
            return (
              <div
                key={key}
                className={`group relative bg-black/40 border rounded-xl p-4 flex items-center justify-between transition-all duration-200 ${
                  name
                    ? 'border-green-500/30 hover:border-green-500 cursor-pointer'
                    : 'border-slate-700/30 opacity-60'
                }`}
                onClick={() => name && handleCopy(name, true, key)}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-slate-400 mb-1">{label}</div>
                  <code className={`text-lg font-mono tracking-wide font-bold break-all transition-colors ${
                    name ? 'text-green-300' : 'text-slate-500'
                  }`}>
                    {name || `请输入技能ID（9位数字）`}
                  </code>
                </div>
                
                {name && (
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    {isCopied ? (
                      <span className="flex items-center text-green-400 text-sm font-bold">
                        ✓ 已复制
                      </span>
                    ) : (
                      <span className="text-slate-500 text-sm group-hover:text-white transition-colors">点击复制</span>
                    )}
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        if (name) handleCopy(name, true, key);
                      }}
                      className="p-2 hover:bg-slate-700 rounded-md transition-colors text-slate-400 group-hover:text-white"
                    >
                      <Copy size={18} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 引擎环境命名预览 - 其他资源类型（单个命名） */}
      {selectedResourceType && selectedResourceType.subCategory !== '子弹和技能' && engineName && (
        <NamingPreview
          finalName={engineName}
          isTranslating={false}
          onCopy={() => handleCopy(engineName, true)}
          copied={copiedEngine}
          label="引擎环境命名（生产环境）"
          variant="engine"
        />
      )}
    </div>
  );
};

export default DanmakuNamingTool;
