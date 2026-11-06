/**
 * Binary file extensions to skip for text-based operations.
 * These files can't be meaningfully compared as text and are often large.
 */
// 按后缀拦是最便宜的一层预筛：命中的文件直接跳过比较与读取，不必先读进来再判内容
export const BINARY_EXTENSIONS = new Set([
  // Images
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.webp',
  '.tiff',
  '.tif',
// 分组注释就是这张表的分类依据：图片、视频、音频、压缩包、可执行、文档、字体、字节码、数据库、设计稿、锁文件
  // Videos
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.wmv',
  '.flv',
  '.m4v',
  '.mpeg',
  '.mpg',
  // Audio
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.aac',
  '.m4a',
  '.wma',
  '.aiff',
  '.opus',
  // Archives
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.7z',
  '.rar',
  '.xz',
  '.z',
  '.tgz',
  '.iso',
  // Executables/binaries
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.o',
  '.a',
  '.obj',
  '.lib',
  '.app',
  '.msi',
  '.deb',
  '.rpm',
// PDF 在这张表里，但读文件工具在调用点单独放行它——两处口径不同是刻意的，注释写在这里防止有人「顺手统一」
  // Documents (PDF is here; FileReadTool excludes it at the call site)
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  // Fonts
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.eot',
// 字节码与虚拟机产物也算二进制：它们是编译输出，拿去做文本比较只会得到噪声
  // Bytecode / VM artifacts
  '.pyc',
  '.pyo',
  '.class',
  '.jar',
  '.war',
  '.ear',
  '.node',
  '.wasm',
  '.rlib',
// 数据库后缀带上索引与锁文件：这类文件由引擎自己维护，不该被当成可编辑文本
  // Database files
  '.sqlite',
  '.sqlite3',
  '.db',
  '.mdb',
  '.idx',
// 设计稿与三维工程文件：体积大且格式封闭，当文本读出来是一堆乱码
  // Design / 3D
  '.psd',
  '.ai',
  '.eps',
  '.sketch',
  '.fig',
  '.xd',
  '.blend',
  '.3ds',
  '.max',
  // Flash
  '.swf',
  '.fla',
// 锁文件与数据集：二进制锁、以及常见的资源容器后缀，命中率不高但误判代价很大
  // Lock/profiling data
  '.lockb',
  '.dat',
  '.data',
])

/**
 * Check if a file path has a binary extension.
 */
// 后缀判定只取最后一个点之后：多段后缀（如 tar 加 gz）会命中最后一段，结果仍然正确
export function hasBinaryExtension(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  return BINARY_EXTENSIONS.has(ext)
}

/**
 * Number of bytes to read for binary content detection.
 */
// 探测窗口八千字节：够看清文件头，也不至于为了判个类型就把大文件读进内存
const BINARY_CHECK_SIZE = 8192

/**
 * Check if a buffer contains binary content by looking for null bytes
 * or a high proportion of non-printable characters.
 */
// 两道判据：出现空字节直接判死，否则看不可打印字符的占比
export function isBinaryContent(buffer: Buffer): boolean {
  // Check first BINARY_CHECK_SIZE bytes (or full buffer if smaller)
// 短文件按实际长度算：除以固定窗口会算出偏低的占比，把二进制误判成文本
  const checkSize = Math.min(buffer.length, BINARY_CHECK_SIZE)

  let nonPrintable = 0
  for (let i = 0; i < checkSize; i++) {
    const byte = buffer[i]!
    // Null byte is a strong indicator of binary
// 空字节是最强信号：任何文本编码都不会在正文里放 NUL，出现一个就足够定论
    if (byte === 0) {
      return true
    }
    // Count non-printable, non-whitespace bytes
    // Printable ASCII is 32-126, plus common whitespace (9, 10, 13)
// 制表、换行、回车三种空白必须排除：缩进密集的源码里控制字符不少，不排除会成片误判
    if (
      byte < 32 &&
      byte !== 9 && // tab
      byte !== 10 && // newline
      byte !== 13 // carriage return
    ) {
      nonPrintable++
    }
  }

  // If more than 10% non-printable, likely binary
// 一成是不可打印字符的经验阈值：正常文本里偶发的控制字符到不了这个量级
  return nonPrintable / checkSize > 0.1
}
