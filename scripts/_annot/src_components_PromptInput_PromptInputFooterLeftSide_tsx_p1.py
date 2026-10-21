# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  PromptInputFooterLeftSide：footer 左半边的那一串「小药丸」
// ═══════════════════════════════════════════════════════════════
//
//  这个文件里有两个组件，分工很清楚：
//
//    PromptInputFooterLeftSide（第 127 行起）
//        只做**早退仲裁**：要退出吗？在粘贴吗？在搜历史吗？然后交给下面。
//        它自己只有 27 个缓存槽，因为逻辑就三句话。
//
//    ModeIndicator（第 237 行起）
//        真正的重头戏：权限模式、后台任务胶囊、团队、PR、语音、选区提示…
//        十几种元素抢一行，全靠 primaryItemCount 做预算。
//
//  整个文件被 React Compiler 编译过（满是 $[n] 和 tN），但 ModeIndicator
//  那段几乎是**手写风格**（大量具名变量、几乎没有缓存槽）——
//  因为它内部全是 hook 调用和分支，能缓存的东西本来就不多。'''),

    (44, 'before', '''// 【第 2 行的 biome-ignore-all 解释了为什么 import 顺序很怪】
//
//  `assist/source/organizeImports: ANT-ONLY import markers must not be reordered`
//
//  这句注释说明：内部构建工具会在特定 import 位置插入标记注释，
//  如果格式化器把 import 重排了，标记就对不上了。
//
//  于是第 4-7 行出现了一个奇怪的现象：require 语句夹在 import 之间
//  （第 6 行的 coordinatorModule 在 Box 的 import 之前）。
//  正常格式化会把它挪到所有 import 之后，但这里不能挪。
//
//  读代码时看到「格式明显不对但没被 lint 拦」，先找文件顶部的忽略注释 ——
//  通常是构建流程的硬要求，不是疏忽。'''),

    (49, 'before', '''// 【两个常量函数，专门用来喂 useSyncExternalStore 的空实现】
//
//    NO_OP_SUBSCRIBE = (_cb) => () => {}    订阅（什么也不做，返回空退订）
//    NULL            = () => null           取快照（永远是 null）
//
//  为什么需要它们：proactiveModule 可能是 null（功能被编译剔除），
//  但 useSyncExternalStore **必须**拿到两个函数，不能传 undefined。
//
//  用常量而不是内联箭头函数，还有个更实际的原因：**内联的话每次渲染
//  都是新函数引用，useSyncExternalStore 会重新订阅**（它把 subscribe 当依赖）。
//  用模块级常量就永远稳定。
//
//  注意 NULL 被用了两次（getSnapshot 和 getServerSnapshot）—— 终端渲染
//  没有 SSR，但 hook 签名要求两个都传。'''),

    (76, 'before', '''// 【`proactiveModule?.subscribeToProactiveChanges ?? NO_OP_SUBSCRIBE` 的三层含义】
//
//  第一层：模块被编译剔除 → undefined ?? NO_OP → 空订阅（组件永远拿到 null）
//  第二层：模块在，但订阅函数没导出 → 同上
//  第三层：模块和函数都在 → 真订阅
//
//  于是这个组件在三种情况下都能正常工作，且不需要任何条件渲染包裹。
//  这是「用空实现代替条件」的又一次应用（同 Notifications.tsx 的 `() => null` 组件）。
//
//  第 77 行 state 是 remainingSeconds，用 useState<number | null>：
//  null 表示「没有倒计时」，和「倒计时到 0」是两件事。
//  **0 和 null 必须分开** —— 0 意味着「马上开始」，null 意味着「不需要显示」。'''),

    (127, 'before', '''// 【包装层只有三个出口，顺序就是优先级】
//
//    1. exitMessage.show   → 「再按一次退出」
//    2. isPasting          → 「Pasting text…」
//    3. 其余               → 正常内容（历史搜索框 / vim 提示 / ModeIndicator）
//
//  这三档的共同点：它们都是**替换整行**，而不是加一行。
//  这样 footer 高度永远不变（全屏模式下这一点是硬要求，见 ModeIndicator 尾部注释）。
//
//  第 168-177 行的 showVim 判断值得单独说：
//
//      isVimModeEnabled() && vimMode === "INSERT" && !isSearching
//
//  只在「vim 模式已启用 + 当前在 INSERT + 没在搜历史」时显示 -- INSERT --。
//  三个条件缺一不可：vim 没启用时显示它毫无意义；NORMAL 模式下光标形状已经
//  说明了一切；搜索历史时模态提示会让用户误以为可以按 esc 退到 NORMAL。'''),

    (237, 'before', '''// 【ModeIndicator 有 9 个 props，但只有 3 个参与渲染决策】
//
//    mode / showHint / isLoading          → 真的影响渲染
//    tasksSelected / teamsSelected / tmuxSelected / teammateFooterIndex
//                                          → 只往下传给子胶囊（选中高亮）
//    toolPermissionContext / onOpenTasksDialog → 透传
//
//  所以这个组件的复杂度不在 props，而在它自己挂的那十来个 hook：
//  终端尺寸、快捷键、tasks、teamContext、remoteSessionUrl、viewSelectionMode、
//  viewingAgentTaskId、expandedView、prStatus、tungsten、proactive、voice ×3、
//  选区、tasksV2…
//
//  数一下：**15 个以上的订阅**。任何一个变化都会让这整个组件重渲染。
//  这就是为什么它内部几乎所有派生值都是普通 const 而不是 useMemo ——
//  反正都要重算，加 useMemo 只是多一层开销。'''),

    (257, 'before', '''// 【useState 的惰性初始化，用来「读一次就用」】
//
//      const [remoteSessionUrl] = useState(() => store.getState().remoteSessionUrl)
//
//  注意解构时**丢掉了 setter**。这个用法的意图不是「管理状态」，
//  而是「在组件生命周期内固定一个值」。
//
//  为什么不直接 `const x = store.getState().remoteSessionUrl`：
//  那会在每次渲染时重读，而这个字段在 --remote 模式下由 main.tsx 设置一次、
//  之后永不改。两种写法结果一样，但 useState 版本把意图写明了：
//  **我要的是挂载那一刻的值，不随重渲染变化。**
//
//  代价：如果真有办法改它，UI 不会更新。注释里那句「never mutated」就是在
//  声明这个前提。前提一旦破了，这里就会变成 bug。'''),

    (263, 'before', '''// 【selector 里塞了个恒假条件 —— 这行永远返回 false】
//
//      useAppState(s => "external" === 'ant' && s.tungstenActiveSession !== undefined)
//
//  对外构建里，这个箭头函数返回的永远是 false（字符串比较是常量）。
//  于是它订阅了一个「永远不变的 false」—— 这个订阅永远不会触发重渲染。
//
//  为什么还要写：内部构建里这个条件是 true，逻辑照常工作。
//  也就是说**这一行在两种构建里的行为完全不同**，而代码只有一份。
//
//  性能上有个微妙之处：如果状态库用 Object.is 比较 selector 结果，
//  false === false 就跳过通知，所以这个订阅在外部构建里几乎零成本。
//  但如果状态库每次都调用 selector 并用引用比较（返回新对象那种写法），
//  这里就会每帧都判定为变化。**selector 返回标量是安全的前提。**'''),

    (277, 'before', '''// 【`count(values, t => isBackgroundTask(t) && !("external" === 'ant' && isPanelAgentTask(t)))`】
//
//  拆开看：统计「是后台任务」且「不是面板里的 agent 任务」的数量。
//  后半截那个恒假条件意味着：对外构建里 `!false` → 永远为真 →
//  等价于只统计 isBackgroundTask。
//
//  这种「条件里带常量」的写法会把简单表达式读得很难看，但它有个好处：
//  **内部构建和外部构建共用同一份逻辑**，不需要两份代码。
//  代价是外部版本里多了两个永远为真的判断（编译器不一定会把它化简掉）。
//
//  useMemo 的依赖是 [tasks]，这是正确的：count 是纯函数，只依赖 tasks 的形状。
//  但注意 tasks 里的任务对象可能是**原地更新**的（同一个对象改字段），
//  那样 useMemo 就不会重算 —— 这个仓库里的状态更新基本是「整棵替换」，
//  所以没问题。判断这类正确性，要去看 store 的更新方式，不能只看这一行。'''),

    (291, 'before', '''// 【voiceHintUnderCap：在挂载时快照「提示额度还剩多少」】
//
//  第 293 行 `useState(() => (getGlobalConfig().voiceFooterHintSeenCount ?? 0) < MAX)`
//  —— 惰性初始化，只读一次配置。
//
//  注释（第 286-290 行）解释了为什么不每次读：如果另一个 CC 实例在这期间
//  把计数加上去了，这个提示会**中途消失**（因为条件从 true 变 false）。
//  快照一次就避免了这种闪烁。
//
//  同时第 296-310 行的 effect 负责「用掉一次额度」：带 ref 防重入
//  （voiceHintIncrementedRef），并且写配置时再检查一次
//  `prev.voiceFooterHintSeenCount >= newCount` 就返回 prev —— 因为
//  **多个进程可能同时写同一个配置文件**，读-改-写之间必须重新比较。
//
//  这三段合起来是一个完整的「跨进程计数」实现：读时快照、写时重检、
//  内存里防重入。少任何一环都会导致计数偏大（提示过早消失）。'''),

    (302, 'before', '''// 【saveGlobalConfig 的 updater 里再判一次，是防并发写的标准做法】
//
//      saveGlobalConfig(prev => {
//        if ((prev.voiceFooterHintSeenCount ?? 0) >= newCount) return prev
//        return { ...prev, voiceFooterHintSeenCount: newCount }
//      })
//
//  为什么：newCount 是在外面算的（读一次配置 +1）。如果在这中间
//  另一个进程把值从 2 改成了 3，那么 newCount（=3）就不该再覆盖了。
//  这里返回 prev（同一个引用）让 saveGlobalConfig 知道「无需落盘」。
//
//  **返回同一个引用** 是这类 updater 的约定信号：我不改。
//  很多状态库（含 React 的 setState）都靠引用相等来跳过更新。
//  如果这里返回 `{...prev}`，即使值没变也会触发一次写入。'''),

    (328, 'before', '''// 【预算：`primaryItemCount` 决定后面能不能显示附加信息】
//
//  三项各自算一个：
//    权限模式或协调者模式   （二选一，算 1）
//    后台任务              （有才算 1）
//    团队                  （有才算 1）
//
//  然后第 334 / 337 行用它做两个门槛：
//    primaryItemCount < 2  → 可以显示 PR 状态（且还要 80 列以上）
//    primaryItemCount < 2  → 可以显示「shift+tab 切换模式」提示
//
//  这不是「按重要性排序」，而是**按信息密度做的限流**：
//  一个行里塞三个药丸已经很挤，第四个开始就没人看得懂。
//
//  第 330-333 行的注释解释了阈值为什么从 100 降到 2：原来那个 >=100 是
//  给 diff 指示器（很长）设的，现在 PR 指示器只有 ~10 字符，原来的门槛
//  过于保守，导致 80 列终端上永远看不到 PR 状态。'''),

    (348, 'before', '''// 【modePart 为什么先算出来，而不是直接在 parts 里拼】
//
//  因为它在两处被用到：
//    第 390 行（teammate pills 分支）：作为 otherParts 的第一个元素
//    第 471 行（正常分支）：单独放在一个 flexShrink=0 的 Box 里
//
//  两处的布局待遇不同 —— 正常分支里它不许被压缩（否则「auto on」这类文字
//  会被截成「au…」），所以必须单独拎出来。**同一份内容在不同布局里需要
//  不同的容器，所以先算出内容、再决定容器。**
//
//  第 348 行那个长三元里还有个条件：`!getIsRemoteMode()`。
//  远端模式下 agent 在别处跑，本地这个「权限模式」不代表 agent 的真实状态，
//  显示出来会误导 —— 所以干脆不显示。'''),

    (359, 'before', '''// 【parts 是一个「用展开语法拼起来的数组」】
//
//  每个元素都是 `...(条件 ? [元素] : [])` —— 展开空数组等于没加。
//  这种写法比 `if (cond) parts.push(x)` 更适合声明式阅读：一眼能看到
//  「这一行由哪几段组成，各自的开关是什么」。
//
//  顺序即视觉顺序（从左到右）：
//    remote 会话 → tmux 药丸 → 团队 → PR 状态
//
//  注意第 364-366 行的注释：BackgroundTaskStatus **不在** parts 里。
//  原因很具体 —— parts 最后会被包进 `<Text wrap="truncate">`，
//  而 Ink 的协调器**不允许 Box 出现在 Text 内部**（会抛异常）。
//  任务胶囊自己是个可点击的 Box，所以它只能作为 Text 的兄弟节点。
//
//  这条约束（Box 不能进 Text）在 Ink 里是硬规则，整个仓库里到处能看到
//  为它让步的布局代码。看到「某些元素被特殊拎出来单独放」，先想这条。'''),

    (387, 'before', '''// 【teammate pills 分支：胶囊独占一行，其余内容另起一行】
//
//  返回的结构是：
//
//      <Box flexDirection="column">
//        <Box><BackgroundTaskStatus …/></Box>     ← 第一行：队友胶囊
//        <Box><Byline>{otherParts}</Byline></Box> ← 第二行：其余所有
//      </Box>
//
//  为什么必须分两行：胶囊里每个队友名字长短不一，如果和模式提示混排，
//  一行的宽度会被挤爆。分两行后，胶囊可以自己横向滚动/截断，
//  其它信息另有一整行可用。
//
//  Byline 是这套设计系统里的「用 · 分隔的一串小字」。它的存在意味着
//  第二行的所有元素都在同一个视觉层级 —— 谁也不能比谁更突出。
//
//  第 390 行那个 `isViewingCompletedTeammate ? [] : hintParts` 也值得看：
//  正在看一个**已经结束**的队友时，不显示「esc 中断」之类的 spinner 提示，
//  因为上面已经加了「esc 返回队长」—— 两个 esc 提示同时出现会互相矛盾。'''),

    (409, 'before', '''// 【兜底提示：什么都没得显示时，显示「? for shortcuts」】
//
//  条件是 `parts.length === 0 && !tasksPart && !modePart && showHint`。
//  四个条件都是「没有」—— 这是一个**空集检测**。
//
//  为什么需要它：新用户第一次打开界面时，footer 是空的。
//  空行看起来像界面坏了，所以放一句话告诉他「还有更多功能可按 ?」。
//
//  注意 showHint 也在条件里：老年用户把提示关了，这个兜底也不该出现。
//
//  同一行 `<Text dimColor key="shortcuts-hint">` 那个 key 是必须的 ——
//  parts 是个数组，React 要求数组元素带 key，否则每次渲染都会警告
//  （并且可能错误复用）。这个文件里每个 parts.push 都带了 key，别以为是装饰。'''),

    (420, 'before', '''// 【selectionHintHasContent：选区提示该不该出现的判据】
//
//      hasSelection && (!copyOnSelect || isXtermJs())
//
//  拆开：有选区，并且（不自动复制 或 是 xterm.js 环境）。
//
//  两种情况需要提示：
//    · copyOnSelect = false → 用户得自己按 ctrl+c，所以要告诉他
//    · 在 xterm.js 里（VS Code/Cursor/Windsurf 的终端）→ 需要按住修饰键
//      才是「选文本」而不是「发给程序」，所以要告诉他按住 option/shift
//
//  而当 copyOnSelect = true 且不是 xterm.js 时，选中即复制，没什么要教的 ——
//  不显示。**提示只在「用户可能做错」的时候出现**，这是克制。
//
//  第 416-418 行的注释还提到删掉了「esc to clear」这条提示，
//  理由很有意思：它看起来太像「esc to interrupt」，用户会误按。'''),

    (437, 'before', '''// 【这段是整份文件里推理链最长的一处，值得慢慢读】
//
//  问题：用户在 macOS + xterm.js 里按住 option 点击想选文本，但没生效。
//  该提示什么？
//
//  xterm.js 的规则（注释第 428-430 行）：
//      macOS：altKey 且开启了 macOptionClickForcesSelection 才选中
//      其他  ：shiftKey
//
//  关键推理在第 431-434 行：
//    「如果我们**收到了**一次 alt+click（lastPressHadAlt 为真），
//     说明 VS Code 那个设置是关的 —— 否则 xterm.js 会自己消费掉这个事件，
//     根本不会传到我们这里。」
//
//  也就是说：**事件能不能到达，本身就是那个设置状态的证据**。
//  于是提示从「option+click to select」改成「去 VS Code 设置里打开
//  macOptionClickForcesSelection」—— 因为沿用原提示的话，用户只会再试一次
//  同样的操作，然后再次失败。
//
//  第 435-436 行解释了为什么可以用 getState() 这种非响应式读法：
//  lastPressHadAlt 在 hasSelection 为真期间是不变的（按下时设置、
//  选区清除时清空），所以读一次和订阅效果相同。
//
//  这是「用已知不变量替代订阅」的典型 —— 前提是你真的能证明它不变。'''),

    (464, 'before', '''// 【全屏模式下，没有内容也要占一行 —— 返回一个空格】
//
//  注释（第 456-463 行）把理由写得很清楚：
//
//    全屏布局里底部区域是 flexShrink:0，这里每多一行，正文区就少一行。
//    如果这里返回 null，footer 高度是 0；之后某个提示出现了（比如选区提示），
//    高度从 0 变成 1 —— **整个正文区会上移一行**，ScrollBox 的滚动位置跟着错乱。
//
//  所以全屏时返回 `<Text> </Text>`（一个空格），让 Yoga 预留这一行的高度，
//  但视觉上什么也看不到。
//
//  非全屏（普通模式）返回 null：因为终端有 scrollback，多一行只是往上滚，
//  不会破坏任何已渲染的内容。
//
//  **同一个「空」，在两种布局模式下有不同的正确答案。** 这是全屏/非全屏
//  两套布局共存时最容易踩的坑。'''),

    (470, 'before', '''// 【最终布局：modePart 和 tasksPart 不许压缩，剩余部分整体截断】
//
//      <Box height={1} overflow="hidden">
//        {modePart}   flexShrink={0}
//        {tasksPart}  flexShrink={0}
//        <Text wrap="truncate">{parts…}</Text>
//
//  三个设计点：
//    1. height={1} —— 硬性一行。不管内容多少，超出就裁（overflow:hidden）。
//    2. flexShrink={0} —— 「auto on」「3 tasks」这类短语不能被压，
//       一旦被压缩就会变成「au…」，比不显示更糟。
//    3. 剩下的都塞进一个 Text 里由 wrap="truncate" 处理 ——
//       **一批元素共享一次截断**，而不是各自截一次。
//
//  第 473 / 477 行那两个 `·` 分隔符是有条件的（后面还有内容才加），
//  避免出现「auto on ·」这种尾随分隔符。
//
//  这三条合起来就是「终端里做单行布局」的全部技巧：固定高度、固定关键项、
//  其余整体让位。'''),

    (484, 'before', '''// 【getSpinnerHintParts：把一个 switch 的结果变成一句提示语】
//
//  第 486-501 行处理「ctrl+t 这一按会做什么」，取决于当前展开状态：
//
//    none      → show tasks
//    tasks     → show teammates
//    teammates → hide
//
//  这是一个**三态循环**（none → tasks → teammates → none），
//  提示语必须说「下一按去哪」，而不是「当前在哪」。
//  这是按键提示的通用规则：**描述动作，不描述状态**。
//
//  没有队友时退化成两态：tasks ↔ none（第 500 行）。
//
//  第 506-512 行用展开语法拼三个可选提示，顺序是：
//    esc 中断（仅加载中）→ 停止 agent（仅空闲且有 agent 在跑）→ ctrl+t 切换
//
//  注意第二个和第一互斥（一个要 isLoading，一个要 !isLoading），
//  所以实际上「加载中」和「空闲但 agent 在跑」不会同时出现。
//  第 508 行还额外排除了「正在确认停止 agent」的状态 —— 否则同一个动作
//  会同时显示「按 ctrl+x ctrl+k 停止」和「确认对话框」，前后矛盾。'''),

    (514, 'before', '''// 【isPrStatusEnabled：读配置、给默认值 true】
//
//  一行函数，但它是「默认开启」的决策点：`?? true`。
//  意思是没配过这个字段的用户（绝大多数）会看到 PR 状态。
//
//  对比同目录 usePromptInputPlaceholder 里的 `?? 0`（默认关闭）——
//  同一个 `??` 操作符，默认值的选择反映了产品判断：
//
//    prStatusFooterEnabled  ?? true   新增功能，默认让人看见
//    queuedCommandUpHintCount ?? 0    计数类，从零开始
//
//  读配置类代码时，「默认值是多少」往往比「读了什么」更重要 ——
//  它决定了绝大多数用户的实际体验。'''),
]
