#!/usr/bin/env python3
"""Собирает публичный набор файлов сайта для GitHub Pages.

В артефакт попадает только то, что нужно браузеру: страница, стили, скрипт,
данные, тайлы и справочные материалы, на которые ссылаются карточки и
вики-разделы. Инструменты и служебные файлы остаются в репозитории.

Запуск: python3 tools/stage_pages.py --out dist
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    "index.html", "minimal.html", "styles.css", "wiki-skin.css", "minimal-skin.css",
    "admin-ui.css", "readability.css", "timeline-skin.css",
    "app.js", "koprulu-atlas.html", "README.md", "PIPELINE_SETUP.md",
)
DIRECTORIES = ("data", "assets")
DOCS_EXTRA = (("OTCHET_KOORDINATY.md", "docs/OTCHET_KOORDINATY.md"),)
SKIP_INSIDE = {"_source", "version.json", "map-source.sha256"}


def copy_tree(source: Path, target: Path) -> int:
    count = 0
    for path in sorted(source.rglob("*")):
        relative = path.relative_to(source)
        # Не публикуем содержимое служебных каталогов (проверка по всем частям
        # пути, а не только по имени файла): assets/_source раньше протекал в dist.
        if path.is_dir() or any(part in SKIP_INSIDE for part in relative.parts) or "__pycache__" in relative.parts:
            continue
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)
        count += 1
    return count


def copy_file(source: Path, target: Path) -> int:
    if not source.exists():
        return 0
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Сборка публичной части атласа")
    parser.add_argument("--out", default=str(ROOT / "dist"), help="каталог сборки")
    parser.add_argument("--keep", action="store_true", help="не очищать каталог перед сборкой")
    args = parser.parse_args()

    out = Path(args.out).resolve()
    if out.exists() and not args.keep:
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)

    copied = 0
    for name in FILES:
        source = ROOT / name
        if source.exists():
            copied += copy_file(source, out / name)
        elif name not in {"koprulu-atlas.html", "README.md"}:
            print(f"предупреждение: {name} не найден")

    for name in DIRECTORIES:
        source = ROOT / name
        if source.exists():
            copied += copy_tree(source, out / name)

    for source_name, target_name in DOCS_EXTRA:
        copied += copy_file(ROOT / "docs" / source_name, out / target_name)

    (out / ".nojekyll").write_text("", encoding="utf-8")
    print(f"Собрано файлов: {copied} → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
