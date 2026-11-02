// 从 json.ts 抽出来的叶子模块 stripBOM，目的是打断 settings → json → log → types/logs → … → settings 的循环依赖；同时处理 PowerShell 5.x 默认写出带 BOM 的 UTF-8 文件。
/**
 * Leaf stripBOM — extracted from json.ts to break settings → json → log →
 * types/logs → … → settings. json.ts imports this for its memoized+logging
 * safeParseJSON; leaf callers that can't import json.ts use stripBOM +
 * jsonParse inline (syncCacheState does this).
 *
 * UTF-8 BOM (U+FEFF): PowerShell 5.x writes UTF-8 with BOM by default
 * (Out-File, Set-Content). We can't control user environments, so strip on
 * read. Without this, JSON.parse fails with "Unexpected token".
 */

const UTF8_BOM = '\uFEFF'

export function stripBOM(content: string): string {
  return content.startsWith(UTF8_BOM) ? content.slice(1) : content
}
// 函数逻辑：若内容以 U+FEFF 开头就把首字符去掉再返回，否则原样返回，避免 JSON.parse 因为 BOM 报出「Unexpected token」错误。
