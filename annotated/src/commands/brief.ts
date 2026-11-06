import { feature } from 'bun:bundle'
import { z } from 'zod/v4'
import { getKairosActive, setUserMsgOptIn } from '../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import type { ToolUseContext } from '../Tool.js'
import { isBriefEntitled } from '../tools/BriefTool/BriefTool.js'
import { BRIEF_TOOL_NAME } from '../tools/BriefTool/prompt.js'
import type {
  Command,
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../types/command.js'
import { lazySchema } from '../utils/lazySchema.js'

// Zod guards against fat-fingered GB pushes (same pattern as pollConfig.ts /
// cronScheduler.ts). A malformed config falls back to DEFAULT_BRIEF_CONFIG
// entirely rather than being partially trusted.
// 配置结构先用校验器兜一道：灰度值是人手推上去的，拼错一个字段名就会让整条命令的行为变得莫名其妙
const briefConfigSchema = lazySchema(() =>
  z.object({
    enable_slash_command: z.boolean(),
  }),
)
type BriefConfig = z.infer<ReturnType<typeof briefConfigSchema>>

// 默认关闭：新命令的可见性必须先由灰度显式打开
const DEFAULT_BRIEF_CONFIG: BriefConfig = {
  enable_slash_command: false,
}

// 这道门没有有效期，与工具可用性那道不同：它只控制命令是否可见，不是一个能随时关掉的开关
// No TTL — this gate controls slash-command *visibility*, not a kill switch.
// CACHED_MAY_BE_STALE still has one background-update flip (first call kicks
// off fetch; second call sees fresh value), but no additional flips after that.
// The tool-availability gate (tengu_kairos_brief in isBriefEnabled) keeps its
// 5-min TTL because that one IS a kill switch.
// 解析失败整体退回默认值，不做部分信任：半份配置比没有配置更难诊断
function getBriefConfig(): BriefConfig {
  const raw = getFeatureValue_CACHED_MAY_BE_STALE<unknown>(
    'tengu_kairos_brief_config',
    DEFAULT_BRIEF_CONFIG,
  )
  const parsed = briefConfigSchema().safeParse(raw)
  return parsed.success ? parsed.data : DEFAULT_BRIEF_CONFIG
}

// 命令对象本身是常量：可见性判断在 isEnabled 里，加载逻辑在 load 里，两件事分开
const brief = {
  type: 'local-jsx',
  name: 'brief',
  description: 'Toggle brief-only mode',
  isEnabled: () => {
// 两个构建期特性任一打开才算候选：都没开时这段代码根本不会进包
    if (feature('KAIROS') || feature('KAIROS_BRIEF')) {
      return getBriefConfig().enable_slash_command
    }
    return false
  },
// 立即执行：这个命令没有需要等待的副作用，不必先给一个计划界面
  immediate: true,
  load: () =>
    Promise.resolve({
      async call(
        onDone: LocalJSXCommandOnDone,
        context: ToolUseContext & LocalJSXCommandContext,
      ): Promise<React.ReactNode> {
// 读当前值再取反：命令是无状态的，状态只存在应用状态里
        const current = context.getAppState().isBriefOnly
        const newState = !current

        // Entitlement check only gates the on-transition — off is always
        // allowed so a user whose GB gate flipped mid-session isn't stuck.
// 只有「开启」要权限校验：关闭始终允许，否则灰度在会话中途翻转后用户会被卡在开着的状态里
        if (newState && !isBriefEntitled()) {
          logEvent('tengu_brief_mode_toggled', {
            enabled: false,
            gated: true,
            source:
              'slash_command' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
// 被拦住也要上报事件并给出可读原因：用户看不到「为什么没反应」比看到拒绝更糟
          onDone('Brief tool is not enabled for your account', {
            display: 'system',
          })
          return null
        }

        // Two-way: userMsgOptIn tracks isBriefOnly so the tool is available
        // exactly when brief mode is on. This invalidates prompt cache on
        // each toggle (tool list changes), but a stale tool list is worse —
        // when /brief is enabled mid-session the model was previously left
        // without the tool, emitting plain text the filter hides.
// 两处状态必须同步：工具是否在列表里由这个标志决定，只改界面状态会让模型拿到错的工具清单
        setUserMsgOptIn(newState)

// 设置状态也做幂等判断：与目标一致就返回原对象，省掉一次重渲染
        context.setAppState(prev => {
          if (prev.isBriefOnly === newState) return prev
          return { ...prev, isBriefOnly: newState }
        })

// 成功路径的事件字段与上面被拦住那次对齐，只有 gated 为假：便于对照统计
        logEvent('tengu_brief_mode_toggled', {
          enabled: newState,
          gated: false,
          source:
            'slash_command' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })

        // The tool list change alone isn't a strong enough signal mid-session
        // (model may keep emitting plain text from inertia, or keep calling a
        // tool that just vanished). Inject an explicit reminder into the next
        // turn's context so the transition is unambiguous.
        // Skip when Kairos is active: isBriefEnabled() short-circuits on
        // getKairosActive() so the tool never actually leaves the list, and
        // the Kairos system prompt already mandates SendUserMessage.
        // Inline <system-reminder> wrap — importing wrapInSystemReminder from
        // utils/messages.ts pulls constants/xml.ts into the bridge SDK bundle
        // via this module's import chain, tripping the excluded-strings check.
// Kairos 激活时不注入提醒：那时工具根本不会离开列表，提醒反而与系统提示词重复
        const metaMessages = getKairosActive()
          ? undefined
          : [
              `<system-reminder>\n${
                newState
                  ? `Brief mode is now enabled. Use the ${BRIEF_TOOL_NAME} tool for all user-facing output — plain text outside it is hidden from the user's view.`
                  : `Brief mode is now disabled. The ${BRIEF_TOOL_NAME} tool is no longer available — reply with plain text.`
              }\n</system-reminder>`,
            ]

// 结果与附带消息一起交回：提醒必须挂在下一轮上下文里，只改状态模型不会知道
        onDone(
          newState ? 'Brief-only mode enabled' : 'Brief-only mode disabled',
          { display: 'system', metaMessages },
        )
        return null
      },
    }),
} satisfies Command

export default brief
