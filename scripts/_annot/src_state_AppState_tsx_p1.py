# -*- coding: utf-8 -*-
# 批注数据：src/state/AppState.tsx
# 锚点 (行号, pos, 中文)。pos ∈ before/after/after_block。
ANNOTATIONS = [
    (1, 'after', '导入 React 编译器运行时的 `_c` 缓存辅助，编译器据此缓存稳定的中间值。'),
    (12, 'after', '语音上下文是 ant 专属：外部构建走透传组件（直接返回 children），靠死代码消除剔除。'),
    (26, 'after', '从 `./AppStateStore.js` 重新导出若干类型与工厂，供迁移期兼容；最终调用方应直接引用 store 文件。'),
    (37, 'before', '`AppStateProvider`：用外部 store 包裹子组件，并在挂载时同步远程设置、订阅设置变更。'),
    (50, 'after', '用初始状态（或默认状态）创建 store；惰性初始化，仅在依赖变化时才重建工厂函数。'),
    (81, 'after', '`useEffect` 执行挂载副作用：若远程设置先于挂载加载，则在此关闭绕过权限模式。'),
    (90, 'after', '把设置变更订阅器封装成 `useEffectEvent`，供 `useSettingsChange` 调用。'),
    (117, 'before', '`useAppStore`：取出 store；若在 Provider 之外调用则抛错。'),
    (142, 'before', '`useAppState`：订阅状态的一个切片，仅当选中值变化时（按 `Object.is` 比较）才重渲染。'),
    (170, 'before', '`useSetAppState`：只取更新函数而不订阅任何状态，纯更新型组件不会因此重渲染。'),
    (186, 'before', '`useAppStateMaybeOutsideOfProvider`：安全版，Provider 之外调用返回 undefined 而非抛错。'),
]
