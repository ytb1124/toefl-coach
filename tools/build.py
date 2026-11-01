#!/usr/bin/env python3
"""Build pipeline: QA-check content, synthesize audio (Kokoro + ffmpeg), bundle app/content.js.

Content sources (all merged):
  content/skills.json            8 skills
  content/originals.json         TPO2–4 original errors — metadata only (원문은 private/zhan/originals/)
  content/tests/<ID>.json        every later mock test added through the intake procedure (CLAUDE.md) — metadata only
  content/pool.json              소站 TPO独家 연습 문제 메타데이터 (tools/zhan_pool.py가 생성; 원문은 private/zhan/pool.json)
  content/sw.json                speaking·writing part (tutor corrections, L&R, interview, email, discussion)
  private/zhan/originals/*.json  원본 오답의 원문 필드·재구성 스크립트 (비공개 저장소; 없으면 원문 검사를 건너뜀)

Outputs: app/content.js (공개 — 원문 문자열이 없는지 빌드가 검사), private/zhan/orig.js·orig.json (비공개),
재구성 음성은 private/zhan/tts/, 말하기 음성(SW-*)은 audio/.

Usage:
  python3 tools/build.py            # check + audio + bundle
  python3 tools/build.py --check    # QA only
  python3 tools/build.py --no-audio # skip TTS (bundle with existing audio)
  python3 tools/build.py --force-audio
"""
import datetime
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
AUDIO = ROOT / "audio"
PRIV = ROOT / "private" / "zhan"
TTS = PRIV / "tts"
APP = ROOT / "app"

# Speaker role -> Kokoro voice (a* = American, b* = British). 원본 음원이 없을 때만 쓰는 음성 (OVERHAUL.md 원칙 6).
VOICES = {
    "N": "af_heart",       # narrator (US)
    "W": "af_bella",       # woman (US)
    "M": "am_michael",     # man (US)
    "W2": "bf_emma",       # woman (UK)
    "M2": "bm_george",     # man (UK)
}
RATE = 1.25         # Kokoro speed (사용자 설정: 1.25배)
KOKORO_PY = Path.home() / ".venvs" / "kokoro" / "bin" / "python"
GAP_LINE = 0.55     # pause between speakers / lines
GAP_SENT = 0.22     # pause between sentences of one line
SR = 22050


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def norm(s):
    s = s.lower().replace("’", "'").replace("—", " ").replace("–", " ")
    return re.sub(r"[^a-z0-9' ]+", " ", s).split()


def contains(hay, needle):
    """Every '…'-separated fragment of needle appears (as a word sequence) in hay."""
    h = " " + " ".join(norm(hay)) + " "
    for frag in re.split(r"…|\.\.\.", needle):
        words = norm(frag)
        if words and (" " + " ".join(words) + " ") not in h:
            return False
    return True


def audio_text(aset):
    return " ".join(l["t"] for l in aset["lines"])


ABBR = re.compile(r"\b(Dr|Mr|Mrs|Ms|St|Prof|Jr|Sr|vs|etc|e\.g|i\.e)\. ")


def split_sentences(text):
    protected = ABBR.sub(lambda m: m.group(1) + ".§§", text.strip())  # don't split after titles
    parts = re.split(r'(?<=[.!?])\s+(?=[A-Z"\'])', protected)
    return [p.replace("§§", " ") for p in parts if p.strip()]


# ---------------------------------------------------------------- loading
def merge_private(data, stem, d):
    """private/zhan/originals/<stem>.json의 원문 필드를 원본 오답·재구성 음성 세트에 합친다 (QA·비공개 번들용)."""
    f = PRIV / "originals" / f"{stem}.json"
    if not f.exists():
        return False
    pv = read_json(f)
    for o in d.get("originals", []):
        o.update(pv["originals"].get(o["id"], {}))
    for sid, a in (d.get("audioSets") or {}).items():
        a.update(pv["audioSets"].get(sid, {}))
    return True


