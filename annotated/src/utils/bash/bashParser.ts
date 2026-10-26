/**
 * Pure-TypeScript bash parser producing tree-sitter-bash-compatible ASTs.
 *
 * Downstream code in parser.ts, ast.ts, prefix.ts, ParsedCommand.ts walks this
 * by field name. startIndex/endIndex are UTF-8 BYTE offsets (not JS string
 * indices).
 *
 * Grammar reference: tree-sitter-bash. Validated against a 3449-input golden
 * corpus generated from the WASM parser.
 */
// 文件头。这是一个纯 TypeScript 手写的 bash 解析器，产出与 tree-sitter-bash 兼容的 AST。下游（parser.ts、ast.ts、prefix.ts、ParsedCommand.ts）按字段名遍历这棵树。两个关键约定：startIndex/endIndex 是 UTF-8 字节偏移而非 JS 字符串下标；正确性用 3449 条输入的金标准语料（从 WASM 版解析器生成）对齐验证。为什么手写：摆脱 WASM 依赖、可控超时，同时保持 AST 形状逐字节兼容以便安全行走器复用。

export type TsNode = {
  type: string
  text: string
  startIndex: number
  endIndex: number
  children: TsNode[]
}
// TsNode：最小 AST 节点——类型名、原文切片、字节起止、子节点。text 永远等于对源串按字节范围切片的结果。

type ParserModule = {
  parse: (source: string, timeoutMs?: number) => TsNode | null
}
// ParserModule：与 WASM 版解析器同形的接口（parse 返回 null 表示放弃）。换实现时下游无感。

/**
 * 50ms wall-clock cap — bails out on pathological/adversarial input.
 * Pass `Infinity` via `parse(src, Infinity)` to disable (e.g. correctness
 * tests, where CI jitter would otherwise cause spurious null returns).
 */
const PARSE_TIMEOUT_MS = 50
// 50ms 墙钟上限——恶意/病态输入直接放弃返回 null。正确性测试可传 Infinity 关闭（否则 CI 抖动会造成偶发 null）。

/** Node budget cap — bails out before OOM on deeply nested input. */
const MAX_NODES = 50_000
// 节点数上限 5 万——深嵌套输入在 OOM 之前就被拦下。两个预算都在 mk（建节点）时统一检查。

const MODULE: ParserModule = { parse: parseSource }
// 模块单例：parse 直接指向本文件的 parseSource；READY 是已完成的 Promise，保持与异步初始化的 WASM 版 API 兼容。

const READY = Promise.resolve()

/** No-op: pure-TS parser needs no async init. Kept for API compatibility. */
export function ensureParserInitialized(): Promise<void> {
  return READY
}
// ensureParserInitialized：纯 TS 无需异步初始化，返回即完成的 Promise——纯粹为了 API 兼容保留。

/** Always succeeds — pure-TS needs no init. */
export function getParserModule(): ParserModule | null {
  return MODULE
}
// getParserModule：永远成功（无需 init）。调用方拿到的模块永不为 null。

// ───────────────────────────── Tokenizer ─────────────────────────────
// 分隔注释：词法器（Tokenizer）部分开始。

type TokenType =
  | 'WORD'
  | 'NUMBER'
  | 'OP'
  | 'NEWLINE'
  | 'COMMENT'
  | 'DQUOTE'
  | 'SQUOTE'
  | 'ANSI_C'
  | 'DOLLAR'
  | 'DOLLAR_PAREN'
  | 'DOLLAR_BRACE'
  | 'DOLLAR_DPAREN'
  | 'BACKTICK'
  | 'LT_PAREN'
  | 'GT_PAREN'
  | 'EOF'

// TokenType：16 种 token。注意 OP 涵盖所有多字符操作符（&& || ;; << >> 等）；DOLLAR 系列按后续字符细分（$( ${ $(( $' ）；LT_PAREN/GT_PAREN 是进程替换 <( >(。
type Token = {
  type: TokenType
  value: string
  /** UTF-8 byte offset of first char */
  start: number
  /** UTF-8 byte offset one past last char */
  end: number
}
// Token：start/end 也是 UTF-8 字节偏移——与 AST 节点同一坐标系。

const SPECIAL_VARS = new Set(['?', '$', '@', '*', '#', '-', '!', '_'])
// SPECIAL_VARS：bash 特殊变量 ? $ @ * # - ! _——$ 后跟这些字符走 special_variable_name 节点。

const DECL_KEYWORDS = new Set([
  'export',
  'declare',
  'typeset',
  'readonly',
  'local',
])
// DECL_KEYWORDS：声明类内建（export/declare/typeset/readonly/local），后随变量赋值语法，需要专门的 declaration_command 节点。

export const SHELL_KEYWORDS = new Set([
  'if',
  'then',
  'elif',
  'else',
  'fi',
  'while',
  'until',
  'for',
  'in',
  'do',
  'done',
  'case',
  'esac',
  'function',
  'select',
])
// SHELL_KEYWORDS：保留字全集（if/fi/case/esac 等）。在词法层面是 WORD，由语法层按位置决定是否当关键字。导出供别处判断。

/**
 * Lexer state. Tracks both JS-string index (for charAt) and UTF-8 byte offset
 * (for TsNode positions). ASCII fast path: byte == char index. Non-ASCII
 * advances byte count per-codepoint.
 */
type Lexer = {
  src: string
  len: number
  /** JS string index */
  i: number
  /** UTF-8 byte offset */
  b: number
  /** Pending heredoc delimiters awaiting body scan at next newline */
  heredocs: HeredocPending[]
  /** Precomputed byte offset for each char index (lazy for non-ASCII) */
  byteTable: Uint32Array | null
}
// Lexer：双坐标系状态——i 是 JS 字符串下标（charAt 用），b 是 UTF-8 字节偏移（AST 位置用）。ASCII 快路径两者相等；含非 ASCII 时惰性构建 byteTable（每个字符下标的字节偏移表）。heredocs 挂起待下一换行扫描正文。

type HeredocPending = {
  delim: string
  stripTabs: boolean
  quoted: boolean
  /** Filled after body scan */
  bodyStart: number
  bodyEnd: number
  endStart: number
  endEnd: number
}
// HeredocPending：heredoc 的挂起记录——定界符、是否 <<-剥 tab、是否引号定界（决定正文要不要解析展开）、正文与结束行的字节范围。

function makeLexer(src: string): Lexer {
  return {
    src,
    len: src.length,
    i: 0,
    b: 0,
    heredocs: [],
    byteTable: null,
  }
}
// makeLexer：初始状态，byteTable 惰性为 null。

/** Advance one JS char, updating byte offset for UTF-8. */
function advance(L: Lexer): void {
  const c = L.src.charCodeAt(L.i)
  L.i++
  if (c < 0x80) {
    L.b++
  } else if (c < 0x800) {
    L.b += 2
  } else if (c >= 0xd800 && c <= 0xdbff) {
    // High surrogate — next char completes the pair, total 4 UTF-8 bytes
    L.b += 4
    L.i++
  } else {
    L.b += 3
  }
}
// advance：推进一个 JS 字符并同步字节偏移。按码点分支：ASCII 加 1、二字节加 2、高位代理对（与下一字符成对）加 4、其余加 3。

function peek(L: Lexer, off = 0): string {
  return L.i + off < L.len ? L.src[L.i + off]! : ''
}
// peek：带偏移的前看，越界返回空串。

function byteAt(L: Lexer, charIdx: number): number {
  // Fast path: ASCII-only prefix means char idx == byte idx
  if (L.byteTable) return L.byteTable[charIdx]!
  // Build table on first non-trivial lookup
  const t = new Uint32Array(L.len + 1)
  let b = 0
  let i = 0
  while (i < L.len) {
    t[i] = b
    const c = L.src.charCodeAt(i)
    if (c < 0x80) {
      b++
      i++
    } else if (c < 0x800) {
      b += 2
      i++
    } else if (c >= 0xd800 && c <= 0xdbff) {
      t[i + 1] = b + 2
      b += 4
      i += 2
    } else {
      b += 3
      i++
    }
  }
  t[L.len] = b
  L.byteTable = t
  return t[charIdx]!
}
// byteAt：查/建字节偏移表。快路径：byteTable 未建且从未遇到非 ASCII 时字符下标即字节下标；首个非平凡查询触发整表构建（O(n) 一次，之后 O(1)）。代理对占两个字符下标但共享同一字节起点。

function isWordChar(c: string): boolean {
  // Bash word chars: alphanumeric + various punctuation that doesn't start operators
  return (
    (c >= 'a' && c <= 'z') ||
    (c >= 'A' && c <= 'Z') ||
    (c >= '0' && c <= '9') ||
    c === '_' ||
    c === '/' ||
    c === '.' ||
    c === '-' ||
    c === '+' ||
    c === ':' ||
    c === '@' ||
    c === '%' ||
    c === ',' ||
    c === '~' ||
    c === '^' ||
    c === '?' ||
    c === '*' ||
    c === '!' ||
    c === '=' ||
    c === '[' ||
    c === ']'
  )
}
// isWordChar：bash 单词字符集——字母数字加一堆不会引发操作符歧义的标点（/ . - + : @ % 等）。注意 * ? ! = [ ] 也算单词字符（glob 与下标语义），由上下文区分。

function isWordStart(c: string): boolean {
  return isWordChar(c) || c === '\\'
}
// isWordStart：单词起始多允许一个反斜杠（转义起始）。

function isIdentStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'
}

function isIdentChar(c: string): boolean {
  return isIdentStart(c) || (c >= '0' && c <= '9')
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9'
}

function isHexDigit(c: string): boolean {
  return isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

function isBaseDigit(c: string): boolean {
  // Bash BASE#DIGITS: digits, letters, @ and _ (up to base 64)
  return isIdentChar(c) || c === '@'
}
// isBaseDigit：BASE#DIGITS 进制记法的数字集——字母数字加 @（bash 支持到 64 进制）。

/**
 * Unquoted heredoc delimiter chars. Bash accepts most non-metacharacters —
 * not just identifiers. Stop at whitespace, redirects, pipe/list operators,
 * and structural tokens. Allows !, -, ., +, etc. (e.g. <<!HEREDOC!).
 */
function isHeredocDelimChar(c: string): boolean {
  return (
    c !== '' &&
    c !== ' ' &&
    c !== '\t' &&
    c !== '\n' &&
    c !== '<' &&
    c !== '>' &&
    c !== '|' &&
    c !== '&' &&
    c !== ';' &&
    c !== '(' &&
    c !== ')' &&
    c !== "'" &&
    c !== '"' &&
    c !== '`' &&
    c !== '\\'
  )
}
// isHeredocDelimChar：未加引号 heredoc 定界符的合法字符——bash 接受大多数非元字符（不只标识符），允许 ! - . + 等（如 <<!HEREDOC!），停在空白/重定向/管道/结构符。

function skipBlanks(L: Lexer): void {
  while (L.i < L.len) {
    const c = L.src[L.i]!
    if (c === ' ' || c === '\t' || c === '\r') {
      // \r is whitespace per tree-sitter-bash extras /\s/ — handles CRLF inputs
      advance(L)
    } else if (c === '\\') {
      const nx = L.src[L.i + 1]
      if (nx === '\n' || (nx === '\r' && L.src[L.i + 2] === '\n')) {
        // Line continuation — tree-sitter extras: /\\\r?\n/
        advance(L)
        advance(L)
        if (nx === '\r') advance(L)
      } else if (nx === ' ' || nx === '\t') {
        // \<space> or \<tab> — tree-sitter's _whitespace is /\\?[ \t\v]+/
        advance(L)
        advance(L)
      } else {
        break
      }
    } else {
      break
    }
  }
}
// skipBlanks：跳过空白与换行连接符。细节对齐 tree-sitter extras：CR 按空白处理（兼容 CRLF 输入）；反斜杠换行是行连接；反斜杠加空格/tab 是 tree-sitter 的 _whitespace 规则（转义空白）。

/**
 * Scan next token. Context-sensitive: `cmd` mode treats [ as operator (test
 * command start), `arg` mode treats [ as word char (glob/subscript).
 */
// nextToken：上下文敏感的取词器。ctx=cmd 时 [ [[ { ! 是操作符（test 命令/组开始）；ctx=arg 时是普通单词字符（glob/下标）。这一个参数决定了大量歧义的走向。
function nextToken(L: Lexer, ctx: 'cmd' | 'arg' = 'arg'): Token {
  skipBlanks(L)
  const start = L.b
  if (L.i >= L.len) return { type: 'EOF', value: '', start, end: start }

  const c = L.src[L.i]!
  const c1 = peek(L, 1)
  const c2 = peek(L, 2)

  if (c === '\n') {
    advance(L)
    return { type: 'NEWLINE', value: '\n', start, end: L.b }
  }

  if (c === '#') {
    const si = L.i
    while (L.i < L.len && L.src[L.i] !== '\n') advance(L)
    return {
      type: 'COMMENT',
      value: L.src.slice(si, L.i),
      start,
      end: L.b,
    }
  }

  // Multi-char operators (longest match first)
// 操作符词法从最长匹配开始：三字符（<<< 与 <<-、;;& &>>）优先，两字符次之（&& || ;;& ;; ;& >> >& >| &> << <& 等），单字符兜底。顺序错了就会把 << 切成两个 <。
  if (c === '&' && c1 === '&') {
    advance(L)
    advance(L)
    return { type: 'OP', value: '&&', start, end: L.b }
  }
  if (c === '|' && c1 === '|') {
    advance(L)
    advance(L)
    return { type: 'OP', value: '||', start, end: L.b }
  }
  if (c === '|' && c1 === '&') {
    advance(L)
    advance(L)
    return { type: 'OP', value: '|&', start, end: L.b }
  }
  if (c === ';' && c1 === ';' && c2 === '&') {
    advance(L)
    advance(L)
    advance(L)
    return { type: 'OP', value: ';;&', start, end: L.b }
  }
  if (c === ';' && c1 === ';') {
    advance(L)
    advance(L)
    return { type: 'OP', value: ';;', start, end: L.b }
  }
  if (c === ';' && c1 === '&') {
    advance(L)
    advance(L)
    return { type: 'OP', value: ';&', start, end: L.b }
  }
  if (c === '>' && c1 === '>') {
    advance(L)
    advance(L)
    return { type: 'OP', value: '>>', start, end: L.b }
  }
  if (c === '>' && c1 === '&' && c2 === '-') {
    advance(L)
    advance(L)
    advance(L)
    return { type: 'OP', value: '>&-', start, end: L.b }
  }
  if (c === '>' && c1 === '&') {
    advance(L)
    advance(L)
    return { type: 'OP', value: '>&', start, end: L.b }
  }
  if (c === '>' && c1 === '|') {
    advance(L)
    advance(L)
    return { type: 'OP', value: '>|', start, end: L.b }
  }
  if (c === '&' && c1 === '>' && c2 === '>') {
    advance(L)
    advance(L)
    advance(L)
    return { type: 'OP', value: '&>>', start, end: L.b }
  }
  if (c === '&' && c1 === '>') {
    advance(L)
    advance(L)
    return { type: 'OP', value: '&>', start, end: L.b }
  }
  if (c === '<' && c1 === '<' && c2 === '<') {
    advance(L)
    advance(L)
    advance(L)
    return { type: 'OP', value: '<<<', start, end: L.b }
  }
  if (c === '<' && c1 === '<' && c2 === '-') {
    advance(L)
    advance(L)
    advance(L)
    return { type: 'OP', value: '<<-', start, end: L.b }
  }
  if (c === '<' && c1 === '<') {
    advance(L)
    advance(L)
    return { type: 'OP', value: '<<', start, end: L.b }
  }
  if (c === '<' && c1 === '&' && c2 === '-') {
    advance(L)
    advance(L)
    advance(L)
    return { type: 'OP', value: '<&-', start, end: L.b }
  }
  if (c === '<' && c1 === '&') {
    advance(L)
    advance(L)
    return { type: 'OP', value: '<&', start, end: L.b }
  }
  if (c === '<' && c1 === '(') {
    advance(L)
    advance(L)
    return { type: 'LT_PAREN', value: '<(', start, end: L.b }
  }
  if (c === '>' && c1 === '(') {
    advance(L)
    advance(L)
    return { type: 'GT_PAREN', value: '>(', start, end: L.b }
  }
  if (c === '(' && c1 === '(') {
    advance(L)
    advance(L)
    return { type: 'OP', value: '((', start, end: L.b }
  }
  if (c === ')' && c1 === ')') {
    advance(L)
    advance(L)
    return { type: 'OP', value: '))', start, end: L.b }
  }

  if (c === '|' || c === '&' || c === ';' || c === '>' || c === '<') {
    advance(L)
    return { type: 'OP', value: c, start, end: L.b }
  }
// 单字符操作符兜底：| & ; > < ( )。到这里的多字符组合全部尝试过了。
  if (c === '(' || c === ')') {
    advance(L)
    return { type: 'OP', value: c, start, end: L.b }
  }

  // In cmd position, [ [[ { start test/group; in arg position they're word chars
  if (ctx === 'cmd') {
    if (c === '[' && c1 === '[') {
      advance(L)
      advance(L)
      return { type: 'OP', value: '[[', start, end: L.b }
    }
    if (c === '[') {
      advance(L)
      return { type: 'OP', value: '[', start, end: L.b }
    }
    if (c === '{' && (c1 === ' ' || c1 === '\t' || c1 === '\n')) {
      advance(L)
      return { type: 'OP', value: '{', start, end: L.b }
    }
    if (c === '}') {
      advance(L)
      return { type: 'OP', value: '}', start, end: L.b }
    }
    if (c === '!' && (c1 === ' ' || c1 === '\t')) {
      advance(L)
      return { type: 'OP', value: '!', start, end: L.b }
    }
  }
// cmd 上下文专属：[[ 与 [ 开 test 命令；{ 后跟空白才算组开始（${var} 的 { 不算）；! 后跟空白是取反。arg 上下文里这些全是普通字符——glob 与下标因此不被误切。

  if (c === '"') {
    advance(L)
    return { type: 'DQUOTE', value: '"', start, end: L.b }
  }
  if (c === "'") {
    const si = L.i
    advance(L)
    while (L.i < L.len && L.src[L.i] !== "'") advance(L)
    if (L.i < L.len) advance(L)
    return {
      type: 'SQUOTE',
      value: L.src.slice(si, L.i),
      start,
      end: L.b,
    }
  }
// SQUOTE：单引号串整段吞到闭引号（内部无转义），value 保留原文含引号——对应 AST 的 raw_string。

  if (c === '$') {
    if (c1 === '(' && c2 === '(') {
      advance(L)
      advance(L)
      advance(L)
      return { type: 'DOLLAR_DPAREN', value: '$((', start, end: L.b }
    }
    if (c1 === '(') {
      advance(L)
      advance(L)
      return { type: 'DOLLAR_PAREN', value: '$(', start, end: L.b }
    }
    if (c1 === '{') {
      advance(L)
      advance(L)
      return { type: 'DOLLAR_BRACE', value: '${', start, end: L.b }
    }
    if (c1 === "'") {
      // ANSI-C string $'...'
      const si = L.i
      advance(L)
      advance(L)
      while (L.i < L.len && L.src[L.i] !== "'") {
        if (L.src[L.i] === '\\' && L.i + 1 < L.len) advance(L)
        advance(L)
      }
      if (L.i < L.len) advance(L)
      return {
        type: 'ANSI_C',
        value: L.src.slice(si, L.i),
        start,
        end: L.b,
      }
    }
    advance(L)
    return { type: 'DOLLAR', value: '$', start, end: L.b }
  }
// $ 家族：$(($(( 算术、$( 命令替换、${ 参数展开、$ 等 ANSI-C 串（内部转义字符也吞掉）、裸 $。每个变体是独立 token 类型，语法层各走各的分支。

  if (c === '`') {
    advance(L)
    return { type: 'BACKTICK', value: '`', start, end: L.b }
  }
// BACKTICK：反引号只出单字符 token，配对由语法层 inBacktick 深度计数处理。

  // File descriptor before redirect: digit+ immediately followed by > or <
  if (isDigit(c)) {
    let j = L.i
    while (j < L.len && isDigit(L.src[j]!)) j++
    const after = j < L.len ? L.src[j]! : ''
    if (after === '>' || after === '<') {
      const si = L.i
      while (L.i < j) advance(L)
      return {
        type: 'WORD',
        value: L.src.slice(si, L.i),
        start,
        end: L.b,
      }
    }
  }
// 文件描述符前缀：数字紧跟 > 或 < 时（如 2>/dev/null）切成独立 WORD——否则 2 会被当普通参数。

  // Word / number
  if (isWordStart(c) || c === '{' || c === '}') {
    const si = L.i
    while (L.i < L.len) {
      const ch = L.src[L.i]!
      if (ch === '\\') {
        if (L.i + 1 >= L.len) {
          // Trailing `\` at EOF — tree-sitter excludes it from the word and
          // emits a sibling ERROR. Stop here so the word ends before `\`.
          break
        }
        // Escape next char (including \n for line continuation mid-word)
        if (L.src[L.i + 1] === '\n') {
          advance(L)
          advance(L)
          continue
        }
        advance(L)
        advance(L)
        continue
      }
      if (!isWordChar(ch) && ch !== '{' && ch !== '}') {
        break
      }
      advance(L)
    }
    if (L.i > si) {
      const v = L.src.slice(si, L.i)
      // Number: optional sign then digits only
      if (/^-?\d+$/.test(v)) {
        return { type: 'NUMBER', value: v, start, end: L.b }
      }
      return { type: 'WORD', value: v, start, end: L.b }
    }
    // Empty word (lone `\` at EOF) — fall through to single-char consumer
  }

  // Unknown char — consume as single-char word
  advance(L)
  return { type: 'WORD', value: c, start, end: L.b }
}
// nextToken 收尾：普通单词扫描（内部处理反斜杠转义与行连接，EOF 处孤立反斜杠留给兄弟 ERROR 节点——对齐 tree-sitter）；纯数字串标 NUMBER；全不认识的字符当单字符 WORD。

// ───────────────────────────── Parser ─────────────────────────────
// 分隔注释：语法器（Parser）部分开始。递归下降 + 回溯（saveLex/restoreLex）。

type ParseState = {
  L: Lexer
  src: string
  srcBytes: number
  /** True when byte offsets == char indices (no multi-byte UTF-8) */
  isAscii: boolean
  nodeCount: number
  deadline: number
  aborted: boolean
  /** Depth of backtick nesting — inside `...`, ` terminates words */
  inBacktick: number
  /** When set, parseSimpleCommand stops at this token (for `[` backtrack) */
  stopToken: string | null
}
// ParseState：语法器全局状态——词法器、源串与字节长、isAscii 快路径标记、节点计数与墙钟 deadline（预算控制）、inBacktick 嵌套深度、stopToken（[ 回溯时让 parseSimpleCommand 在 ] 前停下）。

function parseSource(source: string, timeoutMs?: number): TsNode | null {
  const L = makeLexer(source)
  const srcBytes = byteLengthUtf8(source)
  const P: ParseState = {
    L,
    src: source,
    srcBytes,
    isAscii: srcBytes === source.length,
    nodeCount: 0,
    deadline: performance.now() + (timeoutMs ?? PARSE_TIMEOUT_MS),
    aborted: false,
    inBacktick: 0,
    stopToken: null,
  }
  try {
    const program = parseProgram(P)
    if (P.aborted) return null
    return program
  } catch {
    return null
  }
}
// parseSource：入口。构建状态、解析 program、被预算中止（aborted 标记）或抛异常（如 budget/timeout）都返回 null——调用方必须处理 null（回退安全判定）。

function byteLengthUtf8(s: string): number {
  let b = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) b++
    else if (c < 0x800) b += 2
    else if (c >= 0xd800 && c <= 0xdbff) {
      b += 4
      i++
    } else b += 3
  }
  return b
}
// byteLengthUtf8：整串 UTF-8 字节数，一次扫完，顺带判定 isAscii。

