#!/usr/bin/env python3
"""Проставляет cache-busting версию в index.html для локальных ассетов.

Версия — короткий хеш содержимого интерфейса и данных. После синхронизации
тайлов или оверрайдов ссылки получают новый `?v=…`, и браузер не смешивает
старые CSS/JS/JSON с новыми. `app.js` читает эту версию из собственного тега
<script> и добавляет её же к запросам data/*.json и assets/tiles.json.

Запуск: python3 tools/set_asset_version.py
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION_RE = re.compile(r'(?P<attr>href|src)="(?P<path>[^"?]+)(?:\?v=[0-9a-f]+)?"')


def fingerprint(paths: list[Path]) -> str:
    digest = hashlib.sha1()
    for path in sorted(paths):
        if not path.exists():
            continue
        digest.update(path.name.encode("utf-8"))
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                digest.update(chunk)
    return digest.hexdigest()[:16]


def collect(paths: list[str]) -> list[Path]:
    files: list[Path] = []
    for pattern in paths:
        files.extend(path for path in ROOT.glob(pattern) if path.is_file())
    return files


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Cache-busting версия ассетов в HTML-страницах")
    parser.add_argument("--index", nargs="*", default=None,
                        help="страницы (по умолчанию все точки входа, кроме однофайловой сборки)")
    parser.add_argument("--print-only", action="store_true", help="показать версию, не меняя файл")
    args = parser.parse_args(argv)

    watch = [
        "app.js", "styles.css", "wiki-skin.css", "minimal-skin.css", "admin-ui.css", "readability.css",
        "timeline-skin.css", "assets/timeline-project-logo.png", "assets/timeline-project-mark.webp",
        "data/*.json", "assets/tiles.json",
    ]
    files = collect(watch)
    version = fingerprint(files)

    if args.index:
        pages = [Path(item) for item in args.index]
    else:
        # точки входа; koprulu-atlas.html собирается отдельно с вшитыми ассетами
        pages = [ROOT / "index.html", ROOT / "minimal.html"]

    print(f"Файлов в подписи: {len(files)}")
    print(f"Новая версия: {version}")
    if args.print_only:
        return 0

    def replace(match: re.Match) -> str:
        path = match.group("path")
        if path.startswith(("http://", "https://", "//", "data:")):
            return match.group(0)
        return f'{match.group("attr")}="{path}?v={version}"'

    for page in pages:
        if not page.exists():
            print(f"пропуск: {page.name} не найден")
            continue
        html = page.read_text(encoding="utf-8")
        previous = re.search(r"\?v=([0-9a-f]+)", html)
        updated = VERSION_RE.sub(replace, html)
        if updated != html:
            page.write_text(updated, encoding="utf-8")
            print(f"Обновлён {page.relative_to(ROOT)}: {previous.group(1) if previous else '—'} → {version}")
        else:
            print(f"{page.relative_to(ROOT)}: версия уже актуальна")

    (ROOT / "assets" / "version.json").write_text(
        json.dumps({"version": version, "appliedTo": [page.name for page in pages if page.exists()]},
                   ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
