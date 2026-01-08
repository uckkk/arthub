/**
 * NamingTool 主组件
 * 负责路由分发到不同的模板组件
 */

import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, Settings2, HelpCircle, Wand2, X, ChevronDown, Check } from 'lucide-react';
import { fetchNamingData, getPresetLabel } from '../../services/namingDataService';
import { parseDanmakuCsv } from '../../services/danmakuNamingService';
import { DanmakuResourceType, DanmakuDictionary } from '../../types';
import { PRESET_IDS, getDefaultFormat, SPECIAL_SUFFIXES } from './constants';
import { FormatSelector } from './FormatSelector';
import DanmakuNamingTool from './DanmakuNamingTool';
import TraditionalNamingTool from './TraditionalNamingTool';
import DanmakuNamingRulesPanel from '../DanmakuNamingRulesPanel';

// 预设下拉框组件（与 FilterDropdown 样式一致）
interface PresetDropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

const PresetDropdown: React.FC<PresetDropdownProps> = ({
  value,
  onChange,
  options,
  disabled,
  onRefresh,
  isRefreshing,
}) => {
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
    <div ref={dropdownRef} className="relative flex items-center gap-2 bg-[#1a1a1a] px-3 py-2 rounded-lg border border-[#2a2a2a]">
      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={disabled || isRefreshing}
          className="p-1.5 hover:bg-[#252525] rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="刷新数据"
        >
          <RefreshCw 
            size={14} 
            className={`text-[#666666] ${isRefreshing ? 'animate-spin' : ''}`} 
          />
        </button>
      )}
      <Settings2 size={14} className="text-[#555555]" />
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          flex items-center gap-2
          text-sm text-white
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        <span>{selectedOption?.label || '选择'}</span>
        <ChevronDown 
          size={14} 
          className={`text-[#666666] transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="
          absolute top-full left-0 mt-1 w-full min-w-[180px]
          bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg
          shadow-lg shadow-black/50
          z-50 overflow-hidden
          animate-scale-in
        ">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`
                w-full flex items-center gap-2 px-4 py-2.5
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
                <Check size={14} className="text-blue-400" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const NamingTool: React.FC = () => {
  const [currentPresetId, setCurrentPresetId] = useState<string>(() => {
    return localStorage.getItem('arthub_naming_preset') || PRESET_IDS[0];
  });

  const [isLoadingPreset, setIsLoadingPreset] = useState(false);
  const [presetError, setPresetError] = useState<string>('');
  
  // 弹幕游戏专用状态
  const [danmakuResourceTypes, setDanmakuResourceTypes] = useState<DanmakuResourceType[]>([]);
  const [danmakuDictionaries, setDanmakuDictionaries] = useState<Map<string, DanmakuDictionary>>(new Map());
  const [selectedResourceType, setSelectedResourceType] = useState<DanmakuResourceType | null>(null);
  const [showRulesModal, setShowRulesModal] = useState<boolean>(false);

  // 命名格式选项
  const [caseFormat, setCaseFormat] = useState<'pascal' | 'camel' | 'lower'>(() => {
    const savedPresetId = localStorage.getItem('arthub_naming_preset') || PRESET_IDS[0];
    const defaultFormat = getDefaultFormat(savedPresetId);
    return (localStorage.getItem('arthub_case_format') as 'pascal' | 'camel' | 'lower') || defaultFormat.case;
  });
  const [separatorFormat, setSeparatorFormat] = useState<'underscore' | 'hyphen' | 'none'>(() => {
    const savedPresetId = localStorage.getItem('arthub_naming_preset') || PRESET_IDS[0];
    const defaultFormat = getDefaultFormat(savedPresetId);
    return (localStorage.getItem('arthub_separator_format') as 'underscore' | 'hyphen' | 'none') || defaultFormat.separator;
  });

  // 加载弹幕游戏预设
  const loadDanmakuPreset = async (forceRefresh = false) => {
    if (!forceRefresh && danmakuResourceTypes.length > 0) {
      if (danmakuResourceTypes.length > 0 && !selectedResourceType) {
        const savedResourceTypeId = localStorage.getItem('arthub_danmaku_resource_type_id');
        const savedType = savedResourceTypeId 
          ? danmakuResourceTypes.find(rt => rt.id === savedResourceTypeId)
          : null;
        setSelectedResourceType(savedType || danmakuResourceTypes[0]);
      }
      return;
    }

    setIsLoadingPreset(true);
    setPresetError('');

    try {
      const csvData = await fetchNamingData('fgui_danmaku');
      const data = parseDanmakuCsv(csvData);
      setDanmakuResourceTypes(data.resourceTypes);
      setDanmakuDictionaries(data.dictionaries);

      if (data.resourceTypes.length > 0) {
        const savedResourceTypeId = localStorage.getItem('arthub_danmaku_resource_type_id');
        const savedType = savedResourceTypeId 
          ? data.resourceTypes.find(rt => rt.id === savedResourceTypeId)
          : null;
        setSelectedResourceType(savedType || data.resourceTypes[0]);
      }
    } catch (error) {
      console.error('Error loading danmaku preset:', error);
      setPresetError('加载数据失败，请检查网络连接');
    } finally {
      setIsLoadingPreset(false);
    }
  };

  // 初始加载和切换预设时加载数据
  useEffect(() => {
    if (currentPresetId === 'fgui_danmaku') {
      loadDanmakuPreset();
    }
  }, [currentPresetId]);

  // 当预设改变时保存到localStorage并应用默认格式
  useEffect(() => {
    localStorage.setItem('arthub_naming_preset', currentPresetId);
    const defaultFormat = getDefaultFormat(currentPresetId);
    setCaseFormat(defaultFormat.case);
    setSeparatorFormat(defaultFormat.separator);
    if (currentPresetId !== 'fgui_danmaku') {
      setSelectedResourceType(null);
    }
  }, [currentPresetId]);

  // 保存格式选择到 localStorage
  useEffect(() => {
    localStorage.setItem('arthub_case_format', caseFormat);
  }, [caseFormat]);

  useEffect(() => {
    localStorage.setItem('arthub_separator_format', separatorFormat);
  }, [separatorFormat]);

  const isDanmaku = currentPresetId === 'fgui_danmaku';

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a]">
      {/* 头部工具栏 */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-6 border-b border-[#1a1a1a]">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#1a1a1a] rounded-lg">
            {isDanmaku ? (
              <button
                onClick={() => setShowRulesModal(true)}
                className="text-[#666666] hover:text-blue-400 transition-colors"
                title="查看命名规则"
              >
                <HelpCircle size={20} />
              </button>
            ) : (
              <Wand2 size={20} className="text-blue-400" />
            )}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">命名工具</h2>
            <p className="text-sm text-[#666666]">生成规范的资源命名</p>
          </div>
        </div>
        
        {/* 命名格式和模板选择 */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 w-full md:w-auto">
          <FormatSelector
            caseFormat={caseFormat}
            separatorFormat={separatorFormat}
            onCaseFormatChange={setCaseFormat}
            onSeparatorFormatChange={setSeparatorFormat}
            disabled={isLoadingPreset}
          />
          
          {/* 预设切换器 */}
          <PresetDropdown
            value={currentPresetId}
            onChange={setCurrentPresetId}
            options={PRESET_IDS.map(id => ({ value: id, label: getPresetLabel(id) }))}
            disabled={isLoadingPreset}
            onRefresh={isDanmaku ? () => loadDanmakuPreset(true) : undefined}
            isRefreshing={isLoadingPreset}
          />
        </div>
      </div>

      {/* 错误提示 */}
      {presetError && (
        <div className="mx-6 mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {presetError}
        </div>
      )}

      {/* 加载提示 */}
      {isLoadingPreset && (
        <div className="mx-6 mt-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-blue-400 text-sm flex items-center gap-2">
          <RefreshCw size={16} className="animate-spin" />
          <span>正在加载数据...</span>
        </div>
      )}

      {/* 主内容区域 */}
      <div className="flex-1 overflow-y-auto p-6">
        {isDanmaku ? (
          <DanmakuNamingTool
            resourceTypes={danmakuResourceTypes}
            dictionaries={danmakuDictionaries}
            selectedResourceType={selectedResourceType}
            onResourceTypeChange={setSelectedResourceType}
            caseFormat={caseFormat}
            separatorFormat={separatorFormat}
            specialSuffixes={SPECIAL_SUFFIXES}
          />
        ) : (
          <TraditionalNamingTool
            presetId={currentPresetId}
            caseFormat={caseFormat}
            separatorFormat={separatorFormat}
            specialSuffixes={SPECIAL_SUFFIXES}
          />
        )}
      </div>

      {/* 命名规则浮窗（仅弹幕游戏模板） */}
      {isDanmaku && showRulesModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" 
          onClick={() => setShowRulesModal(false)}
        >
          <div 
            className="
              w-full max-w-4xl max-h-[90vh] mx-4
              bg-[#151515] border border-[#2a2a2a] rounded-xl
              shadow-2xl shadow-black/50
              flex flex-col overflow-hidden
              animate-scale-in
            "
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a] shrink-0">
              <div className="flex items-center gap-3">
                <HelpCircle className="text-blue-400" size={20} />
                <h2 className="text-lg font-semibold text-white">命名规则说明</h2>
              </div>
              <button
                onClick={() => setShowRulesModal(false)}
                className="p-1.5 rounded-lg text-[#666666] hover:text-white hover:bg-[#252525] transition-colors"
                title="关闭"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <DanmakuNamingRulesPanel
                selectedResourceType={selectedResourceType}
                isVisible={true}
                onToggle={() => {}}
                isModal={true}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NamingTool;
