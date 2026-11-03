# 批注数据：src/components/permissions/rules/AddWorkspaceDirectory.tsx
# slug: src_components_permissions_rules_AddWorkspaceDirectory_tsx
ANNOTATIONS = [
    (1, 'after', '''引入 React 编译器运行时：本文件是 React Compiler 自动记忆化产物，不是手写源码。'''),
    (18, 'after', '''末尾导入 PromptInputFooterSuggestions：输入框下方的路径补全建议条。'''),
    (23, 'after', '''Props 类型：添加目录的回调、取消回调、权限上下文，以及可选的预置目录路径。'''),
    (25, 'after', '''RememberDirectoryOption：记住方式——仅本会话、永久记住、或不添加。'''),
    (38, 'after', '''REMEMBER_DIRECTORY_OPTIONS：三种记住方式的展示文案常量。'''),
    (39, 'after', '''PermissionDescription：一句话说明 Claude Code 将能读该目录并在自动接受编辑时改文件。'''),
    (50, 'after', '''DirectoryDisplay：把目录路径（带 permission 配色）与说明并排展示。'''),
    (80, 'after', '''DirectoryInput：目录路径输入框，带补全建议、错误提示与底部建议条。'''),
    (137, 'after', '''AddWorkspaceDirectory 组件：往工作区添加可访问目录的弹窗，支持手动输入与预置选择两种形态。'''),
    (173, 'after', '''用 100ms 防抖包裹目录补全请求，避免每次按键都触发文件系统扫描。'''),
    (218, 'after', '''handleSubmit：校验目录是否合法，合法则回调添加，否则把错误提示设成帮助文案。'''),
    (268, 'after', '''handleKeyDown：在补全列表里用 tab/回车采纳、上下键移动、ctrl+p/n 等价移动。'''),
    (300, 'after', '''handleSelect：预置目录时按用户选择回调（本会话/记住/取消）。'''),
    (335, 'after', '''返回组装节点：有预置路径走「展示 + 选择」，否则走「说明 + 输入」形态。'''),
    (337, 'after', '''_temp2 渲染底部键位提示：Tab 补全、Enter 添加、Esc 取消。'''),
]
