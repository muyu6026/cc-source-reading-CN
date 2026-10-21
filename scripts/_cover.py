import os, collections

def walk(root):
    out = set()
    for dp, dn, fn in os.walk(root):
        for f in fn:
            full = os.path.join(dp, f)
            out.add(os.path.relpath(full, root).replace(os.sep, '/'))
    return out

def nlines(p):
    with open(p, encoding='utf-8') as f:
        return sum(1 for _ in f)

SRC = 'source/src/services'
ANN = 'annotated/src/services'
src = walk(SRC)
ann = walk(ANN)
done = src & ann
miss = src - ann
extra = ann - src

print(f'source/src/services 文件 {len(src)}')
print(f'annotated 已有       {len(done)}')
print(f'缺失                 {len(miss)}')
if extra:
    print(f'多余(不在 source)    {len(extra)}: {sorted(extra)[:5]}')

def group(rel):
    parts = rel.split('/')
    return parts[0] if len(parts) > 1 else '(根目录)'

g = collections.defaultdict(lambda: [0, 0, 0, 0])  # 总文件, 总行, 完成文件, 完成行
for r in src:
    n = nlines(os.path.join(SRC, r))
    k = group(r)
    g[k][0] += 1; g[k][1] += n
    if r in done:
        g[k][2] += 1; g[k][3] += n

print()
print(f'{"子目录":28s} {"文件":>12s} {"行数":>14s}  状态')
for k in sorted(g, key=lambda x: -(g[x][1] - g[x][3])):
    t, tl, d, dl = g[k]
    flag = '✅' if d == t else ('⬜' if d == 0 else '🟡')
    print(f'{k:28s} {d:4d}/{t:<4d} {dl:6d}/{tl:<7d} {flag}')

tot_files = sum(v[0] for v in g.values())
tot_lines = sum(v[1] for v in g.values())
done_files = sum(v[2] for v in g.values())
done_lines = sum(v[3] for v in g.values())
print()
print(f'services/ 合计: {done_files}/{tot_files} 文件, {done_lines}/{tot_lines} 行 ({done_lines*100//tot_lines}%)')
print()
print('--- 未做文件（按行数降序，前 40）---')
rs = sorted(miss, key=lambda r: -nlines(os.path.join(SRC, r)))
for r in rs[:40]:
    print(f'{nlines(os.path.join(SRC, r)):6d}  {r}')
