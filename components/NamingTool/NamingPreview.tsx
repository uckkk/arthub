/**
 * 命名预览组件
 * 显示生成的命名结果
 */

import React from 'react';
import { Copy, Check } from 'lucide-react';

interface NamingPreviewProps {
  finalName: string;
  chineseName?: string;
  isTranslating?: boolean;
  onCopy: () => void;
  copied: boolean;
  label?: string;
  variant?: 'default' | 'engine';
}

export const NamingPreview: React.FC<NamingPreviewProps> = ({
  finalName,
  chineseName,
  isTranslating = false,
  onCopy,
  copied,
  label = '生成的资产名称',
  variant = 'default',
}) => {
  const borderColor = variant === 'engine' 
    ? 'border-green-500/30 hover:border-green-500' 
    : 'border-blue-500/30 hover:border-blue-500';
  
  const textColor = variant === 'engine'
    ? (finalName ? (isTranslating ? 'text-slate-400' : 'text-green-300') : 'text-slate-500')
    : (finalName ? (isTranslating ? 'text-slate-400' : 'text-blue-300') : 'text-slate-500');

  return (
    <div className="mt-8 space-y-4">
      <label className="block text-sm font-medium text-slate-400 mb-2">{label}</label>
      
      <div 
        className={`group relative bg-black/40 border rounded-xl p-6 flex flex-col gap-3 transition-all duration-200 ${
          finalName 
            ? `${borderColor} cursor-pointer` 
            : 'border-slate-700/30 opacity-60'
        }`}
        onClick={() => finalName && onCopy()}
      >
        <div className="flex items-center justify-between w-full">
          <div className="flex-1">
            <div className="text-xs text-slate-400 mb-1">
              {variant === 'engine' ? '引擎环境命名（生产环境）' : '生产环境命名（美术制作）'}
            </div>
            <code className={`text-2xl font-mono tracking-wide font-bold break-all transition-colors ${textColor}`}>
              {finalName || '请填写信息生成命名'}
            </code>
          </div>
        
          {finalName && (
            <div className="flex items-center gap-2 shrink-0 ml-4">
              {copied ? (
                <span className="flex items-center text-green-400 text-sm font-bold animate-in fade-in zoom-in">
                  <Check size={18} className="mr-1" /> 已复制
                </span>
              ) : (
                <span className="text-slate-500 text-sm group-hover:text-white transition-colors">点击复制</span>
              )}
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  if (finalName) onCopy();
                }}
                className="p-2 hover:bg-slate-700 rounded-md transition-colors text-slate-400 group-hover:text-white"
              >
                <Copy size={20} />
              </button>
            </div>
          )}
        </div>
          
        {/* 中文命名显示 */}
        {chineseName && (
          <div className="pt-3 border-t border-slate-700/50">
            <div className="text-lg text-slate-200 break-all">{chineseName}</div>
          </div>
        )}
      </div>
    </div>
  );
};
