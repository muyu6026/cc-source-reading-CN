import { getSkillToolCommands } from '../../commands.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
  logEvent,
} from '../../services/analytics/index.js'
import { getCharBudget } from '../../tools/SkillTool/prompt.js'
// 模块总述：会话启动时为每个可用 skill 上报 `tengu_skill_loaded` 事件，用于分析跨会话哪些技能处于可用状态。

/**
 * Logs a tengu_skill_loaded event for each skill available at session startup.
 * This enables analytics on which skills are available across sessions.
 */
// logSkillsLoaded：先取出当前可用技能列表并算好字符预算，再逐个遍历上报，依赖传入的上下文窗口 token 数估算预算。
export async function logSkillsLoaded(
  cwd: string,
  contextWindowTokens: number,
): Promise<void> {
  const skills = await getSkillToolCommands(cwd)
  const skillBudget = getCharBudget(contextWindowTokens)

  for (const skill of skills) {
// 只处理 prompt 类 skill，其余类型直接跳过，避免对非提示型技能无意义地上报。
    if (skill.type !== 'prompt') continue

// logEvent 上报调用：技能名走带 PII 标记的特供列（原始名不进附加字段），来源与加载路径走非代码/非路径标记列。
    logEvent('tengu_skill_loaded', {
      // _PROTO_skill_name routes to the privileged skill_name BQ column.
      // Unredacted names don't go in additional_metadata.
      _PROTO_skill_name:
        skill.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      skill_source:
        skill.source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      skill_loaded_from:
        skill.loadedFrom as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      skill_budget: skillBudget,
      ...(skill.kind && {
        skill_kind:
          skill.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
    })
  }
}
