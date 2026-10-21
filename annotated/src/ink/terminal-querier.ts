// ═══════════════════════════════════════════════════════════════
//  查询终端：没有超时的等待
// ═══════════════════════════════════════════════════════════════
//
//  这是一个「问终端问题」的框架。问题在于：**大部分终端不会回答
//  不认识的问题，而且不会告诉你它不认识**。没有回答，就没法用
//  超时之外的办法结束等待 —— 而超时是最糟糕的机制（慢终端被误判、
//  快终端白等、时钟不准就全错）。
//
//  这里的解法是**哨兵（sentinel）**：每一批查询后面跟一条
//  「所有终端都必须回答」的 DA1（`CSI c`，VT100 就有的设备属性查询）。
//  终端按顺序回答，于是：
//
//      你的答复在 DA1 之前到 → 支持
//      DA1 先到             → 不支持（你的问题被忽略了）
//
//  一条**必定有答复**的查询，把「无限等待」变成了「有限等待」。
//  这个技巧的正确性只依赖一件事：终端按接收顺序答复。这是 VT 的
//  基本约定，比任何能力探测都可靠。
//
//  ⚠️ 但这份文件里七种查询构造器，**只有 `xtversion` 有读者**。
//  详见文件末尾的说明。
/**
 * Query the terminal and await responses without timeouts.
 *
 * Terminal queries (DECRQM, DA1, OSC 11, etc.) share the stdin stream
 * with keyboard input. Response sequences are syntactically
 * distinguishable from key events, so the input parser recognizes them
 * and dispatches them here.
 *
 * To avoid timeouts, each query batch is terminated by a DA1 sentinel
 * (CSI c) — every terminal since VT100 responds to DA1, and terminals
 * answer queries in order. So: if your query's response arrives before
 * DA1's, the terminal supports it; if DA1 arrives first, it doesn't.
 *
 * Usage:
 *   const [sync, grapheme] = await Promise.all([
 *     querier.send(decrqm(2026)),
 *     querier.send(decrqm(2027)),
 *     querier.flush(),
 *   ])
 *   // sync and grapheme are DECRPM responses or undefined if unsupported
 */

import type { TerminalResponse } from './parse-keypress.js'
import { csi } from './termio/csi.js'
import { osc } from './termio/osc.js'

/** A terminal query: an outbound request sequence paired with a matcher
 *  that recognizes the expected inbound response. Built by `decrqm()`,
 *  `oscColor()`, `kittyKeyboard()`, etc. */
// `TerminalQuery` 是「问法」：一条要写出去的命令 + 一个类型守卫。
//
// 用类型守卫（`r is T`）而不是「返回 boolean」的好处是：`send()` 的
// 返回类型可以精确到 `T | undefined`，调用方不用再收窄。代价是每个
// 构造器都要写一遍谓词 —— 七份重复，但每份都短。
export type TerminalQuery<T extends TerminalResponse = TerminalResponse> = {
  /** Escape sequence to write to stdout */
  request: string
  /** Recognizes the expected response in the inbound stream */
  match: (r: TerminalResponse) => r is T
}

// 用 `Extract<Union, {type: 'x'}>` 从 `TerminalResponse` 里抠出具体成员。
// 这样「响应类型定义在 parse-keypress.ts、查询构造器定义在这里」两处
// 不会脱钩 —— 改了联合类型，这里的 Extract 自动跟着变。
type DecrpmResponse = Extract<TerminalResponse, { type: 'decrpm' }>
type Da1Response = Extract<TerminalResponse, { type: 'da1' }>
type Da2Response = Extract<TerminalResponse, { type: 'da2' }>
type KittyResponse = Extract<TerminalResponse, { type: 'kittyKeyboard' }>
type CursorPosResponse = Extract<TerminalResponse, { type: 'cursorPosition' }>
type OscResponse = Extract<TerminalResponse, { type: 'osc' }>
type XtversionResponse = Extract<TerminalResponse, { type: 'xtversion' }>

// -- Query builders --

/** DECRQM: request DEC private mode status (CSI ? mode $ p).
 *  Terminal replies with DECRPM (CSI ? mode ; status $ y) or ignores. */
