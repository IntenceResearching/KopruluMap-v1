#!/usr/bin/env python3
"""Скачивает публично расшаренный файл Google Drive без Google API.

Используется gdown: он понимает и обычную share-ссылку вида
https://drive.google.com/file/d/<ID>/view?usp=sharing, и страницу
подтверждения скачивания для больших файлов. API-ключ, OAuth и service account
не нужны, но у файла должен быть доступ «Все, у кого есть ссылка → Читатель».

Примеры:
    python3 tools/download_drive_file.py "https://drive.google.com/file/d/1AbC.../view" --out assets/_source/map.png
    python3 tools/download_drive_file.py 1AbC... --out assets/_source/map.png
    GOOGLE_DRIVE_MAP_URL="https://drive.google.com/..." python3 tools/download_drive_file.py

Код возврата: 0 — скачано, 1 — ошибка (сообщение объясняет, что проверить).
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES_FILE = ROOT / "data" / "sources.json"


def configured_map_url() -> str | None:
    """env подменяет рабочую ссылку из data/sources.json."""
    value = os.environ.get("GOOGLE_DRIVE_MAP_URL")
    if value:
        return value
    try:
        import json
        payload = json.loads(SOURCES_FILE.read_text(encoding="utf-8"))
        return payload.get("map", {}).get("url")
    except (OSError, ValueError, TypeError):
        return None


ID_PATTERNS = (
    re.compile(r"/file/d/([A-Za-z0-9_-]{10,})"),
    re.compile(r"[?&]id=([A-Za-z0-9_-]{10,})"),
    re.compile(r"/d/([A-Za-z0-9_-]{10,})"),
    re.compile(r"/uc\?export=download&id=([A-Za-z0-9_-]{10,})"),
)
BARE_ID = re.compile(r"^[A-Za-z0-9_-]{10,}$")


def extract_file_id(value: str) -> str:
    value = value.strip()
    for pattern in ID_PATTERNS:
        match = pattern.search(value)
        if match:
            return match.group(1)
    if BARE_ID.match(value):
        return value
    raise SystemExit(
        "Не удалось извлечь ID файла из ссылки.\n"
        "Нужна ссылка на файл (не на папку), например:\n"
        "  https://drive.google.com/file/d/<ID>/view?usp=sharing"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Скачивание публичного файла Google Drive через gdown")
    parser.add_argument("url", nargs="?", default=configured_map_url(),
                        help="share-ссылка/ID; по умолчанию env GOOGLE_DRIVE_MAP_URL, затем data/sources.json")
    parser.add_argument("--out", default="assets/_source/map.png", help="куда сохранить файл")
    parser.add_argument("--quiet", action="store_true", help="без подробного вывода gdown")
    args = parser.parse_args(argv)

    if not args.url:
        parser.error("укажите share-ссылку, задайте GOOGLE_DRIVE_MAP_URL или заполните data/sources.json")

    file_id = extract_file_id(args.url)
    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)

    try:
        import gdown  # noqa: WPS433 (импорт внутри — понятная ошибка, если пакета нет)
    except ImportError:
        print("Нужен пакет gdown: pip install -r tools/requirements.txt", file=sys.stderr)
        return 1

    # В gdown нет аргумента fuzzy: передаём прямой URL скачивания — так совместимо
    # с разными версиями библиотеки и не ломается на большие файлы.
    url = f"https://drive.google.com/uc?export=download&id={file_id}"
    print(f"Скачиваю файл Drive {file_id} → {target}")
    try:
        result = gdown.download(url=url, output=str(target), quiet=bool(args.quiet))
    except TypeError:
        # старые версии gdown требуют url первым позиционным аргументом
        result = gdown.download(url, str(target), quiet=bool(args.quiet))

    if not result or not target.exists() or target.stat().st_size == 0:
        print(
            "Скачать не удалось. Проверьте:\n"
            "  • у файла доступ «Все, у кого есть ссылка → Читатель»;\n"
            "  • это файл, а не папка;\n"
            "  • это обычный PNG/JPEG/WebP, а не Google Docs/PSD;\n"
            "  • ссылка из «Копировать ссылку», а не из адресной строки редактора.",
            file=sys.stderr,
        )
        return 1

    size = target.stat().st_size
    print(f"Готово: {target} ({size / 1048576:.1f} МБ)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
