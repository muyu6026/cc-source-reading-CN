#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第 176 批：把批次小节追加到 annotated-索引与进度.md 末尾，保持行尾一致。"""
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IDX = os.path.join(ROOT, 'annotated-索引与进度.md')

SECTION = r'''## src batch 176: 15-13 line tier, 15 files (201 src, 265 annotated, 64 anchors)

本批是 `src/` 散件收尾的「最小命令件专场」终章——15 份全部 ≤15 行，主题集中在「命令元数据壳与实现体 / 年度回顾入口 / 验证型技能内联文案 / 钩子配置入口」，全部是 `satisfies Command` 收口 + 懒加载实现的同构模式，外加一个 React Compiler 产物的状态文案组件与一个验证型技能的构建期内联文案：

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`commands/install-github-app/CheckGitHubStep.tsx`](annotated/src/commands/install-github-app/CheckGitHubStep.tsx) | 15→18 | 3 | GitHub App 安装向导的一步：纯展示「正在检测 CLI」状态文案（React Compiler 注入 `_c(1)` 缓存槽） |
| [`commands/login/index.ts`](annotated/src/commands/login/index.ts) | 14→19 | 5 | `/login` 元数据壳：按是否持有 API Key 动态切描述、环境变量可隐藏 |
| [`commands/review/ultrareviewEnabled.ts`](annotated/src/commands/review/ultrareviewEnabled.ts) | 14→18 | 4 | `/ultrareview` 运行期开关：`tengu_review_bughunter_config` 配置门控可见性（`/* */` 头，批注落块外） |
| [`commands/privacy-settings/index.ts`](annotated/src/commands/privacy-settings/index.ts) | 14→18 | 4 | `/privacy-settings`：仅消费者订阅者可见 |
| [`commands/branch/index.ts`](annotated/src/commands/branch/index.ts) | 14→18 | 4 | `/branch`：仅当构建不含独立 `/fork` 时附加 `fork` 别名（`feature('FORK_SUBAGENT')`） |
| [`commands/keybindings/index.ts`](annotated/src/commands/keybindings/index.ts) | 13→17 | 4 | `/keybindings`：仅用户启用键位自定义时显示 |
| [`commands/btw/index.ts`](annotated/src/commands/btw/index.ts) | 13→18 | 5 | `/btw`：不打断主线的旁支提问，`immediate` 即时弹出 |
| [`commands/rewind/index.ts`](annotated/src/commands/rewind/index.ts) | 13→17 | 4 | `/rewind`（别名 `checkpoint`）：回滚代码与/或对话 |
| [`commands/thinkback/index.ts`](annotated/src/commands/thinkback/index.ts) | 13→17 | 4 | `/think-back`：Statsig 门 `tengu_thinkback` 控制的「年度回顾」入口 |
| [`commands/hooks/hooks.tsx`](annotated/src/commands/hooks/hooks.tsx) | 13→18 | 5 | `/hooks` 入口：上报埋点 + 取工具名渲染配置菜单（含 base64 sourcemap，批注版保留） |
| [`commands/effort/index.ts`](annotated/src/commands/effort/index.ts) | 13→17 | 4 | `/effort`：设置模型 effort 档位，`get immediate()` 动态即时 |
| [`commands/install-github-app/index.ts`](annotated/src/commands/install-github-app/index.ts) | 13→18 | 5 | `/install-github-app` 元数据壳：仅 `claude-ai`/`console` 可见、环境变量可隐藏 |
| [`commands/rewind/rewind.ts`](annotated/src/commands/rewind/rewind.ts) | 13→17 | 4 | `/rewind` 实现：打开消息选择器后返回「跳过」结果 |
| [`src/skills/bundled/verifyContent.ts`](annotated/src/skills/bundled/verifyContent.ts) | 13→17 | 4 | 验证型内置技能文案：构建期经 Bun 文本加载器内联为字符串 |
| [`commands/chrome/index.ts`](annotated/src/commands/chrome/index.ts) | 13→18 | 5 | `/chrome`：Claude in Chrome(Beta) 设置，非交互会话隐藏 |

- **命令壳同构模式**：本批 13 份命令全部是「`const x = {...} satisfies Command` 或默认导出工厂 + 懒加载 `import()`」结构，差异只在 `type`（local-jsx / local）、可用性门控（`isEnabled` / `isHidden` / `get immediate()`）、`aliases`、`availability` 渠道。可见性由多类条件组合：`isConsumerSubscriber()`（隐私设置）、`isKeybindingCustomizationEnabled()`（键位）、`feature('FORK_SUBAGENT')`（branch 别名）、`checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_thinkback')`（年度回顾）、环境变量 `DISABLE_*` 真值判定（login / install-github-app）。
- **一份 React Compiler 产物**：`CheckGitHubStep.tsx` 是安装向导的纯文案步骤——编译器注入 `_c(1)` 记忆槽、把组件体收敛成单值记忆化，无 JSX 子元素区插入、锚点全落语句行。
- **一份验证型技能内联**：`verifyContent.ts` 说明内置技能的 `.md` 文案在构建期由 Bun 文本加载器读成字符串，导出主文档与示例映射表，本身为零逻辑资源文件。
- **一份 `/* */` 头与一处 `//` 段**：`ultrareviewEnabled.ts` 的文件头 JSDoc 用 `(8,'before')` 落块后；`verifyContent.ts` 的 `(1,'after')` 落在双行 `//` 注释段首行，annotate 自动挪到段边界（1→2）避免劈开英文。

踩坑：

- **1 处良性 `⟳`（verifyContent.ts 的 (1) → 2）**：第 1 行是双行 `//` 注释段首行，`after` 锚点由 annotate 自动挪到段尾（第 2 行之后），未劈开英文，grep 确认落点通顺。其余 14 份零 `⟳` 零 `⚠`。
- **判据前置规避**：本批刻意不把 `after` 落在以 `=`/`?` 结尾的多行首行（如 `login` 的 `description: hasAnthropicApiKeyAuth()` 三元首行、`install-github-app` 的 `availability` 数组），统一锚到收尾行或属性行，fidelity 初跑即 0 失败、无需回修。
- **预检 64 锚点一次全过**（ast.parse、行界、重复、禁字符、slug↔源文件路径对应），零 `⟳`-外风险、零 `⚠`、块注释内零中文。

流程账（第 176 批）：15 个数据文件逐一对齐源文件；precheck 64 锚点全过（ast.parse、行界、重复、禁字符、slug↔源文件路径对应）；annotate 十五次，1 处良性 `⟳`（verifyContent.ts (1) 落双行 `//` 注释段首行自动挪到段边界 1→2），零 `⚠`；check-fidelity 全仓 1833 份 0 失败（较上批 +15）；check-links 2685 源码链 + 744 内链 0 失效；全仓 1833/1902 文件、512,707/513,237 行、99%（按行数）；`src/` 还剩 69 份 / 约 530 行（15 行档已清零，下一档起点 12 行）。

**下一批候选（12→11 行档，单批约 15 份）**：`commands/tag/index.ts`(12) · `commands/heapdump/index.ts`(12) · `commands/agents/agents.tsx`(12) · `commands/install-slack-app/index.ts`(12) · `commands/mcp/index.ts`(12) · `commands/rename/index.ts`(12) · `commands/exit/index.ts`(12) · `commands/files/index.ts`(12) · `commands/status/index.ts`(12) · `commands/resume/index.ts`(12) · `commands/doctor/index.ts`(12) · `commands/release-notes/index.ts`(11) · `commands/hooks/index.ts`(11) · `commands/export/index.ts`(11) · `commands/vim/index.ts`(11)（`src/` 还剩 69 份 / 约 530 行；15 行档已清零，下一档起点 12 行）
'''

with open(IDX, 'rb') as fh:
    raw = fh.read()
if b'\r\n' in raw[:4096]:
    eol = '\r\n'
elif b'\n' in raw[:4096]:
    eol = '\n'
else:
    eol = '\n'

# 确保现有内容以换行结尾
if raw.endswith(b'\r\n'):
    prefix = b''
elif raw.endswith(b'\n'):
    prefix = b''
else:
    prefix = eol.encode()

data = raw + prefix + SECTION.replace('\n', eol).encode('utf-8')
with open(IDX, 'wb') as fh:
    fh.write(data)
print('appended batch 176 section; EOL=%r' % eol)
print('new size=%d bytes' % len(data))
