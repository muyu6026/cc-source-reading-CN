# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  UserToolErrorMessage：工具报错了，分五种情况
// ═══════════════════════════════════════════════════════════════
//
//  四个早退 + 一个兜底：
//
//      1  含「被用户中断」文案        → InterruptedByUser（就是一条分隔线）
//      2  以计划拒绝前缀开头          → RejectedPlanMessage（把计划画出来）
//      3  以「带原因的拒绝」前缀开头  → RejectedToolUseMessage
//      4  分类器拒绝（feature 门控）  → 「Denied by auto mode classifier」
//      5  其它                        → 工具自己的 renderToolUseErrorMessage
//                                        或者 FallbackToolUseErrorMessage
//
//  所以「报错」这件事在数据层只有 is_error 一个布尔，
//  到渲染层被拆成了五种完全不同的东西。
//
//  原因：工具结果的 content 是**文本**，错误的原因只能靠内容区分。
//  又一次「消息即协议」。'''),

    (17, 'before', '''// 【`tool?: Tool` 是可选的，注释说明了为什么】
//
//      // undefined when resuming an old conversation that uses an old tool
//
//  恢复旧会话时，那次调用用的工具可能已经不存在了（版本更新后删了一个工具）。
//  这时候 tool 是 undefined，但结果内容还在（它是纯文本）。
//
//  于是最后的兜底用 `tool?.renderToolUseErrorMessage?.(…) ?? <Fallback…/>`：
//  工具没了就用通用渲染器。
//
//  **可选 prop 在这里不是「懒得传」，是「真的可能没有」。**
//  注释把这一点写清楚，是为了防止后来人把它改成必填。'''),

    (33, 'before', '''// 【第一条判断用的是 `includes` 而不是 startsWith】
//
//      param.content.includes(INTERRUPT_MESSAGE_FOR_TOOL_USE)
//
//  因为中断文案可能被**包在别的文本里**：工具可能返回
//  「Error: … Request interrupted by user」这种前缀带别的信息的句子。
//
//  而第 43、63 行那两个判断用的是 startsWith，因为那两个前缀
//  是程序生成的、一定在开头。
//
//  **同一个文件里 includes 和 startsWith 混用，各自有理由** ——
//  这不是不一致，是对数据形态的准确描述。'''),

    (46, 'before', '''// 【`content.substring(PLAN_REJECTION_PREFIX.length)` —— 按前缀长度切片】
//
//  取的是「前缀之后的全部内容」，也就是计划正文。
//  用 length 而不是硬编码数字，是因为前缀本身是个常量，
//  将来改了前缀，这里自动跟着变。
//
//  注意 substring 而不是 slice：两者对负数参数的行为不同，
//  但这里参数一定非负，等价。用 substring 更像是「我知道这是前向切片」的表达。'''),

    (90, 'before', '''// 【兜底的两级降级：工具的渲染器 → 通用渲染器】
//
//      tool?.renderToolUseErrorMessage?.(content, {…}) ?? <FallbackToolUseErrorMessage result={content} verbose={verbose} />
//
//  两个 `?.`：一个是 tool 可能没有，一个是工具可能没实现这个方法。
//  最后 `??` 兜住这两种情况。
//
//  注意 `filterToolProgressMessages(progressMessagesForMessage)` 是必传的：
//  工具的错误渲染可能需要展示「出错前的最后几步进度」。
//  而 filter 掉的是 hook_progress（那部分由 HookProgressMessage 单独画）。
//
//  这个链式降级是所有工具扩展点的通用写法：
//  **能力由工具声明，缺了就退到通用实现。**'''),
]
