#!/usr/bin/env python3
"""Safari 단어장 내보내기 코드(~/Downloads/vocab-export-*.txt) 읽기 전용 요약·비교 도구.

디코딩 = content/vocab/source.html 의 importDataStr/unpackWordMeta 와 동일:
  base64 → UTF-8 JSON {v:2, s:srsState, m:packWordMeta 문자열, a:오디오설정}
  m 은 '.'로 구분된 단어별 항목 'idx36|시도|실패|응답ms|hard|streak|manual|auto|daily~..|spaced~..|hook'
  (단어는 WORDS 배열 index 로만 저장되어 있어 단어명 대신 index 로 비교한다)
  ※ lastAttemptAt 은 내보내기에 들어가지 않으므로, 활동 날짜는 daily/spaced 날짜 필드에서 추정한다.
사용:
  python3 tools/vocab_compare.py                 ~/Downloads 의 모든 파일 요약 + 최신 둘 비교
  python3 tools/vocab_compare.py 다른코드.txt     최신 파일을 지정 파일과 비교
출력은 stdout 뿐이며 어떤 파일도 쓰지 않는다(브라우저 저장소도 건드리지 않음).
"""
import base64, glob, json, os, sys
from datetime import datetime, timezone

DAY = 86400000
MODES = ["flash", "quiz_ko", "quiz_en", "typed"]
TIERS = ["sure", "vague", "guess"]


def b36(v):
    """JS parseInt(v||'0',36)||0"""
    try:
        return int(v, 36) if v else 0
    except ValueError:
        return 0


def day_str(v):
    """fromDay: 일수(36진) → YYYY-MM-DD (UTC, 앱과 동일)"""
    n = b36(v)
    return datetime.fromtimestamp(n * DAY / 1000, timezone.utc).strftime("%Y-%m-%d") if n else ""


def ms_day(ms):
    return datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%d") if ms else ""


def decode(text):
    """importDataStr 와 동일: base64 → JSON. v2 가 아닌 구형은 srsState 자체."""
    data = json.loads(base64.b64decode(text.strip()).decode("utf-8"))
    return data


def parse_meta(packed):
    """unpackWordMeta 를 index 키 dict 로 복원 (필요한 필드만)."""
    out = {}
    if not isinstance(packed, str):
        return out
    for entry in packed.split("."):
        p = entry.split("|")
        if len(p) < 6:
            continue
        nums = lambda s: [b36(x) for x in (s or "").split(",")]
        dl = (p[8] if len(p) > 8 else "").split("~")
        sr = (p[9] if len(p) > 9 else "").split("~")
        dl += [""] * (14 - len(dl)); sr += [""] * (6 - len(sr))
        dates = set()
        for d in [dl[0]] + sr[0].split("_") + sr[1].split("_"):
            if d and day_str(d):
                dates.add(day_str(d))
        for v, unit in ((dl[9], 60000), (dl[10], 60000), (sr[3], DAY)):
            if v and b36(v):
                dates.add(ms_day(b36(v) * unit))
        out[b36(p[0])] = dict(
            att=nums(p[1]), fail=nums(p[2]),
            hard=p[4] == "1",
            hard_manual=(p[6] == "1") if len(p) > 6 and p[6] else False,
            dates=dates, succ=len([x for x in sr[0].split("_") if x]),
            fails_sp=len([x for x in sr[1].split("_") if x]),
        )
    return out


def load(path):
    d = decode(open(path, encoding="utf-8").read())
    if "s" in d:
        state, meta = d["s"], parse_meta(d.get("m", ""))
    else:  # 구형: srsState 만
        state, meta = d, {}
    return dict(path=path, state=state, meta=meta, ver=d.get("v"))


