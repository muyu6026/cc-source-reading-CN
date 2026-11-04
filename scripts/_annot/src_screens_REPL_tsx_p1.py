# 批注数据：source/src/screens/REPL.tsx
# 锚点密度约 1/43 行（全文件 5005 行，约 116 处），覆盖导入、条件 require、
# 各类 hook/useCallback、resume 恢复流程、远程/SSH/直连、transcript 模式与 JSX 返回。
# 正文用三引号；禁英文双引号与反斜杠；不使用三个连续单引号。

ANNOTATIONS = [
    (2, 'after_block', '''文件头声明：用 biome-ignore 关闭 import 自动排序。
原因：ANT 专属的 import 标记顺序不能被整理，否则条件 require 会被打乱。'''),
    (11, 'after', '''eslint 豁免说明：在 transcript 模态下 / n N Esc [ v 属于裸字母按键，
与 ScrollKeybindingHandler 中的 g/G/j/k 同类，必须用原生键绑定而非输入框。'''),
    (96, 'after_block', '''死代码消除——条件 import。
外部构建会整段剔除这些模块以缩小打包体积。'''),
    (114, 'after', '''协调器（coordinator）模式的条件 import，同样服务于死代码消除。'''),
    (192, 'after', '''loop 模式的条件 import，供外部构建剔除无用代码。'''),
    (221, 'before', '''根据 feature 开关条件引入 ant 专属的模型切换提示组件；外部构建得到 null。'''),
    (272, 'before', '''Web 浏览器工具面板模块，仅当 feature('WEB_BROWSER_TOOL') 为真时才引入。'''),
    (291, 'after_block', '''为接收 MCPServerConnection 的 hook 准备一个稳定的空数组引用，
避免远程模式下每次渲染都新建空数组字面量导致依赖变化、触发无限重渲染。'''),
    (307, 'after_block', '''用 LRU 缓存限制文件状态缓存的无界增长；
100 个文件对多数编码会话足够，又能防止大项目跨多文件时内存膨胀。'''),
    (321, 'before', '''TranscriptModeFooter：transcript 模式底部的状态栏组件，显示搜索/滚动等状态。'''),
    (385, 'after_block', '''用上一次的查询词作为搜索初始值（less 的 / 显示上一条模式）；
挂载时触发的效应会做幂等重扫，用户可继续编辑或清空。'''),
    (450, 'after_block', '''applySearchHighlight 会扫整个屏幕缓冲；搜索栏自身文字也在屏上，
所以要做排除处理，避免把搜索栏里的文字当成唯一匹配而加下划线。'''),
    (473, 'before', '''终端标题动画用的三帧字符、静态前缀与切换间隔（960ms）常量定义。'''),
    (520, 'before', '''编译器生成的辅助函数 _temp2（React 编译器产物，用于把 setFrame 闭包化）。'''),
    (526, 'before', '''导出 Props 类型：REPL 组件接收的全部外部属性声明。'''),
    (548, 'after_block', '''一组可选的回调与开关属性：查询前后钩子、回合完成回调、
是否禁用输入与斜杠命令、任务模式、各类远程/SSH/思考配置等。'''),
    (571, 'before', '''导出 Screen 类型，枚举 prompt 与 transcript 两种屏幕模式。'''),
    (572, 'before', '''REPL 主组件：整个 CLI 终端 UI 的根。
下面 4400 多行是它的巨型函数体，包含数十个嵌套 useCallback 与一个大 JSX 返回。'''),
    (616, 'after', '''agent 定义放进 state，以便 /resume 能在会话中途更新它。'''),
    (642, 'after_block', '''引导（bootstrap）：对尚未从磁盘加载完的本地 agent，
先读 sidechain 的 JSONL 并做 UUID 合并；流式追加立即发生，引导负责补前缀，
磁盘写入先于 yield 保证 live 永远是磁盘的后缀。'''),
    (676, 'after_block', '''standaloneAgentContext 在 main.tsx（initialState）或 ResumeConversation.tsx
（渲染 REPL 前 setAppState）里初始化，避免在挂载时用 useEffect 初始化状态。'''),
    (689, 'after_block', '''BriefTool.isEnabled 读 getUserMsgOptIn，/brief 会中途翻转它；
下面的记忆化需要这个 AppState 镜像作为依赖，否则中途切 /brief 会留下陈旧工具体表。'''),
    (705, 'after_block', '''在 transcript 模式下 [ 强制走 dump-to-scrollback 路径；
与进程级开关不同，这个是临时的，退出 transcript 时重置，是供终端 cmd-F 搜索的诊断逃生口。'''),
    (778, 'after', '''记忆化合并后的初始工具数组，避免引用频繁变化触发下游重渲染。'''),
    (791, 'after_block', '''安全边界：这段代码保证只在用户确认「信任此文件夹」对话框之后运行；
对话框在 cli.tsx 渲染 REPL 之前弹出并阻塞，直到用户接受才会挂载 REPL 并执行此处。'''),
    (806, 'after_block', '''初始化 swarm（多智能体）特性：队友钩子与上下文，
兼容全新 spawn 与恢复的队友会话。'''),
    (831, 'after', '''合并来自本地状态、插件和 MCP 三处的命令。'''),
    (839, 'after_block', '''用 ref 镜像 streamMode，使 onSubmit 不必把它放进依赖；
否则 streaming 期间每次翻转都会重建 onSubmit，级联引发 PromptInput 属性抖动。'''),
    (852, 'after', '''流式思考完成后 30 秒自动隐藏。'''),
    (866, 'after_block', '''始终指向当前 abort controller 的 ref，供 REPL 桥在远端中断到达时中止活跃查询。'''),
    (897, 'after_block', '''用同步状态机取代原来易出错双状态模式（React state 异步批处理 + ref 同步可能失步）；
详见 QueryGuard.ts，它是「本地是否有查询在飞」的唯一真相源。'''),
    (921, 'after_block', '''记录设置 userInputOnProcessing 那一刻的 messagesRef 长度，
真实用户消息进入可见 transcript 后，占位符据此隐藏。'''),
    (941, 'after_block', '''在 isQueryActive 由 false 变 true 的同一帧内联重置计时 ref，
避免 spinner 算出 elapsedTimeMs = Date.now() - 0 约等于 56 年的荒诞值（INC-4549）。'''),
    (955, 'after_block', '''包装 setIsExternalLoading，在转为 true 时重置计时 ref，
让 SpinnerWithVerb 也能为远程/前台任务算对耗时，否则会显示约 56 年。'''),
    (974, 'after', '''跟踪当前 focusedInputDialog 的 ref，避免在定时器回调里读到陈旧闭包。'''),
    (980, 'after_block', '''用户正在输入时为 true，延后中断对话框，
避免按键意外关闭或答掉用户还没读到的权限提示。'''),
    (996, 'after_block', '''tmux + 全屏 + mouse off 下的一次性提示：滚轮不会滚动；
不再改动 tmux 的会话级 mouse 选项（会污染兄弟面板）。'''),
    (1017, 'after', '''等待仓库分类结果稳定（已记忆化，若已预热则为空操作）。'''),
    (1041, 'after_block', '''把本地 JSX 命令单独跟踪，使工具无法覆盖它们，
从而让 /btw 这类「即时」命令在 Claude 处理期间持续存在。'''),
    (1051, 'after_block', '''包装 setToolJSX 以保留本地 JSX 命令；
只有显式 clearLocalJSX 时才接受工具的更新，并附「如何新增即时命令」三步指引。'''),
    (1102, 'after_block', '''权限请求组件（目前仅 ExitPlanModePermissionRequest）注册的粘性页脚 JSX，
渲染在 FullscreenLayout 底部槽位，用户在滚动长计划时仍能看到响应选项。'''),
    (1124, 'after_block', '''会话标题（/rename 设置或恢复时还原）优先于 agent 名，
agent 名优先于 Haiku 提取的主题，最终都回退到产品名。'''),
    (1130, 'after_block', '''控制一次性 Haiku 调用的门：恢复会话时种子为 true（initialMessages 存在），
避免从对话中途重新生成标题。'''),
    (1143, 'after_block', '''标题动画状态放在子组件里，使 960ms 的 tick 不重渲染 REPL；
titleDisabled/terminalTitle 仍在此计算，因为 onQueryImpl 要读它们。'''),
    (1158, 'after_block', '''把状态推到 PID 文件供 claude ps 使用；即发即弃，
缺失/陈旧时 ps 会回退到 transcript 尾部推导。'''),
    (1169, 'after_block', '''第三方默认关闭 OSC 21337（ant 专属，规范还不稳定）；
加了开关以便与标题 spinner 冲突时回滚。'''),
    (1184, 'after_block', '''记录实际展示过的 willowMode 变体（或 false），在 hint_shown 时捕获，
保证 hint_converted 遥测与 hint_shown 报同一变体。'''),
    (1189, 'after_block', '''包装 setMessages，使 messagesRef 在调用返回瞬间就最新（并非等 React 批处理）；
先对 ref 急切套用更新函数，再把算好的值交给 React——这是 Zustand 模式：
ref 是真相源，React state 是渲染投影。'''),
    (1198, 'before', '''setMessages：同步更新 messagesRef 与 React state 的包装回调，
保证后续同步读取 ref 不再拿到陈旧数据。'''),
    (1225, 'before', '''setUserInputOnProcessing：记录正在处理、但用户消息尚未落盘的输入，
用于占位符显隐与基线同步。'''),
    (1259, 'before', '''repinScroll：把滚动重钉到最底部的 useCallback。'''),
    (1264, 'after_block', '''兜底重钉：submit 处理者的重钉在 onSubmit 处可能因缓冲的 stdin 事件竞态而被撤销；
这个效应绑定到 React 提交周期，不会与 stdin 竞态。'''),
    (1277, 'after_block', '''助手聊天：滚动到上方时惰性加载远端历史；
仅当 KAIROS 构建且 config.viewerOnly 时生效，外部构建被死代码消除。'''),
    (1292, 'before', '''composedOnScroll：组合后的滚动回调，是用户滚动的唯一入口，
负责写 lastUserScrollTsRef 等。'''),
    (1310, 'after_block', '''延迟的 SessionStart 钩子消息：REPL 先立即渲染，钩子消息解析后再注入；
必须在第一次 API 调用前调用 awaitPendingHooks，让模型看到钩子上下文。'''),
    (1315, 'after_block', '''给 Messages 组件的延迟消息：以过渡优先级渲染，
使协调器每 5ms 让出一次，保持输入响应。'''),
    (1329, 'after', '''用惰性初始化把 REPL 就绪前捕获的早期输入填入输入框，确保光标偏移设置正确。'''),
    (1344, 'before', '''setInputValue：写入输入框值的 useCallback，并同步维护抑制状态与 ref。'''),
    (1346, 'after_block', '''全屏模式下，输入到空行会重钉滚动到底部；只在空到非空时触发，
避免引用上文时每键都拽回视图；若用户 3 秒内滚过动则跳过。'''),
    (1379, 'after', '''按 CCR 可用斜杠命令过滤命令的回调。'''),
    (1380, 'before', '''handleRemoteInit：远程模式初始化回调，根据 CCR 列出的命令过滤本地命令。'''),
    (1401, 'after', '''直连 hook：管理 claude connect 模式到 claude server 的 WebSocket。'''),
    (1410, 'after_block', '''SSH 会话 hook：管理 claude ssh 模式的 ssh 子进程；
回调形状与 useDirectConnect 一致，只是底层传输不同。'''),
    (1425, 'after_block', '''用 ref 而非 state，避免每次流式 text_delta 都触发 React 重渲染；
spinner 通过动画定时器读它。'''),
    (1441, 'before', '''setResponseLength：更新响应长度 ref 的 useCallback。'''),
    (1458, 'after_block', '''流式文本显示：每个 delta 直接 set state（Ink 的 16ms 渲染节流会批处理快速更新）；
消息到达时清空，使 displayedMessages 原子切换到 messages。'''),
    (1464, 'before', '''onStreamingText：处理流式文本的 useCallback。'''),
    (1492, 'after_block', '''聚合工具结果预算：按会话做决策跟踪；
GrowthBook 开关开启时由 query.ts 强制，关闭时整体跳过，陈旧项无害。'''),
    (1512, 'after_block', '''showBashesDialog 提升到 REPL 级，使 PromptInput 卸载时也不丢；
ultraplan 审批弹窗时 PromptInput 会卸载但标志保持，接受后重挂载成空对话框，在此关闭。'''),
    (1527, 'after_block', '''resetLoadingState 每回合跑两次（onQueryImpl 尾部 + onQuery finally），
没有这个守卫会两次各挑一个 tip 导致两次写配置；在 onSubmit 提交时重置。'''),
    (1531, 'before', '''pickNewSpinnerTip：随机挑选一个 spinner 提示语的 useCallback。'''),
    (1567, 'before', '''resetLoadingState：清理加载态的 useCallback，不调用 onTurnComplete
（那个只在回合真正完成时显式调用）。'''),
    (1589, 'after', '''会话后台化 hook 在 getToolUseContext 之后（下方）。'''),
    (1593, 'after_block', '''所有 swarm 队友完成时才展示延迟的回合时长消息；
只统计会落盘的消息，避免误报 delta。'''),
    (1610, 'after_block', '''进入 auto 模式（Shift+Tab 切换或启动）时展示自动权限告警，
做了防抖避免快速切换闪烁；跨会话最多展示 3 次。'''),
    (1641, 'after_block', '''若 worktree 创建慢且没配 sparse-checkout，提示用户去 settings.worktree.sparsePaths。'''),
    (1654, 'after', '''当唯一在跑的工具是 Sleep 时隐藏 spinner。'''),
    (1673, 'after_block', '''在输入处理、API 调用、队友运行或任务通知排队时都显示 spinner，
防止连续通知之间 spinner 跳动。'''),
    (1683, 'after_block', '''流式文本可见时隐藏 spinner（文本本身就是反馈），
但 isBriefOnly 抑制流式文本显示时保留。'''),
    (1694, 'after', '''包装反馈调查处理器以触发自动运行 /issue。'''),
    (1714, 'after_block', '''记忆调查：当助手提到记忆且本会话读过记忆文件时展示。'''),
    (1720, 'after', '''挫败感检测：检测到挫败消息后展示 transcript 分享提示。'''),
    (1735, 'before', '''resume：恢复指定会话的 useCallback，是本组件最复杂的流程之一。'''),
    (1771, 'after', '''启动恢复会话前，先为当前会话触发 SessionEnd 钩子，与 conversation.ts 的 /clear 流程一致。'''),
    (1799, 'after', '''从恢复的对话还原文件历史与归属状态。'''),
    (1843, 'after_block', '''原子切换会话（id + 工程目录）；fullPath 可能指向别的工程（跨 worktree、/branch），
null 则从 currentOriginalCwd 推导。'''),
    (1894, 'after', '''持久化当前模式，使未来恢复知道本会话处于什么模式。'''),
    (1934, 'after', '''清除输入，避免残留状态。'''),
    (1971, 'before', '''restoreReadFileState：从消息历史还原读文件状态的 useCallback。'''),
    (2006, 'after', '''退出反馈流的状态。'''),
    (2032, 'after', '''来自 swarm worker 的沙箱权限提示（网络访问）。'''),
    (2058, 'after', '''桌面端应用推广（最多 3 次启动，最低优先级）。'''),
    (2081, 'after', '''刚进入暂停态时记录确切时刻，确保计时准确。'''),
    (2113, 'after', '''暂停主动模式把控制权交还用户，下次提交时恢复。'''),
    (2155, 'after', '''清掉 controller，避免后续 Esc 误读到一个已中止的陈旧信号。'''),
    (2216, 'before', '''sandboxAskCallback：处理沙箱网络访问权限请求的 useCallback。'''),
    (2345, 'before', '''setToolPermissionContext：更新工具权限上下文的 useCallback。'''),
    (2383, 'before', '''requestPrompt：构造 Promise 化的提示请求回调（用于权限/输入提示）。'''),
    (2422, 'after', '''从 store 而非闭包里合并最新的 MCP 客户端，initialMcpClients 是会话级常量。'''),
    (2526, 'before', '''handleBackgroundQuery：把前台查询切到后台的 useCallback。'''),
    (2587, 'after', '''全屏模式保留压缩前的消息用于滚动回溯；在压缩边界处截断，
把 n 限制在一个压缩区间内以跨多天会话保持有界。'''),
    (2631, 'after', '''在 API 错误时阻断 tick，防止 tick 到 error 再到 tick 的失控循环。'''),
    (2687, 'after', '''跳过合成的面包屑（斜杠命令输出、提示技能展开等），它们不是用户的真实主题。'''),
    (2735, 'after', '''手动 /compact 直接设消息（shouldQuery=false）绕过 handleMessageFromStream，
若有压缩边界则清掉 context-blocked 标志，让主动 tick 在压缩后恢复。'''),
    (2771, 'after', '''在 setMessages 之后再做这件事，避免 UI 抖动。'''),
    (2817, 'after', '''用仅含活跃流式时间与流式内容的方式算每次请求的 OTPS，排除子 agent/压缩虚高。'''),
    (2856, 'after', '''若这是队友，在开始回合时把它标记为活跃。'''),
    (2901, 'after', '''messagesRef 已被上面的 setMessages 包装同步更新，已包含本回合新增消息，无需重建。'''),
    (2936, 'after', '''回合结束时自动隐藏 tungsten 面板内容（ant 专属），但保留 pill 在页脚，
让用户可重新打开面板；中止时跳过以保持面板开着检视。'''),
    (2977, 'after', '''只在第一次延迟回合记录起始时间。'''),
    (2996, 'after', '''自动恢复：若用户在任意有意义响应到达前就中断，则回退对话并还原其输入。'''),
    (3038, 'after', '''保留 plan slug 再清上下文，使新会话能访问同一 plan 文件。'''),
    (3069, 'after', '''对 auto 模式覆盖 mode 并剥离危险规则。'''),
    (3112, 'after', '''所有字符串内容都经 onSubmit 路由，确保 UserPromptSubmit 钩子触发。'''),
    (3135, 'after', '''shouldQuery（传给 onQuery 的参数）。'''),
    (3170, 'after', '''查找匹配命令：满足下列任一即视为即时——命令带 immediate:true，
或由键绑定触发（fromKeybinding 选项）。'''),
    (3207, 'after', '''直接执行命令。'''),
    (3248, 'after', '''本地 JSX 命令完成后还原暂存提示。'''),
    (3289, 'after', '''空闲返回：当对话很大且缓存很冷时，引导返回用户从头开始。'''),
    (3328, 'after', '''恢复暂存（除非是斜杠命令或正在加载），避免把文本放进隐藏输入框而丢失。'''),
    (3340, 'after', '''提交「现在」运行（非排队中、或接受推测、或远程模式经 WS 返回）。'''),
    (3370, 'after', '''在 setInputValue('') 的同一 React 批次里显示占位符。'''),
    (3411, 'after', '''远程模式下，工具的权限请求会桥接进 toolUseConfirmQueue，用标准 PermissionRequest 渲染。'''),
    (3473, 'after', '''创建并把用户消息加入 UI。'''),
    (3515, 'after', '''经 ref 读取 streamMode，使其可移出 onSubmit 依赖。'''),
    (3547, 'after', '''当用户在查看队友 transcript 时提交输入的回调。'''),
    (3581, 'before', '''handleAutoRunIssue：自动运行 /issue 或 /good-claude 的处理器（定义在 onSubmit 之后）。'''),
    (3622, 'before', '''handleExit：退出流程的 useCallback。'''),
    (3656, 'after', '''rewindConversationTo：把对话状态回退到指定消息之前，
切片消息、重置会话 id、微压缩状态、权限模式与提示建议，不动输入框。'''),
    (3709, 'after', '''restoreMessageSync：同步的回退加输入填充，供中断时自动恢复，
与 abort 的 setMessages 同批提交，避免闪烁。'''),
    (3745, 'before', '''handleRestoreMessage：MessageSelector 路径，用 setImmediate 延迟，
让「Interrupted」消息先渲染成静态输出再回退。'''),
    (3782, 'after', '''对话框路径：onPreRestore（即 onCancel）在用户确认而非取消时触发。'''),
    (3819, 'after', '''登记成本汇总追踪器。'''),
    (3839, 'after', '''REPL 桥：把用户/助手消息复制到桥接会话供 claude.ai 远程访问；
外部构建或未启用时为空操作。'''),
    (3861, 'before', '''executeQueuedInput：查询完成且队列有项时处理排队命令的 useCallback。'''),
    (3909, 'after', '''Claude 响应完毕且用户空闲时弹出通知。'''),
    (3943, 'after', '''空闲返回提示：超过空闲阈值时弹通知，持续到你提交或忽略。'''),
    (3996, 'before', '''handleIncomingPrompt：把队友消息或任务模式的输入作为新回合提交的 useCallback。'''),
    (4028, 'after', '''调度任务来自 .claude/scheduled_tasks.json（CronCreate/Delete/List）。'''),
    (4067, 'after', '''任务模式：监视任务并自动处理。'''),
    (4106, 'after', '''当 now 优先级消息到达时中止当前操作（如来自聊天 UI 客户端经 UDS）。'''),
    (4145, 'after', '''查找 stop hook 的进度消息。'''),
    (4184, 'before', '''handleEnterTranscript：进入 transcript 模式时捕获冻结状态的 useCallback。'''),
    (4236, 'after', '''搜索需要虚拟滚动（jumpRef 驱动 VirtualMessageList）；[ 会杀掉它，故 !dumpMode。'''),
    (4287, 'after', '''less 风格：v 在外部编辑器打开文件，渲染完整 transcript 写入临时文件后移交。'''),
    (4338, 'after', '''每次进入 transcript 都新建一个全新 less 实例，避免陈旧高亮串到无关文本。'''),
    (4385, 'after', '''当本地 JSX 对话框（如 /mcp）打开时拦截 onOpenBackgroundTasks，避免叠对话框死锁输入。'''),
    (4423, 'after', '''手动滚动退出搜索上下文，清掉黄色 current-match 标记。'''),
    (4476, 'after', '''虚拟滚动分支需要 AlternateScreen 的 Box 高度约束，否则 ScrollBox 无上限、视口等于内容高度。'''),
    (4533, 'after', '''全屏下所有本地 JSX 斜杠命令都浮在模态槽里，由 FullscreenLayout 包成绝对定位底部面板。'''),
    (4641, 'after', '''解析同一 host 的全部 pending 请求（不只第一个），覆盖多个并发同域请求的情况。'''),
    (4692, 'after', '''经 mailbox 把响应发给 worker。'''),
    (4729, 'after', '''对 URL 接受，保留在队列等待第二阶段。'''),
    (4875, 'after', '''若用户在等待期间停了 ultraplan，跳过这条过时的监控消息。'''),
    (4956, 'after', '''按 uuid 查找，因为 old 是原始 REPL 历史，被剪裁的条目会位移 projected messageIndex。'''),
]
