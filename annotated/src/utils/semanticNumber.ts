// 本文件导出 semanticNumber：一个对「字符串形式的数字字面量」做宽容解析的 zod 预处理包装，用于容错模型偶尔把数字加引号的情况。
import { z } from 'zod/v4'

// 模块注释详述动机：模型生成的 JSON 偶尔会把数字加引号（如 `head_limit` 取值为字符串），z.number() 会直接报类型错误；而 z.coerce.number() 又会吞掉空串或 null 这类真实 bug，故仅对合法的十进制字面量做转换。
/**
 * Number that also accepts numeric string literals like "30", "-5", "3.14".
 *
 * Tool inputs arrive as model-generated JSON. The model occasionally quotes
 * numbers — `"head_limit":"30"` instead of `"head_limit":30` — and z.number()
 * rejects that with a type error. z.coerce.number() is the wrong fix: it
 * accepts values like "" or null by converting them via JS Number(), masking
 * bugs rather than surfacing them.
 *
 * Only strings that are valid decimal number literals (matching /^-?\d+(\.\d+)?$/)
 * are coerced. Anything else passes through and is rejected by the inner schema.
 *
 * z.preprocess emits {"type":"number"} to the API schema, so the model is
 * still told this is a number — the string tolerance is invisible client-side
 * coercion, not an advertised input shape.
 *
 * .optional()/.default() go INSIDE (on the inner schema), not chained after:
 * chaining them onto ZodPipe widens z.output<> to unknown in Zod v4.
 *
 *   semanticNumber()                              → number
 *   semanticNumber(z.number().optional())         → number | undefined
 *   semanticNumber(z.number().default(0))         → number
 */
// semanticNumber：以 z.preprocess 包裹内层 schema。仅当入参是字符串且匹配十进制数字字面量（允许负号与小数）时才尝试转数字；其余情况原样透传，交给内层 schema 拒绝。可选与默认值必须挂在内层。
export function semanticNumber<T extends z.ZodType>(
  inner: T = z.number() as unknown as T,
) {
  return z.preprocess((v: unknown) => {
    if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
    return v
  }, inner)
}
