/**
 * Pure TypeScript port of vendor/color-diff-src.
 *
 * The Rust version uses syntect+bat for syntax highlighting and the similar
 * crate for word diffing. This port uses highlight.js (already a dep via
 * cli-highlight) and the diff npm package's diffArrays.
 *
 * API matches vendor/color-diff-src/index.d.ts exactly so callers don't change.
 *
 * Key semantic differences from the native module:
 * - Syntax highlighting uses highlight.js. Scope colors were measured from
 *   syntect's output so most tokens match, but hljs's grammar has gaps:
 *   plain identifiers and operators like `=` `:` aren't scoped, so they
 *   render in default fg instead of white/pink. Output structure (line
 *   numbers, markers, backgrounds, word-diff) is identical.
 * - BAT_THEME env support is a stub: highlight.js has no bat theme set, so
 *   getSyntaxTheme always returns the default for the given Claude theme.
 */
// 纯 TypeScript 移植自 vendor/color-diff-src。原 Rust 版用 syntect+bat 做语法高亮、用类似 crate 做词 diff；本移植改用 highlight.js（cli-highlight 已有的依赖）和 diff 包的 diffArrays。对外 API 与 vendor/color-diff-src/index.d.ts 完全一致，调用方无需改动。

import { diffArrays } from 'diff'
// 从 diff 包引入 diffArrays，用于词级 diff 比对。
import type * as hljsNamespace from 'highlight.js'
import { basename, extname } from 'path'

// Lazy: defers loading highlight.js until first render. The full bundle
// registers 190+ language grammars at require time (~50MB, 100-200ms on
// macOS, several× that on Windows). With a top-level import, any caller
// chunk that reaches this module — including test/preload.ts via
// StructuredDiff.tsx → colorDiff.ts — pays that cost at module-eval time
// and carries the heap for the rest of the process. On Windows CI this
// pushed later tests in the same shard into GC-pause territory and a
// beforeEach/afterEach hook timeout (officialRegistry.test.ts, PR #24150).
// Same lazy pattern the NAPI wrapper used for dlopen.
// 懒加载：把 highlight.js 的加载推迟到首次渲染。完整包在 require 时注册 190+ 语言语法（约 50MB，macOS 上 100–200ms，Windows 上数倍），若顶层 import 会让任何触达本模块的调用方（含测试/preload.ts 经 StructuredDiff.tsx → colorDiff.ts）都在模块求值期付出代价。Windows CI 上这曾把同分片的后继测试推入 GC 停顿并触发钩子超时。
type HLJSApi = typeof hljsNamespace
let cachedHljs: HLJSApi | null = null
// cachedHljs 缓存 hljs 实例；hljs() 首次调用才 require，并按运行时判断 bun/ESM（包在 .default 里）与 node CJS（模块本身就是 API）的 interop 差异。
function hljs(): HLJSApi {
  if (cachedHljs) return cachedHljs
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('highlight.js')
  // highlight.js uses `export =` (CJS). Under bun/ESM the interop wraps it
  // in .default; under node CJS the module IS the API. Check at runtime.
  cachedHljs = 'default' in mod && mod.default ? mod.default : mod
  return cachedHljs!
}

import { stringWidth } from '../../ink/stringWidth.js'
import { logError } from '../../utils/log.js'

// ---------------------------------------------------------------------------
// Public API types (match vendor/color-diff-src/index.d.ts)
// ---------------------------------------------------------------------------

