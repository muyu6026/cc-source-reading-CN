import type { LocalCommandResult } from '../../types/command.js'
// 引入本地命令结果类型，以及变更日志读取、存储与格式化相关工具。
import {
  CHANGELOG_URL,
  fetchAndStoreChangelog,
  getAllReleaseNotes,
  getStoredChangelog,
} from '../../utils/releaseNotes.js'

function formatReleaseNotes(notes: Array<[string, string[]]>): string {
// 将版本号与要点列表格式化为可读文本：每个版本一个标题块，要点以 · 前缀逐行列出。
  return notes
    .map(([version, notes]) => {
      const header = `Version ${version}:`
      const bulletPoints = notes.map(note => `· ${note}`).join('\n')
      return `${header}\n${bulletPoints}`
    })
    .join('\n\n')
}

export async function call(): Promise<LocalCommandResult> {
// 命令主入口：优先尝试拉取最新变更日志，失败则回退到本地缓存。
  // Try to fetch the latest changelog with a 500ms timeout
// 注释：尝试以 500ms 超时拉取最新变更日志。
  let freshNotes: Array<[string, string[]]> = []

  try {
// 进入试拉取分支，整体包在 try 中。
    const timeoutPromise = new Promise<void>((_, reject) => {
// 构造 500ms 超时 Promise：超时则 reject。
      setTimeout(rej => rej(new Error('Timeout')), 500, reject)
    })

    await Promise.race([fetchAndStoreChangelog(), timeoutPromise])
// 竞速执行「拉取并存储」与「超时」，谁先完成用谁。
    freshNotes = getAllReleaseNotes(await getStoredChangelog())
// 拉取成功后从本地存储读出全部变更日志。
  } catch {
    // Either fetch failed or timed out - just use cached notes
  }
// 捕获异常：拉取失败或超时都静默忽略，改用缓存。

  // If we have fresh notes from the quick fetch, use those
// 若快速拉取到新日志，优先返回格式化结果。
  if (freshNotes.length > 0) {
    return { type: 'text', value: formatReleaseNotes(freshNotes) }
  }

  // Otherwise check cached notes
// 否则读取缓存的变更日志。
  const cachedNotes = getAllReleaseNotes(await getStoredChangelog())
  if (cachedNotes.length > 0) {
    return { type: 'text', value: formatReleaseNotes(cachedNotes) }
  }

  // Nothing available, show link
// 若两者皆空，返回变更日志外链提示用户自行查看。
  return {
    type: 'text',
    value: `See the full changelog at: ${CHANGELOG_URL}`,
  }
}