def load_all():
    skills = read_json(CONTENT / "skills.json")["skills"]
    base = read_json(CONTENT / "originals.json")
    public = {"originals": [dict(o) for o in base["originals"]], "audioSets": {k: dict(v) for k, v in base["audioSets"].items()}}
    has_priv = merge_private(public, "originals", base)
    data = {
        "skills": skills,
        "tests": [dict(t, source="originals.json") for t in base["tests"]],
        "originals": list(base["originals"]),
        "public": public,
        "private": has_priv,
        "audioSets": dict(base["audioSets"]),
        "origAudio": set(base["audioSets"]),
        "files": {},
    }
    for f in sorted((CONTENT / "tests").glob("*.json")):
        add_test_file(data, f)
    data["tests"].sort(key=lambda t: t["date"])
    data["sw"] = read_json(CONTENT / "sw.json")
    # 소站 원문과 같은 쓰기 문제의 문제 문장은 private/zhan/sw_private.json에 (QA에는 합쳐서 쓰고, 공개 번들에는 넣지 않는다)
    swp = PRIV / "sw_private.json"
    data["swPrivate"] = read_json(swp) if swp.exists() else None
    data["swFull"] = json.loads(json.dumps(data["sw"]))
    for kind, m in (data["swPrivate"] or {}).items():
        for it in data["swFull"].get(kind, []):
            it.update(m.get(it["id"], {}))
    data["audioSets"].update(sw_audio_sets(data["sw"]))
    data["pool"] = read_json(CONTENT / "pool.json") if (CONTENT / "pool.json").exists() else {"papers": [], "sets": []}
    return data


def lr_text(sentence):
    return re.sub(r"\s*/\s*", " ", sentence).strip()


def sw_audio_sets(sw):
    """One audio set per Listen & Repeat set and per interview set: one sentence / question per line (one cue each)."""
    sets = {}
    for s in sw.get("lr", []):
        sets["SW-" + s["id"]] = {"title": "Listen & Repeat · " + s["title"], "lines": [{"v": s["voice"], "t": lr_text(t)} for t in s["sentences"]]}
    for s in sw.get("interview", []):
        sets["SW-" + s["id"]] = {"title": "Interview · " + s["title"], "lines": [{"v": s["voice"], "t": q["q"]} for q in s["qs"]]}
    return sets


def check_sw(sw, voices, skip_private=False):
    errs = []
    if skip_private:
        sw = dict(sw, email=[e for e in sw.get("email", []) if not e.get("private")], discussion=[e for e in sw.get("discussion", []) if not e.get("private")])
    cats = set(sw["cats"])
    ids = [x["id"] for k in ("grammar", "lr", "buildSentence", "interview", "email", "discussion", "ideas") for x in sw.get(k, [])]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        errs.append(f"sw: duplicate ids {sorted(dup)}")
    for g in sw["grammar"]:
        p = f"sw grammar {g['id']}"
        if g["cat"] not in cats:
            errs.append(f"{p}: unknown cat {g['cat']}")
        if not g.get("answers"):
            errs.append(f"{p}: no answers")
        elif " ".join(norm(g["wrong"])) in {" ".join(norm(a)) for a in g["answers"]}:
            errs.append(f"{p}: wrong sentence equals an answer")
        if not g.get("src"):
            errs.append(f"{p}: missing src")
    for s in sw["lr"] + sw["interview"]:
        if s["voice"] not in voices:
            errs.append(f"sw {s['id']}: unknown voice {s['voice']}")
    for s in sw["lr"]:
        for t in s["sentences"]:
            if len(split_sentences(lr_text(t))) != 1:
                errs.append(f"sw {s['id']}: must be exactly one sentence: {t!r}")
    for s in sw["interview"]:
        for q in s["qs"]:
            if q.get("type") not in ("STAR", "PREP"):
                errs.append(f"sw {s['id']}: question type must be STAR or PREP")
    for b in sw["buildSentence"]:
        p = f"sw buildSentence {b['id']}"
        blanks = b["template"].count("_")
        if blanks != len(b["answer"]):
            errs.append(f"{p}: {blanks} blanks but {len(b['answer'])} answer tiles")
        if set(b["answer"]) & set(b.get("extra", [])):
            errs.append(f"{p}: extra tile also in answer")
    for e in sw["email"]:
        if len(e.get("tasks", [])) != 3:
            errs.append(f"sw email {e['id']}: needs exactly 3 tasks")
    for d in sw["discussion"]:
        if len(d.get("students", [])) != 2:
            errs.append(f"sw discussion {d['id']}: needs 2 student posts")
    ads = {x["id"] for x in sw["discussion"]}
    for q in sw.get("ideas", []):
        p = f"sw ideas {q['id']}"
        if q.get("ad"):
            if q["ad"] not in ads:
                errs.append(f"{p}: unknown discussion {q['ad']}")
        elif not q.get("q") or len(q.get("students", [])) != 2:
            errs.append(f"{p}: needs q + 2 student posts, or ad")
        if len(q.get("angles", [])) < 3:
            errs.append(f"{p}: needs at least 3 angles")
        for an in q.get("angles", []):
            if an.get("side") not in ("+", "-", "0") or an.get("strategy") not in (1, 2) or not all(an.get(k) for k in ("who", "idea", "ex", "line")):
                errs.append(f"{p}: angle needs who/side(+/-/0)/strategy(1/2)/idea/ex/line")
        if not q.get("src"):
            errs.append(f"{p}: missing src")
    for r in sw["scan"]:
        if r["cat"] not in cats:
            errs.append(f"sw scan: unknown cat {r['cat']}")
        try:
            re.compile(r["re"].replace("(?i)", ""))
        except re.error as ex:
            errs.append(f"sw scan {r['re'][:40]}: bad regex ({ex})")
    return errs