export type Hunk = {
// Hunk：单块 diff 的数据结构（git diff 的 hunk），含旧/新起止行与各行文本。
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

export type SyntaxTheme = {
// SyntaxTheme：语法主题名与来源。
  theme: string
  source: string | null
}

export type NativeModule = {
// NativeModule：原生模块导出形状（ColorDiff / ColorFile / getSyntaxTheme），与 vendor 保持一致。
  ColorDiff: typeof ColorDiff
  ColorFile: typeof ColorFile
  getSyntaxTheme: (themeName: string) => SyntaxTheme
}

// ---------------------------------------------------------------------------
// Color / ANSI escape helpers
// ---------------------------------------------------------------------------

type Color = { r: number; g: number; b: number; a: number }
// 颜色与样式原语：Color 含 rgba、Style 含前景/背景、Block 是 [Style, string]、ColorMode 三档色模式。
type Style = { foreground: Color; background: Color }
type Block = [Style, string]
type ColorMode = 'truecolor' | 'color256' | 'ansi'
// ColorMode：truecolor（24bit）/ color256（xterm-256）/ ansi 三档。

const RESET = '\x1b[0m'
// ANSI 转义序列常量：RESET 复位、DIM 变暗、UNDIM 取消变暗。
const DIM = '\x1b[2m'
const UNDIM = '\x1b[22m'

function rgb(r: number, g: number, b: number): Color {
// rgb 构造不透明颜色（a=255）。
  return { r, g, b, a: 255 }
}

function ansiIdx(index: number): Color {
// ansiIdx 构造调色板索引色：把索引编进 .r，a=0 表示「用调色板索引」。
  return { r: index, g: 0, b: 0, a: 0 }
}

// Sentinel: a=1 means "terminal default" (matches bat convention)
const DEFAULT_BG: Color = { r: 0, g: 0, b: 0, a: 1 }
// DEFAULT_BG：a=1 表示「终端默认背景」，沿用 bat 约定。

function detectColorMode(theme: string): ColorMode {
// detectColorMode：从主题名与环境变量 COLORTERM 判定色模式（ansi / truecolor / 24bit / 否则 color256）。
  if (theme.includes('ansi')) return 'ansi'
  const ct = process.env.COLORTERM ?? ''
  return ct === 'truecolor' || ct === '24bit' ? 'truecolor' : 'color256'
}

// Port of ansi_colours::ansi256_from_rgb — approximates RGB to the xterm-256
// palette (6x6x6 cube + 24 greys). Picks the perceptually closest index by
// comparing cube vs grey-ramp candidates, like the Rust crate.
// ansi256FromRgb：移植 ansi_colours 的 ansi256_from_rgb，把 RGB 近似到 xterm-256 调色板（6x6x6 立方体 + 24 级灰阶），用「立方角候选 vs 灰阶候选」取感知最近的索引。
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255]
function ansi256FromRgb(r: number, g: number, b: number): number {
  const q = (c: number) =>
    c < 48 ? 0 : c < 115 ? 1 : c < 155 ? 2 : c < 195 ? 3 : c < 235 ? 4 : 5
  const qr = q(r)
  const qg = q(g)
  const qb = q(b)
  const cubeIdx = 16 + 36 * qr + 6 * qg + qb
  // Grey ramp candidate (232-255, levels 8..238 step 10). Beyond the ramp's
  // range the cube corner is the only option — ansi_colours snaps 248,248,242
  // to 231 (cube white), not 255 (ramp top).
  const grey = Math.round((r + g + b) / 3)
  if (grey < 5) return 16
  if (grey > 244 && qr === qg && qg === qb) return cubeIdx
  const greyLevel = Math.max(0, Math.min(23, Math.round((grey - 8) / 10)))
  const greyIdx = 232 + greyLevel
  const greyRgb = 8 + greyLevel * 10
  const cr = CUBE_LEVELS[qr]!
  const cg = CUBE_LEVELS[qg]!
  const cb = CUBE_LEVELS[qb]!
  const dCube = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
  const dGrey = (r - greyRgb) ** 2 + (g - greyRgb) ** 2 + (b - greyRgb) ** 2
  return dGrey < dCube ? greyIdx : cubeIdx
}

function colorToEscape(c: Color, fg: boolean, mode: ColorMode): string {
// colorToEscape：把 Color 转成 ANSI 转义码；a=0 走调色板索引、a=1 走终端默认、否则按 truecolor 或 256 色输出。
  // alpha=0: palette index encoded in .r (bat's ansi-theme convention)
  if (c.a === 0) {
    const idx = c.r
    if (idx < 8) return `\x1b[${(fg ? 30 : 40) + idx}m`
    if (idx < 16) return `\x1b[${(fg ? 90 : 100) + (idx - 8)}m`
    return `\x1b[${fg ? 38 : 48};5;${idx}m`
  }
  // alpha=1: terminal default
  if (c.a === 1) return fg ? '\x1b[39m' : '\x1b[49m'

  const codeType = fg ? 38 : 48
  if (mode === 'truecolor') {
    return `\x1b[${codeType};2;${c.r};${c.g};${c.b}m`
  }
  return `\x1b[${codeType};5;${ansi256FromRgb(c.r, c.g, c.b)}m`
}

