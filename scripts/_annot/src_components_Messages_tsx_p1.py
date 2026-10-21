# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  Messages：一条消息列表的七道工序
// ═══════════════════════════════════════════════════════════════
//
//  这是整个 UI 层最重的一个组件（833 行），但它做的事可以用一句话概括：
//  **把服务端回来的原始消息数组，变成屏幕上的一行行**。
//
//  中间夹着七道工序，每一道都在解决一个具体的性能或正确性问题：
//
//  1. 规范化（normalizeMessages）—— 原始消息 → 可渲染消息
//  2. 切边界（compact boundary）—— 压缩点之前的历史要不要显示
//  3. 重排（reorderMessagesInUI）—— 流式 tool_use 的位置
//  4. 过滤（null-rendering attachment / brief 模式）
//  5. 分组（applyGrouping）—— 同一个 assistant turn 的多个 tool_use
//  6. 折叠（四个 collapse 串起来）—— read/search 合并成一行
//  7. 切片（cap / renderRange / 虚拟列表）
//
//  **这七道工序的顺序不能换**，理由在每一道的锚点里。最反直觉的是第 5、6
//  两道：分组在前、折叠在后，因为折叠要按「分组后的结构」判断能不能合。
//
//  另外，这份文件里有一半的代码量是**注释**，而且注释里带着实测数字
//  （150K+ writes/frame、59 GB RSS、14k mmap/sec、100-173ms 停顿）。
//  这不是炫技 —— 这些数字是「为什么不能写得更简单」的唯一证据。
//  没有数字的性能注释，读代码的人只能在「相信」和「重写」之间二选一。'''),

    (47, 'before', '''// 【这条注释值得逐字读完，它解释了整个渲染管线的一个硬约束】
//
//  核心链路是：LogoHeader 脏 → renderChildren 的 seenDirtyChild 冒泡 →
//  后面所有兄弟节点的 prevScreen（blit 基准）被作废 → 每一行都重写。
//
//  这一步不是「变慢一点」，是**从 O(变化量) 退化成 O(全屏)**。终端里
//  「重写一行」= 一组光标定位 + SGR + 字符，2800 条消息 150K+ 次写入。
//
//  所以 Memo 的依赖选了 agentDefinitions 而不是 messages：消息数组每来
//  一段流就换一个新引用，拿它当依赖等于没 Memo。'''),

    (80, 'before', '''// 【DCE 的三种力度，这里一次用全了】
//
//  · feature('PROACTIVE') 单独为真 → 整个模块 require
//  · feature('KAIROS') || feature('KAIROS_BRIEF') → 只取一个常量
//  · feature('KAIROS') → 再取另一个常量
//
//  require 在条件分支里，是因为 `bun:bundle` 的 feature() 是**编译期常量**：
//  打包时这些分支会被折叠成 `null`，require 的模块连代码都不会进产物。
//  写成顶层 import 就做不到 —— import 是无条件的。
//
//  代价：类型得手写 `as typeof import(...)`，因为 import() 的类型在运行
//  时不参与。这是 DCE 的固定税，全仓库都这么写。'''),

    (93, 'before', '''// 【brief 模式的哲学：过滤掉一切，只留 Brief 的输出】
//
//  注意 JSDoc 最后那句 "That's on the model to get right; the filter does
//  not second-guess it." —— 这是**明确的错误归属声明**：模型忘了调 Brief，
//  用户就看不到东西，这是模型的问题，不是过滤器的。
//
//  这种「不做兜底」的选择很少见，但它避免了更糟的结果：兜底会让「模型
//  忘了调 Brief」变成一个不可见的故障（用户以为模式生效了，其实看到的
//  是完整输出）。宁可空屏也不要错屏。'''),

    (122, 'before', '''// 【system 一律保留，只有一个例外：api_metrics】
//
//  api_metrics 是 TTFT / 配置写入 / hook 耗时——**每轮都有**。brief 模式的
//  前提是「屏幕上一屏能看完」，留着它等于每轮多几行噪声，模式就失去意义。
//
//  而其他 system（attach 确认、远端错误、compact 边界）必须留：它们是
//  **状态变化的唯一反馈**，删掉用户就不知道发生了什么。
//
//  判据可以抽象成：这条消息消失后，用户会不会失去对系统状态的认知。
//  api_metrics 不会（它是给开发者看的），其余会。'''),

    (141, 'before', '''// 【tool_result 的命运由它对应的 tool_use 决定】
//
//  不能靠「result 长什么样」判断 —— 所有 tool_result 长得一样。只能回头
//  查 briefToolUseIDs，而这个集合是在**遍历到 tool_use 时顺手填的**。
//
//  前提是数组顺序：tool_use 一定在它的 tool_result 之前。这不是约定，
//  是 Anthropic API 的结构要求（assistant 消息里发 tool_use，下一条 user
//  消息里才有 tool_result）。所以单趟扫描成立。'''),

    (154, 'before', '''// 【为什么这里要四个条件，而不是「不是 isMeta 就行」】
//
//  注释点出了关键：task-notification 的调用方**只设了 mode，没设
//  origin / isMeta**。也就是说「通知类附件」在数据上看起来和「用户打字」
//  几乎一样，唯一的区别是 commandMode。
//
//  所以判据必须用**正向识别**（commandMode === 'prompt'）而不是反向排除。
//  反向排除的问题在于：你不知道还有谁会漏掉那几个标记，将来加了新的
//  附件类型，它会静默地被当成用户输入显示出来。
//
//  **在「排除法会漏」的地方，改用「只有这一种才算」** —— 这条规律在本仓
//  出现过很多次（见 mcp 的 allowlist 段）。'''),

    (169, 'before', '''// 【为什么不直接全局丢 assistant text】
//
//  因为 brief 不一定每轮都调。「按 turn 判断」比「按配置判断」稳：
//  模型这一轮调了 Brief，这一轮的文字是重复的（丢）；这一轮忘了调，
//  文字是唯一的输出（留）。
//
//  turn 的边界定在「非 tool_result 的 user 消息」—— 也就是用户每说一句话
//  算一个 turn。注意 `turn++` 之后 `continue`，所以 user 消息本身不参与
//  后续的类型标注。'''),

    (200, 'before', '''// 【提前 return 原数组引用，不只是省一次 filter】
//
//  如果这里返回 `messages.filter(...)` 的空结果，虽然内容相同，但**引用
//  变了** → 下游所有 useMemo 全部失效 → 整条管线重跑 → 所有 MessageRow
//  的 message prop 换引用 → memo 比较器第一行就 return false。
//
//  一个「没有变化」的过滤，通过引用变化把整个渲染树打脏。这种 bug 极难
//  定位，因为每一层单独看都「只是多做了一次 filter」。'''),

    (276, 'before', '''// 【两个上限，管的是两件不同的事】
//
//  · 30（MAX_MESSAGES_TO_SHOW_IN_TRANSCRIPT_MODE）：**交互上限**。
//    ctrl+o 的 transcript 屏幕只看最近 30 条，其余靠 ctrl+e 展开。
//    这是产品决策，不是性能决策。
//
//  · 200（MAX_MESSAGES_WITHOUT_VIRTUALIZATION）：**安全上限**。
//    只在没有虚拟列表时生效，防止 fiber 树把内存吃穿。
//
//  两个数差 6 倍，但它们在代码里出现在相邻的两行 —— 读的时候要分清，
//  否则会以为「transcript 模式最多 200 条」或者「200 是产品设定」。'''),

    (278, 'before', '''// 【这段注释是「一次错误的完整考古」】
//
//  它记录了三种切片方案，每一种都试过、都坏了：
//
//  1. `slice(-200)` —— 每次追加都从头部掉一条。掉一条 = 屏幕上的内容整体
//     上移一行 = log-update 认为「基准全错」= 每轮一次全量重置（CC-941）
//  2. 量化到 50 条一档（CC-1154）—— 缓解了，但压缩和折叠重组也会改变
//     collapsed.length，而**没有新消息进来**，于是仍然在挪
//  3. UUID 锚点（CC-1174）—— 只在「真的超过 CAP+STEP」时才前进
//
//  第 3 条为什么能修好：它把判据从「数组长度」换成了「那一条具体消息还在
//  不在窗口里」。长度会因为分组/压缩而变化，那条消息的位置不会。
//
//  **凡是「由长度推导位置」的逻辑，在长度会被别的因素改变时都会坏。**
//  这是同一类 bug 的第三次出现（前两次在 log-update 的 scrollback 计数）。'''),

    (309, 'before', '''// 【为什么锚点要存两样东西：uuid 和 index】
//
//  uuid 也不稳定 —— 这句话是这段注释里最反直觉的。原因：
//
//  collapseHookSummaries 合并一组 hook 摘要时，用**第一条**的 uuid 当合并
//  后的 uuid。而 reorderMessagesInUI 会随着 tool result 陆续到达重新排列
//  hook 的相邻关系，于是「哪一条排第一」会变，合并 uuid 跟着变。
//
//  于是 uuid 会「凭空消失」。此时若回退到 0，渲染窗口会从 ~200 条跳到全部
//  历史 —— 而屏幕上那些已经画出去的行还带着「进行中」的徽标，它们再也
//  不会被更新（孤儿）。
//
//  所以 uuid 丢了就退回 index（clamp 过）。这套组合的意思是：
//  **优先用稳定标识，标识消失时用最后已知位置兜底，且兜底不会倒退到 0。**'''),

    (315, 'before', '''// 【cap / step 是两个参数，但生产路径从来不传】
//
//  注释写 "Exported for testing" —— 而这份源码里没有测试文件（打包产物
//  反推时被剥掉了）。所以读到这里会看到两个「有名无实」的参数。
//
//  它们的作用是让测试能构造「窗口刚超过 CAP+STEP」这个临界状态，不用真的
//  造 250 条消息。这种「把常量提成参数只为可测」的写法值得学，但也要
//  认清：**参数化本身不产生测试**，没有测试文件时它只是多两个入参。'''),

    (324, 'before', '''// 【这一行是三个分支挤在一起，值得拆开读】
//
//  · anchorIdx >= 0            → 锚点消息还在，直接用它的位置
//  · anchor（但 idx 找不到）    → 用存的 index，并 clamp 到「至少留下 cap 条」
//  · 没有 anchor                → 0（第一次渲染）
//
//  第二个分支的 clamp 上限 `collapsed.length - cap` 有讲究：如果存的 index
//  比「倒数第 cap 条」还靠前，说明这期间消息被删了很多，按原 index 切会
//  只剩下不到 cap 条。夹到那个位置，正好留下 cap 条。
//
//  注意 clamp 只夹上限不夹下限 —— 下限由外层的 Math.max(0, ...) 保证。'''),

    (325, 'before', '''// 【为什么要留 CAP+STEP 的滞后，而不是一超过 cap 就前进】
//
//  因为「每来一条消息就前进一格」= 每轮都从头部掉一条 = 回到 CC-941 的
//  全量重置。
//
//  留 50 条的缓冲，意味着窗口每 50 条才整体挪一次，代价被摊薄到 1/50。
//  这是**用内存换稳定性**的典型：多留 50 条消息的 fiber，换「大部分轮次
//  的屏幕基准不作废」。'''),

    (331, 'before', '''// 【自愈：锚点从「当前 start 位置上那条消息」重新取】
//
//  这一段的两个分支不对称，但都必要：
//
//  · msgAtStart 存在且与 anchor 不一致 → 重写锚点。这同时修好两种情况：
//    走了 clamp 回退分支之后（uuid 是旧的），以及前进之后（位置变了）。
//  · msgAtStart 不存在（数组空了）而 anchor 还在 → 清空。否则下次渲染会
//    拿一个指向空气的锚点去 findIndex，永远 -1，永远走回退分支。
//
//  **在 render 期间改 ref 是可以的，但必须幂等** —— 注释里点明了
//  StrictMode 双渲染的顾虑。这里的幂等性来自：第二次跑时 anchor 已经等于
//  当前位置，两个分支都不触发。'''),

    (379, 'before', '''// 【normalizeMessages 在这里只跑一次，但它改变了 uuid】
//
//  规范化会给每条消息派生新 uuid（deriveUUID），所以**下游任何拿原始 uuid
//  去比的地方都会失配**。这就是后面 getMessagesAfterCompactBoundary 要传
//  includeSnipped 的原因（见第 496 行的批注）。
//
//  isNotEmptyMessage 放在同一趟：空消息（content 为空数组）会让 yoga 量出
//  高度 0，屏幕上是一条看不见但占位的行。'''),

    (382, 'before', '''// 【这里有一个真 bug：Date.now() 在 useMemo 里，但没进依赖】
//
//  useMemo 的依赖是 [streamingThinking]。只要那个对象引用不变，这个 memo
//  就不重算 —— 于是 30 秒的窗口**不会自己过期**。
//
//  实际后果：流式 thinking 结束（isStreaming 变 false，streamingEndedAt
//  被设上）之后，如果没有任何东西让 streamingThinking 换引用，这块内容会
//  一直显示，直到下一个 turn 开始。
//
//  为什么平时看不出来：Messages 在流式期间几乎每帧都重渲染（streamingText
//  在变），而且下一轮很快就开始，30 秒的窗口几乎没机会被观察到。
//
//  正确写法要么把「当前时间」也做成状态（定时器），要么干脆不用 useMemo。
//  **只要 useMemo 里读了 Date.now()，它就是一个会被缓存的时钟。**'''),

    (395, 'before', '''// 【三个哨兵值，一个 null，语义全靠约定】
//
//  返回值的四种可能：
//
//  · null            → hidePastThinking 关闭，什么都不用藏
//  · 'streaming'     → 正在流式输出 thinking，把**所有**已完成的都藏起来
//  · 'no-thinking'   → 往回扫遇到了上一个用户 turn，藏起所有旧的
//  · "uuid:index"    → 只显示这一个 thinking 块
//
//  'streaming' 和 'no-thinking' 都是**不可能匹配任何真实块**的字符串，
//  于是下游 `thinkingBlockId === lastThinkingBlockId` 永远为假 → 全部
//  hideInTranscript。用一个「绝不匹配的 ID」表达「全藏」，比加一个布尔
//  标志少一个参数，但代价是语义靠字符串魔法值承载。
//
//  返回 null 和返回 'no-thinking' 的区别必须看清：null 让
//  `!lastThinkingBlockId` 成立 → isLastThinking 恒真 → **全部显示**。'''),

    (410, 'before', '''// 【扫到「没有 tool_result 的 user 消息」就停，是因为它标志 turn 边界】
//
//  为什么要判断 hasToolResult：tool_result 也是 user 消息（API 结构如此），
//  如果不排除，扫到第一条 tool_result 就停了 —— 而它通常就在当前 turn 的
//  中间，等于把「本轮的 thinking」也藏掉。
//
//  过滤条件必须能区分「用户说的话」和「工具返回的内容」，两者在类型上
//  都是 user。判据只能看 content 里有没有 tool_result 块。'''),

    (423, 'before', '''// 【只认最后一条 bash 输出，其余折叠】
//
//  判据是内容前缀：`<bash-stdout` / `<bash-stderr`。这是 ! 命令的输出被
//  包装成 user 文本消息时留下的标记，属于**协议层面的约定**，不是类型。
//
//  为什么只展开最后一条：bash 输出可能几百行，全都展开等于把历史刷没。
//  只留最近的一次，符合「刚跑完的命令我想看全」的使用习惯。'''),

    (445, 'before', '''// 【为什么要预计算 Set，注释说反了一半】
//
//  注释写 "streamingToolUses updates on every input_json_delta while
//  normalizedMessages stays stable" —— 意思是：贵的那一侧稳定，便宜的那
//  一侧每 chunk 都变。所以把**稳定那一侧**算成 Set，缓存住。
//
//  如果写成 `streamingToolUses.filter(stu => !getToolUseIDs(normalized)...)`，
//  就是每次 delta 都重扫一遍全部消息（O(n×k)）。'''),

    (456, 'before', '''// 【deriveUUID 而不是 randomUUID，是为了 React key 稳定】
//
//  这一段是「同一个 bug 的第二次修复」。注释里给了前一次的提交号
//  （383326e613），以及症状：随机 uuid → key 每帧都变 → 组件 remount →
//  Ink 的旧 DOM 节点没被清掉 → **屏幕上文字重叠**。
//
//  注意症状的隐蔽性：remount 不会报错，React 只是把旧节点标成待删除，
//  而 Ink 的宿主实现里删除和插入的顺序一旦错，就会看到两层文字叠在一起。
//  所以这类 bug 排查时容易误判成「渲染器有问题」，实际是 key 不稳定。
//
//  deriveUUID(id, 0) 的第二个参数是块内下标 —— 同一个 tool_use id 只会有
//  一个块，所以固定 0。'''),

    (461, 'before', '''// 【空依赖数组 + useMemo = 「只在挂载时读一次环境变量」】
//
//  这是一个很少见的组合。通常空依赖配 useState 的惰性初始化，这里用
//  useMemo 是为了表达「这是个值，不是状态」。
//
//  注释说明了必要性：这个组件**每次滚动都会重渲染**。如果每帧都读
//  process.env，读取本身不贵，但注释想强调的是「读出来的值必须稳定」——
//  否则滚动过程中环境变量变了（几乎不可能）会导致虚拟列表中途切换模式，
//  那一瞬间的 DOM 树结构变化会让所有 item 重新挂载。'''),

    (466, 'before', '''// 【用「prop 在不在」当开关，是有意的设计】
//
//  scrollRef 只在 isFullscreenEnvEnabled() 为真时才由 REPL.tsx 传进来。
//  所以这里不需要再读一遍环境变量 —— **传了就是全屏模式**。
//
//  好处：这个组件在测试里可以单独决定走哪条路径，不用改环境变量。
//  代价：读代码时必须回到调用点才能知道 scrollRef 何时非空（这是隐式契约）。
//
//  注释里明说了 "so scrollRef's presence is the signal" —— 这类隐式契约
//  如果不写下来，是纯粹的阅读障碍。'''),

    (467, 'before', '''// 【三个条件的层次，别读成并列】
//
//  shouldTruncate = transcript && 没展开 && 没虚拟列表
//
//  三者不是平级：
//  · transcript 是「在哪个屏幕」
//  · !showAllInTranscript 是「用户按没按 ctrl+e」
//  · !virtualScrollRuntimeGate 是「有没有更好的机制接管截断」
//
//  第三个的意思是：有虚拟列表时**不需要**这层 30 条的截断，因为虚拟列表
//  本身就把内存管住了，而且它能让用户滚到全部历史。此时再截断是纯损失。'''),

    (481, 'before', '''// 【这个大 useMemo 的拆分理由，注释给了具体数字】
//
//  拆之前：依赖里含 renderRange → 每次滚动重算 6 个 Map + 4 趟 filter/map，
//  27k 条消息约 50ms 分配 → GC 压力 → 1GB 堆上 100-173ms 的 stop-the-world。
//
//  拆之后：这个 memo 只管「内容」的变化（消息、模式、verbose），
//  renderRange 进下一个 memo（第 532 行那个）。
//
//  **拆 memo 的依据不是「职责清晰」，是「变化频率不同」。** 滚动时变的东西
//  和内容变化时变的东西，必须分开放，否则高频的那个会把低频那个的成果
//  每次都作废。这条规律在整份 UI 层反复出现。'''),

    (496, 'before', '''// 【同一个东西，两种屏幕模式下处理相反】
//
//  · 主屏（default）：保留 compact 边界过滤。压缩前的行已经被写进终端
//    的原生 scrollback 了，重画它们只会触发全量重置。
//  · 全屏（fullscreen）：不过滤。alt buffer **没有原生 scrollback**，
//    过滤掉就等于那些历史彻底消失 —— 而 ScrollBox 本来就能滚到它们。
//
//  includeSnipped 的理由在注释最后一段，是个容易被忽略的连锁反应：
//  normalizeMessages 派生了新 uuid，而 projectSnippedView 是拿**原始**
//  removedUuids 去比的，比不到 → 被 snip 掉的消息会漏出来。
//
//  **凡是「先派生新标识再拿旧标识去查」的地方，都会静默失配。**'''),

    (499, 'before', '''// 【progress 消息在这里被剔除，但它不是「不显示」】
//
//  ProgressMessage 是工具执行过程中的进度（hook 输出、流式内容）。它们的
//  内容会被 buildMessageLookups 收集，然后通过 progressMessagesForMessage
//  塞进**对应那条 tool_use 的渲染**里。
//
//  所以剔除的只是「独立成行」，不是丢弃。这类「从列表里移除但内容另有
//  去处」的操作，读的时候要跟一脚 —— 否则会以为进度信息被吞了。'''),

    (504, 'before', '''// 【isNullRenderingAttachment 必须在「计数」之前】
//
//  注释里的 CC-724 说明得很细：hook_success / hook_additional_context /
//  hook_cancelled 这些附件，AttachmentMessage 渲染时返回 null。
//
//  如果先计数再过滤，ctrl+o 顶部会显示「还有 37 条隐藏消息」，而实际展开
//  后什么都没多出来 —— 用户会以为有 bug。如果先切片再过滤，200 条的上限
//  会被这些空附件占掉。
//
//  判据的通用形式：**任何「渲染为 null」的元素，都必须在计数和切片之前
//  移除**，否则它既占位置又不显示。'''),

    (520, 'before', '''// 【四个 collapse 叠在一起，从内到外读】
//
//  collapseReadSearchGroups → collapseTeammateShutdowns
//    → collapseHookSummaries → collapseBackgroundBashNotifications
//
//  最容易读错的是最内层：它接收的是 `groupedMessages`（已经过
//  applyGrouping），而外三层接收的是上一层的输出。
//
//  为什么这个顺序：read/search 折叠是**按工具类型**合，不依赖 hook 摘要；
//  hook 摘要需要先看到全部 hook 结果才能合并；bash 通知要在最后，因为它
//  依赖前面合并后的结构判断「这组里还有没有别的东西」。
//
//  每一层都可能改变 collapsed.length 而**不新增消息** —— 这就是第 278 行
//  那段注释里「量化切片仍然会挪」的原因。'''),

    (521, 'before', '''// 【lookups 用的是 normalizedMessages，不是 messagesToShow】
//
//  这个区别很关键：lookups 要能回答「任意 tool_use_id 对应的 tool 是什么、
//  它 resolve 了没有」，所以它必须覆盖**全部**消息，包括被 compact 过滤掉
//  的和被 cap 切掉的。
//
//  否则会看到一个诡异现象：滚到窗口顶部附近时，某条 tool_result 找不到
//  对应的 tool_use（因为 tool_use 在切片外面），渲染退化成通用文本。
//
//  第二个参数 messagesToShow 是给「这个窗口里有哪些 tool_use」这类**局部**
//  查询用的。一个函数，两个作用域，别混。'''),

    (532, 'before', '''// 【「cheap slice」这个名字是相对的】
//
//  它确实只做 slice，但依赖里含 collapsed_0 —— 而 collapsed_0 来自上一个
//  大 memo。所以滚动时命中的是缓存（collapsed_0 引用不变），只有内容变化
//  时才会重跑这个 slice。
//
//  两个 memo 的分工：上面管「算出该显示什么」，这里管「显示其中的哪一段」。'''),

    (541, 'before', '''// 【切片只在不走虚拟列表、且没被显式关掉时才做】
//
//  disableRenderCap 的用途在 Props 注释里（第 259 行）：一次性 headless
//  渲染（/export）没有 scrollback 可依赖，内存顾虑也不成立，所以要能关。
//
//  注意 capApplies 的两项条件是**与**关系，但来源完全不同：一个是运行时
//  结构（有没有虚拟列表），一个是调用方意图（要不要被截断）。把它们并成
//  一行 if 是省事，但读的时候要分清哪个是「不能截」哪个是「不必截」。'''),
]
