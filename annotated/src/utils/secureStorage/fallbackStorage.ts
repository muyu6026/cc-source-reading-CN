// 安全存储的回退封装：优先用主存储，主存储读取/写入失败时再落到备用存储，兼顾可用性与迁移。
import type { SecureStorage, SecureStorageData } from './types.js'

/**
 * Creates a fallback storage that tries to use the primary storage first,
 * and if that fails, falls back to the secondary storage
 */
// 模块文档：createFallbackStorage 先尝试主存储，失败则回退到备用存储，用于多后端凭据容错。
// 工厂函数：接收 primary 与 secondary 两个 SecureStorage，返回一个组合后的 SecureStorage 对象。
export function createFallbackStorage(
  primary: SecureStorage,
  secondary: SecureStorage,
): SecureStorage {
  return {
    name: `${primary.name}-with-${secondary.name}-fallback`,
    read(): SecureStorageData {
// 同步读取：主存储返回非空即用主；否则回退备用，再没有则返回空对象。
      const result = primary.read()
      if (result !== null && result !== undefined) {
        return result
      }
      return secondary.read() || {}
    },
    async readAsync(): Promise<SecureStorageData | null> {
// 异步读取：与同步版同策略，只是走 readAsync。
      const result = await primary.readAsync()
      if (result !== null && result !== undefined) {
        return result
      }
      return (await secondary.readAsync()) || {}
    },
    update(data: SecureStorageData): { success: boolean; warning?: string } {
// 写入：先写主存储；主成功时若此前主是空的（首次迁移到主），顺手删掉备用，避免主机与容器共享 .claude 时凭据重复。
      // Capture state before update
      const primaryDataBefore = primary.read()

      const result = primary.update(data)

      if (result.success) {
        // Delete secondary when migrating to primary for the first time
        // This preserves credentials when sharing .claude between host and containers
        // See: https://github.com/anthropics/claude-code/issues/1414
        if (primaryDataBefore === null) {
          secondary.delete()
        }
        return result
      }

      const fallbackResult = secondary.update(data)

      if (fallbackResult.success) {
// 主写入失败时改写备用；但主可能还留着旧的合法条目，read() 又优先主，会盖掉刚写进备用的新数据（例如已被服务端轮转的刷新令牌，导致 /login 死循环），因此把主删掉。
        // Primary write failed but primary may still hold an *older* valid
        // entry. read() prefers primary whenever it returns non-null, so that
        // stale entry would shadow the fresh data we just wrote to secondary —
        // e.g. a refresh token the server has already rotated away, causing a
        // /login loop (#30337). Best-effort delete; if this also fails the
        // user's keychain is in a bad state we can't fix from here.
        if (primaryDataBefore !== null) {
          primary.delete()
        }
        return {
          success: true,
          warning: fallbackResult.warning,
        }
      }

      return { success: false }
    },
    delete(): boolean {
// 删除：主备任一删除成功即视为成功。
      const primarySuccess = primary.delete()
      const secondarySuccess = secondary.delete()

      return primarySuccess || secondarySuccess
    },
  }
}
// 工厂函数收尾：返回的回退存储对象实现了 name/read/readAsync/update/delete 五个方法，覆盖存储读写全链路。
