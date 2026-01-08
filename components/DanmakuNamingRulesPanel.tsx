import React, { useState } from 'react';
import { Info, ChevronDown, ChevronUp, BookOpen, Lightbulb, CheckCircle2 } from 'lucide-react';
import { ResourceTypeRule, ID_STRUCTURE_GUIDE, getRulesForResourceType, getRulesByCategory, DANMAKU_NAMING_RULES } from '../services/danmakuNamingRules';
import { DanmakuResourceType } from '../types';

interface DanmakuNamingRulesPanelProps {
  selectedResourceType: DanmakuResourceType | null;
  isVisible: boolean;
  onToggle: () => void;
  isModal?: boolean; // 是否为浮窗模式
}

const DanmakuNamingRulesPanel: React.FC<DanmakuNamingRulesPanelProps> = ({
  selectedResourceType,
  isVisible,
  onToggle,
  isModal = false
}) => {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['id-structure']));

  // 获取当前资源类型的规则
  const currentRule: ResourceTypeRule | undefined = selectedResourceType
    ? (() => {
        // 先尝试通过分类和子分类匹配
        const ruleByCategory = getRulesByCategory(selectedResourceType.category, selectedResourceType.subCategory);
        if (ruleByCategory) return ruleByCategory;
        
        // 再尝试通过前缀匹配
        const ruleByPrefix = DANMAKU_NAMING_RULES.find(rule => 
          rule.rules.some(r => r.prefix === selectedResourceType.prefix)
        );
        if (ruleByPrefix) return ruleByPrefix;
        
        // 最后尝试通过ID匹配
        return getRulesForResourceType(selectedResourceType.id);
      })()
    : undefined;

  const toggleSection = (sectionId: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionId)) {
      newExpanded.delete(sectionId);
    } else {
      newExpanded.add(sectionId);
    }
    setExpandedSections(newExpanded);
  };

  // 浮窗模式下不显示折叠按钮
  if (!isVisible && !isModal) {
    return (
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 bg-slate-800/50 hover:bg-slate-800 border border-slate-700 rounded-lg transition-colors"
      >
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-blue-400" />
          <span className="text-sm font-medium text-slate-300">查看命名规则</span>
        </div>
        <ChevronDown size={16} className="text-slate-400" />
      </button>
    );
  }
  
  // 浮窗模式：只显示内容，不显示标题栏（因为浮窗已有标题栏）
  if (isModal) {
    return (
      <div className="space-y-4">
        {/* 当前资源类型规则 */}
        {currentRule && (
          <div className="bg-slate-900/50 rounded-lg p-4 border border-blue-500/30">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 size={16} className="text-blue-400" />
              <h3 className="text-sm font-semibold text-blue-400">
                {currentRule.category} - {currentRule.subCategory}
              </h3>
            </div>
            
            {currentRule.rules.map((rule, index) => (
              <div key={index} className="space-y-3">
                {/* 环境标识 */}
                {rule.environment && (
                  <div className="flex items-center gap-2">
                    {rule.environment === 'both' && (
                      <span className="px-2 py-1 text-xs font-medium bg-blue-500/20 text-blue-300 rounded border border-blue-500/30">
                        适用：实现环境 + 引擎环境
                      </span>
                    )}
                    {rule.environment === 'implementation' && (
                      <span className="px-2 py-1 text-xs font-medium bg-purple-500/20 text-purple-300 rounded border border-purple-500/30">
                        适用：实现环境（美术制作）
                      </span>
                    )}
                    {rule.environment === 'engine' && (
                      <span className="px-2 py-1 text-xs font-medium bg-green-500/20 text-green-300 rounded border border-green-500/30">
                        适用：引擎环境（生产环境）
                      </span>
                    )}
                  </div>
                )}
                
                {/* 前缀和格式 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-slate-500 mb-1">引擎环境前缀</div>
                    <div className="text-sm font-mono text-blue-300 bg-slate-800 px-2 py-1 rounded">
                      {rule.prefix || '无'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-1">引擎环境格式</div>
                    <div className="text-sm font-mono text-green-300 bg-slate-800 px-2 py-1 rounded">
                      {rule.format}
                    </div>
                  </div>
                </div>
                
                {/* 实现环境格式（如果有） */}
                {rule.implementationFormat && (
                  <div>
                    <div className="text-xs text-slate-500 mb-1">实现环境格式（美术制作）</div>
                    <div className="text-sm font-mono text-purple-300 bg-slate-800 px-2 py-1 rounded">
                      {rule.implementationFormat}
                    </div>
                  </div>
                )}

                {/* 描述 */}
                {rule.description && (
                  <div>
                    <div className="text-xs text-slate-500 mb-1">规则描述</div>
                    <div className="text-sm text-slate-300">{rule.description}</div>
                  </div>
                )}

                {/* 引擎环境示例 */}
                {rule.engineExamples && rule.engineExamples.length > 0 && (
                  <div>
                    <div className="text-xs text-slate-500 mb-2">引擎环境示例</div>
                    <div className="space-y-1">
                      {rule.engineExamples.map((example, idx) => (
                        <div 
                          key={idx}
                          className="text-sm font-mono text-green-300 bg-slate-800 px-2 py-1 rounded"
                        >
                          {example}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* 通用示例 */}
                {rule.examples && rule.examples.length > 0 && (
                  <div>
                    <div className="text-xs text-slate-500 mb-2">命名示例</div>
                    <div className="space-y-1">
                      {rule.examples.map((example, idx) => (
                        <div 
                          key={idx}
                          className="text-sm font-mono text-yellow-300 bg-slate-800 px-2 py-1 rounded"
                        >
                          {example}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 升级规则 */}
                {rule.upgradeRule && (
                  <div>
                    <div className="text-xs text-slate-500 mb-2">升级规则</div>
                    <div className="text-sm text-slate-300 whitespace-pre-line bg-slate-800 px-3 py-2 rounded">
                      {rule.upgradeRule}
                    </div>
                  </div>
                )}

                {/* ID结构 */}
                {rule.idStructure && (
                  <div>
                    <div className="text-xs text-slate-500 mb-2">ID结构说明</div>
                    <div className="text-sm text-slate-300 whitespace-pre-line bg-slate-800 px-3 py-2 rounded">
                      {rule.idStructure}
                    </div>
                  </div>
                )}

                {/* 注意事项 */}
                {rule.notes && rule.notes.length > 0 && (
                  <div>
                    <div className="text-xs text-slate-500 mb-2">注意事项</div>
                    <ul className="space-y-1">
                      {rule.notes.map((note, idx) => (
                        <li key={idx} className="text-sm text-slate-400 flex items-start gap-2">
                          <span className="text-blue-400 mt-0.5">•</span>
                          <span>{note}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 未选择资源类型时的提示 */}
        {!currentRule && (
          <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center gap-2 text-slate-400">
              <Info size={16} />
              <span className="text-sm">请先选择资源类型以查看对应的命名规则</span>
            </div>
          </div>
        )}

        {/* 9位ID结构说明 */}
        <div className="bg-slate-900/50 rounded-lg border border-slate-700">
          <button
            onClick={() => toggleSection('id-structure')}
            className="w-full flex items-center justify-between p-3 hover:bg-slate-800 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Lightbulb size={16} className="text-yellow-400" />
              <span className="text-sm font-medium text-slate-300">{ID_STRUCTURE_GUIDE.title}</span>
            </div>
            {expandedSections.has('id-structure') ? (
              <ChevronUp size={16} className="text-slate-400" />
            ) : (
              <ChevronDown size={16} className="text-slate-400" />
            )}
          </button>
          
          {expandedSections.has('id-structure') && (
            <div className="p-4 space-y-4 border-t border-slate-700">
              {/* ID结构 */}
              <div>
                <div className="text-xs text-slate-500 mb-2">结构格式</div>
                <div className="text-lg font-mono text-blue-300 bg-slate-800 px-3 py-2 rounded text-center">
                  {ID_STRUCTURE_GUIDE.structure}
                </div>
              </div>

              {/* 各部分说明 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {ID_STRUCTURE_GUIDE.parts.map((part, index) => (
                  <div key={index} className="bg-slate-800 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-mono text-blue-400">{part.position}</span>
                      <span className="text-sm font-medium text-slate-300">{part.name}</span>
                      <span className="text-xs text-slate-500">({part.range})</span>
                    </div>
                    <div className="space-y-1">
                      {part.values.map((value, idx) => (
                        <div key={idx} className="text-xs text-slate-400">
                          <span className="font-mono text-yellow-300">{value.code}</span>
                          <span className="ml-2">{value.meaning}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* ID示例 */}
              <div>
                <div className="text-xs text-slate-500 mb-2">ID示例</div>
                <div className="space-y-2">
                  {ID_STRUCTURE_GUIDE.examples.map((example, idx) => (
                    <div key={idx} className="flex items-center gap-3 bg-slate-800 rounded-lg p-2">
                      <span className="text-sm font-mono text-green-300 min-w-[100px]">
                        {example.id}
                      </span>
                      <span className="text-sm text-slate-300">{example.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 通用提示 */}
        <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <Lightbulb size={16} className="text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-blue-300 space-y-1">
              <div className="font-medium">高效命名建议：</div>
              <ul className="list-disc list-inside space-y-1 text-blue-400/80">
                <li>选择资源类型后，系统会自动显示对应的命名规则和示例</li>
                <li>按照规则填写占位符，系统会自动生成符合规范的命名</li>
                <li>ID结构遵循9位规则，确保ID的唯一性和可读性</li>
                <li>升级资源时注意使用正确的后缀格式（如bullet_XXX_1）</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  // 非浮窗模式：显示完整面板（带标题栏）
  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden">
      {/* 标题栏 */}
      <div 
        className="flex items-center justify-between p-3 bg-slate-900/50 cursor-pointer hover:bg-slate-800 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-blue-400" />
          <span className="text-sm font-medium text-slate-300">命名规则说明</span>
        </div>
        <ChevronUp size={16} className="text-slate-400" />
      </div>

      {/* 内容区域 */}
      <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
        {/* 当前资源类型规则 */}
        {currentRule && (
          <div className="bg-slate-900/50 rounded-lg p-4 border border-blue-500/30">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 size={16} className="text-blue-400" />
              <h3 className="text-sm font-semibold text-blue-400">
                {currentRule.category} - {currentRule.subCategory}
              </h3>
            </div>
            
            {currentRule.rules.map((rule, index) => (
              <div key={index} className="space-y-3">
                {/* 环境标识 */}
                {rule.environment && (
                  <div className="flex items-center gap-2">
                    {rule.environment === 'both' && (
                      <span className="px-2 py-1 text-xs font-medium bg-blue-500/20 text-blue-300 rounded border border-blue-500/30">
                        适用：实现环境 + 引擎环境
                      </span>
                    )}
                    {rule.environment === 'implementation' && (
                      <span className="px-2 py-1 text-xs font-medium bg-purple-500/20 text-purple-300 rounded border border-purple-500/30">
                        适用：实现环境（美术制作）
                      </span>
                    )}
                    {rule.environment === 'engine' && (
                      <span className="px-2 py-1 text-xs font-medium bg-green-500/20 text-green-300 rounded border border-green-500/30">
                        适用：引擎环境（生产环境）
                      </span>
                    )}
                  </div>
                )}
                
                {/* 前缀和格式 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-slate-500 mb-1">引擎环境前缀</div>
                    <div className="text-sm font-mono text-blue-300 bg-slate-800 px-2 py-1 rounded">
                      {rule.prefix || '无'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-1">引擎环境格式</div>
                    <div className="text-sm font-mono text-green-300 bg-slate-800 px-2 py-1 rounded">
                      {rule.format}
                    </div>
                  </div>
                </div>
                
                {/* 实现环境格式（如果有） */}
                {rule.implementationFormat && (
                  <div>
                    <div className="text-xs text-slate-500 mb-1">实现环境格式（美术制作）</div>
                    <div className="text-sm font-mono text-purple-300 bg-slate-800 px-2 py-1 rounded">
                      {rule.implementationFormat}
                    </div>
                  </div>
                )}

                {/* 描述 */}
                {rule.description && (
                  <div>
                    <div className="text-xs text-slate-500 mb-1">规则描述</div>
                    <div className="text-sm text-slate-300">{rule.description}</div>
                  </div>
                )}

                {/* 引擎环境示例 */}
                {rule.engineExamples && rule.engineExamples.length > 0 && (
                  <div>
                    <div className="text-xs text-slate-500 mb-2">引擎环境示例</div>
                    <div className="space-y-1">
                      {rule.engineExamples.map((example, idx) => (
                        <div 
                          key={idx}
                          className="text-sm font-mono text-green-300 bg-slate-800 px-2 py-1 rounded"
                        >
                          {example}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* 通用示例 */}
                {rule.examples && rule.examples.length > 0 && (
                  <div>
                    <div className="text-xs text-slate-500 mb-2">命名示例</div>
                    <div className="space-y-1">
                      {rule.examples.map((example, idx) => (
                        <div 
                          key={idx}
                          className="text-sm font-mono text-yellow-300 bg-slate-800 px-2 py-1 rounded"
                        >
                          {example}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 升级规则 */}
                {rule.upgradeRule && (
                  <div>
                    <div className="text-xs text-slate-500 mb-2">升级规则</div>
                    <div className="text-sm text-slate-300 whitespace-pre-line bg-slate-800 px-3 py-2 rounded">
                      {rule.upgradeRule}
                    </div>
                  </div>
                )}

                {/* ID结构 */}
                {rule.idStructure && (
                  <div>
                    <div className="text-xs text-slate-500 mb-2">ID结构说明</div>
                    <div className="text-sm text-slate-300 whitespace-pre-line bg-slate-800 px-3 py-2 rounded">
                      {rule.idStructure}
                    </div>
                  </div>
                )}

                {/* 注意事项 */}
                {rule.notes && rule.notes.length > 0 && (
                  <div>
                    <div className="text-xs text-slate-500 mb-2">注意事项</div>
                    <ul className="space-y-1">
                      {rule.notes.map((note, idx) => (
                        <li key={idx} className="text-sm text-slate-400 flex items-start gap-2">
                          <span className="text-blue-400 mt-0.5">•</span>
                          <span>{note}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 未选择资源类型时的提示 */}
        {!currentRule && (
          <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center gap-2 text-slate-400">
              <Info size={16} />
              <span className="text-sm">请先选择资源类型以查看对应的命名规则</span>
            </div>
          </div>
        )}

        {/* 9位ID结构说明 */}
        <div className="bg-slate-900/50 rounded-lg border border-slate-700">
          <button
            onClick={() => toggleSection('id-structure')}
            className="w-full flex items-center justify-between p-3 hover:bg-slate-800 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Lightbulb size={16} className="text-yellow-400" />
              <span className="text-sm font-medium text-slate-300">{ID_STRUCTURE_GUIDE.title}</span>
            </div>
            {expandedSections.has('id-structure') ? (
              <ChevronUp size={16} className="text-slate-400" />
            ) : (
              <ChevronDown size={16} className="text-slate-400" />
            )}
          </button>
          
          {expandedSections.has('id-structure') && (
            <div className="p-4 space-y-4 border-t border-slate-700">
              {/* ID结构 */}
              <div>
                <div className="text-xs text-slate-500 mb-2">结构格式</div>
                <div className="text-lg font-mono text-blue-300 bg-slate-800 px-3 py-2 rounded text-center">
                  {ID_STRUCTURE_GUIDE.structure}
                </div>
              </div>

              {/* 各部分说明 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {ID_STRUCTURE_GUIDE.parts.map((part, index) => (
                  <div key={index} className="bg-slate-800 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-mono text-blue-400">{part.position}</span>
                      <span className="text-sm font-medium text-slate-300">{part.name}</span>
                      <span className="text-xs text-slate-500">({part.range})</span>
                    </div>
                    <div className="space-y-1">
                      {part.values.map((value, idx) => (
                        <div key={idx} className="text-xs text-slate-400">
                          <span className="font-mono text-yellow-300">{value.code}</span>
                          <span className="ml-2">{value.meaning}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* ID示例 */}
              <div>
                <div className="text-xs text-slate-500 mb-2">ID示例</div>
                <div className="space-y-2">
                  {ID_STRUCTURE_GUIDE.examples.map((example, idx) => (
                    <div key={idx} className="flex items-center gap-3 bg-slate-800 rounded-lg p-2">
                      <span className="text-sm font-mono text-green-300 min-w-[100px]">
                        {example.id}
                      </span>
                      <span className="text-sm text-slate-300">{example.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 通用提示 */}
        <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <Lightbulb size={16} className="text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-blue-300 space-y-1">
              <div className="font-medium">高效命名建议：</div>
              <ul className="list-disc list-inside space-y-1 text-blue-400/80">
                <li>选择资源类型后，系统会自动显示对应的命名规则和示例</li>
                <li>按照规则填写占位符，系统会自动生成符合规范的命名</li>
                <li>ID结构遵循9位规则，确保ID的唯一性和可读性</li>
                <li>升级资源时注意使用正确的后缀格式（如bullet_XXX_1）</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DanmakuNamingRulesPanel;

