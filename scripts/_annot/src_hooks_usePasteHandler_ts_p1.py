ANNOTATIONS = [
    (16, 'after', r'''文件级：粘贴处理器。两个时间常量：剪贴板图片检查 50ms 防抖、粘贴合成 100ms 超时（等 stdin 把整个粘贴吐完）。pasteState 累积 chunk，isPasting 驱动 UI 反馈。'''),
    (53, 'after', r'''pastePendingRef 是 pasteState.timeoutId 的同步镜像——注释记录的 race：粘贴与击键落在同一个 stdin chunk 时，两次 wrappedOnInput 在同一个 discreteUpdates batch 里跑，第二次读到陈旧的 timeoutId（还是 null）走了 onInput 直通路径；那个键如果是 Enter，就拿着旧输入提交、粘贴内容丢失。ref 同步更新，batch 内第二次调用看得见第一次的写入。'''),
    (87, 'after', r'''checkClipboardForImageImpl：getImageFromClipboard 读系统剪贴板；isMountedRef 全程守卫（异步回来时组件可能已卸载）；finally 复位 isPasting。'''),
    (207, 'after', r'''resetPasteTimeout 的合成回调：① join chunks 后剥孤儿 focus 序列（[I/[O——focus 事件会把粘贴从中间切断）② 图片路径检测：多图拖放可能是换行分隔（某些终端）或空格分隔（Finder 拖出），空格分隔用「空格后跟绝对路径」切分——Unix 看 /、Windows 看盘符+:\，路径内空格被转义（file\ name.png）所以切分安全 ③ 有图片路径：并发读全部，成功的逐个 onImagePaste，读失败的非图片行按文本粘贴 ④ macOS 临时截图特判：/TemporaryItems/.../screencaptureui/.../Screenshot 是截屏工具落地即删的临时文件，文件不在就回退查剪贴板 ⑤ 空粘贴（Cmd+V 图片）macOS 查剪贴板 ⑥ 普通文本 onPaste。'''),
    (258, 'after', r'''粘贴检测的演进写在注释里：现在用 keypress parser 的 isPasted 标志（bracketed paste mode 解析），不再自建 stdin.on('data') 监听——以前那个监听与 App.tsx 的 readable 监听竞争，丢字符。'''),
    (278, 'after', r'''wrappedOnInput 的分流：① isPasted → 置 isPasting（UI 反馈）② 图片路径检测不看长度（拖两个图路径可能很短）③ 空粘贴 + macOS → 直接查剪贴板不等合成超时 ④ shouldHandleAsPaste = onPaste &&（超 PASTE_THRESHOLD || 有待合成粘贴 || 含图片路径 || isPasted）——累积 chunks 并重置 100ms 合成计时 ⑤ 否则 onInput 直通；>10 字符时兜底复位 isPasting（stdin buffer 可能在任意点切断闭合转义序列，isPasted 标志会漏）。'''),
]
