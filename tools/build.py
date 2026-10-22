#!/usr/bin/env python3
"""Build pipeline: QA-check content, synthesize audio (macOS `say` + ffmpeg), bundle app/content.js.

Content sources (all merged):
  content/skills.json            8 skills
  content/originals.json         TPO2–4 original errors (+ their audio scripts)
  content/tests/<ID>.json        every later mock test added through the intake procedure (CLAUDE.md)
  content/items_*.json           practice items (guided / transfer) + audio scripts
  content/sw.json                speaking·writing part (tutor corrections, L&R, interview, email, discussion)

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
APP = ROOT / "app"

# Speaker role -> macOS voice. TOEFL uses several English accents.
VOICES = {
    "N": "Karen",                   # narrator (AU)
    "W": "Samantha",                # woman (US)
    "M": "Daniel",                  # man (UK)
    "W2": "Moira",                  # woman (IE)
    "M2": "Reed (English (US))",    # man (US)
}
RATE = 172          # words per minute, close to TOEFL lecture pace
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
def load_all():
    skills = read_json(CONTENT / "skills.json")["skills"]
    base = read_json(CONTENT / "originals.json")
    reading = read_json(CONTENT / "items_reading.json")
    listening = read_json(CONTENT / "items_listening.json")
    data = {
        "skills": skills,
        "tests": [dict(t, source="originals.json") for t in base["tests"]],
        "originals": list(base["originals"]),
        "audioSets": {**base["audioSets"], **listening["audioSets"]},
        "origAudio": set(base["audioSets"]),
        "items": reading["items"] + listening["items"],
        "slotOptions": reading["slotOptions"],
        "actOptions": listening["actOptions"],
        "files": {},
    }
    for f in sorted(CONTENT.glob("items_*.json")):
        if f.name in ("items_reading.json", "items_listening.json"):
            continue
        extra = read_json(f)
        data["audioSets"].update(extra.get("audioSets", {}))
        data["items"] += extra.get("items", [])
    for f in sorted((CONTENT / "tests").glob("*.json")):
        add_test_file(data, f)
    data["tests"].sort(key=lambda t: t["date"])
    data["sw"] = read_json(CONTENT / "sw.json")
    data["audioSets"].update(sw_audio_sets(data["sw"]))
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


def check_sw(sw, voices):
    errs = []
    cats = set(sw["cats"])
    ids = [x["id"] for k in ("grammar", "lr", "buildSentence", "interview", "email", "discussion") for x in sw[k]]
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
        if o["sec"] == "L" and o["skill"] != "UNKNOWN" and "audio" not in o:
            errs.append(f"{p}: listening original without audio")
        if o.get("audio") in audio_sets and o.get("evidence"):
            txt = audio_text(audio_sets[o["audio"]])
            ev = re.sub(r"^[MW]\d?: ", "", o["evidence"].split(" / ")[0])
            if len(txt.split()) > 12 and not contains(txt, ev):
                errs.append(f"{p}: evidence not found in transcript")
        if o.get("passage") and o.get("evidence") and "→" not in o["evidence"] and "=" not in o["evidence"] \
                and "—" not in o["evidence"] and not contains(o["passage"], o["evidence"]):
            errs.append(f"{p}: evidence not found in passage")

    # Memorization guard: transfer answers must not reuse an original correct answer verbatim.
    orig_answers = set()
    for o in data["originals"]:
        if "ctest" in o:
            orig_answers.add(o["ctest"]["answer"].lower())
        elif o.get("options") and isinstance(o.get("correct"), int):
            orig_answers.add(o["options"][o["correct"]].lower().strip())

    # ---- items ----
    seen = set()
    for it in data["items"]:
        p = f"item {it['id']}"
        if it["id"] in seen:
            errs.append(f"{p}: duplicate id")
        seen.add(it["id"])
        if it["skill"] not in skill_ids:
            errs.append(f"{p}: unknown skill")
        if it["tier"] not in ("guided", "transfer"):
            errs.append(f"{p}: bad tier")
        text = it.get("passage", "")
        if "audio" in it:
            if it["audio"] not in audio_sets:
                errs.append(f"{p}: missing audio set")
                continue
            text = audio_text(audio_sets[it["audio"]])
        if it["kind"] == "ctest":
            c = it["ctest"]
            if c["text"].count("{{}}") != 1:
                errs.append(f"{p}: ctest blank count")
            if not c["answer"].startswith(c["prefix"]) or c["answer"] == c["prefix"]:
                errs.append(f"{p}: ctest prefix/answer mismatch")
            if it["tier"] == "transfer" and c["answer"].lower() in orig_answers:
                errs.append(f"{p}: transfer answer reuses an original answer")
            if it["skill"] == "FORM" and "slot" not in c:
                errs.append(f"{p}: FORM item needs slot")
        for q in it.get("qs", []):
            n = len(q["options"])
            if len({o.strip().lower() for o in q["options"]}) != n:
                errs.append(f"{p}: duplicate options")
            if not (0 <= q["answer"] < n):
                errs.append(f"{p}: answer out of range")
            if len(q.get("why", [])) != n:
                errs.append(f"{p}: why[] must match options")
            if q.get("skill") and q["skill"] not in skill_ids:
                errs.append(f"{p}: q.skill unknown")
            if it["tier"] == "transfer" and not q.get("fixed") and q["options"][q["answer"]].lower().strip() in orig_answers:
                errs.append(f"{p}: transfer answer reuses an original answer")
            ev = q.get("evidence")
            if ev and text and not contains(text, ev):
                errs.append(f"{p}: evidence not found in passage/transcript: {ev[:50]}")
            if it["kind"] != "reply" and not ev:
                errs.append(f"{p}: missing evidence")
        for st in it.get("steps", []) + it.get("stepsAfter", []):
            t = st["type"]
            if t == "choice" and not (0 <= st["answer"] < len(st["options"])):
                errs.append(f"{p}: step answer out of range")
            if t == "tag" and len(st["answer"]) != len(it["qs"][0]["options"]):
                errs.append(f"{p}: tag answers must cover each option")
            if t == "match" and len(st["answer"]) != len(st["rows"]):
                errs.append(f"{p}: match answers must cover each row")
            if t == "pick":
                words = set(norm(st["sentence"]))
                for w in st["answer"]:
                    if w.lower() not in words:
                        errs.append(f"{p}: pick word '{w}' not in sentence")
            if t == "act" and not (0 <= st["answer"] < len(data["actOptions"])):
                errs.append(f"{p}: act answer out of range")
        if it["kind"] == "insert":
            markers = re.findall(r"■[A-D]", it["passage"])
            if markers != ["■A", "■B", "■C", "■D"]:
                errs.append(f"{p}: insert passage needs ■A..■D in order")
    return errs


# ---------------------------------------------------------------- audio
def wav_seconds(path):
    # 16-bit mono PCM written by ffmpeg: duration = (bytes - 44 header) / (2 * SR)
    return max(0.0, (path.stat().st_size - 44) / (2 * SR))


def tts_set(set_id, aset, force=False):
    """Render one audio set sentence by sentence; write <id>.mp3 and <id>.cues.json (start/end per sentence)."""
    sig = hashlib.sha1(json.dumps([aset["lines"], VOICES, RATE, GAP_LINE, GAP_SENT, "v2"]).encode()).hexdigest()[:12]
    out = AUDIO / f"{set_id}.mp3"
    cues_f = AUDIO / f"{set_id}.cues.json"
    stamp = AUDIO / f".{set_id}.sig"
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
        parts, cues, t = [], [], 0.0
        k = 0
        for li, line in enumerate(aset["lines"]):
            sents = split_sentences(line["t"])
            for si, sent in enumerate(sents):
                aiff, wav = td / f"{k}.aiff", td / f"{k}.wav"
                k += 1
                subprocess.run(["say", "-v", VOICES[line["v"]], "-r", str(RATE), "-o", str(aiff), sent], check=True)
                subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(aiff), "-ar", str(SR), "-ac", "1",
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
<script src="app/ui.js"></script>
"""


