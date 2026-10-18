from __future__ import annotations

import json
import math
import os
import random
import threading
import uuid
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = Path(os.getenv("PETSOUND_DATA_DIR", str(BASE_DIR / "data")))
UPLOAD_DIR = DATA_DIR / "uploads"
GENERATED_DIR = DATA_DIR / "generated"
HISTORY_FILE = DATA_DIR / "history.json"
REPLICATE_TOKEN = os.getenv("REPLICATE_API_TOKEN", "").strip()

for directory in (DATA_DIR, UPLOAD_DIR, GENERATED_DIR):
    directory.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="PetSound Studio", version="0.1.0")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
_store_lock = threading.Lock()

PET_LABELS = {
    "bird": "小鸟",
    "rabbit": "兔兔",
    "cat": "猫咪",
    "dog": "狗狗",
    "other": "其他伙伴",
}
STYLE_LABELS = {
    "auto": "智能匹配",
    "healing": "治愈轻柔",
    "cheerful": "欢快活泼",
    "mysterious": "神秘氛围",
}
STYLE_PROMPTS = {
    "auto": "Choose a cohesive musical style that fits the measured sound features.",
    "healing": "gentle healing ambient, warm piano, soft strings, delicate bells, calm and tender",
    "cheerful": "cheerful playful indie pop, light percussion, plucked strings, bouncy bass, bright melody",
    "mysterious": "dreamy mysterious cinematic ambience, airy pads, subtle marimba, spacious textures, elegant tension",
}
CAPTIONS = {
    "bird": {
        "low": ["今日小鸟频道：把安静唱成了森林片头曲。", "这段旋律，适合配一场窗边日落。", "鸟生慢镜头已开启，请轻声欣赏。"],
        "medium": ["叽叽喳喳的灵感，正在加载成歌。", "森林电台来信：今天也要自在地唱。", "小小声带，大大舞台。"],
        "high": ["森林演唱会开场！前排树枝还有座位。", "今日单曲：《谁还没听过我》。", "音符起飞中，树梢请注意！"],
    },
    "rabbit": {
        "low": ["兔兔的安静，不代表没有自己的 BGM。", "胡萝卜味的轻音乐，请慢慢收听。", "今天的节奏：软乎乎地发光。"],
        "medium": ["蹦跶灵感已捕捉，正在制作兔兔混音。", "小爪一动，节拍就有了。", "兔兔电台：可爱正在循环播放。"],
        "high": ["兔兔蹦迪现场，草地自动变舞池。", "耳朵已就位，节奏请跟上！", "这首歌的低音：来自快乐的弹跳。"],
    },
    "cat": {
        "low": ["本喵进入省电模式，背景音乐请轻一点。", "一首适合踩奶和发呆的歌。", "猫生哲学：不赶路，只听歌。"],
        "medium": ["本喵的即兴演出，谢绝催更。", "尾巴打拍子，灵感刚刚好。", "今日猫咪单曲：听懂算你厉害。"],
        "high": ["本喵已切换至摇滚频道，音量不代表态度。", "凌晨三点的灵感，终于有了配乐。", "喵力全开！沙发就是主舞台。"],
    },
    "dog": {
        "low": ["汪星人的午后片尾曲，适合一起晒太阳。", "把摇尾巴的节奏，轻轻写进旋律。", "今日任务：慢下来，陪伴就很好。"],
        "medium": ["尾巴节拍器已启动，快乐正在成歌。", "汪汪电台：下一站是散步的路上。", "这段旋律闻起来像周末。"],
        "high": ["汪！快乐已经冲出音箱啦。", "狗狗主唱登场，掌声和零食都别停。", "全速摇尾巴，节奏请保持！"],
    },
    "other": {
        "low": ["独家声音明信片：来自你的小伙伴。", "轻轻一声，也值得拥有自己的配乐。", "今天的声音，适合慢慢珍藏。"],
        "medium": ["独特声纹已采样，正在长成一段旋律。", "每一种声音，都有自己的节奏。", "小伙伴的即兴片段，已加入歌单。"],
        "high": ["专属声波已上线，舞台交给小伙伴！", "能量条拉满，今天就要响亮登场。", "这段声音，自带主角登场特效。"],
    },
}


