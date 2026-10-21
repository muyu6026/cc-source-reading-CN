// ═══════════════════════════════════════════════════════════════
//  optimize：把 diff 里的「相邻同族操作」合成一条
// ═══════════════════════════════════════════════════════════════
//
//  调用点两处（`ink.tsx:621` 和 `ink.tsx:1470`），都是「diff 算完之后、
//  写终端之前」。位置说明它是**纯字符串层**的最后一道：
//  log-update 负责「哪些格子变了」，这里负责「这些变更能压成多短的
//  一串字节」。
//
//  三条规则背后的依据各不相同，值得分开记：
//
//  1. **cursorMove 可以相加** —— 它是相对的（`CSI n A`），两次相对移动
//     等于一次合位移。
//  2. **cursorTo 只能留最后一条** —— 它是绝对的（`CSI n G`），第二条
//     直接覆盖第一条的效果，前面那条纯属白写。
//  3. **styleStr 一条都不能丢** —— 它是**转移**（transition）而不是
//     **设置**（setter）。这一条原文注释已经讲了后果（BCE 泄漏），
//     但没讲原因：因为 `StylePool.transition(from, to)` 生成的是
//     「从 from 变到 to 需要发哪些码」，两条转移串起来才等于
//     「先变到中间态、再变到终态」。丢掉第一条，中间态那次复位就丢了，
//     而终态那条只声明自己要改的位 —— 没改的位保持「上一条转移之后
//     的样子」，于是错了。
//
//  同样是「相邻合并」，三条规则三种合并方式（相加 / 取后者 / 拼接），
//  区别全在于这个操作是**相对**、**绝对**还是**增量**。
import type { Diff } from './frame.js'

/**
 * Optimize a diff by applying all optimization rules in a single pass.
 * This reduces the number of patches that need to be written to the terminal.
 *
 * Rules applied:
 * - Remove empty stdout patches
 * - Merge consecutive cursorMove patches
 * - Remove no-op cursorMove (0,0) patches
 * - Concat adjacent style patches (transition diffs — can't drop either)
 * - Dedupe consecutive hyperlinks with same URI
 * - Cancel cursor hide/show pairs
 * - Remove clear patches with count 0
 */
// 入口。注意这是**单趟**：每个 patch 只看「结果数组的尾巴」。
//
// 单趟是刻意的，不是偷懒。多趟能做的事这里都不需要 —— 因为 diff 的
// 顺序本身就是屏幕扫描顺序（从上到下、从左到右），能合并的东西必然
// 相邻。反过来说，如果真有「隔了三条还能抵消」的情况，那说明
// diff 生成得不对，不该在这里补救。
export function optimize(diff: Diff): Diff {
  if (diff.length <= 1) {
// 长度 <= 1 连循环都没必要进。这一句省的是**一次数组分配 + 一次遍历**，
// 而首帧之后「只有光标闪」的帧动辄几十个 patch，所以这条早退在
// 稳定态下命中率其实不高 —— 它主要在首帧（diff 为空或一条）生效。
    return diff
  }

  const result: Diff = []
  let len = 0

  for (const patch of diff) {
    const type = patch.type

    // Skip no-ops
// 三类「零效果」操作先剔掉。注意它们各自的「零」不一样：
//   stdout 空字符串   —— 写了等于没写
//   cursorMove (0,0)  —— 移了等于没移
//   clear count 0     —— 要删 0 行
//
// 这三条必须在**合并之前**判。反过来的话，一个空 stdout 会把前后两条
// styleStr 隔开、导致它们合并不上 —— 于是白白多写一条转义。
    if (type === 'stdout') {
      if (patch.content === '') continue
    } else if (type === 'cursorMove') {
      if (patch.x === 0 && patch.y === 0) continue
    } else if (type === 'clear') {
      if (patch.count === 0) continue
    }

    // Try to merge with previous patch
    if (len > 0) {
      const lastIdx = len - 1
      const last = result[lastIdx]!
      const lastType = last.type

      // Merge consecutive cursorMove
      if (type === 'cursorMove' && lastType === 'cursorMove') {
        result[lastIdx] = {
          type: 'cursorMove',
          x: last.x + patch.x,
          y: last.y + patch.y,
        }
        continue
      }

      // Collapse consecutive cursorTo (only the last one matters)
      if (type === 'cursorTo' && lastType === 'cursorTo') {
        result[lastIdx] = patch
        continue
      }

// 这段是整份文件最该读的一条注释：**转移型操作的合并只能是拼接**。
//
// 注释里那个例子值得展开：`[ESC[49m, ESC[2m]`。
//   第一条：取消背景色（49）
//   第二条：降低亮度（2）
// 看上去第二条跟背景毫无关系，丢了应该没事 —— 但如果丢了第一条，
// 背景色会一直保持到下一个 `ESC[2J`（清屏）或 `ESC[2K`（清行）。
// 而这两个操作在**有背景色的终端**上会用当前背景色填充新区域（BCE，
// Background Color Erase），于是整片屏幕被涂成上一个 cell 的背景色。
//
// 所以「这条转移不改变我关心的位」不能作为丢弃理由，因为**下一条
// 转移不负责复位**。拼接是唯一安全的合并。
      // Concat adjacent style patches. styleStr is a transition diff
      // (computed by diffAnsiCodes(from, to)), not a setter — dropping
      // the first is only sound if its undo-codes are a subset of the
      // second's, which is NOT guaranteed. e.g. [\e[49m, \e[2m]: dropping
      // the bg reset leaks it into the next \e[2J/\e[2K via BCE.
      if (type === 'styleStr' && lastType === 'styleStr') {
        result[lastIdx] = { type: 'styleStr', str: last.str + patch.str }
        continue
      }

// 超链接去重：`ES[8;;...]` 是幂等的（连续两次开同一个 URI 等于一次）。
// 跟 styleStr 正好相反 —— 那边是转移（不能丢），这边是设置（可去重）。
//
// 同一个 `link()` 调用里其实是一次「关 + 开」，所以相邻两条同 URI 的
// hyperlink patch 意味着「关了又开」，视觉上等价于一直开着。
      // Dedupe hyperlinks
      if (
        type === 'hyperlink' &&
        lastType === 'hyperlink' &&
        patch.uri === last.uri
      ) {
        continue
      }

// 隐藏/显示光标互相抵消。这里用 `result.pop()` 而不是「标个删除位」，
// 于是 len 要手动减一 —— 这是本文件唯一手工维护长度的地方，其余
// 分支都是 `result[lastIdx] = xxx` 或 `result.push`。
//
// 抵消是安全的，因为这一对**必须相邻**才进来。如果中间隔了一个
// cursorMove，那 hide→move→show 和 hide→show→move 效果不同
// （后者是在旧位置显示再移动，前者是先移再显示），不能抵消。
      // Cancel cursor hide/show pairs
      if (
        (type === 'cursorShow' && lastType === 'cursorHide') ||
        (type === 'cursorHide' && lastType === 'cursorShow')
      ) {
        result.pop()
        len--
        continue
      }
    }

    result.push(patch)
// 全文件唯一 push 出口。所有分支走到这里，说明「既不是空操作，
// 也合并不上」，只能留着。
    len++
  }

  return result
}
