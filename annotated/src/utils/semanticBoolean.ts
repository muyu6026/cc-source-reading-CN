// 本文件导出 semanticBoolean：一个对「字符串形式的布尔字面量」做宽容解析的 zod 预处理包装，用于容错模型偶尔把布尔加引号的情况。
import { z } from 'zod/v4'

// 模块注释详述动机：模型生成的 JSON 偶尔会把布尔加引号（如 `replace_all` 取值为字符串），z.boolean() 会报类型错误；而 z.coerce.boolean() 用 JS 真值判断会把 `false` 解析成 true，故只对字面量 true / false 做精确转换。
/**
 * Boolean that also accepts the string literals "true"/"false".
 *
 * Tool inputs arrive as model-generated JSON. The model occasionally quotes
 * booleans — `"replace_all":"false"` instead of `"replace_all":false` — and
 * z.boolean() rejects that with a type error. z.coerce.boolean() is the wrong
 * fix: it uses JS truthiness, so "false" → true.
 *
 * z.preprocess emits {"type":"boolean"} to the API schema, so the model is
 * still told this is a boolean — the string tolerance is invisible client-side
 * coercion, not an advertised input shape.
 *
 * .optional()/.default() go INSIDE (on the inner schema), not chained after:
 * chaining them onto ZodPipe widens z.output<> to unknown in Zod v4.
 *
 *   semanticBoolean()                              → boolean
 *   semanticBoolean(z.boolean().optional())        → boolean | undefined
 *   semanticBoolean(z.boolean().default(false))    → boolean
 */
// semanticBoolean：以 z.preprocess 包裹内层 schema。仅当入参严格等于字符串 true / false 时才转换，其余情况原样透传交给内层 schema；可选与默认值必须挂在内层。
export function semanticBoolean<T extends z.ZodType>(
  inner: T = z.boolean() as unknown as T,
) {
  return z.preprocess(
    (v: unknown) => (v === 'true' ? true : v === 'false' ? false : v),
    inner,
  )
}
