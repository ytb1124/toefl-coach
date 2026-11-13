#!/usr/bin/env python3
"""FM-TOEFL 2026 真题 전사본(54회)에서 2회 이상 반복된 문제를 풀 수 있는 형태로 내보낸다.
입력: ../voca/2026真题_작업도구/w/raw/T{NN}_{L,R,W,S}.md  (중복 판정은 그 폴더의 tools2/dups.py와 같은 규칙)
출력(비공개 — 원문 저작물이라 gitignore된 private/zhan/ 에만): dups.json · dups.js (window.ZHAN_DUPS)
실행: python3 tools/fm_dups.py
그룹 하나 = 같은 문제가 2회 이상 나온 것. 그룹의 문항·정답은 전사가 가장 온전한 출현에서 가져오고, 다른 출현에만 있는 문항은 합친다.
"""
import json
import os
import re
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOCA = os.path.abspath(os.path.join(ROOT, '..', 'voca', '2026真题_작업도구'))
sys.path.insert(0, os.path.join(VOCA, 'tools2'))
import common as C  # noqa: E402
import dups as D  # noqa: E402

RAW = os.path.join(VOCA, 'w', 'raw')
OUT = os.path.join(ROOT, 'private', 'zhan')
BAD = {'notread', 'partial', 'truncated'}
SECTION = {'L1': 'task1', 'L2': 'conv', 'L3': 'talk', 'R1': 'ctest', 'R2': 'daily', 'R3': 'academic',
           'W1': 'build', 'S2': 'interview', 'S3': 'scenario'}
LETTERS = 'ABCD'


def clean(s):
    return re.sub(r'\s+', ' ', s or '').strip()


def letter(ans):
    m = re.match(r'\s*([A-D])\b', ans or '')
    return m.group(1) if m else None


def split_inline_opts(b):
    """'A. x B. y C. z D. w' 한 줄로 전사된 보기를 풀어 준다 (파서는 A만 잡음)."""
    if len(b.opts) >= 4:
        return [clean(b.opts.get(k, '')) for k in LETTERS]
    joined = ' '.join(f'{k}. {v}' for k, v in sorted(b.opts.items()))
    parts = re.split(r'(?:(?<=\s)|^)([A-D])\.\s+', joined)
    got = {}
    for i in range(1, len(parts) - 1, 2):
        got.setdefault(parts[i], clean(parts[i + 1]))
    return [got.get(k, '') for k in LETTERS] if len(got) >= 2 else [clean(b.opts.get(k, '')) for k in LETTERS]


def question_of(b):
    opts = split_inline_opts(b)
    q = clean(C.strip_markup(b.fields.get('question', '')) if '[' not in b.fields.get('question', '') else b.fields.get('question', ''))
    return {'n': b.qnum, 'q': q, 'opts': opts, 'ans': letter(b.fields.get('answer', ''))}


def same_question(a, b):
    oa = tuple(C.norm_key(x) for x in a['opts'])
    ob = tuple(C.norm_key(x) for x in b['opts'])
    if sum(1 for x in oa if x) >= 3 and oa == ob:
        return True
    ta, tb = set(C.norm_tokens(a['q'])), set(C.norm_tokens(b['q']))
    if not ta or not tb:
        return False
    return len(ta & tb) / len(ta | tb) >= 0.8


