# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''/mobile 命令：在终端里展示 iOS / Android 应用的下载二维码，用户可用手机扫码安装 Claude 应用。'''),
    (10, 'after', '''Platform 类型：仅支持 ios 与 android 两种平台。'''),
    (23, 'after', '''PLATFORMS：两种平台对应的 App Store / Google Play 下载链接常量。'''),
    (24, 'after', '''MobileQRCode 函数入口，$ = _c(52) 是 React Compiler 的缓存槽，整段逻辑都围绕缓存命中展开。'''),
    (40, 'after', '''qrCodes 状态：初始为空串（而非 undefined），避免首帧渲染空白占位闪烁。'''),
    (71, 'after', '''useEffect：并发生成两张平台二维码（utf8 编码、L 级容错），写入 qrCodes 状态。'''),
    (82, 'after', '''handleClose：由 onDone 包装而成，用于确认键关闭。'''),
    (92, 'after', '''useKeybinding：绑定 confirm:no 到 handleClose（context 为 Confirmation）。'''),
    (111, 'after', '''handleKeyDown：q 或 ctrl-c 关闭，tab / 左右方向键切换平台。'''),
    (161, 'after', '''渲染准备：上面一大段 if 链为每个缓存节点 tN 计算值（标题、分隔、URL、各平台标签），这里统一收口。'''),
    (259, 'after', '''return t28：最外层用 Pane 包裹整块二维码与提示，t27 是内部 Box 布局。'''),
    (263, 'after', '''_temp4：把二维码的每一行渲染成带 key 的 Text 节点。'''),
    (266, 'after', '''_temp3：过滤掉二维码中的空行。'''),
    (269, 'after', '''_temp2：平台切换辅助——ios 与 android 互切。'''),
    (270, 'after', '''_temp：空函数占位（编译器生成的副作用槽）。'''),
    (273, 'after', '''call 导出：直接渲染 MobileQRCode 组件。'''),
]
