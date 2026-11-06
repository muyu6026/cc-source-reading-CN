import { logForDebugging } from '../utils/debug.js'
import { BridgeFatalError } from './bridgeApi.js'
import type { BridgeApiClient } from './types.js'

/**
 * Ant-only fault injection for manually testing bridge recovery paths.
 *
 * Real failure modes this targets (BQ 2026-03-12, 7-day window):
 *   poll 404 not_found_error   — 147K sessions/week, dead onEnvironmentLost gate
 *   ws_closed 1002/1006        —  22K sessions/week, zombie poll after close
 *   register transient failure —  residual: network blips during doReconnect
 *
 * Usage: /bridge-kick <subcommand> from the REPL while Remote Control is
 * connected, then tail debug.log to watch the recovery machinery react.
 *
 * Module-level state is intentional here: one bridge per REPL process, the
 * /bridge-kick slash command has no other way to reach into initBridgeCore's
 * closures, and teardown clears the slot.
 */

/** One-shot fault to inject on the next matching api call. */
// 注入目标就四个：轮询、注册环境、重连会话、心跳——都是排查恢复路径时最难自然复现的那几处
type BridgeFault = {
  method:
    | 'pollForWork'
    | 'registerBridgeEnvironment'
    | 'reconnectSession'
    | 'heartbeatWork'
  /** Fatal errors go through handleErrorStatus → BridgeFatalError. Transient
   *  errors surface as plain axios rejections (5xx / network). Recovery code
   *  distinguishes the two: fatal → teardown, transient → retry/backoff. */
// 致命与瞬时两类走完全不同的收尾：前者拆桥，后者退避重试。伪造错误时这一点必须对上
  kind: 'fatal' | 'transient'
  status: number
  errorType?: string
// 剩余次数在消费时递减，减到零才出队：这样一条故障可以对连续 N 次调用生效
  /** Remaining injections. Decremented on consume; removed at 0. */
  count: number
}

// 这个句柄是斜杠命令唯一能伸进来的入口：桥接真正的闭包都在初始化函数里，命令拿不到
export type BridgeDebugHandle = {
  /** Invoke the transport's permanent-close handler directly. Tests the
   *  ws_closed → reconnectEnvironmentWithSession escalation (#22148). */
  fireClose: (code: number) => void
  /** Call reconnectEnvironmentWithSession() — same as SIGUSR2 but
   *  reachable from the slash command. */
  forceReconnect: () => void
  /** Queue a fault for the next N calls to the named api method. */
  injectFault: (fault: BridgeFault) => void
  /** Abort the at-capacity sleep so an injected poll fault lands
   *  immediately instead of up to 10min later. */
  wakePollLoop: () => void
  /** env/session IDs for the debug.log grep. */
  describe: () => string
}

// 模块级单例：一个进程只有一个桥接，不需要挂在任何对象上
let debugHandle: BridgeDebugHandle | null = null
const faultQueue: BridgeFault[] = []

export function registerBridgeDebugHandle(h: BridgeDebugHandle): void {
  debugHandle = h
}

// 清理时连队列一起清：句柄没了但故障还留着，下一次建桥会立刻被打断
export function clearBridgeDebugHandle(): void {
  debugHandle = null
  faultQueue.length = 0
}

export function getBridgeDebugHandle(): BridgeDebugHandle | null {
  return debugHandle
}

// 入队只记日志不改行为：真正生效发生在被包装的接口调用处
export function injectBridgeFault(fault: BridgeFault): void {
  faultQueue.push(fault)
  logForDebugging(
    `[bridge:debug] Queued fault: ${fault.method} ${fault.kind}/${fault.status}${fault.errorType ? `/${fault.errorType}` : ''} ×${fault.count}`,
  )
}

/**
 * Wrap a BridgeApiClient so each call first checks the fault queue. If a
 * matching fault is queued, throw the specified error instead of calling
 * through. Delegates everything else to the real client.
 *
 * Only called when USER_TYPE === 'ant' — zero overhead in external builds.
 */
// 包装器只在测试构建里挂上：外部构建根本没有这条路径，所以谈不上开销
export function wrapApiForFaultInjection(
  api: BridgeApiClient,
): BridgeApiClient {
  function consume(method: BridgeFault['method']): BridgeFault | null {
// 按方法名找第一条匹配：不按顺序全量消费，避免一条心跳故障顺手把轮询也打死
    const idx = faultQueue.findIndex(f => f.method === method)
    if (idx === -1) return null
    const fault = faultQueue[idx]!
    fault.count--
// 先递减再判断：传一时正好生效一次，传三就连续三次
    if (fault.count <= 0) faultQueue.splice(idx, 1)
    return fault
  }

  function throwFault(fault: BridgeFault, context: string): never {
    logForDebugging(
      `[bridge:debug] Injecting ${fault.kind} fault into ${context}: status=${fault.status} errorType=${fault.errorType ?? 'none'}`,
    )
// 致命错误要造成带状态码与错误类型的专有错误：恢复代码靠类型分流，普通 Error 会被当成瞬时
    if (fault.kind === 'fatal') {
      throw new BridgeFatalError(
        `[injected] ${context} ${fault.status}`,
        fault.status,
        fault.errorType,
      )
    }
    // Transient: mimic an axios rejection (5xx / network). No .status on
    // the error itself — that's how the catch blocks distinguish.
// 瞬时错误刻意不带状态码：catch 里的判断就是看有没有响应状态，伪造一个反而会被误判成致命
    throw new Error(`[injected transient] ${context} ${fault.status}`)
  }

// 展开原接口再覆盖四个方法：没包装的方法原样透传，不必逐个列举
  return {
    ...api,
    async pollForWork(envId, secret, signal, reclaimMs) {
      const f = consume('pollForWork')
      if (f) throwFault(f, 'Poll')
      return api.pollForWork(envId, secret, signal, reclaimMs)
    },
    async registerBridgeEnvironment(config) {
      const f = consume('registerBridgeEnvironment')
      if (f) throwFault(f, 'Registration')
      return api.registerBridgeEnvironment(config)
    },
    async reconnectSession(envId, sessionId) {
      const f = consume('reconnectSession')
      if (f) throwFault(f, 'ReconnectSession')
      return api.reconnectSession(envId, sessionId)
    },
    async heartbeatWork(envId, workId, token) {
      const f = consume('heartbeatWork')
      if (f) throwFault(f, 'Heartbeat')
      return api.heartbeatWork(envId, workId, token)
    },
  }
}
