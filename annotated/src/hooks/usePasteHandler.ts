import { basename } from 'path'
import React from 'react'
import { logError } from 'src/utils/log.js'
import { useDebounceCallback } from 'usehooks-ts'
import type { InputEvent, Key } from '../ink.js'
import {
  getImageFromClipboard,
  isImageFilePath,
  PASTE_THRESHOLD,
  tryReadImageFromPath,
} from '../utils/imagePaste.js'
import type { ImageDimensions } from '../utils/imageResizer.js'
import { getPlatform } from '../utils/platform.js'

const CLIPBOARD_CHECK_DEBOUNCE_MS = 50
const PASTE_COMPLETION_TIMEOUT_MS = 100
// 文件级：粘贴处理器。两个时间常量：剪贴板图片检查 50ms 防抖、粘贴合成 100ms 超时（等 stdin 把整个粘贴吐完）。pasteState 累积 chunk，isPasting 驱动 UI 反馈。

type PasteHandlerProps = {
  onPaste?: (text: string) => void
  onInput: (input: string, key: Key) => void
  onImagePaste?: (
    base64Image: string,
    mediaType?: string,
    filename?: string,
    dimensions?: ImageDimensions,
    sourcePath?: string,
  ) => void
}

export function usePasteHandler({
  onPaste,
  onInput,
  onImagePaste,
}: PasteHandlerProps): {
  wrappedOnInput: (input: string, key: Key, event: InputEvent) => void
  pasteState: {
    chunks: string[]
    timeoutId: ReturnType<typeof setTimeout> | null
  }
  isPasting: boolean
} {
  const [pasteState, setPasteState] = React.useState<{
    chunks: string[]
    timeoutId: ReturnType<typeof setTimeout> | null
  }>({ chunks: [], timeoutId: null })
  const [isPasting, setIsPasting] = React.useState(false)
  const isMountedRef = React.useRef(true)
  // Mirrors pasteState.timeoutId but updated synchronously. When paste + a
  // keystroke arrive in the same stdin chunk, both wrappedOnInput calls run
  // in the same discreteUpdates batch before React commits — the second call
  // reads stale pasteState.timeoutId (null) and takes the onInput path. If
  // that key is Enter, it submits the old input and the paste is lost.
  const pastePendingRef = React.useRef(false)
// pastePendingRef 是 pasteState.timeoutId 的同步镜像——注释记录的 race：粘贴与击键落在同一个 stdin chunk 时，两次 wrappedOnInput 在同一个 discreteUpdates batch 里跑，第二次读到陈旧的 timeoutId（还是 null）走了 onInput 直通路径；那个键如果是 Enter，就拿着旧输入提交、粘贴内容丢失。ref 同步更新，batch 内第二次调用看得见第一次的写入。

  const isMacOS = React.useMemo(() => getPlatform() === 'macos', [])

  React.useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const checkClipboardForImageImpl = React.useCallback(() => {
    if (!onImagePaste || !isMountedRef.current) return

    void getImageFromClipboard()
      .then(imageData => {
        if (imageData && isMountedRef.current) {
          onImagePaste(
            imageData.base64,
            imageData.mediaType,
            undefined, // no filename for clipboard images
            imageData.dimensions,
          )
        }
      })
      .catch(error => {
        if (isMountedRef.current) {
          logError(error as Error)
        }
      })
      .finally(() => {
        if (isMountedRef.current) {
          setIsPasting(false)
        }
      })
  }, [onImagePaste])
// checkClipboardForImageImpl：getImageFromClipboard 读系统剪贴板；isMountedRef 全程守卫（异步回来时组件可能已卸载）；finally 复位 isPasting。

  const checkClipboardForImage = useDebounceCallback(
    checkClipboardForImageImpl,
    CLIPBOARD_CHECK_DEBOUNCE_MS,
  )

  const resetPasteTimeout = React.useCallback(
    (currentTimeoutId: ReturnType<typeof setTimeout> | null) => {
      if (currentTimeoutId) {
        clearTimeout(currentTimeoutId)
      }
      return setTimeout(
        (
          setPasteState,
          onImagePaste,
          onPaste,
          setIsPasting,
          checkClipboardForImage,
          isMacOS,
          pastePendingRef,
        ) => {
          pastePendingRef.current = false
          setPasteState(({ chunks }) => {
            // Join chunks and filter out orphaned focus sequences
            // These can appear when focus events split during paste
            const pastedText = chunks
              .join('')
              .replace(/\[I$/, '')
              .replace(/\[O$/, '')

            // Check if the pasted text contains image file paths
            // When dragging multiple images, they may come as:
            // 1. Newline-separated paths (common in some terminals)
            // 2. Space-separated paths (common when dragging from Finder)
            // For space-separated paths, we split on spaces that precede absolute paths:
            // - Unix: space followed by `/` (e.g., `/Users/...`)
            // - Windows: space followed by drive letter and `:\` (e.g., `C:\Users\...`)
            // This works because spaces within paths are escaped (e.g., `file\ name.png`)
            const lines = pastedText
              .split(/ (?=\/|[A-Za-z]:\\)/)
              .flatMap(part => part.split('\n'))
              .filter(line => line.trim())
            const imagePaths = lines.filter(line => isImageFilePath(line))

            if (onImagePaste && imagePaths.length > 0) {
              const isTempScreenshot =
                /\/TemporaryItems\/.*screencaptureui.*\/Screenshot/i.test(
                  pastedText,
                )

              // Process all image paths
              void Promise.all(
                imagePaths.map(imagePath => tryReadImageFromPath(imagePath)),
              ).then(results => {
                const validImages = results.filter(
                  (r): r is NonNullable<typeof r> => r !== null,
                )

                if (validImages.length > 0) {
                  // Successfully read at least one image
                  for (const imageData of validImages) {
                    const filename = basename(imageData.path)
                    onImagePaste(
                      imageData.base64,
                      imageData.mediaType,
                      filename,
                      imageData.dimensions,
                      imageData.path,
                    )
                  }
                  // If some paths weren't images, paste them as text
                  const nonImageLines = lines.filter(
                    line => !isImageFilePath(line),
                  )
                  if (nonImageLines.length > 0 && onPaste) {
                    onPaste(nonImageLines.join('\n'))
                  }
                  setIsPasting(false)
                } else if (isTempScreenshot && isMacOS) {
                  // For temporary screenshot files that no longer exist, try clipboard
                  checkClipboardForImage()
                } else {
                  if (onPaste) {
                    onPaste(pastedText)
                  }
                  setIsPasting(false)
                }
              })
              return { chunks: [], timeoutId: null }
            }

            // If paste is empty (common when trying to paste images with Cmd+V),
            // check if clipboard has an image (macOS only)
            if (isMacOS && onImagePaste && pastedText.length === 0) {
              checkClipboardForImage()
              return { chunks: [], timeoutId: null }
            }

            // Handle regular paste
            if (onPaste) {
              onPaste(pastedText)
            }
            // Reset isPasting state after paste is complete
            setIsPasting(false)
            return { chunks: [], timeoutId: null }
          })
        },
        PASTE_COMPLETION_TIMEOUT_MS,
        setPasteState,
        onImagePaste,
        onPaste,
        setIsPasting,
        checkClipboardForImage,
        isMacOS,
        pastePendingRef,
      )
    },
    [checkClipboardForImage, isMacOS, onImagePaste, onPaste],
  )

// resetPasteTimeout 的合成回调：① join chunks 后剥孤儿 focus 序列（[I/[O——focus 事件会把粘贴从中间切断）② 图片路径检测：多图拖放可能是换行分隔（某些终端）或空格分隔（Finder 拖出），空格分隔用「空格后跟绝对路径」切分——Unix 看 /、Windows 看盘符+:\，路径内空格被转义（file\ name.png）所以切分安全 ③ 有图片路径：并发读全部，成功的逐个 onImagePaste，读失败的非图片行按文本粘贴 ④ macOS 临时截图特判：/TemporaryItems/.../screencaptureui/.../Screenshot 是截屏工具落地即删的临时文件，文件不在就回退查剪贴板 ⑤ 空粘贴（Cmd+V 图片）macOS 查剪贴板 ⑥ 普通文本 onPaste。
  // Paste detection is now done via the InputEvent's keypress.isPasted flag,
  // which is set by the keypress parser when it detects bracketed paste mode.
  // This avoids the race condition caused by having multiple listeners on stdin.
  // Previously, we had a stdin.on('data') listener here which competed with
  // the 'readable' listener in App.tsx, causing dropped characters.

  const wrappedOnInput = (input: string, key: Key, event: InputEvent): void => {
    // Detect paste from the parsed keypress event.
    // The keypress parser sets isPasted=true for content within bracketed paste.
    const isFromPaste = event.keypress.isPasted

    // If this is pasted content, set isPasting state for UI feedback
    if (isFromPaste) {
      setIsPasting(true)
    }

    // Handle large pastes (>PASTE_THRESHOLD chars)
    // Usually we get one or two input characters at a time. If we
    // get more than the threshold, the user has probably pasted.
    // Unfortunately node batches long pastes, so it's possible
    // that we would see e.g. 1024 characters and then just a few
    // more in the next frame that belong with the original paste.
    // This batching number is not consistent.

    // Handle potential image filenames (even if they're shorter than paste threshold)
    // When dragging multiple images, they may come as newline-separated or
    // space-separated paths. Split on spaces preceding absolute paths:
    // - Unix: ` /` - Windows: ` C:\` etc.
    const hasImageFilePath = input
      .split(/ (?=\/|[A-Za-z]:\\)/)
      .flatMap(part => part.split('\n'))
      .some(line => isImageFilePath(line.trim()))

    // Handle empty paste (clipboard image on macOS)
    // When the user pastes an image with Cmd+V, the terminal sends an empty
    // bracketed paste sequence. The keypress parser emits this as isPasted=true
    // with empty input.
    if (isFromPaste && input.length === 0 && isMacOS && onImagePaste) {
      checkClipboardForImage()
      // Reset isPasting since there's no text content to process
      setIsPasting(false)
      return
    }

    // Check if we should handle as paste (from bracketed paste, large input, or continuation)
    const shouldHandleAsPaste =
      onPaste &&
      (input.length > PASTE_THRESHOLD ||
        pastePendingRef.current ||
        hasImageFilePath ||
        isFromPaste)
// 粘贴检测的演进写在注释里：现在用 keypress parser 的 isPasted 标志（bracketed paste mode 解析），不再自建 stdin.on('data') 监听——以前那个监听与 App.tsx 的 readable 监听竞争，丢字符。

    if (shouldHandleAsPaste) {
      pastePendingRef.current = true
      setPasteState(({ chunks, timeoutId }) => {
        return {
          chunks: [...chunks, input],
          timeoutId: resetPasteTimeout(timeoutId),
        }
      })
      return
    }
    onInput(input, key)
    if (input.length > 10) {
      // Ensure that setIsPasting is turned off on any other multicharacter
      // input, because the stdin buffer may chunk at arbitrary points and split
      // the closing escape sequence if the input length is too long for the
      // stdin buffer.
      setIsPasting(false)
    }
  }
// wrappedOnInput 的分流：① isPasted → 置 isPasting（UI 反馈）② 图片路径检测不看长度（拖两个图路径可能很短）③ 空粘贴 + macOS → 直接查剪贴板不等合成超时 ④ shouldHandleAsPaste = onPaste &&（超 PASTE_THRESHOLD || 有待合成粘贴 || 含图片路径 || isPasted）——累积 chunks 并重置 100ms 合成计时 ⑤ 否则 onInput 直通；>10 字符时兜底复位 isPasting（stdin buffer 可能在任意点切断闭合转义序列，isPasted 标志会漏）。

  return {
    wrappedOnInput,
    pasteState,
    isPasting,
  }
}