def summarize(x):
    """파일 하나의 요약 수치 dict"""
    st, mt = x["state"], x["meta"]
    tiers = {m: {t: 0 for t in TIERS} for m in MODES}
    mastered = {}
    for m in MODES:
        ns = st.get(m, {}) or {}
        mastered[m] = 0
        for w, s in ns.items():
            t = s.get("tier") or ("sure" if s.get("mastered") else "guess")
            tiers[m][t] = tiers[m].get(t, 0) + 1
            mastered[m] += 1 if s.get("mastered") else 0
    # state 는 단어명 키, meta 는 index 키라 섞어 세면 안 된다 → state 기준(없으면 meta)
    words = {w for m in MODES for w in (st.get(m) or {})} or set(mt)
    dates = sorted(set().union(*[v["dates"] for v in mt.values()])) if mt else []
    return dict(
        words=len(words), meta_words=len(mt), tiers=tiers, mastered=mastered,
        hard=sum(v["hard"] for v in mt.values()),
        att=sum(sum(v["att"]) for v in mt.values()),
        fail=sum(sum(v["fail"]) for v in mt.values()),
        last=dates[-1] if dates else "-", first=dates[0] if dates else "-", ndays=len(dates),
    )


def print_summary(x):
    s = summarize(x)
    print(f"[{os.path.basename(x['path'])}]  (형식 v{x['ver']})")
    print(f"  기록 있는 단어: {s['words']}개 (학습 메타 있는 단어 {s['meta_words']}개)")
    for m in MODES:
        t = s["tiers"][m]
        if sum(t.values()):
            print(f"  {m:8s} sure {t['sure']} / vague {t['vague']} / guess {t['guess']}  (마스터 {s['mastered'][m]})")
        else:
            print(f"  {m:8s} 기록 없음")
    print(f"  hard 표시: {s['hard']}개 | 총 시도 {s['att']} / 실패 {s['fail']}")
    print(f"  마지막 활동일(추정): {s['last']} | 활동 기간: {s['first']} ~ {s['last']} ({s['ndays']}일)")
    return s


def compare(new, old):
    """new 와 old 비교 (모드별 tier 변화, 신규/사라진 단어, 시도·실패 증감)"""
    a, b = summarize(new), summarize(old)
    print(f"\n=== 비교: {os.path.basename(old['path'])} → {os.path.basename(new['path'])} ===")
    for label, k in (("기록 단어", "words"), ("hard", "hard"), ("총 시도", "att"), ("총 실패", "fail")):
        print(f"  {label}: {b[k]} → {a[k]} ({a[k]-b[k]:+d})")
    print(f"  마지막 활동일: {b['last']} → {a['last']}")
    for m in MODES:
        on, nn = old["state"].get(m) or {}, new["state"].get(m) or {}
        added, removed = set(nn) - set(on), set(on) - set(nn)
        rank = {"guess": 0, "vague": 1, "sure": 2}
        tier = lambda s: s.get("tier") or ("sure" if s.get("mastered") else "guess")
        up = sum(1 for w in set(on) & set(nn) if rank[tier(nn[w])] > rank[tier(on[w])])
        down = sum(1 for w in set(on) & set(nn) if rank[tier(nn[w])] < rank[tier(on[w])])
        if added or removed or up or down:
            print(f"  {m}: 신규 {len(added)} / 사라짐 {len(removed)} / 등급 상승 {up} / 하락 {down}")
    om, nm = old["meta"], new["meta"]
    print(f"  메타: 신규 단어 {len(set(nm)-set(om))} / 사라진 단어 {len(set(om)-set(nm))}")
    if len(set(om) - set(nm)) or b["att"] > a["att"]:
        print("  주의: 새 파일이 이전보다 기록이 적음 (오래된 백업일 수 있음)")


def main():
    files = sorted(glob.glob(os.path.expanduser("~/Downloads/vocab-export-*.txt")))
    if not files:
        print("Safari 기록 파일 없음")
        return 0
    loaded = []
    for f in files:
        try:
            x = load(f); loaded.append(x); print_summary(x)
        except Exception as e:
            print(f"[{os.path.basename(f)}] 디코딩 실패: {e}")
    if not loaded:
        return 0
    # 최신 = 활동 날짜 → 시도 수 → 기록 단어 수 순으로 큰 것
    key = lambda x: (summarize(x)["last"], summarize(x)["att"], summarize(x)["words"])
    ranked = sorted(loaded, key=key)
    latest = ranked[-1]
    if len(sys.argv) > 1:
        other = load(os.path.expanduser(sys.argv[1]))
        compare(latest, other)
    elif len(ranked) > 1:
        compare(latest, ranked[-2])
    return 0


if __name__ == "__main__":
    sys.exit(main())