function asTerminalEscaped(
// asTerminalEscaped：把 Block 序列拼成最终的终端转义字符串（可选背景、可选变暗，结尾复位）。
  blocks: readonly Block[],
  mode: ColorMode,
  skipBackground: boolean,
  dim: boolean,
): string {
  let out = dim ? RESET + DIM : RESET
  for (const [style, text] of blocks) {
    out += colorToEscape(style.foreground, true, mode)
    if (!skipBackground) {
      out += colorToEscape(style.background, false, mode)
    }
    out += text
  }
  return out + RESET
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

type Marker = '+' | '-' | ' '
// Marker：行标记三态——加号 / 减号 / 空格（上下文）。

type Theme = {
// Theme：主题配色——增删行的行/词/装饰色、前景/背景、以及 scope→颜色 的映射表。
  addLine: Color
  addWord: Color
  addDecoration: Color
  deleteLine: Color
  deleteWord: Color
  deleteDecoration: Color
  foreground: Color
  background: Color
  scopes: Record<string, Color>
}

function defaultSyntaxThemeName(themeName: string): string {
// defaultSyntaxThemeName：按主题名选默认 hljs 主题（ansi→ansi、dark→Monokai Extended、否则 GitHub）。
  if (themeName.includes('ansi')) return 'ansi'
  if (themeName.includes('dark')) return 'Monokai Extended'
  return 'GitHub'
}

// highlight.js scope → syntect Monokai Extended foreground (measured from the
// Rust module's output so colors match the original exactly)
const MONOKAI_SCOPES: Record<string, Color> = {
// MONOKAI_SCOPES：hljs 的 scope → syntect Monokai Extended 前景色（颜色从 Rust 模块输出测出，保证与原版一致）。
  keyword: rgb(249, 38, 114),
  _storage: rgb(102, 217, 239),
  built_in: rgb(166, 226, 46),
  type: rgb(166, 226, 46),
  literal: rgb(190, 132, 255),
  number: rgb(190, 132, 255),
  string: rgb(230, 219, 116),
  title: rgb(166, 226, 46),
  'title.function': rgb(166, 226, 46),
  'title.class': rgb(166, 226, 46),
  'title.class.inherited': rgb(166, 226, 46),
  params: rgb(253, 151, 31),
  comment: rgb(117, 113, 94),
  meta: rgb(117, 113, 94),
  attr: rgb(166, 226, 46),
  attribute: rgb(166, 226, 46),
  variable: rgb(255, 255, 255),
  'variable.language': rgb(255, 255, 255),
  property: rgb(255, 255, 255),
  operator: rgb(249, 38, 114),
  punctuation: rgb(248, 248, 242),
  symbol: rgb(190, 132, 255),
  regexp: rgb(230, 219, 116),
  subst: rgb(248, 248, 242),
}

// highlight.js scope → syntect GitHub-light foreground (measured from Rust)
const GITHUB_SCOPES: Record<string, Color> = {
// GITHUB_SCOPES：hljs 的 scope → syntect GitHub-light 前景色（同样从 Rust 测量）。
  keyword: rgb(167, 29, 93),
  _storage: rgb(167, 29, 93),
  built_in: rgb(0, 134, 179),
  type: rgb(0, 134, 179),
  literal: rgb(0, 134, 179),
  number: rgb(0, 134, 179),
  string: rgb(24, 54, 145),
  title: rgb(121, 93, 163),
  'title.function': rgb(121, 93, 163),
  'title.class': rgb(0, 0, 0),
  'title.class.inherited': rgb(0, 0, 0),
  params: rgb(0, 134, 179),
  comment: rgb(150, 152, 150),
  meta: rgb(150, 152, 150),
  attr: rgb(0, 134, 179),
  attribute: rgb(0, 134, 179),
  variable: rgb(0, 134, 179),
  'variable.language': rgb(0, 134, 179),
  property: rgb(0, 134, 179),
  operator: rgb(167, 29, 93),
  punctuation: rgb(51, 51, 51),
  symbol: rgb(0, 134, 179),
  regexp: rgb(24, 54, 145),
  subst: rgb(51, 51, 51),
}

// Keywords that syntect scopes as storage.type rather than keyword.control.
// highlight.js lumps these under "keyword"; we re-split so const/function/etc.
// get the cyan storage color instead of pink.
const STORAGE_KEYWORDS = new Set([
// STORAGE_KEYWORDS：syntect 把 const/function/class 等归到 storage.type 而非 keyword.control，而 hljs 全归 keyword。这里单独列出来，让这些词拿到青色的 storage 色而不是粉色。
  'const',
  'let',
  'var',
  'function',
  'class',
  'type',
  'interface',
  'enum',
  'namespace',
  'module',
  'def',
  'fn',
  'func',
  'struct',
  'trait',
  'impl',
])

const ANSI_SCOPES: Record<string, Color> = {
// ANSI_SCOPES：ANSI 模式下各 scope 对应的调色板索引色。
  keyword: ansiIdx(13),
  _storage: ansiIdx(14),
  built_in: ansiIdx(14),
  type: ansiIdx(14),
  literal: ansiIdx(12),
  number: ansiIdx(12),
  string: ansiIdx(10),
  title: ansiIdx(11),
  'title.function': ansiIdx(11),
  'title.class': ansiIdx(11),
  comment: ansiIdx(8),
  meta: ansiIdx(8),
}

function buildTheme(themeName: string, mode: ColorMode): Theme {
// buildTheme：按主题名与色模式组装 Theme，分 ansi / dark(+daltonized) / light(+daltonized) 四支返回。
  const isDark = themeName.includes('dark')
  const isAnsi = themeName.includes('ansi')
  const isDaltonized = themeName.includes('daltonized')
  const tc = mode === 'truecolor'

  if (isAnsi) {
    return {
      addLine: DEFAULT_BG,
      addWord: DEFAULT_BG,
      addDecoration: ansiIdx(10),
      deleteLine: DEFAULT_BG,
      deleteWord: DEFAULT_BG,
      deleteDecoration: ansiIdx(9),
      foreground: ansiIdx(7),
      background: DEFAULT_BG,
      scopes: ANSI_SCOPES,
    }
  }

  if (isDark) {
    const fg = rgb(248, 248, 242)
    const deleteLine = rgb(61, 1, 0)
    const deleteWord = rgb(92, 2, 0)
    const deleteDecoration = rgb(220, 90, 90)
    if (isDaltonized) {
      return {
        addLine: tc ? rgb(0, 27, 41) : ansiIdx(17),
        addWord: tc ? rgb(0, 48, 71) : ansiIdx(24),
        addDecoration: rgb(81, 160, 200),
        deleteLine,
        deleteWord,
        deleteDecoration,
        foreground: fg,
        background: DEFAULT_BG,
        scopes: MONOKAI_SCOPES,
      }
    }
    return {
      addLine: tc ? rgb(2, 40, 0) : ansiIdx(22),
      addWord: tc ? rgb(4, 71, 0) : ansiIdx(28),
      addDecoration: rgb(80, 200, 80),
      deleteLine,
      deleteWord,
      deleteDecoration,
      foreground: fg,
      background: DEFAULT_BG,
      scopes: MONOKAI_SCOPES,
    }
  }

  // light
  const fg = rgb(51, 51, 51)
  const deleteLine = rgb(255, 220, 220)
  const deleteWord = rgb(255, 199, 199)
  const deleteDecoration = rgb(207, 34, 46)
  if (isDaltonized) {
    return {
      addLine: rgb(219, 237, 255),
      addWord: rgb(179, 217, 255),
      addDecoration: rgb(36, 87, 138),
      deleteLine,
      deleteWord,
      deleteDecoration,
      foreground: fg,
      background: DEFAULT_BG,
      scopes: GITHUB_SCOPES,
    }
  }
  return {
    addLine: rgb(220, 255, 220),
    addWord: rgb(178, 255, 178),
    addDecoration: rgb(36, 138, 61),
    deleteLine,
    deleteWord,
    deleteDecoration,
    foreground: fg,
    background: DEFAULT_BG,
    scopes: GITHUB_SCOPES,
  }
}

function defaultStyle(theme: Theme): Style {
// defaultStyle：取主题的前景/背景作为默认样式。
  return { foreground: theme.foreground, background: theme.background }
}

function lineBackground(marker: Marker, theme: Theme): Color {
// lineBackground：按行标记取该行背景色。
  switch (marker) {
    case '+':
      return theme.addLine
    case '-':
      return theme.deleteLine
    case ' ':
      return theme.background
  }
}

function wordBackground(marker: Marker, theme: Theme): Color {
// wordBackground：按行标记取词级背景色（词 diff 高亮用）。
  switch (marker) {
    case '+':
      return theme.addWord
    case '-':
      return theme.deleteWord
    case ' ':
      return theme.background
  }
}

function decorationColor(marker: Marker, theme: Theme): Color {
// decorationColor：按行标记取装饰色（行号列与标记列）。
  switch (marker) {
    case '+':
      return theme.addDecoration
    case '-':
      return theme.deleteDecoration
    case ' ':
      return theme.foreground
  }
}

// ---------------------------------------------------------------------------
// Syntax highlighting via highlight.js
// ---------------------------------------------------------------------------

// hljs 10.x uses `kind`; 11.x uses `scope`. Handle both.
// HljsNode：hljs 10.x 用 kind 字段、11.x 用 scope 字段，这里两种都兼容。
type HljsNode = {
  scope?: string
  kind?: string
  children: (HljsNode | string)[]
}

// Filename-based and extension-based language detection (approximates bat's
// SyntaxMapping + syntect's find_syntax_by_extension)
const FILENAME_LANGS: Record<string, string> = {
// FILENAME_LANGS：按文件名（Dockerfile / Makefile / Rakefile / Gemfile / CMakeLists）定语言，近似 bat 的 SyntaxMapping。
  Dockerfile: 'dockerfile',
  Makefile: 'makefile',
  Rakefile: 'ruby',
  Gemfile: 'ruby',
  CMakeLists: 'cmake',
}

function detectLanguage(
// detectLanguage：文件名 / 扩展名 / Shebang 三路检测语言，扩展名走 hljs.getLanguage。
  filePath: string,
  firstLine: string | null,
): string | null {
  const base = basename(filePath)
  const ext = extname(filePath).slice(1)

  // Filename-based lookup (handles Dockerfile, Makefile, CMakeLists.txt, etc.)
  const stem = base.split('.')[0] ?? ''
  const byName = FILENAME_LANGS[base] ?? FILENAME_LANGS[stem]
  if (byName && hljs().getLanguage(byName)) return byName
  if (ext) {
    const lang = hljs().getLanguage(ext)
    if (lang) return ext
  }
  // Shebang / first-line detection (strip UTF-8 BOM)
  if (firstLine) {
    const line = firstLine.startsWith('\ufeff') ? firstLine.slice(1) : firstLine
    if (line.startsWith('#!')) {
      if (line.includes('bash') || line.includes('/sh')) return 'bash'
      if (line.includes('python')) return 'python'
      if (line.includes('node')) return 'javascript'
      if (line.includes('ruby')) return 'ruby'
      if (line.includes('perl')) return 'perl'
    }
    if (line.startsWith('<?php')) return 'php'
    if (line.startsWith('<?xml')) return 'xml'
  }
  return null
}

function scopeColor(
// scopeColor：取某 scope 的颜色，含 storage 关键字拆分（命中 STORAGE_KEYWORDS 时走 _storage 色），未命中则回退到前缀 scope 或前景色。
  scope: string | undefined,
  text: string,
  theme: Theme,
): Color {
  if (!scope) return theme.foreground
  if (scope === 'keyword' && STORAGE_KEYWORDS.has(text.trim())) {
    return theme.scopes['_storage'] ?? theme.foreground
  }
  return (
    theme.scopes[scope] ??
    theme.scopes[scope.split('.')[0]!] ??
    theme.foreground
  )
}

function flattenHljs(
// flattenHljs：把 hljs 的 token 树递归拍平成 Block 序列（字符串节点直接上色，节点用其 scope 作为子树前景色）。
  node: HljsNode | string,
  theme: Theme,
  parentScope: string | undefined,
  out: Block[],
): void {
  if (typeof node === 'string') {
    const fg = scopeColor(parentScope, node, theme)
    out.push([{ foreground: fg, background: theme.background }, node])
    return
  }
  const scope = node.scope ?? node.kind ?? parentScope
  for (const child of node.children) {
    flattenHljs(child, theme, scope, out)
  }
}

// result.emitter is in the public HighlightResult type, but rootNode is
// internal to TokenTreeEmitter. Type guard validates the shape once so we
// fail loudly (via logError) instead of a silent try/catch swallow — the
// prior `as unknown as` cast hid a version mismatch (_emitter vs emitter,
// scope vs kind) behind a silent gray fallback.
function hasRootNode(emitter: unknown): emitter is { rootNode: HljsNode } {
// hasRootNode：emitter 形状的类型守卫，只校验一次就显式报错（经 logError）而非用静默 try/catch 吞掉——之前的 as unknown as 强转曾把版本差异（_emitter vs emitter、scope vs kind）藏进静默灰色回退。
  return (
    typeof emitter === 'object' &&
    emitter !== null &&
    'rootNode' in emitter &&
    typeof emitter.rootNode === 'object' &&
    emitter.rootNode !== null &&
    'children' in emitter.rootNode
  )
}

let loggedEmitterShapeError = false

function highlightLine(
// highlightLine：单行高亮。为对齐 syntect 行为，喂一个尾部换行让行注释能终止，再调 hljs.highlight，最后 flatten 成 Block。未知语言或形状不符时回退到默认样式。
  state: { lang: string | null; stack: unknown },
  line: string,
  theme: Theme,
): Block[] {
  // syntect-parity: feed a trailing \n so line comments terminate, then strip
  const code = line + '\n'
  if (!state.lang) {
    return [[defaultStyle(theme), code]]
  }
  let result
  try {
    result = hljs().highlight(code, {
      language: state.lang,
      ignoreIllegals: true,
    })
  } catch {
    // hljs throws on unknown language despite ignoreIllegals
    return [[defaultStyle(theme), code]]
  }
  if (!hasRootNode(result.emitter)) {
    if (!loggedEmitterShapeError) {
      loggedEmitterShapeError = true
      logError(
        new Error(
          `color-diff: hljs emitter shape mismatch (keys: ${Object.keys(result.emitter).join(',')}). Syntax highlighting disabled.`,
        ),
      )
    }
    return [[defaultStyle(theme), code]]
  }
  const blocks: Block[] = []
  flattenHljs(result.emitter.rootNode, theme, undefined, blocks)
  return blocks
}

// ---------------------------------------------------------------------------
// Word diff
// ---------------------------------------------------------------------------

type Range = { start: number; end: number }
// Range：词 diff 的 [start, end) 区间。

const CHANGE_THRESHOLD = 0.4
// CHANGE_THRESHOLD：改动比例阈值（0.4）。改动占比过高就不标词 diff，避免整行花花绿绿。

// Tokenize into word runs, whitespace runs, and single punctuation chars —
// matches the Rust tokenize() which mirrors diffWordsWithSpace's splitting.
function tokenize(text: string): string[] {
// tokenize：把文本切成「词串 / 空白串 / 单标点字符」三类 token，对齐 Rust 的 tokenize（对应 diffWordsWithSpace 的切分），按码点推进以处理代理对。
  const tokens: string[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (/[\p{L}\p{N}_]/u.test(ch)) {
      let j = i + 1
      while (j < text.length && /[\p{L}\p{N}_]/u.test(text[j]!)) j++
      tokens.push(text.slice(i, j))
      i = j
    } else if (/\s/.test(ch)) {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j]!)) j++
      tokens.push(text.slice(i, j))
      i = j
    } else {
      // advance one codepoint (handle surrogate pairs)
      const cp = text.codePointAt(i)!
      const len = cp > 0xffff ? 2 : 1
      tokens.push(text.slice(i, i + len))
      i += len
    }
  }
  return tokens
}

