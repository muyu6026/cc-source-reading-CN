// YAML 解析封装：在 Bun 运行时下用内置且零成本的 Bun.YAML，否则惰性 require 回退到 yaml npm 包，保证原生 Bun 构建永远不会去加载约 270KB 的解析器。
/**
 * YAML parsing wrapper.
 *
 * Uses Bun.YAML (built-in, zero-cost) when running under Bun, otherwise falls
 * back to the `yaml` npm package. The package is lazy-required inside the
 * non-Bun branch so native Bun builds never load the ~270KB yaml parser.
 */

export function parseYaml(input: string): unknown {
  if (typeof Bun !== 'undefined') {
    return Bun.YAML.parse(input)
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('yaml') as typeof import('yaml')).parse(input)
}
// 实现：先判断 Bun 是否已定义，是则走 Bun.YAML.parse，否则在非 Bun 分支里惰性 require('yaml') 再 parse（用 eslint 注释豁免 require 规则）。
