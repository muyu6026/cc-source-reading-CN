import os
tot_f = tot_l = ann_f = ann_l = 0
for dp, dn, fn in os.walk('source/src'):
    for f in fn:
        p = os.path.join(dp, f)
        rel = os.path.relpath(p, 'source').replace(os.sep, '/')
        n = sum(1 for _ in open(p, encoding='utf-8', errors='replace'))
        tot_f += 1
        tot_l += n
        if os.path.exists(os.path.join('annotated', rel)):
            ann_f += 1
            ann_l += n
print('annotated %d / %d files' % (ann_f, tot_f))
print('annotated %d / %d lines' % (ann_l, tot_l))
print('pct %.1f%%' % (ann_l * 100.0 / tot_l))
print('remain %d files' % (tot_f - ann_f))
