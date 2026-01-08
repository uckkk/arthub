// 弹幕游戏命名服务 - 解析弹幕游戏专用的 CSV 格式
import { DanmakuResourceType, DanmakuDictionary, DanmakuDictionaryItem } from '../types';

// 解析弹幕游戏 CSV 数据
export interface DanmakuNamingData {
  resourceTypes: DanmakuResourceType[];
  dictionaries: Map<string, DanmakuDictionary>; // key: 词典分类名称
}

export function parseDanmakuCsv(csv: string): DanmakuNamingData {
  const lines = csv.split('\n').filter(line => line.trim() !== '');
  const resourceTypes: DanmakuResourceType[] = [];
  const dictionaries = new Map<string, DanmakuDictionary>();
  const seenResourceTypes = new Set<string>(); // 用于去重资源类型
  const seenDictItems = new Map<string, Set<string>>(); // 用于去重词典项

  // 跳过表头
  if (lines.length === 0) {
    return { resourceTypes, dictionaries };
  }
  const dataLines = lines.slice(1);

  dataLines.forEach((line, index) => {
    const cols = parseCSVLine(line);
    if (cols.length < 7) return; // 至少需要7列

    const [
      category,        // 分类 (Category)
      subCategory,     // 细分 (Sub-Cat)
      prefix,          // 前缀 (Prefix)
      empty1,          // 空列
      dictCategory,    // 词典分类
      cnLabel,         // 中文 (CN)
      abbr,            // 缩写 (Abbr)
      note             // 备注 (Note)
    ] = cols;

    // 处理资源类型（有分类、细分、前缀的行）
    if (category && subCategory && prefix) {
      const finalCategory = category.trim();
      let finalSubCategory = subCategory.trim();
      
      // 特殊处理：将子弹的5个细分类型合并为"子弹和技能"
      if (finalCategory === '子弹' && 
          finalSubCategory !== '子弹和技能') {
        finalSubCategory = '子弹和技能';
      }
      
      const resourceKey = `${finalCategory}_${finalSubCategory}`;
      
      // 避免重复（使用分类+细分作为唯一键）
      if (!seenResourceTypes.has(resourceKey)) {
        seenResourceTypes.add(resourceKey);
        
        const resourceType: DanmakuResourceType = {
          id: `res_${resourceKey}`,
          category: finalCategory,
          subCategory: finalSubCategory,
          prefix: prefix.trim(), // 保留第一个前缀作为默认前缀
          namingFormula: prefix.trim(), // 前缀作为基础，词典项会在后续添加
          example: '' // 新格式没有示例
        };
        resourceTypes.push(resourceType);
      }
    }

    // 处理词典（有词典分类的行）
    if (dictCategory && cnLabel && abbr) {
      const dictCategoryKey = dictCategory.trim();
      
      if (!dictionaries.has(dictCategoryKey)) {
        dictionaries.set(dictCategoryKey, {
          category: dictCategoryKey,
          items: []
        });
        seenDictItems.set(dictCategoryKey, new Set());
      }

      const dict = dictionaries.get(dictCategoryKey)!;
      const itemId = abbr.trim().toLowerCase();
      const seenSet = seenDictItems.get(dictCategoryKey)!;
      
      // 检查是否已存在（避免重复）
      if (!seenSet.has(itemId)) {
        seenSet.add(itemId);
        dict.items.push({
          id: itemId,
          label: cnLabel.trim(),
          abbr: abbr.trim(),
          note: note?.trim()
        });
      }
    }
  });

  // 手动添加"单位"和"物品"作为独立的资源类型（与"子弹和技能"同级）
  // 注意：它们不在CSV中，需要程序添加
  const unitKey = '单位_单位';
  if (!seenResourceTypes.has(unitKey)) {
    seenResourceTypes.add(unitKey);
    resourceTypes.push({
      id: 'res_单位_单位',
      category: '单位',
      subCategory: '单位',
      prefix: 'unit_100', // 引擎环境前缀
      namingFormula: 'unit_100',
      example: ''
    });
  }

  const itemKey = '物品_物品';
  if (!seenResourceTypes.has(itemKey)) {
    seenResourceTypes.add(itemKey);
    resourceTypes.push({
      id: 'res_物品_物品',
      category: '物品',
      subCategory: '物品',
      prefix: 'item_10', // 引擎环境前缀
      namingFormula: 'item_10',
      example: ''
    });
  }

  return { resourceTypes, dictionaries };
}

// 解析命名公式，提取占位符
export function parseNamingFormula(formula: string): string[] {
  const placeholders: string[] = [];
  const regex = /\[([^\]]+)\]/g;
  let match;
  
  while ((match = regex.exec(formula)) !== null) {
    const placeholder = match[1];
    if (!placeholders.includes(placeholder)) {
      placeholders.push(placeholder);
    }
  }
  
  return placeholders;
}

// 根据命名公式和选择的词典项生成名称
export function generateNameFromFormula(
  formula: string,
  placeholderValues: Map<string, string>
): string {
  let result = formula;
  
  // 替换所有占位符
  placeholderValues.forEach((value, placeholder) => {
    const regex = new RegExp(`\\[${placeholder}\\]`, 'g');
    result = result.replace(regex, value);
  });
  
  return result;
}

// 解析CSV行，处理引号内的逗号
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

// 根据资源类型分类，获取需要的词典分类列表
export function getDictionariesForResourceCategory(
  category: string,
  dictionaries: Map<string, DanmakuDictionary>
): DanmakuDictionary[] {
  const result: DanmakuDictionary[] = [];
  
  // 根据资源分类确定需要的词典
  // 注意：怪物阶级 (Rank) 已从怪物分类中移除，因为资源类型已经包含了该信息
  // "单位"和"物品"不需要任何词典，只需要ID输入
  const categoryMapping: Record<string, string[]> = {
    '子弹': ['元素 (Element)'],
    '单位': [], // 单位资源不需要词典
    '物品': [], // 物品资源不需要词典
    '怪物': ['怪物体型 (Body)', '怪物职业 (Job)', '动作 (Action)'],
    '角色': ['怪物体型 (Body)', '动作 (Action)'],
    '界面': ['UI控件 (Control)'],
    '图标': ['元素 (Element)'],
    '场景': ['元素 (Element)'], // 场景可能需要主题相关的词典
  };

  const neededDicts = categoryMapping[category] || [];
  
  neededDicts.forEach(dictKey => {
    if (dictionaries.has(dictKey)) {
      result.push(dictionaries.get(dictKey)!);
    }
  });

  // 如果没有找到特定映射，返回所有词典
  if (result.length === 0) {
    return Array.from(dictionaries.values());
  }

  return result;
}

// 根据占位符名称，从词典中查找对应的词典分类（保留用于兼容）
export function findDictionaryForPlaceholder(
  placeholder: string,
  dictionaries: Map<string, DanmakuDictionary>
): DanmakuDictionary | null {
  // 占位符到词典分类的精确映射规则
  const mapping: Record<string, string> = {
    'Element': '元素 (Element)',
    'Ele1': '元素 (Element)',
    'Ele2': '元素 (Element)',
    'Body': '怪物体型 (Body)',
    'Job': '怪物职业 (Job)',
    'ID': '怪物阶级 (Rank)',
    'Rank': '怪物阶级 (Rank)',
    'Action': '动作 (Action)',
    'Control': 'UI控件 (Control)',
  };

  const dictCategoryName = mapping[placeholder];
  if (dictCategoryName && dictionaries.has(dictCategoryName)) {
    return dictionaries.get(dictCategoryName)!;
  }

  return null;
}

