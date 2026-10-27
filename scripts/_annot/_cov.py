import os
SRC = 'source'
ANN = 'annotated'

def walk(root):
    for b, _, fs in os.walk(root):
        for f in fs:
            yield os.path.relpath(os.path.join(b, f), root).replace(os.sep, '/')

src_files = list(walk(SRC))

def ann_exists(rel):
    if rel == 'package.json':
        return os.path.exists(os.path.join(ANN, 'package.json.annotated.md'))
    if rel == 'README.md':
        return os.path.exists(os.path.join(ANN, 'README.annotated.md'))
    return os.path.exists(os.path.join(ANN, rel))

total = len(src_files)
done = sum(1 for r in src_files if ann_exists(r))
print('source 文件总数:', total, '已批注:', done, '占比 %.1f%%' % (100 * done / total))

src_all = [r for r in src_files if r.startswith('src/')]
src_done = sum(1 for r in src_all if ann_exists(r))
print('source/src 总数:', len(src_all), '已批注:', src_done, '还剩:', len(src_all) - src_done)

su_all = [r for r in src_files if r.startswith('src/utils/')]
su_done = sum(1 for r in su_all if ann_exists(r))
print('src/utils 总数:', len(su_all), '已批注:', su_done, '还剩:', len(su_all) - su_done)