function checkBudget(P: ParseState): void {
  P.nodeCount++
  if (P.nodeCount > MAX_NODES) {
    P.aborted = true
    throw new Error('budget')
  }
  if ((P.nodeCount & 0x7f) === 0 && performance.now() > P.deadline) {
    P.aborted = true
    throw new Error('timeout')
  }
}
// checkBudget：节点计数 +1；超 5 万抛 budget；每 128 个节点查一次墙钟超 deadline 抛 timeout——用位掩码把昂贵的时间查询摊薄 128 倍。

/** Build a node. Slices text from source by byte range via char-index lookup. */
function mk(
  P: ParseState,
  type: string,
  start: number,
  end: number,
  children: TsNode[],
): TsNode {
  checkBudget(P)
  return {
    type,
    text: sliceBytes(P, start, end),
    startIndex: start,
    endIndex: end,
    children,
  }
}
// mk：建节点统一入口。先过预算检查，再按字节范围切原文（ASCII 直接 slice，非 ASCII 走二分查找）。

function sliceBytes(P: ParseState, startByte: number, endByte: number): string {
  if (P.isAscii) return P.src.slice(startByte, endByte)
  // Find char indices for byte offsets. Build byte table if needed.
  const L = P.L
  if (!L.byteTable) byteAt(L, 0)
  const t = L.byteTable!
  // Binary search for char index where byte offset matches
  let lo = 0
  let hi = P.src.length
  while (lo < hi) {
    const m = (lo + hi) >>> 1
    if (t[m]! < startByte) lo = m + 1
    else hi = m
  }
  const sc = lo
  lo = sc
  hi = P.src.length
  while (lo < hi) {
    const m = (lo + hi) >>> 1
    if (t[m]! < endByte) lo = m + 1
    else hi = m
  }
  return P.src.slice(sc, lo)
}
// sliceBytes：字节范围 → 原文切片。非 ASCII 时用 byteTable 两次二分定位字符下标再 slice。

function leaf(P: ParseState, type: string, tok: Token): TsNode {
  return mk(P, type, tok.start, tok.end, [])
}
// leaf：从 token 直接造叶子节点（无子节点）。

function parseProgram(P: ParseState): TsNode {
  const children: TsNode[] = []
  // Skip leading whitespace & newlines — program start is first content byte
  skipBlanks(P.L)
  while (true) {
    const save = saveLex(P.L)
    const t = nextToken(P.L, 'cmd')
    if (t.type === 'NEWLINE') {
      skipBlanks(P.L)
      continue
    }
    restoreLex(P.L, save)
    break
  }
  const progStart = P.L.b
  while (P.L.i < P.L.len) {
    const save = saveLex(P.L)
    const t = nextToken(P.L, 'cmd')
    if (t.type === 'EOF') break
    if (t.type === 'NEWLINE') continue
    if (t.type === 'COMMENT') {
      children.push(leaf(P, 'comment', t))
      continue
    }
    restoreLex(P.L, save)
    const stmts = parseStatements(P, null)
    for (const s of stmts) children.push(s)
    if (stmts.length === 0) {
      // Couldn't parse — emit ERROR and skip one token
      const errTok = nextToken(P.L, 'cmd')
      if (errTok.type === 'EOF') break
      // Stray `;;` at program level (e.g., `var=;;` outside case) — tree-sitter
      // silently elides. Keep leading `;` as ERROR (security: paste artifact).
      if (
        errTok.type === 'OP' &&
        errTok.value === ';;' &&
        children.length > 0
      ) {
        continue
      }
      children.push(mk(P, 'ERROR', errTok.start, errTok.end, []))
    }
  }
  // tree-sitter includes trailing whitespace in program extent
  const progEnd = children.length > 0 ? P.srcBytes : progStart
  return mk(P, 'program', progStart, progEnd, children)
}
// parseProgram：顶层循环。先跳过前导空白换行定程序起点；主循环里 NEWLINE 跳过、COMMENT 收为 comment 叶子、其余交 parseStatements；解析失败时发 ERROR 节点并跳一个 token（错误恢复）；顶层孤立的 ;; 被静默吞掉（对齐 tree-sitter，但保留安全性——粘贴残留的 ; 是危险信号所以留 ERROR）。程序范围含尾部空白，对齐 tree-sitter。

/** Packed as (b << 16) | i — avoids heap alloc on every backtrack. */
type LexSave = number
function saveLex(L: Lexer): LexSave {
  return L.b * 0x10000 + L.i
}
function restoreLex(L: Lexer, s: LexSave): void {
  L.i = s & 0xffff
  L.b = s >>> 16
}
// saveLex/restoreLex：回溯原语。i 和 b 打包进一个数字（b<<16 | i）——每次回溯零堆分配。

/**
 * Parse a sequence of statements separated by ; & newline. Returns a flat list
 * where ; and & are sibling leaves (NOT wrapped in 'list' — only && || get
 * that). Stops at terminator or EOF.
 */
// parseStatements：分号/与号/换行分隔的语句序列。注意 ; 与 & 是平铺的兄弟叶子（不包 list 节点——只有 && || 才有 list）。terminator 指定本层的闭合符（) } 等）；then/fi/done/esac 等关键字也是隐式终止。换行处是 heredoc 正文的扫描时机。
function parseStatements(P: ParseState, terminator: string | null): TsNode[] {
  const out: TsNode[] = []
  while (true) {
    skipBlanks(P.L)
    const save = saveLex(P.L)
    const t = nextToken(P.L, 'cmd')
    if (t.type === 'EOF') {
      restoreLex(P.L, save)
      break
    }
    if (t.type === 'NEWLINE') {
      // Process pending heredocs
      if (P.L.heredocs.length > 0) {
        scanHeredocBodies(P)
      }
      continue
    }
    if (t.type === 'COMMENT') {
      out.push(leaf(P, 'comment', t))
      continue
    }
    if (terminator && t.type === 'OP' && t.value === terminator) {
      restoreLex(P.L, save)
      break
    }
    if (
      t.type === 'OP' &&
      (t.value === ')' ||
        t.value === '}' ||
        t.value === ';;' ||
        t.value === ';&' ||
        t.value === ';;&' ||
        t.value === '))' ||
        t.value === ']]' ||
        t.value === ']')
    ) {
      restoreLex(P.L, save)
      break
    }
    if (t.type === 'BACKTICK' && P.inBacktick > 0) {
      restoreLex(P.L, save)
      break
    }
    if (
      t.type === 'WORD' &&
      (t.value === 'then' ||
        t.value === 'elif' ||
        t.value === 'else' ||
        t.value === 'fi' ||
        t.value === 'do' ||
        t.value === 'done' ||
        t.value === 'esac')
    ) {
      restoreLex(P.L, save)
      break
    }
    restoreLex(P.L, save)
    const stmt = parseAndOr(P)
    if (!stmt) break
    out.push(stmt)
    // Look for separator
    skipBlanks(P.L)
    const save2 = saveLex(P.L)
    const sep = nextToken(P.L, 'cmd')
    if (sep.type === 'OP' && (sep.value === ';' || sep.value === '&')) {
      // Check if terminator follows — if so, emit separator but stop
      const save3 = saveLex(P.L)
      const after = nextToken(P.L, 'cmd')
      restoreLex(P.L, save3)
      out.push(leaf(P, sep.value, sep))
      if (
        after.type === 'EOF' ||
        (after.type === 'OP' &&
          (after.value === ')' ||
            after.value === '}' ||
            after.value === ';;' ||
            after.value === ';&' ||
            after.value === ';;&')) ||
        (after.type === 'WORD' &&
          (after.value === 'then' ||
            after.value === 'elif' ||
            after.value === 'else' ||
            after.value === 'fi' ||
            after.value === 'do' ||
            after.value === 'done' ||
            after.value === 'esac'))
      ) {
        // Trailing separator — don't include it at program level unless
        // there's content after. But at inner levels we keep it.
        continue
      }
    } else if (sep.type === 'NEWLINE') {
      if (P.L.heredocs.length > 0) {
        scanHeredocBodies(P)
      }
      continue
    } else {
      restoreLex(P.L, save2)
    }
  }
  // Trim trailing separator if at program level
  return out
}
// parseStatements 收尾：分隔符后若无内容（trailing separator）则不收入；内层闭合符前的处理保持原样。返回平铺列表。

/**
 * Parse pipeline chains joined by && ||. Left-associative nesting.
 * tree-sitter quirk: trailing redirect on the last pipeline wraps the ENTIRE
 * list in a redirected_statement — `a > x && b > y` becomes
 * redirected_statement(list(redirected_statement(a,>x), &&, b), >y).
 */
// parseAndOr：&& || 连接的管道链，左结合。tree-sitter 怪癖：末尾管道带重定向时整个 list 会被 wrapped_statement 包住——a > x && b > y 变成 redirected_statement(list(...), >y)，这里精确复刻该形状。
function parseAndOr(P: ParseState): TsNode | null {
  let left = parsePipeline(P)
  if (!left) return null
  while (true) {
    const save = saveLex(P.L)
    const t = nextToken(P.L, 'cmd')
    if (t.type === 'OP' && (t.value === '&&' || t.value === '||')) {
      const op = leaf(P, t.value, t)
      skipNewlines(P)
      const right = parsePipeline(P)
      if (!right) {
        left = mk(P, 'list', left.startIndex, op.endIndex, [left, op])
        break
      }
      // If right is a redirected_statement, hoist its redirects to wrap the list.
      if (right.type === 'redirected_statement' && right.children.length >= 2) {
        const inner = right.children[0]!
        const redirs = right.children.slice(1)
        const listNode = mk(P, 'list', left.startIndex, inner.endIndex, [
          left,
          op,
          inner,
        ])
        const lastR = redirs[redirs.length - 1]!
        left = mk(
          P,
          'redirected_statement',
          listNode.startIndex,
          lastR.endIndex,
          [listNode, ...redirs],
        )
      } else {
        left = mk(P, 'list', left.startIndex, right.endIndex, [left, op, right])
      }
    } else {
      restoreLex(P.L, save)
      break
    }
  }
  return left
}
// parseAndOr 收尾：右侧解析失败（如 && 后直接 EOF）时把操作符与左侧包成残缺 list——错误输入也要有形状。

function skipNewlines(P: ParseState): void {
  while (true) {
    const save = saveLex(P.L)
    const t = nextToken(P.L, 'cmd')
    if (t.type !== 'NEWLINE') {
      restoreLex(P.L, save)
      break
    }
  }
}
// skipNewlines：跨行吞换行（管道符后的续行）。

/**
 * Parse commands joined by | or |&. Flat children with operator leaves.
 * tree-sitter quirk: `a | b 2>nul | c` hoists the redirect on `b` to wrap
 * the preceding pipeline fragment — pipeline(redirected_statement(
 * pipeline(a,|,b), 2>nul), |, c).
 */
// parsePipeline：| 或 |& 连接的命令链，平铺子节点加操作符叶子。tree-sitter 怪癖：管道中段的尾部重定向会提升包裹前段——a | b 2>nul | c 变成 pipeline(redirected_statement(pipeline(a,|,b), 2>nul), |, c)，这里同样复刻。
function parsePipeline(P: ParseState): TsNode | null {
  let first = parseCommand(P)
  if (!first) return null
  const parts: TsNode[] = [first]
  while (true) {
    const save = saveLex(P.L)
    const t = nextToken(P.L, 'cmd')
    if (t.type === 'OP' && (t.value === '|' || t.value === '|&')) {
      const op = leaf(P, t.value, t)
      skipNewlines(P)
      const next = parseCommand(P)
      if (!next) {
        parts.push(op)
        break
      }
      // Hoist trailing redirect on `next` to wrap current pipeline fragment
      if (
        next.type === 'redirected_statement' &&
        next.children.length >= 2 &&
        parts.length >= 1
      ) {
        const inner = next.children[0]!
        const redirs = next.children.slice(1)
        // Wrap existing parts + op + inner as a pipeline
        const pipeKids = [...parts, op, inner]
        const pipeNode = mk(
          P,
          'pipeline',
          pipeKids[0]!.startIndex,
          inner.endIndex,
          pipeKids,
        )
        const lastR = redirs[redirs.length - 1]!
        const wrapped = mk(
          P,
          'redirected_statement',
          pipeNode.startIndex,
          lastR.endIndex,
          [pipeNode, ...redirs],
        )
        parts.length = 0
        parts.push(wrapped)
        first = wrapped
        continue
      }
      parts.push(op, next)
    } else {
      restoreLex(P.L, save)
      break
    }
  }
  if (parts.length === 1) return parts[0]!
  const last = parts[parts.length - 1]!
  return mk(P, 'pipeline', parts[0]!.startIndex, last.endIndex, parts)
}
// parsePipeline 收尾：只有一个片段时直接返回该片段（不包 pipeline 节点）。

/** Parse a single command: simple, compound, or control structure. */
// parseCommand：单条命令分派——取反、子 shell、算术 ((、花括号组、test 命令、控制结构关键字（if/while/for/case/function/声明类/unset），最后回落到简单命令。每类完成后再试尾部重定向。
function parseCommand(P: ParseState): TsNode | null {
  skipBlanks(P.L)
  const save = saveLex(P.L)
  const t = nextToken(P.L, 'cmd')

  if (t.type === 'EOF') {
    restoreLex(P.L, save)
    return null
  }

  // Negation — tree-sitter wraps just the command, redirects go outside.
  // `! cmd > out` → redirected_statement(negated_command(!, cmd), >out)
  if (t.type === 'OP' && t.value === '!') {
    const bang = leaf(P, '!', t)
    const inner = parseCommand(P)
    if (!inner) {
      restoreLex(P.L, save)
      return null
    }
    // If inner is a redirected_statement, hoist redirects outside negation
    if (inner.type === 'redirected_statement' && inner.children.length >= 2) {
      const cmd = inner.children[0]!
      const redirs = inner.children.slice(1)
      const neg = mk(P, 'negated_command', bang.startIndex, cmd.endIndex, [
        bang,
        cmd,
      ])
      const lastR = redirs[redirs.length - 1]!
      return mk(P, 'redirected_statement', neg.startIndex, lastR.endIndex, [
        neg,
        ...redirs,
      ])
    }
    return mk(P, 'negated_command', bang.startIndex, inner.endIndex, [
      bang,
      inner,
    ])
  }

  if (t.type === 'OP' && t.value === '(') {
    const open = leaf(P, '(', t)
    const body = parseStatements(P, ')')
    const closeTok = nextToken(P.L, 'cmd')
    const close =
      closeTok.type === 'OP' && closeTok.value === ')'
        ? leaf(P, ')', closeTok)
        : mk(P, ')', open.endIndex, open.endIndex, [])
    const node = mk(P, 'subshell', open.startIndex, close.endIndex, [
      open,
      ...body,
      close,
    ])
    return maybeRedirect(P, node)
  }

  if (t.type === 'OP' && t.value === '((') {
    const open = leaf(P, '((', t)
    const exprs = parseArithCommaList(P, '))', 'var')
    const closeTok = nextToken(P.L, 'cmd')
    const close =
      closeTok.value === '))'
        ? leaf(P, '))', closeTok)
        : mk(P, '))', open.endIndex, open.endIndex, [])
    return mk(P, 'compound_statement', open.startIndex, close.endIndex, [
      open,
      ...exprs,
      close,
    ])
  }

  if (t.type === 'OP' && t.value === '{') {
    const open = leaf(P, '{', t)
    const body = parseStatements(P, '}')
    const closeTok = nextToken(P.L, 'cmd')
    const close =
      closeTok.type === 'OP' && closeTok.value === '}'
        ? leaf(P, '}', closeTok)
        : mk(P, '}', open.endIndex, open.endIndex, [])
    const node = mk(P, 'compound_statement', open.startIndex, close.endIndex, [
      open,
      ...body,
      close,
    ])
    return maybeRedirect(P, node)
  }

// [ / [[ test 命令：先按表达式解析；没到闭合符就回溯改按 redirected_statement 解析（处理 [ ! cmd -v go &>/dev/null ] 这种内含重定向的写法），stopToken 机制防止 ] 被简单命令吃掉；两路都不行再回退表达式结果。闭合符缺失时补零宽节点保持形状。
  if (t.type === 'OP' && (t.value === '[' || t.value === '[[')) {
    const open = leaf(P, t.value, t)
    const closer = t.value === '[' ? ']' : ']]'
    // Grammar: `[` can contain choice(_expression, redirected_statement).
    // Try _expression first; if we don't reach `]`, backtrack and parse as
    // redirected_statement (handles `[ ! cmd -v go &>/dev/null ]`).
    const exprSave = saveLex(P.L)
    let expr = parseTestExpr(P, closer)
    skipBlanks(P.L)
    if (t.value === '[' && peek(P.L) !== ']') {
      // Expression parse didn't reach `]` — try as redirected_statement.
      // Thread `]` stop-token so parseSimpleCommand doesn't eat it as arg.
      restoreLex(P.L, exprSave)
      const prevStop = P.stopToken
      P.stopToken = ']'
      const rstmt = parseCommand(P)
      P.stopToken = prevStop
      if (rstmt && rstmt.type === 'redirected_statement') {
        expr = rstmt
      } else {
        // Neither worked — restore and keep the expression result
        restoreLex(P.L, exprSave)
        expr = parseTestExpr(P, closer)
      }
      skipBlanks(P.L)
    }
    const closeTok = nextToken(P.L, 'arg')
    let close: TsNode
    if (closeTok.value === closer) {
      close = leaf(P, closer, closeTok)
    } else {
      close = mk(P, closer, open.endIndex, open.endIndex, [])
    }
    const kids = expr ? [open, expr, close] : [open, close]
    return mk(P, 'test_command', open.startIndex, close.endIndex, kids)
  }
// test 命令分支收尾。test_command 的子节点：开括号、表达式、闭括号。

  if (t.type === 'WORD') {
    if (t.value === 'if') return maybeRedirect(P, parseIf(P, t), true)
    if (t.value === 'while' || t.value === 'until')
      return maybeRedirect(P, parseWhile(P, t), true)
    if (t.value === 'for') return maybeRedirect(P, parseFor(P, t), true)
    if (t.value === 'select') return maybeRedirect(P, parseFor(P, t), true)
    if (t.value === 'case') return maybeRedirect(P, parseCase(P, t), true)
    if (t.value === 'function') return parseFunction(P, t)
    if (DECL_KEYWORDS.has(t.value))
      return maybeRedirect(P, parseDeclaration(P, t))
    if (t.value === 'unset' || t.value === 'unsetenv') {
      return maybeRedirect(P, parseUnset(P, t))
    }
  }
// 关键字分派收尾：if/while/until/for/select/case 各进对应解析器并允许尾部重定向；function 与声明类（export 等）、unset 同理。没命中任何关键字的 WORD 回退为简单命令。

  restoreLex(P.L, save)
  return parseSimpleCommand(P)
}
// parseCommand 收尾。

/**
 * Parse a simple command: [assignment]* word [arg|redirect]*
 * Returns variable_assignment if only one assignment and no command.
 */
