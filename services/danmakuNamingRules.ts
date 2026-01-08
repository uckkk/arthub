/**
 * 弹幕游戏命名规则定义
 * 合并实现环境和引擎环境的命名规则
 * 
 * 实现环境：基于 弹幕美术资源命名_生产实现.csv
 * 引擎环境：基于 美术资源IDV1.4.xlsx（必须使用技能ID，格式：前缀_技能ID）
 */

export interface NamingRule {
  resourceType: string; // 资源类型名称
  prefix: string; // 命名前缀（引擎环境，基于Excel文件）
  description: string; // 规则描述
  format: string; // 命名格式（引擎环境）
  implementationFormat?: string; // 实现环境格式（可选，基于CSV）
  examples: string[]; // 示例列表
  engineExamples?: string[]; // 引擎环境示例（基于Excel）
  idStructure?: string; // ID结构说明（9位ID）
  upgradeRule?: string; // 升级规则说明
  notes?: string[]; // 注意事项
  environment?: 'implementation' | 'engine' | 'both'; // 适用环境
  requiresSkillId?: boolean; // 是否需要技能ID（引擎环境，第一类：技能和球）
  requiresUnitId?: boolean; // 是否需要单位表ID（引擎环境，第二类：场景固定大小资产）
  requiresItemId?: boolean; // 是否需要物品表ID（引擎环境，第三类：掉落物）
  engineNameType?: 'bullet' | 'hit' | 'buff' | 'effect' | 'icon'; // 引擎环境命名类型（用于子弹和技能资源）
}

export interface ResourceTypeRule {
  id: string; // 资源类型ID（对应DanmakuResourceType.id）
  category: string; // 分类
  subCategory: string; // 子分类
  prefix: string; // 前缀（引擎环境，基于Excel文件）
  implementationPrefix?: string; // 实现环境前缀（可选，基于CSV）
  rules: NamingRule[]; // 该资源类型的命名规则列表
}

