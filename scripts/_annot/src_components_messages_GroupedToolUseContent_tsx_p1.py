# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  GroupedToolUseContent：一次并行发出 N 个同类工具调用时怎么画
// ═══════════════════════════════════════════════════════════════
//
//  模型一次可以并行发起多个同一工具的调用（比如同时读 8 个文件）。
//  Message.tsx 会把它们合并成一条 GroupedToolUseMessage。
//  这个文件负责把那一条「再拆开」，以工具自己的格式画出来。
//
//  注意它**自己不画任何 UI**（整个文件没有一句 JSX）：
//
//      第 20 行  找工具
//      第 26 行  建 tool_use_id → 结果的索引
//      第 40 行  把每条调用拼成 toolUsesData
//      第 53 行  交给 tool.renderGroupedToolUse 去画
//
//  也就是说：**消息层只做「把数据摆整齐」，画法归工具层**。
//  这是 Agent 类 UI 的一个核心分工，后面几个文件会反复看到。
//
//  这个文件也是少数**没有被 React Compiler 改写**的（没有 _c、没有 $ 槽）——
//  因为它一个 hook 都没有，整段就是纯计算。'''),

    (20, 'before', '''// 【找不到工具、或者工具没实现 renderGroupedToolUse，就什么都不画】
//
//  `tool?.renderGroupedToolUse` 这个可选链回答了一个设计问题：
//  **不是所有工具都支持并行合并展示。**
//
//  支持的工具必须自己提供一个「N 条调用挤在一起」的渲染器；
//  不支持的返回 null，宁可屏幕上少一块，也不画一个通用但难看的列表。
//
//  这种「能力由工具自己声明，调用方只负责转发」的模式，
//  在 Tool.ts 的接口里贯穿始终（renderToolUseMessage / renderToolResultMessage /
//  renderGroupedToolUse / renderToolUseTag …）。'''),

    (26, 'before', '''// 【先建索引：tool_use_id → { param, output }】
//
//  为什么要建这个 Map？因为数据是**两批**送进来的，而且顺序不可靠：
//
//      message.messages   —— N 条 tool_use（模型发起的调用）
//      message.results    —— M 条 tool_result（可能还没到齐，M <= N）
//
//  两批之间只有 tool_use_id 这一个共同点。
//  所以先用一遍 O(M) 建索引，之后每条调用 O(1) 取结果。
//
//  注意这里只认 `content.type === 'tool_result'`：
//  一条 user 消息的 content 可能是数组，里面既有 tool_result 也有 text。'''),

    (40, 'before', '''// 【`msg.message.content[0]` —— 只取第一块，假定它一定是 tool_use】
//
//  这是一个「约定优于校验」的写法：分组消息的构造方保证了
//  每条子消息的 content[0] 就是它的 tool_use 块。
//
//  风险在注释里没写：如果哪天构造方变了（比如前面插了一个 text 块），
//  这里会拿到错的东西，而且 `content as ToolUseBlockParam` 把它硬转过去了。
//
//  读到这种「位置 + 断言」的组合，要顺手去构造方确认一次约定。
//  本仓库里 constructGroupedToolUse 那一段就是这么写的，所以暂时成立。'''),

    (52, 'before', '''// 【`anyInProgress`：只有「还有一条在跑」时才允许动画】
//
//  shouldAnimate 是外部传进来的总开关（比如终端不支持动画、
//  或者这一屏不在可见区域），anyInProgress 是本组自己的状态。
//  两者取与，才交给工具。
//
//  为什么要这个与？因为**已完成的分组不该继续闪**。
//  一组 8 个读文件，前 7 个秒回、第 8 个在等 —— 这时候闪是对的；
//  8 个全完了还在闪，用户会以为程序卡住了。
//
//  这个模式在本仓库反复出现：`shouldAnimate && isInProgress`
//  在 AssistantToolUseMessage、CollapsedReadSearchContent 里都能看到。'''),
]
