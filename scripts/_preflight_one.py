"""单个数据文件预检：slug/pos/行号/重复锚点/引号反斜杠/ast 全通过"""
import importlib.util, ast, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = sys.argv[1]
rel = sys.argv[2]

slug = rel.replace('/', '_').replace('.', '_')
stem = os.path.basename(DATA)[:-3]
assert stem.startswith(slug + '_p'), (slug, DATA)

src_path = os.path.join(ROOT, 'source', rel)
with open(src_path, encoding='utf-8') as f:
    src_lines = f.read().split('\n')
src_n = len(src_lines)

with open(DATA, encoding='utf-8') as f:
    ast.parse(f.read())

spec = importlib.util.spec_from_file_location('d', DATA)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
ann = mod.ANNOTATIONS

assert isinstance(ann, list), 'ANNOTATIONS 不是 list'
seen = set()
for item in ann:
    assert isinstance(item, tuple) and len(item) == 3, ('结构错误', item)
    ln, pos, txt = item
    assert pos in ('before', 'after', 'after_block'), ('pos 非法', pos)
    assert isinstance(ln, int) and 1 <= ln <= src_n, ('行号越界', ln, src_n)
    assert (ln, pos) not in seen, ('重复锚点', ln, pos)
    seen.add((ln, pos))
    assert isinstance(txt, str) and txt.strip(), ('文本空', ln)
    assert '"' not in txt, ('含英文双引号', ln)
    assert '\\' not in txt, ('含反斜杠', ln)

print('OK  %s' % rel)
print('  anchors = %d / src lines = %d' % (len(ann), src_n))
