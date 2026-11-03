# 批注数据：src/components/Settings/Usage.tsx
# slug: src_components_Settings_Usage_tsx
ANNOTATIONS = [
    (1, 'after', '''引入 React 编译器运行时：本文件是 React Compiler 自动记忆化产物，不是手写源码。'''),
    (16, 'after', '''末尾导入 OverageCreditUpsell：超额用量可抵扣积分时的升级提示组件。'''),
    (24, 'after', '''LimitBarProps：单个限额进度条所需的标题、限额对象、最大宽度等。'''),
    (42, 'after', '''usedText 把利用率格式化为「N% used」展示。'''),
    (63, 'after', '''宽屏（≥62 列）用横向进度条布局，窄屏用紧凑文字布局。'''),
    (173, 'after', '''LimitBar 收尾：按宽度选择两种布局之一返回进度条节点。'''),
    (174, 'after', '''Usage 主组件：拉取用量数据并渲染会话/周/周（仅 Sonnet）等限额条。'''),
    (181, 'after', '''availableWidth 与 maxWidth：屏幕边距后可用宽度，上限 80 列。'''),
    (201, 'after', '''loadUtilization 拉取用量，失败时用 axios 响应体构造错误文案。'''),
    (236, 'after', '''showSonnetBar：仅 Max/Team 或无方案未知时显示独立的 Sonnet 限额条。'''),
    (246, 'after', '''limits 数组按方案拼接：会话限额、周限额，必要时追加 Sonnet 周限额。'''),
    (264, 'after', '''渲染整页用量：每个限额一条 LimitBar，外加额外用量段、超额提示与取消键提示。'''),
    (270, 'after', '''EXTRA_USAGE_SECTION_TITLE 常量：额外用量段的固定标题。'''),
    (281, 'after', '''非 Pro/Max 方案的额外用量段直接返回 false（不渲染）。'''),
    (376, 'after', '''ExtraUsageSection 收尾：把已用/月度上限格式化成「N / M spent」交给 LimitBar。'''),
]
