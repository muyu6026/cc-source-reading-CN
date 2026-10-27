import os
SRC='source'; ANN='annotated'
def walk(root):
    for b,_,fs in os.walk(root):
        for f in fs:
            yield os.path.relpath(os.path.join(b,f), root).replace(os.sep,'/')
src_files=list(walk(SRC))
def ann_path(rel):
    if rel=='package.json': return os.path.join(ANN,'package.json.annotated.md')
    if rel=='README.md': return os.path.join(ANN,'README.annotated.md')
    return os.path.join(ANN,rel)
def lc(p):
    try:
        with open(p,encoding='utf-8') as f:
            return sum(1 for _ in f)
    except: return 0
ann_lines=0; ann_files=0
src_lines_total=0; src_lines_done=0
for rel in src_files:
    sp=os.path.join(SRC,rel)
    if os.path.isfile(sp):
        n=lc(sp); src_lines_total+=n
        ap=ann_path(rel)
        if os.path.isfile(ap):
            ann_files+=1; ann_lines+=lc(ap); src_lines_done+=n
print('annotated src files:', ann_files)
print('annotated total lines (含中文批注行):', ann_lines)
print('source/src 总行数:', src_lines_total)
print('已覆盖 source 行数:', src_lines_done)
print('行数覆盖率(覆盖源行/总源行): %.1f%%' % (100*src_lines_done/src_lines_total))
print('README 口径(批注版总行/总源行): %.1f%%' % (100*ann_lines/src_lines_total))