def attach_blocks(blocks):
    """build_units의 세트형(대화·강의·지문) 묶기를 그대로 따라, 단위 → 소속 블록(질문 포함)을 만든다."""
    byfile = defaultdict(list)
    for b in blocks:
        byfile[b.file].append(b)
    owner = {}   # (file, normkey) -> {'head': block, 'qs': [blocks]}
    for fn, bl in byfile.items():
        local, seen = [], {}
        for b in bl:
            if b.kind == 'notread' or b.kind not in C.SET_KINDS:
                continue
            txt = C.strip_markup(C.strip_speakers(b.main_text())) if b.main_text() and not C.SAME.search(b.main_text()) else ''
            if txt and len(C.norm_tokens(txt)) >= 3 and not C.POINTER.match(txt):
                k = C.norm_key(txt)
                if k in seen:
                    u = seen[k]
                else:
                    u = {'head': b, 'qs': []}
                    seen[k] = u
                    owner[(fn, k)] = u
                    local.append(u)
                if 'question' in b.fields:
                    u['qs'].append(b)
            else:
                tgt = None
                m = re.search(r'same as (?:Set \d+ passage|Q?(\d+))', b.same_as or '', re.I)
                if m and m.group(1):
                    n = int(m.group(1))
                    tgt = next((u for u in local if any(q.qnum == n for q in u['qs']) or u['head'].qnum == n), None)
                if tgt is None and local:
                    tgt = local[-1]
                if tgt is not None and 'question' in b.fields:
                    tgt['qs'].append(b)
    return owner


def scenario_questions(blocks, unit):
    """S3: 시나리오(세트 설명) 블록 뒤에 이어지는 문항들 — Interview 질문 또는 Listen and Repeat 문장 (다음 세트 설명 전까지)."""
    bl = [b for b in blocks if b.file == unit.file]
    key = C.norm_key(unit.text)
    start = next((i for i, b in enumerate(bl) if b.qnum == 0 and C.norm_key(C.strip_markup(b.main_text())) == key), None)
    if start is None:
        return []
    out = []
    for b in bl[start + 1:]:
        if b.qnum == 0:
            if C.norm_key(C.strip_markup(b.main_text())) and 'intro' not in getattr(b, 'header', '').lower():
                break
            continue
        t = clean(b.fields.get('interviewer', '') or b.fields.get('script', '') or b.main_text())
        if t and 'MISSING' not in t:
            out.append(t)
    return out


