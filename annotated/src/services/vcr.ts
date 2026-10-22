import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { createHash, randomUUID, type UUID } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import isPlainObject from 'lodash-es/isPlainObject.js'
import mapValues from 'lodash-es/mapValues.js'
import { dirname, join } from 'path'
import { addToTotalSessionCost } from 'src/cost-tracker.js'
import { calculateUSDCost } from 'src/utils/modelCost.js'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
  UserMessage,
} from '../types/message.js'
import { getCwd } from '../utils/cwd.js'
import { env } from '../utils/env.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from '../utils/envUtils.js'
import { getErrnoCode } from '../utils/errors.js'
import { normalizeMessagesForAPI } from '../utils/messages.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'
// 模块定位：**VCR = 录制 / 回放**。测试时把真实的 Anthropic API 响应录成 fixtures 存盘，之后再跑就回放，不打网络。四个入口各管一类数据：`withVCR`（非流式消息）、`withStreamingVCR`（流式）、`withFixture`（通用 key-value，token 计数用）、`withTokenCountVCR`（token 计数）。开关只有 `shouldUseVCR()` 一处——生产环境这整份文件是透明的。

function shouldUseVCR(): boolean {
  if (process.env.NODE_ENV === 'test') {
    return true
  }

  if (process.env.USER_TYPE === 'ant' && isEnvTruthy(process.env.FORCE_VCR)) {
    return true
  }

  return false
}
// 两个开启条件，没有第三个：`NODE_ENV === 'test'` 时无条件启用（所以单测天然走回放）；ant 内部可用 `FORCE_VCR=1` 手动开。生产用户永远不会命中——这意味着 fixtures 只服务于开发者与 CI。

/**
 * Generic fixture management helper
 * Handles caching, reading, writing fixtures for any data type
 */
async function withFixture<T>(
  input: unknown,
  fixtureName: string,
  f: () => Promise<T>,
): Promise<T> {
  if (!shouldUseVCR()) {
    return await f()
  }

  // Create hash of input for fixture filename
  const hash = createHash('sha1')
    .update(jsonStringify(input))
    .digest('hex')
    .slice(0, 12)
  const filename = join(
    process.env.CLAUDE_CODE_TEST_FIXTURES_ROOT ?? getCwd(),
    `fixtures/${fixtureName}-${hash}.json`,
  )

  // Fetch cached fixture
  try {
    const cached = jsonParse(
      await readFile(filename, { encoding: 'utf8' }),
    ) as T
    return cached
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code !== 'ENOENT') {
      throw e
    }
  }

  if ((env.isCI || process.env.CI) && !isEnvTruthy(process.env.VCR_RECORD)) {
    throw new Error(
      `Fixture missing: ${filename}. Re-run tests with VCR_RECORD=1, then commit the result.`,
    )
  }

  // Create & write new fixture
  const result = await f()

  await mkdir(dirname(filename), { recursive: true })
  await writeFile(filename, jsonStringify(result, null, 2), {
    encoding: 'utf8',
  })

  return result
}
// withFixture 是通用版的「缓存 + 录制」骨架，四步值得记：① 用 `jsonStringify(input)` 的 sha1 前 12 位做文件名——**输入决定文件**，同一输入自然命中同一 fixture；② 命中就读回来直接返回；③ **CI 里缺 fixture 且没开 VCR_RECORD 就直接抛错**——绝不允许 CI 里偷偷录，否则录到的内容随环境漂移，测试变成「今天过明天挂」；④ 未命中才执行 f() 并写盘，`null, 2` 缩进是为了 fixture 在 git diff 里可读。

