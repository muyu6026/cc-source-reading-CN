import { chmodSync } from 'fs'
// 明文凭据存储：系统钥匙串不可用时的降级后端，凭据以 JSON 落在配置目录的隐藏文件里。名字叫 plaintext 就是提醒——它不加密。
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { getErrnoCode } from '../errors.js'
import { getFsImplementation } from '../fsOperations.js'
import {
  jsonParse,
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../slowOperations.js'
import type { SecureStorage, SecureStorageData } from './types.js'

function getStoragePath(): { storageDir: string; storagePath: string } {
  const storageDir = getClaudeConfigHomeDir()
  const storageFileName = '.credentials.json'
  return { storageDir, storagePath: join(storageDir, storageFileName) }
}
// 路径每次现算不缓存：配置目录可能因为环境变量在运行期变化（测试里常见），缓存住会指向旧位置。

export const plainTextStorage = {
  name: 'plaintext',
  read(): SecureStorageData | null {
    // sync IO: called from sync context (SecureStorage interface)
    const { storagePath } = getStoragePath()
    try {
      const data = getFsImplementation().readFileSync(storagePath, {
        encoding: 'utf8',
      })
      return jsonParse(data)
    } catch {
      return null
    }
  },
// 读失败一律返回 null：文件不存在、内容损坏、权限不足在调用方看来都是「没有已存凭据」，需要重新登录，报错反而让上层多做一层分支。
  async readAsync(): Promise<SecureStorageData | null> {
    const { storagePath } = getStoragePath()
    try {
      const data = await getFsImplementation().readFile(storagePath, {
        encoding: 'utf8',
      })
      return jsonParse(data)
    } catch {
      return null
    }
  },
// 异步版与同步版逻辑完全一致：接口同时要求两者，而底层文件系统实现提供同步与异步两套入口。
  update(data: SecureStorageData): { success: boolean; warning?: string } {
    // sync IO: called from sync context (SecureStorage interface)
    try {
      const { storageDir, storagePath } = getStoragePath()
      try {
        getFsImplementation().mkdirSync(storageDir)
      } catch (e: unknown) {
        const code = getErrnoCode(e)
        if (code !== 'EEXIST') {
          throw e
        }
      }
// 建目录容忍 EEXIST：并发写时另一个进程可能刚好建好，只有真正的建目录失败才上抛。

      writeFileSync_DEPRECATED(storagePath, jsonStringify(data), {
        encoding: 'utf8',
        flush: false,
      })
      chmodSync(storagePath, 0o600)
// 文件权限收成 0600：只有属主可读写。这是明文存储在安全上唯一能做的补救，绝不能省。
      return {
        success: true,
        warning: 'Warning: Storing credentials in plaintext.',
      }
    } catch {
      return { success: false }
    }
  },
// 成功时带一条 warning：调用方会把它展示给用户，明确告知凭据是明文保存的，让用户自己决定是否继续用这个后端。
  delete(): boolean {
    // sync IO: called from sync context (SecureStorage interface)
    const { storagePath } = getStoragePath()
    try {
      getFsImplementation().unlinkSync(storagePath)
      return true
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      if (code === 'ENOENT') {
        return true
      }
      return false
    }
  },
} satisfies SecureStorage
// 删除把「文件本来就不存在」也算成功：目标状态是「没有凭据」，已达成即成功，与 unlink 抛出的 ENOENT 区分开。
