import type { StructuredPatchHunk } from 'diff'
import { useEffect, useMemo, useState } from 'react'
import {
  fetchGitDiff,
  fetchGitDiffHunks,
  type GitDiffResult,
  type GitDiffStats,
} from '../utils/gitDiff.js'

const MAX_LINES_PER_FILE = 400
// 单文件超过 400 行的 diff 视为过大，触发截断标记。

export type DiffFile = {
  path: string
  linesAdded: number
  linesRemoved: number
  isBinary: boolean
  isLargeFile: boolean
  isTruncated: boolean
  isNewFile?: boolean
  isUntracked?: boolean
}

export type DiffData = {
  stats: GitDiffStats | null
  files: DiffFile[]
  hunks: Map<string, StructuredPatchHunk[]>
  loading: boolean
}

/**
 * Hook to fetch current git diff data on demand.
 * Fetches both stats and hunks when component mounts.
 */
export function useDiffData(): DiffData {
// 按需获取 git diff 数据（stats + hunks），挂载时一次性拉取。
  const [diffResult, setDiffResult] = useState<GitDiffResult | null>(null)
  const [hunks, setHunks] = useState<Map<string, StructuredPatchHunk[]>>(
    new Map(),
  )
  const [loading, setLoading] = useState(true)

  // Fetch diff data on mount
  useEffect(() => {
// 挂载并行拉取 stats 与 hunks 两份数据，缩短首屏等待。
    let cancelled = false

    async function loadDiffData() {
      try {
        // Fetch both stats and hunks
        const [statsResult, hunksResult] = await Promise.all([
          fetchGitDiff(),
          fetchGitDiffHunks(),
        ])

        if (!cancelled) {
          setDiffResult(statsResult)
          setHunks(hunksResult)
          setLoading(false)
        }
      } catch (_error) {
        if (!cancelled) {
          setDiffResult(null)
          setHunks(new Map())
          setLoading(false)
        }
      }
    }

    void loadDiffData()

    return () => {
// 卸载时置 cancelled，防止卸载后的 setState 警告。
      cancelled = true
    }
  }, [])

  return useMemo(() => {
    if (!diffResult) {
      return { stats: null, files: [], hunks: new Map(), loading }
    }

    const { stats, perFileStats } = diffResult
    const files: DiffFile[] = []

    // Iterate over perFileStats to get all files including large/skipped ones
    for (const [path, fileStats] of perFileStats) {
      const fileHunks = hunks.get(path)
      const isUntracked = fileStats.isUntracked ?? false

      // Detect large file (in perFileStats but not in hunks, and not binary/untracked)
      const isLargeFile = !fileStats.isBinary && !isUntracked && !fileHunks
// large file 判定：出现在 perFileStats 却不在 hunks 里（且非二进制/未跟踪），
// 说明文件过大被跳过 hunk 提取。

      // Detect truncated file (total > limit means we truncated)
      const totalLines = fileStats.added + fileStats.removed
      const isTruncated =
        !isLargeFile && !fileStats.isBinary && totalLines > MAX_LINES_PER_FILE
// truncated 判定：非大文件、非二进制，且增删总行数超过 400 上限。

      files.push({
        path,
        linesAdded: fileStats.added,
        linesRemoved: fileStats.removed,
        isBinary: fileStats.isBinary,
        isLargeFile,
        isTruncated,
        isUntracked,
      })
    }

    files.sort((a, b) => a.path.localeCompare(b.path))

    return { stats, files, hunks, loading: false }
  }, [diffResult, hunks, loading])
}
