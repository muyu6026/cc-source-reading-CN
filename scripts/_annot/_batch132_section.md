### components batch 132 (15 files 752 lines 103 anchors)

本批十五份全部 ≤55 行，是 components 清零冲刺里倒数第二批小文件：横跨「启动状态通知、Opus 1M 合并提示、按键绑定校验告警、新建智能体选模型步、ctrl+o 展开提示、动画星号、下拉选项双向链表、费用阈值对话框、集群工人徽章、MCP 重连结果处理、慢操作调试条、退出流程、上下文建议、沙箱诊断区、闪电图标」十五类主题。除 `option-map.ts`（纯 class）外，其余均为 React Compiler 产物（`_c(N)` 记忆缓存），源文件几乎无 `//` 英文注释段、无多行模板，锚点只落函数/类型签名行（before）与语句/收尾行（after）。

| 文件 | 原文→批注版 | 锚点 |
| --- | --- | --- |
| `StatusNotices.tsx` | 55→61 | 5 |
| `LogoV2/Opus1mMergeNotice.tsx` | 55→60 | 4 |
| `KeybindingWarnings.tsx` | 55→61 | 5 |
| `agents/new-agent-creation/wizard-steps/ModelStep.tsx` | 52→59 | 6 |
| `CtrlOToExpand.tsx` | 51→57 | 5 |
| `LogoV2/AnimatedAsterisk.tsx` | 50→64 | 13 |
| `CustomSelect/option-map.ts` | 50→59 | 9 |
| `CostThresholdDialog.tsx` | 50→57 | 7 |
| `permissions/WorkerBadge.tsx` | 49→55 | 6 |
| `mcp/utils/reconnectHelpers.tsx` | 49→53 | 4 |
| `DevBar.tsx` | 49→59 | 10 |
| `ExitFlow.tsx` | 48→55 | 7 |
| `ContextSuggestions.tsx` | 47→56 | 8 |
| `sandbox/SandboxDoctorSection.tsx` | 46→56 | 9 |
| `FastIcon.tsx` | 46→51 | 5 |

三条横切观察：

- 「编译器产物是统一底色」：除 `option-map` 是纯 class 外，十四份均由 `react/compiler-runtime` 的 `_c(N)` 记忆缓存驱动，依赖比对逻辑千篇一律——相关 prop 解构出来逐槽比对，变了才重建 JSX。读这些文件要把 `_c(N)` 当脚手架，真正要理解的是被它包住的渲染分支与业务文案（如 Opus1mMergeNotice 的「1M 上下文」提示、SandboxDoctorSection 的依赖检查结果、KeybindingWarnings 的错误/警告分流）。
- 「无注释段 = 锚点只落签名/语句行」：这批文件源文件几乎没有 `//` 英文注释段（仅 AnimatedAsterisk 有几段），因此批注全部落在函数/类型签名行（before）与语句/收尾行（after），零 `⟳`、零 `⚠`，比前几批更顺。
- 「双向链表与状态分流是两类典型」：`option-map` 用普通 Map 扩展出首/尾指针与 previous/next 双向链表；`reconnectHelpers` 与 `KeybindingWarnings` 都是「按状态/严重级分流返回不同文案」的纯函数，前者给 MCP 重连结果与错误，后者给按键绑定错误与警告。

踩坑：

- 本批十五份数据文件预检 103 锚点全过、0 块内违例；`annotate.py` 十五次零 `⚠`、零 `⟳`，钩子名（keybinding / devbar 等）走间接 runner 也无碍；无正则字面量误判、无漏写位置参数的二元组。
- 尾部 `//# sourceMappingURL` 巨行由 `annotate.py` 自动省略并补两行说明，不计入批注版行数——这正是「批注版 − 原文」略大于锚点数的原因。

流程账：15 个数据文件逐一对齐源文件；预检 103 锚点全过、0 块内违例；`annotate.py` 十五次零 `⚠`、零 `⟳`；原文 752 行 → 批注版 863 行；`check-fidelity.py` 全仓 1445 份 0 失败（较上批 +15）；`check-links.py` 源码链接 2361 条加内链 700 条，0 失效；全仓 1445/1902 文件、411,767/513,237 行、80%；components 355/389（剩 34 份共 938 行）。

**下一批候选（components 降序，建议取 15 份约 601 行，最大件已降到 45 行）**：`ui/OrderedListItem.tsx`(45) · `sandbox/SandboxConfigTab.tsx`(45) · `memory/MemoryUpdateNotification.tsx`(45) · `OffscreenFreeze.tsx`(44) · `MessageModel.tsx`(43) · `FilePathLink.tsx`(43) · `permissions/FilePermissionDialog/ideDiffConfig.ts`(42) · `ToolUseLoader.tsx`(42) · `EffortIndicator.ts`(42) · `StructuredDiff/colorDiff.ts`(37) · `MemoryUsageIndicator.tsx`(37) · `shell/ExpandShellOutputContext.tsx`(36) · `Spinner/ShimmerChar.tsx`(36) · `tasks/renderToolActivity.tsx`(33) · `Spinner/useShimmerAnimation.ts`(31)（components 已做 355/389，剩 34 份共 938 行；全仓还剩 457 份）。
