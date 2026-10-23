ANNOTATIONS = [
    (34, 'after', '''// 缓存四件套：已完成回合数组、进行中回合、已处理到的消息下标、
// 回合计数。全部活在 ref 里，不触发渲染。'''),
    (45, 'after', '''// 新建文件没有 structuredPatch（没有旧内容可比），
// 靠 type='create' + content 识别——这条分支决定后面合成 hunk。'''),
    (47, 'after', '''// 两个工具的输出形状不同（FileEditTool 无 type 字段），
// 用鸭子类型判定，避免 import 具体类型做强转。'''),
    (53, 'after', '''// 只用于拿 create 分支的 content：update 分支的 content 是全量旧文，
// 不需要。'''),
    (68, 'after', '''// 行数统计只数字符级 +/− 前缀：diff 库的 hunk.lines 已含上下文行，
// 不带 + 或 − 的就是上下文，不计入。'''),
    (74, 'after', '''// 预览截断到 30 字符：slice(0,29) 加省略号保持总长 30。'''),
    (91, 'after', '''// stats 是派生值：每次文件表变化都全量重算，
// 不增量维护（turn.files 是 Map，遍历便宜）。'''),
    (93, 'after', '''// 从消息流里提取「按回合的文件 diff」。一个回合 = 一条用户提示 +
// 随后的 assistant 响应和工具结果。只返回含文件编辑的回合。
// 增量累计：每帧只处理自上次以来的新消息。'''),
    (106, 'after', '''// useRef 而不是 useState：缓存是纯计算中间态，
// 放 state 里会多一次渲染。'''),
    (111, 'after', '''// 回退检测：用户 rewound 对话后消息变短，全量缓存作废重来。'''),
    (120, 'after', '''// 只从 lastProcessedIndex 开始扫：同一批消息重复渲染不重算，
// 这是 useMemo 内做增量的关键。'''),
    (122, 'after', '''// 跳过非 user 消息：只有 user 消息能开新回合。'''),
    (124, 'after', '''// tool_result 也是 user 型消息（API 结构如此），
// 靠 toolUseResult 字段或 content[0].type 识别，不当成新回合。'''),
    (130, 'after', '''// 双重排除：工具结果 + isMeta（系统注入的伪 user 消息）。'''),
    (145, 'after', '''// 文件编辑只从 toolUseResult 里收集：assistant 消息里的 tool_use
// 只有输入没有结果，没有 diff 可算。'''),
    (163, 'after', '''// 同文件在一个回合里可能被编辑多次：Map 按路径聚合成一个条目，
// hunks 顺序追加，行数累加。'''),
    (178, 'after', '''// 新建文件合成一个「全是 +」的 hunk：oldStart/oldLines 为 0，
// 让 diff 视图把创建也渲染成新增块，无需特判。'''),
    (181, 'after', '''// 合成分支直接按 content 行数计 added——这些行没有真实 hunk 可数。'''),
    (190, 'after', '''// 常规分支：hunks 原样追加，行数按 +/− 前缀统计。'''),
    (195, 'after', '''// 先 create 后 edit 的文件仍标记 isNewFile：
// 视图按「新文件」渲染（不带删除侧）。'''),
    (200, 'after', '''// 推进游标到消息总数：即使本帧没有新 user 消息也推进，
// 否则下一帧会重复扫同一段。'''),
    (208, 'after', '''// 当前回合也进结果：这一轮正在进行的编辑要实时可见。'''),
    (212, 'after', '''// reverse 成「最新在前」：UI 是倒序时间线。
// 注意返回的是新数组，cache 里的 completedTurns 顺序不变。'''),
]
