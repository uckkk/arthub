/**
 * NamingTool 常量定义
 */

import { SpecialSuffix } from '../../types';

// 特殊后缀选项定义
export const SPECIAL_SUFFIXES: SpecialSuffix[] = [
  { id: 'jiugong', label: '九宫', suffix: 'Ns' },
  // 预留其他特殊后缀
  // { id: 'other1', label: '其他1', suffix: 'S1' },
  // { id: 'other2', label: '其他2', suffix: 'S2' },
];

// 预设ID列表
export const PRESET_IDS = ['fgui_card', 'fgui_danmaku', 'generic_rpg'] as const;

// 获取模板的默认格式
export const getDefaultFormat = (presetId: string): { 
  case: 'pascal' | 'camel' | 'lower', 
  separator: 'underscore' | 'hyphen' | 'none' 
} => {
  switch (presetId) {
    case 'fgui_card': // 棋牌游戏：大驼峰 + 无划线
      return { case: 'pascal', separator: 'none' };
    case 'fgui_danmaku': // 弹幕游戏：全小写 + 下划线
      return { case: 'lower', separator: 'underscore' };
    case 'generic_rpg': // 通用游戏：大驼峰 + 下划线
      return { case: 'pascal', separator: 'underscore' };
    default:
      return { case: 'pascal', separator: 'underscore' };
  }
};
