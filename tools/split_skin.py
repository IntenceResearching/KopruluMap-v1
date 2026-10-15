#!/usr/bin/env python3
"""Разделяет minimal-skin.css по назначению.

Файл, который пришёл как «минимальный скин», содержал три разные вещи: саму
минимальную раскладку, интерфейс админ-панели и правки читаемости шрифтов.
Из-за этого полный атлас (без минимальной раскладки) оставался без стилей
админ-панели. Скрипт один раз переносит блоки в отдельные файлы:

    minimal-skin.css   — только раскладка минимального скина
    admin-ui.css       — доступ по коду, док редактирования, модальное окно
    readability.css    — увеличенные подписи для стандартного масштаба браузера

Правила копируются дословно. Запуск: python3 tools/split_skin.py
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "minimal-skin.css"
READABILITY_MARKER = "/* Readability pass for a standard browser zoom level (100%). */"

ADMIN_PATTERNS = (
    ".admin-access-button", ".admin-lock", "#mapCanvas.admin-mode",
    ".admin-dock", ".admin-modal", ".admin-instruction", ".admin-selected",
    ".coordinate-fields", ".admin-primary", ".admin-tools", ".admin-save-status",
    ".admin-form", ".admin-error", ".admin-security-note", ".admin-backdrop",
)


def is_admin(selector: str) -> bool:
    parts = [part.strip() for part in selector.split(",")]
    return any(any(pattern in part for pattern in ADMIN_PATTERNS) for part in parts)


def split_blocks(text: str) -> list[tuple[str, str, str]]:
    """Возвращает список (вид, прелюдия, тело) для правил верхнего уровня."""
    blocks: list[tuple[str, str, str]] = []
    index = 0
    length = len(text)
    while index < length:
        while index < length and text[index].isspace():
            index += 1
        start = index
        while index < length and text[index] != "{":
            if text[index] == ";":
                break
            index += 1
        if index >= length:
            break
        prelude = text[start:index].strip()
        if text[index] == ";":
            blocks.append(("at", prelude + ";", ""))
            index += 1
            continue
        depth = 0
        body_start = index
        while index < length:
            if text[index] == "{":
                depth += 1
            elif text[index] == "}":
                depth -= 1
                if depth == 0:
                    index += 1
                    break
            index += 1
        body = text[body_start:index]
        kind = "media" if prelude.startswith("@media") else "rule"
        blocks.append((kind, prelude, body))
    return blocks


def reindent(body: str) -> str:
    lines = [line.strip() for line in body.strip().strip("{}").strip().splitlines()]
    return "\n".join("  " + line for line in lines if line)


def main() -> int:
    text = SOURCE.read_text(encoding="utf-8")
    if READABILITY_MARKER in text:
        layout_text, readability = text.split(READABILITY_MARKER, 1)
        readability = READABILITY_MARKER + readability
    else:
        layout_text, readability = text, ""

    layout_parts: list[str] = []
    admin_parts: list[str] = []

    for kind, prelude, body in split_blocks(layout_text):
        if kind == "rule":
            (admin_parts if is_admin(prelude) else layout_parts).append(f"{prelude} {body}\n")
            continue
        if kind == "at":
            layout_parts.append(prelude + "\n")
            continue

        # @media: раскладываем вложенные правила по назначению и пересобираем обёртки
        inner_layout: list[str] = []
        inner_admin: list[str] = []
        for inner_kind, inner_prelude, inner_body in split_blocks(body.strip()[1:-1]):
            target = inner_admin if is_admin(inner_prelude) else inner_layout
            target.append(f"  {inner_prelude} {inner_body}\n")
        header = f"{prelude} {{\n"
        if inner_layout:
            layout_parts.append(header + "".join(inner_layout) + "}\n")
        if inner_admin:
            admin_parts.append(header + "".join(inner_admin) + "}\n")

    SOURCE.write_text(
        "/* Minimal atlas skin: только раскладка — карта, поиск, досье и док админа. */\n"
        "/* Интерфейс админ-панели и читаемость подписей вынесены в admin-ui.css и readability.css: */\n"
        "/* они нужны не только минимальному скину. */\n"
        + "\n".join(layout_parts).rstrip()
        + "\n",
        encoding="utf-8",
    )

    (ROOT / "admin-ui.css").write_text(
        "/* Интерфейс администратора: доступ по коду, док редактирования координат, модальное окно.\n"
        "   Выделено из minimal-skin.css скриптом tools/split_skin.py — правила перенесены дословно,\n"
        "   потому что режим правки нужен в любом скине, а не только в минимальном. */\n"
        "#mapCanvas.admin-mode { cursor: crosshair; }\n"
        "#mapCanvas.admin-mode.marker-hover { cursor: grab; }\n"
        "#mapCanvas.admin-mode.dragging { cursor: grabbing; }\n\n"
        + "\n".join(admin_parts).rstrip()
        + "\n",
        encoding="utf-8",
    )

    (ROOT / "readability.css").write_text(
        "/* Читаемость при стандартном масштабе браузера: увеличенные подписи поиска,\n"
        "   досье, админ-панели и управления картой. Выделено из minimal-skin.css,\n"
        "   где правки шли отдельным блоком и потому не действовали в других скинах. */\n"
        + readability.strip()
        + "\n",
        encoding="utf-8",
    )

    print("minimal-skin.css:", len(layout_parts), "блоков раскладки")
    print("admin-ui.css:   ", len(admin_parts), "блоков интерфейса админа")
    print("readability.css:", "перенесён блок читаемости" if readability else "пусто")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
