// ═══════════════════════════════════════════════════════════════
//  inputPaste：十万字符的粘贴，屏幕上只显示首尾各 500 字
// ═══════════════════════════════════════════════════════════════
//
//  核心思想一句话：**截断只发生在「显示」这一侧，数据一个字都不丢**。
//
//  具体做法是把中间那一大段挖出来，单独存进 pastedContents（当作一条「粘贴内容」），
//  在文本里只留一个占位符：
//
//    [...Truncated text #3 +2048 lines...]
//
//  于是整套「粘贴内容」机制（原本为剪贴板长文本准备的）被复用了：
//  渲染时按占位符展开、提交时还原全文、删除占位符时清理附件。
//  没有为「截断」再发明一套数据结构。
import { getPastedTextRefNumLines } from 'src/history.js'
import type { PastedContent } from 'src/utils/config.js'

// 【两个阈值，一个 1 万一个 1 千，比是 10:1】
//
//  1 万是「要不要截断」的线，1 千是「截断后留多少预览」的量。
//  1000 又被 33-34 行对半分成 500 + 500 —— 首尾各留一半，因为用户在长粘贴里
//  最关心的两端：开头是「我粘的什么东西的开头」，结尾是「它结束在哪」。
//
//  只留开头是最常见的错误做法：用户没法确认「是不是全粘进来了」。
//
//  注意 PREVIEW_LENGTH 被 /2 两次（都用了 Math.floor），所以两个 500 相加正好是
//  1000，和下面对 placeholderContent 的切法严丝合缝（见第 41 行批注）。
const TRUNCATION_THRESHOLD = 10000 // Characters before we truncate
const PREVIEW_LENGTH = 1000 // Characters to show at start and end

type TruncatedMessage = {
  truncatedText: string
  placeholderContent: string
}

/**
 * Determines whether the input text should be truncated. If so, it adds a
 * truncated text placeholder and neturns
 *
 * @param text The input text
 * @param nextPasteId The reference id to use
 * @returns The new text to display and separate placeholder content if applicable.
 */
// 【返回的是一个「二元组」：要显示的文本 + 被挖出来的内容】
//
//  没有副作用、不写任何全局状态 —— 这是它好用的原因：调用方自己决定
//  「挖出来的这段存哪儿」（这里存进 pastedContents）。
//
//  短文本走第 25 行的快速路径，原样返回且 placeholderContent 为空串。
//  空串就是「没有发生截断」的信号（第 75 行据此判断要不要改状态）。
//  用空串而不是 null/undefined，是为了让返回类型保持简单，不用两处判空。
export function maybeTruncateMessageForInput(
  text: string,
  nextPasteId: number,
): TruncatedMessage {
  // If the text is short enough, return it as-is
  if (text.length <= TRUNCATION_THRESHOLD) {
    return {
      truncatedText: text,
      placeholderContent: '',
    }
  }

  // Calculate how much text to keep from start and end
// 【这里为什么可以直接用 Math.floor，不用管奇数】
//
//  PREVIEW_LENGTH = 1000，除以 2 整除，两个 500。故意不做「奇数时补一」的修正 ——
//  因为这两个数只影响「留多少预览」，差一个字符没有任何语义后果。
//
//  对比第 41 行就很清楚了：真正的约束在那儿，不在长度。
  const startLength = Math.floor(PREVIEW_LENGTH / 2)
  const endLength = Math.floor(PREVIEW_LENGTH / 2)

  // Extract the portions we'll keep
  const startText = text.slice(0, startLength)
  const endText = text.slice(-endLength)

  // Calculate the number of lines that will be truncated
// 【slice(startLength, -endLength) 的两个边界正好接上，不会重叠也不会漏】
//
//  字符串长度 L > 10000，startLength = endLength = 500：
//    中间段 = text[500 .. L-500)   长度 L-1000
//    首段   = text[0 .. 500)
//    尾段   = text[L-500 .. L)
//
//  三段拼起来恰好等于原文，一个字符都不差 —— 这是「无损挖洞」。
//  如果两个长度不等（比如首 300 尾 700），就得记住两个不同的偏移量，
//  现在这种对称写法让「拼回去」这件事只需要一个数字。
//
//  可推广：**对称的切分点最好来自同一个常量的一半**，比两个独立常量更难写错。
  const placeholderContent = text.slice(startLength, -endLength)
// 【这里算出来的行数偏小，是个已知的小瑕疵】
//
//  getPastedTextRefNumLines 只统计「中间段」的换行数，也就是被挖掉的那部分，
//  不含首尾各 500 字。所以占位符上的 `+N lines` 说的是「藏起来了多少行」，
//  不是「原文一共多少行」。
//
//  这个语义其实更贴切（用户想知道的正是「被折叠了多少」），但它和
//  onTextPaste 里 `formatPastedTextRef(pasteId, numLines)` 传的是全文字数
//  —— 同一个占位符格式，两处传入的口径不同。
//
//  看这类代码要养成的习惯：**占位符里的数字，一定要去找它的两个来源对齐没有**。
  const truncatedLines = getPastedTextRefNumLines(placeholderContent)

  // Create a placeholder reference similar to pasted text
  const placeholderId = nextPasteId
  const placeholderRef = formatTruncatedTextRef(placeholderId, truncatedLines)

  // Combine the parts with the placeholder
  const truncatedText = startText + placeholderRef + endText

  return {
    truncatedText,
    placeholderContent,
  }
}