def add_test_file(data, f):
    t = read_json(f)
    test = dict(t["test"], source=f"tests/{f.name}")
    if t.get("report"):
        test["report"] = t["report"]
    data["tests"].append(test)
    data["public"]["originals"] += [dict(o) for o in t.get("originals", [])]
    data["public"]["audioSets"].update({k: dict(v) for k, v in t.get("audioSets", {}).items()})
    data["private"] = merge_private(data["public"], f.stem, t) and data["private"]
    data["originals"] += t.get("originals", [])
    for k, v in t.get("audioSets", {}).items():
        data["audioSets"][k] = v
        data["origAudio"].add(k)
    data["files"][test["id"]] = f.name


# ---------------------------------------------------------------- QA
def check(data):
    errs = []
    skill_ids = {s["id"] for s in data["skills"]}
    audio_sets = data["audioSets"]

    # ---- tests ----
    test_ids = [t["id"] for t in data["tests"]]
    if len(set(test_ids)) != len(test_ids):
        errs.append("tests: duplicate test id")
    for t in data["tests"]:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", t.get("date", "")):
            errs.append(f"test {t['id']}: date must be YYYY-MM-DD")
        for k in ("reading", "listening", "ctest"):
            v = t.get(k)
            if v is not None and not (isinstance(v, list) and len(v) == 2 and 0 <= v[0] <= v[1]):
                errs.append(f"test {t['id']}: {k} must be [correct, total] or null")
        n = sum(1 for o in data["originals"] if o["test"] == t["id"])
        if t.get("errors") is not None and t["errors"] != n:
            errs.append(f"test {t['id']}: errors={t['errors']} but {n} originals recorded")
        rep = t.get("report")
        if rep:
            for f in rep.get("findings", []):
                if f.get("skill") not in skill_ids | {None}:
                    errs.append(f"test {t['id']}: report finding has unknown skill {f.get('skill')}")

    # ---- originals ----
    ids = [o["id"] for o in data["originals"]]
    if len(set(ids)) != len(ids):
        dup = {i for i in ids if ids.count(i) > 1}
        errs.append(f"originals: duplicate ids {sorted(dup)}")
    for o in data["originals"]:
        p = f"original {o['id']}"
        if o["test"] not in test_ids:
            errs.append(f"{p}: test {o['test']} not declared")
        if o.get("sec") not in ("R", "L"):
            errs.append(f"{p}: sec must be R or L")
        if o["skill"] not in skill_ids | {"UNKNOWN"}:
            errs.append(f"{p}: unknown skill {o['skill']}")
        for s in o.get("skills2", []):
            if s not in skill_ids:
                errs.append(f"{p}: unknown secondary skill {s}")
        for k in ("diff", "rule", "causeAI"):
            if o["skill"] != "UNKNOWN" and not o.get(k):
                errs.append(f"{p}: missing {k}")
        if not data["private"]:
            continue      # 원문이 이 환경에 없음 (비공개 저장소 없이 빌드) → 원문 검사 생략
        if "ctest" in o:
            c = o["ctest"]
            if c["text"].count("{{}}") != 1:
                errs.append(f"{p}: ctest needs exactly one {{{{}}}}")
            if not c["answer"].startswith(c["prefix"]):
                errs.append(f"{p}: answer does not start with prefix")
        elif o["skill"] != "UNKNOWN":
            n = len(o.get("options", []))
            if n < 2:
                errs.append(f"{p}: needs options (or ctest)")
            elif not (isinstance(o["correct"], int) and 0 <= o["correct"] < n):
                errs.append(f"{p}: bad correct index")
            elif o["my"] is not None and (not (0 <= o["my"] < n) or o["my"] == o["correct"]):
                errs.append(f"{p}: bad my index")
        if "audio" in o and o["audio"] not in audio_sets:
            errs.append(f"{p}: missing audio set {o['audio']}")
        # 재구성 음성이 없으면 소站 원본 음원과 연결돼 있어야 한다 (private/zhan/listen.json의 orig)
        if o["sec"] == "L" and o["skill"] != "UNKNOWN" and "audio" not in o and o["id"] not in zhan_linked():
            errs.append(f"{p}: listening original without audio")
        if o.get("audio") in audio_sets and o.get("evidence"):
            txt = audio_text(audio_sets[o["audio"]])
            ev = re.sub(r"^[MW]\d?: ", "", o["evidence"].split(" / ")[0])
            if len(txt.split()) > 12 and not contains(txt, ev):
                errs.append(f"{p}: evidence not found in transcript")
        if o.get("passage") and o.get("evidence") and "→" not in o["evidence"] and "=" not in o["evidence"] \
                and "—" not in o["evidence"] and not contains(o["passage"], o["evidence"]):
            errs.append(f"{p}: evidence not found in passage")

    # ---- 소站 연습 문제 메타데이터 ----
    pids = [x["id"] for x in data["pool"]["sets"]]
    if len(set(pids)) != len(pids):
        errs.append("pool: duplicate set id")
    for x in data["pool"]["sets"]:
        for q in x["qs"]:
            if x["sec"] in ("R", "L") and q.get("skill") not in skill_ids:
                errs.append(f"pool {q['id']}: unknown skill {q.get('skill')}")
    return errs


