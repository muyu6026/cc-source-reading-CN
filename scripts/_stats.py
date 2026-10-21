import os, sys, json

FILES = [
 'src/services/oauth/crypto.ts',
 'src/services/oauth/getOauthProfile.ts',
 'src/services/oauth/index.ts',
 'src/services/oauth/auth-code-listener.ts',
 'src/services/oauth/client.ts',
 'src/services/tools/toolOrchestration.ts',
 'src/services/tools/StreamingToolExecutor.ts',
 'src/services/tools/toolHooks.ts',
 'src/services/tools/toolExecution.ts',
 'src/services/mcp/MCPConnectionManager.tsx',
]

def slug(rel):
    return rel.replace('/', '_').replace('.', '_').replace('-', '_')

def nlines(p):
    with open(p, encoding='utf-8') as f:
        return sum(1 for _ in f)

tot_a = tot_b = tot_anchor = 0
for rel in FILES:
    a = os.path.join('source', rel)
    b = os.path.join('annotated', rel)
    na, nb = nlines(a), nlines(b)
    dat = os.path.join('scripts/_annot', slug(rel) + '_p1.py')
    anch = open(dat, encoding='utf-8').read().count("'before'") + open(dat, encoding='utf-8').read().count("'after'")
    print(f'{rel:50s} {na:5d} -> {nb:5d}  +{nb-na:4d}  {anch:2d} 锚点')
    tot_a += na; tot_b += nb; tot_anchor += anch
print('-'*80)
print(f'合计 {len(FILES)} 文件  {tot_a} -> {tot_b} 行  +{tot_b-tot_a}  锚点 {tot_anchor}')
