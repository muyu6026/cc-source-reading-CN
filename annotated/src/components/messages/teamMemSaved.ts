// ═══════════════════════════════════════════════════════════════
//  teamMemSaved：十九行，全篇只在解释一句「为什么它是函数不是组件」
// ═══════════════════════════════════════════════════════════════
//
//  注释（第 3-9 行）说的是一件很反直觉的事：
//
//    「写成一个普通函数，React Compiler 就不会把 teamCount 这个属性访问
//      提升去做 memo 比较。」
//
//  为什么怕它被提升？因为这是一个 **feature('TEAMMEM') 才会有** 的模块。
//  打包时会做 dead-code elimination：feature 为 false 时，整个文件被删掉。
//  但如果属性名 `teamCount` 被 Compiler 塞进某个缓存槽比较里，
//  `$[3] !== message.teamCount` 这行代码就活在了调用方 —— 属性名也就活着。
//
//  所以这里的取舍是：**放弃 memo 化，换取整个模块可以被彻底删干净。**
//  一句话：不是所有优化都值得做。
import type { SystemMemorySavedMessage } from '../../types/message.js'

/**
 * Returns the team-memory segment for the memory-saved UI, plus the count so
 * the caller can derive the private count without accessing teamCount itself.
 * Plain function (not a React component) so the React Compiler won't hoist
 * the teamCount property access for memoization. This module is only loaded
 * when feature('TEAMMEM') is true.
 */
// 【注释里那个 `This module is only loaded when feature('TEAMMEM')` 意味着什么】
//
//  也就是说，调用方写的一定是
//
//      feature('TEAMMEM') ? require('./teamMemSaved.js') : null
//
//  而不是顶部的静态 import。静态 import 会让模块图里始终有一条边，
//  即使整个文件被 DCE 掉，它的副作用分析也跑不掉。
//  用 require 放在三元里，feature 折叠成 false 之后那条线上什么都不剩。
//
//  这个写法在 messages/ 目录里出现了三次（teamMemSaved / teamMemCollapsed / SystemTextMessage），
//  每次都是为了同一个目的。
//
// 【返回 { segment, count } 而不是直接返回字符串，是为了让调用方算差值】
//
//  界面上要说「Saved 5 memories · 2 team memories」，
//  但 composer 只拿到了 writtenPaths（总条数）。
//  要拆出私有的那部分，就得知道团队占了几条：
//
//      privateCount = writtenPaths.length - team.count
//
//  如果这里只返回 "2 team memories" 这个字符串，调用方就得再解析一次数字。
//  返回结构化对象是「把解析留在产生端」的常规做法。
export function teamMemSavedPart(
  message: SystemMemorySavedMessage,
): { segment: string; count: number } | null {
// 【count === 0 返回 null，而不是返回空串】
//
//  差别在于调用方能不能区分「没有团队记忆」和「有 0 条团队记忆」。
//  这里选 null，于是调用方可以写
//
//      [privatePart, team?.segment].filter(Boolean)
//
//  一句就拼出「· 分隔的片段列表」。
//
//  统一约定：**可选的展示片段用 null 表示缺席，用 '' 表示「有内容但为空」**。
//  混用这两个会让 filter(Boolean) 这种写法失效。
  const count = message.teamCount ?? 0
  if (count === 0) return null
  return {
// 【单复数在这里手写了：`count === 1 ? 'memory' : 'memories'`】
//
//  同一个目录里既有手写单复数，也有调 utils/stringUtils 的 plural()。
//  手写的理由是这条文案要拼进模板字符串、并且只涉及一个词；
//  用 plural 反而要 import 一层。
//
//  读代码时不要把这当成不一致 —— **两套写法并存但都在用**，
//  改动时按就近原则跟着所在文件的写法走即可。
    segment: `${count} team ${count === 1 ? 'memory' : 'memories'}`,
    count,
  }
}
