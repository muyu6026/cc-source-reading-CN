# 批注数据：src/components/RemoteEnvironmentDialog.tsx
# slug: src_components_RemoteEnvironmentDialog_tsx
ANNOTATIONS = [
    (1, 'after', '''引入 React 编译器运行时：本文件是 React Compiler 自动记忆化产物，不是手写源码。'''),
    (20, 'after', '''DIALOG_TITLE 与 SETUP_HINT：弹窗标题与「去 claude.ai/code 配置环境」的提示文案常量。'''),
    (25, 'after', '''LoadingState 类型：加载中 / 更新中 / 空闲三种状态。'''),
    (26, 'after', '''RemoteEnvironmentDialog 组件：让用户选择默认的远程执行环境，写回 localSettings。'''),
    (82, 'after', '''挂载时拉取可用环境与当前选中项，卸载则标记 cancelled 避免回调落空。'''),
    (109, 'after', '''handleSelect：选中后写回默认环境 id 到 localSettings，并提示结果。'''),
    (127, 'after', '''加载中直接显示 LoadingState 并返回。'''),
    (147, 'after', '''有错误时显示错误文案并返回。'''),
    (165, 'after', '''没有可用环境时提示去配置，并返回。'''),
    (177, 'after', '''只有一个环境时走 SingleEnvironmentContent 简化界面。'''),
    (192, 'after', '''返回多环境选择界面（MultipleEnvironmentsContent）。'''),
    (224, 'after', '''EnvironmentLabel：环境名加粗 + 灰色的 environment_id，用于选项展示。'''),
    (259, 'after', '''SingleEnvironmentContent：单环境时一键确认，绑定 confirm:yes 直接 onDone。'''),
    (333, 'after', '''MultipleEnvironmentsContent：多环境列表 + 当前使用项来源后缀 + 键位提示。'''),
    (340, 'after', '''_temp 把每个环境映射成 Select 选项（标签含名称与 id）。'''),
]