// DECRQM（`CSI ? mode $ p`）→ DECRPM 答复（`CSI ? mode ; status $ y`）。
//
// 这是最「正规」的能力探测方式：直接问「模式 2026 现在是什么状态」。
// 答复里的 status 有四种（0=不认识、1=设了、2=重置了、3=永久设、4=永久重置），
// 但这份代码只关心「有没有答复」—— 有答复就说明它认识这个模式。
//
// ⚠️ 零读者。`isSynchronizedOutputSupported()` 用的是环境变量白名单，
// 没有用它。
export function decrqm(mode: number): TerminalQuery<DecrpmResponse> {
  return {
    request: csi(`?${mode}$p`),
    match: (r): r is DecrpmResponse => r.type === 'decrpm' && r.mode === mode,
  }
}

/** Primary Device Attributes query (CSI c). Every terminal answers this —
 *  used internally by flush() as a universal sentinel. Call directly if
 *  you want the DA1 params. */
// DA1。注释里那句「used internally by flush() as a universal sentinel」
// 说明了它的特殊地位 —— 但注意 flush() **并没有调用这个函数**，
// 它用的是第 118 行的 `SENTINEL` 常量（同样是 `CSI c`）。
//
// 两处各写一遍，是因为 `flush()` 只需要「写出去」，不需要「等答复」。
// 而这个构造器存在的意义是「如果你想拿到 DA1 的参数，显式 send 一次」——
// 于是终端会答两遍：第一遍匹配这个显式查询，第二遍（无人匹配）触发哨兵。
// `onResponse` 的注释详细讲了这条双答复路径。
//
// ⚠️ 零读者。
export function da1(): TerminalQuery<Da1Response> {
  return {
    request: csi('c'),
    match: (r): r is Da1Response => r.type === 'da1',
  }
}

/** Secondary Device Attributes query (CSI > c). Returns terminal version. */
// DA2（`CSI > c`）→ 终端版本（如 `41;10;0` 表示 VT420）。理论上比
// TERM_PROGRAM 可靠，但答复格式各家不同，解析成本高。
//
// ⚠️ 零读者。
export function da2(): TerminalQuery<Da2Response> {
  return {
    request: csi('>c'),
    match: (r): r is Da2Response => r.type === 'da2',
  }
}

/** Query current Kitty keyboard protocol flags (CSI ? u).
 *  Terminal replies with CSI ? flags u or ignores. */
// 查当前 Kitty 键盘协议的 flags（`CSI ? u`）。这条如果被用上，
// 会比 `supportsExtendedKeys()` 的环境变量白名单精确得多 ——
// 那个白名单正是「无条件开启踩坑」之后打的补丁。
//
// 但这条查询有个坑：**不支持的终端可能把它当成 `CSI ? u` 的
// 未知私有序号**，静默忽略（好事），也可能把 `?u` 当输入吐出来（坏事）。
// 所以即便用它，也得配合兜底。
//
// ⚠️ 零读者。
export function kittyKeyboard(): TerminalQuery<KittyResponse> {
  return {
    request: csi('?u'),
    match: (r): r is KittyResponse => r.type === 'kittyKeyboard',
  }
}

/** DECXCPR: request cursor position with DEC-private marker (CSI ? 6 n).
 *  Terminal replies with CSI ? row ; col R. The `?` marker is critical —
 *  the plain DSR form (CSI 6 n → CSI row;col R) is ambiguous with
 *  modified F3 keys (Shift+F3 = CSI 1;2 R, etc.). */
// DECXCPR（`CSI ? 6 n`）→ `CSI ? row ; col R`。
//
// 注释里那句「the `?` marker is critical」是本文件最有实用价值的一条：
// 不用 `?` 的话，答复形式是 `CSI row ; col R`，而 **Shift+F3 的序列
// 恰好也是 `CSI 1 ; 2 R`**。也就是说光标位置答复和按键序列在语法上
// 撞车了。加上 `?` 就把两者分开了。
//
// 这类「查询答复与输入序列同形」的冲突在终端里不止一处，凡是设计
// 查询就要先问一句：答复的形状会不会被误认为按键。
//
// ⚠️ 零读者。
export function cursorPosition(): TerminalQuery<CursorPosResponse> {
  return {
    request: csi('?6n'),
    match: (r): r is CursorPosResponse => r.type === 'cursorPosition',
  }
}

/** OSC dynamic color query (e.g. OSC 11 for bg color, OSC 10 for fg).
 *  The `?` data slot asks the terminal to reply with the current value. */
// OSC 颜色查询（10=前景、11=背景）。数据槽给 `?` 表示「请报当前值」。
// 这是实现「浅色/深色主题自适应」的正规途径。
//
// ⚠️ 零读者。
export function oscColor(code: number): TerminalQuery<OscResponse> {
  return {
    request: osc(code, '?'),
    match: (r): r is OscResponse => r.type === 'osc' && r.code === code,
  }
}

