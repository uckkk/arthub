# NamingTool 组件拆分说明

## 目录结构

```
NamingTool/
  index.tsx                    # 主组件（路由分发）
  TraditionalNamingTool.tsx    # 传统模板（棋牌、通用RPG）
  DanmakuNamingTool.tsx        # 弹幕游戏模板
  NamingPreview.tsx            # 命名预览组件
  FormatSelector.tsx            # 格式选择器
  SpecialSuffixSelector.tsx    # 特殊后缀选择器
  PresetSelector.tsx           # 预设选择器
  hooks/
    useNamingGenerator.ts      # 命名生成逻辑
    useTranslation.ts           # 翻译逻辑
    useNamingHistory.ts         # 历史记录逻辑
    usePresetLoader.ts          # 预设加载逻辑
  constants.ts                 # 常量定义
```

## 拆分策略

1. **主组件 (index.tsx)**
   - 根据当前预设ID路由到对应模板组件
   - 管理预设切换
   - 管理格式选择

2. **传统模板 (TraditionalNamingTool.tsx)**
   - 资产分类选择
   - 子类型/变体选择
   - 名称输入和翻译
   - 命名生成

3. **弹幕游戏模板 (DanmakuNamingTool.tsx)**
   - 资源类型选择
   - 词典选择
   - ID生成器
   - 命名生成（生产环境 + 引擎环境）

4. **公共组件**
   - NamingPreview: 显示生成的命名
   - FormatSelector: 格式选择（大小写、分隔符）
   - SpecialSuffixSelector: 特殊后缀选择
   - PresetSelector: 预设切换器

5. **自定义Hooks**
   - useNamingGenerator: 命名生成逻辑
   - useTranslation: 翻译逻辑
   - useNamingHistory: 历史记录
   - usePresetLoader: 预设加载
