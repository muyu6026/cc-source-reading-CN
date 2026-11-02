import ast
import importlib.util
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# (slug, relative source path)
PAIRS = [
    ("src_utils_contentArray_ts", "src/utils/contentArray.ts"),
    ("src_utils_model_modelSupportOverrides_ts", "src/utils/model/modelSupportOverrides.ts"),
    ("src_utils_promptCategory_ts", "src/utils/promptCategory.ts"),
    ("src_utils_fpsTracker_ts", "src/utils/fpsTracker.ts"),
    ("src_utils_combinedAbortSignal_ts", "src/utils/combinedAbortSignal.ts"),
    ("src_utils_model_contextWindowUpgradeCheck_ts", "src/utils/model/contextWindowUpgradeCheck.ts"),
    ("src_utils_hash_ts", "src/utils/hash.ts"),
    ("src_utils_profilerBase_ts", "src/utils/profilerBase.ts"),
    ("src_utils_permissions_denialTracking_ts", "src/utils/permissions/denialTracking.ts"),
    ("src_utils_settings_validateEditTool_ts", "src/utils/settings/validateEditTool.ts"),
]

ANNOT_DIR = os.path.join(ROOT, "scripts", "_annot")
VALID_POS = {"before", "after", "after_block"}


def load(slug):
    path = os.path.join(ANNOT_DIR, f"{slug}_p1.py")
    spec = importlib.util.spec_from_file_location(slug, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def block_interior_lines(src_lines):
    """Return set of 1-indexed line numbers that are STRICT interior of a
    multi-line block comment (between /** and */, excluding open and close)."""
    interior = set()
    in_block = False
    for i, raw in enumerate(src_lines, start=1):
        s = raw.strip()
        if not in_block:
            if "/*" in raw and not "*/" in raw:
                in_block = True  # open line, not interior
            # single-line block /* ... */ : not interior, not flagged
        else:
            if "*/" in raw:
                in_block = False  # close line, not interior
            else:
                interior.add(i)
    return interior


def main():
    total_anchors = 0
    failures = 0
    for slug, rel in PAIRS:
        src_path = os.path.join(ROOT, "source", rel)
        with open(src_path, encoding="utf-8") as f:
            src_lines = f.read().split("\n")
        n = len(src_lines)
        interior = block_interior_lines(src_lines)

        mod = load(slug)
        assert hasattr(mod, "ANNOTATIONS"), f"{slug}: missing ANNOTATIONS"
        ann = mod.ANNOTATIONS
        assert isinstance(ann, list), f"{slug}: ANNOTATIONS not list"

        seen = set()
        for entry in ann:
            total_anchors += 1
            ok = True
            msg = ""
            if not (isinstance(entry, tuple) and len(entry) == 3):
                ok, msg = False, "entry not (line,pos,text)"
            else:
                ln, pos, txt = entry
                if not isinstance(ln, int):
                    ok, msg = False, f"line not int: {ln!r}"
                elif pos not in VALID_POS:
                    ok, msg = False, f"bad pos: {pos!r}"
                elif not (1 <= ln <= n):
                    ok, msg = False, f"line {ln} out of range [1,{n}]"
                elif (ln, pos) in seen:
                    ok, msg = False, f"dup anchor ({ln},{pos})"
                else:
                    seen.add((ln, pos))
                if isinstance(txt, str):
                    if '"' in txt:
                        ok, msg = False, f'text contains " at line {ln}'
                    if "\\" in txt:
                        ok, msg = False, f"text contains backslash at line {ln}"
                else:
                    ok, msg = False, f"text not str at line {ln}"
            # block interior check (exempt open/close + (1,'after'))
            if ok:
                if ln in interior:
                    ok, msg = False, f"anchor on block-comment interior line {ln} (pos={pos})"
            if not ok:
                failures += 1
                print(f"  FAIL {slug} [{rel}] {msg}")
                continue

        # ast.parse the data file itself
        dpath = os.path.join(ANNOT_DIR, f"{slug}_p1.py")
        src = open(dpath, encoding="utf-8").read()
        try:
            ast.parse(src)
        except SyntaxError as e:
            failures += 1
            print(f"  FAIL {slug} ast.parse: {e}")
            continue

        print(f"  OK   {slug}: {len(ann)} anchors, {n}-line source")

    print(f"\nTotal anchors: {total_anchors}, failures: {failures}")
    if failures:
        raise SystemExit(1)
    print("PRECHECK PASSED")


if __name__ == "__main__":
    main()
