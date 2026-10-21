# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// 【斜杠命令在历史里显示成 `/compact` 这样一行】
//
//  注意它显示的是**用户敲的原文**（命令名 + 参数），
//  而不是「命令做了什么」。命令的产出是另一条消息（走 local-command-stdout）。
//
//  这样分开是为了让用户能回看「我什么时候跑过什么」。
//  如果只显示结果，历史会变成一堆无法归因的输出。'''),

    (23, 'before', '''// 【isSkillFormat —— 同一个标签有两套显示方式】
//
//  老命令显示成 `/name args`；
//  Skill 显示成 `Skill(name)`，因为 skill 没有「命令行参数」这个概念，
//  硬套斜杠格式会显得像用户敲了 `/skill-name 一堆东西`。
//
//  注意第 39 行这一句：
//
//      const isSkillFormat = extractTag(text, 'skill-format') === 'true'
//
//  **它没有进缓存。** 而上面两个 extractTag 都进了（$[0] / $[2]）。
//
//  这不是疏漏：Compiler 只给「结果要跨渲染复用」的东西建槽。
//  前两个的结果要拼进 JSX（属于渲染输出），第三个只用来选分支，
//  每次重算一次正则扫描的代价小于维护一个槽。
//
//  所以产物里「有槽 / 没槽」反映的是**这个值怎么被使用**，
//  而不是「这个计算贵不贵」。'''),

    (43, 'before', '''// 【skill 分支独立成一条 return 路径，而不是在最后拼字符串时分支】
//
//  因为两种格式的 JSX 结构不同：
//
//      skill   <Text>{pointer}<Text>Skill(name)</Text></Text>
//      命令    <Text>{pointer}<Text>/name args</Text></Text>
//
//  外层 Box 完全一样（同样的 marginTop / backgroundColor / paddingRight），
//  但内层一个是固定格式、一个是拼字符串。
//
//  重复的外层 Box 没有被抽出来 —— 这是这个目录里常见的小重复，
//  换取的是「每条分支自己看得懂」。抽成公共壳反而要在两个地方传 children。'''),

    (71, 'before', '''// 【`[commandMessage, args].filter(Boolean).join(' ')` —— 用 filter 去掉可选参数】
//
//  如果用户只敲了 `/compact` 没带参数，args 是 null，
//  filter(Boolean) 把它滤掉，join 出来就是 "compact"。
//
//  这个写法比 `args ? name + ' ' + args : name` 短，也比模板字符串里的三元好读。
//  代价是**它会把空字符串和 0 也滤掉** —— 在这里安全（args 要么是非空串要么是 null），
//  但如果 args 可能是 "0"，就会静默丢失。
//
//  用 filter(Boolean) 之前要先想清楚数据里会不会有 falsy 但合法的值。'''),
]