export async function withVCR(
  messages: Message[],
  f: () => Promise<(AssistantMessage | StreamEvent | SystemAPIErrorMessage)[]>,
): Promise<(AssistantMessage | StreamEvent | SystemAPIErrorMessage)[]> {
  if (!shouldUseVCR()) {
    return await f()
  }

  const messagesForAPI = normalizeMessagesForAPI(
    messages.filter(_ => {
      if (_.type !== 'user') {
        return true
      }
      if (_.isMeta) {
        return false
      }
      return true
    }),
  )

  const dehydratedInput = mapMessages(
    messagesForAPI.map(_ => _.message.content),
    dehydrateValue,
  )
  const filename = join(
    process.env.CLAUDE_CODE_TEST_FIXTURES_ROOT ?? getCwd(),
    `fixtures/${dehydratedInput.map(_ => createHash('sha1').update(jsonStringify(_)).digest('hex').slice(0, 6)).join('-')}.json`,
  )

  // Fetch cached fixture
  try {
    const cached = jsonParse(
      await readFile(filename, { encoding: 'utf8' }),
    ) as { output: (AssistantMessage | StreamEvent)[] }
    cached.output.forEach(addCachedCostToTotalSessionCost)
    return cached.output.map((message, index) =>
      mapMessage(message, hydrateValue, index, randomUUID()),
    )
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code !== 'ENOENT') {
      throw e
    }
  }

  if (env.isCI && !isEnvTruthy(process.env.VCR_RECORD)) {
    throw new Error(
      `Anthropic API fixture missing: ${filename}. Re-run tests with VCR_RECORD=1, then commit the result. Input messages:\n${jsonStringify(dehydratedInput, null, 2)}`,
    )
  }

  // Create & write new fixture
  const results = await f()
  if (env.isCI && !isEnvTruthy(process.env.VCR_RECORD)) {
    return results
  }

  await mkdir(dirname(filename), { recursive: true })
  await writeFile(
    filename,
    jsonStringify(
      {
        input: dehydratedInput,
        output: results.map((message, index) =>
          mapMessage(message, dehydrateValue, index),
        ),
      },
      null,
      2,
    ),
    { encoding: 'utf8' },
  )
  return results
}
// withVCR 是非流式主入口，三个关键动作：① 先 `normalizeMessagesForAPI` 并**过滤掉 isMeta 的 user 消息**——元消息（如系统注入的提醒）每次可能不同，放进 hash 会让 fixture 永远 miss；② 逐条消息 dehydrate 后按 sha1 前 6 位拼接成文件名（6 位 × N 段，比整体 hash 更能看出「第几条变了」）；③ 命中时先 `addCachedCostToTotalSessionCost` 再 hydrate——**回放也要记账**，否则测试里的成本统计永远是 0；hydrate 时给每条消息生成新的 `randomUUID()`。

function addCachedCostToTotalSessionCost(
  message: AssistantMessage | StreamEvent,
): void {
  if (message.type === 'stream_event') {
    return
  }
  const model = message.message.model
  const usage = message.message.usage
  const costUSD = calculateUSDCost(model, usage)
  addToTotalSessionCost(costUSD, usage, model)
}
// 回放路径的成本补记：跳过 `stream_event`（流事件没有 usage），assistant 消息用 `model` + `usage` 算美元并累加进会话总成本。这段存在的意义是让「回放」与「真跑」在成本维度上等价——否则任何依赖成本断言的测试在回放下都会失败。

function mapMessages(
  messages: (UserMessage | AssistantMessage)['message']['content'][],
  f: (s: unknown) => unknown,
): (UserMessage | AssistantMessage)['message']['content'][] {
  return messages.map(_ => {
    if (typeof _ === 'string') {
      return f(_)
    }
    return _.map(_ => {
      switch (_.type) {
        case 'tool_result':
          if (typeof _.content === 'string') {
            return { ..._, content: f(_.content) }
          }
          if (Array.isArray(_.content)) {
            return {
              ..._,
              content: _.content.map(_ => {
                switch (_.type) {
                  case 'text':
                    return { ..._, text: f(_.text) }
                  case 'image':
                    return _
                  default:
                    return undefined
                }
              }),
            }
          }
          return _
        case 'text':
          return { ..._, text: f(_.text) }
        case 'tool_use':
          return {
            ..._,
            input: mapValuesDeep(_.input as Record<string, unknown>, f),
          }
        case 'image':
          return _
        default:
          return undefined
      }
    })
  }) as (UserMessage | AssistantMessage)['message']['content'][]
}
// mapMessages 按内容块类型逐个处理（dehydrate 与 hydrate 共用这一套）：`tool_result` 的 content 可能是**字符串**也可能是**数组**（数组里 text 块替换、image 块原样、其余类型返回 undefined 被过滤掉）；`text` 块替换文本；`tool_use` 的 input 走 `mapValuesDeep` 递归；`image` 原样保留。注意 default 返回 undefined——**不认识的块类型在 fixture 里直接消失**，这是有意的：宁可少存，也不把未知结构当真。

function mapValuesDeep(
  obj: {
    [x: string]: unknown
  },
  f: (val: unknown, key: string, obj: Record<string, unknown>) => unknown,
): Record<string, unknown> {
  return mapValues(obj, (val, key) => {
    if (Array.isArray(val)) {
      return val.map(_ => mapValuesDeep(_, f))
    }
    if (isPlainObject(val)) {
      return mapValuesDeep(val as Record<string, unknown>, f)
    }
    return f(val, key, obj)
  })
}
// mapValuesDeep 只管「往下钻」：数组逐项递归、纯对象逐层递归，只有叶子值才交给 f。tool_use 的 input 往往是嵌套很深的参数树（路径、命令、文件内容都在里面），不递归就会漏掉中间层的 cwd——fixture 在不同机器上 hash 不同。

