# 数据文件：src/components/ThinkingToggle.tsx
# slug = src_components_ThinkingToggle_tsx
ANNOTATIONS = [
    (18, 'before', '''组件入口：编译器运行时把入参解构成 `t0`，并调用 `_c(27)` 预留 27 个记忆化缓存槽（对应下文每个 `$[n]`）'''),
    (43, 'after', '''思考模式的两个选项：value 用字符串 `true`/`false` 而非布尔，是为了和 `Select` 组件的选项值类型对齐'''),
    (68, 'after', '''绑定 confirm:no 键：触发 `t2` 回调，在确认态下收起、否则调用 `onCancel`；context 设为 Confirmation 以便与确认键区分'''),
    (94, 'after', '''绑定 confirm:yes 键：仅当处于确认态时把当前选择提交给 `onSelect`，避免中途误触直接提交'''),
    (113, 'after', '''主标题与说明：用 `flexDirection='column'` 纵向排布「切换思考模式」标题与一句话描述'''),
    (122, 'after', '''确认态分支：若用户中途切换思考模式，先提示会增加延迟并可能降低质量；否则直接渲染 `Select` 让用户选启用或停用'''),
    (133, 'after', '''底部提示条：根据是否处于确认态、是否等待退出，显示不同的快捷键引导（Enter 确认 / Esc 退出）'''),
    (143, 'after', '''把标题区 `t9` 与提示区 `t10` 包进 `Pane`，整体以权限对话框风格（permission 配色）呈现'''),
]
