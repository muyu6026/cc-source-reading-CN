// ═══════════════════════════════════════════════════════════════
//  边框：这一层最后一件「按字符串画」的东西
// ═══════════════════════════════════════════════════════════════
//
//  其它一切都已经改成「往屏幕缓冲写格子」了，只有边框还保持着
//  Ink 早期的做法：**拼一条字符串，然后整条交给 `Output.write`**。
//
//  这不是没改完。边框天生就是「一条由同一个字符重复而成的线」，
//  拼字符串比逐格写便宜得多（一次 write 操作 vs width 次写格子），
//  而且它不吃子节点的裁剪逻辑 —— 边框本来就该盖在子节点上面
//  （调用点在 `render-node-to-output.ts` 里，**在子节点之后**：
//  子节点缩小时会清掉自己原来的区域，可能正好压在父节点的边框上）。
//
//  代价是这一层必须自己保证「字符串的视觉宽度 == 布局宽度」。
//  下面第 42 行起有几处隐含假设，其中一处是真的会出错。
import chalk from 'chalk'
import cliBoxes, { type Boxes, type BoxStyle } from 'cli-boxes'
import { applyColor } from './colorize.js'
import type { DOMNode } from './dom.js'
import type Output from './output.js'
import { stringWidth } from './stringWidth.js'
import type { Color } from './styles.js'

// borderText 是「在边框线上挖个洞放一段文字」—— 用来做那种
// `╭─ 会话历史 ──────────╮` 的标题边框。
//
// `content` 是**已经上过色的字符串**（带 SGR），不是纯文本。
// 这一点很重要：它决定了下面裁剪只能按码元切，不能按可见字符切 ——
// 见第 45 行那个分支。
export type BorderTextOptions = {
  content: string // Pre-rendered string with ANSI color codes
  position: 'top' | 'bottom'
  align: 'start' | 'end' | 'center'
  offset?: number // Only used with 'start' or 'end' alignment. Number of characters from the edge.
}

// 只有一个自定义样式，而且四个角是**空格**。
// 原因注释里写了：Unicode 的制表符区（U+2500 段）没有「虚线的角」。
// 用 '╭' 会显得实线，用 ' ' 至少不破坏虚线的观感 —— 这是诚实的妥协，
// 不是遗漏。
//
// `as const` 让 `'dashed'` 这个键在类型层面参与 `keyof typeof`，
// 于是 `borderStyle` 的联合类型自动包含它，不需要第二处登记。
export const CUSTOM_BORDER_STYLES = {
  dashed: {
    top: '╌',
    left: '╎',
    right: '╎',
    bottom: '╌',
    // there aren't any line-drawing characters for dashes unfortunately
    topLeft: ' ',
    topRight: ' ',
    bottomLeft: ' ',
    bottomRight: ' ',
  },
} as const

export type BorderStyle =
  | keyof Boxes
  | keyof typeof CUSTOM_BORDER_STYLES
  | BoxStyle

