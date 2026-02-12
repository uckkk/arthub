/**
 * 综合安全评分引擎
 * 
 * 维度:
 * A - 平台适配 (安全区、异形屏、小程序)
 * B - 视觉显著性 (热力图分析)
 * C - 可读性 (WCAG 对比度)
 * D - 操作效率 (热区 + Fitts's Law)
 */

export interface DimensionScore {
  /** 维度标识 */
  id: string;
  /** 维度名称 */
  name: string;
  /** 图标 */
  icon: string;
  /** 得分 0-100 */
  score: number;
  /** 最大分 */
  maxScore: number;
  /** 等级 */
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  /** 详细说明 */
  details: string[];
  /** 权重 (0-1) */
  weight: number;
}

export interface AuditReport {
  /** 总分 0-100 */
  totalScore: number;
  /** 总等级 */
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  /** 各维度分数 */
  dimensions: DimensionScore[];
  /** 建议 */
  suggestions: string[];
  /** 时间戳 */
  timestamp: number;
}

function getGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export const GRADE_COLORS: Record<string, string> = {
  A: '#22c55e',
  B: '#3b82f6',
  C: '#f59e0b',
  D: '#f97316',
  F: '#ef4444',
};

// ---- 维度 A: 平台适配评分 ----

export interface PlatformAdaptInput {
  /** 叠加层覆盖的警告数 */
  overlayWarnings: number;
  /** 是否有刘海/灵动岛冲突 */
  hasCutoutConflict: boolean;
  /** 是否有安全区冲突 */
  hasSafeAreaConflict: boolean;
  /** 小程序叠加数 */
  miniProgramCount: number;
}

export function scorePlatformAdapt(input: PlatformAdaptInput): DimensionScore {
  let score = 100;
  const details: string[] = [];

  if (input.overlayWarnings > 0) {
    const deduction = Math.min(input.overlayWarnings * 8, 40);
    score -= deduction;
    details.push(`检测到 ${input.overlayWarnings} 个叠加层警告 (-${deduction})`);
  }
  if (input.hasCutoutConflict) {
    score -= 20;
    details.push('异形屏区域存在内容冲突 (-20)');
  }
  if (input.hasSafeAreaConflict) {
    score -= 15;
    details.push('安全区域存在内容冲突 (-15)');
  }
  if (input.miniProgramCount > 0) {
    details.push(`已适配 ${input.miniProgramCount} 个小程序平台`);
  }

  if (details.length === 0) details.push('所有平台适配检查通过');

  score = Math.max(0, Math.min(100, score));

  return {
    id: 'platform',
    name: '平台适配',
    icon: '📱',
    score,
    maxScore: 100,
    grade: getGrade(score),
    details,
    weight: 0.3,
  };
}

// ---- 维度 B: 视觉显著性评分 ----

export interface SaliencyInput {
  /** 是否已分析 */
  analyzed: boolean;
  /** 高显著区域集中度 (0-1, 越集中说明有明确焦点) */
  focusConcentration?: number;
  /** 高显著区域是否在安全区内 */
  focusInSafeArea?: boolean;
}

export function scoreSaliency(input: SaliencyInput): DimensionScore {
  let score = 100;
  const details: string[] = [];

  if (!input.analyzed) {
    return {
      id: 'saliency',
      name: '视觉显著性',
      icon: '🔥',
      score: 0,
      maxScore: 100,
      grade: 'F',
      details: ['未进行视觉显著性分析'],
      weight: 0.2,
    };
  }

  if (input.focusConcentration !== undefined) {
    if (input.focusConcentration > 0.6) {
      details.push(`视觉焦点集中度高 (${(input.focusConcentration * 100).toFixed(0)}%)，画面引导清晰`);
    } else if (input.focusConcentration > 0.3) {
      score -= 15;
      details.push(`视觉焦点适中 (${(input.focusConcentration * 100).toFixed(0)}%)，可优化引导 (-15)`);
    } else {
      score -= 30;
      details.push(`视觉焦点分散 (${(input.focusConcentration * 100).toFixed(0)}%)，缺乏明确引导 (-30)`);
    }
  }

  if (input.focusInSafeArea === false) {
    score -= 20;
    details.push('主要视觉焦点位于安全区外 (-20)');
  }

  if (details.length === 0) details.push('视觉显著性分析正常');

  score = Math.max(0, Math.min(100, score));

  return {
    id: 'saliency',
    name: '视觉显著性',
    icon: '🔥',
    score,
    maxScore: 100,
    grade: getGrade(score),
    details,
    weight: 0.2,
  };
}

// ---- 维度 C: 可读性评分 ----

export interface ReadabilityInput {
  /** 检测的对比度结果 */
  contrastResults: Array<{ ratio: number; pass: boolean }>;
  /** 文本尺寸检测 */
  textSizeResults: Array<{ pass: boolean }>;
  /** 触控目标检测 */
  touchTargetResults: Array<{ pass: boolean }>;
}

