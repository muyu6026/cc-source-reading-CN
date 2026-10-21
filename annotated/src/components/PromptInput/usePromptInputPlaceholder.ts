// ═══════════════════════════════════════════════════════════════
//  usePromptInputPlaceholder：占位符是一套「优先级裁决」
// ═══════════════════════════════════════════════════════════════
//
//  输入框里那行灰字在不同时刻说不同的话，四档优先级从高到低：
//
//    1. 输入框非空                    → 什么都不显示（用户正在打字，别打扰）
//    2. 正在看某个 teammate 的会话     → 「Message @名字…」
//    3. 队列里有可编辑的排队消息        → 「Press up to edit queued messages」
//    4. 从没提交过 且 建议开启 且 非主动模式 → 一条示例命令
//
//  优先级本身就是设计文档：越靠前越「此刻非说不可」。
//  这种每档一个 early return 的写法，比一串 if/else if 更容易看出顺序。
import { feature } from 'bun:bundle'
import { useMemo } from 'react'
import { useCommandQueue } from 'src/hooks/useCommandQueue.js'
import { useAppState } from 'src/state/AppState.js'
import { getGlobalConfig } from 'src/utils/config.js'
import { getExampleCommandFromCache } from 'src/utils/exampleCommands.js'
import { isQueuedCommandEditable } from 'src/utils/messageQueueManager.js'

// 【条件 require：按构建开关决定这个模块存不存在】
//
//  feature('PROACTIVE') 是打包期的常量。外部构建里这个三元会被折成 null，
//  于是 require 那一支整块消失 —— 连模块都不会被打进产物。
//
//  这和「运行时 if」的区别很重要：
//    运行时 if     → 代码还在包里，只是不执行（能被逆向读出来）
//    构建期 feature → 代码根本不在包里
//
//  代价是：所有引用它的地方都必须写成「可能为 null」的样子。
//  看第 63 行 —— `proactiveModule?.isProactiveActive()` 的问号就是这个代价。
// Dead code elimination: conditional import for proactive mode
/* eslint-disable @typescript-eslint/no-require-imports */
const proactiveModule =
  feature('PROACTIVE') || feature('KAIROS')
    ? require('../../proactive/index.js')
    : null

type Props = {
  input: string
  submitCount: number
  viewingAgentName?: string
}

// 【20 和 3 这两个数字，都带着「为什么是它」】
//
//  MAX_TEAMMATE_NAME_LENGTH = 20：配合下面第 41 行的 `slice(0, 20-3) + '...'`，
//  保证截断后**总长恰好 20**（17 个字符 + 3 个点）。那个 -3 不是随手写的，
//  是「省略号也算宽度」这个事实的体现。
//
//  NUM_TIMES_QUEUE_HINT_SHOWN = 3：同一条提示最多出现 3 次。这是提示类文案的
//  常见额度 —— 第 4 次开始用户已经学会了，再显示就是噪音。
//
//  这类常量一定要在名字里写清单位和语义（SHOWN 而不是 LIMIT），
//  否则后来的人不知道该拿它比 >= 还是 >。
const NUM_TIMES_QUEUE_HINT_SHOWN = 3
const MAX_TEAMMATE_NAME_LENGTH = 20

export function usePromptInputPlaceholder({
  input,
  submitCount,
  viewingAgentName,
}: Props): string | undefined {
  const queuedCommands = useCommandQueue()
  const promptSuggestionEnabled = useAppState(s => s.promptSuggestionEnabled)
// 【整个函数体就是一个 useMemo，而且没有 else 分支】
//
//  每一档都是「满足就 return」，全都不满足就自然落到函数末尾返回 undefined。
//  undefined 在 Ink 的 TextInput 里表示「不显示占位符」，所以不需要显式写 return undefined。
//
//  依赖数组（第 67-73 行）列了 5 项，但函数体里其实还读了 getGlobalConfig() 和
//  两个模块常量。这是可以接受的：前者是「读时生效」的全局开关（配合同目录 utils.ts
//  里 isVimModeEnabled 一样的策略），后两个是编译期常量，永远不会变。
  const placeholder = useMemo(() => {
    if (input !== '') {
      return
    }

    // Show teammate hint when viewing teammate
    if (viewingAgentName) {
      const displayName =
        viewingAgentName.length > MAX_TEAMMATE_NAME_LENGTH
          ? viewingAgentName.slice(0, MAX_TEAMMATE_NAME_LENGTH - 3) + '...'
          : viewingAgentName
      return `Message @${displayName}…`
    }

    // Show queue hint if user has not seen it yet.
    // Only count user-editable commands — task-notification and isMeta
    // are hidden from the prompt area (see PromptInputQueuedCommands).
// 【队列提示的两个条件，第二个是「额度」不是「开关」】
//
//  第 50 行：队列里**至少有一条用户能编辑的**消息。
//  注意用的是 isQueuedCommandEditable 而不是 length > 0 —— 因为
//  task-notification 和 isMeta 这两类命令不会显示在输入区上方
//  （见 PromptInputQueuedCommands），提示用户「按上键编辑」却没有可编辑的东西，
//  就是把用户骗去按一个没有反应的键。
//
//  第 51-52 行：已显示次数 < 3。这个计数由别处递增（本文件只读），
//  用 `|| 0` 兜住「老配置里没这个字段」的情况。
//
//  **判断可见性时用的是「能编辑」，判断数量时用的是「能编辑」——
//  两处必须同一个判据**，否则会出现「提示说有一条，上键却没反应」。
    if (
      queuedCommands.some(isQueuedCommandEditable) &&
      (getGlobalConfig().queuedCommandUpHintCount || 0) <
        NUM_TIMES_QUEUE_HINT_SHOWN
    ) {
      return 'Press up to edit queued messages'
    }

    // Show example command if user has not submitted yet and suggestions are enabled.
    // Skip in proactive mode — the model drives the conversation so onboarding
    // examples are irrelevant and block prompt suggestions from showing.
// 【示例命令的三重门槛，第三重最容易被忽略】
//
//  submitCount < 1        —— 只在「用户一次都没提交过」时显示（新手引导）
//  promptSuggestionEnabled —— 用户可以在设置里关掉
//  !proactiveModule?.…()   —— 主动模式下模型自己会开口说话，新手引导没意义，
//                             而且会**挡住**真正的 prompt suggestion
//
//  第三条的两个理由不一样：前一个是「不值得说」，后一个是「会遮蔽更重要的东西」。
//  遇到「为什么要多这个条件」时，答案常常是后者 —— 不是它本身不好，
//  而是它占了别人的位置。
    if (
      submitCount < 1 &&
      promptSuggestionEnabled &&
      !proactiveModule?.isProactiveActive()
    ) {
      return getExampleCommandFromCache()
    }
  }, [
    input,
    queuedCommands,
    submitCount,
    promptSuggestionEnabled,
    viewingAgentName,
  ])

  return placeholder
}
