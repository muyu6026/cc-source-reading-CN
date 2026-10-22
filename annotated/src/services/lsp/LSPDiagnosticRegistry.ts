import { randomUUID } from 'crypto'
import { LRUCache } from 'lru-cache'
import { logForDebugging } from '../../utils/debug.js'
import { toError } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import type { DiagnosticFile } from '../diagnosticTracking.js'

/**
 * Pending LSP diagnostic notification
 */
export type PendingLSPDiagnostic = {
  /** Server that sent the diagnostic */
  serverName: string
  /** Diagnostic files */
  files: DiagnosticFile[]
  /** When diagnostic was received */
  timestamp: number
  /** Whether attachment was already sent to conversation */
  attachmentSent: boolean
}

// 【第 23-39 行】这一段说清了「诊断为什么不能直接显示」
//
// LSP server 通过 `textDocument/publishDiagnostics` **主动推送**诊断，
// 时机完全由它决定 —— 可能在你没发任何请求的时候突然来一批。
// 而对话是一个「一问一答」的东西：模型看不到「刚推来的东西」。
//
// 所以这里用了一个中转站，五步：
// 1. server push 诊断；
// 2. `registerPendingLSPDiagnostic()` 存进这个模块的 Map；
// 3. 下一轮 query 开始前 `checkForLSPDiagnostics()` 取走；
// 4. `getLSPDiagnosticAttachments()` 转成 attachment；
// 5. attachment 系统把它塞进上下文。
//
// 注释说「*Follows the same pattern as AsyncHookRegistry*」——
// 异步钩子的产出走的是同一条路。**同一类问题应该有同一套机制**，
// 否则读代码的人要学两遍。
//
// 而它比 AsyncHookRegistry 简单的原因也写了：
// *diagnostics arrive synchronously (no need to accumulate output over time)* ——
// 钩子的 stdout 是一段一段来的，要攒；诊断是一次推一批，不用攒。
/**
 * LSP Diagnostic Registry
 *
 * Stores LSP diagnostics received asynchronously from LSP servers via
 * textDocument/publishDiagnostics notifications. Follows the same pattern
 * as AsyncHookRegistry for consistent async attachment delivery.
 *
 * Pattern:
 * 1. LSP server sends publishDiagnostics notification
 * 2. registerPendingLSPDiagnostic() stores diagnostic
 * 3. checkForLSPDiagnostics() retrieves pending diagnostics
 * 4. getLSPDiagnosticAttachments() converts to Attachment[]
 * 5. getAttachments() delivers to conversation automatically
 *
 * Similar to AsyncHookRegistry but simpler since diagnostics arrive
 * synchronously (no need to accumulate output over time).
 */

// Volume limiting constants
const MAX_DIAGNOSTICS_PER_FILE = 10
// 【第 42-46 行】两个限额 + 一个 LRU 上限，防的是三件不同的事
//
// - `MAX_DIAGNOSTICS_PER_FILE = 10`：**单文件**最多 10 条。
//   一个文件有 300 个类型错误时，前 10 条足够让模型知道「这文件烂了」，
//   剩下 290 条只会吃掉上下文。
// - `MAX_TOTAL_DIAGNOSTICS = 30`：**总量**最多 30 条。
//   项目级检查（比如 tsconfig 变更）可能一次推几百个文件。
// - `MAX_DELIVERED_FILES = 500`（LRU）：**去重记录**最多记 500 个文件。
//   这是纯内存考虑 —— 不设上限的话，长会话里这个 Map 只增不减。
//
// 三者服务的对象不同：前两个保护**模型上下文**，第三个保护**进程内存**。
// 读这类常量时对一下它守护的是什么，就知道为什么数字差得这么远（10 / 30 / 500）。
const MAX_TOTAL_DIAGNOSTICS = 30

// Max files to track for deduplication - prevents unbounded memory growth
const MAX_DELIVERED_FILES = 500

// Global registry state
const pendingDiagnostics = new Map<string, PendingLSPDiagnostic>()

