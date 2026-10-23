import { randomUUID } from 'crypto'
import { basename } from 'path'
import { useEffect, useMemo, useRef, useState } from 'react'
import { logEvent } from 'src/services/analytics/index.js'
import { readFileSync } from 'src/utils/fileRead.js'
import { expandPath } from 'src/utils/path.js'
import type { PermissionOption } from '../components/permissions/FilePermissionDialog/permissionOptions.js'
import type {
  MCPServerConnection,
  McpSSEIDEServerConfig,
  McpWebSocketIDEServerConfig,
} from '../services/mcp/types.js'
import type { ToolUseContext } from '../Tool.js'
import type { FileEdit } from '../tools/FileEditTool/types.js'
import {
  getEditsForPatch,
  getPatchForEdits,
} from '../tools/FileEditTool/utils.js'
import { getGlobalConfig } from '../utils/config.js'
import { getPatchFromContents } from '../utils/diff.js'
import { isENOENT } from '../utils/errors.js'
import {
  callIdeRpc,
  getConnectedIdeClient,
  getConnectedIdeName,
  hasAccessToIDEExtensionDiffFeature,
} from '../utils/ide.js'
import { WindowsToWSLConverter } from '../utils/idePathConversion.js'
import { logError } from '../utils/log.js'
import { getPlatform } from '../utils/platform.js'

type Props = {
  onChange(
    option: PermissionOption,
    input: {
      file_path: string
      edits: FileEdit[]
    },
  ): void
  toolUseContext: ToolUseContext
  filePath: string
  edits: FileEdit[]
  editMode: 'single' | 'multiple'
}

