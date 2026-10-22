import type { Buffer } from 'buffer'
import { isInBundledMode } from '../../utils/bundledMode.js'

export type SharpInstance = {
  metadata(): Promise<{ width: number; height: number; format: string }>
  resize(
    width: number,
    height: number,
    options?: { fit?: string; withoutEnlargement?: boolean },
  ): SharpInstance
  jpeg(options?: { quality?: number }): SharpInstance
  png(options?: {
    compressionLevel?: number
    palette?: boolean
    colors?: number
  }): SharpInstance
  webp(options?: { quality?: number }): SharpInstance
  toBuffer(): Promise<Buffer>
}
// `SharpInstance` 是 sharp 真实类型的**最小子集**（只有本项目用到的六个方法），而不是 `import type` 整个 sharp。两个原因：① sharp 的类型定义依赖原生模块，打包进单文件时会拖一堆类型进来；② 只有自己声明形状，才能让下面的 `unwrapDefault` 用一个统一签名同时接住 napi 版和 sharp 版。注意字段名 `png({ palette, colors })` 这类参数是照抄 sharp 的，别自己改名。

export type SharpFunction = (input: Buffer) => SharpInstance

type SharpCreatorOptions = {
  create: {
    width: number
    height: number
    channels: 3 | 4
    background: { r: number; g: number; b: number }
  }
}

type SharpCreator = (options: SharpCreatorOptions) => SharpInstance

let imageProcessorModule: { default: SharpFunction } | null = null
let imageCreatorModule: { default: SharpCreator } | null = null
// 两个模块级缓存。注意它们**不是同一个东西**：`imageProcessorModule` 是可以被原生模块替换的（处理已有图片），`imageCreatorModule` 永远用 sharp（`create` 模式造图，napi 版不支持）。分成两个变量的原因是「处理」和「创建」可能最后落在不同的实现上，共用一个缓存会互相污染。

export async function getImageProcessor(): Promise<SharpFunction> {
  if (imageProcessorModule) {
    return imageProcessorModule.default
  }

  if (isInBundledMode()) {
    // Try to load the native image processor first
    try {
      // Use the native image processor module
      const imageProcessor = await import('image-processor-napi')
      const sharp = imageProcessor.sharp || imageProcessor.default
      imageProcessorModule = { default: sharp }
      return sharp
    } catch {
      // Fall back to sharp if native module is not available
      // biome-ignore lint/suspicious/noConsole: intentional warning
      console.warn(
        'Native image processor not available, falling back to sharp',
      )
    }
  }

  // Use sharp for non-bundled builds or as fallback.
  // Single structural cast: our SharpFunction is a subset of sharp's actual type surface.
  const imported = (await import(
    'sharp'
  )) as unknown as MaybeDefault<SharpFunction>
  const sharp = unwrapDefault(imported)
  imageProcessorModule = { default: sharp }
  return sharp
}
// `getImageProcessor` 的两级策略，只在**打包模式**（`isInBundledMode()`）才尝试原生模块 `image-processor-napi`：那是给 CLI 单文件分发用的原生绑定，装了就能免掉 sharp 的加载开销；没装就 `console.warn` 一条然后**继续往下走**去用 sharp —— 注意这个 catch 什么都不抛，降级必须是静默成功的。非打包模式（比如开发时 `node dist/cli.js`）直接走 sharp。另外 `imageProcessor.sharp || imageProcessor.default` 是同时兼容两种导出形状。

/**
 * Get image creator for generating new images from scratch.
 * Note: image-processor-napi doesn't support image creation,
 * so this always uses sharp directly.
 */
export async function getImageCreator(): Promise<SharpCreator> {
  if (imageCreatorModule) {
    return imageCreatorModule.default
  }

  const imported = (await import(
    'sharp'
  )) as unknown as MaybeDefault<SharpCreator>
  const sharp = unwrapDefault(imported)
  imageCreatorModule = { default: sharp }
  return sharp
}

// Dynamic import shape varies by module interop mode — ESM yields { default: fn }, CJS yields fn directly.
type MaybeDefault<T> = T | { default: T }
// `MaybeDefault<T>` 加 `unwrapDefault` 是为了接住一个纯 interop 差异：同一个 `import('sharp')`，ESM 互操作模式下拿到的是 `{ default: fn }`，CJS 模式下拿到的就是 `fn` 本身。所以 `src/tools/FileReadTool/FileReadTool.ts` 里那份图片兜底压缩（`await import('sharp')` 后 `.default || sharpModule`）是同一个坑的第二次踩点 —— 当时是内联写的，这里是抽成了工具函数。

function unwrapDefault<T extends (...args: never[]) => unknown>(
  mod: MaybeDefault<T>,
): T {
  return typeof mod === 'function' ? mod : mod.default
}
