// 语义化版本比较的跨运行时封装：运行时自带比较器时走原生实现（注释给出实测约快二十倍），否则回落到第三方包。六个导出覆盖大于、大于等于、小于、小于等于、满足区间、三值比较；回落分支一律开启宽松模式，容忍不规范版本串。
/**
 * Semver comparison utilities that use Bun.semver when available
 * and fall back to the npm `semver` package in Node.js environments.
 *
 * Bun.semver.order() is ~20x faster than npm semver comparisons.
 * The npm semver fallback always uses { loose: true }.
 */

let _npmSemver: typeof import('semver') | undefined

function getNpmSemver(): typeof import('semver') {
  if (!_npmSemver) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _npmSemver = require('semver') as typeof import('semver')
  }
  return _npmSemver
}
// 第三方包用惰性加载并缓存：首次真正需要比较时才引入，之后复用同一个模块对象。这样做让原生运行时的路径完全不触碰这个包，打包时也更容易被摇掉。

export function gt(a: string, b: string): boolean {
  if (typeof Bun !== 'undefined') {
    return Bun.semver.order(a, b) === 1
  }
  return getNpmSemver().gt(a, b, { loose: true })
}
// 原生比较器返回三值整数，所以大于等价于「结果等于一」。注意这里判断运行时是否存在，而不是判断某个方法是否存在——探测点越少，模块加载期开销越小，但也意味着假定了该运行时必然带比较器。

export function gte(a: string, b: string): boolean {
  if (typeof Bun !== 'undefined') {
    return Bun.semver.order(a, b) >= 0
  }
  return getNpmSemver().gte(a, b, { loose: true })
}

export function lt(a: string, b: string): boolean {
  if (typeof Bun !== 'undefined') {
    return Bun.semver.order(a, b) === -1
  }
  return getNpmSemver().lt(a, b, { loose: true })
}

export function lte(a: string, b: string): boolean {
  if (typeof Bun !== 'undefined') {
    return Bun.semver.order(a, b) <= 0
  }
  return getNpmSemver().lte(a, b, { loose: true })
}
// 中间三个函数是同一套写法的机械复制，只有比较方向不同：大于等于对应结果不小于零，小于对应结果等于负一，小于等于对应结果不大于零。保持各自独立而不是互推（例如用大于推小于等于），是为了让每次调用只做一次比较。

export function satisfies(version: string, range: string): boolean {
  if (typeof Bun !== 'undefined') {
    return Bun.semver.satisfies(version, range)
  }
  return getNpmSemver().satisfies(version, range, { loose: true })
}
// 区间判断直接转交原生实现或第三方包，不做任何预处理。这一处最容易出现语义差异，因为区间语法本身很宽（插入符、波浪号、连字符区间、或条件），所以不自己实现。

export function order(a: string, b: string): -1 | 0 | 1 {
  if (typeof Bun !== 'undefined') {
    return Bun.semver.order(a, b)
  }
  return getNpmSemver().compare(a, b, { loose: true })
}
// 三值比较是这套封装的原语，其余函数都可以由它推导，但为了少一次函数调用仍然各自实现。返回类型写成字面量联合，让调用方在分支判断时能拿到精确类型而不是宽泛的数字。
