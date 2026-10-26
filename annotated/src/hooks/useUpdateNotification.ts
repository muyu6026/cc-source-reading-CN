import { useState } from 'react'
import { major, minor, patch } from 'semver'

export function getSemverPart(version: string): string {
// 把版本号压成 major.minor.patch 三段，忽略预发布/构建号，用于「是否该弹更新提示」的去重比较。
  return `${major(version, { loose: true })}.${minor(version, { loose: true })}.${patch(version, { loose: true })}`
}

export function shouldShowUpdateNotification(
  updatedVersion: string,
  lastNotifiedSemver: string | null,
): boolean {
  const updatedSemver = getSemverPart(updatedVersion)
  return updatedSemver !== lastNotifiedSemver
}

export function useUpdateNotification(
  updatedVersion: string | null | undefined,
  initialVersion: string = MACRO.VERSION,
): string | null {
  const [lastNotifiedSemver, setLastNotifiedSemver] = useState<string | null>(
    () => getSemverPart(initialVersion),
  )
// 用惰性初始化把已通知版本记成初始版本的 semver，避免首屏误弹。

  if (!updatedVersion) {
    return null
  }

  const updatedSemver = getSemverPart(updatedVersion)
  if (updatedSemver !== lastNotifiedSemver) {
// 版本 semver 变了就更新已通知记录并 return 新版本；否则返回 null 不弹。
    setLastNotifiedSemver(updatedSemver)
    return updatedSemver
  }
  return null
}