// parseSimpleCommand：[赋值]* 单词 [参数|重定向]*。只有赋值没有命令时返回 variable_assignment（单个）或 variable_assignments（多个）；只有重定向时返回 redirected_statement。这里还内嵌了 name() { ... } 形式的函数定义识别。
function parseSimpleCommand(P: ParseState): TsNode | null {
  const start = P.L.b
  const assignments: TsNode[] = []
  const preRedirects: TsNode[] = []

  while (true) {
    skipBlanks(P.L)
    const a = tryParseAssignment(P)
    if (a) {
      assignments.push(a)
      continue
    }
    const r = tryParseRedirect(P)
    if (r) {
      preRedirects.push(r)
      continue
    }
    break
  }

  skipBlanks(P.L)
  const save = saveLex(P.L)
  const nameTok = nextToken(P.L, 'cmd')
  if (
    nameTok.type === 'EOF' ||
    nameTok.type === 'NEWLINE' ||
    nameTok.type === 'COMMENT' ||
    (nameTok.type === 'OP' &&
      nameTok.value !== '{' &&
      nameTok.value !== '[' &&
      nameTok.value !== '[[') ||
    (nameTok.type === 'WORD' &&
      SHELL_KEYWORDS.has(nameTok.value) &&
      nameTok.value !== 'in')
  ) {
    restoreLex(P.L, save)
    // No command — standalone assignment(s) or redirect
    if (assignments.length === 1 && preRedirects.length === 0) {
      return assignments[0]!
    }
    if (preRedirects.length > 0 && assignments.length === 0) {
      // Bare redirect → redirected_statement with just file_redirect children
      const last = preRedirects[preRedirects.length - 1]!
      return mk(
        P,
        'redirected_statement',
        preRedirects[0]!.startIndex,
        last.endIndex,
        preRedirects,
      )
    }
    if (assignments.length > 1 && preRedirects.length === 0) {
      // `A=1 B=2` with no command → variable_assignments (plural)
      const last = assignments[assignments.length - 1]!
      return mk(
        P,
        'variable_assignments',
        assignments[0]!.startIndex,
        last.endIndex,
        assignments,
      )
    }
    if (assignments.length > 0 || preRedirects.length > 0) {
      const all = [...assignments, ...preRedirects]
      const last = all[all.length - 1]!
      return mk(P, 'command', start, last.endIndex, all)
    }
    return null
  }
  restoreLex(P.L, save)

  // Check for function definition: name() { ... }
  const fnSave = saveLex(P.L)
  const nm = parseWord(P, 'cmd')
  if (nm && nm.type === 'word') {
    skipBlanks(P.L)
    if (peek(P.L) === '(' && peek(P.L, 1) === ')') {
      const oTok = nextToken(P.L, 'cmd')
      const cTok = nextToken(P.L, 'cmd')
      const oParen = leaf(P, '(', oTok)
      const cParen = leaf(P, ')', cTok)
      skipBlanks(P.L)
      skipNewlines(P)
      const body = parseCommand(P)
      if (body) {
        // If body is redirected_statement(compound_statement, file_redirect...),
        // hoist redirects to function_definition level per tree-sitter grammar
        let bodyKids: TsNode[] = [body]
        if (
          body.type === 'redirected_statement' &&
          body.children.length >= 2 &&
          body.children[0]!.type === 'compound_statement'
        ) {
          bodyKids = body.children
        }
        const last = bodyKids[bodyKids.length - 1]!
        return mk(P, 'function_definition', nm.startIndex, last.endIndex, [
          nm,
          oParen,
          cParen,
          ...bodyKids,
        ])
      }
    }
  }
  restoreLex(P.L, fnSave)

  const nameArg = parseWord(P, 'cmd')
  if (!nameArg) {
    if (assignments.length === 1) return assignments[0]!
    return null
  }

  const cmdName = mk(P, 'command_name', nameArg.startIndex, nameArg.endIndex, [
    nameArg,
  ])

  const args: TsNode[] = []
  const redirects: TsNode[] = []
  let heredocRedirect: TsNode | null = null

  while (true) {
    skipBlanks(P.L)
    // Post-command redirects are greedy (repeat1 $._literal) — once a redirect
    // appears after command_name, subsequent literals attach to it per grammar's
    // prec.left. `grep 2>/dev/null -q foo` → file_redirect eats `-q foo`.
    // Args parsed BEFORE the first redirect still go to command (cat a b > out).
// 命令名之后的重定向是贪婪的（语法规则 repeat1(_literal)）——一旦出现重定向，后续字面量按 prec.left 都挂到重定向上：grep 2>/dev/null -q foo 里 -q foo 会被 file_redirect 吃掉。但重定向出现之前解析的参数仍归命令（cat a b > out）。
    const r = tryParseRedirect(P, true)
    if (r) {
      if (r.type === 'heredoc_redirect') {
        heredocRedirect = r
      } else if (r.type === 'herestring_redirect') {
        args.push(r)
      } else {
        redirects.push(r)
      }
      continue
    }
    // Once a file_redirect has been seen, command args are done — grammar's
    // command rule doesn't allow file_redirect in its post-name choice, so
    // anything after belongs to redirected_statement's file_redirect children.
// 出现过 file_redirect 后命令参数立即终止——语法规则不允许命令名之后还有参数跟在重定向后，剩余部分全部属于 redirected_statement 的 file_redirect 子节点。
    if (redirects.length > 0) break
    // `[` test_command backtrack — stop at `]` so outer handler can consume it
    if (P.stopToken === ']' && peek(P.L) === ']') break
    const save2 = saveLex(P.L)
    const pk = nextToken(P.L, 'arg')
    if (
      pk.type === 'EOF' ||
      pk.type === 'NEWLINE' ||
      pk.type === 'COMMENT' ||
      (pk.type === 'OP' &&
        (pk.value === '|' ||
          pk.value === '|&' ||
          pk.value === '&&' ||
          pk.value === '||' ||
          pk.value === ';' ||
          pk.value === ';;' ||
          pk.value === ';&' ||
          pk.value === ';;&' ||
          pk.value === '&' ||
          pk.value === ')' ||
          pk.value === '}' ||
          pk.value === '))'))
    ) {
      restoreLex(P.L, save2)
      break
    }
    restoreLex(P.L, save2)
    const arg = parseWord(P, 'arg')
    if (!arg) {
      // Lone `(` in arg position — tree-sitter parses this as subshell arg
      // e.g., `echo =(cmd)` → command has ERROR(=), subshell(cmd) as args
      if (peek(P.L) === '(') {
        const oTok = nextToken(P.L, 'cmd')
        const open = leaf(P, '(', oTok)
        const body = parseStatements(P, ')')
        const cTok = nextToken(P.L, 'cmd')
        const close =
          cTok.type === 'OP' && cTok.value === ')'
            ? leaf(P, ')', cTok)
            : mk(P, ')', open.endIndex, open.endIndex, [])
        args.push(
          mk(P, 'subshell', open.startIndex, close.endIndex, [
            open,
            ...body,
            close,
          ]),
        )
        continue
      }
      break
    }
    // Lone `=` in arg position is a parse error in bash — tree-sitter wraps
    // it in ERROR for recovery. Happens in `echo =(cmd)` (zsh process-sub).
// 两类 zsh 风格输入的 ERROR 包装（bash 里都是语法错）：孤立 =（echo =(cmd) 的进程替换）与紧贴 ( 的单词（*.(e:cmd:) 这类 glob 限定符）。对齐 tree-sitter 的恢复行为——ERROR 节点让安全行走器 fail closed。
    if (arg.type === 'word' && arg.text === '=') {
      args.push(mk(P, 'ERROR', arg.startIndex, arg.endIndex, [arg]))
      continue
    }
    // Word immediately followed by `(` (no whitespace) is a parse error —
    // bash doesn't allow glob-then-subshell adjacency. tree-sitter wraps the
    // word in ERROR. Catches zsh glob qualifiers like `*.(e:'cmd':)`.
    if (
      (arg.type === 'word' || arg.type === 'concatenation') &&
      peek(P.L) === '(' &&
      P.L.b === arg.endIndex
    ) {
      args.push(mk(P, 'ERROR', arg.startIndex, arg.endIndex, [arg]))
      continue
    }
    args.push(arg)
  }

  // preRedirects (e.g., `2>&1 cat`, `<<<str cmd`) go INSIDE the command node
  // before command_name per tree-sitter grammar, not in redirected_statement
// 前置换向（2>&1 cat、<<<str cmd）放进 command 节点内部、排在 command_name 之前——对齐语法规则，不进 redirected_statement。
  const cmdChildren = [...assignments, ...preRedirects, cmdName, ...args]
  const cmdEnd =
    cmdChildren.length > 0
      ? cmdChildren[cmdChildren.length - 1]!.endIndex
      : cmdName.endIndex
  const cmdStart = cmdChildren[0]!.startIndex
  const cmd = mk(P, 'command', cmdStart, cmdEnd, cmdChildren)

  if (heredocRedirect) {
    // Scan heredoc body now
    scanHeredocBodies(P)
    const hd = P.L.heredocs.shift()
    if (hd && heredocRedirect.children.length >= 2) {
      const bodyNode = mk(
        P,
        'heredoc_body',
        hd.bodyStart,
        hd.bodyEnd,
        hd.quoted ? [] : parseHeredocBodyContent(P, hd.bodyStart, hd.bodyEnd),
      )
      const endNode = mk(P, 'heredoc_end', hd.endStart, hd.endEnd, [])
      heredocRedirect.children.push(bodyNode, endNode)
      heredocRedirect.endIndex = hd.endEnd
      heredocRedirect.text = sliceBytes(
        P,
        heredocRedirect.startIndex,
        hd.endEnd,
      )
    }
    const allR = [...preRedirects, heredocRedirect, ...redirects]
    const rStart =
      preRedirects.length > 0
        ? Math.min(cmd.startIndex, preRedirects[0]!.startIndex)
        : cmd.startIndex
    return mk(P, 'redirected_statement', rStart, heredocRedirect.endIndex, [
      cmd,
      ...allR,
    ])
  }

  if (redirects.length > 0) {
    const last = redirects[redirects.length - 1]!
    return mk(P, 'redirected_statement', cmd.startIndex, last.endIndex, [
      cmd,
      ...redirects,
    ])
  }

  return cmd
}
// parseSimpleCommand 收尾：heredoc 重定向当场扫描正文并填 body/end 节点；普通重定向包 redirected_statement；heredoc 场景的范围起点要与前置换向取 min。

// maybeRedirect：复合结构（子 shell/组/控制语句）后的尾部重定向包装。herestring 默认不收（allowHerestring 控制）——复合语句后的 <<< 语义歧义。
function maybeRedirect(
  P: ParseState,
  node: TsNode,
  allowHerestring = false,
): TsNode {
  const redirects: TsNode[] = []
  while (true) {
    skipBlanks(P.L)
    const save = saveLex(P.L)
    const r = tryParseRedirect(P)
    if (!r) break
    if (r.type === 'herestring_redirect' && !allowHerestring) {
      restoreLex(P.L, save)
      break
    }
    redirects.push(r)
  }
  if (redirects.length === 0) return node
  const last = redirects[redirects.length - 1]!
  return mk(P, 'redirected_statement', node.startIndex, last.endIndex, [
    node,
    ...redirects,
  ])
}
// maybeRedirect 收尾。

// tryParseAssignment：变量赋值识别——标识符（可带 [下标]）后跟 = 或 +=。值可以是数组 (a b c) 或普通词。名字与值都建节点，下标包 subscript 节点。
function tryParseAssignment(P: ParseState): TsNode | null {
  const save = saveLex(P.L)
  skipBlanks(P.L)
  const startB = P.L.b
  // Must start with identifier
  if (!isIdentStart(peek(P.L))) {
    restoreLex(P.L, save)
    return null
  }
  while (isIdentChar(peek(P.L))) advance(P.L)
  const nameEnd = P.L.b
  // Optional subscript
  let subEnd = nameEnd
  if (peek(P.L) === '[') {
    advance(P.L)
    let depth = 1
    while (P.L.i < P.L.len && depth > 0) {
      const c = peek(P.L)
      if (c === '[') depth++
      else if (c === ']') depth--
      advance(P.L)
    }
    subEnd = P.L.b
  }
  const c = peek(P.L)
  const c1 = peek(P.L, 1)
  let op: string
  if (c === '=' && c1 !== '=') {
    op = '='
  } else if (c === '+' && c1 === '=') {
    op = '+='
  } else {
    restoreLex(P.L, save)
    return null
  }
  const nameNode = mk(P, 'variable_name', startB, nameEnd, [])
  // Subscript handling: wrap in subscript node if present
  let lhs: TsNode = nameNode
  if (subEnd > nameEnd) {
    const brOpen = mk(P, '[', nameEnd, nameEnd + 1, [])
    const idx = parseSubscriptIndex(P, nameEnd + 1, subEnd - 1)
    const brClose = mk(P, ']', subEnd - 1, subEnd, [])
    lhs = mk(P, 'subscript', startB, subEnd, [nameNode, brOpen, idx, brClose])
  }
  const opStart = P.L.b
  advance(P.L)
  if (op === '+=') advance(P.L)
  const opEnd = P.L.b
  const opNode = mk(P, op, opStart, opEnd, [])
  let val: TsNode | null = null
  if (peek(P.L) === '(') {
    // Array
    const aoTok = nextToken(P.L, 'cmd')
    const aOpen = leaf(P, '(', aoTok)
    const elems: TsNode[] = [aOpen]
    while (true) {
      skipBlanks(P.L)
      if (peek(P.L) === ')') break
      const e = parseWord(P, 'arg')
      if (!e) break
      elems.push(e)
    }
    const acTok = nextToken(P.L, 'cmd')
    const aClose =
      acTok.value === ')'
        ? leaf(P, ')', acTok)
        : mk(P, ')', aOpen.endIndex, aOpen.endIndex, [])
    elems.push(aClose)
    val = mk(P, 'array', aOpen.startIndex, aClose.endIndex, elems)
  } else {
    const c2 = peek(P.L)
    if (
      c2 &&
      c2 !== ' ' &&
      c2 !== '\t' &&
      c2 !== '\n' &&
      c2 !== ';' &&
      c2 !== '&' &&
      c2 !== '|' &&
      c2 !== ')' &&
      c2 !== '}'
    ) {
      val = parseWord(P, 'arg')
    }
  }
  const kids = val ? [lhs, opNode, val] : [lhs, opNode]
  const end = val ? val.endIndex : opEnd
  return mk(P, 'variable_assignment', startB, end, kids)
}
// tryParseAssignment 收尾：值缺省时（如 A= 后直接换行）只有名字与操作符两个子节点。

/**
 * Parse subscript index content. Parsed arithmetically per tree-sitter grammar:
 * `${a[1+2]}` → binary_expression; `${a[++i]}` → unary_expression(word);
 * `${a[(($n+1))]}` → compound_statement(binary_expression). Falls back to
 * simple patterns (@, *) as word.
 */
// parseSubscriptIndexInline：${a[...]} 下标的算术解析——${a[1+2]} 是二元表达式、${a[++i]} 是一元、${a[(($n+1))]} 包 compound_statement；@ 或 * 单独出现是关联数组全键（word）。
function parseSubscriptIndexInline(P: ParseState): TsNode | null {
  skipBlanks(P.L)
  const c = peek(P.L)
  // @ or * alone → word (associative array all-keys)
  if ((c === '@' || c === '*') && peek(P.L, 1) === ']') {
    const s = P.L.b
    advance(P.L)
    return mk(P, 'word', s, P.L.b, [])
  }
  // ((expr)) → compound_statement wrapping the inner arithmetic
  if (c === '(' && peek(P.L, 1) === '(') {
    const oStart = P.L.b
    advance(P.L)
    advance(P.L)
    const open = mk(P, '((', oStart, P.L.b, [])
    const inner = parseArithExpr(P, '))', 'var')
    skipBlanks(P.L)
    let close: TsNode
    if (peek(P.L) === ')' && peek(P.L, 1) === ')') {
      const cs = P.L.b
      advance(P.L)
      advance(P.L)
      close = mk(P, '))', cs, P.L.b, [])
    } else {
      close = mk(P, '))', P.L.b, P.L.b, [])
    }
    const kids = inner ? [open, inner, close] : [open, close]
    return mk(P, 'compound_statement', open.startIndex, close.endIndex, kids)
  }
  // Arithmetic — but bare identifiers in subscript use 'word' mode per
  // tree-sitter (${words[++counter]} → unary_expression(word)).
  return parseArithExpr(P, ']', 'word')
}
// 注意裸标识符在 subscript 里走 word 模式而非 var——对齐 tree-sitter 的 ${words[++counter]} 形状。

/** Legacy byte-range subscript index parser — kept for callers that pre-scan. */
function parseSubscriptIndex(
  P: ParseState,
  startB: number,
  endB: number,
): TsNode {
  const text = sliceBytes(P, startB, endB)
  if (/^\d+$/.test(text)) return mk(P, 'number', startB, endB, [])
  const m = /^\$([a-zA-Z_]\w*)$/.exec(text)
  if (m) {
    const dollar = mk(P, '$', startB, startB + 1, [])
    const vn = mk(P, 'variable_name', startB + 1, endB, [])
    return mk(P, 'simple_expansion', startB, endB, [dollar, vn])
  }
  if (text.length === 2 && text[0] === '$' && SPECIAL_VARS.has(text[1]!)) {
    const dollar = mk(P, '$', startB, startB + 1, [])
    const vn = mk(P, 'special_variable_name', startB + 1, endB, [])
    return mk(P, 'simple_expansion', startB, endB, [dollar, vn])
  }
  return mk(P, 'word', startB, endB, [])
}
// parseSubscriptIndex：旧版按字节范围预扫的实现，保留给调用方（tryParseAssignment 还在用）——只识别纯数字、$var、特殊变量，其余当 word。

/**
 * Can the current position start a redirect destination literal?
 * Returns false at redirect ops, terminators, or file-descriptor-prefixed ops
 * so file_redirect's repeat1($._literal) stops at the right boundary.
 */
function isRedirectLiteralStart(P: ParseState): boolean {
  const c = peek(P.L)
  if (c === '' || c === '\n') return false
  // Shell terminators and operators
  if (c === '|' || c === '&' || c === ';' || c === '(' || c === ')')
    return false
  // Redirect operators (< > with any suffix; <( >( handled by caller)
  if (c === '<' || c === '>') {
    // <( >( are process substitutions — those ARE literals
    return peek(P.L, 1) === '('
  }
  // N< N> file descriptor prefix — starts a new redirect, not a literal
  if (isDigit(c)) {
    let j = P.L.i
    while (j < P.L.len && isDigit(P.L.src[j]!)) j++
    const after = j < P.L.len ? P.L.src[j]! : ''
    if (after === '>' || after === '<') return false
  }
  // `}` only terminates if we're in a context where it's a closer — but
  // file_redirect sees `}` as word char (e.g., `>$HOME}` is valid path char).
  // Actually `}` at top level terminates compound_statement — need to stop.
  if (c === '}') return false
  // Test command closer — when parseSimpleCommand is called from `[` context,
  // `]` must terminate so parseCommand can return and `[` handler consume it.
  if (P.stopToken === ']' && c === ']') return false
  return true
}
// isRedirectLiteralStart：当前位置能否作为重定向目标字面量的开头？在重定向操作符、终止符、文件描述符前缀处返回 false，让 file_redirect 的 repeat1(_literal) 停在正确边界。} 与 stopToken 为 ] 时的 ] 也终止（顶层复合语句闭合与 test 命令闭合）。

/**
 * Parse a redirect operator + destination(s).
 * @param greedy When true, file_redirect consumes repeat1($._literal) per
 *   grammar's prec.left — `cmd >f a b c` attaches `a b c` to the redirect.
 *   When false (preRedirect context), takes only 1 destination because
 *   command's dynamic precedence beats redirected_statement's prec(-1).
 */