// Cross-turn deduplication: tracks diagnostics that have been delivered
// Maps file URI to a set of diagnostic keys (hash of message+severity+range)
// Using LRUCache to prevent unbounded growth in long sessions
// 【第 54-56 行】跨轮去重必须用 LRU，且 key 是**文件 URI**
//
// `deliveredDiagnostics: LRUCache<string, Set<string>>` —— uri → 已投递诊断的 key 集合。
//
// 为什么需要跨轮去重：同一个错误在 server 侧不会消失，每次重新分析都会再推一遍。
// 如果每轮都原样投给模型，上下文里就会积累 20 份同样的「第 42 行类型错误」——
// 模型会被这种重复噪声带偏（它会以为有 20 个问题）。
//
// 为什么用 LRU 而不是普通 Map：长会话可能碰过几千个文件，
// 每个文件存一个 key 集合，量级不小。LRU 让「最近没碰过的文件」自然被淘汰，
// 被淘汰的代价只是「那个文件下次会重新上报一次诊断」，可以接受。
//
// **去重表的容量上限，其实是在给「重复上报」定价。**
const deliveredDiagnostics = new LRUCache<string, Set<string>>({
  max: MAX_DELIVERED_FILES,
})

/**
 * Register LSP diagnostics received from a server.
 * These will be delivered as attachments in the next query.
 *
 * @param serverName - Name of LSP server that sent diagnostics
 * @param files - Diagnostic files to deliver
 */
export function registerPendingLSPDiagnostic({
  serverName,
  files,
}: {
  serverName: string
  files: DiagnosticFile[]
}): void {
  // Use UUID for guaranteed uniqueness (handles rapid registrations)
  const diagnosticId = randomUUID()

  logForDebugging(
    `LSP Diagnostics: Registering ${files.length} diagnostic file(s) from ${serverName} (ID: ${diagnosticId})`,
  )

  pendingDiagnostics.set(diagnosticId, {
    serverName,
    files,
    timestamp: Date.now(),
    attachmentSent: false,
  })
}

/**
 * Maps severity string to numeric value for sorting.
 * Error=1, Warning=2, Info=3, Hint=4
 */
function severityToNumber(severity: string | undefined): number {
  switch (severity) {
    case 'Error':
      return 1
    case 'Warning':
      return 2
    case 'Info':
      return 3
    case 'Hint':
      return 4
    default:
      return 4
  }
}

/**
 * Creates a unique key for a diagnostic based on its content.
 * Used for both within-batch and cross-turn deduplication.
 */
// 【第 110-124 行】`createDiagnosticKey` 用 `jsonStringify` 而不是手拼字符串
//
// 手拼的常见写法是 `message + severity + line + char`，
// 问题是**分隔符会撞**：`("a|b", "c")` 和 `("a", "b|c")` 拼出来一样。
// 用 JSON 序列化就没有这个问题（引号和转义天然分隔）。
//
// 另一个好处是**字段顺序固定**：`jsonStringify` 按对象字面量的书写顺序输出，
// 同一份输入永远得到同一个 key。如果用 `Object.keys()` 遍历再拼，顺序就不保证了。
//
// 注意 `source: diag.source || null` 和 `code: diag.code || null`：
// 把 `undefined` 归一成 `null`，这样「没有 source」和「source 是 undefined」
// 得到同一个 key。（`||` 在这里对 `""` 也不友好，但 `source` 为空字符串时当作没有是合理的。）
//
// 整段还包在 `try/catch` 里 —— 因为 `range` 来自第三方 server 的 JSON，
// 理论上可能包含 `BigInt`（`jsonStringify` 会抛）或者被改成循环引用。
// **凡是拿外部数据做序列化，都要留一个能降级的 catch。**
function createDiagnosticKey(diag: {
  message: string
  severity?: string
  range?: unknown
  source?: string
  code?: unknown
}): string {
  return jsonStringify({
    message: diag.message,
    severity: diag.severity,
    range: diag.range,
    source: diag.source || null,
    code: diag.code || null,
  })
}

/**
 * Deduplicates diagnostics by file URI and diagnostic content.
 * Also filters out diagnostics that were already delivered in previous turns.
 * Two diagnostics are considered duplicates if they have the same:
 * - File URI
 * - Range (start/end line and character)
 * - Message
 * - Severity
 * - Source and code (if present)
 */
