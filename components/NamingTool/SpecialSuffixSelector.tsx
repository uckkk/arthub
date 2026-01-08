/**
 * 特殊后缀选择器组件
 */

import React from 'react';
import { SpecialSuffix } from '../../types';

interface SpecialSuffixSelectorProps {
  suffixes: SpecialSuffix[];
  activeSuffixes: Set<string>;
  onToggle: (suffixId: string) => void;
  currentPresetId?: string;
}

export const SpecialSuffixSelector: React.FC<SpecialSuffixSelectorProps> = ({
  suffixes,
  activeSuffixes,
  onToggle,
  currentPresetId,
}) => {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-400 mb-2">特殊后缀</label>
      <div className="flex flex-wrap gap-2">
        {suffixes.map(suffix => {
          const isActive = activeSuffixes.has(suffix.id);
          return (
            <button
              key={suffix.id}
              onClick={() => onToggle(suffix.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                isActive
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'bg-slate-900 text-slate-400 hover:bg-slate-700 hover:text-slate-200 border border-slate-700'
              }`}
              title={isActive ? `已激活，将在名称后添加"_${suffix.suffix}"` : `点击激活，在名称后添加"_${suffix.suffix}"`}
            >
              {suffix.label}
              {isActive && currentPresetId === 'fgui_card' && suffix.suffix === 'Ns' ? null : (
                isActive && <span className="ml-1 text-blue-200">(_{suffix.suffix})</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
