# 批注数据：src/utils/systemTheme.ts
# slug: src_utils_systemTheme_ts
ANNOTATIONS = [
    (1, 'after', '''终端明暗主题探测：针对「auto」主题设置，依据终端真实背景色（经 OSC 11 查询）而非系统外观来判断明暗，并缓存结果避免重复异步往返。'''),
    (16, 'after', '''SystemTheme：终端主题类型，只有 dark 与 light 两种。'''),
    (29, 'after', '''getSystemThemeName：首次检测后缓存主题；由看守器在实时变化时更新缓存。'''),
    (37, 'after', '''setCachedSystemTheme：供看守器在 OSC 11 响应到达时更新缓存，使非 React 调用点保持同步。'''),
    (47, 'after', '''resolveThemeSetting：把可能含「auto」的主题设置解析为具体主题名。'''),
    (66, 'after', '''themeFromOscColor：按 ITU-R BT.709 相对亮度（>0.5 判为亮）把 OSC 颜色响应解析为明暗主题。'''),
    (94, 'after', '''parseOscRgb：解析 rgb:R/G/B 或 #RRGGBB 形式，把各分量规整为 [0,1]，无法识别返回 undefined。'''),
    (100, 'after', '''hexComponent：把 1 至 4 位十六进制分量归一化到 [0,1] 区间。'''),
    (119, 'after', '''detectFromColorFgBg：在 OSC 11 往返完成前用 $COLORFGBG 做同步初判（rxvt/Konsole 等设置时），bg 0-6 与 8 为暗、其余为亮。'''),
]