// tryParseRedirect：重定向总入口。可选文件描述符前缀 → 按操作符分派：<<< herestring、<< heredoc（最复杂）、<&- >&- 关闭描述符（目标可选）、其余 file_redirect。greedy 参数控制目标字面量的贪婪度——命令名后是贪婪的（对齐 prec.left），前置换向上下文只取一个（command 的动态优先级压过 redirected_statement 的 prec(-1)）。
function tryParseRedirect(P: ParseState, greedy = false): TsNode | null {
  const save = saveLex(P.L)
  skipBlanks(P.L)
  // File descriptor prefix?
  let fd: TsNode | null = null
  if (isDigit(peek(P.L))) {
    const startB = P.L.b
    let j = P.L.i
    while (j < P.L.len && isDigit(P.L.src[j]!)) j++
    const after = j < P.L.len ? P.L.src[j]! : ''
    if (after === '>' || after === '<') {
      while (P.L.i < j) advance(P.L)
      fd = mk(P, 'file_descriptor', startB, P.L.b, [])
    }
  }
  const t = nextToken(P.L, 'arg')
  if (t.type !== 'OP') {
    restoreLex(P.L, save)
    return null
  }
  const v = t.value
  if (v === '<<<') {
    const op = leaf(P, '<<<', t)
    skipBlanks(P.L)
    const target = parseWord(P, 'arg')
    const end = target ? target.endIndex : op.endIndex
    const kids = target ? [op, target] : [op]
    return mk(
      P,
      'herestring_redirect',
      fd ? fd.startIndex : op.startIndex,
      end,
      fd ? [fd, ...kids] : kids,
    )
  }
// herestring 分支收尾：目标缺省时零宽结束，形状仍是 herestring_redirect。
// heredoc 分支：先扫定界符（可引号包裹——quoted 标记决定正文是否解析展开；反斜杠转义的定界符同样算 quoted），登记进挂起列表等下一个换行再扫正文。
  if (v === '<<' || v === '<<-') {
    const op = leaf(P, v, t)
    // Heredoc start — delimiter word (may be quoted)
    skipBlanks(P.L)
    const dStart = P.L.b
    let quoted = false
    let delim = ''
    const dc = peek(P.L)
    if (dc === "'" || dc === '"') {
      quoted = true
      advance(P.L)
      while (P.L.i < P.L.len && peek(P.L) !== dc) {
        delim += peek(P.L)
        advance(P.L)
      }
      if (P.L.i < P.L.len) advance(P.L)
    } else if (dc === '\\') {
      // Backslash-escaped delimiter: \X — exactly one escaped char, body is
      // quoted (literal). Covers <<\EOF <<\' <<\\ etc.
      quoted = true
      advance(P.L)
      if (P.L.i < P.L.len && peek(P.L) !== '\n') {
        delim += peek(P.L)
        advance(P.L)
      }
      // May be followed by more ident chars (e.g. <<\EOF → delim "EOF")
      while (P.L.i < P.L.len && isIdentChar(peek(P.L))) {
        delim += peek(P.L)
        advance(P.L)
      }
    } else {
      // Unquoted delimiter: bash accepts most non-metacharacters (not just
      // identifiers). Allow !, -, ., etc. — stop at shell metachars.
      while (P.L.i < P.L.len && isHeredocDelimChar(peek(P.L))) {
        delim += peek(P.L)
        advance(P.L)
      }
    }
// 定界符扫描收尾：未引号定界符接受大多数非元字符（不止标识符），停在 shell 元字符。heredoc_start 节点记录定界符位置。
    const dEnd = P.L.b
    const startNode = mk(P, 'heredoc_start', dStart, dEnd, [])
    // Register pending heredoc — body scanned at next newline
    P.L.heredocs.push({
      delim,
      stripTabs: v === '<<-',
      quoted,
      bodyStart: 0,
      bodyEnd: 0,
      endStart: 0,
      endEnd: 0,
    })
    const kids = fd ? [fd, op, startNode] : [op, startNode]
    const startIdx = fd ? fd.startIndex : op.startIndex
    // SECURITY: tree-sitter nests any pipeline/list/file_redirect appearing
    // between heredoc_start and the newline as a CHILD of heredoc_redirect.
    // `ls <<'EOF' | rm -rf /tmp/evil` must not silently drop the rm. Parse
    // trailing words and file_redirects properly (ast.ts walkHeredocRedirect
    // fails closed on any unrecognized child via tooComplex). Pipeline / list
    // operators (| && || ;) are structurally complex — emit ERROR so the same
    // fail-closed path rejects them.
// 安全注释（本文件的灵魂之一）：tree-sitter 会把 heredoc_start 与换行之间出现的任何管道/列表/重定向嵌进 heredoc_redirect 子节点——ls 配 heredoc 接 rm -rf /tmp/evil 的管道 绝不能静默丢掉 rm。这里把尾随单词与 file_redirect 正常解析（ast.ts 的 walkHeredocRedirect 对不认识的子节点一律 tooComplex 拒绝）；管道/列表运算符结构太复杂，直接发 ERROR 让同一条 fail-closed 路径拒掉。
    while (true) {
      skipBlanks(P.L)
      const tc = peek(P.L)
      if (tc === '\n' || tc === '' || P.L.i >= P.L.len) break
      // File redirect after delimiter: cat <<EOF > out.txt
      if (tc === '>' || tc === '<' || isDigit(tc)) {
        const rSave = saveLex(P.L)
        const r = tryParseRedirect(P)
        if (r && r.type === 'file_redirect') {
          kids.push(r)
          continue
        }
        restoreLex(P.L, rSave)
      }
      // Pipeline after heredoc_start: `one <<EOF | grep two` — tree-sitter
      // nests the pipeline as a child of heredoc_redirect. ast.ts
      // walkHeredocRedirect fails closed on pipeline/command via tooComplex.
      if (tc === '|' && peek(P.L, 1) !== '|') {
        advance(P.L)
        skipBlanks(P.L)
        const pipeCmds: TsNode[] = []
        while (true) {
          const cmd = parseCommand(P)
          if (!cmd) break
          pipeCmds.push(cmd)
          skipBlanks(P.L)
          if (peek(P.L) === '|' && peek(P.L, 1) !== '|') {
            const ps = P.L.b
            advance(P.L)
            pipeCmds.push(mk(P, '|', ps, P.L.b, []))
            skipBlanks(P.L)
            continue
          }
          break
        }
        if (pipeCmds.length > 0) {
          const pl = pipeCmds[pipeCmds.length - 1]!
          // tree-sitter always wraps in pipeline after `|`, even single command
          kids.push(
            mk(P, 'pipeline', pipeCmds[0]!.startIndex, pl.endIndex, pipeCmds),
          )
        }
        continue
      }
      // && / || after heredoc_start: `cat <<-EOF || die "..."` — tree-sitter
      // nests just the RHS command (not a list) as a child of heredoc_redirect.
      if (
        (tc === '&' && peek(P.L, 1) === '&') ||
        (tc === '|' && peek(P.L, 1) === '|')
      ) {
        advance(P.L)
        advance(P.L)
        skipBlanks(P.L)
        const rhs = parseCommand(P)
        if (rhs) kids.push(rhs)
        continue
      }
      // Terminator / unhandled metachar — consume rest of line as ERROR so
      // ast.ts rejects it. Covers ; & ( )
      if (tc === '&' || tc === ';' || tc === '(' || tc === ')') {
        const eStart = P.L.b
        while (P.L.i < P.L.len && peek(P.L) !== '\n') advance(P.L)
        kids.push(mk(P, 'ERROR', eStart, P.L.b, []))
        break
      }
      // Trailing word argument: newins <<-EOF - org.freedesktop.service
      const w = parseWord(P, 'arg')
      if (w) {
        kids.push(w)
        continue
      }
      // Unrecognized — consume rest of line as ERROR
      const eStart = P.L.b
      while (P.L.i < P.L.len && peek(P.L) !== '\n') advance(P.L)
      if (P.L.b > eStart) kids.push(mk(P, 'ERROR', eStart, P.L.b, []))
      break
    }
    return mk(P, 'heredoc_redirect', startIdx, P.L.b, kids)
// heredoc_redirect 节点收尾：kids 里可能有 heredoc_start、file_redirect、pipeline、ERROR——安全行走器看到复杂子节点就整体拒绝该命令。
  }
  // Close-fd variants: `<&-` `>&-` have OPTIONAL destination (0 or 1)
  if (v === '<&-' || v === '>&-') {
    const op = leaf(P, v, t)
    const kids: TsNode[] = []
    if (fd) kids.push(fd)
    kids.push(op)
    // Optional single destination — only consume if next is a literal
    skipBlanks(P.L)
    const dSave = saveLex(P.L)
    const dest = isRedirectLiteralStart(P) ? parseWord(P, 'arg') : null
    if (dest) {
      kids.push(dest)
    } else {
      restoreLex(P.L, dSave)
    }
    const startIdx = fd ? fd.startIndex : op.startIndex
    const end = dest ? dest.endIndex : op.endIndex
    return mk(P, 'file_redirect', startIdx, end, kids)
// 关闭描述符变体（<&- >&-）收尾：目标可选（0 或 1 个字面量）。
  }
  if (
    v === '>' ||
    v === '>>' ||
    v === '>&' ||
    v === '>|' ||
    v === '&>' ||
    v === '&>>' ||
    v === '<' ||
    v === '<&'
  ) {
    const op = leaf(P, v, t)
    const kids: TsNode[] = []
    if (fd) kids.push(fd)
    kids.push(op)
    // Grammar: destination is repeat1($._literal) — greedily consume literals
    // until a non-literal (redirect op, terminator, etc). tree-sitter's
    // prec.left makes `cmd >f a b c` attach `a b c` to the file_redirect,
    // NOT to the command. Structural quirk but required for corpus parity.
    // In preRedirect context (greedy=false), take only 1 literal because
    // command's dynamic precedence beats redirected_statement's prec(-1).
    let end = op.endIndex
    let taken = 0
    while (true) {
      skipBlanks(P.L)
      if (!isRedirectLiteralStart(P)) break
      if (!greedy && taken >= 1) break
      const tc = peek(P.L)
      const tc1 = peek(P.L, 1)
      let target: TsNode | null = null
      if ((tc === '<' || tc === '>') && tc1 === '(') {
        target = parseProcessSub(P)
      } else {
        target = parseWord(P, 'arg')
      }
      if (!target) break
      kids.push(target)
      end = target.endIndex
      taken++
    }
    const startIdx = fd ? fd.startIndex : op.startIndex
    return mk(P, 'file_redirect', startIdx, end, kids)
// file_redirect 收尾：目标按 repeat1(_literal) 贪婪吃字面量直到非字面量——cmd >f a b c 会把 a b c 挂进重定向。结构性怪癖但必须复刻，否则语料对不上。
  }
  restoreLex(P.L, save)
  return null
}
// tryParseRedirect 收尾：没匹配到任何重定向操作符就回溯返回 null。

// parseProcessSub：进程替换 <(cmd) / >(cmd)——正文是完整语句序列，包 process_substitution 节点。闭合缺失同样补零宽节点。
function parseProcessSub(P: ParseState): TsNode | null {
  const c = peek(P.L)
  if ((c !== '<' && c !== '>') || peek(P.L, 1) !== '(') return null
  const start = P.L.b
  advance(P.L)
  advance(P.L)
  const open = mk(P, c + '(', start, P.L.b, [])
  const body = parseStatements(P, ')')
  skipBlanks(P.L)
  let close: TsNode
  if (peek(P.L) === ')') {
    const cs = P.L.b
    advance(P.L)
    close = mk(P, ')', cs, P.L.b, [])
  } else {
    close = mk(P, ')', P.L.b, P.L.b, [])
  }
  return mk(P, 'process_substitution', start, close.endIndex, [
    open,
    ...body,
    close,
  ])
}
// parseProcessSub 收尾。

// scanHeredocBodies：到下一个换行后逐行扫 heredoc 正文。<<- 先跳行首 tab 再比对定界符；定界符行必须是整行（后面紧跟换行或回车）；正文结束于定界符行首；扫到 EOF 则视为未终结（body/end 全零宽）。
function scanHeredocBodies(P: ParseState): void {
  // Skip to newline if not already there
  while (P.L.i < P.L.len && P.L.src[P.L.i] !== '\n') advance(P.L)
  if (P.L.i < P.L.len) advance(P.L)
  for (const hd of P.L.heredocs) {
    hd.bodyStart = P.L.b
    const delimLen = hd.delim.length
    while (P.L.i < P.L.len) {
      const lineStart = P.L.i
      const lineStartB = P.L.b
      // Skip leading tabs if <<-
      let checkI = lineStart
      if (hd.stripTabs) {
        while (checkI < P.L.len && P.L.src[checkI] === '\t') checkI++
      }
      // Check if this line is the delimiter
      if (
        P.L.src.startsWith(hd.delim, checkI) &&
        (checkI + delimLen >= P.L.len ||
          P.L.src[checkI + delimLen] === '\n' ||
          P.L.src[checkI + delimLen] === '\r')
      ) {
        hd.bodyEnd = lineStartB
        // Advance past tabs
        while (P.L.i < checkI) advance(P.L)
        hd.endStart = P.L.b
        // Advance past delimiter
        for (let k = 0; k < delimLen; k++) advance(P.L)
        hd.endEnd = P.L.b
        // Skip trailing newline
        if (P.L.i < P.L.len && P.L.src[P.L.i] === '\n') advance(P.L)
        return
      }
      // Consume line
      while (P.L.i < P.L.len && P.L.src[P.L.i] !== '\n') advance(P.L)
      if (P.L.i < P.L.len) advance(P.L)
    }
    // Unterminated
    hd.bodyEnd = P.L.b
    hd.endStart = P.L.b
    hd.endEnd = P.L.b
  }
}
// scanHeredocBodies 收尾：多个挂起 heredoc（cat <<A <<B）按登记顺序逐个扫。

// parseHeredocBodyContent：未引号 heredoc 正文里的展开解析。对齐 tree-sitter 的隐藏约定：首个展开之前的文本段（_heredoc_body_beginning）被隐藏——只有首个展开之后的内容才发 heredoc_content 节点。反斜杠可转义 $ 与反引号保持字面。
function parseHeredocBodyContent(
  P: ParseState,
  start: number,
  end: number,
): TsNode[] {
  // Parse expansions inside an unquoted heredoc body.
  const saved = saveLex(P.L)
  // Position lexer at body start
  restoreLexToByte(P, start)
  const out: TsNode[] = []
  let contentStart = P.L.b
  // tree-sitter-bash's heredoc_body rule hides the initial text segment
  // (_heredoc_body_beginning) — only content AFTER the first expansion is
  // emitted as heredoc_content. Track whether we've seen an expansion yet.
  let sawExpansion = false
  while (P.L.b < end) {
    const c = peek(P.L)
    // Backslash escapes suppress expansion: \$ \` stay literal in heredoc.
    if (c === '\\') {
      const nxt = peek(P.L, 1)
      if (nxt === '$' || nxt === '`' || nxt === '\\') {
        advance(P.L)
        advance(P.L)
        continue
      }
      advance(P.L)
      continue
    }
    if (c === '$' || c === '`') {
      const preB = P.L.b
      const exp = parseDollarLike(P)
      // Bare `$` followed by non-name (e.g. `$'` in a regex) returns a lone
      // '$' leaf, not an expansion — treat as literal content, don't split.
      if (
        exp &&
        (exp.type === 'simple_expansion' ||
          exp.type === 'expansion' ||
          exp.type === 'command_substitution' ||
          exp.type === 'arithmetic_expansion')
      ) {
        if (sawExpansion && preB > contentStart) {
          out.push(mk(P, 'heredoc_content', contentStart, preB, []))
        }
        out.push(exp)
        contentStart = P.L.b
        sawExpansion = true
      }
      continue
    }
    advance(P.L)
  }
  // Only emit heredoc_content children if there were expansions — otherwise
  // the heredoc_body is a leaf node (tree-sitter convention).
  if (sawExpansion) {
    out.push(mk(P, 'heredoc_content', contentStart, end, []))
  }
  restoreLex(P.L, saved)
  return out
}
// parseHeredocBodyContent 收尾：从没出现过展开时正文保持叶子节点（无子节点）——tree-sitter 约定。孤立 $（如正则里的 $）不算展开不切分。

function restoreLexToByte(P: ParseState, targetByte: number): void {
  if (!P.L.byteTable) byteAt(P.L, 0)
  const t = P.L.byteTable!
  let lo = 0
  let hi = P.src.length
  while (lo < hi) {
    const m = (lo + hi) >>> 1
    if (t[m]! < targetByte) lo = m + 1
    else hi = m
  }
  P.L.i = lo
  P.L.b = targetByte
}
// restoreLexToByte：按字节目标回定位词法器——byteTable 二分找字符下标，b 直接设为目标字节。

/**
 * Parse a word-position element: bare word, string, expansion, or concatenation
 * thereof. Returns a single node; if multiple adjacent fragments, wraps in
 * concatenation.
 */
// parseWord：词位置的元素解析——裸词、字符串、各种展开，或它们的拼接（多片段包 concatenation）。这里集中了最多的 tree-sitter 形状怪癖与安全判别。
function parseWord(P: ParseState, _ctx: 'cmd' | 'arg'): TsNode | null {
  skipBlanks(P.L)
  const parts: TsNode[] = []
  while (P.L.i < P.L.len) {
    const c = peek(P.L)
    if (
      c === ' ' ||
      c === '\t' ||
      c === '\n' ||
      c === '\r' ||
      c === '' ||
      c === '|' ||
      c === '&' ||
      c === ';' ||
      c === '(' ||
      c === ')'
    ) {
      break
    }
    // < > are redirect operators unless <( >( (process substitution)
    if (c === '<' || c === '>') {
      if (peek(P.L, 1) === '(') {
        const ps = parseProcessSub(P)
        if (ps) parts.push(ps)
        continue
      }
      break
    }
    if (c === '"') {
      parts.push(parseDoubleQuoted(P))
      continue
    }
    if (c === "'") {
      const tok = nextToken(P.L, 'arg')
      parts.push(leaf(P, 'raw_string', tok))
      continue
    }
    if (c === '$') {
      const c1 = peek(P.L, 1)
      if (c1 === "'") {
        const tok = nextToken(P.L, 'arg')
        parts.push(leaf(P, 'ansi_c_string', tok))
        continue
      }
      if (c1 === '"') {
        // Translated string: emit $ leaf + string node
        const dTok: Token = {
          type: 'DOLLAR',
          value: '$',
          start: P.L.b,
          end: P.L.b + 1,
        }
        advance(P.L)
        parts.push(leaf(P, '$', dTok))
        parts.push(parseDoubleQuoted(P))
        continue
      }
      if (c1 === '`') {
        // `$` followed by backtick — tree-sitter elides the $ entirely
        // and emits just (command_substitution). Consume $ and let next
        // iteration handle the backtick.
        advance(P.L)
        continue
      }
      const exp = parseDollarLike(P)
      if (exp) parts.push(exp)
      continue
    }
    if (c === '`') {
      if (P.inBacktick > 0) break
      const bt = parseBacktick(P)
      if (bt) parts.push(bt)
      continue
    }
    // Brace expression {1..5} or {a,b,c} — only if looks like one
    if (c === '{') {
      const be = tryParseBraceExpr(P)
      if (be) {
        parts.push(be)
        continue
      }
      // SECURITY: if `{` is immediately followed by a command terminator
      // (; | & newline or EOF), it's a standalone word — don't slurp the
      // rest of the line via tryParseBraceLikeCat. `echo {;touch /tmp/evil`
      // must split on `;` so the security walker sees `touch`.
// 安全判别：{ 后紧跟命令终止符（; | & 换行 EOF）时它是独立单词——绝不能让 tryParseBraceLikeCat 把整行吞进去。echo {;touch /tmp/evil 必须在 ; 处断开，安全行走器才能看见 touch。
      const nc = peek(P.L, 1)
      if (
        nc === ';' ||
        nc === '|' ||
        nc === '&' ||
        nc === '\n' ||
        nc === '' ||
        nc === ')' ||
        nc === ' ' ||
        nc === '\t'
      ) {
        const bStart = P.L.b
        advance(P.L)
        parts.push(mk(P, 'word', bStart, P.L.b, []))
        continue
      }
      // Otherwise treat { and } as word fragments
      const cat = tryParseBraceLikeCat(P)
      if (cat) {
        for (const p of cat) parts.push(p)
        continue
      }
    }
    // Standalone `}` in arg position is a word (e.g., `echo }foo`).
    // parseBareWord breaks on `}` so handle it here.
    if (c === '}') {
      const bStart = P.L.b
      advance(P.L)
      parts.push(mk(P, 'word', bStart, P.L.b, []))
      continue
    }
    // `[` and `]` are single-char word fragments (tree-sitter splits at
    // brackets: `[:lower:]` → `[` `:lower:` `]`, `{o[k]}` → 6 words).
    if (c === '[' || c === ']') {
      const bStart = P.L.b
      advance(P.L)
      parts.push(mk(P, 'word', bStart, P.L.b, []))
      continue
    }
    // Bare word fragment
    const frag = parseBareWord(P)
    if (!frag) break
    // `NN#${...}` or `NN#$(...)` → (number (expansion|command_substitution)).
    // Grammar: number can be seq(/-?(0x)?[0-9]+#/, choice(expansion, cmd_sub)).
    // `10#${cmd}` must NOT be concatenation — it's a single number node with
    // the expansion as child. Detect here: frag ends with `#`, next is $ {/(.
    if (
      frag.type === 'word' &&
      /^-?(0x)?[0-9]+#$/.test(frag.text) &&
      peek(P.L) === '$' &&
      (peek(P.L, 1) === '{' || peek(P.L, 1) === '(')
    ) {
      const exp = parseDollarLike(P)
      if (exp) {
        // Prefix `NN#` is an anonymous pattern in grammar — only the
        // expansion/cmd_sub is a named child.
        parts.push(mk(P, 'number', frag.startIndex, exp.endIndex, [exp]))
        continue
      }
    }
    parts.push(frag)
  }
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]!
  // Concatenation
  const first = parts[0]!
  const last = parts[parts.length - 1]!
  return mk(P, 'concatenation', first.startIndex, last.endIndex, parts)
}
// parseWord 收尾：[ ] 是单字符单词片段（tree-sitter 在括号处切分：[:lower:] 切成三个词）；NN#${...} 形状是单 number 节点内嵌展开（不能当拼接）。

// parseBareWord：裸词片段——反斜杠转义（行连接会断词，tree-sitter 怪癖）与各类终止字符。纯数字串标 number 节点。
function parseBareWord(P: ParseState): TsNode | null {
  const start = P.L.b
  const startI = P.L.i
  while (P.L.i < P.L.len) {
    const c = peek(P.L)
    if (c === '\\') {
      if (P.L.i + 1 >= P.L.len) {
        // Trailing unpaired `\` at true EOF — tree-sitter emits word WITHOUT
        // the `\` plus a sibling ERROR node. Stop here; caller emits ERROR.
        break
      }
      const nx = P.L.src[P.L.i + 1]
      if (nx === '\n' || (nx === '\r' && P.L.src[P.L.i + 2] === '\n')) {
        // Line continuation BREAKS the word (tree-sitter quirk) — handles \r?\n
        break
      }
      advance(P.L)
      advance(P.L)
      continue
    }
    if (
      c === ' ' ||
      c === '\t' ||
      c === '\n' ||
      c === '\r' ||
      c === '' ||
      c === '|' ||
      c === '&' ||
      c === ';' ||
      c === '(' ||
      c === ')' ||
      c === '<' ||
      c === '>' ||
      c === '"' ||
      c === "'" ||
      c === '$' ||
      c === '`' ||
      c === '{' ||
      c === '}' ||
      c === '[' ||
      c === ']'
    ) {
      break
    }
    advance(P.L)
  }
  if (P.L.b === start) return null
  const text = P.src.slice(startI, P.L.i)
  const type = /^-?\d+$/.test(text) ? 'number' : 'word'
  return mk(P, type, start, P.L.b, [])
}
// parseBareWord 收尾：EOF 处孤立反斜杠不进词——留给调用方发兄弟 ERROR 节点。

