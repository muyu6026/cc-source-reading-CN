// 文件级。把设置对象的结构（`SettingsSchema`）转成 JSON Schema 字符串，供 UI 或外部工具读取设置字段定义。
import { toJSONSchema } from 'zod/v4'
import { jsonStringify } from '../slowOperations.js'
import { SettingsSchema } from './types.js'

export function generateSettingsJSONSchema(): string {
  const jsonSchema = toJSONSchema(SettingsSchema(), { unrepresentable: 'any' })
  return jsonStringify(jsonSchema, null, 2)
}
// 调用 `toJSONSchema` 生成 schema 后用 `jsonStringify` 美化（两空格缩进）输出。