// 【占位符格式是和另一处共用的字符串契约】
//
//  这个 formatTruncatedTextRef 造的字符串，必须能被 history.js 里的
//  parseReferences 认出来（否则提交时没法还原全文、删除时没法清理附件）。
//
//  它长得像 `[...Truncated text #3 +2048 lines...]`，和普通的 `[...Pasted text #3 +12 lines]`
//  刻意保持同构：都是「方括号 + 类型词 + #id + 行数」。
//
//  风险也在这儿 —— 解析端靠正则匹配，这个格式一旦改动，解析端不会报错，
//  只会「认不出来」，表现为：提交时把占位符当普通文字发了出去。
function formatTruncatedTextRef(id: number, numLines: number): string {
  return `[...Truncated text #${id} +${numLines} lines...]`
}

// 【ID 分配：取现有最大值 +1，空表时从 1 开始】
//
//  第 67 行 `existingIds.length > 0 ? Math.max(...) + 1 : 1` —— 那个长度判断
//  不是防御性编程，是**必须的**：`Math.max()` 空参数返回 -Infinity，
//  再 +1 还是 -Infinity，拼出来的占位符会是 `#-Infinity`。
//
//  另一个隐含前提：ID 的分配权在这一层，但 PromptInput 里还有一个
//  nextPasteIdRef 也在分配 ID（图片粘贴、长文本粘贴）。两边都靠「当前最大值」
//  推算，只要其中一处忘了先看对方的产物，就会撞号。
//
//  第 83-87 行把内容注册进 pastedContents，注意 id 字段和对象键是同一个数 ——
//  冗余存一份，是为了让「遍历 values」时不需要反查键。
export function maybeTruncateInput(
  input: string,
  pastedContents: Record<number, PastedContent>,
): { newInput: string; newPastedContents: Record<number, PastedContent> } {
  // Get the next available ID for the truncated content
  const existingIds = Object.keys(pastedContents).map(Number)
  const nextPasteId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1

  // Apply truncation
  const { truncatedText, placeholderContent } = maybeTruncateMessageForInput(
    input,
    nextPasteId,
  )

// 【用「中间段是不是空」来判断有没有截断，而不是再比一次长度】
//
//  这是一种很省事的哨兵约定：placeholderContent 非空 ⇔ 发生了截断。
//  于是调用方不需要知道阈值是多少，也不需要重复那个 10000 的判断。
//
//  好处：阈值将来改成 2 万，这里一行都不用动。
//  代价：含义藏在「返回值的第二个字段」里，读代码的人必须回到第 20 行才知道
//  空串代表什么。所以它必须在函数注释里写明 —— 原文第 18 行确实写了
//  （顺便一提，那行注释里把 returns 拼成了 neturns，是个无害的错字）。
  if (!placeholderContent) {
    return { newInput: input, newPastedContents: pastedContents }
  }

  return {
    newInput: truncatedText,
    newPastedContents: {
      ...pastedContents,
      [nextPasteId]: {
        id: nextPasteId,
        type: 'text',
        content: placeholderContent,
      },
    },
  }
}
