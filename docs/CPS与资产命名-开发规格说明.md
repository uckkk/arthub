# CPS 自动化与资产命名 — 开发规格说明

本文档描述当前 ArtHub 仓库中 **CPS 自动化（含分享）** 与 **资产命名** 的行为、数据结构与算法细节，供其他实现复刻一致功能。

**主要源码位置**

- CPS：`components/CPSAutomation.tsx`
- 命名入口：`components/NamingTool/index.tsx`
- 传统命名：`components/NamingTool/TraditionalNamingTool.tsx`
- 弹幕命名：`components/NamingTool/DanmakuNamingTool.tsx`
- 命名数据：`services/namingDataService.ts`、`services/danmakuNamingService.ts`、`services/danmakuNamingRules.ts`
- 历史：`components/NamingHistory.tsx`、`types.ts`（`NamingHistoryItem`）

---

## 第一部分：CPS 自动化（含分享）

### 1. 功能概述

- 用户上传三张图：**通用立绘**、**弹窗**、**APP 图标**。
- 在 Canvas 上生成 **5 张 PNG**（立绘 big/mid/small + 弹窗 + 图标），可打包为 ZIP。
- 支持 **产品介绍**（最多 10 个 Unicode 字符，含 IME）与 **4 个标签**（每标签最多 4 字符）；注意与**导出图像**的关系见 §1.5。
- 支持 **参数模板**（序列化至 localStorage）、**自定义模式**下可改尺寸与圆角等。
- **分享**：生成单文件 **自包含 HTML**（内嵌 `CFG` 与完整处理脚本），无外链 JS CDN。

### 2. 配置模型 `DEFAULT_CONFIG`

结构需可 `JSON.stringify`，分享页以内嵌常量使用。

| 区域 | 字段 | 说明 |
|------|------|------|
| `portrait` | `borderRadius` | 立绘内容区圆角（px）；弹窗圆角与此**共用** |
| | `smoothBorderRadius` | **0–100**，超椭圆平滑度（百分比，非像素） |
| | `shadow` | `offsetX, offsetY, blur, spread, color`，仅立绘内容区 |
| | `sizes.big/mid/small` | **内容裁切区**宽高 |
| | `outputSizes.big/mid/small` | **输出画布**宽高（含边距） |
| | `margin` | `left, right, top, bottom`，内容区相对画布 |
| | `namePrefix` | 含字面量 `@` 的文件名模板，如 `cps_big_icon@` |
| `popup` | `width, height, namePrefix` | 默认 1009×567 |
| `appIcon` | `width, height, borderRadius, smoothBorderRadius, namePrefix` | 默认 72×72，圆角 18，smooth 60 |

**默认值（与代码一致）**

- 立绘 `sizes`：big 618×536，mid 290×536，small 290×246。
- 立绘 `outputSizes`：big 648×566，mid 320×566，small 320×276。
- `margin`：left/right 15，top 7，bottom 23。
- 文件名前缀：`cps_big_icon@`、`cps_image@`、`ylg_cps_icon@`。

### 3. 超椭圆圆角 `drawRoundedRect`

- `smoothPercent` 限制在 0–100；`s = smoothPercent/100`，`n = 2 + s*3`，`e = 2/n`。
- 当 `s > 0.01`：对名义 `radius` 做视觉补偿，使与圆角参数感知一致：  
  `kCircle = 1/√2`，`kSuper = (1/√2)^e`，`scaleFactor = (1 - kCircle) / (1 - kSuper)`，  
  `r = min(radius * scaleFactor, min(w,h)/2)`；否则 `r = min(radius, min(w,h)/2)`。
- 四角用参数曲线，`SEG = 48`：`px = r * |cos t|^e`，`py = r * |sin t|^e`，分段 `lineTo` 闭合。
- 流程：先带 `shadow` 填充 `#1b1b1b` 圆角矩形，再同路径 `clip` 后绘制图片。

### 4. 图片适配

