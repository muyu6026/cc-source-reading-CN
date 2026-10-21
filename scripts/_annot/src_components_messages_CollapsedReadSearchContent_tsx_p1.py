# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  CollapsedReadSearchContent：折叠成一行的那十几个工具调用
// ═══════════════════════════════════════════════════════════════
//
//  模型连续读了八个文件、搜了三处代码，屏幕上不该出现十一行 ——
//  它被折成一行：
//
//      ⏺ Read 8 files, searched 3 patterns, ran 2 bash commands…   ctrl+o
//        ⎿  src/utils/format.ts
//
//  这个文件就是把那一行拼出来的地方，也是本批最长的一个（483 行）。
//
//  三个值得单独理解的设计：
//    1. 「计数只增不减」（第 168 行）—— 防抖造成的抖动
//    2. 「提示至少显示 700ms」（第 26 行）—— 让一闪而过的动作可读
//    3. 「首词大写、后续小写」（第 299 行）—— 拼句子的动词变形
//
//  另外它有一个 verbose 分支：展开后每个工具调用一行（VerboseToolUse），
//  那是完全另一套渲染，直接从第 221 行 return 走了。'''),

    (23, 'before', '''// 【feature 门控的模块用 require 引入，并且写成三元而不是 if】
//
//      const teamMemCollapsed = feature('TEAMMEM')
//        ? require('./teamMemCollapsed.js') as typeof import(…)
//        : null
//
//  和 UserTextMessage 里那三个懒加载是同一个手法，只是位置不同：
//  这里放在**模块顶层**，因为它在组件体里被用作
//  `teamMemCollapsed!.checkHasTeamMemOps(message)`。
//
//  `feature()` 是编译期常量，所以这个三元在打包时直接折成一边，
//  另一边（含 require）消失。写成三元是为了让 TypeScript 能推断类型
//  （`X | null`），写成 if + let 会得到 implicit any。
//
//  `!` 是告诉 TS「走到这一行时它一定不为 null」——
//  因为调用点外面还有一层 feature 判断。'''),

    (29, 'before', '''// 【MIN_HINT_DISPLAY_MS = 700，注释把理由写得很具体】
//
//  折叠行下面那行「⎿ 正在读 xxx」是一个**流式提示**：
//  工具一换，提示就换。而读一个小文件只要十几毫秒，
//  于是提示会在屏幕上闪一下就没 —— 用户根本读不到。
//
//  700ms 是「人眼能确认一个词」的下限。做法是把提示交给
//  useMinDisplayTime（第 218 行），它保证每个值至少显示 700ms。
//
//  代价是提示会**滞后**：真实的工具早就换到下一个了，屏幕还在显示上一个。
//  这在「进度提示」这个场景里是可接受的 —— 用户要的是「它在动」，
//  而不是「精确知道此刻在第几步」。
//
//  同一批里 VoiceIndicator 那处**故意不**用这个（会和空格自动重复抢定时器），
//  说明这个手段不能无脑套。'''),

    (58, 'before', '''// 【`findToolByName(tools, …) ?? findToolByName(getReplPrimitiveTools(), …)`】
//
//  两次查找，第二次是 fallback：折叠组里的工具可能来自 REPL 的「原始工具集」，
//  那批工具不在主 tools 数组里。
//
//  为什么会有两套工具表？因为 REPL 工具是一个「容器」——
//  它内部可以调别的工具，那些内部调用用的是 primitiveTools。
//  渲染时用户看到的是内层工具的名字，但它们只在 primitive 表里。
//
//  这是「工具的可见性」问题：**能被调用的工具集合 ≠ 能出现在界面上的名字集合。**
//  两套表各有各的用途，渲染层必须都能查。'''),

    (95, 'before', '''// 【输出也走 outputSchema 校验，并且失败就当没有 —— 和 UserToolSuccessMessage 一致】
//
//      const parsedOutput = tool.outputSchema?.safeParse(rawToolResult)
//      const toolResult = parsedOutput?.success ? parsedOutput.data : undefined
//
//  注意后面第 116 行还有 `toolResult !== undefined` 的条件，
//  所以校验失败时**只是不显示结果**，工具名和参数照常显示。
//
//  这和 UserToolSuccessMessage 的选择不同：那边校验失败直接 return null
//  （整条消息不显示），因为那里除了结果没别的内容可显示。
//
//  **同一个校验结果，在两处的降级幅度不同** —— 取决于「除了它还有什么」。'''),

    (168, 'before', '''// ═══ 【五个 max-ref：计数只增不减，为了抗抖动】 ═══
//
//  注释写得很清楚：`The debounce timer causes extra re-renders at arbitrary times;
//  during a brief "invisible window" in the streaming executor the group count can dip,
//  which causes jitter.`
//
//  翻译：流式执行器里有一个极短的窗口，折叠组的计数会**短暂下跌**
//  （group 被重建了一次）。如果直接显示原始计数，屏幕上会看到
//  「Read 8 files」闪一下变成「Read 7 files」再变回 8。
//
//  解法是五个 ref 各自记历史最大值：
//
//      maxReadCountRef.current = Math.max(maxReadCountRef.current, rawReadCount)
//
//  在**渲染期**直接改 ref，而不是在 effect 里 —— 因为 effect 会晚一帧，
//  晚一帧就意味着屏幕上已经闪过一次 7。
//
//  这是「渲染期写 ref」的一个正当用途（和 PromptInput 的 lastInternalInputRef 同类）：
//  **它不是在同步状态，而是在维护一个单调不变量。**
//
//  代价：如果某个组真的从 8 掉到 7（不是抖动而是真的重算），
//  显示会永远停在 8。作者接受这个风险，因为折叠组是「已经发生的事的计数」，
//  掉下去没有业务含义。'''),

    (189, 'before', '''// 【bashCount 要减掉 gitOpBashCount —— 同一个命令不能数两遍】
//
//  注释：`Subtract commands surfaced as "Committed …" / "Created PR …"
//  so the same command isn't counted twice.`
//
//  场景：`git commit -m "..."` 是一条 bash 命令，但它同时会产出一条
//  「committed abc1234」的 git 事件。折叠行里已经有「committed abc1234」了，
//  如果 bash 计数里再算一次，就会显示「ran 3 bash commands」但实际上只跑了 2 条。
//
//  所以 `bashCount = max(0, max - gitOpBashCount)`，用 max(0, …) 兜住
//  「gitOpBashCount 比 bashCount 大」的情况（理论上不该发生，但计数的时序不保证）。
//
//  这一类「同一个事实两个来源」的去重，比计数本身更容易出错。
//  读到计数逻辑时，先问一句：**这些数字之间有没有重叠？**'''),

    (204, 'before', '''// 【REPL 的实时提示：从 progress 消息里挖当前内层工具】
//
//  为什么需要这一段？注释说得很准：
//  `Virtual messages don't arrive until REPL completes, so this is the only
//  source of a live hint during execution.`
//
//  也就是：REPL 这个工具在跑的时候，内层调用的消息（virtual messages）
//  要等它整个结束才生成。所以在那之前，屏幕上唯一能显示「现在在干什么」的
//  线索就是 progress 消息里的 repl_tool_call。
//
//  `phase === 'start'` 只看开始事件 —— 因为 end 事件里没有 toolInput，
//  看到了也没法显示参数。
//
//  取值顺序 `file_path ?? pattern ?? command ?? toolName` 是**从具体到抽象**：
//  能说「读哪个文件」就不说「跑了个命令」。'''),

    (218, 'before', '''// 【useMinDisplayTime 的输入是「当前提示」，输出是「当前该显示的提示」】
//
//  它内部是一个定时器 + 状态：新值来了先记下，等上一个值满 700ms 再切换。
//  所以 displayedHint 可能**落后于** incomingHint。
//
//  注意它在 verbose 分支之前（第 221 行 return），所以 verbose 模式下
//  这次调用是白花的 —— 但它必须在所有 return 之前，否则 hook 顺序会变。
//
//  这一类「在早退之前调用、早退之后不用」的 hook，在产物里经常看到，
//  是 hooks 规则和代码组织的必然代价。'''),

    (221, 'before', '''// 【verbose 分支：把折叠组重新展开成逐个工具】
//
//  它做了三件事：
//    1. 从 groupMessages 里挑出 assistant 消息和 grouped_tool_use 消息
//    2. 每条的第一个 content 交给 VerboseToolUse
//    3. 额外补 hook 摘要和「recalled 的记忆」
//
//  第 227 行的 `toolUses.push(...msg.messages)` 用的是展开运算符 ——
//  因为 grouped_tool_use 里面还套着一层消息数组，要拍平。
//
//  这一步的存在说明：**折叠不是不可逆的**。
//  数据层保留了全部原始消息，折叠只是渲染层的选择。
//  这是「信息不丢，只改变呈现」的正确做法 ——
//  任何「折叠时把数据扔掉」的实现，都会让 Ctrl+O 展开变成不可能。'''),

    (265, 'before', '''// 【一个防御性判断：所有计数都是 0 就整块不画】
//
//  注释：`This shouldn't happen in normal operation, but handles edge cases`。
//
//  这类判断在本批出现多次（teamMemCollapsed 第 30 行、UserTeammateMessage 第 76 行）。
//  共同点：**宁可什么都不画，也不要画一个空壳**。
//
//  空壳的代价在终端里比在网页里大得多 ——
//  网页里一个空 div 是不可见的，终端里一个空 Box 会吃掉一行（或一段 margin）。'''),

    (274, 'before', '''// 【shell 进度：2 秒后才显示，因为快的命令不需要报时】
//
//  注释解释了动机：`BashTool yields progress every second but the collapsed
//  renderer never showed it — long commands (npm install, tests) looked frozen.`
//
//  这是一个真实的用户体验缺陷：跑 `npm install` 一分半钟，
//  折叠行一直显示「ran 1 bash command」，看起来像卡死了。
//
//  解法是把 elapsed 拼到提示后面：`(1m 23s · 412 lines)`。
//  但只在 elapsed >= 2 时加 —— **2 秒以内结束的命令，报时反而是噪音**。
//
//  取「最慢的那个」，是因为用户关心的是「我还要等多久」，
//  而并行的多个命令里最慢的那个决定总时长。'''),

    (299, 'before', '''// 【pushPart：一个把「首词大写」和「逗号」封装起来的小函数】
//
//      function pushPart(key, verb, body) {
//        if (!isFirst) nonMemParts.push(<Text key={comma-key}>, </Text>)
//        nonMemParts.push(<Text key={key}>{isFirst ? verb[0].toUpperCase() + verb.slice(1) : verb} {body}</Text>)
//      }
//
//  两个细节：
//
//  一、逗号是**独立的 Text 节点**，不是拼在字符串里的。
//     因为整行要能被 Ink 折行，而折行发生在 Text 之间；
//     如果逗号和内容在同一个 Text 里，Ink 可能把「, 」留在行尾而不是行首。
//     （这是终端排版的常见问题：行尾孤立的标点看起来像错误。）
//
//  二、`verb[0]!.toUpperCase() + verb.slice(1)` —— 用 `!` 告诉 TS 首字符存在。
//     空字符串会得到 `undefined + ''`，但调用点保证 verb 非空。
//
//  注意这个函数**只给 git 那四个分支用**（commits / pushes / branches / prs），
//  后面 search / read / list 等分支各自手写了同样的逻辑（第 345-413 行）。
//  为什么不用它？因为那些分支的措辞结构不同（「searched for 3 patterns」），
//  不是「动词 + 加粗数字」这个模板。'''),

    (306, 'before', '''// 【四个 git 相关的分支都套在 isFullscreenEnvEnabled() 里】
//
//  `commits / pushes / branches / prs` 这四类信息只在全屏模式下显示。
//
//  原因很实际：非全屏模式用的是 <Static>（打印一次进滚动缓冲区），
//  而 git 状态是**在流式过程中逐步到达的**。打印一次意味着
//  「committed」那几个字会永远定格在第一次的值上，后面的不会补进来。
//
//  所以宁可不在非全屏里显示，也不要显示一个不完整且不再更新的版本。
//
//  这和 Messages.tsx 里 `shouldRenderStatically` 那条不变量是同一件事：
//  **静态渲染的前提是内容不再变。**'''),

    (389, 'before', '''// 【MCP 的 server 名要剥掉 `claude.ai ` 前缀】
//
//      message.mcpServerNames?.map(n => n.replace(/^claude.ai /, '')).join(', ') || 'MCP'
//
//  这是「显示名清洗」的又一例（前面 UserChannelMessage 剥 `plugin:x:y` 的前缀）。
//  共同规律：**存储用的标识符带作用域，展示用的名字要把它剥掉。**
//
//  最后的 `|| 'MCP'` 兜住「没有 server 名」的情况 —— 总得有个词占位，
//  否则会拼出「queried  3 times」这种双空格。
//
//  注意它是 `'MCP'` 而不是空串：**降级要给出一个仍然有意义的词**，
//  哪怕不精确。'''),

    (448, 'before', '''// 【最后的结构：图标 + 一整段文本 + 可选的提示行】
//
//      <Box flexDirection="column" marginTop={1} backgroundColor={bg}>
//        <Box flexDirection="row">
//          {激活态 ? <ToolUseLoader/> : <Box minWidth={2}/>}     ← 2 格占位
//          <Text dimColor={!isActiveGroup}>…</Text>
//        </Box>
//        {激活态 && 提示行}
//        {hook 耗时}
//      </Box>
//
//  两个细节：
//
//  一、非激活时用 `<Box minWidth={2}/>` 占位，而不是不画。
//     这样所有折叠行的文字左边线对齐 —— 有转圈的那行和没转圈的那行
//     文字起始位置相同。**占位元素是终端里实现对齐的唯一手段。**
//
//  二、`dimColor={!isActiveGroup}` —— 已完成的历史折叠行变灰，
//     正在跑的那组保持正常亮度。**亮度在这个 UI 里表示「活跃度」。**
//
//  第 466 行的提示行用 `width={5} flexShrink={0}` 做 gutter，
//  注释解释了原因：让折行发生在右列，续行自动缩进到 ⎿ 下面。'''),
]
