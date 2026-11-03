# 数据文件：src/components/permissions/BashPermissionRequest/bashToolUseOptions.tsx
# slug = src_components_permissions_BashPermissionRequest_bashToolUseOptions_tsx
ANNOTATIONS = [
    (9, 'before', '''Bash 工具权限请求的可选项联合类型：yes / 带采纳建议 / 带改写前缀 / 带分类器描述 / no'''),
    (15, 'before', '''判断某条描述是否已存在于允许列表：先转小写并去掉尾部空白再比较，避免重复添加'''),
    (23, 'before', '''剥离输出重定向：把 `> file` 之类重定向去掉，避免文件名被误当成要展示的命令'''),
    (31, 'before', '''按当前交互态组装 Bash 权限弹窗的全部选项：是否显示「总是允许」取决于托管规则开关与各类建议'''),
    (62, 'after', '''「是」选项：处于输入模式时是带占位符的输入框，否则是普通选项'''),
    (79, 'after', '''只有不被 allowManagedPermissionRulesOnly 限制时才展示「总是允许」类选项'''),
    (84, 'after', '''判断建议里是否混有非 Bash 项（加目录、加规则）：有则不走可编辑前缀，因为前缀表达不了它们'''),
    (115, 'after', '''分类器选项守卫：字符串 external 与 ant 恒不相等，该条件永远为假（属被禁用的实验分支）；其余条件满足时才追加「按分类器描述不再询问」'''),
    (130, 'after', '''「否」选项：输入模式下是带占位符的输入框，否则是普通选项'''),
]