function mapAssistantMessage(
  message: AssistantMessage,
  f: (s: unknown) => unknown,
  index: number,
  uuid?: UUID,
): AssistantMessage {
  return {
    // Use provided UUID if given (hydrate path uses randomUUID for globally unique IDs),
    // otherwise fall back to deterministic index-based UUID (dehydrate/fixture path).
    // sessionStorage.ts deduplicates messages by UUID, so without unique UUIDs across
    // VCR calls, resumed sessions would treat different responses as duplicates.
    uuid: uuid ?? (`UUID-${index}` as unknown as UUID),
    requestId: 'REQUEST_ID',
    timestamp: message.timestamp,
    message: {
      ...message.message,
      content: message.message.content
        .map(_ => {
          switch (_.type) {
            case 'text':
              return {
                ..._,
                text: f(_.text) as string,
                citations: _.citations || [],
              } // Ensure citations
            case 'tool_use':
              return {
                ..._,
                input: mapValuesDeep(_.input as Record<string, unknown>, f),
              }
            default:
              return _ // Handle other block types unchanged
          }
        })
        .filter(Boolean) as BetaContentBlock[],
    },
    type: 'assistant',
  }
}
// mapAssistantMessage 里最值得读的是 uuid 那三行注释：**回放（hydrate）路径传 randomUUID，保证全局唯一；录制 / fixture 路径用 `UUID-${index}` 的确定性值**。为什么必须区分——`sessionStorage.ts` 按 uuid 去重消息，若 VCR 多次调用都返回同一个 uuid，恢复会话时会把不同响应当成重复消息丢掉。另外两处形状补齐：`requestId` 固定为 'REQUEST_ID'（易变且无意义），text 块补 `citations: []`（保证下游拿到的块形状完整）。

function mapMessage(
  message: AssistantMessage | SystemAPIErrorMessage | StreamEvent,
  f: (s: unknown) => unknown,
  index: number,
  uuid?: UUID,
): AssistantMessage | SystemAPIErrorMessage | StreamEvent {
  if (message.type === 'assistant') {
    return mapAssistantMessage(message, f, index, uuid)
  } else {
    return message
  }
}
// mapMessage 的分派很窄：只有 `assistant` 需要脱敏 / 还原，`SystemAPIErrorMessage` 与 `StreamEvent` 原样返回——它们不含路径、UUID、成本这类随环境漂移的内容，改了反而破坏协议。

