import { feature } from 'bun:bundle'
// 伙伴（Companion）开场文案与附件构造：提供一段角色说明，并生成一个只在首次为该伙伴出现时插入的 companion_intro 附件。
import type { Message } from '../types/message.js'
import type { Attachment } from '../utils/attachments.js'
import { getGlobalConfig } from '../utils/config.js'
import { getCompanion } from './companion.js'

export function companionIntroText(name: string, species: string): string {
// 构造给模型的系统级文案：说明有个小生物坐在输入框旁，用户直呼其名时由它应答，模型要让位。
  return `# Companion

A small ${species} named ${name} sits beside the user's input box and occasionally comments in a speech bubble. You're not ${name} — it's a separate watcher.

When the user addresses ${name} directly (by name), its bubble will answer. Your job in that moment is to stay out of the way: respond in ONE line or less, or just answer any part of the message meant for you. Don't explain that you're not ${name} — they know. Don't narrate what ${name} might say — the bubble handles that.`
}

export function getCompanionIntroAttachment(
// 附件构造入口：未启用 BUDDY 或伙伴被静音则直接返回空。
  messages: Message[] | undefined,
): Attachment[] {
  if (!feature('BUDDY')) return []
// 构建期未启用 BUDDY 直接返回空数组。
  const companion = getCompanion()
  if (!companion || getGlobalConfig().companionMuted) return []

  // Skip if already announced for this companion.
// 遍历已有消息，若该伙伴已介绍过则不再重复插入。
  for (const msg of messages ?? []) {
    if (msg.type !== 'attachment') continue
    if (msg.attachment.type !== 'companion_intro') continue
    if (msg.attachment.name === companion.name) return []
  }

  return [
// 返回包含 name/species 的 companion_intro 附件。
    {
      type: 'companion_intro',
      name: companion.name,
      species: companion.species,
    },
  ]
}
