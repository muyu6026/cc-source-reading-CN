# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// 【UserBashOutputMessage：`!ls` 这类 bash 模式的输出怎么显示】
//
//  它做的事只有三件：
//    1. 从 XML 包装里抠出 stdout / stderr
//    2. 如果 stdout 还套着一层 <persisted-output>，再剥一层
//    3. 交给 BashTool 自己的结果渲染器（BashToolResultMessage）
//
//  第 3 步是关键：**这里不自己画输出**。
//  `!ls` 的输出和模型跑 `Bash` 工具的输出，在屏幕上是同一种东西，
//  所以复用同一个渲染器 —— 折叠、行数统计、颜色都在那边。'''),

    (13, 'before', '''// 【两层包装，注释解释了第二层的存在理由】
//
//  内层 <persisted-output> 出现在「输出太大、被写到临时文件」的时候：
//
//      <bash-stdout><persisted-output>文件路径 + 前几行预览</persisted-output></bash-stdout>
//
//  为什么要剥掉标签、只留内容？注释的原话是
//  「the wrapper tag itself is model-facing signaling」——
//  这个标签是给**模型**看的信号（告诉它「输出存到文件了，别指望全文」），
//  对用户没意义。用户只需要知道「东西在哪、大概长什么样」。
//
//  这就是「同一份数据两个读者」的第二次出现（第一次是 nullRenderingAttachments）：
//  协议层的标记对一方是信息，对另一方是噪音。'''),

    (21, 'before', '''// 【两次 extractTag 被塞进同一个缓存槽，依赖只有 content】
//
//  $[0] 存的是「上次算的时候 content 是什么」，$[1] 存的是最终结果。
//  中间那两步（先抠 bash-stdout、再抠 persisted-output）对外不可见 ——
//  Compiler 只按**输入**建依赖，不按中间变量。
//
//  所以读产物时要注意：一个槽里可能藏着任意多步计算。
//  想知道「这段到底算了什么」，得看 `$[n] !== x` 里的 x，
//  以及 if 分支体里从 x 到结果的全部语句。'''),

    (31, 'before', '''// 【这里多建了一个 { stdout, stderr } 对象，仅仅是为了当 prop 传】
//
//  下游 BashToolResultMessage 的签名收的是一个 content 对象。
//  每次都新建一个对象意味着：只要走到这里，下游的 memo 就会失效一次。
//
//  但注意它的缓存键是 `$[4] !== stderr || $[5] !== stdout` ——
//  **两个字符串都没变时，复用上次那个对象**。
//  这就是「传对象」和「不破坏 memo」之间的折中：
//  对象字面量被 Compiler 缓存了，引用因此稳定。
//
//  如果没有这层缓存，每帧一个新对象，下游每帧重渲染。'''),

    (42, 'before', '''// 【`!!verbose` 而不是 verbose】
//
//  verbose 的类型是 `boolean | undefined`，而下游要的是 boolean。
//  `!!` 把 undefined 折成 false。
//
//  产物里这类「把可选 prop 折成布尔」的三元/双叹号到处都是（t4 = !!verbose），
//  它们不是业务逻辑，是类型收敛。'''),
]