/** XTVERSION: request terminal name/version (CSI > 0 q).
 *  Terminal replies with DCS > | name ST (e.g. "xterm.js(5.5.0)") or ignores.
 *  This survives SSH — the query goes through the pty, not the environment,
 *  so it identifies the *client* terminal even when TERM_PROGRAM isn't
 *  forwarded. Used to detect xterm.js for wheel-scroll compensation. */
// XTVERSION（`CSI > 0 q`）→ DCS `> | name ST`。
//
// **这是七个构造器里唯一有读者的一个**，调用点在
// `components/App.tsx:254`：raw mode 开启时发一次，答复回来就
// `setXtversionName()`。它的价值全在那句「This survives SSH」——
// 环境变量穿不过去，pty 数据流穿得过去。
export function xtversion(): TerminalQuery<XtversionResponse> {
  return {
    request: csi('>0q'),
    match: (r): r is XtversionResponse => r.type === 'xtversion',
  }
}

// -- Querier --

/** Sentinel request sequence (DA1). Kept internal; flush() writes it. */
// 哨兵常量单独定义，而不是复用 `da1().request`。理由是这行要能被
// 单独搜到 —— 「哪些地方会写 `CSI c`」应该是一个能一眼查清的问题。
const SENTINEL = csi('c')

// 队列里只有两种东西：查询（等答复）和哨兵（等屏障）。
// 用同一个队列而不是两个，是因为**顺序本身是协议** ——
// 终端按接收顺序答复，所以「第几个哨兵」决定了「哪些查询归它管」。
type Pending =
  | {
      kind: 'query'
      match: (r: TerminalResponse) => boolean
      resolve: (r: TerminalResponse | undefined) => void
    }
  | { kind: 'sentinel'; resolve: () => void }

export class TerminalQuerier {
  /**
   * Interleaved queue of queries and sentinels in send order. Terminals
   * respond in order, so each flush() barrier only drains queries queued
   * before it — concurrent batches from independent callers stay isolated.
   */
// 这个数组是整份文件的**状态机**。理解它要抓住一点：
// 队列里的顺序 == 写出去的顺序 == 终端答复的顺序。
//
// 于是「哨兵之前的所有查询」正好就是「终端在答 DA1 之前应该已经答完的
// 查询」。如果它们没答，就是「不支持」。这份信心来自终端的顺序保证，
// 不是来自超时。
  private queue: Pending[] = []

  constructor(private stdout: NodeJS.WriteStream) {}

  /**
   * Send a query and wait for its response.
   *
   * Resolves with the response when `query.match` matches an incoming
   * TerminalResponse, or with `undefined` when a flush() sentinel arrives
   * before any matching response (meaning the terminal ignored the query).
   *
   * Never rejects; never times out on its own. If you never call flush()
   * and the terminal doesn't respond, the promise remains pending.
   */
  send<T extends TerminalResponse>(
    query: TerminalQuery<T>,
  ): Promise<T | undefined> {
    return new Promise(resolve => {
      this.queue.push({
        kind: 'query',
        match: query.match,
        resolve: r => resolve(r as T | undefined),
      })
// 注意 `send` **立刻写出去**（第 157 行），但 promise 只会在
// `onResponse` 里被解决。也就是说：写了不一定有答，有答一定先匹配。
//
// 这也意味着**不调 flush() 就会永久 pending**。这不是 bug，是契约：
// 注释第 145 行明写「Never rejects; never times out on its own」。
// 调用方必须成对使用 send + flush。
      this.stdout.write(query.request)
    })
  }

  /**
   * Send the DA1 sentinel. Resolves when DA1's response arrives.
   *
   * As a side effect, all queries still pending when DA1 arrives are
   * resolved with `undefined` (terminal didn't respond → doesn't support
   * the query). This is the barrier that makes send() timeout-free.
   *
   * Safe to call with no pending queries — still waits for a round-trip.
   */
// `flush()` 做两件事，且**都靠 DA1 答复触发**：
//   1. 解决自己的 promise（等到了 DA1）
//   2. 把哨兵之前那些还没答的查询全部判为 undefined = 不支持
//
// 第 2 件事是真正让 `send` 免超时的机制。第 1 件事只是让调用方能
// 「知道这一批结束了」。
//
// 注释最后那句「Safe to call with no pending queries — still waits for
// a round-trip」说明它还能当纯延迟用：想知道「终端还活着吗」就 flush 一次。
  flush(): Promise<void> {
    return new Promise(resolve => {
      this.queue.push({ kind: 'sentinel', resolve })
      this.stdout.write(SENTINEL)
    })
  }

