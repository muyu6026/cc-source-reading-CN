# 堆用量提示（仅内部构建）
ANNOTATIONS = [
    (6, 'before', '内部构建专用的堆用量提示：对外构建里整个组件会被摇掉，heapdump 入口不该出现在用户面前'),
    (10, 'before', '这里的判据是构建期常量，条件恒真——对外版本整段是死码，这也是下面条件调用钩子能被接受的唯一理由'),
    (14, 'before', '提前返回让钩子成了条件调用，正常会违反 hooks 规则，所以需要这两行 lint 豁免注释'),
    (26, 'before', 'normal 不显示：只有 high 或 critical 才值得占用一行'),
    (30, 'after', '两级配色：critical 用 error，其余用 warning；文案直接给出 /heapdump 入口，不解释怎么用'),
]
