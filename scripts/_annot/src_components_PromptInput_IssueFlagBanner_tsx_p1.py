# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  IssueFlagBanner：一个「已经不存在的组件」的尸体
// ═══════════════════════════════════════════════════════════════
//
//  这是整个目录里最值得读的一份 —— 不是因为代码，而是因为它**泄露了打包过程**。
//
//  源码里只剩：
//
//      export function IssueFlagBanner() { return null; }
//
//  但文件头还 import 了 FLAG_ICON、Box、Text，而它们一个都没用到。
//  这个矛盾只有一种解释：**这里原本有 JSX，被构建工具在打包期删掉了**。
//
//  证据就在第 11 行的 sourceMappingURL 里 —— 那串 base64 解码后是原始源码：
//
//      if ("external" !== 'ant') {
//        return null
//      }
//      return (<Box flexDirection="row" marginTop={1} width="100%">…</Box>)
//
//  也就是说：条件被常量折叠了 → 整块 JSX 判定为不可达 → 删除 →
//  但 import 语句没被清掉（它们是副作用导入，工具不敢动）。
//
//  这就是「ANT-ONLY」的含义：只有内部（ant）构建才编译进去的功能。
//  对外构建里，它连字节都不存在 —— 比运行时 if 更彻底，也更难被逆向出来。'''),

    (2, 'before', '''// 【死 import 是「这里曾有过代码」的化石】
//
//  想判断一个 bundle 里哪些文件被功能开关砍过，最快的方法就是找这种
//  「导入了但从未使用」的符号：打包器只删逻辑、不删 import，
//  于是 import 列表成了删改前的快照。
//
//  对比第 37 行 PromptInputStashNotice —— 那里每个 import 都有用处，
//  说明它没被折叠。两种文件放在一起看，规律非常清楚。'''),

    (9, 'before', '''// 【`return null` + 无用 import = 被折叠的条件渲染】
//
//  看到这种组合，不要读成「这个组件故意什么都不渲染」。真实含义是：
//  在当前构建配置下，它**不该存在**。原始版本在 sourcemap 的 sourcesContent 里。
//
//  这也解释了一个常见困惑：为什么有的组件在界面上从来没见过？
//  因为它在你手上这个构建里根本没有渲染逻辑。
//
//  顺带一句：第 10 行返回 null 而不是返回 JSX 的空 Fragment，
//  是为了让调用方可以无条件 <IssueFlagBanner /> 而不产生任何布局节点。'''),

    (11, 'before', '''// 【这一行是唯一能看到「原来长什么样」的地方】
//
//  data:application/json;…;base64,… 是 sourcemap v3，解码后有三个关键字段：
//
//    sources        —— 原始文件名（IssueFlagBanner.tsx）
//    sourcesContent —— **原始源码全文**（未压缩、未折叠）
//    mappings       —— 压缩后每个字符对应原文件哪一行
//
//  所以读这类「泄露源码」的正确顺序是：先看代码 → 发现矛盾（死 import、
//  常量 false 分支）→ 去 sourcemap 的 sourcesContent 找真相。
//
//  本项目 scripts/annotate.py 会省略超长的 sourceMappingURL 行（默认 >4000 字符），
//  就是为了让批注版不至于被一坨 base64 淹没。'''),
]