// 弹幕游戏命名规则库
// 引擎环境规则基于：美术资源IDV1.4.xlsx
// 实现环境规则基于：弹幕美术资源命名_生产实现.csv
export const DANMAKU_NAMING_RULES: ResourceTypeRule[] = [
  // ========== 技能资源（引擎环境：基于Excel） ==========
  {
    id: 'skill_hit',
    category: '技能资源',
    subCategory: '球撞击效果',
    prefix: 'hit_', // Excel文件中的前缀
    rules: [
      {
        resourceType: '球撞击效果',
        prefix: 'hit_',
        description: '技能产生的球撞击效果（引擎环境使用技能ID）',
        format: 'hit_[技能ID]',
        implementationFormat: 'vfx_hit_[元素]_[自定义名称]', // 实现环境使用CSV规则
        examples: [
          'hit_100000001',
          'hit_100000002'
        ],
        engineExamples: [
          'hit_100000001 (激光的球撞击效果)',
          'hit_100000002'
        ],
        notes: [
          '引擎环境：使用技能ID（9位数字），不同级别使用同一个资源',
          '实现环境：使用元素和自定义名称',
          '不需要分级后缀'
        ],
        environment: 'both',
        requiresSkillId: true
      }
    ]
  },
  {
    id: 'skill_effect',
    category: '技能资源',
    subCategory: '额外效果',
    prefix: 'effect_', // Excel文件中的前缀
    rules: [
      {
        resourceType: '额外效果',
        prefix: 'effect_',
        description: '技能发生的额外效果（引擎环境使用技能ID）',
        format: 'effect_[技能ID]',
        implementationFormat: 'vfx_state_[元素]_[自定义名称]', // 实现环境使用CSV规则
        examples: [
          'effect_100000001',
          'effect_100000002'
        ],
        engineExamples: [
          'effect_100000001 (激光球的横特效)',
          'effect_100000002'
        ],
        notes: [
          '引擎环境：使用技能ID（9位数字），不需要分级',
          '实现环境：使用元素和自定义名称'
        ],
        environment: 'both',
        requiresSkillId: true
      }
    ]
  },

  // ========== buff资源（引擎环境：基于Excel） ==========
  {
    id: 'buff',
    category: 'buff资源',
    subCategory: 'buff效果',
    prefix: 'buff_', // Excel文件中的前缀
    rules: [
      {
        resourceType: 'buff资源',
        prefix: 'buff_',
        description: 'buff效果资源（引擎环境使用技能ID）',
        format: 'buff_[技能ID]',
        implementationFormat: 'vfx_buff_[元素]_[自定义名称]', // 实现环境使用CSV规则
        examples: [
          'buff_100000001',
          'buff_100000002'
        ],
        engineExamples: [
          'buff_100000001',
          'buff_100000002'
        ],
        idStructure: '9位ID结构：A B CD EFGHI\n- A位：技能类型（1-地图，2-物品，3-怪物，4-英雄）\n- B位：星级（0-9）\n- CD位：升级参数（00-99）\n- EFGHI位：常规字段（5位）',
        notes: [
          '引擎环境：使用对应技能ID（9位数字）',
          '实现环境：使用元素和自定义名称',
          'buff资源表支持多个buff使用1个资源',
          '子弹表用复制对应ID的方式',
          'ID示例：燃烧（0星）= 100000000，冰冻（0星）= 100000001'
        ],
        environment: 'both',
        requiresSkillId: true
      }
    ]
  },

  // ========== 单位资源（引擎环境：unit_100x，与"子弹和技能"同级） ==========
  {
    id: 'unit',
    category: '单位',
    subCategory: '单位',
    prefix: 'unit_100', // 引擎环境：unit_100x
    rules: [
      {
        resourceType: '单位',
        prefix: 'unit_100',
        description: '单位资源（引擎环境使用单位表ID）',
        format: 'unit_100[单位表ID]',
        examples: [
          'unit_1001',
          'unit_1002'
        ],
        engineExamples: [
          'unit_1001 (单位表ID=1)',
          'unit_1002 (单位表ID=2)'
        ],
        notes: [
          '引擎环境：使用unit_100x格式，x为单位表ID',
          '与"子弹和技能"、"物品"为同级分类'
        ],
        environment: 'engine',
        requiresUnitId: true // 需要单位表ID
      }
    ]
  },

  // ========== 物品资源（引擎环境：item_10x，与"子弹和技能"同级） ==========
  {
    id: 'item',
    category: '物品',
    subCategory: '物品',
    prefix: 'item_10', // 引擎环境：item_10x
    rules: [
      {
        resourceType: '物品',
        prefix: 'item_10',
        description: '物品资源（引擎环境使用物品表ID）',
        format: 'item_10[物品表ID]',
        examples: [
          'item_101',
          'item_102'
        ],
        engineExamples: [
          'item_101 (物品表ID=1)',
          'item_102 (物品表ID=2)'
        ],
        notes: [
          '引擎环境：使用item_10x格式，x为物品表ID',
          '与"子弹和技能"、"单位"为同级分类'
        ],
        environment: 'engine',
        requiresItemId: true // 需要物品表ID
      }
    ]
  },

  // ========== 子弹和技能资源（引擎环境：基于Excel，合并5个细分类型） ==========
  {
    id: 'bullet_and_skill',
    category: '子弹',
    subCategory: '子弹和技能',
    prefix: 'bullet_', // Excel文件中的前缀（默认）
    implementationPrefix: 'blt', // 实现环境使用CSV规则
    rules: [
      {
        resourceType: '子弹和技能',
        prefix: 'bullet_',
        description: '子弹和技能资源（引擎环境使用技能ID，支持升级后缀）',
        format: 'bullet_[技能ID] 或 bullet_[技能ID]_[星级]',
        implementationFormat: 'blt_[元素]_[自定义名称]', // 实现环境使用CSV规则
        examples: [
          'bullet_100000002 (0星，无后缀)',
          'bullet_100000002_1 (1星，带_1后缀)',
          'bullet_100000002_2 (2星，带_2后缀)'
        ],
        engineExamples: [
          'bullet_100000002 (0星，无后缀)',
          'bullet_100000002_1 (1星，带_1后缀)',
          'bullet_100000002_2 (2星，带_2后缀)'
        ],
        upgradeRule: '升级规则（引擎环境）：\n- 0星：bullet_100000002（无后缀）\n- 1星：bullet_100000002_1（带_1后缀）\n- 2星：bullet_100000002_2（带_2后缀）',
        notes: [
          '引擎环境：常规时用技能ID对照，人物子弹初始为0星，不用_后缀',
          '实现环境：使用元素和自定义名称',
          '1星、2星时用_1、_2后缀',
          '加_是为了处理吸收升星子弹长相变化',
          '例如：冰弹0星升级1星时为bullet_100000002_1'
        ],
        environment: 'both',
        requiresSkillId: true,
        engineNameType: 'bullet' // 标记为子弹/投射物ID
      },
      {
        resourceType: '打击爆点',
        prefix: 'hit_',
        description: '打击爆点资源（引擎环境使用技能ID）',
        format: 'hit_[技能ID]',
        implementationFormat: 'vfx_hit_[元素]_[自定义名称]', // 实现环境使用CSV规则
        examples: [
          'hit_100000001',
          'hit_100000002'
        ],
        engineExamples: [
          'hit_100000001 (激光的球撞击效果)',
          'hit_100000002'
        ],
        notes: [
          '引擎环境：使用技能ID（9位数字），不同级别使用同一个资源',
          '实现环境：使用元素和自定义名称',
          '不需要分级后缀'
        ],
        environment: 'both',
        requiresSkillId: true,
        engineNameType: 'hit' // 标记为打击爆点ID
      },
      {
        resourceType: 'BUFF状态',
        prefix: 'buff_',
        description: 'BUFF状态资源（引擎环境使用技能ID）',
        format: 'buff_[技能ID]',
        implementationFormat: 'vfx_buff_[元素]_[自定义名称]', // 实现环境使用CSV规则
        examples: [
          'buff_100000001',
          'buff_100000002'
        ],
        engineExamples: [
          'buff_100000001',
          'buff_100000002'
        ],
        notes: [
          '引擎环境：使用对应技能ID（9位数字）',
          '实现环境：使用元素和自定义名称',
          'buff资源表支持多个buff使用1个资源'
        ],
        environment: 'both',
        requiresSkillId: true,
        engineNameType: 'buff' // 标记为BUFF状态ID
      },
      {
        resourceType: 'EFFECT特效',
        prefix: 'effect_',
        description: 'EFFECT特效资源（引擎环境使用技能ID）',
        format: 'effect_[技能ID]',
        implementationFormat: 'vfx_state_[元素]_[自定义名称]', // 实现环境使用CSV规则
        examples: [
          'effect_100000001',
          'effect_100000002'
        ],
        engineExamples: [
          'effect_100000001 (激光球的横特效)',
          'effect_100000002'
        ],
        notes: [
          '引擎环境：使用技能ID（9位数字），不需要分级',
          '实现环境：使用元素和自定义名称'
        ],
        environment: 'both',
        requiresSkillId: true,
        engineNameType: 'effect' // 标记为EFFECT特效ID
      },
      {
        resourceType: 'ICON图标',
        prefix: 'Icon_',
        description: 'ICON图标资源（引擎环境使用技能ID）',
        format: 'Icon_[技能ID]',
        implementationFormat: 'ico_skill_[技能类型]_[自定义名称]', // 实现环境使用CSV规则
        examples: [
          'Icon_100000003',
          'Icon_100000004'
        ],
        engineExamples: [
          'Icon_100000003',
          'Icon_100000004'
        ],
        notes: [
          '引擎环境：使用技能ID（9位数字）',
          '实现环境：使用技能类型和自定义名称',
          'icon开头，使用前缀'
        ],
        environment: 'both',
        requiresSkillId: true,
        engineNameType: 'icon' // 标记为ICON图标ID
      }
    ]
  },

  // ========== 技能ICON资源（引擎环境：基于Excel） ==========
  {
    id: 'skill_icon',
    category: '技能ICON资源',
    subCategory: '技能图标',
    prefix: 'Icon_', // Excel文件中的前缀
    implementationPrefix: 'ico_skill', // 实现环境使用CSV规则
    rules: [
      {
        resourceType: '技能ICON资源',
        prefix: 'Icon_',
        description: '技能图标资源（引擎环境使用技能ID）',
        format: 'Icon_[技能ID]',
        implementationFormat: 'ico_skill_[技能类型]_[自定义名称]', // 实现环境使用CSV规则
        examples: [
          'Icon_100000003',
          'Icon_100000004'
        ],
        engineExamples: [
          'Icon_100000003',
          'Icon_100000004'
        ],
        notes: [
          '引擎环境：使用技能ID（9位数字）',
          '实现环境：使用技能类型和自定义名称',
          'icon开头，使用前缀'
        ],
        environment: 'both',
        requiresSkillId: true
      }
    ]
  },

  // ========== 实现环境专用规则（基于CSV，不适用于引擎环境） ==========
  {
    id: 'bullet_hit',
    category: '子弹',
    subCategory: '子弹爆点',
    prefix: 'vfx_hit', // 仅实现环境
    rules: [
      {
        resourceType: '子弹爆点',
        prefix: 'vfx_hit',
        description: '子弹击中目标时的爆炸/碰撞特效（仅实现环境）',
        format: 'vfx_hit_[元素]_[自定义名称]',
        examples: [
          'vfx_hit_fire_explosion',
          'vfx_hit_ice_shatter'
        ],
        notes: [
          '仅用于实现环境（美术制作）',
          '用于表现子弹击中时的视觉效果',
          '元素应与子弹本体保持一致'
        ],
        environment: 'implementation'
      }
    ]
  },
  {
    id: 'bullet_debuff',
    category: '子弹',
    subCategory: '子弹dbuff',
    prefix: 'vfx_debuff', // 仅实现环境
    rules: [
      {
        resourceType: '子弹dbuff',
        prefix: 'vfx_debuff',
        description: '子弹产生的减益效果特效（仅实现环境）',
        format: 'vfx_debuff_[元素]_[自定义名称]',
        examples: [
          'vfx_debuff_psn_poison',
          'vfx_debuff_ice_slow'
        ],
        notes: [
          '仅用于实现环境（美术制作）',
          '用于表现子弹产生的负面效果'
        ],
        environment: 'implementation'
      }
    ]
  },
  // ========== 第二类：场景上固定大小的资产（引擎环境：unit_前缀） ==========
  {
    id: 'monster_small',
    category: '怪物',
    subCategory: '小怪',
    prefix: 'unit_300', // 引擎环境：unit_300x（种类大小怪物）
    implementationPrefix: 'mon_s', // 实现环境
    rules: [
      {
        resourceType: '小怪',
        prefix: 'unit_300',
        description: '普通小怪物的资源（引擎环境使用单位表ID）',
        format: 'unit_300[单位表ID]',
        implementationFormat: 'mon_s_[体型]_[职业]_[动作]', // 实现环境
        examples: [
          'unit_3001',
          'unit_3002'
        ],
        engineExamples: [
          'unit_3001 (小怪单位表ID=1)',
          'unit_3002 (小怪单位表ID=2)'
        ],
        notes: [
          '引擎环境：使用unit_300x格式，x为单位表ID',
          '实现环境：使用mon_s_[体型]_[职业]_[动作]格式',
          '体型：人形(hum)、四足(4leg)、六足(6leg)、八足(8leg)、无关节(noj)、飞行(fly)',
          '职业：近战-剑盾(sd)、近战-单手(1h)、近战-双手(2h)、近战-棍棒(clb)、远程-弓手(bow)、远程-法师(mag)、远程-召唤(sum)',
          '动作：待机(idle)、攻击(atk)、死亡(die)、移动(irun)、受击(hit)、施法(cast)'
        ],
        environment: 'both',
        requiresUnitId: true // 需要单位表ID，而不是技能ID
      }
    ]
  },
  {
    id: 'monster_elite',
    category: '怪物',
    subCategory: '精英',
    prefix: 'unit_300', // 引擎环境：unit_300x（种类大小怪物）
    implementationPrefix: 'mon_e', // 实现环境
    rules: [
      {
        resourceType: '精英',
        prefix: 'unit_300',
        description: '精英怪物的资源（引擎环境使用单位表ID）',
        format: 'unit_300[单位表ID]',
        implementationFormat: 'mon_e_[体型]_[职业]_[动作]', // 实现环境
        examples: [
          'unit_30010',
          'unit_30011'
        ],
        engineExamples: [
          'unit_30010 (精英单位表ID=10)',
          'unit_30011 (精英单位表ID=11)'
        ],
        notes: [
          '引擎环境：使用unit_300x格式，x为单位表ID',
          '实现环境：使用mon_e_[体型]_[职业]_[动作]格式',
          '命名规则与小怪相同，仅前缀不同'
        ],
        environment: 'both',
        requiresUnitId: true // 需要单位表ID，而不是技能ID
      }
    ]
  },
  {
    id: 'monster_boss',
    category: '怪物',
    subCategory: 'BOSS',
    prefix: 'unit_300', // 引擎环境：unit_300x（种类大小怪物）
    implementationPrefix: 'mon_b', // 实现环境
    rules: [
      {
        resourceType: 'BOSS',
        prefix: 'unit_300',
        description: 'BOSS怪物的资源（引擎环境使用单位表ID）',
        format: 'unit_300[单位表ID]',
        implementationFormat: 'mon_b_[体型]_[职业]_[动作]', // 实现环境
        examples: [
          'unit_30020',
          'unit_30021'
        ],
        engineExamples: [
          'unit_30020 (BOSS单位表ID=20)',
          'unit_30021 (BOSS单位表ID=21)'
        ],
        notes: [
          '引擎环境：使用unit_300x格式，x为单位表ID',
          '实现环境：使用mon_b_[体型]_[职业]_[动作]格式',
          '命名规则与小怪相同，仅前缀不同'
        ],
        environment: 'both',
        requiresUnitId: true // 需要单位表ID，而不是技能ID
      }
    ]
  },
  {
    id: 'character_hero',
    category: '角色',
    subCategory: '主角本体',
    prefix: 'unit_100', // 引擎环境：unit_100x（英雄）
    implementationPrefix: 'chr_hero', // 实现环境
    rules: [
      {
        resourceType: '主角本体',
        prefix: 'unit_100',
        description: '主角角色的主要资源（引擎环境使用单位表ID）',
        format: 'unit_100[单位表ID]',
        implementationFormat: 'chr_hero_[体型]_[动作]', // 实现环境
        examples: [
          'unit_1001',
          'unit_1002'
        ],
        engineExamples: [
          'unit_1001 (英雄单位表ID=1)',
          'unit_1002 (英雄单位表ID=2)'
        ],
        notes: [
          '引擎环境：使用unit_100x格式，x为单位表ID（英雄）',
          '实现环境：使用chr_hero_[体型]_[动作]格式',
          '主角通常为人形(hum)'
        ],
        environment: 'both',
        requiresUnitId: true // 需要单位表ID，而不是技能ID
      }
    ]
  },
  {
    id: 'ui_component',
    category: '界面',
    subCategory: '通用组件',
    prefix: 'ui_com', // 仅实现环境
    rules: [
      {
        resourceType: '通用组件',
        prefix: 'ui_com',
        description: 'UI界面的通用组件（仅实现环境）',
        format: 'ui_com_[控件类型]_[自定义名称]',
        examples: [
          'ui_com_btn_confirm',
          'ui_com_ico_item'
        ],
        notes: [
          '仅用于实现环境（美术制作）',
          '控件类型：按钮(btn)、图标(ico)、进度条(bar)、背景(bg)'
        ],
        environment: 'implementation'
      }
    ]
  },
  {
    id: 'icon_bullet',
    category: '图标',
    subCategory: '子弹图标',
    prefix: 'ico_blt', // 仅实现环境
    rules: [
      {
        resourceType: '子弹图标',
        prefix: 'ico_blt',
        description: '子弹的图标资源（仅实现环境）',
        format: 'ico_blt_[元素]_[自定义名称]',
        examples: [
          'ico_blt_fire_normal',
          'ico_blt_ice_special'
        ],
        notes: [
          '仅用于实现环境（美术制作）',
          '用于UI界面显示子弹图标'
        ],
        environment: 'implementation'
      }
    ]
  },
  {
    id: 'environment_map',
    category: '场景',
    subCategory: '地图',
    prefix: 'env_map', // 仅实现环境
    rules: [
      {
        resourceType: '地图',
        prefix: 'env_map',
        description: '游戏场景地图资源（仅实现环境）',
        format: 'env_map_[主题]_[自定义名称]',
        examples: [
          'env_map_forest_level1',
          'env_map_dungeon_boss'
        ],
        notes: [
          '仅用于实现环境（美术制作）',
          '主题可以使用元素或场景类型'
        ],
        environment: 'implementation'
      }
    ]
  }
];

