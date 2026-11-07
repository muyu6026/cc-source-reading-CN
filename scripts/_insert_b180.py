# -*- coding: utf-8 -*-
import io, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
path = os.path.join(ROOT, 'annotated-索引与进度.md')
lines = io.open(path, encoding='utf-8').read().split('\n')

# 1) 顶部进度段：src/ 还剩 24 份 -> 9 份
for i, ln in enumerate(lines):
    if ln.startswith('`services/`') and 'src/ 还剩 24 份' in ln:
        lines[i] = ln.replace('src/ 还剩 24 份', 'src/ 还剩 9 份')
        print('更新顶部进度段（还剩 24 -> 9）: 行 %d' % (i + 1))

# 2) 在 batch 179 的「下一批候选（11→1 行档）」之后插入 batch 180 小节
section = '''

## src batch 180: 11-1 line tier, 15 files (52 src, 89 annotated, 26 anchors)

本批是 `src/` 散件收尾的倒数第二批——6 份命令相关文件（`keys.ts` 是 GrowthBook 密钥 getter，`config`/`doctor`/`plugin` 是本地 JSX 命令入口，`output-style` 是已废弃命令，`reset-limits` 是被禁用的命令桩）与 9 份 1 行文件（8 份禁用命令桩 + 1 份空内容占位常量）。6 份命令文件延续第 178/179 批的同构：命令只负责把组件或提示消息「挂出来」，不做重逻辑——`config`/`doctor`/`plugin` 用 `call` 渲染组件并接 `onDone` 关闭回调，`output-style` 仅返回一条 system 弃用提示，`reset-limits` 的 `resetLimits` 与 `resetLimitsNonInteractive` 都指向同一个被禁用的桩：

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`constants/keys.ts`](annotated/src/constants/keys.ts) | 11→16 | 4 | GrowthBook 客户端密钥 getter：按 USER_TYPE 与 ENABLE_GROWTHBOOK_DEV 分流选 SDK key，必须惰性读取才能抓到全局设置注入的值 |
| [`commands/config/config.tsx`](annotated/src/commands/config/config.tsx) | 7→10 | 3 | `/config` 本地 JSX 入口：渲染 Settings 面板并靠 defaultTab 定位到 Config 页签 |
| [`commands/doctor/doctor.tsx`](annotated/src/commands/doctor/doctor.tsx) | 7→10 | 3 | `/doctor` 本地 JSX 入口：渲染系统诊断屏 Doctor，第三个参数刻意忽略 |
| [`commands/output-style/output-style.tsx`](annotated/src/commands/output-style/output-style.tsx) | 7→9 | 2 | `/output-style` 已废弃命令：直接返回 system 类型弃用提示，引导改用 /config |
| [`commands/plugin/plugin.tsx`](annotated/src/commands/plugin/plugin.tsx) | 7→10 | 3 | `/plugin` 本地 JSX 入口：渲染插件设置组件 PluginSettings，可选 args 透传 |
| [`commands/reset-limits/index.js`](annotated/src/commands/reset-limits/index.js) | 4→6 | 2 | reset-limits 命令桩：resetLimits 与 resetLimitsNonInteractive 都指向同一个被禁用的桩 |
| [`commands/onboarding/index.js`](annotated/src/commands/onboarding/index.js) | 1→2 | 1 | onboarding 命令桩：isEnabled 恒 false 且 isHidden，已禁用隐藏 |
| [`commands/issue/index.js`](annotated/src/commands/issue/index.js) | 1→2 | 1 | issue 命令桩：已禁用隐藏 |
| [`constants/messages.ts`](annotated/src/constants/messages.ts) | 1→2 | 1 | 空内容占位文案常量 NO_CONTENT_MESSAGE |
| [`commands/summary/index.js`](annotated/src/commands/summary/index.js) | 1→2 | 1 | summary 命令桩：已禁用隐藏 |
| [`commands/env/index.js`](annotated/src/commands/env/index.js) | 1→2 | 1 | env 命令桩：已禁用隐藏 |
| [`commands/backfill-sessions/index.js`](annotated/src/commands/backfill-sessions/index.js) | 1→2 | 1 | backfill-sessions 命令桩：已禁用隐藏 |
| [`commands/debug-tool-call/index.js`](annotated/src/commands/debug-tool-call/index.js) | 1→2 | 1 | debug-tool-call 命令桩：已禁用隐藏 |
| [`commands/ant-trace/index.js`](annotated/src/commands/ant-trace/index.js) | 1→2 | 1 | ant-trace 命令桩：已禁用隐藏 |
| [`commands/break-cache/index.js`](annotated/src/commands/break-cache/index.js) | 1→2 | 1 | break-cache 命令桩：已禁用隐藏 |

- **命令壳收尾模式（终章）**：本批 6 份命令相关文件与第 178/179 批同构——`config`/`doctor`/`plugin` 是本地 JSX 入口（`call` 渲染组件、`onDone` 接关闭回调），`output-style` 是已废弃命令（只返回 system 消息），`reset-limits` 是被禁用的桩；共同点是「命令只负责把组件或消息挂出来，不做重逻辑」。
- **9 份 1 行桩的同构**：`onboarding`/`issue`/`summary`/`env`/`backfill-sessions`/`debug-tool-call`/`ant-trace`/`break-cache` 八份命令桩与 `messages.ts` 常量，全部是 `export default { isEnabled: () => false, isHidden: true, name: 'stub' }` 或单个常量——说明这些命令功能已迁移或下线，仅保留「禁用且隐藏」的占位，避免旧脚本调用时报错。

踩坑：

- **零 `⟳` 零 `⚠` 零块注释内中文**：15 份锚点全部落在 import 行 / 函数签名行 / 语句行 / 组件 return 行 / 常量导出行，未触发任何结构性保护（无 `/* */` 头、无模板字符串、无跨行表达式首行）。预检 26 锚点一次全过（ast.parse、行界、重复、禁字符、slug↔源文件路径对应）。
- **小文件批量收口**：本批 9 份 1 行文件 + 6 份 ≤11 行文件，是全仓 `src/` 散件的倒数第二批；剩 9 份全为 1 行命令桩，下一批即可清零。

流程账（第 180 批）：15 个数据文件逐一对齐源文件；precheck 26 锚点全过；annotate 十五次零 `⟳` 零 `⚠`；check-fidelity 全仓 1893 份 0 失败（较上批 +15）；check-links 2745 源码链 + 748 内链 0 失效；全仓 1893/1902 文件、513,228/513,237 行、99%（按行数）；`src/` 还剩 9 份 / 9 行（均为 1 行 `.js` 命令桩：`mock-limits`/`ctx_viz`/`bughunter`/`perf-issue`/`autofix-pr`/`teleport`/`oauth-refresh`/`share` 及最后一份，下一档起点 1 行）。

**下一批候选（1 行档，单批约 9 份，即可清零）**：`commands/mock-limits/index.js`(1) · `commands/ctx_viz/index.js`(1) · `commands/bughunter/index.js`(1) · `commands/perf-issue/index.js`(1) · `commands/autofix-pr/index.js`(1) · `commands/teleport/index.js`(1) · `commands/oauth-refresh/index.js`(1) · `commands/share/index.js`(1)（`src/` 还剩 9 份 / 9 行；全为 1 行命令桩，下一批做完即全仓 100%）。'''

inserted = False
for i, ln in enumerate(lines):
    if '下一批候选（11→1 行档' in ln:
        lines.insert(i + 1, section)
        inserted = True
        print('插入 batch 180 小节：位于原行 %d 之后' % (i + 1))
        break

if not inserted:
    raise SystemExit('未找到 batch 179 候选行，无法插入 batch 180')

io.open(path, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
print('写入完成')
