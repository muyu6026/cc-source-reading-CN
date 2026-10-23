ANNOTATIONS = [
    (3, 'after', '''// eslint 特批说明：REPL 还没把 handleKeyDown 挂到 <Box onKeyDown> 上，
// 这个 hook 暂时借 useInput 收键，属向后兼容的过渡桥接。'''),
    (25, 'after', '''// 按 delta 步进队友选择，越界回绕：索引 -1 = 主代理（leader），
// 0..n-1 = 各队友，n = 「隐藏」行。从收起态第一次步进只负责展开并停在 leader。'''),
    (29, 'after', '''// delta 只接受 1 或 -1；setAppState 由调用方传入，
// 此模块不直接 import store，保持可独立测试。'''),
    (32, 'after', '''// 没有运行中队友时原样返回 prev——不制造新 state 对象，
// 避免无意义重渲染。'''),
    (41, 'after', '''// 当前不在 teammates 展开态：首次步进只展开并把选择落到
// leader(-1)，不移动队友索引，也不碰 viewing 状态。'''),
    (43, 'after', '''// maxIdx 比队友数多 1，多出来的一行是「隐藏」行
// （收起 spinner 树专用）。'''),
    (52, 'after', '''// 回绕方向不对称：down 越过 maxIdx 回 -1，up 在 -1 时回 maxIdx。
// 返回时统一把 viewSelectionMode 复位成 selecting-agent，
// 防止从 viewing 态直接步进时残留查看模式。'''),
    (58, 'after', '''// 整个步进走 setAppState(prev => ...) 函数式更新：读最新 state、
// 不依赖渲染闭包，也免除了把 tasks 依赖进 useCallback。'''),
    (67, 'after', '''// 职责：Shift+↑/↓ 在后台任务间导航。有队友时切 leader/队友树，
// 只有普通后台任务时调 onOpenBackgroundTasks 开对话框；
// 另管 Enter 确认、f 看记录、k 杀队友。'''),
    (69, 'after', '''// 返回 handleKeyDown 交给 REPL 组合键链；对话框开启走注入的
// options 回调，hook 本身不依赖 REPL。'''),
    (74, 'after', '''// 四个 useAppState 选择器订阅同一 store；teammateTasks 每渲染重算
// （getRunningTeammatesSorted 是纯函数，无缓存）。'''),
    (78, 'after', '''// 字母序排序是为了与 TeammateSpinnerTree 的显示顺序逐行对齐——
// 界面上的第 N 行必须等于 selectedIPAgentIndex = N，
// 否则方向键会跳错行。'''),
    (83, 'after', '''// 非队友后台任务（local_agent/local_bash 等）走另一条路：
// 不进队友树，直接开后台任务对话框。'''),
    (86, 'after', '''// 用 ref 记住上一帧的队友数：effect 里要区分「首次挂载就是 0」
// 和「队友被移除后变成 0」，后者才需要重置选择索引。'''),
    (100, 'after', '''// 三个条件同时满足才重置：当前 0 个 + 上一帧 >0 + 索引不是 -1。
// 初始挂载（prevCount=0）不动状态，避免开机就乱清。'''),
    (117, 'after', '''// 正在看已完成队友的记录时只清索引、保留 viewing-agent 模式——
// 用户还要靠 Esc 自己退出查看；其余情况连模式一起清。'''),
    (122, 'after', '''// 夹取上限随展开态变化：teammates 展开时「隐藏」行
// （index = count）合法，未展开时最大只能到 count-1。'''),
    (132, 'after', '''// 依赖只有 teammateCount 和 setAppState：队友数变化才是重算时机，
// 每帧都夹取反而会和步进逻辑抢写同一字段。'''),
    (145, 'after', '''// 取当前选中队友；索引越界或空树都返回 null，调用方各自判空。'''),
    (150, 'after', '''// Esc 在查看态的两栖语义：队友还在跑 → 只中止当前轮
// （currentWorkAbortController），队友本身活着；已结束 → 退出查看。'''),
    (160, 'after', '''// 故意用 currentWorkAbortController 而不是 abortController：
// 后者是杀死整个队友进程的开关，这里只想停掉它这一轮的工作。'''),
    (164, 'after', '''// 队友不在跑（或任务已不存在）→ 直接退出查看态，不停任何东西。'''),
    (176, 'after', '''// Esc 在选择态：只退出选择模式，不动 leader 进行中的工作。'''),
    (180, 'after', '''// Shift+↑/↓ 的路由：有队友 → 步进选择；没队友但有普通后台任务
// → 开对话框。'''),
    (188, 'after', '''// 两条分支都 preventDefault + return，避免按键继续冒泡到输入框。'''),
    (203, 'after', '''// f 只在 selecting 态有效：把选中队友设为查看目标
// （enterTeammateView）。'''),
    (216, 'after', '''// 「隐藏」行被回车：收起整棵队友树并退回 none，
// 等价于视觉上隐藏 spinner。'''),
    (225, 'after', '''// 回车的三态：-1 回 leader；>=count 命中隐藏行收起树；
// 其余进入查看。'''),
    (239, 'after', '''// k 只杀 running 的队友；对已结束的任务静默忽略，
// 防止误触报错。'''),
    (245, 'after', '''// 过渡桥接：REPL 尚未接线，这里用 useInput 收键并包成
// KeyboardEvent，等 REPL 迁移后随 TODO 一起删。'''),
    (248, 'after', '''// useInput 回调里把 InputEvent 适配成 KeyboardEvent——
// 两套事件体系的 key 字段名不同，这里只透传 keypress。'''),
]