function findAdjacentPairs(markers: Marker[]): [number, number][] {
// findAdjacentPairs：在一串标记里找相邻的 -/+ 对，用于把删除行与增加行配对做词 diff。
  const pairs: [number, number][] = []
  let i = 0
  while (i < markers.length) {
    if (markers[i] === '-') {
      const delStart = i
      let delEnd = i
      while (delEnd < markers.length && markers[delEnd] === '-') delEnd++
      let addEnd = delEnd
      while (addEnd < markers.length && markers[addEnd] === '+') addEnd++
      const delCount = delEnd - delStart
      const addCount = addEnd - delEnd
      if (delCount > 0 && addCount > 0) {
        const n = Math.min(delCount, addCount)
        for (let k = 0; k < n; k++) {
          pairs.push([delStart + k, delEnd + k])
        }
        i = addEnd
      } else {
        i = delEnd
      }
    } else {
      i++
    }
  }
  return pairs
}

function wordDiffStrings(oldStr: string, newStr: string): [Range[], Range[]] {
// wordDiffStrings：对一对改动行做词 diff，返回旧/新各自的改动区间；改动占比超阈值则返回空区间。
  const oldTokens = tokenize(oldStr)
  const newTokens = tokenize(newStr)
  const ops = diffArrays(oldTokens, newTokens)

  const totalLen = oldStr.length + newStr.length
  let changedLen = 0
  const oldRanges: Range[] = []
  const newRanges: Range[] = []
  let oldOff = 0
  let newOff = 0

  for (const op of ops) {
    const len = op.value.reduce((s, t) => s + t.length, 0)
    if (op.removed) {
      changedLen += len
      oldRanges.push({ start: oldOff, end: oldOff + len })
      oldOff += len
    } else if (op.added) {
      changedLen += len
      newRanges.push({ start: newOff, end: newOff + len })
      newOff += len
    } else {
      oldOff += len
      newOff += len
    }
  }

  if (totalLen > 0 && changedLen / totalLen > CHANGE_THRESHOLD) {
    return [[], []]
  }
  return [oldRanges, newRanges]
}

