#!/usr/bin/env python3
"""Проверяет координаты из system-overrides.json прямо на растровой карте.

Для каждой системы берётся несколько вырезок вокруг её точки, распознаётся текст
(Tesseract, rus+eng) и сравнивается с ожидаемым названием — подписью карты и именем
системы. Короткие подписи («Чар», «Сара», «Икар») читаются неустойчиво, поэтому
вырезок и режимов сегментации несколько, а результат берётся по лучшему совпадению.

Если рядом с точкой подпись не найдена, ключ --locate запускает распознавание всей
карты и пытается найти название в другом месте — так видно, переехала система или
её на этой подложке нет вовсе.

Запуск:
    python3 tools/verify_overrides_on_map.py assets/_source/koprulu_map.jpg
    python3 tools/verify_overrides_on_map.py map.jpg --locate --json data/map-verification.json

Код возврата: 0 — совпало ≥ 80% точек, 1 — меньше (подложка, скорее всего, не та).
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    print("Нужен Pillow: pip install -r tools/requirements.txt", file=sys.stderr)
    raise SystemExit(1)

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parents[1]
# На исходной карте центр текста системной подписи примерно на 31 px ниже
# центра кольца. Полный OCR-поиск возвращает сразу рекомендуемый центр маркера.
LABEL_CENTER_OFFSET_Y = 31
ENDINGS = ("иями", "иях", "иям", "ами", "ями", "ов", "ев", "ах", "ях", "ам", "ям",
           "ом", "ем", "ой", "ий", "ый", "ая", "яя", "ое", "ее", "а", "я", "ы", "и", "е", "у", "ю", "о")


def norm(value: str) -> str:
    text = unicodedata.normalize("NFKC", (value or "").lower())
    text = text.replace("ё", "е").replace("й", "и")
    text = re.sub(r"[\u2010-\u2015]", "-", text)
    return re.sub(r"[^0-9a-zа-я-]+", "", text)


def stem(word: str) -> str:
    for ending in ENDINGS:
        if len(word) > len(ending) + 3 and word.endswith(ending):
            return word[: -len(ending)]
    return word


def similar(expected: str, candidate: str) -> float:
    a, b = norm(expected), norm(candidate)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if stem(a) == stem(b):
        return 1.0
    # осколок OCR не должен «попадать» в длинное название: «р» ≠ «Онуру»
    if min(len(a), len(b)) < 3:
        return 0.0
    if max(len(a), len(b)) / min(len(a), len(b)) > 2.0:
        return 0.0
    if a in b or b in a:
        return 0.85 if min(len(a), len(b)) <= 4 else 0.9
    return SequenceMatcher(None, stem(a), stem(b)).ratio()


def tesseract_words(image: Image.Image, tmp: Path, psm: int, tag: str) -> tuple[str, list[dict]]:
    """Возвращает текст и список слов с координатами (для поиска по всей карте)."""
    path = tmp / f"{tag}.png"
    image.save(path)
    text = subprocess.run(
        ["tesseract", str(path), "stdout", "-l", "rus+eng", "--psm", str(psm)],
        capture_output=True, text=True, check=False,
    ).stdout
    tsv = subprocess.run(
        ["tesseract", str(path), "stdout", "-l", "rus+eng", "--psm", str(psm), "tsv"],
        capture_output=True, text=True, check=False,
    ).stdout
    words = []
    lines = tsv.splitlines()
    if lines:
        header = lines[0].split("\t")
        for line in lines[1:]:
            cells = line.split("\t")
            if len(cells) != len(header):
                continue
            row = dict(zip(header, cells))
            word = (row.get("text") or "").strip()
            if not word or not word.replace("-", "").isalnum():
                continue
            try:
                confidence = float(row.get("conf") or -1)
            except ValueError:
                confidence = -1
            if confidence < 30:
                continue
            words.append({
                "text": word,
                "left": int(row["left"]), "top": int(row["top"]),
                "width": int(row["width"]), "height": int(row["height"]),
                "conf": confidence,
                "lineKey": (row.get("block_num"), row.get("par_num"), row.get("line_num")),
            })
    return text, words


def best_match(expected_names: list[str], candidates: list[str]) -> tuple[float, str]:
    best_score, best_text = 0.0, ""
    for candidate in candidates:
        for expected in expected_names:
            score = similar(expected, candidate)
            if score > best_score:
                best_score, best_text = score, candidate
    return best_score, best_text


def read_around(raster: Image.Image, x: int, y: int, radii: tuple[int, ...],
                scale: int, tmp: Path, expected_names: list[str]) -> tuple[float, str]:
    width, height = raster.size
    best_score, best_text = 0.0, ""
    for radius in radii:
        box = (max(0, x - radius), max(0, y - radius),
               min(width, x + radius), min(height, y + radius))
        crop = raster.crop(box)
        crop = crop.resize((crop.width * scale, crop.height * scale), Image.LANCZOS)
        variants = [("rgb", crop)]
        for psm in (11, 6):
            text, _ = tesseract_words(crop, tmp, psm, f"crop_{x}_{y}_{radius}_rgb_{psm}")
            candidates = [token.strip(" .,:;·—–-") for token in re.split(r"[\n|]+", text)]
            candidates = [candidate for candidate in candidates if candidate] + [text]
            score, found = best_match(expected_names, candidates)
            if score > best_score:
                best_score, best_text = score, found
        # Если обычный проход не увидел подпись, повышаем контраст: белые буквы
        # на цветных секторах карты так распознаются заметно стабильнее.
        if best_score < 0.95:
            from PIL import ImageOps
            gray = ImageOps.autocontrast(ImageOps.grayscale(crop))
            variants = [("gray", gray), ("threshold", gray.point(lambda value: 255 if value > 155 else 0))]
            for variant_name, variant in variants:
                for psm in (11, 6):
                    text, _ = tesseract_words(
                        variant, tmp, psm, f"crop_{x}_{y}_{radius}_{variant_name}_{psm}"
                    )
                    candidates = [token.strip(" .,:;·—–-") for token in re.split(r"[\n|]+", text)]
                    candidates = [candidate for candidate in candidates if candidate] + [text]
                    score, found = best_match(expected_names, candidates)
                    if score > best_score:
                        best_score, best_text = score, found
        if best_score >= 0.95:
            break
    return best_score, best_text


def word_phrases(words: list[dict]) -> list[dict]:
    """Добавляет фразы из соседних OCR-слов одной строки (до трёх слов)."""
    phrases = list(words)
    groups: dict[tuple, list[dict]] = {}
    for word in words:
        groups.setdefault(tuple(word.get("lineKey") or ()), []).append(word)
    for line_words in groups.values():
        line_words.sort(key=lambda row: row["left"])
        for start in range(len(line_words)):
            for length in (2, 3):
                chunk = line_words[start:start + length]
                if len(chunk) != length:
                    continue
                # Не склеиваем далёкие подписи, случайно попавшие в одну OCR-строку.
                if any(
                    right["left"] - (left["left"] + left["width"]) > 120
                    for left, right in zip(chunk, chunk[1:])
                ):
                    continue
                left = min(row["left"] for row in chunk)
                top = min(row["top"] for row in chunk)
                right = max(row["left"] + row["width"] for row in chunk)
                bottom = max(row["top"] + row["height"] for row in chunk)
                phrases.append({
                    "text": " ".join(row["text"] for row in chunk),
                    "left": left, "top": top, "width": right - left, "height": bottom - top,
                    "conf": min(row["conf"] for row in chunk),
                    "lineKey": chunk[0].get("lineKey"),
                })
    return phrases


def locate_on_map(raster: Image.Image, tile_size: int, scale: int, tmp: Path,
                  names: list[str]) -> dict[str, dict]:
    """Ищет подписи по всей карте тайлами без потери мелкого текста.

    Прежняя реализация уменьшала 10000px-карту до 5000px. Подписи становились
    высотой всего несколько пикселей, поэтому даже «Айур» не находился. Теперь
    карта сканируется нативными перекрывающимися тайлами, каждый тайл переводится
    в контрастный grayscale и увеличивается перед OCR.
    """
    from PIL import ImageOps

    width, height = raster.size
    tile_size = max(600, min(tile_size, width, height))
    scale = max(1, scale)
    overlap = min(180, tile_size // 6)
    step = max(1, tile_size - overlap)

    def starts(limit: int) -> list[int]:
        values = list(range(0, max(1, limit - tile_size + 1), step))
        last = max(0, limit - tile_size)
        if not values or values[-1] != last:
            values.append(last)
        return values

    pending = set(names)
    best_by_name: dict[str, dict] = {}
    for top in starts(height):
        for left in starts(width):
            crop = raster.crop((left, top, min(width, left + tile_size), min(height, top + tile_size)))
            prepared = ImageOps.autocontrast(ImageOps.grayscale(crop))
            if scale != 1:
                prepared = prepared.resize(
                    (prepared.width * scale, prepared.height * scale), Image.LANCZOS
                )
            _, words = tesseract_words(prepared, tmp, 11, f"locate_{left}_{top}")
            candidates = word_phrases(words)
            for name in list(pending):
                current = best_by_name.get(name)
                for candidate in candidates:
                    score = similar(name, candidate["text"])
                    if score < 0.85 or (current is not None and score <= current["score"]):
                        continue
                    label_x = int(left + (candidate["left"] + candidate["width"] / 2) / scale)
                    label_y = int(top + (candidate["top"] + candidate["height"] / 2) / scale)
                    current = {
                        "score": round(score, 3),
                        "text": candidate["text"],
                        "x": label_x,
                        "y": max(0, label_y - LABEL_CENTER_OFFSET_Y),
                        "labelX": label_x,
                        "labelY": label_y,
                        "markerOffsetY": -LABEL_CENTER_OFFSET_Y,
                    }
                    best_by_name[name] = current
                if current and current["score"] >= 0.99:
                    pending.discard(name)
            if not pending:
                return best_by_name
    return best_by_name


def main() -> int:
    parser = argparse.ArgumentParser(description="Проверка координат оверрайдов на растре карты")
    parser.add_argument("map", nargs="?", default="assets/_source/koprulu_map.jpg", help="растр подложки")
    parser.add_argument("--reference", default=str(ROOT / "data" / "system-overrides.json"))
    parser.add_argument("--radii", default="150,300,460", help="радиусы вырезок вокруг точки, px")
    parser.add_argument("--scale", type=int, default=3, help="увеличение вырезки перед распознаванием")
    parser.add_argument("--threshold", type=float, default=0.8, help="порог схожести названий (0…1)")
    parser.add_argument("--locate", action="store_true", help="искать неподтверждённые названия по всей карте")
    parser.add_argument("--locate-size", type=int, default=2000,
                        help="размер нативного тайла полного поиска, px (по умолчанию 2000)")
    parser.add_argument("--locate-scale", type=int, default=2,
                        help="увеличение тайла перед полным OCR-поиском (по умолчанию 2)")
    parser.add_argument("--only", help="проверить только перечисленные через запятую system id")
    parser.add_argument("--json", dest="json_out", help="куда сохранить отчёт")
    args = parser.parse_args()

    if not shutil.which("tesseract"):
        print("Нужен Tesseract с русским: apt-get install tesseract-ocr tesseract-ocr-rus", file=sys.stderr)
        return 2
    language_probe = subprocess.run(
        ["tesseract", "--list-langs"], capture_output=True, text=True, check=False
    )
    languages = set(language_probe.stdout.split())
    missing_languages = {"rus", "eng"} - languages
    if missing_languages:
        print("Tesseract: не установлены языки " + ", ".join(sorted(missing_languages)) +
              ". Нужны tesseract-ocr-rus и tesseract-ocr-eng.", file=sys.stderr)
        return 2

    raster_path = Path(args.map)
    if not raster_path.is_absolute():
        candidate = ROOT / raster_path
        raster_path = candidate if candidate.exists() else raster_path
    if not raster_path.exists():
        print(f"Растр не найден: {raster_path}", file=sys.stderr)
        return 2

    reference = json.loads(Path(args.reference).read_text(encoding="utf-8"))
    systems = reference.get("systems") or {}
    if args.only:
        selected = {value.strip() for value in args.only.split(",") if value.strip()}
        unknown = selected - systems.keys()
        if unknown:
            print("Неизвестные system id: " + ", ".join(sorted(unknown)), file=sys.stderr)
            return 2
        systems = {system_id: record for system_id, record in systems.items() if system_id in selected}
    radii = tuple(int(value) for value in args.radii.split(",") if value.strip())

    with Image.open(raster_path) as raw:
        raster = raw.convert("RGB")
        width, height = raster.size
        print(f"Растр: {raster_path.name} — {width}×{height} · точек к проверке: {len(systems)}")

        results = []
        with tempfile.TemporaryDirectory() as tmp_name:
            tmp = Path(tmp_name)
            for system_id, record in sorted(systems.items()):
                x, y = record.get("x"), record.get("y")
                if x is None or y is None:
                    continue
                label = record.get("label") or system_id
                expected = [label, system_id.split("-")[0]]
                score, found = read_around(raster, x, y, radii, args.scale, tmp, expected)
                ok = score >= args.threshold
                results.append({
                    "systemId": system_id, "x": x, "y": y, "label": record.get("label"),
                    "found": found, "score": round(score, 3), "ok": ok,
                })
                print(f"  {'✓' if ok else '✗'} {system_id:<24} {label:<12} ({x},{y}) "
                      f"→ «{found[:26]}» {score:.2f}")

            located = {}
            missing = [item for item in results if not item["ok"]]
            if missing and args.locate:
                print(f"\nИщу {len(missing)} неподтверждённых названий по всей карте "
                      f"(тайлы {args.locate_size}px ×{args.locate_scale})…")
                located = locate_on_map(
                    raster, args.locate_size, args.locate_scale, tmp,
                    [item["label"] or item["systemId"] for item in missing]
                )
                for item in missing:
                    hit = located.get(item["label"] or item["systemId"])
                    if hit:
                        distance = int(((hit["x"] - item["x"]) ** 2 + (hit["y"] - item["y"]) ** 2) ** 0.5)
                        print(f"  → «{item['label']}»: центр маркера {hit['x']},{hit['y']} "
                              f"(OCR «{hit['text']}», подпись {hit['labelX']},{hit['labelY']}, {hit['score']}) "
                              f"— от текущей точки {distance} px")
                    else:
                        print(f"  → «{item['label']}» на карте не найдено")

    matched = [item for item in results if item["ok"]]
    ratio = len(matched) / len(results) if results else 0.0
    print(f"\nСовпало {len(matched)} из {len(results)} ({ratio:.0%})")
    if len(matched) != len(results):
        print("Не подтвердились: " + ", ".join(
            str(item["label"] or item["systemId"]) for item in results if not item["ok"]))

    if args.json_out:
        payload = {
            "raster": raster_path.name,
            "rasterSize": [width, height],
            "reference": Path(args.reference).name,
            "threshold": args.threshold,
            "checked": len(results),
            "matched": len(matched),
            "ratio": round(ratio, 3),
            "systems": results,
        }
        if located:
            payload["relocated"] = located
        Path(args.json_out).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Отчёт: {args.json_out}")

    return 0 if ratio >= 0.8 else 1


if __name__ == "__main__":
    sys.exit(main())
