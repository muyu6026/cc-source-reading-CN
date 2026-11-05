ANNOTATIONS = [
    (1, 'before', '''React Compiler 运行时：`_c(N)` 缓存 memo 槽，这是编译产物而非手写代码'''),
    (8, 'before', '''HandlerRegistration：动作回调的注册项（action + context + handler）'''),
    (13, 'before', '''KeybindingContextValue：上下文暴露的能力集合（解析 / 挂接 / 调用 / 状态）'''),
    (44, 'before', '''创建 React Context，初始值 null（必须在 Provider 内使用）'''),
    (59, 'before', '''KeybindingProvider：构造上下文 value，用 React Compiler 的 `_c(N)` 缓存各 memo 槽'''),
    (182, 'after', '''返回包裹 value 的 Provider 元素，组件结束'''),
    (184, 'before', '''useKeybindingContext：消费上下文，缺失则抛错'''),
    (196, 'before', '''useOptionalKeybindingContext：Provider 外返回 undefined，供可选使用'''),
    (215, 'before', '''useRegisterKeybindingContext：挂载时注册、卸载时注销某上下文，使其按键优先于 Global'''),
    (242, 'after', '''通过 useLayoutEffect 在挂载 / 卸载时完成注册与注销，组件结束'''),
]
