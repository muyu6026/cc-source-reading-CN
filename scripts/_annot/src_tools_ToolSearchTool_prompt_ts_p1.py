ANNOTATIONS = [
    (9, 'before', r'''BRIEF_TOOL_NAME / SEND_USER_FILE_TOOL_NAME 用条件 require 按需引入——与 ExitPlanModeV2Tool 的 autoModeState 同款手法：特性关闭时连 import 边都不存在，打包器能整棵砍掉，顶层副作用（如模块级常量初始化）不会残留。eslint-disable 圈出这两块，因为 no-require-imports 规则在这里是故意违反的。'''),
    (27, 'before', r'''PROMPT_HEAD 一句话定位：本工具是「deferred 工具的 schema 取货口」。'''),
    (35, 'before', r'''getToolLocationHint 按 glacier_2xr 开关或 ant 用户决定提示词说 deferred 工具出现在哪种消息里——system-reminder 附件（delta 模式）还是 available-deferred-tools 块（旧模式）。注释特意说明这里的常量与 toolSearch.ts 的开关是「匹配而非导入」关系——那个文件 import 本文件，反向 import 会成环，所以两个常量必须各自维护、注释互相锚定。'''),
    (44, 'before', r'''PROMPT_TAIL 讲清机制与查询语法：未取 schema 前工具「看得见摸不着」（只有名字，调不了）；取到后 schema 以 <functions> 块下发，与 prompt 顶部的工具列表同一编码；三种查询形式（select: 直选 / 关键词 / +必选词）。整段是在给模型上一堂「延迟加载工具系统」的微型课程。'''),
    (62, 'before', r'''isDeferredTool 判定链，顺序即优先级：① alwaysLoad 显式退出优先（MCP 工具靠 _meta 注解退出延迟加载，这条必须最先——否则 MCP 全被默认延迟）；② MCP 工具一律延迟（工作流特定，不是每轮都需要）；③ ToolSearch 自己永不延迟（递归悖论——延迟它就没法取任何 schema）；④ FORK_SUBAGENT 下 Agent 工具若走 fork 模式则退出延迟（第一轮就要能派子代理，惰性 require 同样为破环）；⑤ KAIROS 下 Brief/SendUserFile 退出延迟——它们是通信主通道，提示词里的可见性契约不能让模型先搜一轮才看到；⑥ 兜底才是 shouldDefer 标志。'''),
    (115, 'before', r'''formatDeferredToolLine 只输出工具名——注释记录了一次实验判决：searchHint A/B 实验（exp_xenhnnmn0smrx4，3 月 21 日停止）证明提示行里加能力短语无收益，于是砍到只剩名字。deferred 列表的每一行都在消耗每轮上下文，无收益即删除。'''),
    (119, 'before', r'''getPrompt 三段拼装：HEAD + 位置提示（按开关二选一）+ TAIL。整份提示词运行时才定型——同一个工具在不同特性组合下给模型的「使用说明书」不同。'''),
]