# ---------------------------------------------------------------- audio
def wav_seconds(path):
    # 16-bit mono PCM written by ffmpeg: duration = (bytes - 44 header) / (2 * SR)
    return max(0.0, (path.stat().st_size - 44) / (2 * SR))


def audio_dir(set_id, data):
    """재구성 음성(원본 오답 스크립트)은 비공개 private/zhan/tts/, 말하기 음성(SW-*)은 공개 audio/."""
    return TTS if set_id in data["origAudio"] else AUDIO


def tts_set(set_id, aset, force=False, out_dir=AUDIO):
    """Render one audio set sentence by sentence; write <id>.mp3 and <id>.cues.json (start/end per sentence)."""
    sig = hashlib.sha1(json.dumps([aset["lines"], VOICES, RATE, GAP_LINE, GAP_SENT, "kokoro1"]).encode()).hexdigest()[:12]
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{set_id}.mp3"
    cues_f = out_dir / f"{set_id}.cues.json"
    stamp = out_dir / f".{set_id}.sig"
    if out.exists() and cues_f.exists() and stamp.exists() and stamp.read_text() == sig and not force:
        return
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        gaps = {}
        for name, sec in (("line", GAP_LINE), ("sent", GAP_SENT)):
            g = td / f"gap_{name}.wav"
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"anullsrc=r={SR}:cl=mono",
                            "-t", str(sec), "-c:a", "pcm_s16le", str(g)], check=True)
            gaps[name] = (g, wav_seconds(g))
        jobs = []
        for li, line in enumerate(aset["lines"]):
            for si, sent in enumerate(split_sentences(line["t"])):
                jobs.append({"voice": VOICES[line["v"]], "text": sent, "out": str(td / f"{len(jobs)}.raw.wav")})
        subprocess.run([str(KOKORO_PY), str(ROOT / "tools" / "kokoro_render.py"), str(RATE)],
                       input=json.dumps(jobs), text=True, check=True, capture_output=True)
        parts, cues, t = [], [], 0.0
        k = 0
        for li, line in enumerate(aset["lines"]):
            sents = split_sentences(line["t"])
            for si, sent in enumerate(sents):
                raw, wav = td / f"{k}.raw.wav", td / f"{k}.wav"
                k += 1
                subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(raw), "-ar", str(SR), "-ac", "1",
                                "-c:a", "pcm_s16le", str(wav)], check=True)
                d = wav_seconds(wav)
                cues.append({"line": li, "start": round(t, 2), "end": round(t + d, 2), "t": sent})
                t += d
                gap = gaps["sent"] if si < len(sents) - 1 else gaps["line"]
                parts += [wav, gap[0]]
                t += gap[1]
        lst = td / "list.txt"
        lst.write_text("".join(f"file '{p}'\n" for p in parts))
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
                        "-ac", "1", "-ar", str(SR), "-b:a", "64k", str(out)], check=True)
    cues_f.write_text(json.dumps(cues, ensure_ascii=False))
    stamp.write_text(sig)
    print(f"  audio: {set_id}.mp3 ({len(cues)} sentences)")


