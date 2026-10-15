#!/usr/bin/env python3
"""Собирает цветную пирамиду тайлов карты для атласа.

Вход — квадратный растр (PNG / JPEG / WebP). Неквадратное изображение
отклоняется: иначе координаты X/Y перестанут совпадать с подписями на карте.
Выход — то, что ждёт `app.js`:

    assets/tiles.json                        манифест уровней
    assets/tiles/<level>/<col>_<row>.webp    тайлы 512 px
    assets/map-preview.webp                  грубый обзор для мгновенной отрисовки
    assets/map-source.jpg                    нормализованный исходник (--keep-source)

Примеры:
    python3 tools/build_tiles.py assets/koprulu_map.png
    python3 tools/build_tiles.py                 # найдёт растр в assets/ автоматически
    python3 tools/build_tiles.py map.png --levels 1250,2500,5000,10000 --tile 512 --quality 82
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    print("Нужен Pillow: pip install -r tools/requirements.txt", file=sys.stderr)
    raise SystemExit(1)

Image.MAX_IMAGE_PIXELS = None  # карта 10000x10000 — это нормально

ROOT = Path(__file__).resolve().parents[1]
SKIP_NAMES = {"map-preview.webp", "map-source.jpg"}


def find_source(assets_dir: Path) -> Path | None:
    candidates: list[Path] = []
    for pattern in ("koprulu_map.*", "map-source.*", "map.*", "*"):
        for path in sorted(assets_dir.glob(pattern)):
            if not path.is_file() or path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
                continue
            if path.name in SKIP_NAMES or path.parent.name == "tiles":
                continue
            candidates.append(path)
        if candidates:
            break
    return candidates[0] if candidates else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Пирамида тайлов для Koprulu Atlas")
    parser.add_argument("source", nargs="?", help="исходный растр; без аргумента — поиск в assets/")
    parser.add_argument("--assets", default=str(ROOT / "assets"), help="каталог ассетов (по умолчанию assets/)")
    parser.add_argument("--levels", default="1250,2500,5000,10000", help="уровни детализации в пикселях")
    parser.add_argument("--tile", type=int, default=512, help="размер тайла")
    parser.add_argument("--quality", type=int, default=82, help="качество WebP")
    parser.add_argument("--keep-source", action="store_true", help="сохранить нормализованный исходник в assets/map-source.jpg")
    parser.add_argument("--force", action="store_true", help="принять неквадратный исходник (искажает координаты!)")
    args = parser.parse_args(argv)

    assets = Path(args.assets).resolve()
    assets.mkdir(parents=True, exist_ok=True)
    levels = [int(value) for value in args.levels.split(",") if value.strip()]
    levels = sorted(set(levels))
    max_level = levels[-1]

    source = Path(args.source).resolve() if args.source else find_source(assets)
    if source is None or not source.exists():
        print("Не найден исходный растр. Положите карту в assets/ или укажите путь аргументом.", file=sys.stderr)
        return 1

    with Image.open(source) as raw:
        raw = raw.convert("RGB")
        width, height = raw.size
        print(f"Исходник: {source.name} — {width}×{height}")
        if width != height and not args.force:
            print(
                "Карта должна быть квадратной: иначе X/Y на сайте перестанут совпадать с подписями.\n"
                "Обрежьте/дополните холст до квадрата или запустите с --force, если искажение допустимо.",
                file=sys.stderr,
            )
            return 2
        if max(width, height) != max_level:
            # Разрешение исходника — источник истины для системы координат: уровни,
            # оканчивающиеся «крупнее» карты, отбрасываем (растягивать карту нельзя —
            # координаты X/Y перестанут совпадать с подписями).
            fitting = [level for level in levels if level <= max(width, height)]
            if fitting:
                max_level = fitting[-1]
                levels = [level for level in levels if level <= max_level] or [max_level]
                print(f"Разрешение карты {width}×{height}: уровни ограничены {levels}")
            else:
                print(f"Разрешение карты {width}×{height} меньше минимального уровня — масштабирую до {max_level}")
                raw = raw.resize((max_level, max_level), Image.LANCZOS)
        master = raw.copy()

    tiles_root = assets / "tiles"
    for level in levels:
        level_dir = tiles_root / str(levels.index(level))
        level_dir.mkdir(parents=True, exist_ok=True)
        image = master if level == max_level else master.resize((level, level), Image.LANCZOS)
        cols = max(1, -(-level // args.tile))
        rows = cols
        for col in range(cols):
            for row in range(rows):
                box = (col * args.tile, row * args.tile,
                       min((col + 1) * args.tile, level), min((row + 1) * args.tile, level))
                image.crop(box).save(level_dir / f"{col}_{row}.webp", "WEBP", quality=args.quality, method=6)
        print(f"  уровень {levels.index(level)}: {level}px → {cols}×{rows} тайлов")

    preview = master.resize((min(1250, max_level), min(1250, max_level)), Image.LANCZOS)
    preview.save(assets / "map-preview.webp", "WEBP", quality=76, method=6)

    if args.keep_source:
        # предпросмотр отдаём как есть (без пережатия), чтобы не терять детали подписей
        master.save(assets / "map-source.jpg", "JPEG", quality=92, optimize=True, progressive=True)

    # хеш исходника: workflow сравнивает его, чтобы не пересобирать тайлы каждый час
    import hashlib
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    (assets / "map-source.sha256").write_text(digest + "\n", encoding="utf-8")

    manifest = {
        "mapSize": max_level,
        "tileSize": args.tile,
        "dir": "assets/tiles",
        "preview": "assets/map-preview.webp",
        "source": source.name,
        "generated": date.today().isoformat(),
        "levels": [
            {
                "index": index,
                "width": level,
                "height": level,
                "cols": max(1, -(-level // args.tile)),
                "rows": max(1, -(-level // args.tile)),
                "tile": args.tile,
            }
            for index, level in enumerate(levels)
        ],
    }
    with (assets / "tiles.json").open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    # помечаем в meta.json, что растр собран: страница перестанет рисовать схему
    meta_path = ROOT / "data" / "meta.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        meta.setdefault("assets", {})
        meta["assets"]["hasRaster"] = True
        meta["assets"]["tiles"] = "assets/tiles.json"
        meta["assets"]["levels"] = levels
        meta.setdefault("levels", levels)
        # mapSize сознательно не трогаем: это система координат атласа из data/*,
        # а не разрешение конкретной сборки тайлов.
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"data/meta.json: assets.hasRaster = true (растр {max_level}px)")

    print(f"Готово: {assets / 'tiles.json'} + {len(levels)} уровней в {tiles_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