// tryParseBraceExpr：花括号区间展开 {1..5} 或 {a..z}——两侧同为数字或同为单字符才成立，混合即拒绝回退。产出 brace_expression 节点（五个子节点：{ 左值 .. 右值 }）。
function tryParseBraceExpr(P: ParseState): TsNode | null {
  // {N..M} where N, M are numbers or single chars
  const save = saveLex(P.L)
  if (peek(P.L) !== '{') return null
  const oStart = P.L.b
  advance(P.L)
  const oEnd = P.L.b
  // First part
  const p1Start = P.L.b
  while (isDigit(peek(P.L)) || isIdentStart(peek(P.L))) advance(P.L)
  const p1End = P.L.b
  if (p1End === p1Start || peek(P.L) !== '.' || peek(P.L, 1) !== '.') {
    restoreLex(P.L, save)
    return null
  }
  const dotStart = P.L.b
  advance(P.L)
  advance(P.L)
  const dotEnd = P.L.b
  const p2Start = P.L.b
  while (isDigit(peek(P.L)) || isIdentStart(peek(P.L))) advance(P.L)
  const p2End = P.L.b
  if (p2End === p2Start || peek(P.L) !== '}') {
    restoreLex(P.L, save)
    return null
  }
  const cStart = P.L.b
  advance(P.L)
  const cEnd = P.L.b
  const p1Text = sliceBytes(P, p1Start, p1End)
  const p2Text = sliceBytes(P, p2Start, p2End)
  const p1IsNum = /^\d+$/.test(p1Text)
  const p2IsNum = /^\d+$/.test(p2Text)
  // Valid brace expression: both numbers OR both single chars. Mixed = reject.
  if (p1IsNum !== p2IsNum) {
    restoreLex(P.L, save)
    return null
  }
  if (!p1IsNum && (p1Text.length !== 1 || p2Text.length !== 1)) {
    restoreLex(P.L, save)
    return null
  }
  const p1Type = p1IsNum ? 'number' : 'word'
  const p2Type = p2IsNum ? 'number' : 'word'
  return mk(P, 'brace_expression', oStart, cEnd, [
    mk(P, '{', oStart, oEnd, []),
    mk(P, p1Type, p1Start, p1End, []),
    mk(P, '..', dotStart, dotEnd, []),
    mk(P, p2Type, p2Start, p2End, []),
    mk(P, '}', cStart, cEnd, []),
  ])
}
// tryParseBraceExpr 收尾：不是合法区间展开就回溯（调用方再试 cat 式切分或当普通词）。

// tryParseBraceLikeCat：{a,b,c} 或 {} 切成单词片段序列——复刻 tree-sitter 不求值花括号展开、只按逗号切词的行为。
function tryParseBraceLikeCat(P: ParseState): TsNode[] | null {
  // {a,b,c} or {} → split into word fragments like tree-sitter does
  if (peek(P.L) !== '{') return null
  const oStart = P.L.b
  advance(P.L)
  const oEnd = P.L.b
  const inner: TsNode[] = [mk(P, 'word', oStart, oEnd, [])]
  while (P.L.i < P.L.len) {
    const bc = peek(P.L)
    // SECURITY: stop at command terminators so `{foo;rm x` splits correctly.
// 同样的安全判别：内部扫描在命令终止符处必须断开，{foo;rm x 要在 ; 处切开让 rm 暴露给安全行走器。
    if (
      bc === '}' ||
      bc === '\n' ||
      bc === ';' ||
      bc === '|' ||
      bc === '&' ||
      bc === ' ' ||
      bc === '\t' ||
      bc === '<' ||
      bc === '>' ||
      bc === '(' ||
      bc === ')'
    ) {
      break
    }
    // `[` and `]` are single-char words: {o[k]} → { o [ k ] }
    if (bc === '[' || bc === ']') {
      const bStart = P.L.b
      advance(P.L)
      inner.push(mk(P, 'word', bStart, P.L.b, []))
      continue
    }
    const midStart = P.L.b
    while (P.L.i < P.L.len) {
      const mc = peek(P.L)
      if (
        mc === '}' ||
        mc === '\n' ||
        mc === ';' ||
        mc === '|' ||
        mc === '&' ||
        mc === ' ' ||
        mc === '\t' ||
        mc === '<' ||
        mc === '>' ||
        mc === '(' ||
        mc === ')' ||
        mc === '[' ||
        mc === ']'
      ) {
        break
      }
      advance(P.L)
    }
    const midEnd = P.L.b
    if (midEnd > midStart) {
      const midText = sliceBytes(P, midStart, midEnd)
      const midType = /^-?\d+$/.test(midText) ? 'number' : 'word'
      inner.push(mk(P, midType, midStart, midEnd, []))
    } else {
      break
    }
  }
  if (peek(P.L) === '}') {
    const cStart = P.L.b
    advance(P.L)
    inner.push(mk(P, 'word', cStart, P.L.b, []))
  }
  return inner
}
// tryParseBraceLikeCat 收尾：闭合 } 缺失时返回已切出的片段（不回溯）——错误输入保持最接近的形状。

// parseDoubleQuoted：双引号串——内部展开（$、反引号）切分为兄弟节点，文本段为 string_content。
function parseDoubleQuoted(P: ParseState): TsNode {
  const qStart = P.L.b
  advance(P.L)
  const qEnd = P.L.b
  const openQ = mk(P, '"', qStart, qEnd, [])
  const parts: TsNode[] = [openQ]
  let contentStart = P.L.b
  let contentStartI = P.L.i
  const flushContent = (): void => {
    if (P.L.b > contentStart) {
      // Tree-sitter's extras rule /\s/ has higher precedence than
      // string_content (prec -1), so whitespace-only segments are elided.
      // `" ${x} "` → (string (expansion)) not (string (string_content)(expansion)(string_content)).
      // Note: this intentionally diverges from preserving all content — cc
      // tests relying on whitespace-only string_content need updating
      // (CCReconcile).
// 空白段的取舍（故意偏离「保留全部内容」）：纯空白文本段被丢弃——tree-sitter 的 extras 规则（正则空白类）优先级高于 string_content（prec -1），所以 「 ${x} 」 只发 string(expansion) 不发两段空白。依赖纯空白 string_content 的内部测试需要跟着改。
      const txt = P.src.slice(contentStartI, P.L.i)
      if (!/^[ \t]+$/.test(txt)) {
        parts.push(mk(P, 'string_content', contentStart, P.L.b, []))
      }
    }
  }
  while (P.L.i < P.L.len) {
    const c = peek(P.L)
    if (c === '"') break
    if (c === '\\' && P.L.i + 1 < P.L.len) {
      advance(P.L)
      advance(P.L)
      continue
    }
    if (c === '\n') {
      // Split string_content at newline
      flushContent()
      advance(P.L)
      contentStart = P.L.b
      contentStartI = P.L.i
      continue
    }
    if (c === '$') {
      const c1 = peek(P.L, 1)
      if (
        c1 === '(' ||
        c1 === '{' ||
        isIdentStart(c1) ||
        SPECIAL_VARS.has(c1) ||
        isDigit(c1)
      ) {
        flushContent()
        const exp = parseDollarLike(P)
        if (exp) parts.push(exp)
        contentStart = P.L.b
        contentStartI = P.L.i
        continue
      }
      // Bare $ not at end-of-string: tree-sitter emits it as an anonymous
      // '$' token, which splits string_content. $ immediately before the
      // closing " is absorbed into the preceding string_content.
      if (c1 !== '"' && c1 !== '') {
        flushContent()
        const dS = P.L.b
        advance(P.L)
        parts.push(mk(P, '$', dS, P.L.b, []))
        contentStart = P.L.b
        contentStartI = P.L.i
        continue
      }
    }
    if (c === '`') {
      flushContent()
      const bt = parseBacktick(P)
      if (bt) parts.push(bt)
      contentStart = P.L.b
      contentStartI = P.L.i
      continue
    }
    advance(P.L)
  }
  flushContent()
  let close: TsNode
  if (peek(P.L) === '"') {
    const cStart = P.L.b
    advance(P.L)
    close = mk(P, '"', cStart, P.L.b, [])
  } else {
    close = mk(P, '"', P.L.b, P.L.b, [])
  }
  parts.push(close)
  return mk(P, 'string', qStart, close.endIndex, parts)
}
// parseDoubleQuoted 收尾：闭引号缺失补零宽节点；裸 $ 紧贴闭引号时被吸收进前段 string_content，其余位置的裸 $ 发匿名 $ 节点并切分文本。

// parseDollarLike：$ 家族总入口——$(( 算术、$[ 旧式算术、$( 命令替换、${ 参数展开、$VAR/$? 简单展开、孤立 $ 叶子。
function parseDollarLike(P: ParseState): TsNode | null {
  const c1 = peek(P.L, 1)
  const dStart = P.L.b
  if (c1 === '(' && peek(P.L, 2) === '(') {
    // $(( arithmetic ))
    advance(P.L)
    advance(P.L)
    advance(P.L)
    const open = mk(P, '$((', dStart, P.L.b, [])
    const exprs = parseArithCommaList(P, '))', 'var')
    skipBlanks(P.L)
    let close: TsNode
    if (peek(P.L) === ')' && peek(P.L, 1) === ')') {
      const cStart = P.L.b
      advance(P.L)
      advance(P.L)
      close = mk(P, '))', cStart, P.L.b, [])
    } else {
      close = mk(P, '))', P.L.b, P.L.b, [])
    }
    return mk(P, 'arithmetic_expansion', dStart, close.endIndex, [
      open,
      ...exprs,
      close,
    ])
  }
  if (c1 === '[') {
    // $[ arithmetic ] — legacy bash syntax, same as $((...))
    advance(P.L)
    advance(P.L)
    const open = mk(P, '$[', dStart, P.L.b, [])
    const exprs = parseArithCommaList(P, ']', 'var')
    skipBlanks(P.L)
    let close: TsNode
    if (peek(P.L) === ']') {
      const cStart = P.L.b
      advance(P.L)
      close = mk(P, ']', cStart, P.L.b, [])
    } else {
      close = mk(P, ']', P.L.b, P.L.b, [])
    }
    return mk(P, 'arithmetic_expansion', dStart, close.endIndex, [
      open,
      ...exprs,
      close,
    ])
  }
  if (c1 === '(') {
    advance(P.L)
    advance(P.L)
    const open = mk(P, '$(', dStart, P.L.b, [])
    let body = parseStatements(P, ')')
    skipBlanks(P.L)
    let close: TsNode
    if (peek(P.L) === ')') {
      const cStart = P.L.b
      advance(P.L)
      close = mk(P, ')', cStart, P.L.b, [])
    } else {
      close = mk(P, ')', P.L.b, P.L.b, [])
    }
    // $(< file) shorthand: unwrap redirected_statement → bare file_redirect
    // tree-sitter emits (command_substitution (file_redirect (word))) directly
// $(< file) 简写：解包 redirected_statement 直接露出 file_redirect——对齐 tree-sitter 直接发 command_substitution(file_redirect(word)) 的形状。
    if (
      body.length === 1 &&
      body[0]!.type === 'redirected_statement' &&
      body[0]!.children.length === 1 &&
      body[0]!.children[0]!.type === 'file_redirect'
    ) {
      body = body[0]!.children
    }
    return mk(P, 'command_substitution', dStart, close.endIndex, [
      open,
      ...body,
      close,
    ])
  }
  if (c1 === '{') {
    advance(P.L)
    advance(P.L)
    const open = mk(P, '${', dStart, P.L.b, [])
    const inner = parseExpansionBody(P)
    let close: TsNode
    if (peek(P.L) === '}') {
      const cStart = P.L.b
      advance(P.L)
      close = mk(P, '}', cStart, P.L.b, [])
    } else {
      close = mk(P, '}', P.L.b, P.L.b, [])
    }
    return mk(P, 'expansion', dStart, close.endIndex, [open, ...inner, close])
  }
  // Simple expansion $VAR or $? $$ $@ etc
  advance(P.L)
  const dEnd = P.L.b
  const dollar = mk(P, '$', dStart, dEnd, [])
  const nc = peek(P.L)
  // $_ is special_variable_name only when not followed by more ident chars
  if (nc === '_' && !isIdentChar(peek(P.L, 1))) {
    const vStart = P.L.b
    advance(P.L)
    const vn = mk(P, 'special_variable_name', vStart, P.L.b, [])
    return mk(P, 'simple_expansion', dStart, P.L.b, [dollar, vn])
  }
  if (isIdentStart(nc)) {
    const vStart = P.L.b
    while (isIdentChar(peek(P.L))) advance(P.L)
    const vn = mk(P, 'variable_name', vStart, P.L.b, [])
    return mk(P, 'simple_expansion', dStart, P.L.b, [dollar, vn])
  }
  if (isDigit(nc)) {
    const vStart = P.L.b
    advance(P.L)
    const vn = mk(P, 'variable_name', vStart, P.L.b, [])
    return mk(P, 'simple_expansion', dStart, P.L.b, [dollar, vn])
  }
  if (SPECIAL_VARS.has(nc)) {
    const vStart = P.L.b
    advance(P.L)
    const vn = mk(P, 'special_variable_name', vStart, P.L.b, [])
    return mk(P, 'simple_expansion', dStart, P.L.b, [dollar, vn])
  }
  // Bare $ — just a $ leaf (tree-sitter treats trailing $ as literal)
  return dollar
}
// parseDollarLike 收尾：$_ 仅在不跟更多标识符字符时是 special_variable_name（否则是普通变量名的一部分）；认不出的 $ 后字符就返回孤立 $ 叶子。

// parseExpansionBody：${...} 内部解析——#（取长度）与 !（间接展开）前缀、变量名、[下标]、尾部 * @、以及一大类操作符（:- := :? :+ # ## % %% / // ^ ^^ , ,,）。
function parseExpansionBody(P: ParseState): TsNode[] {
  const out: TsNode[] = []
  skipBlanks(P.L)
  // Bizarre cases: ${#!} ${!#} ${!##} ${!# } ${!## } all emit empty (expansion)
  // — both # and ! become anonymous nodes when only combined with each other
  // and optional trailing space before }. Note ${!##/} does NOT match (has
  // content after), so it parses normally as (special_variable_name)(regex).
// 古怪特判：${#!} ${!#} ${!##} ${!# } 这类只有 # 与 ! 互组合的输入一律发空 expansion——tree-sitter 里它们都退化成匿名节点。注意 ${!##/} 有后续内容，走正常解析。
  {
    const c0 = peek(P.L)
    const c1 = peek(P.L, 1)
    if (c0 === '#' && c1 === '!' && peek(P.L, 2) === '}') {
      advance(P.L)
      advance(P.L)
      return out
    }
    if (c0 === '!' && c1 === '#') {
      // ${!#} ${!##} with optional trailing space then }
      let j = 2
      if (peek(P.L, j) === '#') j++
      if (peek(P.L, j) === ' ') j++
      if (peek(P.L, j) === '}') {
        while (j-- > 0) advance(P.L)
        return out
      }
    }
  }
  // Optional # prefix for length
  if (peek(P.L) === '#') {
    const s = P.L.b
    advance(P.L)
    out.push(mk(P, '#', s, P.L.b, []))
  }
  // Optional ! prefix for indirect expansion: ${!varname} ${!prefix*} ${!prefix@}
  // Only when followed by an identifier — ${!} alone is special var $!
  // Also = ~ prefixes (zsh-style ${=var} ${~var})
  const pc = peek(P.L)
  if (
    (pc === '!' || pc === '=' || pc === '~') &&
    (isIdentStart(peek(P.L, 1)) || isDigit(peek(P.L, 1)))
  ) {
    const s = P.L.b
    advance(P.L)
    out.push(mk(P, pc, s, P.L.b, []))
  }
  skipBlanks(P.L)
  // Variable name
  if (isIdentStart(peek(P.L))) {
    const s = P.L.b
    while (isIdentChar(peek(P.L))) advance(P.L)
    out.push(mk(P, 'variable_name', s, P.L.b, []))
  } else if (isDigit(peek(P.L))) {
    const s = P.L.b
    while (isDigit(peek(P.L))) advance(P.L)
    out.push(mk(P, 'variable_name', s, P.L.b, []))
  } else if (SPECIAL_VARS.has(peek(P.L))) {
    const s = P.L.b
    advance(P.L)
    out.push(mk(P, 'special_variable_name', s, P.L.b, []))
  }
  // Optional subscript [idx] — parsed arithmetically
  if (peek(P.L) === '[') {
    const varNode = out[out.length - 1]
    const brOpen = P.L.b
    advance(P.L)
    const brOpenNode = mk(P, '[', brOpen, P.L.b, [])
    const idx = parseSubscriptIndexInline(P)
    skipBlanks(P.L)
    const brClose = P.L.b
    if (peek(P.L) === ']') advance(P.L)
    const brCloseNode = mk(P, ']', brClose, P.L.b, [])
    if (varNode) {
      const kids = idx
        ? [varNode, brOpenNode, idx, brCloseNode]
        : [varNode, brOpenNode, brCloseNode]
      out[out.length - 1] = mk(P, 'subscript', varNode.startIndex, P.L.b, kids)
    }
  }
  skipBlanks(P.L)
  // Trailing * or @ for indirect expansion (${!prefix*} ${!prefix@}) or
  // @operator for parameter transformation (${var@U} ${var@Q}) — anonymous
  const tc = peek(P.L)
  if ((tc === '*' || tc === '@') && peek(P.L, 1) === '}') {
    const s = P.L.b
    advance(P.L)
    out.push(mk(P, tc, s, P.L.b, []))
    return out
  }
  if (tc === '@' && isIdentStart(peek(P.L, 1))) {
    // ${var@U} transformation — @ is anonymous, consume op char(s)
    const s = P.L.b
    advance(P.L)
    out.push(mk(P, '@', s, P.L.b, []))
    while (isIdentChar(peek(P.L))) advance(P.L)
    return out
  }
  // Operator :- := :? :+ - = ? + # ## % %% / // ^ ^^ , ,, etc.
  const c = peek(P.L)
  // Bare `:` substring operator ${var:off:len} — offset and length parsed
  // arithmetically. Must come BEFORE the generic operator handling so `(` after
  // `:` goes to parenthesized_expression not the array path. `:-` `:=` `:?`
  // `:+` (no space) remain default-value operators; `: -1` (with space before
  // -1) is substring with negative offset.
// 裸 : 子串操作符 ${var:off:len} 的偏移与长度按算术解析，必须在通用操作符处理之前判断（否则 : 后的 ( 会走错数组分支）；:- := :? :+（无空格）仍是默认值操作符；冒号后带空格的负数（: -1）是负偏移子串。
  if (c === ':') {
    const c1 = peek(P.L, 1)
    // `:\n` or `:}` — empty substring expansion, emits nothing (variable_name only)
    if (c1 === '\n' || c1 === '}') {
      advance(P.L)
      while (peek(P.L) === '\n') advance(P.L)
      return out
    }
    if (c1 !== '-' && c1 !== '=' && c1 !== '?' && c1 !== '+') {
      advance(P.L)
      skipBlanks(P.L)
      // Offset — arithmetic. `-N` at top level is a single number node per
      // tree-sitter; inside parens it's unary_expression(number).
      const offC = peek(P.L)
      let off: TsNode | null
      if (offC === '-' && isDigit(peek(P.L, 1))) {
        const ns = P.L.b
        advance(P.L)
        while (isDigit(peek(P.L))) advance(P.L)
        off = mk(P, 'number', ns, P.L.b, [])
      } else {
        off = parseArithExpr(P, ':}', 'var')
      }
      if (off) out.push(off)
      skipBlanks(P.L)
      if (peek(P.L) === ':') {
        advance(P.L)
        skipBlanks(P.L)
        const lenC = peek(P.L)
        let len: TsNode | null
        if (lenC === '-' && isDigit(peek(P.L, 1))) {
          const ns = P.L.b
          advance(P.L)
          while (isDigit(peek(P.L))) advance(P.L)
          len = mk(P, 'number', ns, P.L.b, [])
        } else {
          len = parseArithExpr(P, '}', 'var')
        }
        if (len) out.push(len)
      }
      return out
    }
  }
  if (
    c === ':' ||
    c === '#' ||
    c === '%' ||
    c === '/' ||
    c === '^' ||
    c === ',' ||
    c === '-' ||
    c === '=' ||
    c === '?' ||
    c === '+'
  ) {
    const s = P.L.b
    const c1 = peek(P.L, 1)
    let op = c
    if (c === ':' && (c1 === '-' || c1 === '=' || c1 === '?' || c1 === '+')) {
      advance(P.L)
      advance(P.L)
      op = c + c1
    } else if (
      (c === '#' || c === '%' || c === '/' || c === '^' || c === ',') &&
      c1 === c
    ) {
      // Doubled operators: ## %% // ^^ ,,
      advance(P.L)
      advance(P.L)
      op = c + c
    } else {
      advance(P.L)
    }
    out.push(mk(P, op, s, P.L.b, []))
    // Rest is the default/replacement — parse as word or regex until }
    // Pattern-matching operators (# ## % %% / // ^ ^^ , ,,) emit regex;
    // value-substitution operators (:- := :? :+ - = ? + :) emit word.
    // `/` and `//` split at next `/` into (regex)+(word) for pat/repl.
    const isPattern =
      op === '#' ||
      op === '##' ||
      op === '%' ||
      op === '%%' ||
      op === '/' ||
      op === '//' ||
      op === '^' ||
      op === '^^' ||
      op === ',' ||
      op === ',,'
    if (op === '/' || op === '//') {
      // Optional /# or /% anchor prefix — anonymous node
      const ac = peek(P.L)
      if (ac === '#' || ac === '%') {
        const aStart = P.L.b
        advance(P.L)
        out.push(mk(P, ac, aStart, P.L.b, []))
      }
      // Pattern: per grammar _expansion_regex_replacement, pattern is
      // choice(regex, string, cmd_sub, seq(string, regex)). If it STARTS
      // with ", emit (string) and any trailing chars become (regex).
      // `${v//"${old}"/}` → (string(expansion)); `${v//"${c}"\//}` →
      // (string)(regex).
      if (peek(P.L) === '"') {
        out.push(parseDoubleQuoted(P))
        const tail = parseExpansionRest(P, 'regex', true)
        if (tail) out.push(tail)
      } else {
        const regex = parseExpansionRest(P, 'regex', true)
        if (regex) out.push(regex)
      }
      if (peek(P.L) === '/') {
        const sepStart = P.L.b
        advance(P.L)
        out.push(mk(P, '/', sepStart, P.L.b, []))
        // Replacement: per grammar, choice includes `seq(cmd_sub, word)`
        // which emits TWO siblings (not concatenation). Also `(` at start
        // of replacement is a regular word char, NOT array — unlike `:-`
        // default-value context. `${v/(/(Gentoo ${x}, }` replacement
        // `(Gentoo ${x}, ` is (concatenation (word)(expansion)(word)).
        const repl = parseExpansionRest(P, 'replword', false)
        if (repl) {
          // seq(cmd_sub, word) special case → siblings. Detected when
          // replacement is a concatenation of exactly 2 parts with first
          // being command_substitution.
          if (
            repl.type === 'concatenation' &&
            repl.children.length === 2 &&
            repl.children[0]!.type === 'command_substitution'
          ) {
            out.push(repl.children[0]!)
            out.push(repl.children[1]!)
          } else {
            out.push(repl)
          }
        }
      }
    } else if (op === '#' || op === '##' || op === '%' || op === '%%') {
      // Pattern-removal: per grammar _expansion_regex, pattern is
      // repeat(choice(regex, string, raw_string, ')')). Each quote/string
      // is a SIBLING, not absorbed into one regex. `${f%'str'*}` →
      // (raw_string)(regex); `${f/'str'*}` (slash) stays single regex.
      for (const p of parseExpansionRegexSegmented(P)) out.push(p)
    } else {
      const rest = parseExpansionRest(P, isPattern ? 'regex' : 'word', false)
      if (rest) out.push(rest)
    }
  }
  return out
}
// parseExpansionBody 收尾：/ 与 // 的替换值里 seq(cmd_sub, word) 特例拆成两个兄弟节点；模式删除类（# ## % %%）走分段 regex 解析。

