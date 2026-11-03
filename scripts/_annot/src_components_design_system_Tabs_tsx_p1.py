# 批注数据：src/components/design-system/Tabs.tsx
# slug: src_components_design_system_Tabs_tsx
ANNOTATIONS = [
    (1, 'after', '''引入 React 编译器运行时：本文件是 React Compiler 自动记忆化产物，不是手写源码。'''),
    (10, 'after', '''末尾导入 Theme 类型，用于 tab 文字配色。'''),
    (47, 'after', '''TabsProps：标签页容器属性，支持非受控与受控两种模式，以及键盘导航开关。'''),
    (55, 'after', '''TabsContextValue：向子 Tab 与 hooks 暴露当前选中、宽度、表头聚焦状态等。'''),
    (65, 'after', '''TabsContext 默认值：组件在 Tabs 外独立渲染时（如测试），内容默认获得焦点、聚焦表头为空操作。'''),
    (66, 'after', '''Tabs 组件：标签页容器，负责选中态管理、键盘切页、表头聚焦与内容布局。'''),
    (90, 'after', '''isControlled 区分受控（由父级 selectedTab 决定）与非受控（内部 state）。'''),
    (125, 'after', '''handleTabChange：按偏移量循环切到相邻 tab，受控时回调父级，非受控时改内部 state。'''),
    (169, 'after', '''handleKeyDown：表头聚焦且已 opt-in 时，按下方向键把焦点移入内容区。'''),
    (196, 'after', '''计算标题、各 tab、间隔等宽度，决定要不要补齐 spacer。'''),
    (242, 'after', '''返回 Provider 包裹的节点：表头（标题 + tab 行）+ 可选 banner + 内容区。'''),
    (256, 'after', '''Tab 子组件：仅当自身被选中时渲染内容，否则返回 null。'''),
    (289, 'after', '''useTabsWidth：读取上下文里的当前内容宽度，供子组件做宽度自适应。'''),
    (307, 'after', '''useTabHeaderFocus：让子组件（如 Select）opt-in 表头聚焦门控，并在卸载时退回聚焦态。'''),
]
