// 命名数据服务 - 从GitHub获取CSV数据
import { NamingPreset } from '../types';

// 模板ID到CSV URL的映射
const PRESET_URL_MAP: Record<string, string> = {
  'fgui_card': 'https://raw.githubusercontent.com/uckkk/ArtAssetNamingConfig/main/QPArtName.csv',
  'fgui_danmaku': 'https://raw.githubusercontent.com/uckkk/ArtAssetNamingConfig/main/DMArtName.csv',
  'generic_rpg': 'https://raw.githubusercontent.com/uckkk/ArtAssetNamingConfig/main/0GameArtName.csv',
};

// 从GitHub获取CSV数据（带超时和重试机制）
export async function fetchNamingData(presetId: string, retries = 2): Promise<string> {
  const url = PRESET_URL_MAP[presetId];
  if (!url) {
    throw new Error(`Unknown preset ID: ${presetId}`);
  }
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // 创建 AbortController 用于超时控制
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
      
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          cache: 'no-cache', // 禁用缓存，确保获取最新数据
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch naming data: ${response.status} ${response.statusText}`);
        }
        
        const text = await response.text();
        if (!text || text.trim().length === 0) {
          throw new Error('返回的数据为空');
        }
        
        return text;
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        
        // 如果是最后一次尝试，抛出错误
        if (attempt === retries) {
          if (fetchError.name === 'AbortError') {
            throw new Error('请求超时，请检查网络连接');
          }
          throw fetchError;
        }
        
        // 如果不是最后一次尝试，等待后重试
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); // 递增延迟
          continue;
        }
        
        throw fetchError;
      }
    } catch (error: any) {
      // 最后一次尝试失败，记录错误并抛出
      if (attempt === retries) {
        console.error(`Error fetching naming data for ${presetId} (attempt ${attempt + 1}/${retries + 1}):`, error);
        throw error;
      }
    }
  }
  
  // 理论上不会到达这里，但为了类型安全
  throw new Error('Failed to fetch naming data after retries');
}

// 解析CSV数据为预设
// CSV格式：控件分类,控件英文缩写,英文全称,,资产词典,资产英文缩写,英文全称
// 逻辑：控件分类和资产词典是并列关系，可以相互组合
export function parseCsvToPresets(csv: string, presetId: string, presetLabel: string): NamingPreset {
  const lines = csv.split('\n').filter(line => line.trim() !== '');
  const preset: NamingPreset = { id: presetId, label: presetLabel, categories: [] };
  
  // 跳过表头
  if (lines.length === 0) return preset;
  const dataLines = lines.slice(1);
  
  // 存储控件分类（作为第一个分类组）
  const controlCategories = new Map<string, { id: string; label: string; prefix: string }>();
  // 存储资产词典（作为第二个分类组，作为子类型）
  const assetTypes = new Map<string, { id: string; label: string; suffix: string }>();

  dataLines.forEach((line) => {
    // 处理CSV，考虑引号内的逗号
    const cols = parseCSVLine(line);
    if (cols.length < 7) return;

    const [controlCategory, controlAbbr, controlFull, empty, assetCategory, assetAbbr, assetFull] = cols;
    
    // 处理控件分类（资产分类）
    if (controlCategory && controlCategory.trim() && controlAbbr && controlAbbr.trim()) {
      const catId = `ctrl_${controlCategory.trim()}`;
      const catLabel = controlCategory.trim();
      const prefix = controlAbbr.trim();
      
      if (!controlCategories.has(catId)) {
        controlCategories.set(catId, {
          id: catId,
          label: catLabel,
          prefix: prefix
        });
      }
    }
    
    // 处理资产词典（子类型/变体）
    if (assetCategory && assetCategory.trim() && assetAbbr && assetAbbr.trim()) {
      const typeId = assetAbbr.trim().toLowerCase();
      const typeLabel = assetCategory.trim();
      // 后缀：如果有英文全称，使用它；否则使用资产英文缩写
      const suffix = assetFull?.trim() || assetAbbr.trim();
      
      if (!assetTypes.has(typeId)) {
        assetTypes.set(typeId, {
          id: typeId,
          label: typeLabel,
          suffix: suffix ? `_${suffix}` : ''
        });
      }
    }
  });

  // 创建分类结构
  // 第一个分类：控件分类（资产分类）
  if (controlCategories.size > 0) {
    const controlCategory = {
      id: 'control_categories',
      label: '资产分类',
      prefix: '', // 控件分类的前缀在子项中
      subTypes: Array.from(controlCategories.values()).map(ctrl => ({
        id: ctrl.id,
        label: ctrl.label,
        suffix: ctrl.prefix // 将前缀作为后缀存储，在构建名称时使用
      }))
    };
    preset.categories.push(controlCategory);
  }
  
  // 第二个分类：资产词典（子类型/变体）
  if (assetTypes.size > 0) {
    const assetCategory = {
      id: 'asset_types',
      label: '子类型/变体',
      prefix: '',
      subTypes: Array.from(assetTypes.values())
    };
    preset.categories.push(assetCategory);
  }
  
  // 如果没有找到任何分类，创建一个默认分类
  if (preset.categories.length === 0) {
    preset.categories = [{
      id: 'default',
      label: '默认分类',
      prefix: '',
      subTypes: []
    }];
  }
  
  return preset;
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

// 获取预设标签
export function getPresetLabel(presetId: string): string {
  const labelMap: Record<string, string> = {
    'fgui_card': '棋牌游戏',
    'fgui_danmaku': '弹幕游戏',
    'generic_rpg': '通用游戏',
  };
  return labelMap[presetId] || presetId;
}
