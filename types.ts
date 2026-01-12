export type PathType = 'web' | 'local' | 'network' | 'app';

// 路径项接口定义
export interface PathItem {
  id: string;
  name: string;
  path: string;
  type: PathType;
  group?: string; // 分组名称
  description?: string;
  icon?: string; // 应用图标（base64 或路径）
}

// 命名分类接口
export interface NamingCategory {
  id: string;
  label: string;
  prefix: string;
  subTypes?: NamingSubType[];
}

// 命名子类型接口
export interface NamingSubType {
  id: string;
  label: string;
  suffix: string;
}

// 命名预设接口
export interface NamingPreset {
  id: string;
  label: string;
  categories: NamingCategory[];
  // 弹幕游戏专用：命名公式
  namingFormula?: string;
  // 弹幕游戏专用：资源类型定义
  resourceTypes?: DanmakuResourceType[];
}

// 弹幕游戏：资源类型定义（包含命名公式）
export interface DanmakuResourceType {
  id: string;
  category: string; // 分类：战斗资源、怪物资源等
  subCategory: string; // 细分：子弹-元素、子弹-融合等
  prefix: string; // 前缀：blt, blt_mix, vfx_hit等
  namingFormula: string; // 命名公式：blt_[Element]_[Shape]_[Level]
  example: string; // 示例：blt_fire_ball_v1.png
}

// 弹幕游戏：词典项（用于填充命名公式中的占位符）
export interface DanmakuDictionary {
  category: string; // 词典分类：元素、怪物体型、怪物职业等
  items: DanmakuDictionaryItem[]; // 词典项列表
}

// 弹幕游戏：词典项
export interface DanmakuDictionaryItem {
  id: string;
  label: string; // 中文
  abbr: string; // 缩写
  note?: string; // 备注
}

// 命名状态接口
export interface NamingState {
  categoryId: string;
  subTypeId: string;
  rawName: string;
  translatedName: string;
}

// 翻译响应接口
export interface TranslationResponse {
  englishName: string;
}

// 特殊后缀选项接口
export interface SpecialSuffix {
  id: string;
  label: string;
  suffix: string; // 添加到名称后的后缀
}

// 命名历史记录接口
export interface NamingHistoryItem {
  id: string;
  timestamp: number; // 时间戳
  presetId: string; // 使用的模板ID
  presetLabel: string; // 模板名称
  controlCategory?: string; // 资产分类
  assetType?: string; // 子类型/变体
  rawInput: string; // 原始输入
  translatedPart?: string; // 翻译部分
  finalName: string; // 最终命名（英文）
  chineseName?: string; // 中文命名
  caseFormat: 'pascal' | 'camel' | 'lower'; // 大小写格式
  separatorFormat: 'underscore' | 'hyphen' | 'none'; // 分隔符格式
  specialSuffixes: string[]; // 激活的特殊后缀
}