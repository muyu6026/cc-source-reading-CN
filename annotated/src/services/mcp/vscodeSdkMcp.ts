import { logForDebugging } from 'src/utils/debug.js'
import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  checkStatsigFeatureGate_CACHED_MAY_BE_STALE,
  getFeatureValue_CACHED_MAY_BE_STALE,
} from '../analytics/growthbook.js'
import { logEvent } from '../analytics/index.js'
import type { ConnectedMCPServer, MCPServerConnection } from './types.js'

// Mirror of AutoModeEnabledState in permissionSetup.ts — inlined because that
// file pulls in too many deps for this thin IPC module.
// 这个类型在 permissionSetup.ts 里也有一份，注释说是 mirror，理由是「那文件
// 拖进来的依赖太重，而这只是个薄 IPC 模块」。
//
// 代价写清楚：两边的枚举值必须手动同步。改一边忘另一边的症状很隐蔽 ——
// VSCode 侧收到一个自己不认识的状态字符串，按「未知即 disabled」处理，
// 表现为「自动模式在 IDE 里永远关着」，日志里什么错都没有。
type AutoModeEnabledState = 'enabled' | 'disabled' | 'opt-in'
function readAutoModeEnabledState(): AutoModeEnabledState | undefined {
  const v = getFeatureValue_CACHED_MAY_BE_STALE<{ enabled?: string }>(
    'tengu_auto_mode_config',
    {},
  )?.enabled
  return v === 'enabled' || v === 'disabled' || v === 'opt-in' ? v : undefined
}

export const LogEventNotificationSchema = lazySchema(() =>
  z.object({
    method: z.literal('log_event'),
    params: z.object({
      eventName: z.string(),
      eventData: z.object({}).passthrough(),
    }),
  }),
)

// Store the VSCode MCP client reference for sending notifications
let vscodeMcpClient: ConnectedMCPServer | null = null

/**
 * Sends a file_updated notification to the VSCode MCP server. This is used to
 * notify VSCode when files are edited or written by Claude.
 */
export function notifyVscodeFileUpdated(
  filePath: string,
  oldContent: string | null,
  newContent: string | null,
): void {
  if (process.env.USER_TYPE !== 'ant' || !vscodeMcpClient) {
// `USER_TYPE !== 'ant'` 意味着外部构建里这个函数恒为空操作。
//
// 而且还有第二道：vscodeMcpClient 只在 setupVscodeSdkMcp 里、且 client.type
// 严格等于 'connected' 时才被赋值。两道加起来是「编译期/运行期双重关闭」——
// 不是「出错被吞掉」，是这条路压根没打开。
    return
  }

  void vscodeMcpClient.client
    .notification({
      method: 'file_updated',
      params: { filePath, oldContent, newContent },
    })
    .catch((error: Error) => {
      // Do not throw if the notification failed
      logForDebugging(
        `[VSCode] Failed to send file_updated notification: ${error.message}`,
      )
    })
}

/**
 * Sets up the speicial internal VSCode MCP for bidirectional communication using notifications.
 */
export function setupVscodeSdkMcp(sdkClients: MCPServerConnection[]): void {
  const client = sdkClients.find(client => client.name === 'claude-vscode')

  if (client && client.type === 'connected') {
    // Store the client reference for later use
    vscodeMcpClient = client

    client.client.setNotificationHandler(
      LogEventNotificationSchema(),
      async notification => {
        const { eventName, eventData } = notification.params
        logEvent(
          `tengu_vscode_${eventName}`,
          eventData as { [key: string]: boolean | number | undefined },
        )
      },
    )

    // Send necessary experiment gates to VSCode immediately.
    const gates: Record<string, boolean | string> = {
      tengu_vscode_review_upsell: checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
        'tengu_vscode_review_upsell',
      ),
      tengu_vscode_onboarding: checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
        'tengu_vscode_onboarding',
      ),
      // Browser support.
      tengu_quiet_fern: getFeatureValue_CACHED_MAY_BE_STALE(
        'tengu_quiet_fern',
        false,
      ),
      // In-band OAuth via claude_authenticate (vs. extension-native PKCE).
      tengu_vscode_cc_auth: getFeatureValue_CACHED_MAY_BE_STALE(
        'tengu_vscode_cc_auth',
        false,
      ),
    }
    // Tri-state: 'enabled' | 'disabled' | 'opt-in'. Omit if unknown so VSCode
    // fails closed (treats absent as 'disabled').
    const autoModeState = readAutoModeEnabledState()
// 三态只在「读到了合法值」时才放进 gates；读不到就整条键都不带。
//
// VSCode 那边把「缺键」当 'disabled' —— 所以 GrowthBook 还没加载完、
// 或者值被写坏的那段时间里，自动模式是**关**的。方向是 fail-closed。
//
// 这里能看出一个约定：跨进程传配置时，「值缺失」比「值等于默认值」携带更多信息。
// 如果这里偷懒写成 `?? 'disabled'`，VSCode 就永远分不清「真的关了」和「不知道」。
    if (autoModeState !== undefined) {
      gates.tengu_auto_mode_state = autoModeState
    }
    void client.client.notification({
      method: 'experiment_gates',
      params: { gates },
    })
// 这条 notification 没有 .catch，而上面 file_updated 那条有。
//
// client 已断开时这里会产生未处理的 rejection。它发生在启动阶段，通常被别的
// 初始化错误盖住；但在「重连后再次 setup」的路径上，它是真实存在的风险。
// 一处有 catch、一处没有 —— 这类不一致几乎总是不小心留下的，不是设计。
  }
}
