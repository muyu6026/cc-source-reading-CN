# -*- coding: utf-8 -*-
"""Rename batch-63 data files from <slug>.py to <slug>_p1.py so annotate.py's
glob (slug + '_p' + ... + '.py') matches them. Paths kept in this file only."""
import os

ROOT = 'D:/CC泄露源码分析'
D = os.path.join(ROOT, 'scripts', '_annot')

SLUGS = [
    'src_utils_powershell_staticPrefix_ts',
    'src_utils_settings_mdm_settings_ts',
    'src_utils_skills_skillChangeDetector_ts',
    'src_utils_swarm_backends_types_ts',
    'src_utils_hooks_AsyncHookRegistry_ts',
    'src_utils_format_ts',
    'src_utils_cron_ts',
    'src_utils_task_framework_ts',
    'src_utils_agenticSessionSearch_ts',
    'src_utils_plugins_dependencyResolver_ts',
]

for s in SLUGS:
    old = os.path.join(D, s + '.py')
    new = os.path.join(D, s + '_p1.py')
    if os.path.exists(old):
        os.rename(old, new)
        print('renamed', s)
    else:
        print('MISSING', s)
