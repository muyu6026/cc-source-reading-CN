# 批注数据：src/utils/screenshotClipboard.ts
# slug: src_utils_screenshotClipboard_ts
ANNOTATIONS = [
    (8, 'after', '''截图写入剪贴板：把 ANSI 文本经纯 TS 管线渲染成 PNG 后复制到系统剪贴板，支持 macOS、Linux 与 Windows，无需 WASM 或系统字体。'''),
    (19, 'after', '''copyAnsiToClipboard 签名：把 ANSI 文本渲染为 PNG 并复制到剪贴板，返回成功与否与消息。'''),
    (44, 'after', '''copyAnsiToClipboard 收尾：先渲染写盘，再复制，最后清理临时 PNG，任何异常都记录并返回失败消息。'''),
    (48, 'after', '''copyPngToClipboard 签名：按运行平台选择对应的剪贴板写入方式。'''),
    (67, 'after', '''macOS 分支：用 osascript 把 PNG 以 PNGf 类型读入剪贴板。'''),
    (97, 'after', '''Linux 分支：优先 xclip，失败再回退 xsel，二者皆失败则提示安装 xclip。'''),
    (115, 'after', '''Windows 分支：用 PowerShell 调用 System.Windows.Forms.Clipboard 设置图片。'''),
    (121, 'after', '''对不支持的平台返回失败消息，结束剪贴板复制流程。'''),
]