# ---------------------------------------------------------------- main
def main():
    args = set(sys.argv[1:])
    data = load_all()
    errs = check(data) + check_sw(data["sw"], VOICES)
    if errs:
        print("QA FAILED:")
        for e in errs:
            print("  -", e)
        sys.exit(1)
    n_orig = len(data["originals"])
    print(f"QA passed: {len(data['tests'])} tests, {n_orig} originals, {len(data['items'])} practice items")
    if "--check" in args:
        return

    if "--no-audio" not in args:
        if not shutil.which("say") or not shutil.which("ffmpeg"):
            sys.exit("need macOS `say` and ffmpeg for audio")
        AUDIO.mkdir(exist_ok=True)
        for sid, aset in data["audioSets"].items():
            tts_set(sid, aset, force="--force-audio" in args)

    audio_meta = {}
    for sid, aset in data["audioSets"].items():
        f = AUDIO / f"{sid}.mp3"
        cf = AUDIO / f"{sid}.cues.json"
        audio_meta[sid] = {
            "src": f"audio/{sid}.mp3",
            "dur": duration(f) if f.exists() else None,
            "title": aset.get("title", ""),
            "lines": aset["lines"],
            "cues": read_json(cf) if cf.exists() else [],
            "note": aset.get("note", ""),
        }

    items = []
    for it in data["items"]:
        it = dict(it, qa="pass")
        if it.get("audio"):
            cues = audio_meta[it["audio"]]["cues"]
            it["qs"] = [dict(q, seg=segment_for(cues, q.get("evidence"))) for q in it.get("qs", [])]
        items.append(it)
    originals = []
    for o in data["originals"]:
        if o.get("audio"):
            o = dict(o, seg=segment_for(audio_meta[o["audio"]]["cues"], o.get("evidence")))
        originals.append(o)

    bundle = {
        "builtAt": datetime.datetime.now().isoformat(timespec="seconds"),
        "skills": data["skills"],
        "tests": data["tests"],
        "originals": originals,
        "items": items,
        "audio": audio_meta,
        "slotOptions": data["slotOptions"],
        "actOptions": data["actOptions"],
        "sw": data["sw"],
    }
    js = "// Generated by tools/build.py — do not edit. Edit content/*.json instead.\nwindow.CONTENT = " + \
         json.dumps(bundle, ensure_ascii=False) + ";\n"
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
    segs = sum(1 for it in items for q in it.get("qs", []) if q.get("seg")) + sum(1 for o in originals if o.get("seg"))
    print(f"bundle: app/content.js ({len(js)//1024} KB), audio sets: {len(audio_meta)}, replay segments: {segs}")


if __name__ == "__main__":
    main()
