# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// 【Redacted thinking：模型思考过，但内容被安全策略抹掉了】
//
//  API 返回的 thinking 块有时只有签名没有正文（redacted_thinking）。
//  界面上既不能显示内容，也不该完全不提 —— 否则用户会觉得
//  「明明等了很久，怎么什么都没有」。
//
//  于是就是这一行：一个 dim + italic 的「✻ Thinking…」。
//  **只确认过程发生过，不透露任何内容。**'''),

    (12, 'before', '''// 【addMargin 的默认值是 false，写法是 `t1 === undefined ? false : t1`】
//
//  原始 TSX 里写的是解构默认值：
//
//      function AssistantRedactedThinkingMessage({ addMargin = false }: Props)
//
//  Compiler 把它拆成了「先取 t1，再判 undefined」两步。
//  这解释了读产物时最常遇到的一个疑问：
//  **为什么参数行里看不出默认值，却在函数体第一行冒出一个三元？**
//  那就是解构默认值的等价物，不是业务逻辑。'''),

    (15, 'before', '''// 【两个槽：0 存静态文本，1 存 marginTop 的值】
//
//  `marginTop={t2}` 里 t2 是 `addMargin ? 1 : 0` 的预先算好的结果 ——
//  Compiler 不会把三元表达式原样留在 JSX 里，而是提到外面算成数字。
//  好处是这个数字可以直接参与 `$[1] !== t2` 的比较（布尔也能比，但数字更稳）。
//
//  这类「把 prop 里的表达式提出来」是产物里最常见的形态变化之一，
//  读的时候把它还原回 addMargin ? 1 : 0 就对了。'''),
]
