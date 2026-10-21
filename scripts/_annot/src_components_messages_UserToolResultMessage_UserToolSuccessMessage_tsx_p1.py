# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  UserToolSuccessMessage：成功结果的渲染，以及两处「一次性读全局」
// ═══════════════════════════════════════════════════════════════
//
//  这个文件是整个子目录里唯一**没有被 React Compiler 改写**的
//  —— 它保留着原始的 TS + JSX，没有 _c / $ 槽。
//
//  为什么？产物里看不出来。已知的是这不是孤例（GroupedToolUseContent 也没有），
//  而那一个连 JSX 都没有 —— 所以不能总结成「有 JSX 就会被改写」。
//
//  对读代码的人来说，实际结论更简单：
//  **有 _c 的按槽读，没有的就当普通 React 代码读。** 不用纠结为什么。
//
//  内容上它有三处值得读：
//    1. 第 45-51 行：从全局 Map 里「取一次就删」（防内存增长）
//    2. 第 56-63 行：恢复旧会话时结果可能损坏，要校验（引了一个真实 issue）
//    3. 第 84 行：某些工具要跳过宽度约束（因为 Markdown 表格的边距）'''),

    (38, 'before', '''// 【hooks 写在 feature() 三元里的第二处（第一处是 UserPromptMessage）】
//
//  注释直接点名了先例：`same pattern as UserPromptMessage.tsx`。
//
//  这说明「feature 门控 hook」已经变成这个目录的**既成惯例**，
//  新代码是照着前一处抄的。惯例的形成方式是：一处写了详细注释，
//  后面几处只留一句指路。
//
//  对读代码的人的含义：**看到一句「same pattern as X」，就去 X 那里读细节**，
//  这类注释是有意为之的索引，不是偷懒。'''),

    (45, 'before', '''// ═══ 【这一段是「一次性读全局 Map」的标准写法】 ═══
//
//      const [classifierRule] = React.useState(() => getClassifierApproval(toolUseID))
//      const [yoloReason]    = React.useState(() => getYoloClassifierApproval(toolUseID))
//      React.useEffect(() => { deleteClassifierApproval(toolUseID) }, [toolUseID])
//
//  三件事，缺一不可：
//
//  1. **用 useState 的惰性初值而不是直接调用** ——
//     直接调用会在每次渲染时都去查 Map，而且拿到的是「当下」的值。
//     惰性初值保证「这个值是组件第一次渲染时那一刻的快照」。
//
//  2. **读一次就删** —— 这两个 Map 是「等待被消费的一次性数据」，
//     写进去的是权限判定过程，读出来就该清掉。
//     不清的话，一次会话里几千次工具调用会累积几千条记录。
//     注释写得很直白：`then delete from Map to prevent linear growth`。
//
//  3. **删除放在 effect 里而不是渲染期** ——
//     渲染期有副作用在并发模式下会被执行多次（甚至被丢弃后重放），
//     一次删除可能变成「删了但那次渲染被丢弃」，数据就丢了。
//     effect 是「提交之后只跑一次」的地方。
//
//  这三个细节合起来是一条完整的「一次性数据」处理流程。
//  任何一步写错，症状都是「偶尔显示不出自动批准的提示」——
//  因为值被提前消费或重复消费了。'''),

    (52, 'before', '''// 【`!message.toolUseResult || !tool` —— 两个都必须有】
//
//  toolUseResult 是「解析前的原始结果」，没有它就没东西可画。
//  tool 是「怎么画」，没有它也不知道怎么画。
//
//  注意这个早退在 hooks 之后（第 41、47、48 行的 hook 都在它前面）——
//  hooks 必须无条件执行，所以早退只能放在它们后面。
//
//  这也是为什么这个文件前 50 行看起来「什么都还没做就先读了三个全局状态」：
//  **顺序是被 hooks 规则逼出来的，不是作者的组织偏好。**'''),

    (60, 'before', '''// ═══ 【这一段注释引了一个真实的 GitHub issue（#39817）】 ═══
//
//      // Resumed transcripts deserialize toolUseResult via raw JSON.parse with no
//      // validation (parseJSONL). A partial/corrupt/old-format result crashes
//      // renderToolResultMessage on first field access (anthropics/claude-code#39817).
//
//  翻译：恢复历史会话时，toolUseResult 是用裸 JSON.parse 反序列化的，
//  没有任何校验。一个字段缺失、格式老化的结果会在**第一次访问字段时**
//  直接崩掉整个渲染。
//
//  解法：先过一遍 outputSchema.safeParse，失败就不画。
//
//      const parsedOutput = tool.outputSchema?.safeParse(message.toolUseResult)
//      if (parsedOutput && !parsedOutput.success) return null
//      const toolResult = parsedOutput?.data ?? message.toolUseResult
//
//  三个细节都值得看：
//
//    · `parsedOutput &&` —— 工具可能没有 outputSchema，
//      那就跳过校验（`undefined && …` 为假）。
//    · 校验失败 → **整条消息不显示**。不是显示「[结果格式不支持]」，
//      因为那对用户毫无意义。
//    · 校验成功 → 用 `parsedOutput.data`（**解析后的**），
//      而不是原始值。这样下游拿到的是经过 schema 处理的干净数据
//      （zod 会做默认值填充、类型转换）。
//
//  末尾那句 `mirrors CollapsedReadSearchContent` 说明这个修法在另一处也用了 ——
//  **同一个 bug 的两个入口，用了同一种防御。**'''),

    (84, 'before', '''// 【`userFacingName(undefined) === ''` 的工具要跳过宽度约束】
//
//  注释：`Tools that return '' from userFacingName opt out of tool chrome and
//  render like plain assistant text. Skip the tool-result width constraint so
//  MarkdownTable's SAFETY_MARGIN=4 (tuned for the assistant-text 2-col dot gutter)
//  holds — otherwise tables wrap their box-drawing chars.`
//
//  翻译：
//  · 有些工具刻意不显示自己的名字（userFacingName 返回空串），
//    它们的效果就是「普通助手文本」。
//  · 表格渲染器（MarkdownTable）有一个 SAFETY_MARGIN = 4，
//    这个数字是**按助手文本的布局**（左边 2 格圆点 + 2 格空白）调出来的。
//  · 如果给这些工具套上 width 约束，可用宽度会比表格预期少 4 格，
//    表格的边框字符（│ ─ ┌）就会折行 —— 屏幕上的表格会碎掉。
//
//  所以这里直接不传 width：
//
//      width={rendersAsAssistantText ? undefined : width}
//
//  这一处极好地说明了终端 UI 的一个特点：
//  **宽度是一个要被逐层精确计算的契约，任何一层多减去几格，下游的排版就崩。**
//  那个 SAFETY_MARGIN=4 的耦合，是这份代码里最难发现的隐式依赖之一。'''),

    (88, 'before', '''// 【两个 feature 门控的附加提示，各自一行】
//
//      BASH_CLASSIFIER         ✓ Auto-approved · matched "…"
//      TRANSCRIPT_CLASSIFIER   Allowed by auto mode classifier
//
//  它们显示的是「这次调用为什么被自动放行了」——
//  对用户来说这是**信任边界上的信息**：模型自己决定跑了一个命令，
//  你得能知道它是怎么被批准的。
//
//  注意两者都是 `{feature(…) ? cond && <MessageResponse>… : null}` 的形状：
//  feature 在外层（编译期），条件是内层（运行期）。
//  写成这样是为了让外部构建里整块消失，连字符串都不留。'''),

    (99, 'before', '''// 【PostToolUse hook 的进度放在结果下面，包在 SentryErrorBoundary 里】
//
//  和 AssistantToolUseMessage 里那个 PreToolUse 完全对称：
//  调用前一行、结果后一行。
//
//  包 ErrorBoundary 的理由也一样：**hook 显示坏了不能影响工具结果的显示**。
//  hook 是用户自己配的（甚至可能是第三方脚本），它的状态是最不可信的一环。
//
//  注意这里 hook 显示在 Box 的外面（和结果并列，不是嵌套）——
//  因为它属于「这一次调用的尾声」，不是一个附属细节。'''),
]