// ---------------------------------------------------------------------------
// Highlight (per-line transform pipeline)
// ---------------------------------------------------------------------------

type Highlight = {
// Highlight：单行高亮的中间态——标记、行号、以及 Block 序列（一物理行可能含多块）。
  marker: Marker | null
  lineNumber: number
  lines: Block[][]
}

function removeNewlines(h: Highlight): void {
// removeNewlines：去掉行内换行，把一块里的多行文本拆成多条物理行。
  h.lines = h.lines.map(line =>
    line.flatMap(([style, text]) =>
      text
        .split('\n')
        .filter(p => p.length > 0)
        .map((p): Block => [style, p]),
    ),
  )
}

function charWidth(ch: string): number {
// charWidth：取字符的显示宽度（含全角），交给 ink 的 stringWidth。
  return stringWidth(ch)
}

function wrapText(h: Highlight, width: number, theme: Theme): void {
// wrapText：按显示宽度折行；改动行用背景色补到行尾，保证底色铺满。按码点切分以正确处理宽字符。
  const newLines: Block[][] = []
  for (const line of h.lines) {
    const queue: Block[] = line.slice()
    let cur: Block[] = []
    let curW = 0
    while (queue.length > 0) {
      const [style, text] = queue.shift()!
      const tw = stringWidth(text)
      if (curW + tw <= width) {
        cur.push([style, text])
        curW += tw
      } else {
        const remaining = width - curW
        let bytePos = 0
        let accW = 0
        // iterate by codepoint
        for (const ch of text) {
          const cw = charWidth(ch)
          if (accW + cw > remaining) break
          accW += cw
          bytePos += ch.length
        }
        if (bytePos === 0) {
          if (curW === 0) {
            // Fresh line and first char still doesn't fit — force one codepoint
            // to guarantee forward progress (overflows, but prevents infinite loop)
            const firstCp = text.codePointAt(0)!
            bytePos = firstCp > 0xffff ? 2 : 1
          } else {
            // Line has content and next char doesn't fit — finish this line,
            // re-queue the whole block for a fresh line
            newLines.push(cur)
            queue.unshift([style, text])
            cur = []
            curW = 0
            continue
          }
        }
        cur.push([style, text.slice(0, bytePos)])
        newLines.push(cur)
        queue.unshift([style, text.slice(bytePos)])
        cur = []
        curW = 0
      }
    }
    newLines.push(cur)
  }
  h.lines = newLines

  // Pad changed lines so background extends to edge
  if (h.marker && h.marker !== ' ') {
    const bg = lineBackground(h.marker, theme)
    const padStyle: Style = { foreground: theme.foreground, background: bg }
    for (const line of h.lines) {
      const curW = line.reduce((s, [, t]) => s + stringWidth(t), 0)
      if (curW < width) {
        line.push([padStyle, ' '.repeat(width - curW)])
      }
    }
  }
}

