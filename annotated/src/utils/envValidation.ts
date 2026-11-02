// 本文件提供「有界整数环境变量」的校验工具：把字符串形式的环境变量解析为整数，并在越界时返回 capped（截断到上限）或 invalid（回退默认值）状态。
import { logForDebugging } from './debug.js'

// EnvVarValidationResult：校验结果类型，含生效值 effective、状态 status 与可选的人类可读 message。
export type EnvVarValidationResult = {
  effective: number
  status: 'valid' | 'capped' | 'invalid'
  message?: string
}

// validateBoundedIntEnvVar：解析并校验一个有界整数环境变量。空值回退默认值；非正整数判为 invalid；超过上限则截断到 upperLimit 并返回 capped 状态。
export function validateBoundedIntEnvVar(
  name: string,
  value: string | undefined,
  defaultValue: number,
  upperLimit: number,
): EnvVarValidationResult {
  if (!value) {
    return { effective: defaultValue, status: 'valid' }
  }
  const parsed = parseInt(value, 10)
  if (isNaN(parsed) || parsed <= 0) {
    const result: EnvVarValidationResult = {
      effective: defaultValue,
      status: 'invalid',
      message: `Invalid value "${value}" (using default: ${defaultValue})`,
    }
    logForDebugging(`${name} ${result.message}`)
    return result
  }
  if (parsed > upperLimit) {
    const result: EnvVarValidationResult = {
      effective: upperLimit,
      status: 'capped',
      message: `Capped from ${parsed} to ${upperLimit}`,
    }
    logForDebugging(`${name} ${result.message}`)
    return result
  }
  return { effective: parsed, status: 'valid' }
}