  /**
   * Dispatch a response parsed from stdin. Called by App.tsx's
   * processKeysInBatch for every `kind: 'response'` item.
   *
   * Matching strategy:
   * - First, try to match a pending query (FIFO, first match wins).
   *   This lets callers send(da1()) explicitly if they want the DA1
   *   params — a separate DA1 write means the terminal sends TWO DA1
   *   responses. The first matches the explicit query; the second
   *   (unmatched) fires the sentinel.
   * - Otherwise, if this is a DA1, fire the FIRST pending sentinel:
   *   resolve any queries queued before that sentinel with undefined
   *   (the terminal answered DA1 without answering them → unsupported)
   *   and signal its flush() completion. Only draining up to the first
   *   sentinel keeps later batches intact when multiple callers have
   *   concurrent queries in flight.
   * - Unsolicited responses (no match, no sentinel) are silently dropped.
   */
// 分派逻辑的顺序是这一整个机制的关键，且**两段的顺序不能换**：
//
//  先找精确匹配（FIFO，第一个匹配的赢），再找哨兵。
//
// 如果反过来（先处理哨兵），那么「显式 send 过 da1()」的场景里，
// DA1 的答复会被哨兵抢走、`send(da1())` 永远拿不到参数。所以正确性
// 依赖这个顺序。
//
// 还有一条更容易漏的：哨兵只 drain **到第一个** 哨兵为止
// （`splice(0, s + 1)`）。这样两个调用方并发查询时，A 的 DA1 不会
// 把 B 的查询也判死 —— B 的哨兵还在队列后面等着。
  onResponse(r: TerminalResponse): void {
    const idx = this.queue.findIndex(p => p.kind === 'query' && p.match(r))
    if (idx !== -1) {
      const [q] = this.queue.splice(idx, 1)
      if (q?.kind === 'query') q.resolve(r)
      return
    }

// 只有 DA1 能触发哨兵。这里没有再判断「这个 DA1 是不是我 send 的那个」——
// 因为上面的精确匹配已经先跑过了（第 196 行）：如果队列里有显式的
// `send(da1())`，它会先被匹配掉、`return` 掉，走不到这里。
//
// 这正好实现了注释里说的「一个 DA1 写两次、答复两次、第一次给查询、
// 第二次给哨兵」。
    if (r.type === 'da1') {
      const s = this.queue.findIndex(p => p.kind === 'sentinel')
      if (s === -1) return
      for (const p of this.queue.splice(0, s + 1)) {
        if (p.kind === 'query') p.resolve(undefined)
        else p.resolve()
      }
    }
  }
}
// ═══════════════════════════════════════════════════════════════
//  结语：一个 212 行的框架，服务一个查询
// ═══════════════════════════════════════════════════════════════
//
//  倒查七个构造器的读者（grep 每个函数名，只算「定义处以外」的命中）：
//
//    decrqm          0
//    da1             0
//    da2             0
//    kittyKeyboard   0
//    cursorPosition  0
//    oscColor        0
//    xtversion       1   ← App.tsx:254
//
//  也就是说：**哨兵机制、并发批次隔离、双 DA1 路径，全都只为了
//  「问一次终端叫什么名字」**。而名字只用来判断「是不是 xterm.js」，
//  再往下只影响滚轮补偿的系数。
//
//  这不是嘲笑。它说明的是一件更普遍的事：**基础设施的成本是提前付的，
//  收益却要在很久之后才可能兑现**。当初建这套框架时大概想的是
//  「以后所有能力探测都走这条路」，结果后来每条探测都找到了更便宜的
//  办法（环境变量白名单、版本号比较），只有「穿 SSH」这一个需求
//  非它不可。
//
//  对读代码的人的实用建议：见到这种「框架齐全、调用者寥寥」的模块，
//  不要花时间理解每一处细节的动机 —— 先确认它现在服务哪一条路径，
//  然后把精力集中在那一路上。这份文件里真正被执行的代码是：
//  第 108 行的 `xtversion()`、第 128 行的类、第 148 行的 `send`、
//  第 170 行的 `flush`、第 195 行的 `onResponse` 的哨兵分支。
//  六个构造器加起来不到 60 行，可以只当文档看。
