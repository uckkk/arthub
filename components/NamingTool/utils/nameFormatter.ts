/**
 * 名称格式化工具函数
 */

export function formatName(
  text: string,
  caseFormat: 'pascal' | 'camel' | 'lower',
  separatorFormat: 'underscore' | 'hyphen' | 'none'
): string {
  if (!text) return '';
  
  // 先转换为单词数组（处理各种格式）
  let words: string[] = [];
  
  // 处理已经是驼峰或下划线的格式
  if (text.includes('_') || text.includes('-')) {
    words = text.split(/[_\-\s]+/).filter(w => w);
  } else if (/[a-z][A-Z]/.test(text)) {
    // 驼峰格式：camelCase 或 PascalCase
    words = text.replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/).filter(w => w);
  } else {
    // 单个单词或全大写
    words = [text];
  }
  
  // 转换为小写单词数组
  words = words.map(w => w.toLowerCase());
  
  // 应用大小写格式
  let formattedWords: string[] = [];
  if (caseFormat === 'pascal') {
    // 大驼峰：每个单词首字母大写
    formattedWords = words.map(w => w.charAt(0).toUpperCase() + w.slice(1));
  } else if (caseFormat === 'camel') {
    // 小驼峰：第一个单词小写，其余首字母大写
    formattedWords = words.map((w, i) => i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1));
  } else {
    // 全小写
    formattedWords = words;
  }
  
  // 应用分隔符格式
  if (separatorFormat === 'underscore') {
    return formattedWords.join('_');
  } else if (separatorFormat === 'hyphen') {
    return formattedWords.join('-');
  } else {
    // 无划线：直接连接
    return formattedWords.join('');
  }
}
