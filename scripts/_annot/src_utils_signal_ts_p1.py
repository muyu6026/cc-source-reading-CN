ANNOTATIONS = [
    (1, 'after', """模块总述：极简的纯事件信号原语（不含任何存储状态）。把全代码库约 15 处重复的 listener Set 样板（约 8 行）收成一行 createSignal 调用，用于「只关心发生了什么、不关心当前值」的场景。"""),
    (18, 'before', """Signal 类型契约：仅包含 subscribe（订阅并返回退订函数）、emit（带参广播）、clear（清空），刻意不提供 snapshot / getState，与 store（如 `AppState`、`createStore`）区分开。"""),
    (27, 'before', """createSignal 工厂：用闭包持有私有 listeners 集合，返回符合 Signal 形状的对象，每次调用得到相互独立的信号实例。"""),
    (30, 'before', """subscribe 实现：把监听器加入集合，并立即返回一个退订闭包，调用即将其从集合中移除。"""),
    (36, 'before', """emit 实现：遍历当前所有监听器并透传给定参数，实现一对多广播。"""),
    (39, 'before', """clear 实现：清空整个监听器集合，典型用于 dispose / reset 路径。"""),
]