// 【文件定位】把「在 IDE 里看 diff」接进文件编辑的权限流。用户在 IDE 扩展里查看/修改/保存 diff，终端这边的权限选项随之变成接受或拒绝。核心事实：这个 hook 不等待用户在终端做选择——它把「IDE 里发生的事」翻译成 onChange 的 accept-once/reject。
export function useDiffInIDE({
  onChange,
  toolUseContext,
  filePath,
  edits,
  editMode,
}: Props): {
  closeTabInIDE: () => void
  showingDiffInIDE: boolean
  ideName: string
  hasError: boolean
} {
  const isUnmounted = useRef(false)
  const [hasError, setHasError] = useState(false)

  const sha = useMemo(() => randomUUID().slice(0, 6), [])
// 6 位随机 sha 拼进 tab 名，让同一文件的多次 diff 在 IDE 里互不覆盖（每个 diff 一个独立标签页）。
  const tabName = useMemo(
    () => `✻ [Claude Code] ${basename(filePath)} (${sha}) ⧉`,
    [filePath, sha],
  )
// tab 名格式：✻ [Claude Code] 文件名 (sha) ⧉。✻ 是 Claude 的星号标记，⧉ 是「外链」符号暗示这是外部工具的标签。

  const shouldShowDiffInIDE =
    hasAccessToIDEExtensionDiffFeature(toolUseContext.options.mcpClients) &&
    getGlobalConfig().diffTool === 'auto' &&
    // Diffs should only be for file edits.
    // File writes may come through here but are not supported for diffs.
    !filePath.endsWith('.ipynb')
// 三个显示条件全满足才在 IDE 里开 diff：IDE 扩展有 diff 功能（hasAccessToIDEExtensionDiffFeature）、用户配置 diffTool === 'auto'、且不是 .ipynb 文件。文件写入也可能流经这里但不支持 diff，所以排除 notebook。

  const ideName =
    getConnectedIdeName(toolUseContext.options.mcpClients) ?? 'IDE'
// ideName 从已连接的 IDE 客户端名取，取不到回退 'IDE'——对话框里给用户看「在 VS Code 中查看」。

  async function showDiff(): Promise<void> {
    if (!shouldShowDiffInIDE) {
      return
    }

    try {
      logEvent('tengu_ext_will_show_diff', {})

      const { oldContent, newContent } = await showDiffInIDE(
        filePath,
        edits,
        toolUseContext,
        tabName,
      )
// showDiffInIDE 是真正的重活：读旧文件、计算打补丁后的内容、调 openDiff RPC、阻塞等用户在 IDE 里的动作。这里 await 它，返回时用户已经在 IDE 里做完了选择。
      // Skip if component has been unmounted
      if (isUnmounted.current) {
        return
      }
// 组件卸载后不继续——异步流程可能比 React 组件活得更久，往已卸载组件的 setState 是 React 经典警告来源。

      logEvent('tengu_ext_diff_accepted', {})

      const newEdits = computeEditsFromContents(
        filePath,
        oldContent,
        newContent,
        editMode,
      )

      if (newEdits.length === 0) {
// newEdits.length === 0 意味着用户在 IDE 里把改动全撤了（或原样保存）——当作拒绝处理。注意这里要主动关标签：注释说「'no' 不再自动关」，所以拒绝路径得自己调 closeTabInIDE。
        // No changes -- edit was rejected (eg. reverted)
        logEvent('tengu_ext_diff_rejected', {})
        // We close the tab here because 'no' no longer auto-closes
        const ideClient = getConnectedIdeClient(
          toolUseContext.options.mcpClients,
        )
        if (ideClient) {
          // Close the tab in the IDE
          await closeTabInIDE(tabName, ideClient)
        }
        onChange(
          { type: 'reject' },
          {
            file_path: filePath,
            edits: edits,
          },
        )
        return
      }

      // File was modified - edit was accepted
      onChange(
        { type: 'accept-once' },
        {
          file_path: filePath,
          edits: newEdits,
        },
      )
    } catch (error) {
      logError(error as Error)
      setHasError(true)
    }
// catch 兜底：RPC 失败、IDE 崩了、用户直接关了 IDE 都走这里。setHasError(true) 让 showingDiffInIDE 转 false，终端退回常规权限对话框——IDE 路径失败不能卡住工具调用。
  }

  useEffect(() => {
    void showDiff()

    // Set flag on unmount
    return () => {
      isUnmounted.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
// 空 deps 只在挂载时跑一次。卸载时置 isUnmounted 标志（不是 setState，避免卸载后调 setState）。

  return {
    closeTabInIDE() {
      const ideClient = getConnectedIdeClient(toolUseContext.options.mcpClients)

      if (!ideClient) {
        return Promise.resolve()
      }

      return closeTabInIDE(tabName, ideClient)
    },
    showingDiffInIDE: shouldShowDiffInIDE && !hasError,
// showingDiffInIDE 对外暴露 = 条件满足且无错误。调用方（权限对话框）据此决定渲染 IDE 提示还是常规选项。
    ideName: ideName,
    hasError,
  }
}

/**
 * Re-computes the edits from the old and new contents. This is necessary
 * to apply any edits the user may have made to the new contents.
 */
export function computeEditsFromContents(
  filePath: string,
  oldContent: string,
  newContent: string,
  editMode: 'single' | 'multiple',
): FileEdit[] {
  // Use unformatted patches, otherwise the edits will be formatted.
  const singleHunk = editMode === 'single'
  const patch = getPatchFromContents({
    filePath,
    oldContent,
    newContent,
    singleHunk,
  })

  if (patch.length === 0) {
    return []
  }

  // For single edit mode, verify we only got one hunk
  if (singleHunk && patch.length > 1) {
// single 模式却拿到多个 hunk 只记日志不抛错——下游 getEditsForPatch 照样吃，容错优先。
    logError(
      new Error(
        `Unexpected number of hunks: ${patch.length}. Expected 1 hunk.`,
      ),
    )
  }

  // Re-compute the edits to match the patch
  return getEditsForPatch(patch)
// computeEditsFromContents 把「用户在 IDE 里看到的」重新翻译成 FileEdit[]。关键点：用户可能在 IDE 里改了新内容（手改补丁内容、格式化、保存），不能拿原始 edits 直接用——必须用 unformatted patch（singleHunk 参数控制），否则二次应用会把 IDE 里的格式改动也吃进去。
}

/**
 * Done if:
 *
 * 1. Tab is closed in IDE
 * 2. Tab is saved in IDE (we then close the tab)
 * 3. User selected an option in IDE
 * 4. User selected an option in terminal (or hit esc)
 *
 * Resolves with the new file content.
 *
 * TODO: Time out after 5 mins of inactivity?
 * TODO: Update auto-approval UI when IDE exits
 * TODO: Close the IDE tab when the approval prompt is unmounted
 */
// 【showDiffInIDE 生命周期】四种结束路径：1) 用户在 IDE 关掉标签；2) 用户在 IDE 保存（保存后由本端关标签）；3) 用户在 IDE 里选了选项；4) 用户在终端选选项或按 esc。后两条 abortController 和 cleanup 兜底。三个 TODO 都是已知缺口：5 分钟无活动超时、IDE 退出时更新自动批准 UI、权限提示卸载时关 IDE 标签。
async function showDiffInIDE(
  file_path: string,
  edits: FileEdit[],
  toolUseContext: ToolUseContext,
  tabName: string,
): Promise<{ oldContent: string; newContent: string }> {
  let isCleanedUp = false

  const oldFilePath = expandPath(file_path)
  let oldContent = ''
  try {
    oldContent = readFileSync(oldFilePath)
  } catch (e: unknown) {
    if (!isENOENT(e)) {
      throw e
    }
  }
// 旧文件可能不存在（新文件创建场景）——ENOENT 吞掉当空内容，其他错误照抛。

  async function cleanup() {
    // Careful to avoid race conditions, since this
    // function can be called from multiple places.
    if (isCleanedUp) {
      return
    }
    isCleanedUp = true

    // Don't fail if this fails
    try {
      await closeTabInIDE(tabName, ideClient)
    } catch (e) {
      logError(e as Error)
    }

    process.off('beforeExit', cleanup)
    toolUseContext.abortController.signal.removeEventListener('abort', cleanup)
  }
// cleanup 幂等闸门（isCleanedUp）：这个函数可能从 abort、beforeExit、catch 多处触发，竞态下重复关标签会报错。关标签失败只记日志不抛——清理路径的失败不该盖掉主错误。注销两个监听防泄漏。

  // Cleanup if the user hits esc to cancel the tool call - or on exit
  toolUseContext.abortController.signal.addEventListener('abort', cleanup)
  process.on('beforeExit', cleanup)
// 两条退出触发器：工具调用被 esc 取消（abortController）+ 进程即将退出（beforeExit，用户 ctrl-C 时 IDE 标签不能孤儿化）。

  // Open the diff in the IDE
  const ideClient = getConnectedIdeClient(toolUseContext.options.mcpClients)
  try {
    const { updatedFile } = getPatchForEdits({
      filePath: oldFilePath,
      fileContents: oldContent,
      edits,
    })
// getPatchForEdits 算出「应用这些编辑后的完整文件内容」——IDE diff 的右侧就是要展示这个。

    if (!ideClient || ideClient.type !== 'connected') {
      throw new Error('IDE client not available')
    }
    let ideOldPath = oldFilePath

    // Only convert paths if we're in WSL and IDE is on Windows
    const ideRunningInWindows =
      (ideClient.config as McpSSEIDEServerConfig | McpWebSocketIDEServerConfig)
        .ideRunningInWindows === true
    if (
      getPlatform() === 'wsl' &&
      ideRunningInWindows &&
      process.env.WSL_DISTRO_NAME
    ) {
      const converter = new WindowsToWSLConverter(process.env.WSL_DISTRO_NAME)
      ideOldPath = converter.toIDEPath(oldFilePath)
    }
// WSL 路径转换：CLI 跑在 WSL 里而 IDE 在 Windows 上时，路径必须从 /home/... 转成 \\wsl$\... 形式 IDE 才认。三条件全满足才转（本端 wsl + IDE 侧 ideRunningInWindows + 有 WSL_DISTRO_NAME 环境变量）。

    const rpcResult = await callIdeRpc(
      'openDiff',
      {
        old_file_path: ideOldPath,
        new_file_path: ideOldPath,
        new_file_contents: updatedFile,
        tab_name: tabName,
      },
      ideClient,
    )

    // Convert the raw RPC result to a ToolCallResponse format
    const data = Array.isArray(rpcResult) ? rpcResult : [rpcResult]
// RPC 结果统一成 ToolCallResponse 数组格式——IDE 扩展返回的可能是单条也可能是数组，下游按数组处理。

    // If the user saved the file then take the new contents and resolve with that.
    if (isSaveMessage(data)) {
      void cleanup()
      return {
        oldContent: oldContent,
        newContent: data[1].text,
      }
    } else if (isClosedMessage(data)) {
      void cleanup()
      return {
        oldContent: oldContent,
        newContent: updatedFile,
      }
    } else if (isRejectedMessage(data)) {
      void cleanup()
      return {
        oldContent: oldContent,
        newContent: oldContent,
      }
    }
// 三种已知结果（FILE_SAVED / TAB_CLOSED / DIFF_REJECTED）之外一律抛 'Not accepted'——用户可能直接关了 IDE，连接断开，走到这里就是状态未知，宁可失败走 catch 关标签，也不要挂着权限提示永远等。

    // Indicates that the tool call completed with none of the expected
    // results. Did the user close the IDE?
    throw new Error('Not accepted')
  } catch (error) {
    logError(error as Error)
    void cleanup()
    throw error
  }
}

async function closeTabInIDE(
  tabName: string,
  ideClient?: MCPServerConnection | undefined,
): Promise<void> {
  try {
    if (!ideClient || ideClient.type !== 'connected') {
      throw new Error('IDE client not available')
    }

    // Use direct RPC to close the tab
    await callIdeRpc('close_tab', { tab_name: tabName }, ideClient)
  } catch (error) {
    logError(error as Error)
    // Don't throw - this is a cleanup operation
  }
// closeTabInIDE 吞掉所有错误：这是清理操作，失败也不能影响调用方（连 IDE 都没了的时候尤其如此）。
}

function isClosedMessage(data: unknown): data is { text: 'TAB_CLOSED' } {
  return (
    Array.isArray(data) &&
    typeof data[0] === 'object' &&
    data[0] !== null &&
    'type' in data[0] &&
    data[0].type === 'text' &&
    'text' in data[0] &&
    data[0].text === 'TAB_CLOSED'
  )
}

function isRejectedMessage(data: unknown): data is { text: 'DIFF_REJECTED' } {
  return (
    Array.isArray(data) &&
    typeof data[0] === 'object' &&
    data[0] !== null &&
    'type' in data[0] &&
    data[0].type === 'text' &&
    'text' in data[0] &&
    data[0].text === 'DIFF_REJECTED'
  )
}

function isSaveMessage(
  data: unknown,
): data is [{ text: 'FILE_SAVED' }, { text: string }] {
  return (
    Array.isArray(data) &&
    data[0]?.type === 'text' &&
    data[0].text === 'FILE_SAVED' &&
    typeof data[1].text === 'string'
  )
// 三个类型守卫 isClosed/isRejected/isSave 都是防御式结构校验：IDE 扩展是外部进程，RPC 返回的结构不能信——先验证 Array.isArray、每条的 type/text 字段，再收窄类型。save 消息的第二个元素 text 才是用户保存的文件内容。
}
