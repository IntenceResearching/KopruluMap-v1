#!/usr/bin/env python3
"""Превращает опубликованный CSV Google Sheets в data/system-overrides.json.

Правила, заложенные в атлас:
  * `id` — стабильный ключ. Название можно менять, ID — нет.
  * `X`/`Y` — целые 0…10000; альтернатива — `x_norm`/`y_norm` в диапазоне 0…1.
  * Пустая пара координат НЕ удаляет координату: строка просто не меняет запись.
  * Пустые описание/фракция не создают переопределение.
  * Неизвестный ID, дубли и некорректные числа останавливают синхронизацию: лучше
    не применить строку, чем поставить случайную точку.

Примеры:
    python3 tools/sync_system_overrides.py --url "$GOOGLE_SHEETS_CSV_URL"
    python3 tools/sync_system_overrides.py --csv data/systems-sheet-template.csv --dry-run
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import unicodedata
import urllib.request
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAP_SIZE = 10000
HEADER_ALIASES = {
    "id": ("id", "ид", "ключ"),
    "name": ("название системы", "название", "name", "система"),
    "x": ("x", "х", "коорд x", "x px"),
    "y": ("y", "у", "коорд y", "y px"),
    "x_norm": ("x_norm", "x norm", "x 0-1"),
    "y_norm": ("y_norm", "y norm", "y 0-1"),
    "description": ("описание", "description", "note"),
    "faction": ("фракция", "faction"),
}


def fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "koprulu-atlas-sync/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 — ссылка задаётся владельцем репозитория
        raw = response.read()
    for encoding in ("utf-8-sig", "utf-8", "cp1251"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def read_rows(text: str) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise SystemExit("CSV пуст: не найдено ни заголовка, ни строк")

    mapping: dict[str, str] = {}
    for field in reader.fieldnames:
        key = unicodedata.normalize("NFKC", (field or "").strip().lower().replace("ё", "е"))
        for canonical, aliases in HEADER_ALIASES.items():
            if key in aliases:
                mapping[field] = canonical
                break
    if "id" not in mapping.values():
        raise SystemExit("В CSV нет колонки id — без неё строка не привязывается к каталогу")

    rows = []
    for raw in reader:
        row: dict[str, str] = {}
        for field, canonical in mapping.items():
            row[canonical] = (raw.get(field) or "").strip()
        if any(row.values()):
            rows.append(row)
    return rows


def parse_coord(value: str) -> int | None:
    if not value:
        return None
    cleaned = value.replace("\u2009", "").replace("\u00a0", "").replace(" ", "").replace(",", ".")
    number = float(cleaned)
    if abs(number - round(number)) > 1e-6:
        raise ValueError(f"«{value}» не целое число")
    return int(round(number))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sheets CSV → data/system-overrides.json")
    parser.add_argument("--url", help="ссылка «Опубликовать в интернете» в формате CSV")
    parser.add_argument("--csv", help="локальный CSV (проверка шаблона без сети)")
    parser.add_argument("--systems", default=str(ROOT / "data" / "systems.json"))
    parser.add_argument("--out", default=str(ROOT / "data" / "system-overrides.json"))
    parser.add_argument("--dry-run", action="store_true", help="только проверить, ничего не писать")
    args = parser.parse_args(argv)

    if not args.url and not args.csv:
        print("Нужен --url (публикация Sheets) или --csv (локальный файл).", file=sys.stderr)
        return 2

    systems = json.loads(Path(args.systems).read_text(encoding="utf-8"))
    known = {system["id"]: system for system in systems}

    text = Path(args.csv).read_text(encoding="utf-8-sig") if args.csv else fetch(args.url)
    rows = read_rows(text)

    out_path = Path(args.out)
    current = {"version": 1, "mapSize": MAP_SIZE, "systems": {}}
    if out_path.exists():
        current = json.loads(out_path.read_text(encoding="utf-8"))
    existing: dict[str, dict] = current.get("systems") or {}
    previous = dict(existing)

    problems: list[str] = []
    seen: set[str] = set()
    added, updated, unchanged, touched = 0, 0, 0, 0
    origin_kind = "google-sheets" if args.url else "local-csv"

    for line, row in enumerate(rows, start=2):
        system_id = row.get("id", "")
        if not system_id:
            problems.append(f"строка {line}: пустой id")
            continue
        if system_id in seen:
            problems.append(f"строка {line}: id «{system_id}» повторяется")
            continue
        seen.add(system_id)
        if system_id not in known:
            problems.append(f"строка {line}: id «{system_id}» отсутствует в data/systems.json")
            continue

        x = y = None
        try:
            if row.get("x") or row.get("y"):
                x = parse_coord(row.get("x", ""))
                y = parse_coord(row.get("y", ""))
                if x is None or y is None:
                    problems.append(f"строка {line}: X и Y заполняются только вместе")
                    continue
                if not (0 <= x <= MAP_SIZE and 0 <= y <= MAP_SIZE):
                    problems.append(f"строка {line}: координаты вне 0…{MAP_SIZE}")
                    continue
            elif row.get("x_norm") or row.get("y_norm"):
                x = round(float(row.get("x_norm", "").replace(",", ".")) * MAP_SIZE)
                y = round(float(row.get("y_norm", "").replace(",", ".")) * MAP_SIZE)
                if not (0 <= x <= MAP_SIZE and 0 <= y <= MAP_SIZE):
                    problems.append(f"строка {line}: x_norm/y_norm вне 0…1")
                    continue
        except ValueError as error:
            problems.append(f"строка {line}: {error}")
            continue

        description = row.get("description") or ""
        faction = row.get("faction") or ""
        name = row.get("name") or known[system_id]["name"]

        if x is None and not description and not faction:
            touched += 1
            continue

        record = dict(existing.get(system_id) or {})
        if x is not None:
            same = record.get("x") == x and record.get("y") == y
            record.update({"x": x, "y": y, "x_norm": round(x / MAP_SIZE, 6), "y_norm": round(y / MAP_SIZE, 6)})
            if same:
                unchanged += 1
            else:
                record["label"] = name.replace("Система ", "")
                record.setdefault("confidence", "sheet")
                record["source"] = origin_kind
                if system_id in previous:
                    updated += 1
                else:
                    added += 1
        if description:
            record["description"] = description
        if faction:
            record["faction"] = faction
        existing[system_id] = record

    if problems:
        print("Синхронизация остановлена, ничего не записано:", file=sys.stderr)
        for problem in problems:
            print(f"  • {problem}", file=sys.stderr)
        return 1

    if not seen:
        print("В CSV нет строк данных — нечего применять.", file=sys.stderr)
        return 1

    counts = Counter(record.get("confidence", "unknown") for record in existing.values())
    payload = dict(current)
    payload.update({
        "version": 1,
        "mapSize": MAP_SIZE,
        "sourceImage": current.get("sourceImage") or "KopruluSectorData2513.jpg",
        "coordinateFormat": f"x/y: целые 0..{MAP_SIZE}; x_norm/y_norm: 0..1",
        "generated": date.today().isoformat(),
        "origin": {
            "kind": origin_kind,
            "source": args.url or args.csv,
            "rows": len(seen),
            "syncedAt": datetime.now(timezone.utc).replace(microsecond=0, tzinfo=None).isoformat() + "Z",
        },
        "counts": {
            "total": len(existing),
            "high": counts.get("high", 0),
            "medium": counts.get("medium", 0),
            "low": counts.get("low", 0),
            "sheet": counts.get("sheet", 0),
        },
        "systems": dict(sorted(existing.items())),
    })

    print(f"Строк в CSV: {len(seen)} · новых координат: {added} · обновлено: {updated} · "
          f"координаты совпали: {unchanged} · строк без координат: {touched} · "
          f"всего записей в файле: {len(existing)}")

    if args.dry_run:
        print("--dry-run: запись пропущена")
        return 0

    with out_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"Записано: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