- **`fitBigSize`**：最长边撑满，另一边居中；用于立绘 **big**、弹窗。
- **`fitMidSize`**：原图中央裁切，宽高比等于裁切框；用于立绘 **mid**。
- **`fitSmallSize`**：先按 **mid 尺寸 (290×536)** 得到与 mid 相同的裁切，再在 mid 坐标系从顶部向下滑 **83px** 起截取高度按比例 `246/536` 的一条（**非居中**）。
- **`fitShortestSide`**：居中裁短边撑满；用于 APP 图标。

### 5. 文字叠加与预览 / 导出差异（重要）

`renderPortrait` 中 `showOverlay` 控制标签与产品介绍绘制；缩放系数 `hScale = size.height / portrait.sizes.big.height`。标签颜色固定：

`['#FF6B6B','#4ECDC4','#FFD93D','#6C5CE7']`。

- **标签**：仅 **big、mid** 且 `showOverlay` 时绘制；**small** 不画标签。
- **产品介绍**：`showOverlay` 为 true 时，big/mid/small 内容区底部绘制。

**主应用预览**

| 预览 | `showOverlay` |
|------|----------------|
| big | `false`（无标签、无介绍） |
| mid | `true`（标签 + 介绍） |
| small | `false` |

**导出与离屏渲染**：`renderPortraitOffscreen` 一律 `showOverlay === false`。

→ **导出的三张立绘 PNG 不包含标签与产品介绍**；若填写了介绍或标签，额外生成 **产品信息 .txt**（见 §8）。

弹窗、图标无此类叠加层。

### 6. 弹窗与 APP 图标

- 弹窗：整画布使用 **portrait 的** `borderRadius` 与`smoothBorderRadius`，`fitBigSize`，无阴影。
- APP 图标：使用 `appIcon` 的圆角参数，`fitShortestSide`，无阴影。

### 7. 序号与文件名

- 输入 `customName`：仅允许最多 4 位数字（正则 `^\d{0,4}$`），否则展示错误「序号仅限4位数字」。
- **`extractNameFromInput`**：只保留数字；长度 ≥4 时取**后 3 位**，再去前导 0；若为空则 `'0'`。例：1008→8，1012→12，1108→108。
- **`generateFileName(prefix, suffix?)`**：`prefix` 中**第一个** `@` 替换为上述值；立绘三尺寸增加 `_${suffix}`（big/mid/small）；扩展名 `.png`。

### 8. 产品信息 TXT

- 触发条件：`productDesc` 非空，或至少一个标签非空。
- 格式：行 `产品介绍：…`；行 `标签：…`（标签用 `、` 连接）。
- 文件名：`产品信息_${extractNameFromInput(...) || 'cps'}.txt`。

### 9. 导出 ZIP 与 PNG 编码

- 使用 `JSZip`；每张图 `canvasToBlob(canvas)`：
  - 读取 `ImageData`，`fsAlphaDither` 对 alpha 做 **32 级** Floyd–Steinberg。
  - 尝试动态 `import('imagequant')`：`set_quality(0, 75)`，`set_speed(1)`，输出 PNG Blob。
  - 失败则用 `UPNG.encode` 无损回退。
- ZIP 内含 5 个 PNG + 可选 txt；ZIP 名：`CPS素材_${nameVal || 'export'}.zip`。
- **Tauri**：`exportDirectory` 存 `arthub_cps_export_dir`；未设置则 dialog 选目录；`write_binary_file_with_path`；可 `open_folder`；权限类错误需友好提示。
- **浏览器**：`createObjectURL` + `<a download>`。

### 10. 拖拽：Tauri 与浏览器

- `isTauri`：`window.__TAURI_IPC__`。
- **Tauri**：监听 `tauri://file-drop-hover`、`tauri://file-drop`、`tauri://file-drop-cancelled`；hover 时用 `get_cursor_position` 与窗口内位置、`devicePixelRatio` 换算后 `elementFromPoint`，找 `[data-drop-target]`。drop 时 `read_binary_file_with_path` 组装 `File`。若未命中目标且仅有一个空上传槽则填入。**祖先含 `aria-hidden="true"`** 时不处理（非当前 Tab）。
- **浏览器**：在 `document` 上 `dragover`/`dragleave`/`drop`，用 ref 记录当前 `data-drop-target`。