function addLineNumber(
// addLineNumber：在最左侧加行号列；改动行染色，上下文行（标记为空或空格）变暗。
  h: Highlight,
  theme: Theme,
  maxDigits: number,
  fullDim: boolean,
): void {
  const style: Style = {
    foreground: h.marker ? decorationColor(h.marker, theme) : theme.foreground,
    background: h.marker ? lineBackground(h.marker, theme) : theme.background,
  }
  const shouldDim = h.marker === null || h.marker === ' '
  for (let i = 0; i < h.lines.length; i++) {
    const prefix =
      i === 0
        ? ` ${String(h.lineNumber).padStart(maxDigits)} `
        : ' '.repeat(maxDigits + 2)
    const wrapped = shouldDim && !fullDim ? `${DIM}${prefix}${UNDIM}` : prefix
    h.lines[i]!.unshift([style, wrapped])
  }
}

function addMarker(h: Highlight, theme: Theme): void {
// addMarker：在行号列右侧加 +/-/空格 标记列。
  if (!h.marker) return
  const style: Style = {
    foreground: decorationColor(h.marker, theme),
    background: lineBackground(h.marker, theme),
  }
  for (const line of h.lines) {
    line.unshift([style, h.marker])
  }
}

function dimContent(h: Highlight): void {
// dimContent：ANSI 模式下把删除行内容整体变暗（DIM…UNDIM）。
  for (const line of h.lines) {
    if (line.length > 0) {
      line[0]![1] = DIM + line[0]![1]
      const last = line.length - 1
      line[last]![1] = line[last]![1] + UNDIM
    }
  }
}