function deduplicateDiagnosticFiles(
  allFiles: DiagnosticFile[],
): DiagnosticFile[] {
  // Group diagnostics by file URI
  const fileMap = new Map<string, Set<string>>()
  const dedupedFiles: DiagnosticFile[] = []

  for (const file of allFiles) {
    if (!fileMap.has(file.uri)) {
      fileMap.set(file.uri, new Set())
      dedupedFiles.push({ uri: file.uri, diagnostics: [] })
    }

    const seenDiagnostics = fileMap.get(file.uri)!
    const dedupedFile = dedupedFiles.find(f => f.uri === file.uri)!

    // Get previously delivered diagnostics for this file (for cross-turn dedup)
    const previouslyDelivered = deliveredDiagnostics.get(file.uri) || new Set()

    for (const diag of file.diagnostics) {
      try {
        const key = createDiagnosticKey(diag)

// 【第 159-162 行】双重去重，且顺序不能反
//
// ```js
// if (seenDiagnostics.has(key) || previouslyDelivered.has(key)) continue
// seenDiagnostics.add(key)
// dedupedFile.diagnostics.push(diag)
// ```
//
// - `seenDiagnostics`：**本批内**去重（同一次 `checkForLSPDiagnostics` 里多个 server
//   可能报同一个问题，比如 vue server 和 ts server 都报）。
// - `previouslyDelivered`：**跨轮**去重（上一轮已经投给模型了）。
//
// 顺序的意义在于：必须先查两个集合，再往本批集合里写。
// 如果先写后查，自己刚写进去的会被自己当成重复，第一条就丢了。
//
// 还要注意 `previouslyDelivered` 是**在循环里逐文件取**的
// （`deliveredDiagnostics.get(file.uri)`），不是提到外面一次取完 ——
// 因为每个文件的已投递集合是不同的。
        // Skip if already seen in this batch OR already delivered in previous turns
        if (seenDiagnostics.has(key) || previouslyDelivered.has(key)) {
          continue
        }

        seenDiagnostics.add(key)
        dedupedFile.diagnostics.push(diag)
      } catch (error: unknown) {
        const err = toError(error)
        const truncatedMessage =
          diag.message?.substring(0, 100) || '<no message>'
        logError(
          new Error(
            `Failed to deduplicate diagnostic in ${file.uri}: ${err.message}. ` +
              `Diagnostic message: ${truncatedMessage}`,
          ),
        )
        // Include the diagnostic anyway to avoid losing information
        dedupedFile.diagnostics.push(diag)
      }
    }
  }

  // Filter out files with no diagnostics after deduplication
  return dedupedFiles.filter(f => f.diagnostics.length > 0)
}

/**
 * Get all pending LSP diagnostics that haven't been delivered yet.
 * Deduplicates diagnostics to prevent sending the same diagnostic multiple times.
 * Marks diagnostics as sent to prevent duplicate delivery.
 *
 * @returns Array of pending diagnostics ready for delivery (deduplicated)
 */
