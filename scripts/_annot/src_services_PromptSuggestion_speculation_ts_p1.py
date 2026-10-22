# -*- coding: utf-8 -*-
# 批注数据：source/src/services/PromptSuggestion/speculation.ts
# 锚点行号指 source/ 原文；中文翻译插在对应英文行之后（或整段注释之后）。
# 不写反斜杠。

ANNOTATIONS = [
    # 常量：投机执行的硬上限
    (59, 'after', '投机执行的两条硬上限：最多 20 轮、最多 100 条消息，到了就 abort——防止子代理无限空转白烧 token。'),

    # 工具白名单
    (70, 'after', '工具白名单：WRITE_TOOLS（会改文件的三个工具）与 SAFE_READ_ONLY_TOOLS（纯只读类）。投机期间只允许这两类，其余一律 deny。'),

    # overlay 路径
    (82, 'after', 'overlay 临时目录：投机产生的「写入」全落在 Claude 临时区下的 speculation/<pid>/<id>，绝不碰真实 cwd；safeRemoveOverlay 用 rm 带重试兜底清理。'),

    # denySpeculation
    (97, 'after', '拒绝决策的统一返回形状：behavior 固定 deny，并带一条 decisionReason，供上层日志与 UI 区分拒绝原因。'),

    # copyOverlayToMain
    (117, 'after', '写时复制的回收：用户真正「接受」投机结果时，才把 overlay 里被改过的文件拷回真实 cwd；任一文件拷贝失败则整批标失败，不半吊子落地。'),

    # logSpeculation
    (153, 'after', '遥测事件 tengu_speculation：记录结果（accepted/aborted/error）、耗时、tool 执行数、是否走到边界、边界类型/工具/细节——衡量「省了多少时间」的核心数据来源。'),

    # prepareMessagesForInjection
    (271, 'after', '注入前清洗：只保留「有成功结果的 tool_use」，剥掉挂起或中断的 tool_use 与 tool_result；还要删掉纯空白文本块（否则 API 报 400「文本块必须含非空白内容」），并把投机中途的中断用户消息当假输入剔除。'),

    # createSpeculationFeedbackMessage
    (308, 'after', '仅内部（ant）用户可见的反馈消息：在对话里插一句「投机了 N 次工具 / M 个 token · +X 秒已省」，让用户感知后台预取的收益；外部用户直接返回 null。'),

    # isSpeculationEnabled
    (343, 'after', '开关：投机执行只对内部（ant）用户开启，且可被全局配置关掉；其余用户根本不会进 startSpeculation。'),

    # generatePipelinedSuggestion
    (400, 'after', '流水线预取：一次投机「完整跑完」后，立刻用同样的上下文再请模型猜「下一条建议」，提前把下一段工作也备好——用户连点两次就能一路跑下去。'),

    # startSpeculation 入口
    (414, 'after', 'startSpeculation 入口：先 abort 掉上一次未完成的投机（同一时刻只跑一个），再 randomUUID 截 8 位当本次 id，建 overlay 目录。'),

    # runForkedAgent + canUseTool
    (457, 'after', 'fork 一个受限子代理跑投机：权限收窄全在下面这个 canUseTool 回调里；maxTurns 与 overrides.abortController 让它可被随时中断；querySource 标 speculation 便于埋点。'),

    # 写工具边界
    (495, 'after', '写工具边界：遇到 Edit/Write/NotebookEdit，先看当前权限模式——只有 acceptEdits / bypassPermissions /（plan 且可越权）才放行，否则在「文件编辑」处停下、记 edit 边界并 abort，转交用户手动确认。'),

    # overlay 路径改写（写时复制核心）
    (574, 'after', 'overlay 路径改写（写时复制核心）：命中文件的写操作，先把它从 cwd 拷进 overlay（首次），再把输入路径重定向到 overlay；读操作则先看 overlay 有没有被改过的版本——有就读 overlay、没有读真实 cwd。于是投机过程「看起来改了文件」，但真实磁盘纹丝不动。'),

    # bash 只读边界
    (608, 'after', 'bash 只读边界：非只读的 bash 命令（含 cd）在此停下并 abort；只读命令才放行，保证投机不会偷偷执行带副作用的命令。'),

    # 其余工具拒绝
    (631, 'after', '其余工具一律拒绝：任何不在白名单里的工具（WebFetch、Slack 等）都记 denied_tool 边界后 abort，绝不静默放行。'),

    # onMessage
    (655, 'after', '消息收集：把子代理产出的 assistant/user 消息攒进 messagesRef；每来一条带成功 tool_result 就累加 toolUseCount 给 UI；消息数到 100 直接 abort。'),

    # 完成后流水线
    (679, 'after', '投机完整跑完后（未 abort），不阻塞地唤起 generatePipelinedSuggestion 生成「下一条建议」——这就是空闲预取能连续推进的关键。'),

    # acceptSpeculation
    (800, 'after', 'acceptSpeculation（用户接受）：abort 子代理 → 如有改动把 overlay 拷回 cwd → 删 overlay → 计算省时（接受时刻与完成时刻取较小值减开始时刻）→ 记日志；返回注入用的 messages 与 boundary。'),

    # abortSpeculation
    (833, 'after', 'abortSpeculation：用户中途打字打断投机时调用——记 aborted 日志、调 abort() 杀子代理、删 overlay、状态复位到 idle。'),

    # handleSpeculationAccept
    (991, 'after', 'handleSpeculationAccept：把投机结果接进真实对话的总装线——先清掉提示状态、把用户这条输入即时插到 UI、调 acceptSpeculation 落地改动、再把清洗后的投机消息注入消息流；若投机未完整跑完，要裁掉末尾的 assistant 消息（模型不支持 prefill 会拒收以 assistant 结尾的对话）；最后若完整跑完，则把流水线建议提升为当前建议并启动下一轮投机。'),
]