// 通用9位ID结构说明
export const ID_STRUCTURE_GUIDE = {
  title: '9位ID结构说明（引擎环境）',
  description: '引擎环境使用9位数字ID来标识资源，实现环境使用前缀+词典+自定义名称的方式',
  structure: 'A B CD EFGHI',
  parts: [
    {
      position: 'A位',
      name: '技能类型',
      range: '1位',
      values: [
        { code: '1', meaning: '地图技能' },
        { code: '2', meaning: '物品技能' },
        { code: '3', meaning: '怪物技能' },
        { code: '4', meaning: '英雄技能' }
      ]
    },
    {
      position: 'B位',
      name: '星级',
      range: '1位',
      values: [
        { code: '0~9', meaning: '0星到9星' }
      ]
    },
    {
      position: 'CD位',
      name: '升级参数',
      range: '2位',
      values: [
        { code: '00~99', meaning: '升级参数范围' }
      ]
    },
    {
      position: 'EFGHI位',
      name: '常规字段',
      range: '5位',
      values: [
        { code: '自定义', meaning: '常规字段内容' }
      ]
    }
  ],
  examples: [
    { id: '100000000', description: '燃烧（0星）' },
    { id: '100000001', description: '冰冻（0星）' },
    { id: '100100000', description: '燃烧2级（本身还属于燃烧，但ID不同）' }
  ]
};