def _read_history() -> list[dict[str, Any]]:
    if not HISTORY_FILE.exists():
        return []
    try:
        with HISTORY_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def _write_history(items: list[dict[str, Any]]) -> None:
    temp = HISTORY_FILE.with_suffix(".tmp")
    with temp.open("w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    temp.replace(HISTORY_FILE)


def _public_result(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item["id"],
        "pet_type": item.get("pet_type", "other"),
        "pet_label": item.get("pet_label", "其他伙伴"),
        "style": item.get("style", "auto"),
        "style_label": item.get("style_label", "智能匹配"),
        "duration": item.get("duration", 15),
        "features": item.get("features", {}),
        "caption": item.get("caption", ""),
        "audio_url": f"/media/{item['id']}",
        "created_at": item.get("created_at", ""),
        "mode": item.get("mode", "demo"),
        "public": bool(item.get("public", False)),
        "prompt": item.get("prompt", ""),
        "seed": item.get("seed"),
    }


def _energy_level(features: dict[str, Any]) -> str:
    given = features.get("energy_level")
    if given in ("low", "medium", "high"):
        return given
    db = float(features.get("rms_dbfs", -40))
    return "high" if db >= -18 else "medium" if db >= -32 else "low"


def _rhythm_level(features: dict[str, Any]) -> str:
    given = features.get("rhythm_level")
    if given in ("sparse", "moderate", "dense"):
        return given
    rate = float(features.get("rhythm_per_sec", 0))
    return "dense" if rate >= 3.5 else "moderate" if rate >= 1.2 else "sparse"


def _pitch_level(features: dict[str, Any]) -> str:
    given = features.get("pitch_level")
    if given in ("low", "mid", "high"):
        return given
    hz = float(features.get("dominant_hz", 0))
    return "low" if hz and hz < 250 else "mid" if hz and hz < 800 else "high"


def _build_prompt(pet_type: str, style: str, duration: int, features: dict[str, Any]) -> str:
    energy = _energy_level(features)
    rhythm = _rhythm_level(features)
    pitch = _pitch_level(features)
    source_duration = max(0.1, float(features.get("duration_sec", 0)))
    energy_text = {"low": "soft and low-energy", "medium": "moderate energy", "high": "bright and high-energy"}[energy]
    rhythm_text = {"sparse": "sparse, spacious rhythmic events", "moderate": "a gently moving, moderately dense rhythm", "dense": "a lively, dense rhythmic pattern"}[rhythm]
    pitch_text = {"low": "a low-register tonal character", "mid": "a mid-register tonal character", "high": "a high-register tonal character"}[pitch]
    pet_name = PET_LABELS.get(pet_type, "animal companion")
    style_text = STYLE_PROMPTS.get(style, STYLE_PROMPTS["auto"])
    return (
        f"Create a polished {duration}-second instrumental music piece inspired by an audio recording of a {pet_name}. "
        f"Use the supplied audio as loose melodic and rhythmic inspiration rather than literal speech. "
        f"The source recording is about {source_duration:.1f} seconds long, with {energy_text}, {pitch_text}, and {rhythm_text}. "
        f"Musical direction: {style_text}. Weave a subtle motif inspired by the source contour into a coherent arrangement. "
        "No lyrics, no spoken words, no abrupt noise, clean mix, satisfying beginning and ending."
    )


def _make_demo_audio(output_path: Path, duration: int, style: str, seed: int) -> None:
    """Create a clearly labelled local synthesized demo when no API token is configured."""
    sample_rate = 22050
    total = duration * sample_rate
    rng = random.Random(seed)
    if style == "mysterious":
        progression = [[220.00, 261.63, 329.63], [174.61, 220.00, 261.63], [196.00, 233.08, 293.66], [164.81, 207.65, 246.94]]
        scale = [440.00, 493.88, 587.33, 659.25, 783.99]
    elif style == "cheerful":
        progression = [[261.63, 329.63, 392.00], [196.00, 246.94, 392.00], [220.00, 261.63, 329.63], [174.61, 261.63, 349.23]]
        scale = [523.25, 587.33, 659.25, 783.99, 880.00]
    else:
        progression = [[261.63, 329.63, 392.00], [349.23, 440.00, 523.25], [220.00, 261.63, 329.63], [196.00, 246.94, 392.00]]
        scale = [392.00, 440.00, 523.25, 587.33, 659.25]

    frames = bytearray()
    beat = 0.62 if style == "cheerful" else 0.82 if style == "mysterious" else 0.95
    note_events = []
    t = 0.25
    while t < duration - 0.25:
        note_events.append((t, rng.choice(scale), rng.uniform(0.10, 0.22)))
        t += beat * rng.choice([0.5, 1, 1, 1.5])

    for n in range(total):
        t = n / sample_rate
        chord = progression[int(t / (duration / 4)) % 4]
        pad = sum(math.sin(2 * math.pi * freq * t) for freq in chord) / 3
        pad += 0.25 * math.sin(2 * math.pi * chord[0] * 0.5 * t)
        melody = 0.0
        for start, freq, amp in note_events:
            age = t - start
            if 0 <= age < 0.32:
                env = math.exp(-age * 8.5) * min(1.0, age * 40)
                melody += amp * env * (math.sin(2 * math.pi * freq * age) + 0.25 * math.sin(2 * math.pi * freq * 2 * age))
        fade_in = min(1.0, t / 0.6)
        fade_out = min(1.0, max(0.0, (duration - t) / 1.0))
        value = (0.12 * pad + melody) * fade_in * fade_out
        value = max(-0.95, min(0.95, value))
        frames.extend(int(value * 32767).to_bytes(2, "little", signed=True))

    with wave.open(str(output_path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(frames)


def _run_musicgen(input_path: Path, output_path: Path, prompt: str, duration: int, seed: int) -> None:
    try:
        import replicate  # Imported only when an API key is configured.
    except ImportError as exc:
        raise RuntimeError("缺少 replicate 依赖，请先执行 pip install -r requirements.txt。") from exc

    model_input = {
        "model_version": "stereo-melody-large",
        "prompt": prompt,
        "input_audio": None,
        "duration": duration,
        "continuation": False,
        "output_format": "mp3",
        "temperature": 1,
        "top_k": 250,
        "top_p": 0,
        "classifier_free_guidance": 3,
        "normalization_strategy": "peak",
        "seed": seed,
    }
    with input_path.open("rb") as audio_file:
        model_input["input_audio"] = audio_file
        output = replicate.run("meta/musicgen", input=model_input)

    if isinstance(output, (list, tuple)):
        if not output:
            raise RuntimeError("MusicGen 没有返回音频文件。")
        output = output[0]

    data: bytes | None = None
    if hasattr(output, "read"):
        try:
            data = output.read()
        except Exception:
            data = None
    if not data:
        url = getattr(output, "url", None)
        if callable(url):
            url = url()
        if not url and isinstance(output, str):
            url = output
        if not url:
            raise RuntimeError("MusicGen 返回结果中没有可读取的音频地址。")
        response = requests.get(str(url), timeout=180)
        response.raise_for_status()
        data = response.content
    if not data:
        raise RuntimeError("生成的音频文件为空。")
    output_path.write_bytes(data)


def _create_result(
    *,
    upload_id: str,
    input_path: Path,
    pet_type: str,
    style: str,
    duration: int,
    features: dict[str, Any],
    parent_id: str | None = None,
) -> dict[str, Any]:
    result_id = uuid.uuid4().hex[:12]
    seed = random.randint(1, 2_147_483_647)
    prompt = _build_prompt(pet_type, style, duration, features)
    energy = _energy_level(features)
    caption = random.choice(CAPTIONS.get(pet_type, CAPTIONS["other"])[energy])
    mode = "musicgen" if REPLICATE_TOKEN else "demo"
    output_path = GENERATED_DIR / f"{result_id}.{ 'mp3' if mode == 'musicgen' else 'wav' }"

    if REPLICATE_TOKEN:
        old_token = os.environ.get("REPLICATE_API_TOKEN")
        os.environ["REPLICATE_API_TOKEN"] = REPLICATE_TOKEN
        try:
            _run_musicgen(input_path, output_path, prompt, duration, seed)
        except Exception as exc:
            output_path.unlink(missing_ok=True)
            raise HTTPException(status_code=502, detail=f"音乐生成失败：{exc}") from exc
        finally:
            if old_token is None:
                os.environ.pop("REPLICATE_API_TOKEN", None)
            else:
                os.environ["REPLICATE_API_TOKEN"] = old_token
    else:
        _make_demo_audio(output_path, duration, style, seed)

    item = {
        "id": result_id,
        "upload_id": upload_id,
        "source_upload": str(input_path),
        "output_path": str(output_path),
        "pet_type": pet_type,
        "pet_label": PET_LABELS.get(pet_type, "其他伙伴"),
        "style": style,
        "style_label": STYLE_LABELS.get(style, "智能匹配"),
        "duration": duration,
        "features": features,
        "caption": caption,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "mode": mode,
        "public": False,
        "prompt": prompt,
        "seed": seed,
        "parent_id": parent_id,
    }
    with _store_lock:
        items = _read_history()
        items.insert(0, item)
        _write_history(items[:200])
    return _public_result(item)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/config")
def config() -> dict[str, Any]:
    return {
        "mode": "musicgen" if REPLICATE_TOKEN else "demo",
        "model": "meta/musicgen",
        "max_upload_mb": 20,
        "note": "未配置 API token 时使用本地合成音频演示；配置后调用 Replicate 上的 MusicGen。",
    }


@app.get("/api/history")
def history() -> list[dict[str, Any]]:
    with _store_lock:
        items = _read_history()
    return [_public_result(item) for item in items[:100]]


@app.get("/api/community")
def community() -> list[dict[str, Any]]:
    with _store_lock:
        items = _read_history()
    return [_public_result(item) for item in items if item.get("public")][:50]


@app.post("/api/generate")
def generate(
    audio: UploadFile = File(...),
    pet_type: str = Form("cat"),
    style: str = Form("auto"),
    duration: int = Form(15),
    features_json: str = Form(...),
) -> dict[str, Any]:
    if pet_type not in PET_LABELS:
        raise HTTPException(status_code=400, detail="宠物类型不受支持。")
    if style not in STYLE_LABELS:
        raise HTTPException(status_code=400, detail="音乐风格不受支持。")
    if duration not in (10, 15, 20, 30):
        raise HTTPException(status_code=400, detail="音乐时长请选择 10、15、20 或 30 秒。")
    content = audio.file.read()
    if not content:
        raise HTTPException(status_code=400, detail="上传的音频为空。")
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="音频文件超过 20 MB，请缩短录音后重试。")
    if not (content.startswith(b"RIFF") and content[8:12] == b"WAVE"):
        raise HTTPException(status_code=415, detail="请上传经过浏览器处理的 WAV 音频。")
    try:
        features = json.loads(features_json)
        if not isinstance(features, dict):
            raise ValueError("features must be an object")
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="音频特征数据格式不正确。") from exc

    upload_id = uuid.uuid4().hex[:12]
    input_path = UPLOAD_DIR / f"{upload_id}.wav"
    input_path.write_bytes(content)
    return _create_result(
        upload_id=upload_id,
        input_path=input_path,
        pet_type=pet_type,
        style=style,
        duration=duration,
        features=features,
    )


@app.post("/api/regenerate/{result_id}")
def regenerate(result_id: str) -> dict[str, Any]:
    with _store_lock:
        items = _read_history()
    original = next((item for item in items if item.get("id") == result_id), None)
    if not original:
        raise HTTPException(status_code=404, detail="没有找到这条作品记录。")
    input_path = Path(original.get("source_upload", ""))
    if not input_path.exists():
        raise HTTPException(status_code=410, detail="原始录音已不存在，无法重新生成。")
    return _create_result(
        upload_id=original.get("upload_id", ""),
        input_path=input_path,
        pet_type=original.get("pet_type", "other"),
        style=original.get("style", "auto"),
        duration=int(original.get("duration", 15)),
        features=original.get("features", {}),
        parent_id=result_id,
    )


@app.post("/api/publish/{result_id}")
def publish(result_id: str) -> dict[str, Any]:
    with _store_lock:
        items = _read_history()
        found = None
        for item in items:
            if item.get("id") == result_id:
                item["public"] = True
                found = item
                break
        if not found:
            raise HTTPException(status_code=404, detail="没有找到这条作品记录。")
        _write_history(items)
    return _public_result(found)


@app.delete("/api/history/{result_id}")
def delete_history(result_id: str) -> dict[str, bool]:
    with _store_lock:
        items = _read_history()
        target = next((item for item in items if item.get("id") == result_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="没有找到这条作品记录。")
        remaining = [item for item in items if item.get("id") != result_id]
        _write_history(remaining)
        output_path = Path(target.get("output_path", ""))
        output_path.unlink(missing_ok=True)
        upload_id = target.get("upload_id")
        if upload_id and not any(item.get("upload_id") == upload_id for item in remaining):
            Path(target.get("source_upload", "")).unlink(missing_ok=True)
    return {"ok": True}


@app.get("/media/{result_id}")
def media(result_id: str) -> FileResponse:
    with _store_lock:
        items = _read_history()
    target = next((item for item in items if item.get("id") == result_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="音频不存在或已被删除。")
    path = Path(target.get("output_path", ""))
    if not path.exists() or path.parent.resolve() != GENERATED_DIR.resolve():
        raise HTTPException(status_code=404, detail="音频文件不存在。")
    media_type = "audio/mpeg" if path.suffix == ".mp3" else "audio/wav"
    return FileResponse(path, media_type=media_type, content_disposition_type="inline")


@app.get("/api/health")
def health() -> JSONResponse:
    return JSONResponse({"ok": True, "mode": "musicgen" if REPLICATE_TOKEN else "demo"})