export function scoreReadability(input: ReadabilityInput): DimensionScore {
  let score = 100;
  const details: string[] = [];

  if (input.contrastResults.length === 0 &&
      input.textSizeResults.length === 0 &&
      input.touchTargetResults.length === 0) {
    return {
      id: 'readability',
      name: '可读性',
      icon: '👁',
      score: 0,
      maxScore: 100,
      grade: 'F',
      details: ['未进行可读性检测'],
      weight: 0.25,
    };
  }

  // 对比度
  if (input.contrastResults.length > 0) {
    const failCount = input.contrastResults.filter(r => !r.pass).length;
    if (failCount > 0) {
      const deduction = Math.min(failCount * 15, 40);
      score -= deduction;
      details.push(`${failCount}/${input.contrastResults.length} 个颜色对比度不达标 (-${deduction})`);
    } else {
      details.push(`所有 ${input.contrastResults.length} 个颜色对比度达标`);
    }
  }

  // 文本尺寸
  if (input.textSizeResults.length > 0) {
    const failCount = input.textSizeResults.filter(r => !r.pass).length;
    if (failCount > 0) {
      const deduction = Math.min(failCount * 10, 30);
      score -= deduction;
      details.push(`${failCount} 处文本尺寸低于推荐值 (-${deduction})`);
    }
  }

  // 触控目标
  if (input.touchTargetResults.length > 0) {
    const failCount = input.touchTargetResults.filter(r => !r.pass).length;
    if (failCount > 0) {
      const deduction = Math.min(failCount * 10, 30);
      score -= deduction;
      details.push(`${failCount} 个触控目标小于最低要求 (-${deduction})`);
    }
  }

  score = Math.max(0, Math.min(100, score));

  return {
    id: 'readability',
    name: '可读性',
    icon: '👁',
    score,
    maxScore: 100,
    grade: getGrade(score),
    details,
    weight: 0.25,
  };
}

// ---- 维度 D: 操作效率评分 ----

export interface EfficiencyInput {
  /** Fitts's Law 测量 */
  fittsResults: Array<{ indexOfDifficulty: number; rating: string }>;
  /** 关键操作是否在舒适区 */
  criticalInEasyZone?: boolean;
}

export function scoreEfficiency(input: EfficiencyInput): DimensionScore {
  let score = 100;
  const details: string[] = [];

  if (input.fittsResults.length === 0 && input.criticalInEasyZone === undefined) {
    return {
      id: 'efficiency',
      name: '操作效率',
      icon: '👆',
      score: 0,
      maxScore: 100,
      grade: 'F',
      details: ['未进行操作效率分析'],
      weight: 0.25,
    };
  }

  if (input.fittsResults.length > 0) {
    const avgID = input.fittsResults.reduce((s, r) => s + r.indexOfDifficulty, 0) / input.fittsResults.length;
    const hardCount = input.fittsResults.filter(r => r.rating === 'hard').length;

    if (avgID > 4) {
      score -= 35;
      details.push(`平均操作难度过高 (ID=${avgID.toFixed(1)}) (-35)`);
    } else if (avgID > 2.5) {
      score -= 15;
      details.push(`平均操作难度中等 (ID=${avgID.toFixed(1)}) (-15)`);
    } else {
      details.push(`平均操作难度低 (ID=${avgID.toFixed(1)})，操作流畅`);
    }

    if (hardCount > 0) {
      score -= hardCount * 10;
      details.push(`${hardCount} 个操作路径评级为"困难" (-${hardCount * 10})`);
    }
  }

  if (input.criticalInEasyZone === false) {
    score -= 20;
    details.push('关键操作不在拇指舒适区 (-20)');
  } else if (input.criticalInEasyZone === true) {
    details.push('关键操作在拇指舒适区内');
  }

  score = Math.max(0, Math.min(100, score));

  return {
    id: 'efficiency',
    name: '操作效率',
    icon: '👆',
    score,
    maxScore: 100,
    grade: getGrade(score),
    details,
    weight: 0.25,
  };
}

// ---- 综合评分 ----

export function generateReport(
  platform: PlatformAdaptInput,
  saliency: SaliencyInput,
  readability: ReadabilityInput,
  efficiency: EfficiencyInput,
): AuditReport {
  const dimensions = [
    scorePlatformAdapt(platform),
    scoreSaliency(saliency),
    scoreReadability(readability),
    scoreEfficiency(efficiency),
  ];

  // 加权总分
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const totalScore = Math.round(
    dimensions.reduce((s, d) => s + d.score * d.weight, 0) / totalWeight
  );

  // 生成建议
  const suggestions: string[] = [];
  for (const dim of dimensions) {
    if (dim.grade === 'D' || dim.grade === 'F') {
      suggestions.push(`⚠️ ${dim.name}评分过低 (${dim.grade})，建议优先优化`);
    } else if (dim.grade === 'C') {
      suggestions.push(`💡 ${dim.name}有提升空间 (${dim.grade})，可进一步优化`);
    }
  }

  if (suggestions.length === 0) {
    suggestions.push('✅ 整体表现良好，继续保持！');
  }

  return {
    totalScore,
    grade: getGrade(totalScore),
    dimensions,
    suggestions,
    timestamp: Date.now(),
  };
}