// 环境说明
export const ENVIRONMENT_GUIDE = {
  implementation: {
    title: '实现环境（美术制作）',
    description: '美术人员在制作资源时使用的命名方式',
    features: [
      '使用前缀+词典+自定义名称的结构',
      '基于：弹幕美术资源命名_生产实现.csv',
      '便于美术人员理解和记忆',
      '适合资源制作阶段的命名'
    ],
    example: 'blt_fire_homing (子弹-火-追踪)'
  },
  engine: {
    title: '引擎环境（生产环境）',
    description: '资源进入游戏引擎后使用的命名方式',
    features: [
      '使用前缀+技能ID（9位数字）的结构',
      '基于：美术资源IDV1.4.xlsx（必须遵守）',
      '格式：前缀_技能ID（如 hit_100000001）',
      '子弹资源支持升级后缀（_1、_2）',
      '适合引擎加载和使用'
    ],
    example: 'hit_100000001 (球撞击效果，使用技能ID)'
  }
};

// 根据资源类型ID获取规则
export function getRulesForResourceType(resourceTypeId: string): ResourceTypeRule | undefined {
  return DANMAKU_NAMING_RULES.find(rule => rule.id === resourceTypeId);
}

// 根据资源类型前缀获取规则
export function getRulesByPrefix(prefix: string): ResourceTypeRule | undefined {
  return DANMAKU_NAMING_RULES.find(rule => 
    rule.prefix === prefix || rule.implementationPrefix === prefix
  );
}

