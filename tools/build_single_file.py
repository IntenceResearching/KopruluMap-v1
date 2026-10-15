#!/usr/bin/env python3
"""Собирает автономную копию атласа в один HTML-файл.

Нужна для случаев, когда нет HTTP-сервера или предпросмотр открывает файл в
песочнице без сети: стили, скрипт и данные вшиваются внутрь страницы, а `app.js`
читает их из `window.__KOPRULU_DATA__` вместо fetch. Растровые тайлы не
вшиваются — карта рисуется схемой со слоем подписей; полноценная версия с
тайлами живёт в index.html.

Запуск: python3 tools/build_single_file.py [--out koprulu-atlas.html]
"""

from __future__ import annotations

import argparse
import base64
import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILES = {
    "meta": "meta.json",
    "systems": "systems.json",
    "planets": "planets.json",
    "overrides": "system-overrides.json",
    "labels": "map-labels.json",
}


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


def main() -> int:
    parser = argparse.ArgumentParser(description="Одиночный HTML-файл атласа")
    parser.add_argument("--out", default=str(ROOT / "koprulu-atlas.html"))
    parser.add_argument("--index", default=str(ROOT / "index.html"))
    args = parser.parse_args()

    html = read(Path(args.index))
    if not html:
        raise SystemExit("index.html не найден")

    logo_path = ROOT / "assets" / "timeline-project-logo.png"
    logo_uri = ""
    if logo_path.exists():
        logo_uri = "data:image/png;base64," + base64.b64encode(logo_path.read_bytes()).decode("ascii")
    mark_path = ROOT / "assets" / "timeline-project-mark.webp"
    mark_uri = ""
    if mark_path.exists():
        mark_uri = "data:image/webp;base64," + base64.b64encode(mark_path.read_bytes()).decode("ascii")

    styles = "\n".join(
        f"<style>\n/* {name} */\n{read(ROOT / name)}\n</style>"
        for name in ("styles.css", "wiki-skin.css", "admin-ui.css", "readability.css", "timeline-skin.css")
    )
    if logo_uri:
        styles = styles.replace("assets/timeline-project-logo.png", logo_uri)
    if mark_uri:
        styles = styles.replace("assets/timeline-project-mark.webp", mark_uri)
    script = read(ROOT / "app.js")

    payload = {}
    for key, name in DATA_FILES.items():
        raw = read(ROOT / "data" / name)
        payload[key] = json.loads(raw) if raw else None

    # Одиночный файл не содержит многомегабайтные тайлы. Не обещаем их app.js,
    # иначе автономная сборка будет запрашивать отсутствующий assets/tiles.json.
    if payload.get("meta"):
        payload["meta"] = json.loads(json.dumps(payload["meta"], ensure_ascii=False))
        payload["meta"].setdefault("assets", {})["hasRaster"] = False

    data_script = (
        "<script>window.__KOPRULU_DATA__ = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";</script>"
    )

    # выкидываем внешние ссылки на наши css/js — они заменяются вшитым содержимым
    html = re.sub(r'\s*<link rel="stylesheet" href="(?!https?:)[^"]+"[^>]*>', "", html)
    html = re.sub(r'\s*<script src="(?!https?:)[^"]+"[^>]*></script>', "", html)
    if logo_uri:
        html = re.sub(r'assets/timeline-project-logo\.png(?:\?v=[0-9a-f]+)?', logo_uri, html)

    banner = (
        f"<!-- Автономная сборка Koprulu Sector Atlas ({date.today().isoformat()}).\n"
        "     Сгенерировано tools/build_single_file.py: стили, app.js и data/*.json вшиты внутрь.\n"
        "     Карта рисуется схемой: тайлы assets/tiles подключаются только в index.html. -->\n"
    )
    html = html.replace("<head>", "<head>" + banner, 1)
    html = html.replace("</head>", styles + "\n</head>", 1)
    html = html.replace("</body>", data_script + "\n<script>\n" + script + "\n</script>\n</body>", 1)

    out = Path(args.out)
    out.write_text(html, encoding="utf-8")
    size = out.stat().st_size / 1024
    print(f"Собрано: {out} ({size:.0f} КБ) — {len(payload['systems'] or [])} систем, "
          f"{len(payload['planets'] or [])} мест, {len(payload['labels'] or [])} подписей карты")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