### 11. 模板与 localStorage

- `arthub_cps_templates`：`{ id, name, config, createdAt }[]`。
- `activeTemplateId === 'default'` 时与 `DEFAULT_CONFIG` 深比较判脏。
- **`customMode`** 默认 `false`；为 false 时尺寸等参数控件只读（`paramDisabled`）。

### 12. 分享页 `generateSharePage`

- 将选中模板 `config`（或默认）注入为 `const CFG = …`。
- 页面含飞书「规范要求」链接（与主应用相同）、标题「边锋掼蛋CPS图片处理」、页脚「边锋掼蛋@2026」。
- **内嵌 PNG**：median-cut 256 色 + Floyd–Steinberg + PLTE/tRNS/IDAT；zlib 使用 **`CompressionStream('deflate')`**（浏览器需支持）。
- 逻辑与主应用一致：`drawPortrait` 导出时 `showOverlay false`；多文件下载间隔 **500ms**。
- **Tauri 分发**：选目录写入 `边锋掼蛋CPS素材生成.html`。
- **浏览器**：下载同名文件。
- 模板字符串内的 `</script>` 必须写为 `<\/script>`。

### 13. 依赖与 Tauri 命令

- 依赖：`upng-js`、`jszip`、`imagequant`（主应用可选）。
- 命令示例：`get_cursor_position`、`read_binary_file_with_path`、`write_binary_file_with_path`、`open_folder`、文件/目录 dialog。

---

## 第二部分：资产命名

### 1. 架构

- **壳**：`NamingTool/index.tsx` — 预设、格式、弹幕数据加载、`DanmakuNamingTool` / `TraditionalNamingTool`。
- **传统**：`usePresetLoader` + CSV `parseCsvToPresets`。
- **弹幕**：`parseDanmakuCsv` + 词典映射 + `danmakuNamingRules` + `skillIdGenerator`。
- **格式化**：`formatName(text, caseFormat, separatorFormat)`。
- **翻译**：`useTranslation` → `translationService`（ debounce 400ms）。
- **历史**：各工具 `saveToHistory`；`NamingHistory` 读 `arthub_naming_history_${presetId}`。

### 2. 远程 CSV（`namingDataService.ts`）

基址：`https://raw.githubusercontent.com/uckkk/ArtAssetNamingConfig/main/`

| presetId | 文件 |
|----------|------|
| `fgui_card` | `QPArtName.csv` |
| `fgui_danmaku` | `DMArtName.csv` |
| `generic_rpg` | `0GameArtName.csv` |

- `fetch`：`no-cache`，10s 超时，`AbortController`，最多重试 2 次，递增延迟。

### 3. 传统 CSV `parseCsvToPresets`

列（7 列）：`控件分类, 控件英文缩写, 英文全称, (空), 资产词典, 资产英文缩写, 英文全称`（支持引号内逗号）。

- **资产分类**（`control_categories`）：子项 `suffix` 存**控件英文缩写**（在拼名时作**前缀**使用）。
- **子类型/变体**（`asset_types`）：`id = 资产英文缩写.toLowerCase()`，`suffix = '_' + (英文全称优先否则缩写)`。

### 4. 弹幕 CSV `parseDanmakuCsv`

至少 7 列，可有备注列：  
`分类, 细分, 前缀, 空, 词典分类, 中文, 缩写, 备注?`

- 资源：`id = res_${category}_${subCategory}`；**子弹**类目下非「子弹和技能」的细分合并为 **「子弹和技能」**。
- 词典：按「词典分类」聚合，项去重（`abbr` 小写为 id）。
- **代码追加**（CSV 可无）：`单位_单位`（prefix `unit_100`）、`物品_物品`（prefix `item_10`）。

### 5. 预设与默认格式（`constants.ts`）

- `PRESET_IDS`：`fgui_card`、`fgui_danmaku`、`generic_rpg`。
- `getDefaultFormat`：棋牌 → Pascal + none；弹幕 → lower + underscore；通用 RPG → Pascal + underscore。
- `SPECIAL_SUFFIXES`：例 `{ id:'jiugong', label:'九宫', suffix:'Ns' }`。

