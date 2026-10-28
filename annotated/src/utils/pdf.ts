import { randomUUID } from 'crypto'
import { mkdir, readdir, readFile } from 'fs/promises'
import { join } from 'path'
import {
  PDF_MAX_EXTRACT_SIZE,
  PDF_TARGET_RAW_SIZE,
} from '../constants/apiLimits.js'
import { errorMessage } from './errors.js'
import { execFileNoThrow } from './execFileNoThrow.js'
import { formatFileSize } from './format.js'
import { getFsImplementation } from './fsOperations.js'
import { getToolResultsDir } from './toolResultStorage.js'

// PDFError：PDF 读取或解析失败时的结构化错误，reason 区分空文件、过大、加密、损坏、未知、不可用等情形。
export type PDFError = {
  reason:
    | 'empty'
    | 'too_large'
    | 'password_protected'
    | 'corrupted'
    | 'unknown'
    | 'unavailable'
  message: string
}

// PDFResult：PDF 操作的统一返回类型，成功携带数据，失败携带 PDFError。
export type PDFResult<T> =
  | { success: true; data: T }
  | { success: false; error: PDFError }

/**
 * Read a PDF file and return it as base64-encoded data.
 * @param filePath Path to the PDF file
 * @returns Result containing PDF data or a structured error
 */
// readPDF：把 PDF 文件读成 base64 数据，先做空文件、大小上限、PDF 魔数头校验再编码。
export async function readPDF(filePath: string): Promise<
  PDFResult<{
    type: 'pdf'
    file: {
      filePath: string
      base64: string
      originalSize: number
    }
  }>
> {
  try {
    const fs = getFsImplementation()
    const stats = await fs.stat(filePath)
    const originalSize = stats.size

    // Check if file is empty
    if (originalSize === 0) {
// 空文件直接返回 empty 错误，避免后续无意义的读取与编码。
      return {
        success: false,
        error: { reason: 'empty', message: `PDF file is empty: ${filePath}` },
      }
    }

    // Check if PDF exceeds maximum size
    // The API has a 32MB total request limit. After base64 encoding (~33% larger),
    // a PDF must be under ~20MB raw to leave room for conversation context.
    if (originalSize > PDF_TARGET_RAW_SIZE) {
// 超过目标原始大小上限（约 20MB）时返回 too_large，给对话上下文留出空间。
      return {
        success: false,
        error: {
          reason: 'too_large',
          message: `PDF file exceeds maximum allowed size of ${formatFileSize(PDF_TARGET_RAW_SIZE)}.`,
        },
      }
    }

    const fileBuffer = await readFile(filePath)

    // Validate PDF magic bytes — reject files that aren't actually PDFs
    // (e.g., HTML files renamed to .pdf) before they enter conversation context.
    // Once an invalid PDF document block is in the message history, every subsequent
    // API call fails with 400 "The PDF specified was not valid" and the session
    // becomes unrecoverable without /clear.
    const header = fileBuffer.subarray(0, 5).toString('ascii')
// 校验文件头前 5 字节是否为 %PDF-，防止把 HTML 等非 PDF 文件混入对话上下文导致后续 API 全部 400。
    if (!header.startsWith('%PDF-')) {
      return {
        success: false,
        error: {
          reason: 'corrupted',
          message: `File is not a valid PDF (missing %PDF- header): ${filePath}`,
        },
      }
    }

    const base64 = fileBuffer.toString('base64')

    // Note: We cannot check page count here without parsing the PDF
    // The API will enforce the 100-page limit and return an error if exceeded

    return {
      success: true,
      data: {
        type: 'pdf',
        file: {
          filePath,
          base64,
          originalSize,
        },
      },
    }
  } catch (e: unknown) {
    return {
      success: false,
      error: {
        reason: 'unknown',
        message: errorMessage(e),
      },
    }
  }
}

/**
 * Get the number of pages in a PDF file using `pdfinfo` (from poppler-utils).
 * Returns `null` if pdfinfo is not available or if the page count cannot be determined.
 */
// getPDFPageCount：借助 poppler 的 pdfinfo 读取页数，工具不可用或无法解析时返回 null。
export async function getPDFPageCount(
  filePath: string,
): Promise<number | null> {
  const { code, stdout } = await execFileNoThrow('pdfinfo', [filePath], {
    timeout: 10_000,
    useCwd: false,
  })
  if (code !== 0) {
    return null
  }
  const match = /^Pages:\s+(\d+)/m.exec(stdout)
  if (!match) {
    return null
  }
  const count = parseInt(match[1]!, 10)
  return isNaN(count) ? null : count
}

export type PDFExtractPagesResult = {
  type: 'parts'
  file: {
    filePath: string
    originalSize: number
    count: number
    outputDir: string
  }
}