// parseExpansionRest：操作符右侧的值解析，三种模式——word（值替换 RHS，( 开头按数组）、regex（模式匹配 RHS，引号不透明跳过、整段一个 regex 节点）、replword（/ 的替换值，( 是普通字符）。不 skipBlanks——${var:- } 里的空格本身就是值。
function parseExpansionRest(
  P: ParseState,
  nodeType: string,
  stopAtSlash: boolean,
): TsNode | null {
  // Don't skipBlanks — `${var:- }` space IS the word. Stop at } or newline
  // (`${var:\n}` emits no word). stopAtSlash=true stops at `/` for pat/repl
  // split in ${var/pat/repl}. nodeType 'replword' is word-mode for the
  // replacement in `/` `//` — same as 'word' but `(` is NOT array.
  const start = P.L.b
  // Value-substitution RHS starting with `(` parses as array: ${var:-(x)} →
  // (expansion (variable_name) (array (word))). Only for 'word' context (not
  // pattern-matching operators which emit regex, and not 'replword' where `(`
  // is a regular char per grammar `_expansion_regex_replacement`).
  if (nodeType === 'word' && peek(P.L) === '(') {
    advance(P.L)
    const open = mk(P, '(', start, P.L.b, [])
    const elems: TsNode[] = [open]
    while (P.L.i < P.L.len) {
      skipBlanks(P.L)
      const c = peek(P.L)
      if (c === ')' || c === '}' || c === '\n' || c === '') break
      const wStart = P.L.b
      while (P.L.i < P.L.len) {
        const wc = peek(P.L)
        if (
          wc === ')' ||
          wc === '}' ||
          wc === ' ' ||
          wc === '\t' ||
          wc === '\n' ||
          wc === ''
        ) {
          break
        }
        advance(P.L)
      }
      if (P.L.b > wStart) elems.push(mk(P, 'word', wStart, P.L.b, []))
      else break
    }
    if (peek(P.L) === ')') {
      const cStart = P.L.b
      advance(P.L)
      elems.push(mk(P, ')', cStart, P.L.b, []))
    }
    while (peek(P.L) === '\n') advance(P.L)
    return mk(P, 'array', start, P.L.b, elems)
  }
  // REGEX mode: flat single-span scan. Quotes are opaque (skipped past so
  // `/` inside them doesn't break stopAtSlash), but NOT emitted as separate
  // nodes — the entire range becomes one regex node.
// regex 模式的边界处理：引号段不透明跳过（内部的 / 不会误触 stopAtSlash）；嵌套 ${...} $(...) 内部的 } 与 / 也不会提前终止——用深度计数跳过。
  if (nodeType === 'regex') {
    let braceDepth = 0
    while (P.L.i < P.L.len) {
      const c = peek(P.L)
      if (c === '\n') break
      if (braceDepth === 0) {
        if (c === '}') break
        if (stopAtSlash && c === '/') break
      }
      if (c === '\\' && P.L.i + 1 < P.L.len) {
        advance(P.L)
        advance(P.L)
        continue
      }
      if (c === '"' || c === "'") {
        advance(P.L)
        while (P.L.i < P.L.len && peek(P.L) !== c) {
          if (peek(P.L) === '\\' && P.L.i + 1 < P.L.len) advance(P.L)
          advance(P.L)
        }
        if (peek(P.L) === c) advance(P.L)
        continue
      }
      // Skip past nested ${...} $(...) $[...] so their } / don't terminate us
      if (c === '$') {
        const c1 = peek(P.L, 1)
        if (c1 === '{') {
          let d = 0
          advance(P.L)
          advance(P.L)
          d++
          while (P.L.i < P.L.len && d > 0) {
            const nc = peek(P.L)
            if (nc === '{') d++
            else if (nc === '}') d--
            advance(P.L)
          }
          continue
        }
        if (c1 === '(') {
          let d = 0
          advance(P.L)
          advance(P.L)
          d++
          while (P.L.i < P.L.len && d > 0) {
            const nc = peek(P.L)
            if (nc === '(') d++
            else if (nc === ')') d--
            advance(P.L)
          }
          continue
        }
      }
      if (c === '{') braceDepth++
      else if (c === '}' && braceDepth > 0) braceDepth--
      advance(P.L)
    }
    const end = P.L.b
    while (peek(P.L) === '\n') advance(P.L)
    if (end === start) return null
    return mk(P, 'regex', start, end, [])
  }
  // WORD mode: segmenting parser — recognize nested ${...}, $(...), $'...',
  // "...", '...', $ident, <(...)/>(...); bare chars accumulate into word
  // segments. Multiple parts → wrapped in concatenation.
  const parts: TsNode[] = []
  let segStart = P.L.b
  let braceDepth = 0
  const flushSeg = (): void => {
    if (P.L.b > segStart) {
      parts.push(mk(P, 'word', segStart, P.L.b, []))
    }
  }
  while (P.L.i < P.L.len) {
    const c = peek(P.L)
    if (c === '\n') break
    if (braceDepth === 0) {
      if (c === '}') break
      if (stopAtSlash && c === '/') break
    }
    if (c === '\\' && P.L.i + 1 < P.L.len) {
      advance(P.L)
      advance(P.L)
      continue
    }
    const c1 = peek(P.L, 1)
    if (c === '$') {
      if (c1 === '{' || c1 === '(' || c1 === '[') {
        flushSeg()
        const exp = parseDollarLike(P)
        if (exp) parts.push(exp)
        segStart = P.L.b
        continue
      }
      if (c1 === "'") {
        // $'...' ANSI-C string
        flushSeg()
        const aStart = P.L.b
        advance(P.L)
        advance(P.L)
        while (P.L.i < P.L.len && peek(P.L) !== "'") {
          if (peek(P.L) === '\\' && P.L.i + 1 < P.L.len) advance(P.L)
          advance(P.L)
        }
        if (peek(P.L) === "'") advance(P.L)
        parts.push(mk(P, 'ansi_c_string', aStart, P.L.b, []))
        segStart = P.L.b
        continue
      }
      if (isIdentStart(c1) || isDigit(c1) || SPECIAL_VARS.has(c1)) {
        flushSeg()
        const exp = parseDollarLike(P)
        if (exp) parts.push(exp)
        segStart = P.L.b
        continue
      }
    }
    if (c === '"') {
      flushSeg()
      parts.push(parseDoubleQuoted(P))
      segStart = P.L.b
      continue
    }
    if (c === "'") {
      flushSeg()
      const rStart = P.L.b
      advance(P.L)
      while (P.L.i < P.L.len && peek(P.L) !== "'") advance(P.L)
      if (peek(P.L) === "'") advance(P.L)
      parts.push(mk(P, 'raw_string', rStart, P.L.b, []))
      segStart = P.L.b
      continue
    }
    if ((c === '<' || c === '>') && c1 === '(') {
      flushSeg()
      const ps = parseProcessSub(P)
      if (ps) parts.push(ps)
      segStart = P.L.b
      continue
    }
    if (c === '`') {
      flushSeg()
      const bt = parseBacktick(P)
      if (bt) parts.push(bt)
      segStart = P.L.b
      continue
    }
    // Brace tracking so nested {a,b} brace-expansion chars don't prematurely
    // terminate (rare, but the `?` in `${cond}? (` should be treated as word).
    if (c === '{') braceDepth++
    else if (c === '}' && braceDepth > 0) braceDepth--
    advance(P.L)
  }
  flushSeg()
  // Consume trailing newlines before } so caller sees }
  while (peek(P.L) === '\n') advance(P.L)
  // Tree-sitter skips leading whitespace (extras) in expansion RHS when
  // there's content after: `${2+ ${2}}` → just (expansion). But `${v:- }`
  // (space-only RHS) keeps the space as (word). So drop leading whitespace-
  // only word segment if it's NOT the only part.
  if (
    parts.length > 1 &&
    parts[0]!.type === 'word' &&
    /^[ \t]+$/.test(parts[0]!.text)
  ) {
    parts.shift()
  }
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]!
  // Multiple parts: wrap in concatenation (word mode keeps concat wrapping;
  // regex mode also concats per tree-sitter for mixed quote+glob patterns).
  const last = parts[parts.length - 1]!
  return mk(P, 'concatenation', parts[0]!.startIndex, last.endIndex, parts)
}
// parseExpansionRest 收尾（word 模式）：嵌套展开/引号/进程替换切成多段包 concatenation；有后续内容时丢弃前导纯空白段（tree-sitter extras 吞掉它），但 ${v:- } 这种纯空白 RHS 保留空间段。

// parseExpansionRegexSegmented：# ## % %% 操作符的模式解析——每个引号段是兄弟节点而非被吸收：${f% 引号 str 引号 *} 发 raw_string 与 regex 两个节点。
// Pattern for # ## % %% operators — per grammar _expansion_regex:
// repeat(choice(regex, string, raw_string, ')', /\s+/→regex)). Each quote
// becomes a SIBLING node, not absorbed. `${f%'str'*}` → (raw_string)(regex).
function parseExpansionRegexSegmented(P: ParseState): TsNode[] {
  const out: TsNode[] = []
  let segStart = P.L.b
  const flushRegex = (): void => {
    if (P.L.b > segStart) out.push(mk(P, 'regex', segStart, P.L.b, []))
  }
  while (P.L.i < P.L.len) {
    const c = peek(P.L)
    if (c === '}' || c === '\n') break
    if (c === '\\' && P.L.i + 1 < P.L.len) {
      advance(P.L)
      advance(P.L)
      continue
    }
    if (c === '"') {
      flushRegex()
      out.push(parseDoubleQuoted(P))
      segStart = P.L.b
      continue
    }
    if (c === "'") {
      flushRegex()
      const rStart = P.L.b
      advance(P.L)
      while (P.L.i < P.L.len && peek(P.L) !== "'") advance(P.L)
      if (peek(P.L) === "'") advance(P.L)
      out.push(mk(P, 'raw_string', rStart, P.L.b, []))
      segStart = P.L.b
      continue
    }
    // Nested ${...} $(...) — opaque scan so their } doesn't terminate us
    if (c === '$') {
      const c1 = peek(P.L, 1)
      if (c1 === '{') {
        let d = 1
        advance(P.L)
        advance(P.L)
        while (P.L.i < P.L.len && d > 0) {
          const nc = peek(P.L)
          if (nc === '{') d++
          else if (nc === '}') d--
          advance(P.L)
        }
        continue
      }
      if (c1 === '(') {
        let d = 1
        advance(P.L)
        advance(P.L)
        while (P.L.i < P.L.len && d > 0) {
          const nc = peek(P.L)
          if (nc === '(') d++
          else if (nc === ')') d--
          advance(P.L)
        }
        continue
      }
    }
    advance(P.L)
  }
  flushRegex()
  while (peek(P.L) === '\n') advance(P.L)
  return out
}
// parseExpansionRegexSegmented 收尾：嵌套 ${...} $(...) 不透明跳过，防止内部的 } 提前终止。

// parseBacktick：反引号命令替换——正文按完整语句解析（inBacktick 计数让内层反引号终止单词），产出 command_substitution。
function parseBacktick(P: ParseState): TsNode | null {
  const start = P.L.b
  advance(P.L)
  const open = mk(P, '`', start, P.L.b, [])
  P.inBacktick++
  // Parse statements inline — stop at closing backtick
  const body: TsNode[] = []
  while (true) {
    skipBlanks(P.L)
    if (peek(P.L) === '`' || peek(P.L) === '') break
    const save = saveLex(P.L)
    const t = nextToken(P.L, 'cmd')
    if (t.type === 'EOF' || t.type === 'BACKTICK') {
      restoreLex(P.L, save)
      break
    }
    if (t.type === 'NEWLINE') continue
    restoreLex(P.L, save)
    const stmt = parseAndOr(P)
    if (!stmt) break
    body.push(stmt)
    skipBlanks(P.L)
    if (peek(P.L) === '`') break
    const save2 = saveLex(P.L)
    const sep = nextToken(P.L, 'cmd')
    if (sep.type === 'OP' && (sep.value === ';' || sep.value === '&')) {
      body.push(leaf(P, sep.value, sep))
    } else if (sep.type !== 'NEWLINE') {
      restoreLex(P.L, save2)
    }
  }
  P.inBacktick--
  let close: TsNode
  if (peek(P.L) === '`') {
    const cStart = P.L.b
    advance(P.L)
    close = mk(P, '`', cStart, P.L.b, [])
  } else {
    close = mk(P, '`', P.L.b, P.L.b, [])
  }
  // Empty backticks (whitespace/newline only) are elided entirely by
  // tree-sitter — used as a line-continuation hack: "foo"`<newline>`"bar"
  // → (concatenation (string) (string)) with no command_substitution.
// 空反引号（只有空白/换行）被 tree-sitter 整体省略——这是个续行黑科技：foo 反引号换行反引号 bar 两串直接拼成 concatenation，不产生命令替换节点。
  if (body.length === 0) return null
  return mk(P, 'command_substitution', start, close.endIndex, [
    open,
    ...body,
    close,
  ])
}
// parseBacktick 收尾：闭引号缺失补零宽节点。

// parseIf：条件、then、体、若干 elif_clause/else_clause、fi。各段都用 parseStatements（可多条语句作条件）。
function parseIf(P: ParseState, ifTok: Token): TsNode {
  const ifKw = leaf(P, 'if', ifTok)
  const kids: TsNode[] = [ifKw]
  const cond = parseStatements(P, null)
  kids.push(...cond)
  consumeKeyword(P, 'then', kids)
  const body = parseStatements(P, null)
  kids.push(...body)
  while (true) {
    const save = saveLex(P.L)
    const t = nextToken(P.L, 'cmd')
    if (t.type === 'WORD' && t.value === 'elif') {
      const eKw = leaf(P, 'elif', t)
      const eCond = parseStatements(P, null)
      const eKids: TsNode[] = [eKw, ...eCond]
      consumeKeyword(P, 'then', eKids)
      const eBody = parseStatements(P, null)
      eKids.push(...eBody)
      const last = eKids[eKids.length - 1]!
      kids.push(mk(P, 'elif_clause', eKw.startIndex, last.endIndex, eKids))
    } else if (t.type === 'WORD' && t.value === 'else') {
      const elKw = leaf(P, 'else', t)
      const elBody = parseStatements(P, null)
      const last = elBody.length > 0 ? elBody[elBody.length - 1]! : elKw
      kids.push(
        mk(P, 'else_clause', elKw.startIndex, last.endIndex, [elKw, ...elBody]),
      )
    } else {
      restoreLex(P.L, save)
      break
    }
  }
  consumeKeyword(P, 'fi', kids)
  const last = kids[kids.length - 1]!
  return mk(P, 'if_statement', ifKw.startIndex, last.endIndex, kids)
}
// parseIf 收尾。

// parseWhile：while/until 共用——条件加 do_group。
function parseWhile(P: ParseState, kwTok: Token): TsNode {
  const kw = leaf(P, kwTok.value, kwTok)
  const kids: TsNode[] = [kw]
  const cond = parseStatements(P, null)
  kids.push(...cond)
  const dg = parseDoGroup(P)
  if (dg) kids.push(dg)
  const last = kids[kids.length - 1]!
  return mk(P, 'while_statement', kw.startIndex, last.endIndex, kids)
}
// parseWhile 收尾。

// parseFor：C 风格 for ((;;)) 与常规 for VAR in words 两种形态。select 也走这里（只走常规分支）。
function parseFor(P: ParseState, forTok: Token): TsNode {
  const forKw = leaf(P, forTok.value, forTok)
  skipBlanks(P.L)
  // C-style for (( ; ; )) — only for `for`, not `select`
// C 风格头部：三段（初始;条件;更新）全用 assign 模式——c = expr 发 variable_assignment，裸标识符（c<=5 的 c）发 word；逗号列表支持。
  if (forTok.value === 'for' && peek(P.L) === '(' && peek(P.L, 1) === '(') {
    const oStart = P.L.b
    advance(P.L)
    advance(P.L)
    const open = mk(P, '((', oStart, P.L.b, [])
    const kids: TsNode[] = [forKw, open]
    // init; cond; update — all three use 'assign' mode so `c = expr` emits
    // variable_assignment, while bare idents (c in `c<=5`) → word. Each
    // clause may be a comma-separated list.
    for (let k = 0; k < 3; k++) {
      skipBlanks(P.L)
      const es = parseArithCommaList(P, k < 2 ? ';' : '))', 'assign')
      kids.push(...es)
      if (k < 2) {
        if (peek(P.L) === ';') {
          const s = P.L.b
          advance(P.L)
          kids.push(mk(P, ';', s, P.L.b, []))
        }
      }
    }
    skipBlanks(P.L)
    if (peek(P.L) === ')' && peek(P.L, 1) === ')') {
      const cStart = P.L.b
      advance(P.L)
      advance(P.L)
      kids.push(mk(P, '))', cStart, P.L.b, []))
    }
    // Optional ; or newline
    const save = saveLex(P.L)
    const sep = nextToken(P.L, 'cmd')
    if (sep.type === 'OP' && sep.value === ';') {
      kids.push(leaf(P, ';', sep))
    } else if (sep.type !== 'NEWLINE') {
      restoreLex(P.L, save)
    }
    const dg = parseDoGroup(P)
    if (dg) {
      kids.push(dg)
    } else {
      // C-style for can also use `{ ... }` body instead of `do ... done`
      skipNewlines(P)
      skipBlanks(P.L)
      if (peek(P.L) === '{') {
        const bOpen = P.L.b
        advance(P.L)
        const brace = mk(P, '{', bOpen, P.L.b, [])
        const body = parseStatements(P, '}')
        let bClose: TsNode
        if (peek(P.L) === '}') {
          const cs = P.L.b
          advance(P.L)
          bClose = mk(P, '}', cs, P.L.b, [])
        } else {
          bClose = mk(P, '}', P.L.b, P.L.b, [])
        }
        kids.push(
          mk(P, 'compound_statement', brace.startIndex, bClose.endIndex, [
            brace,
            ...body,
            bClose,
          ]),
        )
      }
    }
    const last = kids[kids.length - 1]!
    return mk(P, 'c_style_for_statement', forKw.startIndex, last.endIndex, kids)
  }
  // Regular for VAR in words; do ... done
  const kids: TsNode[] = [forKw]
  const varTok = nextToken(P.L, 'arg')
  kids.push(mk(P, 'variable_name', varTok.start, varTok.end, []))
  skipBlanks(P.L)
  const save = saveLex(P.L)
  const inTok = nextToken(P.L, 'arg')
  if (inTok.type === 'WORD' && inTok.value === 'in') {
    kids.push(leaf(P, 'in', inTok))
    while (true) {
      skipBlanks(P.L)
      const c = peek(P.L)
      if (c === ';' || c === '\n' || c === '') break
      const w = parseWord(P, 'arg')
      if (!w) break
      kids.push(w)
    }
  } else {
    restoreLex(P.L, save)
  }
  // Separator
  const save2 = saveLex(P.L)
  const sep = nextToken(P.L, 'cmd')
  if (sep.type === 'OP' && sep.value === ';') {
    kids.push(leaf(P, ';', sep))
  } else if (sep.type !== 'NEWLINE') {
    restoreLex(P.L, save2)
  }
  const dg = parseDoGroup(P)
  if (dg) kids.push(dg)
  const last = kids[kids.length - 1]!
  return mk(P, 'for_statement', forKw.startIndex, last.endIndex, kids)
}
// parseFor 收尾：常规形态的 in 词表可被 ; 换行终止；C 风格的循环体也可以是 { ... } 花括号组而非 do...done。

// parseDoGroup：do ... done 组。
function parseDoGroup(P: ParseState): TsNode | null {
  skipNewlines(P)
  const save = saveLex(P.L)
  const doTok = nextToken(P.L, 'cmd')
  if (doTok.type !== 'WORD' || doTok.value !== 'do') {
    restoreLex(P.L, save)
    return null
  }
  const doKw = leaf(P, 'do', doTok)
  const body = parseStatements(P, null)
  const kids: TsNode[] = [doKw, ...body]
  consumeKeyword(P, 'done', kids)
  const last = kids[kids.length - 1]!
  return mk(P, 'do_group', doKw.startIndex, last.endIndex, kids)
}
// parseDoGroup 收尾。