**行为**：`index.tsx` 在 `currentPresetId` 变化时会将 `caseFormat` / `separatorFormat` **重置为对应预设默认值**（与当前仓库一致）。

### 6. `formatName`

- 拆词：`_`/`-`/空格；或驼峰边界；否则单词。
- 词转小写后应用 pascal / camel / lower；再用 underscore / hyphen / none 连接。

### 7. 传统模板最终名 `TraditionalNamingTool`

- `namePart`：默认 `AssetName`；有输入时优先译名（非翻译中则原文去空格）。
- `formattedPrefix` = 资产分类项的 `suffix`（实际为前缀缩写）；`formattedSuffix` = 子类型 `suffix` 去首 `_` 再 format。
- `parts = [prefix?, suffix?, namePart?]`，之间用 `separatorFormat` 对应字符连接得 `mainName`。
- **特殊后缀**：`formatName` 每项；**当 `presetId === 'fgui_card'` 且 `suffix === 'Ns'`** 时**不**加前导 `_`，直接拼 `Ns`；否则 `_` + 格式化后缀。
- `finalName = mainName + specialSuffixParts`。
- **中文说明**：分类 label + 子类型 label +（输入含中文则输入）+ 激活的特殊后缀中文。

localStorage：`arthub_${presetId}_control_category_id`、`arthub_${presetId}_asset_type_id`。

### 8. 弹幕模板生产名 `DanmakuNamingTool`

- **单位、物品**：`finalName` 为空串（只做引擎命名）。
- 否则：`parts = [prefix, …各词典当前 abbr（按 `getDictionariesForResourceCategory`）]`，跳过键 **`怪物阶级`**（与映射表一致）。
- 附带 `namePart`（翻译/去空格逻辑同传统）。
- `rawName = parts.join(separator)`，再整体 **`formatName(rawName, caseFormat, separatorFormat)`**。
- 特殊后缀：一律 `_` + `formatName(suffix)`（**无**棋牌 Ns 特例）。

**词典映射**（`categoryMapping`）：子弹→元素；怪物→体型/职业/动作；角色→体型/动作；界面→UI控件；图标/场景→元素；单位/物品→空数组。  
若映射结果为空数组，**回退为 `Array.from(dictionaries.values())`（全词典）**。

### 9. 引擎环境命名

- `getRulesByCategory` + `generateEngineName`（`services/danmakuNamingRules.ts`）。
- 技能 ID：**9 位数字** `/^\d{9}$/`；可带升级后缀 `_1`、`_2`（子弹类）。
- 单位/物品：数字 ID；前缀 `unit_100*`、`item_10*` 等与规则表一致。
- 「子弹和技能」可生成多前缀的 `engineNames` 映射（多条规则时）。

技能 ID 生成与持久化见 `skillIdGenerator.ts` 与组件内 `arthub_danmaku_*` 键。

### 10. 历史记录

- 键：`arthub_naming_history_${presetId}`（弹幕固定 `arthub_naming_history_fgui_danmaku`）。
- 结构：`NamingHistoryItem`（见 `types.ts`）。
- 最多 **10** 条，`unshift`；用户**复制生产环境名称**成功时写入。
- `NamingHistory`：同步 `arthub_naming_preset`、storage 事件、`namingHistoryUpdated`、可选轮询；备注/文件同步为扩展能力，最小复刻可只做 localStorage。

### 11. 翻译

- 中文且无 API：`needsApiSetup`，可触发 `openSettings`。
- 有 API：400ms 后 `translateAssetName`。

---

## 验收要点摘要

**CPS**

- 五张图输出尺寸与默认 config 一致；small 立绘 **83px** 偏移与超椭圆绘制一致。
- **导出立绘图无画面文字**；文案仅在 txt（若填写）。
- 预览仅 **mid** 显示标签+介绍（big/small 预览不显示叠加）。

**命名**

- CSV 拉取、解析、棋牌 Ns 规则、弹幕单位/物品无生产名、引擎 ID 校验与历史分键一致。

---

*文档版本与仓库实现同步，修改功能时请更新本文档。*