// 根据分类和子分类获取规则
export function getRulesByCategory(category: string, subCategory: string): ResourceTypeRule | undefined {
  return DANMAKU_NAMING_RULES.find(rule => 
    rule.category === category && rule.subCategory === subCategory
  );
}

// 生成引擎环境命名
// 第一类：技能和球（子弹相关）- 使用技能ID（9位数字）
// 第二类：场景固定大小资产 - 使用单位表ID（unit_100x/200x/300x）
// 第三类：掉落物 - 使用物品表ID（item_10x）
export function generateEngineName(
  prefix: string,
  id: string, // ID（技能ID为9位数字，单位表ID或物品表ID为数字）
  upgradeLevel?: number, // 升级等级（0-2，仅子弹资源使用）
  idType: 'skill' | 'unit' | 'item' = 'skill' // ID类型
): string {
  if (!id) {
    return '';
  }
  
  let name = '';
  
  if (idType === 'skill') {
    // 第一类：技能和球（子弹相关）- 使用9位技能ID
    if (!/^\d{9}$/.test(id)) {
      return ''; // 技能ID必须是9位数字
    }
    name = `${prefix}${id}`;
    
    // 如果是子弹资源且有升级等级，添加后缀
    if (upgradeLevel !== undefined && upgradeLevel > 0) {
      name += `_${upgradeLevel}`;
    }
  } else if (idType === 'unit') {
    // 第二类：场景固定大小资产 - 使用单位表ID
    // prefix已经是unit_100/200/300，直接拼接ID
    if (!/^\d+$/.test(id)) {
      return ''; // 单位表ID必须是数字
    }
    name = `${prefix}${id}`;
  } else if (idType === 'item') {
    // 第三类：掉落物 - 使用物品表ID
    // prefix已经是item_10，直接拼接ID
    if (!/^\d+$/.test(id)) {
      return ''; // 物品表ID必须是数字
    }
    name = `${prefix}${id}`;
  }
  
  return name;
}