def main():
    blocks, _ = C.parse_all(RAW)
    units = C.build_units(blocks)
    owner = attach_blocks(blocks)
    t1 = {}
    for b in blocks:
        if b.kind == 'task1':
            q = C.strip_markup(C.strip_speakers(b.fields.get('script', '') or b.fields.get('text', '')))
            ans = b.fields.get('answer', '').strip()[:1]
            if q:
                t1[(b.test, b.qnum, b.file)] = (q, b.opts.get(ans, ''), b)
    groups_out = []
    for key, title, sec, kinds in D.CATS:
        if key not in SECTION:
            continue
        if key == 'L1':
            its = []
            for (t, qn, fn), (q, at, b) in sorted(t1.items()):
                u = C.Unit(t, 'L', 'task1', q + ' || ' + at, fn)
                u.qs = [qn]
                u.block = b
                u.flags |= b.flags
                its.append(u)
        else:
            its = [u for u in units if u.sec == sec and u.kind in kinds]
        its = [u for u in its if not (u.flags & {'notread'})]
        its.sort(key=lambda u: (u.test, u.qs[0] if u.qs else 0))
        items = [(u, D.sigs(u.text)) for u in its]
        groups, partial = D.cluster(items, 0.8)
        multi = [g for g in groups if len(g) > 1]
        recs = []
        for g in multi:
            mem = sorted((items[i][0] for i in g), key=lambda u: (u.test, u.qs[0] if u.qs else 0))
            recs.append((len({u.test for u in mem}), len(mem), mem, any(i in partial for i in g)))
        recs.sort(key=lambda r: (-r[0], -r[1], r[2][0].test, r[2][0].qs[0] if r[2][0].qs else 0))
        for nt, n, mem, part in recs:
            where = [u.src() for u in mem]
            # 전사본이 늘어도 바뀌지 않는 id: 구분 + 가장 이른 출현 위치 (예: L1-T06Q10)
            gid = key + '-' + re.sub(r'[^A-Za-z0-9]', '', where[0].replace(' ' + mem[0].sec + ' ', ''))

            def quality(u):
                bad = len(u.flags & BAD)
                return (bad, -len(u.text), -u.test)
            best = min(mem, key=quality)
            g = {'id': gid, 'cat': key, 'kind': SECTION[key], 'n': n, 'nt': nt, 'where': where, 'partial': part,
                 'tests': sorted({u.test for u in mem})}
            if key == 'L1':
                b = best.block
                opts = split_inline_opts(b)
                g.update(script=clean(b.fields.get('script', '') or b.fields.get('text', '')), qs=[{'n': b.qnum, 'q': '', 'opts': opts, 'ans': letter(b.fields.get('answer', ''))}])
            elif key in ('L2', 'L3', 'R2', 'R3', 'R1'):
                heads = []
                qmap = []   # (score, 문항, 회차) 목록
                for u in mem:
                    o = owner.get((u.file, C.norm_key(u.text)))
                    if not o:
                        continue
                    heads.append((quality(u), o['head']))
                    for qb in o['qs']:
                        qq = question_of(qb)
                        if not qq['q']:
                            continue
                        # 같은 문항 판정: 보기 네 개가 같거나, 질문이 같거나, 질문 단어가 80% 이상 겹치면 하나로 (전사본마다 오타·표기가 다름)
                        score = (qq['ans'] is not None, sum(1 for x in qq['opts'] if x), len(qq['q']))
                        hit = next((e for e in qmap if same_question(e[1], qq)), None)
                        if hit is None:
                            qmap.append((score, qq, u.test))
                        elif score > hit[0]:
                            qmap[qmap.index(hit)] = (score, qq, u.test)
                head = min(heads, key=lambda x: x[0])[1] if heads else None
                body = head.main_text() if head else best.text
                if key == 'R1':
                    g.update(passage=clean(body), answer=clean(head.fields.get('answer', '') or head.fields.get('answers', '')) if head else '')
                else:
                    g.update(passage=body.strip() if key in ('R2', 'R3') else None)
                    g['script'] = clean(C.strip_markup(C.strip_speakers(body))) if key in ('L2', 'L3') else None
                    g['qs'] = [v[1] for v in sorted(qmap, key=lambda v: (v[2], v[1]['n']))]
                    # 같은 지문 안의 순서: 가장 많은 문항을 가진 출현의 번호 순
                    g['qs'].sort(key=lambda q: q['n'])
                    if key in ('L2', 'L3'):
                        g['script'] = clean(C.strip_markup(C.strip_speakers(body)))
            elif key == 'W1':
                b = next((bb for bb in blocks if bb.file == best.file and bb.kind == 'build' and bb.qnum == best.qs[0]), None)
                g.update(speaker=clean(b.fields.get('speaker', '')) if b else '', chips=clean(b.fields.get('chips', '')) if b else '',
                         answer=clean(b.fields.get('answer', '')) if b else best.text)
            elif key == 'S2':
                g.update(question=best.text)
            elif key == 'S3':
                g.update(prompt=best.text, questions=scenario_questions(blocks, best))
            groups_out.append(g)
    # 수집 요약
    os.makedirs(OUT, exist_ok=True)
    data = {'v': 1, 'groups': groups_out}
    with open(os.path.join(OUT, 'dups.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    with open(os.path.join(OUT, 'dups.js'), 'w', encoding='utf-8') as f:
        f.write('window.ZHAN_DUPS=' + json.dumps(data, ensure_ascii=False) + ';\n')
    by = defaultdict(int)
    for g in groups_out:
        by[g['cat']] += 1
    print('그룹', len(groups_out), dict(by))
    noans = [g['id'] for g in groups_out if g.get('qs') and any(q['ans'] is None for q in g['qs'])]
    bad_opts = [g['id'] for g in groups_out if g.get('qs') and any(sum(1 for o in q['opts'] if o) < 3 for q in g['qs'])]
    print('정답 없는 문항이 있는 그룹', len(noans), noans[:15])
    print('보기가 3개 미만인 문항이 있는 그룹', len(bad_opts), bad_opts[:15])


if __name__ == '__main__':
    main()
