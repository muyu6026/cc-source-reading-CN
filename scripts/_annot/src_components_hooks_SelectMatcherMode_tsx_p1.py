# 数据文件：src/components/hooks/SelectMatcherMode.tsx
# slug = src_components_hooks_SelectMatcherMode_tsx
ANNOTATIONS = [
    (28, 'before', '''hook 事件下的匹配器选择视图：/hooks 菜单只读，不提供「新增匹配器」，只让用户下钻查看每个匹配器的 hooks'''),
    (43, 'after', '''为每个匹配器聚合来源集合（去重）与 hook 数量，供列表展示'''),
    (66, 'after', '''该事件没有任何匹配器时走空态：提示去 settings.json 或让 Claude 添加'''),
    (90, 'after', '''把带来源的匹配器映射成选项：标签形如「[来源] 匹配器」，描述是 hook 数量（自动单复数）'''),
    (108, 'after', '''渲染匹配器列表选择框，选中后回调上层 `onSelect`'''),
    (118, 'after', '''最外层用 Dialog 包住，标题为「事件名 - Matchers」，副标题是事件描述'''),
    (130, 'after', '''选项标签构造：把来源用 `hookSourceInlineDisplayString` 拼成可读串，匹配器为空时显示 (all)'''),
    (143, 'after', '''取每个 hook 的来源字段，用于上面的来源去重集合'''),
]
