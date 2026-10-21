# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  UserTeammateMessage：别的 agent 发来的消息
// ═══════════════════════════════════════════════════════════════
//
//  这是本批最像「调度器」的一个渲染器。它拿到一段文本（可能包含**多条**
//  <teammate-message> 标签），然后对每一条依次试六种解释：
//
//      1. plan approval 请求/回复     → 卡片
//      2. shutdown 请求/拒绝          → 卡片
//      3. task assignment            → 卡片
//      4. idle_notification          → 不显示
//      5. task_completed             → 一行「✓ Completed task #12」
//      6. 都不是                      → `@alice ▸ 摘要`（正文只在 transcript 里显示）
//
//  第 6 条是最常用的形态，也是最重要的一条 —— 它的「默认收起」决定了
//  团队协作时屏幕不会被同事的正文淹掉（见第 188 行）。
//
//  另外注意：这个文件**没有 _c**。不是遗漏 ——
//  主函数里一句 JSX 字面量都没有（全部在回调函数里），
//  Compiler 无从缓存。（前面 AdvisorMessage 那里解释过这条判据。）'''),

    (25, 'before', '''// 【一个正则同时抠出四个可选属性，且 color / summary 是可选的】
//
//      teammate_id="..."  (color="...")?  (summary="...")?  >正文</teammate-message>
//
//  写成「一个非捕获组可选、组内是空白加 color 属性」这种形式，
//  意味着两个属性**要么都按这个顺序出现，要么都不出现**。
//  也就是 `teammate_id` 必须在最前，color 在 summary 之前。
//
//  协议由写入方（mailbox 的 send 函数）保证。读的人要知道：
//  **这个正则不认识属性顺序变化**，一旦上游改了顺序，会静默匹配不到。'''),

    (34, 'before', '''// 【`text.matchAll` 的注释在解释一件很滑稽但真实的事】
//
//  原注释：`Use matchAll to find all matches (this is a RegExp method, not child_process)`
//
//  为什么需要这条注释？因为 `matchAll` 这个名字在 Node 里确实容易被
//  当成 shell 相关的东西（有人会怀疑是不是 `child_process.exec` 的别名）。
//  在一个「会执行命令」的产品代码里，任何看起来像 shell 的调用都值得一句澄清。
//
//  这类注释的读者其实不只是人 —— 也是给代码审查/静态分析看的：
//  **这一行不做任何 IO，不要把它当成执行点。**'''),

    (62, 'before', '''// 【过滤在渲染之前，而且过滤逻辑和「显示逻辑」是两套】
//
//  这里滤掉两类：
//      isShutdownApproved(content)          已批准的退出
//      parsed.type === 'teammate_terminated' 已终止
//
//  注释说明了原因：`avoid empty wrapper Box elements creating blank lines
//  between model turns`。
//
//  这句话点出了终端 UI 的一个真实问题：
//  **一个 Box 就算所有子元素都返回 null，它自己仍然占位。**
//  如果外层 <Box flexDirection="column"> 里塞了 5 个条目，
//  其中 3 个渲染成 null，屏幕上仍可能多出空行（取决于 margin 写明没有）。
//
//  所以在**进入渲染之前**就把它们滤掉，比在渲染里返回 null 更干净。
//  这和 nullRenderingAttachments.ts（CC-724）是同一个手法，
//  区别只在那边的清单是静态的、这里的判断要看内容。'''),

    (76, 'before', '''// 【全被滤掉就返回 null，而不是返回一个空 Box】
//
//  这是上一条的收尾：如果一条消息里的所有子消息都不显示，
//  **连外层容器也不要画**。
//
//  少了这一步，屏幕上会多出一条 marginTop 造成的空行 ——
//  而空行在终端里是「一个看不见的 bug」，测试也很难断言。'''),

    (84, 'before', '''// 【五级串联，顺序即优先级】
//
//  每一级都是「try 型函数」：是我的就返回节点，不是我的返回 null。
//  链式 try 的好处是新增类型只要插进链里，不用改既有判断。
//
//  危险也在这里：**两条内容都能匹配的模式，会永远被前面那个吃掉。**
//  比如 task assignment 的正文如果恰好也是合法 JSON 且带 plan 字段，
//  它会被第 85 行截走。
//
//  第 4、5 级（idle / task_completed）不是 try 函数，而是自己 jsonParse
//  一次再判 type —— 因为它们是「结构化 JSON」，不是 XML 标签。
//
//  注意 jsonParse 被调了两次（第 69 行过滤时一次、这里一次）：
//  过滤那一遍是为了提前知道要不要显示，这一遍是为了拿字段。
//  重复解析的代价被「每条消息一次」的规模兜住了。'''),

    (113, 'before', '''// 【idle_notification 直接返回 null：**它已经在第 62 行被判断过一次了**】
//
//  第 69-71 行过滤时：`parsed?.type === 'teammate_terminated'` 才滤掉，
//  idle_notification 不滤（所以它活着走到这里），到这里才 return null。
//
//  为什么两处不一致？因为过滤器只负责「整条消息要不要显示」，
//  而 idle 的判断要等到 `messages.length === 0` 之后才有意义 ——
//  如果一个 agent 只发了 idle，那整条消息应该整个消失；
//  如果它夹在别的消息中间，就单独消失。
//
//  用一句话概括：**过滤层管「全空」，渲染层管「这一条空」。**'''),

    (188, 'before', '''// 【默认只显示 `@名字 ▸ 摘要`，正文**只在 transcript 模式**下出现】
//
//      {isTranscriptMode && <Box paddingLeft={2}>…<Ansi>{content}</Ansi>…</Box>}
//
//  这是团队协作 UI 最关键的一条设计决定：
//  多个 agent 同时说话时，每一条正文都展开会把屏幕占满，
//  用户根本看不到自己关心的主线程输出。
//
//  所以默认只留「谁说了什么（摘要）」，完整内容在 Ctrl+O 的全历史里看。
//
//  这也解释了为什么 mailbox 消息都带 summary 字段：
//  **摘要是主路径的必需品，正文是可选展开。**'''),

    (188, 'after_block', '''//  ↑ 注意 <Ansi>{content}</Ansi>：这里把 ANSI 转义序列**渲染出来**，
//    而不是当纯文本显示。
//
//    为什么不直接用 Markdown？因为 agent 发来的内容可能是
//    它自己终端里的原始输出（带颜色的 diff、带高亮的 grep 结果）。
//    走 Markdown 会把那些转义序列当普通字符显示成一堆 `ESC[32m`。
//
//    Ansi 组件在 ink/ 目录里读过：它把字符串里的 ANSI 序列解析成样式段，
//    逐段渲染。这是「我收到的就是已经格式化好的东西」的场景，
//    对应地就不该再做一次格式化。'''),

    (159, 'before', '''// 【`@${displayName}${figures.pointer}` —— 名字 + 一个箭头】
//
//  figures.pointer 在大多数终端里是 ❯ 或 ›。
//  这个组合（`@alice ❯`）在屏幕上和助手消息的 `❯` 前缀形成呼应，
//  但方向相反：**助手是你，箭头指出去；同事是别人，箭头指向内容。**
//
//  这类符号的语义是这个 UI 里唯一的「图标系统」，
//  改动前要看一眼其他位置的用法（UserPromptMessage 用的是同一个 pointer）。'''),
]
