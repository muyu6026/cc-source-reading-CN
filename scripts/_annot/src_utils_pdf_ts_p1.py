ANNOTATIONS = [
    (14, 'before', """PDFError：PDF 读取或解析失败时的结构化错误，reason 区分空文件、过大、加密、损坏、未知、不可用等情形。"""),
    (25, 'before', """PDFResult：PDF 操作的统一返回类型，成功携带数据，失败携带 PDFError。"""),
    (34, 'before', """readPDF：把 PDF 文件读成 base64 数据，先做空文件、大小上限、PDF 魔数头校验再编码。"""),
    (50, 'after', """空文件直接返回 empty 错误，避免后续无意义的读取与编码。"""),
    (60, 'after', """超过目标原始大小上限（约 20MB）时返回 too_large，给对话上下文留出空间。"""),
    (77, 'after', """校验文件头前 5 字节是否为 %PDF-，防止把 HTML 等非 PDF 文件混入对话上下文导致后续 API 全部 400。"""),
    (119, 'before', """getPDFPageCount：借助 poppler 的 pdfinfo 读取页数，工具不可用或无法解析时返回 null。"""),
    (160, 'before', """isPdftoppmAvailable：检测 poppler 的 pdftoppm 是否可用，结果在进程生命周期内缓存。"""),
    (179, 'before', """extractPDFPages：用 pdftoppm 把 PDF 每页渲染成 JPEG，支持按页码范围抽取，产物落在工具结果目录。"""),
    (205, 'after', """先确认 pdftoppm 可用，不可用则返回明确的安装引导信息。"""),
    (262, 'after', """读取输出目录并按文件名排序得到图片文件列表，页数即图片数量。"""),
]
