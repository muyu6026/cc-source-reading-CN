// ═══════════════════════════════════════════════════════════════
//  搜索高亮：在屏幕缓冲上「翻一翻」格子
// ═══════════════════════════════════════════════════════════════
//
//  跟选区高亮是同一套机制：**渲染完之后**，直接改 Screen 里格子的
//  styleId（换成一个「反显版」的 styleId），然后靠 damage 跟踪让
//  下一帧的 diff 自然发现这些格子变了。
//
//  这个「事后改缓冲」的做法最大的好处是：`LogUpdate` 保持成一个
//  纯粹的「两帧比较器」，完全不知道有搜索这回事。代价是调用方必须
//  把「缓冲被改过」这件事传下去（`prevFrameContaminated`）——
//  否则下一帧从这块缓冲 blit 回来的像素里会带着反显。
//
//  只做反显，不做「当前匹配」的高亮 —— 那是 applyPositionedHighlight
//  （render-to-screen.ts）的事，画的是黄底。分两层。
import {
  CellWidth,
  cellAtIndex,
  type Screen,
  type StylePool,
  setCellStyleId,
} from './screen.js'

/**
 * Highlight all visible occurrences of `query` in the screen buffer by
 * inverting cell styles (SGR 7). Post-render, same damage-tracking machinery
 * as applySelectionOverlay — the diff picks up highlighted cells as ordinary
 * changes, LogUpdate stays a pure diff engine.
 *
 * Case-insensitive. Handles wide characters (CJK, emoji) by building a
 * col-of-char map per row — the Nth character isn't at col N when wide chars
 * are present (each occupies 2 cells: head + SpacerTail).
 *
 * This ONLY inverts — there is no "current match" logic here. The yellow
 * current-match overlay is handled separately by applyPositionedHighlight
 * (render-to-screen.ts), which writes on top using positions scanned from
 * the target message's DOM subtree.
 *
 * Returns true if any match was highlighted (damage gate — caller forces
 * full-frame damage when true).
 */