def duration(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
                       capture_output=True, text=True)
    try:
        return round(float(r.stdout.strip()), 1)
    except ValueError:
        return None


def zhan_pool_links():
    """원본 오답 id → [소站 풀 세트 id, 문항 번호] (리스닝). 받아쓰기·2단계 듣기가 원본 음원을 쓰도록.
    private/zhan/listen.json의 orig 연결 → 같은 음원의 풀 세트 → 같은 질문 문장. 비공개 자료가 없으면 빈 dict."""
    lf, pf = ROOT / "private" / "zhan" / "listen.json", ROOT / "private" / "zhan" / "pool.json"
    if not lf.exists() or not pf.exists():
        return {}
    by_audio = {}
    for s in json.loads(pf.read_text())["sets"]:
        if s["sec"] != "L":
            continue
        by_audio.setdefault(s.get("audio"), []).append(s)
        for q in s["qs"]:
            if q.get("audio"):
                by_audio.setdefault(q["audio"], []).append(s)
    key = lambda t: re.sub(r"[^a-z]", "", (t or "").lower())
    out = {}
    for s in json.loads(lf.read_text())["sets"]:
        for q in s["qs"]:
            if not q.get("orig"):
                continue
            for ps in by_audio.get(s["audio"] if s["kind"] != "reply" else q.get("audio"), []):
                hit = [i for i, pq in enumerate(ps["qs"]) if key(pq.get("stem")) == key(q["stem"])]
                if hit:
                    out[q["orig"]] = [ps["id"], hit[0]]
                    break
    return out


def zhan_linked():
    """원본 id 중 소站 리스닝 오답과 연결된 것 (비공개 자료가 없는 환경이면 빈 집합)."""
    f = ROOT / "private" / "zhan" / "listen.json"
    if not f.exists():
        return set()
    return {q["orig"] for s in json.loads(f.read_text())["sets"] for q in s["qs"] if q.get("orig")}


def segment_for(cues, evidence):
    """[start, end] of the sentences that contain the evidence (for 'replay only the key part')."""
    if not cues:
        return None
    if len(cues) <= 2:
        # one short utterance (Listen & Reply): the whole clip is the key part
        return [0, cues[-1]["end"] + 0.25]
    if not evidence:
        return None
    frags = [f for f in re.split(r"…|\.\.\.| / ", evidence) if len(norm(f)) >= 2]
    hits = []
    for frag in frags:
        w = norm(re.sub(r"^[MW]\d?: ", "", frag))
        head, tail = " ".join(w[:5]), " ".join(w[-5:])
        for i, c in enumerate(cues):
            ct = " " + " ".join(norm(c["t"])) + " "
            if (" " + head + " ") in ct or (" " + tail + " ") in ct:
                hits.append(i)
    if not hits:
        return None
    a, b = min(hits), max(hits)
    return [max(0, cues[a]["start"] - 0.15), cues[b]["end"] + 0.25]


ARTIFACT_PAGE = """<title>TOEFL 교정 코치</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="color-scheme" content="light dark">
<link rel="stylesheet" href="app/styles.css">
<div id="app"></div>
<script src="app/content.js"></script>
<script src="app/engine.js"></script>
<script src="app/swcore.js"></script>
<script src="app/sync.js"></script>
<script src="app/store.js"></script>
<script src="app/vocab.js"></script>
<script src="app/sw.js"></script>
<script src="app/listen.js"></script>
<script src="app/hackers.js"></script>
<script src="app/write.js"></script>
<script src="app/speak.js"></script>
<script src="app/practice.js"></script>
<script src="app/read.js"></script>
<script src="app/kotrial.js"></script>
<script src="app/keep.js"></script>
<script src="app/ui.js"></script>
"""