export function checkForLSPDiagnostics(): Array<{
  serverName: string
  files: DiagnosticFile[]
}> {
  logForDebugging(
    `LSP Diagnostics: Checking registry - ${pendingDiagnostics.size} pending`,
  )

  // Collect all diagnostic files from all pending notifications
  const allFiles: DiagnosticFile[] = []
  const serverNames = new Set<string>()
  const diagnosticsToMark: PendingLSPDiagnostic[] = []

  for (const diagnostic of pendingDiagnostics.values()) {
    if (!diagnostic.attachmentSent) {
      allFiles.push(...diagnostic.files)
      serverNames.add(diagnostic.serverName)
      diagnosticsToMark.push(diagnostic)
    }
  }

  if (allFiles.length === 0) {
    return []
  }

  // Deduplicate diagnostics across all files
  let dedupedFiles: DiagnosticFile[]
  try {
    dedupedFiles = deduplicateDiagnosticFiles(allFiles)
  } catch (error: unknown) {
    const err = toError(error)
    logError(new Error(`Failed to deduplicate LSP diagnostics: ${err.message}`))
    // Fall back to undedup'd files to avoid losing diagnostics
    dedupedFiles = allFiles
  }

  // Only mark as sent AFTER successful deduplication, then delete from map.
  // Entries are tracked in deliveredDiagnostics LRU for dedup, so we don't
  // need to keep them in pendingDiagnostics after delivery.
// 【第 232-239 行】标记「已投递」放在去重**之后**，然后立刻从 pending 删除
//
// ```js
// for (const diagnostic of diagnosticsToMark) diagnostic.attachmentSent = true
// for (const [id, diagnostic] of pendingDiagnostics) {
//   if (diagnostic.attachmentSent) pendingDiagnostics.delete(id)
// }
// ```
//
// 注释解释了顺序：*Only mark as sent AFTER successful deduplication*。
//
// 为什么：上面有一步 `deduplicateDiagnosticFiles()` 是可能抛的，
// 抛了之后会**回退到未去重的全量**继续走（`dedupedFiles = allFiles`）。
// 如果标记动作放在去重之前，一旦去重过程中途抛错，
// 这些诊断就都被标成「已发」然后删掉 —— **一条都没投出去，而且永远丢了**。
//
// 这是「状态变更必须放在所有可能失败的步骤之后」的典型案例。
// 「先标记再做事」在乐观路径上更省事，但它把「失败」变成了「静默丢失」。
//
// 顺便说明为什么敢从 `pendingDiagnostics` 里删：去重信息已经进了
// `deliveredDiagnostics`（LRU），留着 pending 条目只会让下一轮再算一遍。
  for (const diagnostic of diagnosticsToMark) {
    diagnostic.attachmentSent = true
  }
  for (const [id, diagnostic] of pendingDiagnostics) {
    if (diagnostic.attachmentSent) {
      pendingDiagnostics.delete(id)
    }
  }

  const originalCount = allFiles.reduce(
    (sum, f) => sum + f.diagnostics.length,
    0,
  )
  const dedupedCount = dedupedFiles.reduce(
    (sum, f) => sum + f.diagnostics.length,
    0,
  )

  if (originalCount > dedupedCount) {
    logForDebugging(
      `LSP Diagnostics: Deduplication removed ${originalCount - dedupedCount} duplicate diagnostic(s)`,
    )
  }

  // Apply volume limiting: cap per file and total
  let totalDiagnostics = 0
  let truncatedCount = 0
  for (const file of dedupedFiles) {
// 【第 260-279 行】先按严重性排序，再截断 —— 顺序决定砍掉谁
//
// ```js
// file.diagnostics.sort((a,b) => severityToNumber(a.severity) - severityToNumber(b.severity))
// ```
//
// `severityToNumber`：Error=1 / Warning=2 / Info=3 / Hint=4，升序排 →
// **Error 在最前面**，所以 `slice(0, 10)` 砍掉的是 Hint 和 Info。
//
// 如果不排序直接 `slice`，砍掉的是「server 恰好后报的那些」—— 完全随机。
// 一个文件里有 2 个 Error 和 40 个 Hint 时，随机截断有一半概率把 Error 砍掉，
// 而 Hint（「这个变量名可以更短」）留着。这个结果对模型是**有害**的：
// 它会以为这个文件的错误都是风格问题。
//
// 两级截断的写法也值得看：先单文件 10 条，再全局 30 条 ——
// `remainingCapacity` 是动态算的，所以前面的文件吃满额度后，
// 后面的文件可能一条都分不到（`slice(0, 0)`），最后被
// `filter(f => f.diagnostics.length > 0)` 过滤掉。
// **没有配额的公平性设计，只有「先到先得 + 按严重性排队」。**
    // Sort by severity (Error=1 < Warning=2 < Info=3 < Hint=4) to prioritize errors
    file.diagnostics.sort(
      (a, b) => severityToNumber(a.severity) - severityToNumber(b.severity),
    )

    // Cap per file
    if (file.diagnostics.length > MAX_DIAGNOSTICS_PER_FILE) {
      truncatedCount += file.diagnostics.length - MAX_DIAGNOSTICS_PER_FILE
      file.diagnostics = file.diagnostics.slice(0, MAX_DIAGNOSTICS_PER_FILE)
    }

    // Cap total
    const remainingCapacity = MAX_TOTAL_DIAGNOSTICS - totalDiagnostics
    if (file.diagnostics.length > remainingCapacity) {
      truncatedCount += file.diagnostics.length - remainingCapacity
      file.diagnostics = file.diagnostics.slice(0, remainingCapacity)
    }

    totalDiagnostics += file.diagnostics.length
  }

  // Filter out files that ended up with no diagnostics after limiting
  dedupedFiles = dedupedFiles.filter(f => f.diagnostics.length > 0)

  if (truncatedCount > 0) {
    logForDebugging(
      `LSP Diagnostics: Volume limiting removed ${truncatedCount} diagnostic(s) (max ${MAX_DIAGNOSTICS_PER_FILE}/file, ${MAX_TOTAL_DIAGNOSTICS} total)`,
    )
  }

  // Track delivered diagnostics for cross-turn deduplication
  for (const file of dedupedFiles) {
    if (!deliveredDiagnostics.has(file.uri)) {
      deliveredDiagnostics.set(file.uri, new Set())
    }
    const delivered = deliveredDiagnostics.get(file.uri)!
    for (const diag of file.diagnostics) {
      try {
        delivered.add(createDiagnosticKey(diag))
      } catch (error: unknown) {
        // Log but continue - failure to track shouldn't prevent delivery
        const err = toError(error)
        const truncatedMessage =
          diag.message?.substring(0, 100) || '<no message>'
        logError(
          new Error(
            `Failed to track delivered diagnostic in ${file.uri}: ${err.message}. ` +
              `Diagnostic message: ${truncatedMessage}`,
          ),
        )
      }
    }
  }

  const finalCount = dedupedFiles.reduce(
    (sum, f) => sum + f.diagnostics.length,
    0,
  )

  // Return empty if no diagnostics to deliver (all filtered by deduplication)
  if (finalCount === 0) {
    logForDebugging(
      `LSP Diagnostics: No new diagnostics to deliver (all filtered by deduplication)`,
    )
    return []
  }

  logForDebugging(
    `LSP Diagnostics: Delivering ${dedupedFiles.length} file(s) with ${finalCount} diagnostic(s) from ${serverNames.size} server(s)`,
  )

  // Return single result with all deduplicated diagnostics
  return [
    {
      serverName: Array.from(serverNames).join(', '),
      files: dedupedFiles,
    },
  ]
}

