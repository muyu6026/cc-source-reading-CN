# 数据文件：src/utils/promptEditor.ts

ANNOTATIONS = [
    (1, 'before', '''文件级：把当前提示词或文件交给外部编辑器编辑，采用与终端面板一致的 suspend-Ink 模式，兼容 GUI 与终端编辑器。'''),
    (19, 'after', '''EDITOR_OVERRIDES：给部分编辑器加等待参数（code -w / subl --wait），让命令等文件关闭后再返回。'''),
    (23, 'after', '''isGuiEditor：委托 classifyGuiEditor 判断编辑器是否为 GUI 类。'''),
    (28, 'after', '''EditorResult：编辑器调用的统一返回结构，content 为编辑后内容、error 为出错信息。'''),
    (64, 'after', '''GUI 编辑器（code / subl 等）在独立窗口打开，只需暂停 Ink 并释放 stdin。'''),
    (100, 'after', '''finally 中按编辑器类型恢复 Ink（退出备用屏，或恢复 stdin 与渲染）。'''),
    (101, 'after', '''editFileInEditor：同步 IO；暂停 Ink 渲染后把文件交给外部编辑器，读回内容；GUI 编辑器仅暂停并释放 stdin，终端编辑器用备用屏。'''),
    (135, 'after', '''recollapsePastedContent：编辑后把未被改动的粘贴文本重新折叠回引用标记，保持提示词紧凑。'''),
    (158, 'after', '''把展开后的临时文件交给 editFileInEditor，失败则原样返回。'''),
    (187, 'after', '''finally 中清理临时文件，忽略清理错误。'''),
    (188, 'after', '''editPromptInEditor：对外主入口；先把粘贴引用展开写入临时文件交编辑器，读回后去掉尾部换行、必要时重新折叠粘贴内容，最后清理临时文件。'''),
]