function applyBackground(h: Highlight, theme: Theme, ranges: Range[]): void {
// applyBackground：把词 diff 区间涂到背景上——行背景 + 区间内词背景两层，逐块按字节偏移与区间求交。
  if (!h.marker) return
  const lineBg = lineBackground(h.marker, theme)
  const wordBg = wordBackground(h.marker, theme)

  let rangeIdx = 0
  let byteOff = 0
  for (let li = 0; li < h.lines.length; li++) {
    const newLine: Block[] = []
    for (const [style, text] of h.lines[li]!) {
      const textStart = byteOff
      const textEnd = byteOff + text.length

      while (rangeIdx < ranges.length && ranges[rangeIdx]!.end <= textStart) {
        rangeIdx++
      }
      if (rangeIdx >= ranges.length) {
        newLine.push([{ ...style, background: lineBg }, text])
        byteOff = textEnd
        continue
      }

      let remaining = text
      let pos = textStart
      while (remaining.length > 0 && rangeIdx < ranges.length) {
        const r = ranges[rangeIdx]!
        const inRange = pos >= r.start && pos < r.end
        let next: number
        if (inRange) {
          next = Math.min(r.end, textEnd)
        } else if (r.start > pos && r.start < textEnd) {
          next = r.start
        } else {
          next = textEnd
        }
        const segLen = next - pos
        const seg = remaining.slice(0, segLen)
        newLine.push([{ ...style, background: inRange ? wordBg : lineBg }, seg])
        remaining = remaining.slice(segLen)
        pos = next
        if (pos >= r.end) rangeIdx++
      }
      if (remaining.length > 0) {
        newLine.push([{ ...style, background: lineBg }, remaining])
      }
      byteOff = textEnd
    }
    h.lines[li] = newLine
  }
}

