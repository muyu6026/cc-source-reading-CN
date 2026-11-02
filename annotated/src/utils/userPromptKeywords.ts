// 文件级批注：`userPromptKeywords.ts` 用正则检测用户输入是否命中「负面情緒词」或「继续/keep going」类关键词，供对话续写与情绪感知逻辑使用。
/**
 * Checks if input matches negative keyword patterns
 */
// 第一个函数签名：检测输入是否匹配负面关键词模式（脏话、挫败表达等英文口语）。
export function matchesNegativeKeyword(input: string): boolean {
  const lowerInput = input.toLowerCase()

  const negativePattern =
    /\b(wtf|wth|ffs|omfg|shit(ty|tiest)?|dumbass|horrible|awful|piss(ed|ing)? off|piece of (shit|crap|junk)|what the (fuck|hell)|fucking? (broken|useless|terrible|awful|horrible)|fuck you|screw (this|you)|so frustrating|this sucks|damn it)\b/

  return negativePattern.test(lowerInput)
}
// 第一个函数收尾：用预编译正则对全小写输入做匹配测试，命中返回真。

/**
 * Checks if input matches keep going/continuation patterns
 */
// 第二个函数签名：检测「继续/keep going/go on」类续写关键词。
export function matchesKeepGoingKeyword(input: string): boolean {
  const lowerInput = input.toLowerCase().trim()

  // Match "continue" only if it's the entire prompt
  if (lowerInput === 'continue') {
    return true
  }

  // Match "keep going" or "go on" anywhere in the input
  const keepGoingPattern = /\b(keep going|go on)\b/
  return keepGoingPattern.test(lowerInput)
}
// 第二个函数收尾：整句等于 `continue` 直接命中；否则用正则匹配「keep going/go on」短语。