// 返回 boolean 而不是「void + 有没有改」的计数。这个 boolean 是
// **damage 闸门**：有匹配 → 调用方强制整帧 damage。
//
// 为什么要整帧 damage 而不是精确到格子：反显可能落在任何一行，
// 而 damage 是按矩形合并的（`unionRect`）。一屏里散落的匹配会合并成
// 「几乎整屏」的矩形，那还不如直接标整帧 —— 省掉矩形合并的开销。
//
// 代价是：只要搜索框里有字，每帧都是全量重绘。这在高频路径上
// 很贵，但搜索是**用户主动进入的模式**，此时通常没有流式输出。
export function applySearchHighlight(
  screen: Screen,
  query: string,
  stylePool: StylePool,
): boolean {
  if (!query) return false
  const lq = query.toLowerCase()
  const qlen = lq.length
  const w = screen.width
  const noSelect = screen.noSelect
  const height = screen.height

  let applied = false
// 逐行处理。每行重建一次文本 + 两张映射表，然后在这行的文本上
// 找匹配 —— 于是匹配不会跨行。
//
// 这是个刻意的限制：跨行匹配（一行结尾 + 下一行开头）在终端 UI 里
// 几乎总是「不该匹配」，因为那是折行造成的，不是用户想找的内容。
// 同时它也让实现简单得多（不用管软换行的接续）。
  for (let row = 0; row < height; row++) {
    const rowOff = row * w
// 这段「构建行文本」是**第二份**（第一份在 render-to-screen.ts 的
// scanPositions 里）。两处必须完全一致，否则会出现「扫描说这里
// 有匹配、上色时跳过这个格子」的错位。
//
// 三处跳过条件的理由（原文已列），补一个容易忽略的：
//   SpacerHead 是「宽字符折行时行尾的补白」。它不是内容，但它**占
//   一格**。不跳过的话，匹配可能落在这一格上、而上色时这一格又被
//   当成填充处理掉。
//
// 而 `noSelect` 是「行号、⎿ 之类的装饰」。搜索的目标是内容，
// 装饰不该被匹配 —— 但同时它对选区也是排除的，两套逻辑共用同一个
// 标记，保证「能复制的东西」和「能搜的东西」是同一个集合。
// 逐字符小写（`cell.char.toLowerCase()`），不是整串小写。这一条
// 原文解释得很到位，这里只补一句为什么它值得单独写：
//
// 土耳其语 İ（U+0130）小写化后是 **两个** code unit（i + U+0307）。
// 所以「整串小写再 indexOf」得到的位置，跟「逐字符小写同时记映射表」
// 得到的位置，会从那个字符开始就差一位。
//
// 这个 bug 只在含土耳其语文本时出现 —— 而它出现时表现为「高亮
// 整体偏了一个字符」，极难归因到「大小写转换改变了字符串长度」。
    // Build row text (already lowercased) + code-unit→cell-index map.
    // Three skip conditions, all aligned with setCellStyleId /
    // extractRowText (selection.ts):
    //   - SpacerTail: 2nd cell of a wide char, no char of its own
    //   - SpacerHead: end-of-line padding when a wide char wraps
    //   - noSelect: gutters (⎿, line numbers) — same exclusion as
    //     applySelectionOverlay. "Highlight what you see" still holds for
    //     content; gutters aren't search targets.
    // Lowercasing per-char (not on the joined string at the end) means
    // codeUnitToCell maps positions in the LOWERCASED text — U+0130
    // (Turkish İ) lowercases to 2 code units, so lowering the joined
    // string would desync indexOf positions from the map.
    let text = ''
    const colOf: number[] = []
    const codeUnitToCell: number[] = []
    for (let col = 0; col < w; col++) {
      const idx = rowOff + col
      const cell = cellAtIndex(screen, idx)
      if (
        cell.width === CellWidth.SpacerTail ||
        cell.width === CellWidth.SpacerHead ||
        noSelect[idx] === 1
      ) {
        continue
      }
      const lc = cell.char.toLowerCase()
      const cellIdx = colOf.length
      for (let i = 0; i < lc.length; i++) {
        codeUnitToCell.push(cellIdx)
      }
      text += lc
      colOf.push(col)
    }

// 非重叠前进。理由跟 scanPositions 里一样（`'aaa'` 搜 `'aa'`），
// 但这里多一层：重复反显不只是浪费 —— `withInverse` 虽然幂等，
// 但**每次都要走一遍 StylePool 的 intern**（算哈希、查表）。
// 重复匹配多的时候这是实打实的开销。
    let pos = text.indexOf(lq)
    while (pos >= 0) {
      applied = true
      const startCi = codeUnitToCell[pos]!
      const endCi = codeUnitToCell[pos + qlen - 1]!
      for (let ci = startCi; ci <= endCi; ci++) {
        const col = colOf[ci]!
        const cell = cellAtIndex(screen, rowOff + col)
// 上色的粒度是**每个 cell**：从 startCi 到 endCi 逐格改。
//
// 注意这里用 `colOf[ci]` 把 cell 下标转回列号 —— 因为宽字符会跳过
// 一格（SpacerTail 被 continue 掉了），所以第 N 个 cell 不一定在
// 第 N 列。
//
// 一个副作用：宽字符的**两个**格子都会被反显（因为循环按 cell 走，
// 而宽字符占两个 cell 但只有第一个进了 colOf？）—— 实际上是：
// SpacerTail 不进 colOf，所以宽字符只上色头部那一格。
// 而终端会在反显的风格下重绘整个宽字符，视觉上是对的。
        setCellStyleId(screen, col, row, stylePool.withInverse(cell.styleId))
      }
      // Non-overlapping advance (less/vim/grep/Ctrl+F). pos+1 would find
      // 'aa' at 0 AND 1 in 'aaa' → double-invert cell 1.
      pos = text.indexOf(lq, pos + qlen)
    }
  }

  return applied
// 返回 `applied` 而不是「改了多少格」。原因在文档注释里：调用方
// 只需要知道「要不要强制整帧 damage」，不需要数量。
//
// 这是「返回布尔而不是计数」的一个好例子：**如果没人用这个数，
// 算它就是纯粹的浪费**。而且算它需要多一次累加、多一个分支。
}
