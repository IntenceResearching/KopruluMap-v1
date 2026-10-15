#!/usr/bin/env python3
"""Проверяет целостность данных атласа перед публикацией.

Проверяются: разбор JSON, уникальность id, диапазоны координат, ссылки
`systemId`/`planetIds`, соответствие `x_norm` значениям `x`, согласованность
счётчиков `meta.json` и наличие id из шаблона таблицы в каталоге систем.

Код возврата 0 — всё чисто, 1 — есть ошибки (публикацию лучше остановить).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

errors: list[str] = []
warnings: list[str] = []


def load(name: str):
    path = DATA / name
    if not path.exists():
        errors.append(f"{name}: файл не найден")
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        errors.append(f"{name}: не разбирается как JSON ({error})")
        return None


def main() -> int:
    meta = load("meta.json")
    systems = load("systems.json") or []
    planets = load("planets.json") or []
    overrides = load("system-overrides.json") or {"systems": {}}
    labels = load("map-labels.json") or []
    canonical = load("canonical-wiki-places.json") or {"places": {}}
    legacy_planets = load("legacy-planets.json") or []

    if meta is None:
        return 1

    map_size = meta.get("mapSize", 10000)

    # --- системы
    system_ids = set()
    for index, system in enumerate(systems):
        where = f"systems[{index}]"
        system_id = system.get("id")
        if not system_id:
            errors.append(f"{where}: нет id")
            continue
        if system_id in system_ids:
            errors.append(f"{where}: id «{system_id}» повторяется")
        system_ids.add(system_id)
        if not system.get("name"):
            errors.append(f"{where}: нет имени")
        elif not system["name"].startswith("Система "):
            errors.append(f"{where}: имя должно начинаться с «Система »")
        coord = system.get("coord") or system.get("conditionalCoord")
        if coord:
            if len(coord) != 2 or any(not isinstance(value, int) or not 0 <= value <= map_size for value in coord):
                errors.append(f"{where}: coord {coord} вне 0…{map_size}")

    # --- планеты
    planet_ids = set()
    for index, planet in enumerate(planets):
        where = f"planets[{index}]"
        planet_id = planet.get("id")
        if not planet_id:
            errors.append(f"{where}: нет id")
            continue
        if planet_id in planet_ids:
            errors.append(f"{where}: id «{planet_id}» повторяется")
        planet_ids.add(planet_id)
        system_id = planet.get("systemId")
        if system_id and system_id not in system_ids:
            warnings.append(f"{where} ({planet_id}): systemId «{system_id}» отсутствует среди систем")
        for key in ("mapCoord",):
            coord = planet.get(key)
            if coord and not (0 <= coord.get("x", -1) <= map_size and 0 <= coord.get("y", -1) <= map_size):
                errors.append(f"{where}: {key} вне 0…{map_size}")

    actual_members = {system_id: set() for system_id in system_ids}
    for planet in planets:
        if planet.get("systemId") in actual_members:
            actual_members[planet["systemId"]].add(planet["id"])
    for index, system in enumerate(systems):
        declared_members = set(system.get("planetIds") or [])
        for planet_id in declared_members:
            if planet_id not in planet_ids:
                warnings.append(f"systems[{index}] ({system.get('id')}): planetIds содержит «{planet_id}», которого нет в каталоге")
        if declared_members != actual_members.get(system["id"], set()):
            errors.append(f"systems[{index}] ({system['id']}): planetIds не согласован с planets[].systemId")

    # --- полный строгий Wiki-реестр
    canonical_places = canonical.get("places") or {}
    planet_by_title = {planet.get("canonicalWikiTitle"): planet for planet in planets}
    if len(planet_by_title) != len(planets):
        errors.append("planets.json: canonicalWikiTitle отсутствует или повторяется")
    if len(legacy_planets) != 316:
        errors.append(f"legacy-planets.json: ожидалось 316 исходных строк, получено {len(legacy_planets)}")
    for title, record in canonical_places.items():
        planet = planet_by_title.get(title)
        if not planet:
            errors.append(f"canonical-wiki-places: страница «{title}» не попала в planets.json")
            continue
        if not planet.get("canonical") or not planet.get("strictCanon") or planet.get("wikiConfidence") != "strict-canon":
            errors.append(f"planets[{planet.get('id')}]: строгий канон не применён")
        if sorted(planet.get("placeTypes") or []) != sorted(record.get("types") or []):
            errors.append(f"planets[{planet.get('id')}]: типы места не совпадают с Wiki-реестром")
        explicit_system = record.get("system")
        if explicit_system and planet.get("systemId") != explicit_system.get("id"):
            errors.append(f"planets[{planet.get('id')}]: не применён явный WorldBox.system")
    excluded_titles = set((canonical.get("excluded") or {}).keys())
    leaked = excluded_titles.intersection(planet_by_title)
    if leaked:
        errors.append(f"planets.json: в строгий каталог попали исключённые страницы {sorted(leaked)[:5]}")

    # --- переопределения
    override_systems = overrides.get("systems") or {}
    override_positions: dict[tuple[int, int], str] = {}
    for system_id, record in override_systems.items():
        where = f"system-overrides[{system_id}]"
        if system_id not in system_ids:
            errors.append(f"{where}: id неизвестен каталогу систем")
        x, y = record.get("x"), record.get("y")
        if x is None or y is None:
            if not any(record.get(key) for key in ("description", "faction")):
                errors.append(f"{where}: нет ни координат, ни описания/фракции")
            continue
        if not (0 <= x <= map_size and 0 <= y <= map_size):
            errors.append(f"{where}: координаты {x},{y} вне 0…{map_size}")
        # Разные системные кольца не могут иметь один центр. Именно такая ошибка
        # раньше склеила Икар с Умоджей, а Онуру — с Тирадором.
        position = (int(x), int(y))
        if position in override_positions:
            errors.append(
                f"{where}: координаты {x},{y} уже заняты системой «{override_positions[position]}»"
            )
        else:
            override_positions[position] = system_id
        if record.get("x_norm") is not None and abs(record["x_norm"] - x / map_size) > 0.000002:
            errors.append(f"{where}: x_norm не совпадает с x ({record['x_norm']} против {x / map_size:.6f})")
        if record.get("y_norm") is not None and abs(record["y_norm"] - y / map_size) > 0.000002:
            errors.append(f"{where}: y_norm не совпадает с y")
        if record.get("confidence") not in ("high", "medium", "low", "sheet", None):
            warnings.append(f"{where}: нестандартная уверенность «{record.get('confidence')}»")

    # --- слой подписей карты
    for index, label in enumerate(labels):
        if not label.get("name"):
            errors.append(f"map-labels[{index}]: нет имени")
        x, y = label.get("x"), label.get("y")
        if x is None or y is None or not (0 <= x <= map_size and 0 <= y <= map_size):
            errors.append(f"map-labels[{index}] ({label.get('name')}): координаты вне 0…{map_size}")
        if label.get("kind") == "system" and not label.get("name", "").startswith("Система "):
            errors.append(f"map-labels[{index}]: название системы не в форме «Система <имя>»")
        if label.get("linkedSystemId") and label["linkedSystemId"] not in system_ids:
            errors.append(f"map-labels[{index}]: linkedSystemId «{label['linkedSystemId']}» неизвестен")
        if label.get("linkedPlanetId") and label["linkedPlanetId"] not in planet_ids:
            errors.append(f"map-labels[{index}]: linkedPlanetId «{label['linkedPlanetId']}» неизвестен")

    # --- счётчики meta
    checks = {
        "planetCount": len(planets),
        "placeCount": len(planets),
        "legacyPlanetCount": len(legacy_planets),
        "addedCanonicalPlaces": sum(1 for row in planets if row.get("addedFromWiki")),
        "matchedLegacyPlaces": sum(1 for row in planets if not row.get("addedFromWiki")),
        "strictExcludedPages": len(canonical.get("excluded") or {}),
        "groupedPlanetCount": sum(1 for row in planets if row.get("systemId")),
        "unassignedPlanetCount": sum(1 for row in planets if not row.get("systemId")),
        "systemCount": len(systems),
        "overridesCount": len(override_systems),
        "systemsWithMapCoord": len(override_systems),
        "systemsWithConditionalCoord": sum(1 for row in systems if row.get("coord")) - len(override_systems),
        "systemsWithoutAnyCoord": sum(1 for row in systems if not row.get("coord")),
        "systemsWithoutMapCoord": len(systems) - len(override_systems),
        "mapLabeledObjects": len(labels),
        "canonicalWikiMatchedPlanets": len(canonical_places),
        "canonicalWikiSystemPlanets": sum(1 for row in canonical_places.values() if row.get("system")),
        "canonicalWikiSystems": len({row["system"]["id"] for row in canonical_places.values() if row.get("system")}),
        "wikiRejectedDuplicateLinks": len(canonical.get("duplicateRejections") or []),
    }
    for key, actual in checks.items():
        declared = meta.get(key)
        if declared != actual:
            warnings.append(f"meta.json: {key} = {declared}, фактически {actual}")
    actual_type_counts: dict[str, int] = {}
    for row in planets:
        for place_type in row.get("placeTypes") or []:
            actual_type_counts[place_type] = actual_type_counts.get(place_type, 0) + 1
    if meta.get("placeTypeCounts") != dict(sorted(actual_type_counts.items())):
        warnings.append(f"meta.json: placeTypeCounts = {meta.get('placeTypeCounts')}, фактически {actual_type_counts}")

    # --- шаблон таблицы
    template = DATA / "systems-sheet-template.csv"
    if template.exists():
        import csv
        with template.open(encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        template_ids = {row.get("id") for row in rows}
        missing = system_ids - template_ids
        if missing:
            errors.append(f"systems-sheet-template.csv: нет строк для {sorted(missing)[:5]}")
        unknown = template_ids - system_ids
        if unknown:
            errors.append(f"systems-sheet-template.csv: неизвестные id {sorted(unknown)[:5]}")
    else:
        warnings.append("systems-sheet-template.csv отсутствует")

    for warning in warnings:
        print(f"предупреждение: {warning}")
    for error in errors:
        print(f"ОШИБКА: {error}")

    if errors:
        print(f"\nПроверка не пройдена: {len(errors)} ошибок, {len(warnings)} предупреждений")
        return 1
    print(f"Данные в порядке: {len(systems)} систем, {len(planets)} мест, "
          f"{len(override_systems)} переопределений, {len(labels)} подписей карты "
          f"({len(warnings)} предупреждений)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
