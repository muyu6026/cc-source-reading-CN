export const DESCRIPTION =
  'Replace the contents of a specific cell in a Jupyter notebook.'
export const PROMPT = `Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file) with new source. Jupyter notebooks are interactive documents that combine code, text, and visualizations, commonly used for data analysis and scientific computing. The notebook_path parameter must be an absolute path, not a relative path. The cell_number is 0-indexed. Use edit_mode=insert to add a new cell at the index specified by cell_number. Use edit_mode=delete to delete the cell at the index specified by cell_number.`
// PROMPT：发给模型的工具说明。注意历史包袱——文案还在说 cell_number 0-indexed，
// 但现行 schema 已是 cell_id 字符串定位；insert/delete 语义同旧版。