function dehydrateValue(s: unknown): unknown {
  if (typeof s !== 'string') {
    return s
  }
  const cwd = getCwd()
  const configHome = getClaudeConfigHomeDir()
  let s1 = s
    .replace(/num_files="\d+"/g, 'num_files="[NUM]"')
    .replace(/duration_ms="\d+"/g, 'duration_ms="[DURATION]"')
    .replace(/cost_usd="\d+"/g, 'cost_usd="[COST]"')
    // Note: We intentionally don't replace all forward slashes with path.sep here.
    // That would corrupt XML-like tags (e.g., </system-reminder> -> <\system-reminder>).
    // The [CONFIG_HOME] and [CWD] replacements below handle path normalization.
    .replaceAll(configHome, '[CONFIG_HOME]')
    .replaceAll(cwd, '[CWD]')
    .replace(/Available commands:.+/, 'Available commands: [COMMANDS]')
  // On Windows, paths may appear in multiple forms:
  // 1. Forward-slash variants (Git, some Node APIs)
  // 2. JSON-escaped variants (backslashes doubled in serialized JSON within messages)
  if (process.platform === 'win32') {
    const cwdFwd = cwd.replaceAll('\\', '/')
    const configHomeFwd = configHome.replaceAll('\\', '/')
    // jsonStringify escapes \ to \\ - match paths embedded in JSON strings
    const cwdJsonEscaped = jsonStringify(cwd).slice(1, -1)
    const configHomeJsonEscaped = jsonStringify(configHome).slice(1, -1)
    s1 = s1
      .replaceAll(cwdJsonEscaped, '[CWD]')
      .replaceAll(configHomeJsonEscaped, '[CONFIG_HOME]')
      .replaceAll(cwdFwd, '[CWD]')
      .replaceAll(configHomeFwd, '[CONFIG_HOME]')
  }
  // Normalize backslash path separators after placeholders so VCR fixture
  // hashes match across platforms (e.g., [CWD]\foo\bar -> [CWD]/foo/bar)
  // Handle both single backslashes and JSON-escaped double backslashes (\\)
  s1 = s1
    .replace(/\[CWD\][^\s"'<>]*/g, match =>
      match.replaceAll('\\\\', '/').replaceAll('\\', '/'),
    )
    .replace(/\[CONFIG_HOME\][^\s"'<>]*/g, match =>
      match.replaceAll('\\\\', '/').replaceAll('\\', '/'),
    )
  if (s1.includes('Files modified by user:')) {
    return 'Files modified by user: [FILES]'
  }
  return s1
}
// dehydrateValue 是**让 fixture 跨机器、跨平台稳定的核心**，替换分四组：① 数值类 `num_files` / `duration_ms` / `cost_usd` → 占位符；② 路径类 configHome / cwd → `[CONFIG_HOME]` / `[CWD]`；③ Windows 的三副面孔都要覆盖——正斜杠、JSON 转义的双反斜杠（`jsonStringify` 后 slice 掉首尾引号得到）、原生反斜杠，因为同一路径在消息里可能以任意一种形式出现；④ 最后把 `[CWD]` / `[CONFIG_HOME]` 之后的**分隔符统一成正斜杠**，这样 Windows 与 Unix 的 hash 才会一致。注释里那条「不能无脑把 `/` 换成 path.sep」很重要：那会把 XML 标签 `</system-reminder>` 毁成 `<\system-reminder>`。`Files modified by user:` 整段则直接压成 `[FILES]`——文件列表每次都不一样，留着必然 miss。

function hydrateValue(s: unknown): unknown {
  if (typeof s !== 'string') {
    return s
  }
  return s
    .replaceAll('[NUM]', '1')
    .replaceAll('[DURATION]', '100')
    .replaceAll('[CONFIG_HOME]', getClaudeConfigHomeDir())
    .replaceAll('[CWD]', getCwd())
}
// hydrateValue 是反向替换：[NUM]→1、[DURATION]→100、[CONFIG_HOME] / [CWD] 换成当前机器的真实路径。注意 **[COST] 故意不还原**——成本占位符只为了 hash 稳定，回放时成本由 `addCachedCostToTotalSessionCost` 现算，还原它反而会污染统计。[NUM] / [DURATION] 给固定值也是同样思路：只求「形状合法」。

export async function* withStreamingVCR(
  messages: Message[],
  f: () => AsyncGenerator<
    StreamEvent | AssistantMessage | SystemAPIErrorMessage,
    void
  >,
): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
> {
  if (!shouldUseVCR()) {
    return yield* f()
  }

  // Compute and yield messages
  const buffer: (StreamEvent | AssistantMessage | SystemAPIErrorMessage)[] = []

  // Record messages (or fetch from cache)
  const cachedBuffer = await withVCR(messages, async () => {
    for await (const message of f()) {
      buffer.push(message)
    }
    return buffer
  })

  if (cachedBuffer.length > 0) {
    yield* cachedBuffer
    return
  }

  yield* buffer
}
// withStreamingVCR 的思路是「先把流跑完，再交给缓存层」：`for await` 把生成器的所有消息推进 buffer（同时顺手喂给 withVCR 录制），拿到 cache 后**若缓存非空就 yield 缓存，否则 yield 刚录的 buffer**。两条路径产出完全一致的消息序列，调用方无感。为什么不能边流边写 fixture——fixture 要存完整输出，写到一半的文件下次会被当成损坏缓存。

export async function withTokenCountVCR(
  messages: unknown[],
  tools: unknown[],
  f: () => Promise<number | null>,
): Promise<number | null> {
  // Dehydrate before hashing so fixture keys survive cwd/config-home/tempdir
  // variation and message UUID/timestamp churn. System prompts embed the
  // working directory (both raw and as a slash→dash project slug in the
  // auto-memory path) and messages carry fresh UUIDs per run; without this,
  // every test run produces a new hash and fixtures never hit in CI.
  const cwdSlug = getCwd().replace(/[^a-zA-Z0-9]/g, '-')
  const dehydrated = (
    dehydrateValue(jsonStringify({ messages, tools })) as string
  )
    .replaceAll(cwdSlug, '[CWD_SLUG]')
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '[UUID]',
    )
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, '[TIMESTAMP]')
  const result = await withFixture(dehydrated, 'token-count', async () => ({
    tokenCount: await f(),
  }))
  return result.tokenCount
}
// withTokenCountVCR 的脱敏比消息路径更狠，因为 token 计数的输入里混着三类高漂移内容：① cwd 的「斜杠化 slug」（`/[^a-zA-Z0-9]/g → '-'`）——system prompt 的 auto-memory 路径里嵌着项目目录名；② 每条消息都不同的 UUID；③ ISO 时间戳。三者不替换，每次跑测试 hash 都变，CI 里的 fixture 永远命中不了。注释把「为什么不脱敏就会失效」写在了函数开头，是很好的排障线索。