// 返回三元组 [前段, 文字, 后段] 而不是一整条，是因为三段要分别上色：
// 前后段是边框色，文字保留自己的颜色。拼成一条再上色会把文字染色。
function embedTextInBorder(
  borderLine: string,
  text: string,
  align: 'start' | 'end' | 'center',
  offset: number = 0,
  borderChar: string,
): [before: string, text: string, after: string] {
// 【这里有个不对称，值得记住】
//
//   `textLength` 用 `stringWidth`（**显示宽度**，会剥掉 ANSI 转义），
//   `borderLength` 用 `.length`（**UTF-16 码元数**）。
//
//   对内置的盒线字符两者相等（都是 1 码元 1 格），所以一直没出问题。
//   但这个等式只在 `borderLine` 由盒线字符组成时成立 ——
//   一旦有宽字符或多码元字符（某些终端字体、某些自定义样式），
//   后面所有的 `position` 计算都会偏。判据混用宽度语义，
//   是这一层留下的一个隐患。
  const textLength = stringWidth(text)
  const borderLength = borderLine.length

// 【这一支会真的出错，两个原因】
//
//   1) `substring(0, borderLength)` 按**码元**截断，可能把一个代理对
//      （emoji）切成两半，也可能把一个宽字符截成一个乱码。
//
//   2) 更严重：`content` 是**已上色的字符串**。按码元截断时不认识 SGR，
//      很容易把 `ESC [ 3 8 ; 5 ; 1 9 6 m` 切在中间 —— 于是漏出半个转义序列。
//      终端遇到不完整的 CSI 会把它当参数累积，等着后续字节；
//      后面写上去的每一个字符都可能被当成参数吞掉，表现是**整屏着色错乱**，
//      而且下一次重绘之前不会自愈。
//
//   正确做法是像 `output.ts` 里那样用 `sliceAnsi`（按可见宽度切、并保证
//   SGR 闭合）。这里没这么做，是因为走这一支的条件是「文字几乎占满整条边」——
//   实际调用方（`PromptInput` 的边框标题）永远比边框短。
//   换句话说：这是**靠调用方保证不了才不出问题的**代码。
//
//   顺带一个副作用：这一支把两个角字符整个丢掉了（`before` / `after` 都是空串），
//   所以文字撑满时边框角落会消失。
  if (textLength >= borderLength - 2) {
    return ['', text.substring(0, borderLength), '']
  }

// 三种对齐的定位规则，各差一个角字符：
//   · center 用 `floor` —— 奇数余量时偏左一格。这是有意的（视觉重心偏左更稳）
//   · start 是 `offset + 1`，`+1` 让出左上角
//   · end 是 `borderLength - textLength - offset - 1`，`-1` 让出右上角
//
// offset 只在 start/end 下有意义（见类型定义），center 时被忽略 ——
// 类型上不是必选/互斥，所以传了也不会报错，只会静默无效。
  let position: number
  if (align === 'center') {
    position = Math.floor((borderLength - textLength) / 2)
  } else if (align === 'start') {
    position = offset + 1 // +1 to account for corner character
  } else {
    // align === 'end'
    position = borderLength - textLength - offset - 1 // -1 for corner character
  }

// clamp 的下界是 1（保证至少留一个角），上界保证文字右侧至少留一个格子。
// 上界在 `textLength < borderLength - 2` 时不会触发 —— 这个函数的前置条件
// 已经保证过了，所以这一句主要是给「调用方传了离谱 offset」兜底。
  // Ensure position is valid
  position = Math.max(1, Math.min(position, borderLength - textLength - 1))

  const before = borderLine.substring(0, 1) + borderChar.repeat(position - 1)
  const after =
    borderChar.repeat(borderLength - position - textLength - 1) +
    borderLine.substring(borderLength - 1)

  return [before, text, after]
}

// 先上色再 dim：两条 SGR 是不同属性（颜色 vs 强度），互不覆盖，
// 顺序不重要，但必须各自闭合 —— 交给 chalk 处理，
// 它对「已经是字符串的 SGR」只负责追加，不会再解析一遍。
function styleBorderLine(
  line: string,
  color: Color | undefined,
  dim: boolean | undefined,
): string {
  let styled = applyColor(line, color)
  if (dim) {
    styled = chalk.dim(styled)
  }
  return styled
}

