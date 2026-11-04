import type { RGBColor as RGBColorString } from '../../ink/styles.js'
import type { RGBColor as RGBColorType } from './types.js'

// getDefaultCharacters：spinner 的六帧字符表，按终端类型与平台分叉
export function getDefaultCharacters(): string[] {
  if (process.env.TERM === 'xterm-ghostty') {
    return ['·', '✢', '✳', '✶', '✻', '*'] // Use * instead of ✽ for Ghostty because the latter renders in a way that's slightly offset
// Ghostty 终端把最后一帧 ✽ 换成星号：注释说明 ✽ 在该终端渲染有轻微偏移
  }
  return process.platform === 'darwin'
// darwin 与非 darwin 只差第三帧（✳ 与 *）：macOS 能正常渲染 ✳，其他平台换成星号保底
    ? ['·', '✢', '✳', '✶', '✻', '✽']
    : ['·', '✢', '*', '✶', '✻', '✽']
}

// Interpolate between two RGB colors
// interpolateColor：两色按 t 线性插值，逐通道四舍五入
export function interpolateColor(
  color1: RGBColorType,
  color2: RGBColorType,
  t: number, // 0 to 1
): RGBColorType {
  return {
    r: Math.round(color1.r + (color2.r - color1.r) * t),
    g: Math.round(color1.g + (color2.g - color1.g) * t),
    b: Math.round(color1.b + (color2.b - color1.b) * t),
  }
}

// Convert RGB object to rgb() color string for Text component
// toRGBColor：转成 rgb(r,g,b) 字符串给 Text 的 color 用
export function toRGBColor(color: RGBColorType): RGBColorString {
  return `rgb(${color.r},${color.g},${color.b})`
}

// HSL hue (0-360) to RGB, using voice-mode waveform parameters (s=0.7, l=0.6).
// hueToRgb：HSL 转 RGB，固定饱和度 0.7 与亮度 0.6（语音模式波形的配色参数）
export function hueToRgb(hue: number): RGBColorType {
  const h = ((hue % 360) + 360) % 360
// hue 先归一化到 0 到 360：负数与超过一圈的值都能正确落位
  const s = 0.7
  const l = 0.6
  const c = (1 - Math.abs(2 * l - 1)) * s
// 标准 HSL 到 RGB 六段式：c 是色度、x 是次色、m 是亮度偏移
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

// RGB_CACHE 模块级缓存：解析结果按原始字符串缓存，命中直接返回
const RGB_CACHE = new Map<string, RGBColorType | null>()

export function parseRGB(colorStr: string): RGBColorType | null {
  const cached = RGB_CACHE.get(colorStr)
  if (cached !== undefined) return cached
// 用 !== undefined 判断命中而非真值判断：null 也是有效缓存值——解析失败的结果同样被记住，不重复跑正则

  const match = colorStr.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/)
  const result = match
    ? {
        r: parseInt(match[1]!, 10),
        g: parseInt(match[2]!, 10),
        b: parseInt(match[3]!, 10),
      }
    : null
  RGB_CACHE.set(colorStr, result)
  return result
}