// parseCase：case 词 in 多个 case_item esac。
function parseCase(P: ParseState, caseTok: Token): TsNode {
  const caseKw = leaf(P, 'case', caseTok)
  const kids: TsNode[] = [caseKw]
  skipBlanks(P.L)
  const word = parseWord(P, 'arg')
  if (word) kids.push(word)
  skipBlanks(P.L)
  consumeKeyword(P, 'in', kids)
  skipNewlines(P)
  while (true) {
    skipBlanks(P.L)
    skipNewlines(P)
    const save = saveLex(P.L)
    const t = nextToken(P.L, 'arg')
    if (t.type === 'WORD' && t.value === 'esac') {
      kids.push(leaf(P, 'esac', t))
      break
    }
    if (t.type === 'EOF') break
    restoreLex(P.L, save)
    const item = parseCaseItem(P)
    if (!item) break
    kids.push(item)
  }
  const last = kids[kids.length - 1]!
  return mk(P, 'case_statement', caseKw.startIndex, last.endIndex, kids)
}
// parseCase 收尾。

// parseCaseItem：单个分支——可选前置 (、模式列表（| 分隔）、)、体、;; ;& ;;& 终止符。
function parseCaseItem(P: ParseState): TsNode | null {
  skipBlanks(P.L)
  const start = P.L.b
  const kids: TsNode[] = []
  // Optional leading '(' before pattern — bash allows (pattern) syntax
  if (peek(P.L) === '(') {
    const s = P.L.b
    advance(P.L)
    kids.push(mk(P, '(', s, P.L.b, []))
  }
  // Pattern(s)
  let isFirstAlt = true
  while (true) {
    skipBlanks(P.L)
    const c = peek(P.L)
    if (c === ')' || c === '') break
    const pats = parseCasePattern(P)
    if (pats.length === 0) break
    // tree-sitter quirk: first alternative with quotes is inlined as flat
    // siblings; subsequent alternatives are wrapped in (concatenation) with
    // `word` instead of `extglob_pattern` for bare segments.
// tree-sitter 怪癖：首个带引号的候选平铺成兄弟节点；后续候选包 concatenation 且裸段用 word 而非 extglob_pattern。这里精确复刻。
    if (!isFirstAlt && pats.length > 1) {
      const rewritten = pats.map(p =>
        p.type === 'extglob_pattern'
          ? mk(P, 'word', p.startIndex, p.endIndex, [])
          : p,
      )
      const first = rewritten[0]!
      const last = rewritten[rewritten.length - 1]!
      kids.push(
        mk(P, 'concatenation', first.startIndex, last.endIndex, rewritten),
      )
    } else {
      kids.push(...pats)
    }
    isFirstAlt = false
    skipBlanks(P.L)
    // \<newline> line continuation between alternatives
    if (peek(P.L) === '\\' && peek(P.L, 1) === '\n') {
      advance(P.L)
      advance(P.L)
      skipBlanks(P.L)
    }
    if (peek(P.L) === '|') {
      const s = P.L.b
      advance(P.L)
      kids.push(mk(P, '|', s, P.L.b, []))
      // \<newline> after | is also a line continuation
      if (peek(P.L) === '\\' && peek(P.L, 1) === '\n') {
        advance(P.L)
        advance(P.L)
      }
    } else {
      break
    }
  }
  if (peek(P.L) === ')') {
    const s = P.L.b
    advance(P.L)
    kids.push(mk(P, ')', s, P.L.b, []))
  }
  const body = parseStatements(P, null)
  kids.push(...body)
  const save = saveLex(P.L)
  const term = nextToken(P.L, 'cmd')
  if (
    term.type === 'OP' &&
    (term.value === ';;' || term.value === ';&' || term.value === ';;&')
  ) {
    kids.push(leaf(P, term.value, term))
  } else {
    restoreLex(P.L, save)
  }
  if (kids.length === 0) return null
  // tree-sitter quirk: case_item with EMPTY body and a single pattern matching
  // extglob-operator-char-prefix (no actual glob metachars) downgrades to word.
  // `-o) owner=$2 ;;` (has body) → extglob_pattern; `-g) ;;` (empty) → word.
// 另一个怪癖：体为空且模式形如 extglob 操作符字符前缀（无真实 glob 元字符）时降级为 word——-o) owner=$2 ;;（有体）是 extglob_pattern，-g) ;;（空体）是 word。
  if (body.length === 0) {
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i]!
      if (k.type !== 'extglob_pattern') continue
      const text = sliceBytes(P, k.startIndex, k.endIndex)
      if (/^[-+?*@!][a-zA-Z]/.test(text) && !/[*?(]/.test(text)) {
        kids[i] = mk(P, 'word', k.startIndex, k.endIndex, [])
      }
    }
  }
  const last = kids[kids.length - 1]!
  return mk(P, 'case_item', start, last.endIndex, kids)
}
// parseCaseItem 收尾。