let pdftoppmAvailable: boolean | undefined

/**
 * Reset the pdftoppm availability cache. Used by tests only.
 */
export function resetPdftoppmCache(): void {
  pdftoppmAvailable = undefined
}

/**
 * Check whether the `pdftoppm` binary (from poppler-utils) is available.
 * The result is cached for the lifetime of the process.
 */
// isPdftoppmAvailable：检测 poppler 的 pdftoppm 是否可用，结果在进程生命周期内缓存。
export async function isPdftoppmAvailable(): Promise<boolean> {
  if (pdftoppmAvailable !== undefined) return pdftoppmAvailable
  const { code, stderr } = await execFileNoThrow('pdftoppm', ['-v'], {
    timeout: 5000,
    useCwd: false,
  })
  // pdftoppm prints version info to stderr and exits 0 (or sometimes 99 on older versions)
  pdftoppmAvailable = code === 0 || stderr.length > 0
  return pdftoppmAvailable
}

/**
 * Extract PDF pages as JPEG images using pdftoppm.
 * Produces page-01.jpg, page-02.jpg, etc. in an output directory.
 * This enables reading large PDFs and works with all API providers.
 *
 * @param filePath Path to the PDF file
 * @param options Optional page range (1-indexed, inclusive)
 */
// extractPDFPages：用 pdftoppm 把 PDF 每页渲染成 JPEG，支持按页码范围抽取，产物落在工具结果目录。
export async function extractPDFPages(
  filePath: string,
  options?: { firstPage?: number; lastPage?: number },
): Promise<PDFResult<PDFExtractPagesResult>> {
  try {
    const fs = getFsImplementation()
    const stats = await fs.stat(filePath)
    const originalSize = stats.size

    if (originalSize === 0) {
      return {
        success: false,
        error: { reason: 'empty', message: `PDF file is empty: ${filePath}` },
      }
    }

    if (originalSize > PDF_MAX_EXTRACT_SIZE) {
      return {
        success: false,
        error: {
          reason: 'too_large',
          message: `PDF file exceeds maximum allowed size for text extraction (${formatFileSize(PDF_MAX_EXTRACT_SIZE)}).`,
        },
      }
    }

    const available = await isPdftoppmAvailable()
// 先确认 pdftoppm 可用，不可用则返回明确的安装引导信息。
    if (!available) {
      return {
        success: false,
        error: {
          reason: 'unavailable',
          message:
            'pdftoppm is not installed. Install poppler-utils (e.g. `brew install poppler` or `apt-get install poppler-utils`) to enable PDF page rendering.',
        },
      }
    }

    const uuid = randomUUID()
    const outputDir = join(getToolResultsDir(), `pdf-${uuid}`)
    await mkdir(outputDir, { recursive: true })

    // pdftoppm produces files like <prefix>-01.jpg, <prefix>-02.jpg, etc.
    const prefix = join(outputDir, 'page')
    const args = ['-jpeg', '-r', '100']
    if (options?.firstPage) {
      args.push('-f', String(options.firstPage))
    }
    if (options?.lastPage && options.lastPage !== Infinity) {
      args.push('-l', String(options.lastPage))
    }
    args.push(filePath, prefix)
    const { code, stderr } = await execFileNoThrow('pdftoppm', args, {
      timeout: 120_000,
      useCwd: false,
    })

    if (code !== 0) {
      if (/password/i.test(stderr)) {
        return {
          success: false,
          error: {
            reason: 'password_protected',
            message:
              'PDF is password-protected. Please provide an unprotected version.',
          },
        }
      }
      if (/damaged|corrupt|invalid/i.test(stderr)) {
        return {
          success: false,
          error: {
            reason: 'corrupted',
            message: 'PDF file is corrupted or invalid.',
          },
        }
      }
      return {
        success: false,
        error: { reason: 'unknown', message: `pdftoppm failed: ${stderr}` },
      }
    }

    // Read generated image files and sort naturally
// 读取输出目录并按文件名排序得到图片文件列表，页数即图片数量。
    const entries = await readdir(outputDir)
    const imageFiles = entries.filter(f => f.endsWith('.jpg')).sort()
    const pageCount = imageFiles.length

    if (pageCount === 0) {
      return {
        success: false,
        error: {
          reason: 'corrupted',
          message: 'pdftoppm produced no output pages. The PDF may be invalid.',
        },
      }
    }

    const count = imageFiles.length

    return {
      success: true,
      data: {
        type: 'parts',
        file: {
          filePath,
          originalSize,
          outputDir,
          count,
        },
      },
    }
  } catch (e: unknown) {
    return {
      success: false,
      error: {
        reason: 'unknown',
        message: errorMessage(e),
      },
    }
  }
}
