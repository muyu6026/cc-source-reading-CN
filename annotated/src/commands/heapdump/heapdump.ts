// 导入堆快照服务，封装生成堆转储与诊断文件的逻辑。
import { performHeapDump } from '../../utils/heapDumpService.js'

export async function call(): Promise<{ type: 'text'; value: string }> {
// 命令入口函数，返回纯文本结果对象。
  const result = await performHeapDump()

  if (!result.success) {
// 堆快照失败时返回带错误信息的文本。
    return {
      type: 'text',
      value: `Failed to create heap dump: ${result.error}`,
    }
  }

  return {
    type: 'text',
    value: `${result.heapPath}\n${result.diagPath}`,
  }
// 成功时一并返回堆路径与诊断文件路径。
}