function intoLines(
// intoLines：把 Highlight 序列化成终端转义字符串数组（每条物理行一个元素）。
  h: Highlight,
  dim: boolean,
  skipBg: boolean,
  mode: ColorMode,
): string[] {
  return h.lines.map(line => asTerminalEscaped(line, mode, skipBg, dim))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function maxLineNumber(hunk: Hunk): number {
// maxLineNumber：取 hunk 中新旧两端的最大行号，用于决定行号列位数。
  const oldEnd = Math.max(0, hunk.oldStart + hunk.oldLines - 1)
  const newEnd = Math.max(0, hunk.newStart + hunk.newLines - 1)
  return Math.max(oldEnd, newEnd)
}

function parseMarker(s: string): Marker {
// parseMarker：把行首字符解析成标记（+ / - / 空格）。
  return s === '+' || s === '-' ? s : ' '
}

// ColorDiff 类：单个 hunk 的彩色渲染器，持有 hunk / 文件路径 / 首行 / 前缀内容。
export class ColorDiff {
  private hunk: Hunk
  private filePath: string
  private firstLine: string | null
  private prefixContent: string | null

  constructor(
    hunk: Hunk,
    firstLine: string | null,
    filePath: string,
    prefixContent?: string | null,
  ) {
    this.hunk = hunk
    this.filePath = filePath
    this.firstLine = firstLine
    this.prefixContent = prefixContent ?? null
  }

  render(themeName: string, width: number, dim: boolean): string[] | null {
// ColorDiff.render：两遍渲染。第一遍给每行定标记与行号；第二遍走「高亮 + 变换流水线」（去换行→涂背景→折行→加标记→加行号）。dim 时不算词 diff（太吵）。
    const mode = detectColorMode(themeName)
    const theme = buildTheme(themeName, mode)
    const lang = detectLanguage(this.filePath, this.firstLine)
    const hlState = { lang, stack: null }

    // Warm highlighter with prefix lines (highlight.js is stateless per call,
    // so this is a no-op for now — preserved for API parity)
    void this.prefixContent

    const maxDigits = String(maxLineNumber(this.hunk)).length
    let oldLine = this.hunk.oldStart
    let newLine = this.hunk.newStart
    const effectiveWidth = Math.max(1, width - maxDigits - 2 - 1)

    // First pass: assign markers + line numbers
    type Entry = { lineNumber: number; marker: Marker; code: string }
    const entries: Entry[] = this.hunk.lines.map(rawLine => {
      const marker = parseMarker(rawLine.slice(0, 1))
      const code = rawLine.slice(1)
      let lineNumber: number
      switch (marker) {
        case '+':
          lineNumber = newLine++
          break
        case '-':
          lineNumber = oldLine++
          break
        case ' ':
          lineNumber = newLine
          oldLine++
          newLine++
          break
      }
      return { lineNumber, marker, code }
    })

    // Word-diff ranges (skip when dim — too loud)
// 词 diff 区间计算：dim 时跳过；否则对相邻 -/+ 对调用 wordDiffStrings 得到各自改动区间。
    const ranges: Range[][] = entries.map(() => [])
    if (!dim) {
      const markers = entries.map(e => e.marker)
      for (const [delIdx, addIdx] of findAdjacentPairs(markers)) {
        const [delR, addR] = wordDiffStrings(
          entries[delIdx]!.code,
          entries[addIdx]!.code,
        )
        ranges[delIdx] = delR
        ranges[addIdx] = addR
      }
    }

    // Second pass: highlight + transform pipeline
// 第二遍高亮变换流水线：逐行高亮后依次执行去换行、涂背景、折行、ANSI 变暗、加标记、加行号，再序列化输出。
    const out: string[] = []
    for (let i = 0; i < entries.length; i++) {
      const { lineNumber, marker, code } = entries[i]!
      const tokens: Block[] =
        marker === '-'
          ? [[defaultStyle(theme), code]]
          : highlightLine(hlState, code, theme)

      const h: Highlight = { marker, lineNumber, lines: [tokens] }
      removeNewlines(h)
      applyBackground(h, theme, ranges[i]!)
      wrapText(h, effectiveWidth, theme)
      if (mode === 'ansi' && marker === '-') {
        dimContent(h)
      }
      addMarker(h, theme)
      addLineNumber(h, theme, maxDigits, dim)
      out.push(...intoLines(h, dim, false, mode))
    }
    return out
  }
}

// ColorFile 类：整个文件的彩色渲染器（不分 hunk），逐行高亮并跳过词 diff、不画行背景。
export class ColorFile {
  private code: string
  private filePath: string

  constructor(code: string, filePath: string) {
    this.code = code
    this.filePath = filePath
  }

  render(themeName: string, width: number, dim: boolean): string[] | null {
// ColorFile.render：按行切分（丢弃尾部空行以对齐 Rust .lines()），逐行高亮、折行、加行号，skipBg 为真故不画改动背景。
    const mode = detectColorMode(themeName)
    const theme = buildTheme(themeName, mode)
    const lines = this.code.split('\n')
    // Rust .lines() drops trailing empty line from trailing \n
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    const firstLine = lines[0] ?? null
    const lang = detectLanguage(this.filePath, firstLine)
    const hlState = { lang, stack: null }

    const maxDigits = String(lines.length).length
    const effectiveWidth = Math.max(1, width - maxDigits - 2)

    const out: string[] = []
    for (let i = 0; i < lines.length; i++) {
      const tokens = highlightLine(hlState, lines[i]!, theme)
      const h: Highlight = { marker: null, lineNumber: i + 1, lines: [tokens] }
      removeNewlines(h)
      wrapText(h, effectiveWidth, theme)
      addLineNumber(h, theme, maxDigits, dim)
      out.push(...intoLines(h, dim, true, mode))
    }
    return out
  }
}

// getSyntaxTheme：返回默认语法主题名（highlight.js 没有 bat 主题集，BAT_THEME 等环境变量只是为诊断而报告）。
export function getSyntaxTheme(themeName: string): SyntaxTheme {
  // highlight.js has no bat theme set, so env vars can't select alternate
  // syntect themes. We still report the env var if set, for diagnostics.
  const envTheme =
    process.env.CLAUDE_CODE_SYNTAX_HIGHLIGHT ?? process.env.BAT_THEME
  void envTheme
  return { theme: defaultSyntaxThemeName(themeName), source: null }
}

// Lazy loader to match vendor/color-diff-src/index.ts API
let cachedModule: NativeModule | null = null

export function getNativeModule(): NativeModule | null {
// getNativeModule：懒加载并缓存 NativeModule 导出形状，对齐 vendor/color-diff-src/index.ts 的 API。
  if (cachedModule) return cachedModule
  cachedModule = { ColorDiff, ColorFile, getSyntaxTheme }
  return cachedModule
}

export type { ColorDiff as ColorDiffClass, ColorFile as ColorFileClass }
// 把 ColorDiff / ColorFile 以类型别名重导出，供外部按原名引用。

// Exported for testing
export const __test = {
// __test：导出内部函数（tokenize / findAdjacentPairs / wordDiffStrings / ansi256FromRgb 等）供单测调用。
  tokenize,
  findAdjacentPairs,
  wordDiffStrings,
  ansi256FromRgb,
  colorToEscape,
  detectColorMode,
  detectLanguage,
}