// 宽高从 yoga 取，`Math.floor` 是因为 yoga 返回浮点。
// 向下取整而不是四舍五入：宁可少画一格，也不要画出屏幕外 ——
// 越界的那一格会被 write 的裁剪逻辑直接丢掉，但会让边框看上去缺角。
const renderBorder = (
  x: number,
  y: number,
  node: DOMNode,
  output: Output,
): void => {
  if (node.style.borderStyle) {
    const width = Math.floor(node.yogaNode!.getComputedWidth())
    const height = Math.floor(node.yogaNode!.getComputedHeight())
// `borderStyle` 有三种形态，优先级从上到下：
//   1) 自定义名（`'dashed'`）—— 查本文件那张小表，查不到再当 cli-boxes 的键
//   2) cli-boxes 的名字（`'round'` / `'single'` / `'bold'` …）
//   3) 直接传一个 `BoxStyle` 对象（八个字符串自己给）
//
// `?? cliBoxes[...]` 那一句让 1 和 2 共用一个入口 —— 自定义表是「覆盖」，
// 不是「另一套」。所以将来加自定义样式不需要改这里的判断。
    const box =
      typeof node.style.borderStyle === 'string'
        ? (CUSTOM_BORDER_STYLES[
            node.style.borderStyle as keyof typeof CUSTOM_BORDER_STYLES
          ] ?? cliBoxes[node.style.borderStyle as keyof Boxes])
        : node.style.borderStyle

    const topBorderColor = node.style.borderTopColor ?? node.style.borderColor
    const bottomBorderColor =
      node.style.borderBottomColor ?? node.style.borderColor
    const leftBorderColor = node.style.borderLeftColor ?? node.style.borderColor
    const rightBorderColor =
      node.style.borderRightColor ?? node.style.borderColor

    const dimTopBorderColor =
      node.style.borderTopDimColor ?? node.style.borderDimColor

    const dimBottomBorderColor =
      node.style.borderBottomDimColor ?? node.style.borderDimColor

    const dimLeftBorderColor =
      node.style.borderLeftDimColor ?? node.style.borderDimColor

    const dimRightBorderColor =
      node.style.borderRightDimColor ?? node.style.borderDimColor

// 四条边**各自**可以关（`borderTop={false}` 之类），默认全开。
// 注意这里取的是 `!== false`：`undefined` 也算开，只有显式 false 才关。
//
// 关掉一条边时，角字符也跟着消失 —— 角是拼在上下边那行字符串里的
// （`showLeftBorder ? box.topLeft : ''`），所以角的存在完全由两侧开关决定。
// 这也是「按字符串画」的直接后果：没法单独画一个角，只能画一整行。
    const showTopBorder = node.style.borderTop !== false
    const showBottomBorder = node.style.borderBottom !== false
    const showLeftBorder = node.style.borderLeft !== false
    const showRightBorder = node.style.borderRight !== false

// 内容宽度 = 总宽减去左右边框各一格。`Math.max(0, ...)` 防的是
// 「宽度为 1 却要求画双边」——那样会算出 -1，`repeat(-1)` 直接抛 RangeError。
    const contentWidth = Math.max(
      0,
      width - (showLeftBorder ? 1 : 0) - (showRightBorder ? 1 : 0),
    )

    const topBorderLine = showTopBorder
      ? (showLeftBorder ? box.topLeft : '') +
        box.top.repeat(contentWidth) +
        (showRightBorder ? box.topRight : '')
      : ''

// 有 borderText 时走 `embedTextInBorder`，前段/文字/后段分别上色。
// 注意只有**上下边**能放文字（横向的线才有空间），左右边没有对应分支。
    // Handle text in top border
    let topBorder: string | undefined
    if (showTopBorder && node.style.borderText?.position === 'top') {
      const [before, text, after] = embedTextInBorder(
        topBorderLine,
        node.style.borderText.content,
        node.style.borderText.align,
        node.style.borderText.offset,
        box.top,
      )
      topBorder =
        styleBorderLine(before, topBorderColor, dimTopBorderColor) +
        text +
        styleBorderLine(after, topBorderColor, dimTopBorderColor)
    } else if (showTopBorder) {
      topBorder = styleBorderLine(
        topBorderLine,
        topBorderColor,
        dimTopBorderColor,
      )
    }

// 竖边高度 = 总高减去上下边（各一格），再 max(0) 兜底。
// 注意这里没有减「文字占的行」——borderText 只吃掉边框那一行本身，
// 不占内容区，所以高度计算里不需要管它。
    let verticalBorderHeight = height

    if (showTopBorder) {
      verticalBorderHeight -= 1
    }

    if (showBottomBorder) {
      verticalBorderHeight -= 1
    }

    verticalBorderHeight = Math.max(0, verticalBorderHeight)

// 【竖边是「一条带换行的字符串」，不是逐行写】
//
//   `(左边界字符 + 换行).repeat(height)` 一次写完一整列，
//   靠的是 `Output.write` 内部把字符串按换行拆成多行
//   （`output.ts` 的 write 分支：`text.split(换行)` 之后逐行偏移 y）。
//   这是一个**跨文件契约**：这里假设了 write 认识换行。
//
//   末尾多出来的那个换行会 split 出一个空串行 —— 写不出任何格子，无害；
//   但它会让那个 write 操作的 `lines.length` 比实际行数多一，
//   而 clip 的纵向裁剪正是用 `lines.length` 估算高度的。
//   在边界情况下（竖边正好贴着裁剪框底部）会多算一行 —— 只影响裁剪判定，
//   不影响画出来的内容，所以一直没人动它。
//
//   rightBorder 完全对称，只是横向位置不同。
    let leftBorder = (applyColor(box.left, leftBorderColor) + '\n').repeat(
      verticalBorderHeight,
    )

    if (dimLeftBorderColor) {
      leftBorder = chalk.dim(leftBorder)
    }

    let rightBorder = (applyColor(box.right, rightBorderColor) + '\n').repeat(
      verticalBorderHeight,
    )

    if (dimRightBorderColor) {
      rightBorder = chalk.dim(rightBorder)
    }

    const bottomBorderLine = showBottomBorder
      ? (showLeftBorder ? box.bottomLeft : '') +
        box.bottom.repeat(contentWidth) +
        (showRightBorder ? box.bottomRight : '')
      : ''

    // Handle text in bottom border
    let bottomBorder: string | undefined
    if (showBottomBorder && node.style.borderText?.position === 'bottom') {
      const [before, text, after] = embedTextInBorder(
        bottomBorderLine,
        node.style.borderText.content,
        node.style.borderText.align,
        node.style.borderText.offset,
        box.bottom,
      )
      bottomBorder =
        styleBorderLine(before, bottomBorderColor, dimBottomBorderColor) +
        text +
        styleBorderLine(after, bottomBorderColor, dimBottomBorderColor)
    } else if (showBottomBorder) {
      bottomBorder = styleBorderLine(
        bottomBorderLine,
        bottomBorderColor,
        dimBottomBorderColor,
      )
    }

// offsetY 只在有上边时为 1 —— 竖边从第二行开始，把第一行留给上边框。
// 这个「靠常量偏移」的做法能成立，是因为边框不参与 yoga 布局：
// 内容区的位置是 yoga 算好的，边框只是**画在内容区外围**，
// 所以它需要的坐标全都可以从节点的矩形直接推出来。
    const offsetY = showTopBorder ? 1 : 0

// 四次 write，各自的横向坐标值得注意：
//   · 上下边从 x 开始，长度自然等于 width（字符串自己拼够）
//   · 左边写在第 x 列，右边写在第 `x + width - 1` 列 —— **直接落在最后一列**，
//     不依赖字符串宽度，也不依赖「右边框字符是不是宽字符」
//   · 下边写在 `y + height - 1`
//
// 右边那个位置计算是这一层唯一「不靠宽度」的地方，也是它比
// 「先把整行拼好再写」更稳的一点：整行拼法要把内容宽度、边宽、
// 是否有关掉的边全算对，一处错就整行错位；分四次写，
// 每条边只需要管自己的起点。
    if (topBorder) {
      output.write(x, y, topBorder)
    }

    if (showLeftBorder) {
      output.write(x, y + offsetY, leftBorder)
    }

    if (showRightBorder) {
      output.write(x + width - 1, y + offsetY, rightBorder)
    }

    if (bottomBorder) {
      output.write(x, y + height - 1, bottomBorder)
    }
  }
}

export default renderBorder
