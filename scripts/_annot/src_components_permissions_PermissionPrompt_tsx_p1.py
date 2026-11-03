# 批注数据：src/components/permissions/PermissionPrompt.tsx
# slug: src_components_permissions_PermissionPrompt_tsx
ANNOTATIONS = [
    (1, 'after', '''引入 React 编译器运行时：本文件是 React Compiler 自动记忆化产物，不是手写源码。'''),
    (8, 'after', '''末尾导入 OptionWithDescription 与 Select：带描述选项与通用选择器。'''),
    (9, 'after', '''FeedbackType：反馈类型——接受或拒绝。'''),
    (18, 'after', '''PermissionPromptOption：单个选项，可携带反馈配置与键位绑定。'''),
    (29, 'after', '''PermissionPromptProps：权限提示组件的对外属性。'''),
    (33, 'after', '''DEFAULT_PLACEHOLDERS：接受/拒绝两类反馈输入框的默认占位文案。'''),
    (45, 'after', '''PermissionPrompt 组件：权限询问的共享组件，支持可选的反馈输入（Tab 展开）与遥测上报。'''),
    (54, 'after', '''question 默认值：未传入时显示「Do you want to proceed?」。'''),
    (81, 'after', '''showTabHint：当前聚焦项带反馈配置且未展开输入时，提示可用 Tab 补充。'''),
    (135, 'after', '''selectOptions：把选项映射成 Select 兼容格式，带反馈配置的展开项会变成 input 类型。'''),
    (181, 'after', '''handleInputModeToggle：Tab 在「展开反馈输入」与「收起」之间切换，并上报对应遥测。'''),
    (225, 'after', '''handleSelect：选中时收集反馈文字并上报 accept/reject 提交遥测，再回调父级。'''),
    (240, 'after', '''handlers：把每个选项的键位绑定映射到对应的 select 调用。'''),
    (264, 'after', '''handleCancel：Esc 取消时上报 escape 遥测、累加 attribution 逃逸计数并回调父级。'''),
    (325, 'after', '''返回组装节点：问题文字 + 选择器 + 底部 Esc/Tab 提示。'''),
    (327, 'after', '''_temp：取消时通过 setAppState 把 attribution.escapeCount 加一。'''),
]
