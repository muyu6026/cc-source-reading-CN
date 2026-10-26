import { useEffect, useRef } from 'react'
import {
  type FileHistorySnapshot,
  type FileHistoryState,
  fileHistoryEnabled,
  fileHistoryRestoreStateFromLog,
} from '../utils/fileHistory.js'

export function useFileHistorySnapshotInit(
  initialFileHistorySnapshots: FileHistorySnapshot[] | undefined,
  fileHistoryState: FileHistoryState,
  onUpdateState: (newState: FileHistoryState) => void,
): void {
// 把启动时传入的文件历史快照一次性灌进内存状态（仅首次），之后由运行期机制接管。
  const initialized = useRef(false)

  useEffect(() => {
    if (!fileHistoryEnabled() || initialized.current) {
// 双保险：功能未开启或已初始化过则跳过，避免重复 restore。
      return
    }
    initialized.current = true
    if (initialFileHistorySnapshots) {
      fileHistoryRestoreStateFromLog(initialFileHistorySnapshots, onUpdateState)
// 有快照才调用 restore 从日志重建状态，并通过 onUpdateState 回调写回。
    }
  }, [fileHistoryState, initialFileHistorySnapshots, onUpdateState])
}
