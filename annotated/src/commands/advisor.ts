// /advisor 命令的类型与工具导入。
import type { Command } from '../commands.js'
import type { LocalCommandCall } from '../types/command.js'
import {
  canUserConfigureAdvisor,
  isValidAdvisorModel,
  modelSupportsAdvisor,
} from '../utils/advisor.js'
import {
  getDefaultMainLoopModelSetting,
  normalizeModelStringForAPI,
  parseUserSpecifiedModel,
} from '../utils/model/model.js'
import { validateModel } from '../utils/model/validateModel.js'
import { updateSettingsForSource } from '../utils/settings/settings.js'

// call：/advisor 本地处理函数，配置顾问模型。
const call: LocalCommandCall = async (args, context) => {
  const arg = args.trim().toLowerCase()
// 先解析参数并拿到当前主循环模型作为基线。
  const baseModel = parseUserSpecifiedModel(
    context.getAppState().mainLoopModel ?? getDefaultMainLoopModelSetting(),
  )

  if (!arg) {
// 无参数时展示当前 advisor 状态或提示如何开启。
    const current = context.getAppState().advisorModel
    if (!current) {
      return {
        type: 'text',
        value:
          'Advisor: not set\nUse "/advisor <model>" to enable (e.g. "/advisor opus").',
      }
    }
    if (!modelSupportsAdvisor(baseModel)) {
// 基础模型不支持 advisor 时提示该模型处于非激活。
      return {
        type: 'text',
        value: `Advisor: ${current} (inactive)\nThe current model (${baseModel}) does not support advisors.`,
      }
    }
    return {
      type: 'text',
      value: `Advisor: ${current}\nUse "/advisor unset" to disable or "/advisor <model>" to change.`,
    }
  }

  if (arg === 'unset' || arg === 'off') {
// 输入 unset/off 则清除 advisor 设置。
    const prev = context.getAppState().advisorModel
    context.setAppState(s => {
      if (s.advisorModel === undefined) return s
      return { ...s, advisorModel: undefined }
    })
    updateSettingsForSource('userSettings', { advisorModel: undefined })
    return {
      type: 'text',
      value: prev
        ? `Advisor disabled (was ${prev}).`
        : 'Advisor already unset.',
    }
  }

  const normalizedModel = normalizeModelStringForAPI(arg)
  const resolvedModel = parseUserSpecifiedModel(arg)
  const { valid, error } = await validateModel(resolvedModel)
// 校验用户输入的目标模型是否合法可用。
  if (!valid) {
    return {
      type: 'text',
      value: error
        ? `Invalid advisor model: ${error}`
        : `Unknown model: ${arg} (${resolvedModel})`,
    }
  }

  if (!isValidAdvisorModel(resolvedModel)) {
// 不是合法的 advisor 模型则拒绝设置。
    return {
      type: 'text',
      value: `The model ${arg} (${resolvedModel}) cannot be used as an advisor`,
    }
  }

  context.setAppState(s => {
// 写入 advisorModel 到应用状态与用户设置。
    if (s.advisorModel === normalizedModel) return s
    return { ...s, advisorModel: normalizedModel }
  })
  updateSettingsForSource('userSettings', { advisorModel: normalizedModel })

  if (!modelSupportsAdvisor(baseModel)) {
// 若基础模型不支持，设置成功仍附提醒。
    return {
      type: 'text',
      value: `Advisor set to ${normalizedModel}.\nNote: Your current model (${baseModel}) does not support advisors. Switch to a supported model to use the advisor.`,
    }
  }

  return {
    type: 'text',
    value: `Advisor set to ${normalizedModel}.`,
  }
}

// advisor 命令定义对象，隐藏当且仅当用户不可配置。
const advisor = {
  type: 'local',
  name: 'advisor',
  description: 'Configure the advisor model',
  argumentHint: '[<model>|off]',
  isEnabled: () => canUserConfigureAdvisor(),
  get isHidden() {
    return !canUserConfigureAdvisor()
  },
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
// 懒加载只导出 call，未使用时不开销。
} satisfies Command

export default advisor