# ---------------------------------------------------------------- leak check
def qnorm(t):
    """따옴표 모양 차이(’ ' “ ")로 검사를 빠져나가지 않게."""
    return t.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')


def leak_strings(data):
    """공개 번들에 있으면 안 되는 원문 문자열: 소站 지문·스크립트·문항·보기, 원본 오답 원문, C-Test 자료."""
    out = set()

    def add(t, min_len=40):
        t = qnorm(re.sub(r"\s+", " ", str(t or "")).strip())
        if len(t) >= min_len:
            out.add(t[:60])
    pool = PRIV / "pool.json"
    if pool.exists():
        for s in read_json(pool)["sets"]:
            for p in re.split(r"\n+", s.get("passage") or ""):
                add(p)
            for l in s.get("script") or []:
                add(l["t"])
            for q in s["qs"]:
                add(q.get("stem")); add(q.get("prompt")); add(q.get("model")); add(q.get("text"))
                for po in q.get("posts") or []:
                    add(po.get("text"))
                for c in q.get("choices") or []:
                    add(c)
    hk = PRIV / "hackers.json"   # 해커스 20일 완성 모범답안 전사본 (tools/hackers.py)
    if hk.exists():
        for x in read_json(hk)["items"]:
            for q in x["parts"]:   # 흔한 인사·맺음 문장("I look forward to your reply.")은 내 글에도 있어 짧은 것은 뺀다
                add(q["text"], 70)
            add(x.get("situation")); add((x.get("prof") or {}).get("text"))
            for st in x.get("students") or []:
                add(st.get("text"))
    for o in data["originals"]:
        add(o.get("passage")); add(o.get("stem"))
        for c in o.get("options") or []:
            add(c)
        if o.get("ctest"):
            add(o["ctest"]["text"].split("{{}}")[0][-80:])
    for sid in data["origAudio"]:
        for l in data["audioSets"][sid].get("lines", []):
            add(l["t"])
    return out


def leak_check(js, data):
    flat = qnorm(re.sub(r"\s+", " ", js.replace("\\n", " ")))
    hits = [t for t in leak_strings(data) if t in flat]
    # 패턴 검사: 비공개 자료가 없어도 잡히는 것 (C-Test 빈칸 표기, 소站 해설 원문, 리포트 HTML)
    for pat in (r"【\d+】", r"<m_p>", r"解析", r"正确答案"):
        if re.search(pat, js):
            hits.append("패턴 " + pat)
    return hits


