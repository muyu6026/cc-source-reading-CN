# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  SystemTextMessage：系统消息（826 行，本批最长）
// ═══════════════════════════════════════════════════════════════
//
//  它按 subtype 分发十几种系统消息：
//
//      turn_duration        「Worked for 2m 13s」
//      memory_saved         「Saved 3 memories」
//      away_summary         离开期间发生了什么
//      agents_killed        「All background agents stopped」
//      bridge_status        /remote-control 的地址
//      scheduled_task_fire  定时任务触发了
//      permission_retry     「Allowed 3 commands」
//      api_error            重试倒计时（转交 SystemAPIErrorMessage）
//      stop_hook_summary    Stop hook 的汇总
//      其它                  一行 dim/error/warning 文本
//
//  一个值得注意的写法：这里用的是 **if 链而不是 switch**，
//  且中间夹了一条「信息级消息默认不显示」的判断（第 201 行）——
//  它的位置决定了哪些 subtype 能被静音。这个顺序依赖是本文件最微妙的地方。
//
//  另一个发现：文件末尾的 ThinkingMessage 是**死代码**（见第 733 行）。'''),

    (45, 'before', '''// 【前六个 subtype 都是「转交」：各自一个子组件】
//
//  顺序不是随机的，是**按显示频率排的**：
//  turn_duration 每条回复都有，memory_saved 次之，
//  away_summary / agents_killed / bridge_status / scheduled_task_fire 都很少见。
//
//  最常用的分支排在前面，理论上能少做几次字符串比较 ——
//  但真正的理由更可能是「写的时候按重要性追加」。
//
//  注意 `message.subtype === "thinking"` 直接 return null（第 122 行），
//  而文件末尾还定义了一个 ThinkingMessage 组件 —— 见第 733 行的批注。'''),

    (69, 'before', '''// 【away_summary 没有子组件，因为它的布局和「一行系统消息」一样】
//
//  `<Box minWidth={2}><Text dimColor>{REFERENCE_MARK}</Text></Box>` + 正文。
//
//  那个 minWidth={2} 的 Box 是**图标占位槽**：这个 UI 里所有消息行
//  左边都有两格给图标（⏺ / ✻ / ⎿ / ▎）。
//  即使这条消息没有图标，也要占住这两格，否则文字左边线会和其他行错位。
//
//  这是终端 UI 和网页最大的差别之一：
//  **没有「默认对齐」，所有对齐都是显式占位换来的。**'''),

    (122, 'before', '''// 【subtype === "thinking" 直接返回 null —— 但文件末尾有个 ThinkingMessage】
//
//  查一下调用关系：ThinkingMessage 在 826 行里**只被定义，没有被调用**。
//  第 122 行这条早退把 thinking 类型的系统消息全部吃掉了。
//
//  可能的解释（按可能性排序）：
//    1. 曾经是 return <ThinkingMessage …/>，后来改成不显示，组件忘删
//    2. 内部构建里有别的调用点（但这一份是外部构建的产物，看不出来）
//
//  证据偏向 1：ThinkingMessage 的实现（第 733-767 行）和 away_summary
//  那个分支几乎一模一样（同一个图标槽、同一个 dim 文本、同一个 marginTop）。
//  也就是说它已经被**内联展开**到调用点，组件本身成了残留。
//
//  这是本批第一处确认的死代码。判据是：**定义存在 + 全文件零调用 + 功能有替代。**'''),

    (200, 'before', '''// ⚠️ 【这一行是本文件最微妙的位置：`!isStopHookSummary && !verbose && level === "info"`】
//
//  它把「信息级系统消息默认不显示」这条规则插在了 if 链的**中间**：
//
//      第 45-199 行    turn_duration / memory_saved / away_summary / agents_killed
//                      / thinking / bridge_status / scheduled_task_fire / permission_retry
//      第 200-203 行   ← 静音规则（新增）
//      第 204-229 行   api_error / stop_hook_summary
//
//  这意味着：
//    · 前八个 subtype **不受静音规则影响**（即使 level 是 info 也显示）
//    · api_error / stop_hook_summary 会被静音（除非 verbose）
//
//  为什么要把规则放在这里而不是最前面？因为前八个 subtype 的显示与否
//  由**各自的语义**决定（比如 turn_duration 由配置里的 showTurnDuration 控制），
//  不该被一个通用的 level 规则二次裁决。
//
//  只有「走到后面那些通用文本渲染」的消息，才适合用 level 统一控制。
//
//  这是一个「规则插入点」的经典案例：
//  **一条全局规则该放在哪，取决于哪些分支不该被它管。**'''),

    (230, 'before', '''// 【content 不是字符串就直接不画】
//
//  系统消息的 content 类型是 string | ContentBlock[]。
//  数组形态（多模态）在这个渲染器里没有处理，所以只能放弃。
//
//  注意这是一个**静默**的放弃：没有 logError。
//  因为数组形态的系统消息本来就少见，而且「不显示一条系统提示」
//  不影响用户继续操作。
//
//  对照 UserPromptMessage 第 72 行：那里空文本要 logError，
//  因为「用户的话变空了」是不该发生的。**两者的区别是「预期内 / 预期外」。**'''),

    (234, 'before', '''// 【三种 level 映射到三种视觉：正常 / 黄 / 灰】
//
//      level === 'info'       dimColor（灰）
//      level === 'warning'    color="warning"（黄）
//      其它（error 等）        正常色 + 图标
//
//  注意 `dot = message.level !== 'info'`：**信息级消息不带图标**。
//
//  这条规则让「有图标」本身就变成一种强调：
//  屏幕上一行没有 ⏺ 的灰文字，你自然知道它不重要。
//
//  level 到颜色的映射写在三个内联三元里，而不是做成 map ——
//  因为它同时控制 dot / color / dimColor 三个 prop，做成 map 反而更绕。'''),

    (280, 'before', '''// 【StopHookSummaryMessage 的第一条判断里藏着一处恒真】
//
//      if (hookErrors.length === 0 && !preventedContinuation && !message.hookLabel) {
//        if (true || totalDurationMs < HOOK_TIMING_DISPLAY_THRESHOLD_MS) {
//          return null
//        }
//      }
//
//  `true || …` 恒真，所以内层条件等于「无条件 return null」。
//  外层条件的意思是：**没错误、没阻止继续、也没自定义 label —— 这条消息没有信息量，不显示。**
//
//  那个 HOOK_TIMING_DISPLAY_THRESHOLD_MS 是「耗时超过阈值就显示」的开关，
//  在外部构建里被关掉了（恒 return null）。
//
//  读法：`if (true || X)` 说明「X 这个条件在当前构建里不启用」，
//  而不是「X 永远为真」。两者的区别在于**将来会不会改回来**。'''),

    (287, 'before', '''// 【`false && totalDurationMs > 0` 又一处残留：耗时字符串永远是空串】
//
//      const totalStr = false && totalDurationMs > 0
//        ? ` (${formatSecondsShort(totalDurationMs)})` : ""
//
//  于是下面所有拼 `{totalStr}` 的地方都不会显示耗时。
//
//  同一个文件里三处同款：
//      第 287 行  totalStr
//      第 419 行  _temp3 里的 durationStr
//      第 423 行  _temp2 里的 durationStr
//
//  三处都是「hook 耗时」。也就是说，**外部构建把 hook 耗时展示整体关掉了。**
//
//  这类「一整块功能被一个常量关掉」的代码，最有价值的读法是：
//  它告诉你**内部版本里有什么**。代码本身成了功能清单。'''),

    (335, 'before', '''// 【`columns - 10`：给图标和省略号预留的固定宽度】
//
//  为什么是 10？因为这一行左边有图标槽（2 格）+ 缩进（2 格），
//  右边还要留 6 格给可能的折行余量。
//
//  这是一个**魔数**，没有常量名，也没有注释解释。
//  同款在第 453 行（SystemTextMessageInner）又出现一次，同样的 `columns - 10`。
//
//  两处都用 10，说明它是「这个布局的固定留白」而不是随手写的。
//  但它没有名字，所以改动时很容易只改一处 —— 这是一处**命名缺失导致的隐患**。
//
//  本批里类似的魔数还有 `width={999}`（BridgeStatusMessage，等价于「无限宽」）——
//  那个更明显是 hack，但在 Ink 里，999 确实比 undefined 更可靠
//  （undefined 会让 Box 按内容宽度收缩）。'''),

    (429, 'before', '''// 【SystemTextMessageInner：一个「只有文本」的极简版本】
//
//  它和父组件的关系：父组件处理完所有 subtype 之后，剩下的
//  「有 content 但没 subtype」的消息走这里。
//
//  为什么单独抽组件？因为它要读 useTerminalSize() 和 useSelectedMessageBg()
//  两个 hook，而父组件的早退路径太多 —— 在这些 hook 之前 return 会让
//  hook 顺序不稳定（父组件里所有 hook 必须无条件执行）。
//
//  抽成子组件之后，父组件只在「确实要画」时才挂载它，
//  hook 就可以安全地写在子组件体内。
//
//  **这是「用组件边界来解决 hook 顺序问题」的标准手法** ——
//  本批里 AttachmentMessage 的 InvalidApiKeyMessage 也是同一个理由。'''),

    (494, 'before', '''// 【TurnDurationMessage：两个 useState 的初值都是「算一次就定死」的】
//
//      const [verb] = useState(_temp4)                       随机抽一个完成动词
//      const [backgroundTaskSummary] = useState(t1)          启动时的后台任务摘要
//
//  为什么用 useState 而不是 useMemo？
//  功能上等价（都是只算一次），但 useState 的惰性初值**语义更明确**：
//  这个值是「这条消息创建时的快照」，不是「props 的派生值」。
//
//  尤其 backgroundTaskSummary：它读的是 store.getState() 里**此刻**在跑的
//  后台任务。这条消息说的是「这一轮跑了多久」，那后台任务的状况就该是
//  这一轮结束那一刻的快照 —— 不应该随着后面的任务启动而变。
//
//  **「用哪个 hook」在这里表达的是「这个值属于哪个时间点」。**
//
//  顺带：verb 来自 TURN_COMPLETION_VERBS（一个动词表），
//  和 UserMemoryInputMessage 的 getSavingMessage 是同一个手法 ——
//  用一个随机词让高频重复的提示不那么机械。'''),

    (533, 'before', '''// 【budgetSuffix 在一个 bb0 块里算，因为有两个早退路径】
//
//  原始代码：
//      let suffix = ''
//      if (hasBudget) { …拼 usage 和 nudges… }
//
//  Compiler 把它改写成 `let t4; bb0: { if (!hasBudget) { t4 = ''; break bb0 } … }`。
//
//  注意它内部还有一个嵌套的缓存槽（$[5]-$[7]）缓存 usage 字符串 ——
//  也就是说**一个 bb0 块里可以再套槽**。
//
//  这是本批最后一个 bb0 形态：不是 early return，而是「给变量赋不同值」。
//  和前面那些 sentinel + early return 的用法不同 ——
//  **bb0 只是一个带标签的块，它不必然和早退相关。**'''),

    (594, 'before', '''// 【MemorySavedMessage：私有记忆和团队记忆要拆开数】
//
//      const team = feature("TEAMMEM") ? teamMemSaved.teamMemSavedPart(message) : null
//      const privateCount = writtenPaths.length - (team?.count ?? 0)
//
//  这就是 teamMemSaved.ts 为什么返回 { segment, count } 而不是字符串 ——
//  注释里那句「so the caller can derive the private count without accessing
//  teamCount itself」在这里兑现了。
//
//  最终显示是 `Saved 3 memories · 2 team memories`，两个片段用中点连起来。
//
//  注意第 606 行 `feature("TEAMMEM") ? teamMemSaved.…` 里用的是 `teamMemSaved.`
//  而不是 `teamMemSaved!.` —— 因为 TS 在 feature 折叠后的类型里知道它可能为 null，
//  但这里靠 feature 判断做了收窄（同一文件顶部那个三元给出了 `X | null`）。'''),

    (669, 'before', '''// 【MemoryFileRow：一条记忆文件，可以点、可以悬停】
//
//  三个交互：
//      onClick        openPath(path)     用系统默认程序打开这个文件
//      onMouseEnter   setHover(true)     下划线 + 变亮
//      onMouseLeave   setHover(false)
//
//  这是本批唯一用鼠标事件的组件之一（另一个是 PromptInput 的按钮）。
//  终端里的鼠标支持靠 SGR 鼠标上报，ink/ 目录里读过那一整套解析。
//
//  注意 `dimColor={!hover} underline={hover}` —— 悬停时**同时**去灰加下划线。
//  这个组合在终端里比单纯变色更明显，因为多数主题下灰色和正常色的差别很小。
//
//  onClick 的写法是 `() => void openPath(path)`：
//  `void` 把返回值（可能是个 Promise）显式丢弃，
//  防止 lint 报「这个 promise 没被 await」。'''),

    (733, 'before', '''// ⚠️ 【ThinkingMessage：全文件零调用的死代码】
//
//  它和 away_summary 那个分支（第 69-97 行）结构几乎完全一致：
//  同样的 `<Box minWidth={2}><Text dimColor>{TEARDROP_ASTERISK}</Text></Box>`，
//  同样的 dim 文本，同样的 marginTop + backgroundColor + width="100%"。
//
//  唯一区别：away_summary 的正文来自 message.content，
//  这里的正文也来自 message.content。
//
//  也就是说这个组件**完全被第 69 行那个分支覆盖了**，
//  而 subtype === "thinking" 在第 122 行直接 return null。
//
//  保留它的唯一价值是：它记录了「thinking 类型的系统消息长什么样」。
//  如果哪天要恢复显示，改第 122 行 return <ThinkingMessage …/> 即可。
//
//  这类代码不要删（也不要当成 bug 报）—— 它是一份**注释化的设计意图**。'''),

    (768, 'before', '''// 【BridgeStatusMessage：/remote-control 的地址 + 一句解释】
//
//  它显示三行：
//      `/remote-control` is active. Code in CLI or at
//      https://…（可点）
//      ⎿ （可选的升级提示）
//
//  `width={999}` 是这个文件里唯一的「假无限宽」：
//  这里不需要按终端宽度收缩，因为内容本身就是一条 URL，
//  折行反而更难读。
//
//  999 而不是 undefined，是因为 Ink 里 undefined 的 width 会让 Box
//  按**内容**收缩，而 999 会让它撑满 —— 撑满才能让背景色整行铺开。
//
//  这是「用一个不可能达到的数字表达『尽可能大』」的常见 hack。'''),
]
