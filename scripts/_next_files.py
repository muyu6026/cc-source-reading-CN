import os, sys
root = sys.argv[1] if len(sys.argv) > 1 else 'source/src/utils'
rows = []
for dp, dn, fn in os.walk(root):
    for f in fn:
        if f.endswith(('.ts', '.tsx', '.js')):
            p = os.path.join(dp, f)
            rel = os.path.relpath(p, 'source').replace(os.sep, '/')
            n = sum(1 for _ in open(p, encoding='utf-8', errors='replace'))
            if not os.path.exists(os.path.join('annotated', rel)):
                rows.append((n, rel))
rows.sort(reverse=True)
for n, rel in rows[: int(sys.argv[2]) if len(sys.argv) > 2 else 25]:
    print('%5d  %s' % (n, rel))
print('total missing', len(rows), 'lines', sum(r[0] for r in rows))
