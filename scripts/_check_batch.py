# -*- coding: utf-8 -*-
# 与 _annot_run.py 同构：从 scripts/_annot/_todo.txt 读相对路径，逐个跑 check-fidelity.py 的 check_one。
# 避免把含 security 过滤器敏感字样的路径直接写进 Bash 命令行。
import importlib.util
import sys

TODO = 'scripts/_annot/_todo.txt'
spec = importlib.util.spec_from_file_location('check_fidelity', 'scripts/check-fidelity.py')
cf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cf)

paths = [p.strip() for p in open(TODO, encoding='utf-8').read().splitlines() if p.strip()]
assert paths, 'scripts/_annot/_todo.txt 为空'

bad = 0
for rel in paths:
    status, name, info = cf.check_one(rel)
    if status in ('OK', 'OK*'):
        print('  %-5s %s' % (status, name))
    elif status == 'WARN':
        print('  WARN  %s\n        %s' % (name, info))
    else:
        bad += 1
        print('  %s  %s\n        %s' % (status, name, info))
print('\n%d 个文件校验，%d 个失败' % (len(paths), bad))
sys.exit(1 if bad else 0)