// parseCasePattern：单模式的预扫——括号深度计数（处理 extglob *(a|b) 与嵌套形状）、引号段跳过、$ 与 [ 标记。按特征分派：带引号走分段、带 $ 或 [（无 extglob 括号）走 parseWord 拼接、其余按是否含 glob 元字符或 extglob 前缀定 extglob_pattern/word。
function parseCasePattern(P: ParseState): TsNode[] {
  skipBlanks(P.L)
  const save = saveLex(P.L)
  const start = P.L.b
  const startI = P.L.i
  let parenDepth = 0
  let hasDollar = false
  let hasBracketOutsideParen = false
  let hasQuote = false
  while (P.L.i < P.L.len) {
    const c = peek(P.L)
    if (c === '\\' && P.L.i + 1 < P.L.len) {
      // Escaped char — consume both (handles `bar\ baz` as single pattern)
      // \<newline> is a line continuation; eat it but stay in pattern.
      advance(P.L)
      advance(P.L)
      continue
    }
    if (c === '"' || c === "'") {
      hasQuote = true
      // Skip past the quoted segment so its content (spaces, |, etc.) doesn't
      // break the peek-ahead scan.
      advance(P.L)
      while (P.L.i < P.L.len && peek(P.L) !== c) {
        if (peek(P.L) === '\\' && P.L.i + 1 < P.L.len) advance(P.L)
        advance(P.L)
      }
      if (peek(P.L) === c) advance(P.L)
      continue
    }
    // Paren counting: any ( inside pattern opens a scope; don't break at ) or |
    // until balanced. Handles extglob *(a|b) and nested shapes *([0-9])([0-9]).
    if (c === '(') {
      parenDepth++
      advance(P.L)
      continue
    }
    if (parenDepth > 0) {
      if (c === ')') {
        parenDepth--
        advance(P.L)
        continue
      }
      if (c === '\n') break
      advance(P.L)
      continue
    }
    if (c === ')' || c === '|' || c === ' ' || c === '\t' || c === '\n') break
    if (c === '$') hasDollar = true
    if (c === '[') hasBracketOutsideParen = true
    advance(P.L)
  }
  if (P.L.b === start) return []
  const text = P.src.slice(startI, P.L.i)
  const hasExtglobParen = /[*?+@!]\(/.test(text)
  // Quoted segments in pattern: tree-sitter splits at quote boundaries into
  // multiple sibling nodes. `*"foo"*` → (extglob_pattern)(string)(extglob_pattern).
  // Re-scan with a segmenting pass.
  if (hasQuote && !hasExtglobParen) {
    restoreLex(P.L, save)
    return parseCasePatternSegmented(P)
  }
  // tree-sitter splits patterns with [ or $ into concatenation via word parsing
  // UNLESS pattern has extglob parens (those override and emit extglob_pattern).
  // `*.[1357]` → concat(word word number word); `${PN}.pot` → concat(expansion word);
  // but `*([0-9])` → extglob_pattern (has extglob paren).
  if (!hasExtglobParen && (hasDollar || hasBracketOutsideParen)) {
    restoreLex(P.L, save)
    const w = parseWord(P, 'arg')
    return w ? [w] : []
  }
  // Patterns starting with extglob operator chars (+ - ? * @ !) followed by
  // identifier chars are extglob_pattern per tree-sitter, even without parens
  // or glob metachars. `-o)` → extglob_pattern; plain `foo)` → word.
  const type =
    hasExtglobParen || /[*?]/.test(text) || /^[-+?*@!][a-zA-Z]/.test(text)
      ? 'extglob_pattern'
      : 'word'
  return [mk(P, type, start, P.L.b, [])]
}
// parseCasePattern 收尾：模式起始为 extglob 操作符字符加标识符（如 -o）也算 extglob_pattern，普通 foo 是 word。

// Segmented scan for case patterns containing quotes: `*"foo"*` →
// [extglob_pattern, string, extglob_pattern]. Bare segments → extglob_pattern
// if they have */?, else word. Stops at ) | space tab newline outside quotes.
// parseCasePatternSegmented：含引号模式的分段扫描——* 引号 foo 引号 * 切成 extglob_pattern、string、extglob_pattern 三兄弟；裸段含 */? 是 extglob_pattern 否则 word。
function parseCasePatternSegmented(P: ParseState): TsNode[] {
  const parts: TsNode[] = []
  let segStart = P.L.b
  let segStartI = P.L.i
  const flushSeg = (): void => {
    if (P.L.i > segStartI) {
      const t = P.src.slice(segStartI, P.L.i)
      const type = /[*?]/.test(t) ? 'extglob_pattern' : 'word'
      parts.push(mk(P, type, segStart, P.L.b, []))
    }
  }
  while (P.L.i < P.L.len) {
    const c = peek(P.L)
    if (c === '\\' && P.L.i + 1 < P.L.len) {
      advance(P.L)
      advance(P.L)
      continue
    }
    if (c === '"') {
      flushSeg()
      parts.push(parseDoubleQuoted(P))
      segStart = P.L.b
      segStartI = P.L.i
      continue
    }
    if (c === "'") {
      flushSeg()
      const tok = nextToken(P.L, 'arg')
      parts.push(leaf(P, 'raw_string', tok))
      segStart = P.L.b
      segStartI = P.L.i
      continue
    }
    if (c === ')' || c === '|' || c === ' ' || c === '\t' || c === '\n') break
    advance(P.L)
  }
  flushSeg()
  return parts
}
// parseCasePatternSegmented 收尾。

// parseFunction：function name() { ... } 形式（function 关键字开头）。函数体的重定向同样提升到 function_definition 层。
function parseFunction(P: ParseState, fnTok: Token): TsNode {
  const fnKw = leaf(P, 'function', fnTok)
  skipBlanks(P.L)
  const nameTok = nextToken(P.L, 'arg')
  const name = mk(P, 'word', nameTok.start, nameTok.end, [])
  const kids: TsNode[] = [fnKw, name]
  skipBlanks(P.L)
  if (peek(P.L) === '(' && peek(P.L, 1) === ')') {
    const o = nextToken(P.L, 'cmd')
    const c = nextToken(P.L, 'cmd')
    kids.push(leaf(P, '(', o))
    kids.push(leaf(P, ')', c))
  }
  skipBlanks(P.L)
  skipNewlines(P)
  const body = parseCommand(P)
  if (body) {
    // Hoist redirects from redirected_statement(compound_statement, ...) to
    // function_definition level per tree-sitter grammar
    if (
      body.type === 'redirected_statement' &&
      body.children.length >= 2 &&
      body.children[0]!.type === 'compound_statement'
    ) {
      kids.push(...body.children)
    } else {
      kids.push(body)
    }
  }
  const last = kids[kids.length - 1]!
  return mk(P, 'function_definition', fnKw.startIndex, last.endIndex, kids)
}
// parseFunction 收尾。

// parseDeclaration：export/declare/typeset/readonly/local——后随赋值、引号串（export 加引号 FOO=bar）、标志（-a）或裸变量名。
function parseDeclaration(P: ParseState, kwTok: Token): TsNode {
  const kw = leaf(P, kwTok.value, kwTok)
  const kids: TsNode[] = [kw]
  while (true) {
    skipBlanks(P.L)
    const c = peek(P.L)
    if (
      c === '' ||
      c === '\n' ||
      c === ';' ||
      c === '&' ||
      c === '|' ||
      c === ')' ||
      c === '<' ||
      c === '>'
    ) {
      break
    }
    const a = tryParseAssignment(P)
    if (a) {
      kids.push(a)
      continue
    }
    // Quoted string or concatenation: `export "FOO=bar"`, `export 'X'`
    if (c === '"' || c === "'" || c === '$') {
      const w = parseWord(P, 'arg')
      if (w) {
        kids.push(w)
        continue
      }
      break
    }
    // Flag like -a or bare variable name
    const save = saveLex(P.L)
    const tok = nextToken(P.L, 'arg')
    if (tok.type === 'WORD' || tok.type === 'NUMBER') {
      if (tok.value.startsWith('-')) {
        kids.push(leaf(P, 'word', tok))
      } else if (isIdentStart(tok.value[0] ?? '')) {
        kids.push(mk(P, 'variable_name', tok.start, tok.end, []))
      } else {
        kids.push(leaf(P, 'word', tok))
      }
    } else {
      restoreLex(P.L, save)
      break
    }
  }
  const last = kids[kids.length - 1]!
  return mk(P, 'declaration_command', kw.startIndex, last.endIndex, kids)
}
// parseDeclaration 收尾。

// parseUnset：unset/unsetenv。
function parseUnset(P: ParseState, kwTok: Token): TsNode {
  const kw = leaf(P, 'unset', kwTok)
  const kids: TsNode[] = [kw]
  while (true) {
    skipBlanks(P.L)
    const c = peek(P.L)
    if (
      c === '' ||
      c === '\n' ||
      c === ';' ||
      c === '&' ||
      c === '|' ||
      c === ')' ||
      c === '<' ||
      c === '>'
    ) {
      break
    }
    // SECURITY: use parseWord (not raw nextToken) so quoted strings like
    // `unset 'a[$(id)]'` emit a raw_string child that ast.ts can reject.
    // Previously `break` silently dropped non-WORD args — hiding the
    // arithmetic-subscript code-exec vector from the security walker.
// 安全修复记录：必须用 parseWord 而非裸 nextToken——unset 加引号参数（unset 加引号 a[$(id)] ）要发 raw_string 子节点让 ast.ts 能拒绝。旧版直接 break 会静默丢弃非 WORD 参数，把算术下标代码执行向量藏起来躲过安全行走器。
    const arg = parseWord(P, 'arg')
    if (!arg) break
    if (arg.type === 'word') {
      if (arg.text.startsWith('-')) {
        kids.push(arg)
      } else {
        kids.push(mk(P, 'variable_name', arg.startIndex, arg.endIndex, []))
      }
    } else {
      kids.push(arg)
    }
  }
  const last = kids[kids.length - 1]!
  return mk(P, 'unset_command', kw.startIndex, last.endIndex, kids)
}
// parseUnset 收尾。

// consumeKeyword：吃一个期望的关键字（then/fi/done/esac），没有就回溯——缺失时节点照样成型（容错）。
function consumeKeyword(P: ParseState, name: string, kids: TsNode[]): void {
  skipNewlines(P)
  const save = saveLex(P.L)
  const t = nextToken(P.L, 'cmd')
  if (t.type === 'WORD' && t.value === name) {
    kids.push(leaf(P, name, t))
  } else {
    restoreLex(P.L, save)
  }
}
// consumeKeyword 收尾。

// ───────────────────── Test & Arithmetic Expressions ─────────────────────
// 分隔注释：test 与算术表达式部分开始。

function parseTestExpr(P: ParseState, closer: string): TsNode | null {
  return parseTestOr(P, closer)
}
// parseTestExpr：test 表达式入口 → 或级。

function parseTestOr(P: ParseState, closer: string): TsNode | null {
  let left = parseTestAnd(P, closer)
  if (!left) return null
  while (true) {
    skipBlanks(P.L)
    const save = saveLex(P.L)
    if (peek(P.L) === '|' && peek(P.L, 1) === '|') {
      const s = P.L.b
      advance(P.L)
      advance(P.L)
      const op = mk(P, '||', s, P.L.b, [])
      const right = parseTestAnd(P, closer)
      if (!right) {
        restoreLex(P.L, save)
        break
      }
      left = mk(P, 'binary_expression', left.startIndex, right.endIndex, [
        left,
        op,
        right,
      ])
    } else {
      break
    }
  }
  return left
}
// parseTestOr：|| 连接，左结合 binary_expression。

function parseTestAnd(P: ParseState, closer: string): TsNode | null {
  let left = parseTestUnary(P, closer)
  if (!left) return null
  while (true) {
    skipBlanks(P.L)
    if (peek(P.L) === '&' && peek(P.L, 1) === '&') {
      const s = P.L.b
      advance(P.L)
      advance(P.L)
      const op = mk(P, '&&', s, P.L.b, [])
      const right = parseTestUnary(P, closer)
      if (!right) break
      left = mk(P, 'binary_expression', left.startIndex, right.endIndex, [
        left,
        op,
        right,
      ])
    } else {
      break
    }
  }
  return left
}
// parseTestAnd：&& 连接。

function parseTestUnary(P: ParseState, closer: string): TsNode | null {
  skipBlanks(P.L)
  const c = peek(P.L)
  if (c === '(') {
    const s = P.L.b
    advance(P.L)
    const open = mk(P, '(', s, P.L.b, [])
    const inner = parseTestOr(P, closer)
    skipBlanks(P.L)
    let close: TsNode
    if (peek(P.L) === ')') {
      const cs = P.L.b
      advance(P.L)
      close = mk(P, ')', cs, P.L.b, [])
    } else {
      close = mk(P, ')', P.L.b, P.L.b, [])
    }
    const kids = inner ? [open, inner, close] : [open, close]
    return mk(
      P,
      'parenthesized_expression',
      open.startIndex,
      close.endIndex,
      kids,
    )
  }
  return parseTestBinary(P, closer)
}
// parseTestUnary：括号子表达式或回落二元解析。

/**
 * Parse `!`-negated or test-operator (`-f`) or parenthesized primary — but NOT
 * a binary comparison. Used as LHS of binary_expression so `! x =~ y` binds
 * `!` to `x` only, not the whole `x =~ y`.
 */
function parseTestNegatablePrimary(
  P: ParseState,
  closer: string,
): TsNode | null {
  skipBlanks(P.L)
  const c = peek(P.L)
  if (c === '!') {
    const s = P.L.b
    advance(P.L)
    const bang = mk(P, '!', s, P.L.b, [])
    const inner = parseTestNegatablePrimary(P, closer)
    if (!inner) return bang
    return mk(P, 'unary_expression', bang.startIndex, inner.endIndex, [
      bang,
      inner,
    ])
  }
  if (c === '-' && isIdentStart(peek(P.L, 1))) {
    const s = P.L.b
    advance(P.L)
    while (isIdentChar(peek(P.L))) advance(P.L)
    const op = mk(P, 'test_operator', s, P.L.b, [])
    skipBlanks(P.L)
    const arg = parseTestPrimary(P, closer)
    if (!arg) return op
    return mk(P, 'unary_expression', op.startIndex, arg.endIndex, [op, arg])
  }
  return parseTestPrimary(P, closer)
}
// parseTestNegatablePrimary：可取负的一元（! 或 -f 这类 test 操作符）——作为二元比较的 LHS 专用，保证 ! x =~ y 里 ! 只绑定 x 不绑定整个比较。

function parseTestBinary(P: ParseState, closer: string): TsNode | null {
  skipBlanks(P.L)
  // `!` in test context binds tighter than =~/==.
  // `[[ ! "x" =~ y ]]` → (binary_expression (unary_expression (string)) (regex))
  // `[[ ! -f x ]]` → (unary_expression ! (unary_expression (test_operator) (word)))
// test 上下文的 ! 绑定优先级高于 =~/==：[[ ! 加引号 x =~ y ]] 是二元（一元（string））（regex），[[ ! -f x ]] 是纯一元嵌套。
  const left = parseTestNegatablePrimary(P, closer)
  if (!left) return null
  skipBlanks(P.L)
  // Binary comparison: == != =~ -eq -lt etc.
  const c = peek(P.L)
  const c1 = peek(P.L, 1)
  let op: TsNode | null = null
  const os = P.L.b
  if (c === '=' && c1 === '=') {
    advance(P.L)
    advance(P.L)
    op = mk(P, '==', os, P.L.b, [])
  } else if (c === '!' && c1 === '=') {
    advance(P.L)
    advance(P.L)
    op = mk(P, '!=', os, P.L.b, [])
  } else if (c === '=' && c1 === '~') {
    advance(P.L)
    advance(P.L)
    op = mk(P, '=~', os, P.L.b, [])
  } else if (c === '=' && c1 !== '=') {
    advance(P.L)
    op = mk(P, '=', os, P.L.b, [])
  } else if (c === '<' && c1 !== '<') {
    advance(P.L)
    op = mk(P, '<', os, P.L.b, [])
  } else if (c === '>' && c1 !== '>') {
    advance(P.L)
    op = mk(P, '>', os, P.L.b, [])
  } else if (c === '-' && isIdentStart(c1)) {
    advance(P.L)
    while (isIdentChar(peek(P.L))) advance(P.L)
    op = mk(P, 'test_operator', os, P.L.b, [])
  }
  if (!op) return left
  skipBlanks(P.L)
  // In [[ ]], RHS of ==/!=/=/=~ gets special pattern parsing: paren counting
  // so @(a|b|c) doesn't break on |, and segments become extglob_pattern/regex.
// [[ ]] 内 ==/!=/=/=~ 的 RHS 有特殊模式解析：=~ 整体一个 regex（括号计数防 | 打断）；单 = 发 regex；== != 发 extglob_pattern 段序列。RHS 若整体是引号串则发 string/raw_string 而非 regex——引号后还有内容（如 正则尾缀）才保持整段 regex。
  if (closer === ']]') {
    const opText = op.type
    if (opText === '=~') {
      skipBlanks(P.L)
      // If the ENTIRE RHS is a quoted string, emit string/raw_string not
      // regex: `[[ "$x" =~ "$y" ]]` → (binary_expression (string) (string)).
      // If there's content after the quote (`' boop '(.*)$`), the whole RHS
      // stays a single (regex). Peek past the quote to check.
      const rc = peek(P.L)
      let rhs: TsNode | null = null
      if (rc === '"' || rc === "'") {
        const save = saveLex(P.L)
        const quoted =
          rc === '"'
            ? parseDoubleQuoted(P)
            : leaf(P, 'raw_string', nextToken(P.L, 'arg'))
        // Check if RHS ends here: only whitespace then ]] or &&/|| or newline
        let j = P.L.i
        while (j < P.L.len && (P.src[j] === ' ' || P.src[j] === '\t')) j++
        const nc = P.src[j] ?? ''
        const nc1 = P.src[j + 1] ?? ''
        if (
          (nc === ']' && nc1 === ']') ||
          (nc === '&' && nc1 === '&') ||
          (nc === '|' && nc1 === '|') ||
          nc === '\n' ||
          nc === ''
        ) {
          rhs = quoted
        } else {
          restoreLex(P.L, save)
        }
      }
      if (!rhs) rhs = parseTestRegexRhs(P)
      if (!rhs) return left
      return mk(P, 'binary_expression', left.startIndex, rhs.endIndex, [
        left,
        op,
        rhs,
      ])
    }
    // Single `=` emits (regex) per tree-sitter; `==` and `!=` emit extglob_pattern
// tree-sitter 细节：单 = 的 RHS 发 regex 节点，== 与 != 发 extglob_pattern——同是相等比较，节点类型不同。
    if (opText === '=') {
      const rhs = parseTestRegexRhs(P)
      if (!rhs) return left
      return mk(P, 'binary_expression', left.startIndex, rhs.endIndex, [
        left,
        op,
        rhs,
      ])
    }
    if (opText === '==' || opText === '!=') {
      const parts = parseTestExtglobRhs(P)
      if (parts.length === 0) return left
      const last = parts[parts.length - 1]!
      return mk(P, 'binary_expression', left.startIndex, last.endIndex, [
        left,
        op,
        ...parts,
      ])
    }
  }
  const right = parseTestPrimary(P, closer)
  if (!right) return left
  return mk(P, 'binary_expression', left.startIndex, right.endIndex, [
    left,
    op,
    right,
  ])
}
// parseTestBinary 收尾：非 [[ ]] 上下文（单 [）的 RHS 走普通 parseTestPrimary。

// RHS of =~ in [[ ]] — scan as single (regex) node with paren/bracket counting
// so | ( ) inside the regex don't break parsing. Stop at ]] or ws+&&/||.
function parseTestRegexRhs(P: ParseState): TsNode | null {
  skipBlanks(P.L)
  const start = P.L.b
  let parenDepth = 0
  let bracketDepth = 0
  while (P.L.i < P.L.len) {
    const c = peek(P.L)
    if (c === '\\' && P.L.i + 1 < P.L.len) {
      advance(P.L)
      advance(P.L)
      continue
    }
    if (c === '\n') break
    if (parenDepth === 0 && bracketDepth === 0) {
      if (c === ']' && peek(P.L, 1) === ']') break
      if (c === ' ' || c === '\t') {
        // Peek past blanks for ]] or &&/||
        let j = P.L.i
        while (j < P.L.len && (P.L.src[j] === ' ' || P.L.src[j] === '\t')) j++
        const nc = P.L.src[j] ?? ''
        const nc1 = P.L.src[j + 1] ?? ''
        if (
          (nc === ']' && nc1 === ']') ||
          (nc === '&' && nc1 === '&') ||
          (nc === '|' && nc1 === '|')
        ) {
          break
        }
        advance(P.L)
        continue
      }
    }
    if (c === '(') parenDepth++
    else if (c === ')' && parenDepth > 0) parenDepth--
    else if (c === '[') bracketDepth++
    else if (c === ']' && bracketDepth > 0) bracketDepth--
    advance(P.L)
  }
  if (P.L.b === start) return null
  return mk(P, 'regex', start, P.L.b, [])
}
// parseTestRegexRhs：=~ 的 RHS 扫成单个 regex——括号与方括号计数让 | ( ) 在正则里不破坏解析，停在 ]] 或空白加 &&/||。

// RHS of ==/!=/= in [[ ]] — returns array of parts. Bare text → extglob_pattern
// (with paren counting for @(a|b)); $(...)/${}/quoted → proper node types.
// Multiple parts become flat children of binary_expression per tree-sitter.
// parseTestExtglobRhs 说明（接上文注释）：RHS 返回片段数组；裸文本是 extglob_pattern（括号计数支撑 @(a|b)）；$(...) ${...} 引号段发正常节点类型；多片段平铺为 binary_expression 的直接子节点。纯数字段保持 number。
function parseTestExtglobRhs(P: ParseState): TsNode[] {
  skipBlanks(P.L)
  const parts: TsNode[] = []
  let segStart = P.L.b
  let segStartI = P.L.i
  let parenDepth = 0
  const flushSeg = () => {
    if (P.L.i > segStartI) {
      const text = P.src.slice(segStartI, P.L.i)
      // Pure number stays number; everything else is extglob_pattern
      const type = /^\d+$/.test(text) ? 'number' : 'extglob_pattern'
      parts.push(mk(P, type, segStart, P.L.b, []))
    }
  }
  while (P.L.i < P.L.len) {
    const c = peek(P.L)
    if (c === '\\' && P.L.i + 1 < P.L.len) {
      advance(P.L)
      advance(P.L)
      continue
    }
    if (c === '\n') break
    if (parenDepth === 0) {
      if (c === ']' && peek(P.L, 1) === ']') break
      if (c === ' ' || c === '\t') {
        let j = P.L.i
        while (j < P.L.len && (P.L.src[j] === ' ' || P.L.src[j] === '\t')) j++
        const nc = P.L.src[j] ?? ''
        const nc1 = P.L.src[j + 1] ?? ''
        if (
          (nc === ']' && nc1 === ']') ||
          (nc === '&' && nc1 === '&') ||
          (nc === '|' && nc1 === '|')
        ) {
          break
        }
        advance(P.L)
        continue
      }
    }
    // $ " ' must be parsed even inside @( ) extglob parens — parseDollarLike
    // consumes matching ) so parenDepth stays consistent.
    if (c === '$') {
      const c1 = peek(P.L, 1)
      if (
        c1 === '(' ||
        c1 === '{' ||
        isIdentStart(c1) ||
        SPECIAL_VARS.has(c1)
      ) {
        flushSeg()
        const exp = parseDollarLike(P)
        if (exp) parts.push(exp)
        segStart = P.L.b
        segStartI = P.L.i
        continue
      }
    }
    if (c === '"') {
      flushSeg()
      parts.push(parseDoubleQuoted(P))
      segStart = P.L.b
      segStartI = P.L.i
      continue
    }
    if (c === "'") {
      flushSeg()
      const tok = nextToken(P.L, 'arg')
      parts.push(leaf(P, 'raw_string', tok))
      segStart = P.L.b
      segStartI = P.L.i
      continue
    }
    if (c === '(') parenDepth++
    else if (c === ')' && parenDepth > 0) parenDepth--
    advance(P.L)
  }
  flushSeg()
  return parts
}
// parseTestExtglobRhs 收尾：extglob 括号内部的 $ 引号也要正常解析——parseDollarLike 会消费配对的 )，parenDepth 始终一致。

function parseTestPrimary(P: ParseState, closer: string): TsNode | null {
  skipBlanks(P.L)
  // Stop at closer
  if (closer === ']' && peek(P.L) === ']') return null
  if (closer === ']]' && peek(P.L) === ']' && peek(P.L, 1) === ']') return null
  return parseWord(P, 'arg')
}
// parseTestPrimary：test 主元就是一个词（到闭合符为止）。

/**
 * Arithmetic context modes:
 * - 'var': bare identifiers → variable_name (default, used in $((..)), ((..)))
 * - 'word': bare identifiers → word (c-style for head condition/update clauses)
 * - 'assign': identifiers with = → variable_assignment (c-style for init clause)
 */
type ArithMode = 'var' | 'word' | 'assign'
// ArithMode 三种算术上下文：var（裸标识符是 variable_name，$((..)) 与 ((..)) 用）、word（c 风格 for 的条件/更新段）、assign（带 = 的标识符发 variable_assignment，c 风格 for 的初始段）。

/** Operator precedence table (higher = tighter binding). */
const ARITH_PREC: Record<string, number> = {
  '=': 2,
  '+=': 2,
  '-=': 2,
  '*=': 2,
  '/=': 2,
  '%=': 2,
  '<<=': 2,
  '>>=': 2,
  '&=': 2,
  '^=': 2,
  '|=': 2,
  '||': 4,
  '&&': 5,
  '|': 6,
  '^': 7,
  '&': 8,
  '==': 9,
  '!=': 9,
  '<': 10,
  '>': 10,
  '<=': 10,
  '>=': 10,
  '<<': 11,
  '>>': 11,
  '+': 12,
  '-': 12,
  '*': 13,
  '/': 13,
  '%': 13,
  '**': 14,
}
// ARITH_PREC：运算符优先级表——赋值系最低（2）、** 最高（14），与 bash 语义一致。

/** Right-associative operators (assignment and exponent). */
const ARITH_RIGHT_ASSOC = new Set([
  '=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '<<=',
  '>>=',
  '&=',
  '^=',
  '|=',
  '**',
])
// ARITH_RIGHT_ASSOC：右结合运算符（赋值系与幂运算 **）——a = b = c 右嵌套。

function parseArithExpr(
  P: ParseState,
  stop: string,
  mode: ArithMode = 'var',
): TsNode | null {
  return parseArithTernary(P, stop, mode)
}
// parseArithExpr：入口 → 三元级。

/** Top-level: comma-separated list. arithmetic_expansion emits multiple children. */
function parseArithCommaList(
  P: ParseState,
  stop: string,
  mode: ArithMode = 'var',
): TsNode[] {
  const out: TsNode[] = []
  while (true) {
    const e = parseArithTernary(P, stop, mode)
    if (e) out.push(e)
    skipBlanks(P.L)
    if (peek(P.L) === ',' && !isArithStop(P, stop)) {
      advance(P.L)
      continue
    }
    break
  }
  return out
}
// parseArithCommaList：逗号分隔的表达式列表——arithmetic_expansion 与 C 风格 for 头部用。

function parseArithTernary(
  P: ParseState,
  stop: string,
  mode: ArithMode,
): TsNode | null {
  const cond = parseArithBinary(P, stop, 0, mode)
  if (!cond) return null
  skipBlanks(P.L)
  if (peek(P.L) === '?') {
    const qs = P.L.b
    advance(P.L)
    const q = mk(P, '?', qs, P.L.b, [])
    const t = parseArithBinary(P, ':', 0, mode)
    skipBlanks(P.L)
    let colon: TsNode
    if (peek(P.L) === ':') {
      const cs = P.L.b
      advance(P.L)
      colon = mk(P, ':', cs, P.L.b, [])
    } else {
      colon = mk(P, ':', P.L.b, P.L.b, [])
    }
    const f = parseArithTernary(P, stop, mode)
    const last = f ?? colon
    const kids: TsNode[] = [cond, q]
    if (t) kids.push(t)
    kids.push(colon)
    if (f) kids.push(f)
    return mk(P, 'ternary_expression', cond.startIndex, last.endIndex, kids)
  }
  return cond
}
// parseArithTernary：a ? b : c，右递归（else 分支可再嵌三元）。

/** Scan next arithmetic binary operator; returns [text, length] or null. */
function scanArithOp(P: ParseState): [string, number] | null {
  const c = peek(P.L)
  const c1 = peek(P.L, 1)
  const c2 = peek(P.L, 2)
  // 3-char: <<= >>=
  if (c === '<' && c1 === '<' && c2 === '=') return ['<<=', 3]
  if (c === '>' && c1 === '>' && c2 === '=') return ['>>=', 3]
  // 2-char
  if (c === '*' && c1 === '*') return ['**', 2]
  if (c === '<' && c1 === '<') return ['<<', 2]
  if (c === '>' && c1 === '>') return ['>>', 2]
  if (c === '=' && c1 === '=') return ['==', 2]
  if (c === '!' && c1 === '=') return ['!=', 2]
  if (c === '<' && c1 === '=') return ['<=', 2]
  if (c === '>' && c1 === '=') return ['>=', 2]
  if (c === '&' && c1 === '&') return ['&&', 2]
  if (c === '|' && c1 === '|') return ['||', 2]
  if (c === '+' && c1 === '=') return ['+=', 2]
  if (c === '-' && c1 === '=') return ['-=', 2]
  if (c === '*' && c1 === '=') return ['*=', 2]
  if (c === '/' && c1 === '=') return ['/=', 2]
  if (c === '%' && c1 === '=') return ['%=', 2]
  if (c === '&' && c1 === '=') return ['&=', 2]
  if (c === '^' && c1 === '=') return ['^=', 2]
  if (c === '|' && c1 === '=') return ['|=', 2]
  // 1-char — but NOT ++ -- (those are pre/postfix)
  if (c === '+' && c1 !== '+') return ['+', 1]
  if (c === '-' && c1 !== '-') return ['-', 1]
  if (c === '*') return ['*', 1]
  if (c === '/') return ['/', 1]
  if (c === '%') return ['%', 1]
  if (c === '<') return ['<', 1]
  if (c === '>') return ['>', 1]
  if (c === '&') return ['&', 1]
  if (c === '|') return ['|', 1]
  if (c === '^') return ['^', 1]
  if (c === '=') return ['=', 1]
  return null
}
// scanArithOp：算术操作符扫描——三字符（<<= >>=）、两字符、单字符依次尝试；++ 与 -- 不算二元操作符（它们是一元前/后缀）。

/** Precedence-climbing binary expression parser. */
function parseArithBinary(
  P: ParseState,
  stop: string,
  minPrec: number,
  mode: ArithMode,
): TsNode | null {
  let left = parseArithUnary(P, stop, mode)
  if (!left) return null
  while (true) {
    skipBlanks(P.L)
    if (isArithStop(P, stop)) break
    if (peek(P.L) === ',') break
    const opInfo = scanArithOp(P)
    if (!opInfo) break
    const [opText, opLen] = opInfo
    const prec = ARITH_PREC[opText]
    if (prec === undefined || prec < minPrec) break
    const os = P.L.b
    for (let k = 0; k < opLen; k++) advance(P.L)
    const op = mk(P, opText, os, P.L.b, [])
    const nextMin = ARITH_RIGHT_ASSOC.has(opText) ? prec : prec + 1
    const right = parseArithBinary(P, stop, nextMin, mode)
    if (!right) break
    left = mk(P, 'binary_expression', left.startIndex, right.endIndex, [
      left,
      op,
      right,
    ])
  }
  return left
}
// parseArithBinary：优先级爬升法（precedence climbing）——minPrec 之下的操作符停；右结合运算符的下一层 minPrec 不加一。

function parseArithUnary(
  P: ParseState,
  stop: string,
  mode: ArithMode,
): TsNode | null {
  skipBlanks(P.L)
  if (isArithStop(P, stop)) return null
  const c = peek(P.L)
  const c1 = peek(P.L, 1)
  // Prefix ++ --
  if ((c === '+' && c1 === '+') || (c === '-' && c1 === '-')) {
    const s = P.L.b
    advance(P.L)
    advance(P.L)
    const op = mk(P, c + c1, s, P.L.b, [])
    const inner = parseArithUnary(P, stop, mode)
    if (!inner) return op
    return mk(P, 'unary_expression', op.startIndex, inner.endIndex, [op, inner])
  }
  if (c === '-' || c === '+' || c === '!' || c === '~') {
    // In 'word'/'assign' mode (c-style for head), `-N` is a single number
    // literal per tree-sitter, not unary_expression. 'var' mode uses unary.
// 负数字面量的模式差：word/assign 模式（c 风格 for 头）里 -N 是单个 number 节点，var 模式走一元表达式——对齐 tree-sitter 两种上下文的不同形状。
    if (mode !== 'var' && c === '-' && isDigit(c1)) {
      const s = P.L.b
      advance(P.L)
      while (isDigit(peek(P.L))) advance(P.L)
      return mk(P, 'number', s, P.L.b, [])
    }
    const s = P.L.b
    advance(P.L)
    const op = mk(P, c, s, P.L.b, [])
    const inner = parseArithUnary(P, stop, mode)
    if (!inner) return op
    return mk(P, 'unary_expression', op.startIndex, inner.endIndex, [op, inner])
  }
  return parseArithPostfix(P, stop, mode)
}
// parseArithUnary 收尾：前缀 ++ -- 与 - + ! ~。

function parseArithPostfix(
  P: ParseState,
  stop: string,
  mode: ArithMode,
): TsNode | null {
  const prim = parseArithPrimary(P, stop, mode)
  if (!prim) return null
  const c = peek(P.L)
  const c1 = peek(P.L, 1)
  if ((c === '+' && c1 === '+') || (c === '-' && c1 === '-')) {
    const s = P.L.b
    advance(P.L)
    advance(P.L)
    const op = mk(P, c + c1, s, P.L.b, [])
    return mk(P, 'postfix_expression', prim.startIndex, op.endIndex, [prim, op])
  }
  return prim
}
// parseArithPostfix：后缀 ++ -- 包 postfix_expression。

function parseArithPrimary(
  P: ParseState,
  stop: string,
  mode: ArithMode,
): TsNode | null {
  skipBlanks(P.L)
  if (isArithStop(P, stop)) return null
  const c = peek(P.L)
  if (c === '(') {
    const s = P.L.b
    advance(P.L)
    const open = mk(P, '(', s, P.L.b, [])
    // Parenthesized expression may contain comma-separated exprs
    const inners = parseArithCommaList(P, ')', mode)
    skipBlanks(P.L)
    let close: TsNode
    if (peek(P.L) === ')') {
      const cs = P.L.b
      advance(P.L)
      close = mk(P, ')', cs, P.L.b, [])
    } else {
      close = mk(P, ')', P.L.b, P.L.b, [])
    }
    return mk(P, 'parenthesized_expression', open.startIndex, close.endIndex, [
      open,
      ...inners,
      close,
    ])
  }
  if (c === '"') {
    return parseDoubleQuoted(P)
  }
  if (c === '$') {
    return parseDollarLike(P)
  }
  if (isDigit(c)) {
    const s = P.L.b
    while (isDigit(peek(P.L))) advance(P.L)
    // Hex: 0x1f
    if (
      P.L.b - s === 1 &&
      c === '0' &&
      (peek(P.L) === 'x' || peek(P.L) === 'X')
    ) {
      advance(P.L)
      while (isHexDigit(peek(P.L))) advance(P.L)
    }
    // Base notation: BASE#DIGITS e.g. 2#1010, 16#ff
    else if (peek(P.L) === '#') {
      advance(P.L)
      while (isBaseDigit(peek(P.L))) advance(P.L)
    }
    return mk(P, 'number', s, P.L.b, [])
  }
  if (isIdentStart(c)) {
    const s = P.L.b
    while (isIdentChar(peek(P.L))) advance(P.L)
    const nc = peek(P.L)
    // Assignment in 'assign' mode (c-style for init): emit variable_assignment
    // so chained `a = b = c = 1` nests correctly. Other modes treat `=` as a
    // binary_expression operator via the precedence table.
// assign 模式的 =：发 variable_assignment 使 a = b = c = 1 正确右嵌套；其他模式把 = 当二元操作符走优先级表。
    if (mode === 'assign') {
      skipBlanks(P.L)
      const ac = peek(P.L)
      const ac1 = peek(P.L, 1)
      if (ac === '=' && ac1 !== '=') {
        const vn = mk(P, 'variable_name', s, P.L.b, [])
        const es = P.L.b
        advance(P.L)
        const eq = mk(P, '=', es, P.L.b, [])
        // RHS may itself be another assignment (chained)
        const val = parseArithTernary(P, stop, mode)
        const end = val ? val.endIndex : eq.endIndex
        const kids = val ? [vn, eq, val] : [vn, eq]
        return mk(P, 'variable_assignment', s, end, kids)
      }
    }
    // Subscript
    if (nc === '[') {
      const vn = mk(P, 'variable_name', s, P.L.b, [])
      const brS = P.L.b
      advance(P.L)
      const brOpen = mk(P, '[', brS, P.L.b, [])
      const idx = parseArithTernary(P, ']', 'var') ?? parseDollarLike(P)
      skipBlanks(P.L)
      let brClose: TsNode
      if (peek(P.L) === ']') {
        const cs = P.L.b
        advance(P.L)
        brClose = mk(P, ']', cs, P.L.b, [])
      } else {
        brClose = mk(P, ']', P.L.b, P.L.b, [])
      }
      const kids = idx ? [vn, brOpen, idx, brClose] : [vn, brOpen, brClose]
      return mk(P, 'subscript', s, brClose.endIndex, kids)
    }
    // Bare identifier: variable_name in 'var' mode, word in 'word'/'assign' mode.
    // 'assign' mode falls through to word when no `=` follows (c-style for
    // cond/update clauses: `c<=5` → binary_expression(word, number)).
// 下标 [idx]：下标按算术解析（失败再试 $ 展开）。裸标识符的定型：var 模式是 variable_name，word/assign 模式是 word（c 风格 for 的 c<=5 → binary_expression(word, number)）。
    const identType = mode === 'var' ? 'variable_name' : 'word'
    return mk(P, identType, s, P.L.b, [])
  }
  return null
}
// parseArithPrimary 收尾：数字支持 0x 十六进制与 BASE#DIGITS 进制记法；双引号串与 $ 展开也可是算术主元。

function isArithStop(P: ParseState, stop: string): boolean {
  const c = peek(P.L)
  if (stop === '))') return c === ')' && peek(P.L, 1) === ')'
  if (stop === ')') return c === ')'
  if (stop === ';') return c === ';'
  if (stop === ':') return c === ':'
  if (stop === ']') return c === ']'
  if (stop === '}') return c === '}'
  if (stop === ':}') return c === ':' || c === '}'
  return c === '' || c === '\n'
}
// isArithStop：按上下文的算术终止符（)) ) ; : ] } 或 :} 组合、EOF/换行）。文件到此结束。
