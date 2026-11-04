# -*- coding: utf-8 -*-
# annotations for src/components/permissions/PowerShellPermissionRequest/powershellToolUseOptions.tsx (91 lines)
ANNOTATIONS = [
    (6, 'before', 'PowerShell 权限弹窗的选项工厂：四个选项值 yes/yes-apply-suggestions/yes-prefix-edited/no'),
    (25, 'before', 'yes 选项支持 input 模式：选 yes 时可附带「接下来告诉 Claude 做什么」的反馈文本'),
    (32, 'after', 'allowEmptySubmitToCancel：input 模式下空提交等于取消——反馈可写可不写'),
    (41, 'after', '两条注释说明 PowerShell 没有 sandbox 选项（Windows 不支持）与分类器选项（Bash 专属的内部功能）——选项工厂按工具能力裁剪'),
    (44, 'before', 'always-allow 组：受 allowManagedPermissionRulesOnly 限制时不显示；可编辑前缀输入优先于静态 suggestions 标签'),
    (50, 'after', 'hasNonPowerShellSuggestions 检测：含目录权限或非 PowerShell 工具规则时，可编辑前缀无法表达这些权限，必须回退静态标签'),
    (54, 'after', '可编辑前缀选项：initialValue 来自静态提取器，用户可改成 Get-Process:* 这类命令前缀；showLabelWithValue 把标签和值合并一行显示（分隔符为冒号加空格）'),
    (65, 'after', '回退路径：generateShellSuggestionsLabel 生成静态描述标签，生成失败（空串）则整个选项不出现'),
    (74, 'before', 'no 选项同样支持 input 模式：拒绝时可告诉 Claude 应该怎么做'),
    (89, 'after', '返回数组而非组件：选项工厂只负责数据，弹窗渲染交给调用方'),
]
