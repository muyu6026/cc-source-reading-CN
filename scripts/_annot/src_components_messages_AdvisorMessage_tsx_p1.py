# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// 【Advisor：模型在回答前先请一个「顾问」复核这段对话】
//
//  这是两种很不一样的块：
//      server_tool_use      顾问正在被调用（有个转圈）
//      advisor_result       顾问回话了（一行确认，或 verbose 下展开全文）
//      advisor_redacted     回话内容不可见（只留一行「已复核」）
//
//  顺带解决一个常见误解：**Compiler 的缓存跟「有没有 hook」无关。**
//  这个组件一个 hook 都没有（状态全来自 props），照样生成了 30 个槽。
//
//  反例是同目录的 GroupedToolUseContent：它也没有 hook，但**没有 _c**。
//  区别在于它最后一行是 `return tool.renderGroupedToolUse(...)` ——
//  整个函数里没有一句 JSX 字面量，Compiler 没有可缓存的东西。
//
//  但这条规律**不完整**：UserToolSuccessMessage 有 JSX、也没有 _c。
//  所以只能说「没有 JSX 一定没有 _c」，反方向不成立。
//  剩下的差异（Compiler 版本？这个文件走了不同的编译路径？）
//  从产物里看不出来 —— 这种情况就记成「已知现象」，不要硬编规律。'''),

    (31, 'before', '''// 【第一分支是 server_tool_use，剩下的走 switch】
//
//  为什么不全用 switch？因为 block 的类型是一个可辨识联合，
//  但 `server_tool_use` 需要读 block.id / block.input，
//  而其它分支读 block.content.*。
//
//  写成 if + switch 的混合形态，是为了让 TypeScript 在每个分支里
//  自动收窄到正确的成员 —— 一旦写进同一个 switch，就得到同一个层级，
//  拿不到 content 上的字段。
//
//  这类「按数据形状分层」的判断，比「按类型名字平铺」更容易被编译器理解。'''),

    (34, 'before', '''// 【`Object.keys(input).length > 0` 才显示参数】
//
//  顾问调用经常没有参数（纯「看看这段对话」），
//  这时候冒号后面跟一个 `{}` 只是噪音。
//
//  用 jsonStringify 而不是 JSON.stringify：这个仓库把「可能很慢的序列化」
//  统一收进 utils/slowOperations，调用点显式暴露成本。
//  读代码时看到 slowOperations，就知道这里可能有性能代价。'''),

    (108, 'before', '''// 【`let body; bb0: switch (...)` —— switch 也被包进带标签的块】
//
//  因为三个 case 里有两个用到了提前计算的值（t1），
//  而 Compiler 要把「body 的最终值」提升到 switch 外面存进缓存。
//  带标签的块让它可以在每个 case 里直接 break bb0。
//
//  注意最后一个 case（advisor_redacted_result）**没有 break**，
//  因为它就是最后一个分支，落下去也出不了块。
//  这类细节在产物里到处都是，不构成 bug，但会让 diff 显得凌乱。
//
//  另一个细节：**没有 default**。这是故意的 ——
//  可辨识联合被穷尽后，编译器会要求所有成员都被处理；
//  如果哪天 SDK 加了新类型，这里会 typecheck 失败，而不是静默不渲染。
//  这正是 Message.tsx 外层 switch 的做法（见上一批）。'''),

    (126, 'before', '''// 【verbose 决定「给你看全文」还是「告诉你已经复核过了」】
//
//  非 verbose 是：`✓ Advisor has reviewed the conversation and will apply the feedback  ctrl+o`
//  verbose 是：整段顾问意见（dim 色）
//
//  这个模式在本目录反复出现（thinking 块、hook 进度、错误详情）：
//  **默认只给一句「发生了什么」，细节留在 verbose / Ctrl+O 后面。**
//
//  理由很实际：终端屏幕一次只显示四五十行，
//  一个顾问意见可能就占掉全部。默认展开等于把对话挤没了。'''),

    (149, 'before', '''// 【最后统一包 Box paddingRight={2} + MessageResponse】
//
//  注意前面三个分支各自算 body（不带外壳），最后才统一加外壳。
//  这样做的好处是：外壳只算一次，且缓存键只有一个 body。
//
//  如果每个分支各自包外壳，就会有三个几乎相同的 JSX 块，
//  Compiler 要为每个建一套槽 —— 产物会从 30 个槽涨到 45 个。
//
//  **「先算内容、后统一包装」是减少缓存槽的常用手段。**'''),
]