/**
 * Clear all pending diagnostics.
 * Used during cleanup/shutdown or for testing.
 * Note: Does NOT clear deliveredDiagnostics - that's for cross-turn deduplication
 * and should only be cleared when files are edited or on session reset.
 */
export function clearAllLSPDiagnostics(): void {
  logForDebugging(
    `LSP Diagnostics: Clearing ${pendingDiagnostics.size} pending diagnostic(s)`,
  )
  pendingDiagnostics.clear()
}

/**
 * Reset all diagnostic state including cross-turn tracking.
 * Used on session reset or for testing.
 */
export function resetAllLSPDiagnosticState(): void {
  logForDebugging(
    `LSP Diagnostics: Resetting all state (${pendingDiagnostics.size} pending, ${deliveredDiagnostics.size} files tracked)`,
  )
  pendingDiagnostics.clear()
  deliveredDiagnostics.clear()
}

/**
 * Clear delivered diagnostics for a specific file.
 * Should be called when a file is edited so that new diagnostics for that file
 * will be shown even if they match previously delivered ones.
 *
 * @param fileUri - URI of the file that was edited
 */
// 【第 372-379 行】文件被编辑后要显式清掉它的去重记录
//
// `clearDeliveredDiagnosticsForFile(fileUri)` —— 只有调用它，同一个诊断才会被**重新**投递一次。
//
// 这是「去重键包含 range」的必然结果：
// 一个错误在第 42 行，用户在第 1 行插了几行代码，错误移到第 45 行 —— range 变了，key 变了，
// 会重新上报（正确）。
// 但如果用户只是改了**别的地方**，同一个错误还在第 42 行、message 也一样 ——
// key 完全相同，于是**不会**再上报。
//
// 从「别重复烦模型」的角度这是对的；从「我刚改完，想看看还有没有错」的角度这是错的。
// 代码选择了后者优先：**编辑动作触发清除**，让下一批诊断重新进入视野。
//
// 调用点在 `diagnostics` 与 FileEdit 的连接处（`clearDeliveredDiagnosticsForFile` 的调用方）。
// 这条设计告诉我们：**去重的有效期应该绑定在「内容变了」这个事件上，
// 而不是绑定在时间上。**
export function clearDeliveredDiagnosticsForFile(fileUri: string): void {
  if (deliveredDiagnostics.has(fileUri)) {
    logForDebugging(
      `LSP Diagnostics: Clearing delivered diagnostics for ${fileUri}`,
    )
    deliveredDiagnostics.delete(fileUri)
  }
}

/**
 * Get count of pending diagnostics (for monitoring)
 */
export function getPendingLSPDiagnosticCount(): number {
  return pendingDiagnostics.size
}
