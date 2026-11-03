# 数据文件：src/components/permissions/rules/WorkspaceTab.tsx
# slug = src_components_permissions_rules_WorkspaceTab_tsx
ANNOTATIONS = [
    (25, 'before', '''权限设置里的「工作目录」标签页：列出当前额外工作目录，支持新增或删除某个目录'''),
    (37, 'after', '''复用标签页头聚焦 hook：拿到 `headerFocused` 与 `focusHeader`，用于在表头与列表间上下切换焦点'''),
    (53, 'after', '''头部聚焦状态变化时回调上层 `onHeaderFocusChange`，让外部感知当前焦点在表头还是列表'''),
    (56, 'after', '''从权限上下文取出所有额外工作目录的键集合，再映射成目录项（含是否可删除标记）'''),
    (66, 'after', '''选择处理：选 `add-directory` 触发新增；否则在目录表里找对应项，仅当可删除才调用删除回调'''),
    (85, 'after', '''取消处理：以「Workspace dialog dismissed」为结果退出，并把展示方式设为 system（系统级提示）'''),
    (100, 'after', '''列表末尾追加「Add directory…」选项，值固定为 add-directory 以触发新增流程'''),
    (116, 'after', '''首行展示原始工作目录 `getOriginalCwd()`，并标注其为「原始工作目录」不可删除'''),
    (121, 'after', '''可见选项数上限取 10 与列表长度的小者，目录过多时只露出前 10 项'''),
]
