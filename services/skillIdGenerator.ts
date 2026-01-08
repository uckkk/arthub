/**
 * 技能ID生成器
 * 根据资源类型和选择的词典项，自动生成符合9位ID结构的技能ID
 */

// 资源类型到技能类型（A位）的映射
// 注意：这里的键是category（分类），不是subCategory（子分类）
const RESOURCE_TYPE_TO_SKILL_TYPE: Record<string, number> = {
  '技能资源': 1, // 地图技能
  'buff资源': 1, // 使用对应技能ID，默认地图技能
  '子弹': 1, // 子弹资源，使用对应技能ID，默认地图技能
  '技能ICON资源': 1, // 使用对应技能ID，默认地图技能
  // 可以根据实际需求调整
};

// 根据元素类型生成常规字段（EFGHI位）的建议值
const ELEMENT_TO_ID_SUFFIX: Record<string, string> = {
  'phy': '00000', // 物理
  'fire': '00001', // 火
  'ice': '00002', // 冰
  'psn': '00003', // 毒
  'ltg': '00004', // 雷
  'wnd': '00005', // 风
  'mix': '00006', // 融合
};

/**
 * 生成技能ID建议
 * @param resourceType 资源类型
 * @param placeholderValues 选择的词典项
 * @param skillType 技能类型（1-地图，2-物品，3-怪物，4-英雄），可选
 * @param starLevel 星级（0-9），可选，默认0
 * @param upgradeParam 升级参数（00-99），可选，默认00
 * @returns 9位数字ID字符串
 */
export function generateSkillIdSuggestion(
  resourceType: { category: string; subCategory: string } | null,
  placeholderValues: Map<string, string>,
  skillType?: number,
  starLevel: number = 0,
  upgradeParam: number = 0
): string {
  if (!resourceType) {
    console.warn('[generateSkillIdSuggestion] resourceType is null');
    return '';
  }

  // A位：技能类型（1-地图，2-物品，3-怪物，4-英雄）
  const typeA = skillType || RESOURCE_TYPE_TO_SKILL_TYPE[resourceType.category] || 1;
  
  // B位：星级（0-9）
  const typeB = Math.max(0, Math.min(9, starLevel));
  
  // CD位：升级参数（00-99）
  const typeCD = Math.max(0, Math.min(99, upgradeParam)).toString().padStart(2, '0');
  
  // EFGHI位：常规字段（5位）
  // 尝试从元素词典中获取建议值
  let typeEFGHI = '00000'; // 默认值
  
  // 尝试多种可能的键名来获取元素值
  // 注意：placeholderValues中的键是通过 dict.category.split('(')[0].trim() 生成的
  // 所以对于 "元素 (Element)"，键应该是 "元素"
  const possibleKeys = ['元素', '元素 (Element)', 'Element'];
  let elementValue: string | undefined;
  
  // 先尝试直接匹配键
  for (const key of possibleKeys) {
    const value = placeholderValues.get(key);
    if (value) {
      elementValue = value;
      break;
    }
  }
  
  // 如果没找到，遍历所有键值对查找包含"元素"的键
  if (!elementValue) {
    for (const [key, value] of placeholderValues.entries()) {
      if (key.includes('元素') || key.includes('Element')) {
        elementValue = value;
        break;
      }
    }
  }
  
  console.log('[generateSkillIdSuggestion]', {
    resourceType: { category: resourceType.category, subCategory: resourceType.subCategory },
    placeholderValues: Array.from(placeholderValues.entries()),
    elementValue,
    skillType,
    starLevel,
    upgradeParam
  });
  
  // 如果找到了元素值，尝试匹配
  if (elementValue) {
    const lowerValue = elementValue.toLowerCase();
    // 直接匹配缩写（如 'ice', 'fire'）
    if (ELEMENT_TO_ID_SUFFIX[lowerValue]) {
      typeEFGHI = ELEMENT_TO_ID_SUFFIX[lowerValue];
      console.log('[generateSkillIdSuggestion] 匹配到元素', { elementValue, lowerValue, typeEFGHI });
    } else {
      // 如果没有直接匹配，使用默认值
      console.warn('[generateSkillIdSuggestion] 元素值未匹配', { elementValue, lowerValue, availableKeys: Object.keys(ELEMENT_TO_ID_SUFFIX) });
      typeEFGHI = '00000';
    }
  } else {
    // 如果没有元素信息，使用默认值
    console.warn('[generateSkillIdSuggestion] 未找到元素值', { placeholderValues: Array.from(placeholderValues.entries()) });
    typeEFGHI = '00000';
  }
  
  // 组合成9位ID
  const result = `${typeA}${typeB}${typeCD}${typeEFGHI}`;
  console.log('[generateSkillIdSuggestion] 生成结果', { result, typeA, typeB, typeCD, typeEFGHI });
  return result;
}

/**
 * 解析技能ID的各个部分
 */
export function parseSkillId(skillId: string): {
  typeA: number; // 技能类型
  typeB: number; // 星级
  typeCD: number; // 升级参数
  typeEFGHI: string; // 常规字段
} | null {
  if (!skillId || !/^\d{9}$/.test(skillId)) {
    return null;
  }
  
  return {
    typeA: parseInt(skillId[0], 10),
    typeB: parseInt(skillId[1], 10),
    typeCD: parseInt(skillId.substring(2, 4), 10),
    typeEFGHI: skillId.substring(4, 9)
  };
}

/**
 * 获取技能类型名称
 */
export function getSkillTypeName(typeA: number): string {
  const names: Record<number, string> = {
    1: '地图技能',
    2: '物品技能',
    3: '怪物技能',
    4: '英雄技能'
  };
  return names[typeA] || '未知';
}