# ---------------------------------------------------------------- main
def main():
    args = set(sys.argv[1:])
    data = load_all()
    errs = check(data) + check_sw(data["swFull"] if data["swPrivate"] else data["sw"], VOICES, skip_private=not data["swPrivate"])
    if errs:
        print("QA FAILED:")
        for e in errs:
            print("  -", e)
        sys.exit(1)
    n_orig = len(data["originals"])
    print(f"QA passed: {len(data['tests'])} tests, {n_orig} originals, {len(data['pool']['sets'])} pool sets"
          + ("" if data["private"] else " (비공개 원문 없음: 원문 검사 생략)"))
    if "--check" in args:
        return

    if "--no-audio" not in args:
        if not KOKORO_PY.exists() or not shutil.which("ffmpeg"):
            sys.exit(f"need Kokoro ({KOKORO_PY}) and ffmpeg for audio")
        AUDIO.mkdir(exist_ok=True)
        for sid, aset in data["audioSets"].items():
            if "lines" not in aset:
                continue          # 비공개 스크립트가 없는 환경
            tts_set(sid, aset, force="--force-audio" in args, out_dir=audio_dir(sid, data))

    audio_meta, priv_audio = {}, {}
    kokoro_note = "Kokoro 생성 (원본 음원 아님)"
    for sid, aset in data["audioSets"].items():
        aset = dict(aset, note=" · ".join(x for x in (aset.get("note", ""), kokoro_note) if x))
        d = audio_dir(sid, data)
        f, cf = d / f"{sid}.mp3", d / f"{sid}.cues.json"
        cues = read_json(cf) if cf.exists() else []
        if sid in data["origAudio"]:
            # 원본 오답 스크립트로 만든 음성: 공개 번들에는 경로·길이만, 스크립트·자막은 비공개 번들에
            audio_meta[sid] = {"src": f"private/zhan/tts/{sid}.mp3", "private": True, "dur": duration(f) if f.exists() else None,
                               "title": aset.get("title", ""), "note": aset.get("note", "")}
            priv_audio[sid] = {"lines": aset.get("lines", []), "cues": cues}
        else:
            audio_meta[sid] = {"src": f"audio/{sid}.mp3", "dur": duration(f) if f.exists() else None, "title": aset.get("title", ""),
                               "lines": aset["lines"], "cues": cues, "note": aset.get("note", "")}

    full = {o["id"]: o for o in data["originals"]}
    zq = zhan_pool_links()
    originals = []
    for o in data["public"]["originals"]:
        o = dict(o)
        fo = full[o["id"]]
        if o["id"] in zq:
            o["zq"] = zq[o["id"]]
        if fo.get("audio") and fo["audio"] in priv_audio:
            o["seg"] = segment_for(priv_audio[fo["audio"]]["cues"], fo.get("evidence"))
        originals.append(o)
    TEXT = ("stem", "options", "passage", "ctest", "evidence", "trap", "diff")
    if data["private"]:
        priv = {"originals": {o["id"]: {k: o[k] for k in TEXT if k in o} for o in data["originals"]}, "audio": priv_audio}
        pj = json.dumps(priv, ensure_ascii=False)
        (PRIV / "orig.json").write_text(pj + "\n", encoding="utf-8")
        if data["swPrivate"]:
            priv["sw"] = data["swPrivate"]
            pj = json.dumps(priv, ensure_ascii=False)
            (PRIV / "orig.json").write_text(pj + "\n", encoding="utf-8")
        (PRIV / "orig.js").write_text("/* 생성 파일 (tools/build.py). 원본 오답의 원문 — 공개 저장소에 올리지 않는다. */\nwindow.ZHAN_ORIG = " + pj + ";\n", encoding="utf-8")

    bundle = {
        "builtAt": datetime.datetime.now().isoformat(timespec="seconds"),
        "skills": data["skills"],
        "tests": data["tests"],
        "originals": originals,
        "pool": {"papers": data["pool"]["papers"], "sets": data["pool"]["sets"]},
        "audio": audio_meta,
        "sw": data["sw"],
    }
    js = "// Generated by tools/build.py — do not edit. Edit content/*.json instead.\nwindow.CONTENT = " + \
         json.dumps(bundle, ensure_ascii=False) + ";\n"
    leaks = leak_check(js, data)
    if leaks:
        print("LEAK CHECK FAILED — 공개 번들에 원문 문자열이 있습니다:")
        for l in leaks[:10]:
            print("  -", l)
        sys.exit(1)
    (APP / "content.js").write_text(js, encoding="utf-8")
    import build_vocab
    print(f"vocab: app/vocab.js ({build_vocab.build() // 1024} KB)")
    # Cache-bust: stamp each app file reference in index.html with a hash of its contents.
    index = ROOT / "index.html"
    html = index.read_text(encoding="utf-8")

    def stamp(m):
        f = APP / m.group(1)
        return f'app/{m.group(1)}?v={hashlib.sha1(f.read_bytes()).hexdigest()[:8]}' if f.exists() else m.group(0)
    index.write_text(re.sub(r'app/([\w.]+\.(?:js|css))(?:\?v=\w+)?', stamp, html), encoding="utf-8")
    # Page for the claude.ai Artifact viewer: it wraps the file in its own document skeleton,
    # so only title/meta/style/body content go here. Supporting files are published next to it.
    (ROOT / "artifact.html").write_text(ARTIFACT_PAGE, encoding="utf-8")
    segs = sum(1 for o in originals if o.get("seg"))
    print(f"bundle: app/content.js ({len(js)//1024} KB), audio sets: {len(audio_meta)}, replay segments: {segs}, "
          f"pool sets: {len(bundle['pool']['sets'])}, leak check: passed ({'원문 대조' if data['private'] else '비공개 자료 없음 — 패턴 검사만'})")


if __name__ == "__main__":
    main()
