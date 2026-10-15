#!/usr/bin/env python3
"""Собирает рабочий каталог сайта (data/*.json) из исходников в docs/source/.

Что делает:
  1. data/systems.json          — каталог систем в именительном падеже + подтверждённые Wiki-системы.
  2. data/system-overrides.json — координаты, снятые с подписей карты (приоритет над базой).
  3. data/planets.json          — 297 строгих канонических мест полного Wiki-аудита.
  4. data/legacy-planets.json   — прежние 316 обогащённых строк для аудита.
  5. data/map-labels.json       — подписи, реально найденные на карте (слой «свидетельств»).
  6. data/meta.json             — счётчики, типы мест, размеры карты, уровень детализации.
  7. data/systems-sheet-template.csv — шаблон Google Sheets для синхронизации.

Запуск:  python3 tools/derive_catalog.py
Идемпотентен: повторный запуск даёт тот же результат.
"""

from __future__ import annotations

import csv
import json
import re
import sys
import unicodedata
from collections import Counter
from copy import deepcopy
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "docs" / "source"
DATA = ROOT / "data"
GENERATED = date.today().isoformat()
MAP_SIZE = 10000

try:  # консоль Windows иногда не любит кириллицу
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # pragma: no cover
    pass


# ----------------------------------------------------------------------------- helpers
def read_json(path: Path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def norm(value: str | None) -> str:
    """Нормализация подписи для сопоставления: регистр, ё→е, дефисы, пробелы."""
    if not value:
        return ""
    text = unicodedata.normalize("NFKC", str(value)).lower().replace("ё", "е")
    text = re.sub(r"[\u2010-\u2015]", "-", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def wiki_place_id(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.casefold()).strip("-")
    return "wiki-" + slug


def strip_system_prefix(value: str | None) -> str:
    return re.sub(r"^\s*система\s+", "", norm(value))


# падежные окончания: карта подписывает «Система Шакурасы», каталог — «Система Шакураса»
ENDINGS = (
    "иями", "иях", "иям", "ием", "ией", "ию", "ия", "ии", "ью", "ей", "ов", "ев",
    "ах", "ях", "ам", "ям", "ом", "ем", "ой", "ый", "ий", "ая", "яя", "ое", "ее",
    "а", "я", "ы", "и", "е", "у", "ю", "о",
)


def stem(word: str) -> str:
    for ending in ENDINGS:
        if len(word) > len(ending) + 3 and word.endswith(ending):
            return word[: -len(ending)]
    return word


def stem_key(value: str | None) -> str:
    return " ".join(stem(part) for part in strip_system_prefix(value).split())


def round6(value: float) -> float:
    return round(value + 0.0, 6)


CYRILLIC = re.compile(r"[А-Яа-яЁё]")
LATIN = re.compile(r"[A-Za-z]")
VOWEL = re.compile(r"[АЕЁИОУЫЭЮЯаеёиоуыэюяAeiouAEIOU]")


def is_noisy(name: str) -> bool:
    """Грубая оценка качества OCR-подписи.

    Шумными считаем смешение алфавитов, обрывки, строки без гласных и
    капсовые огрызки вроде «АНТИ» — такие подписи показываем только при
    сильном увеличении, чтобы не засорять обзорную карту.
    """
    letters = re.sub(r"[^А-Яа-яЁёA-Za-z]", "", name)
    if not letters:
        return True
    if CYRILLIC.search(name) and LATIN.search(name):
        return True
    if len(letters) < 3:
        return True
    if not VOWEL.search(letters):
        return True
    if letters == letters.upper() and len(letters) <= 5:
        return True
    if len(letters) >= 4 and re.search(r"[A-Za-z]{2,}", letters) and not CYRILLIC.search(letters):
        return False
    return False


# ----------------------------------------------------------------------------- источники
base_systems_raw = read_json(SRC / "systems.updated.json")
planets_raw = read_json(SRC / "planets.updated.json")
overrides_raw = read_json(SRC / "system-overrides.json")
atlas = read_json(SRC / "koprulu-coordinates.json")
system_names = read_json(SRC / "system-names-nominative.json")
map_system_names = read_json(SRC / "map-system-names-nominative.json")
canonical = read_json(DATA / "canonical-wiki-planets.json")
canonical_planets = canonical.get("planets", {})
rejected_wiki_ids = {entry["planetId"] for entry in canonical.get("rejectedDuplicateLinks", [])}
canonical_places = read_json(DATA / "canonical-wiki-places.json")
strict_places = canonical_places.get("places", {})
strict_systems: dict[str, dict] = {}
for place in strict_places.values():
    system = place.get("system")
    if system:
        strict_systems.setdefault(system["id"], system)

atlas_systems = atlas.get("systems", {})
atlas_planets = atlas.get("planets", {})
atlas_coords = atlas.get("coordinates", {})
atlas_objects = atlas.get("mapObjectsWithoutPlanet", [])
atlas_object_planets = {
    entry["catalogPlanetId"]: entry
    for entry in atlas_objects
    if entry.get("catalogPlanetId")
}

atlas_systems_by_name = {}
atlas_systems_by_stem = {}
for slug, entry in atlas_systems.items():
    atlas_systems_by_name.setdefault(strip_system_prefix(entry.get("name")), (slug, entry))
    atlas_systems_by_stem.setdefault(stem_key(entry.get("name")), (slug, entry))

atlas_planets_by_name: dict[str, dict] = {}
atlas_planets_by_stem: dict[str, dict] = {}
for slug, entry in atlas_planets.items():
    key = norm(entry.get("name"))
    current = atlas_planets_by_name.get(key)
    if current is None or (not current.get("fandomUrl") and entry.get("fandomUrl")):
        atlas_planets_by_name[key] = {**entry, "_slug": slug}
    atlas_planets_by_stem.setdefault(stem_key(entry.get("name")), {**entry, "_slug": slug})


# ----------------------------------------------------------------------------- systems.json
systems: list[dict] = []
override_lookup = overrides_raw.get("systems", {})

for raw in base_systems_raw:
    item = {
        "id": raw["id"],
        "name": system_names.get(raw["id"], raw["name"]),
        "source": raw.get("source"),
        "sourceTitle": raw.get("sourceName"),  # обычно None — имя берётся из каталога
        "confidence": raw.get("confidence"),
        "note": raw.get("note"),
        "refs": raw.get("refs") or [],
        "planetIds": raw.get("planetIds") or [],
        "planetCount": raw.get("planetCount", len(raw.get("planetIds") or [])),
        "factions": raw.get("factions") or [],
        "primaryFaction": raw.get("primaryFaction") or (raw.get("factions") or [None])[0],
        "map": bool(raw.get("map")),
        "coordSource": "original-conditional",
        "coord": None,
        "conditionalCoord": None,
        "needsReview": bool(raw.get("needsReview")),
    }
    if item["sourceTitle"] is None:
        item.pop("sourceTitle")

    # координата: если в systems.updated.json она уже снята с карты — возвращаем исходную
    if raw.get("coordSource") == "map" and raw.get("oldCoord"):
        item["conditionalCoord"] = list(raw["oldCoord"])
    elif raw.get("coord"):
        item["conditionalCoord"] = list(raw["coord"])
    item["coord"] = item["conditionalCoord"]

    if raw.get("mapNote"):
        item["mapNote"] = raw["mapNote"]

    # обогащение из справочника koprulu-coordinates.json
    key = strip_system_prefix(raw["name"])
    slug, ref = atlas_systems_by_name.get(key, (None, None))
    if ref is None:
        slug, ref = atlas_systems_by_stem.get(stem_key(raw["name"]), (None, None))
    if ref:
        item["atlasKey"] = slug
        if ref.get("nameEn"):
            item["nameEn"] = ref["nameEn"]
        if ref.get("fandomUrl"):
            item["wiki"] = ref["fandomUrl"]
        if ref.get("x") is not None:
            item["atlasCoord"] = {"x": ref["x"], "y": ref["y"]}
    systems.append(item)

# Структурированные WorldBox.system добавляют только реально отсутствующие системы.
# Координаты не выводим из имени планеты: без подписи на растре система остаётся без точки.
system_by_id = {item["id"]: item for item in systems}
for system_id, record in sorted(strict_systems.items()):
    if system_id in system_by_id:
        item = system_by_id[system_id]
        item["canonical"] = True
        item["canonicalWikiTitle"] = record["wikiTitle"]
        item["wiki"] = record["wiki"]
        item["name"] = system_names.get(system_id, record["name"])
        continue
    item = {
        "id": system_id,
        "name": system_names.get(system_id, record["name"]),
        "source": "starcraft-wiki-worldbox",
        "confidence": "canonical-exact",
        "note": "Система указана в структурированном поле WorldBox.system канонической страницы.",
        "refs": [record["wiki"]],
        "planetIds": [],
        "planetCount": 0,
        "factions": [],
        "primaryFaction": None,
        "map": False,
        "coordSource": "none",
        "coord": None,
        "conditionalCoord": None,
        "needsReview": False,
        "canonical": True,
        "canonicalWikiTitle": record["wikiTitle"],
        "wiki": record["wiki"],
    }
    systems.append(item)
    system_by_id[system_id] = item

unknown_system_names = sorted(item["id"] for item in systems if item["id"] not in system_names)
if unknown_system_names:
    raise SystemExit("Нет имени в именительном падеже: " + ", ".join(unknown_system_names))

system_ids = {item["id"] for item in systems}


# ---------------------------------------------------------------- system-overrides.json
overrides: dict[str, dict] = {}
skipped_overrides: list[str] = []
for system_id, entry in override_lookup.items():
    if system_id not in system_ids:
        skipped_overrides.append(system_id)
        continue
    x, y = entry.get("x"), entry.get("y")
    if x is None or y is None:
        continue
    record = {
        "x": int(x),
        "y": int(y),
        "x_norm": round6(int(x) / MAP_SIZE),
        "y_norm": round6(int(y) / MAP_SIZE),
        "label": entry.get("label"),
        "confidence": entry.get("confidence") or "medium",
    }
    if entry.get("note"):
        record["note"] = entry["note"]
    if entry.get("oldCoord"):
        record["oldCoord"] = list(entry["oldCoord"])
    if entry.get("delta") is not None:
        record["delta"] = entry["delta"]
    overrides[system_id] = record

conf_counter = Counter(rec["confidence"] for rec in overrides.values())

overrides_out = {
    "version": 1,
    "mapSize": MAP_SIZE,
    "sourceImage": overrides_raw.get("sourceImage") or atlas.get("meta", {}).get("sourceImage"),
    "generated": overrides_raw.get("generated") or GENERATED,
    "coordinateFormat": "x/y: целые 0..{}; x_norm/y_norm: 0..1 (альтернатива). Координата = центр иконки-кольца системы.".format(MAP_SIZE),
    "method": overrides_raw.get("method"),
    "warning": overrides_raw.get("warning"),
    "counts": {
        "total": len(overrides),
        "high": conf_counter.get("high", 0),
        "medium": conf_counter.get("medium", 0),
        "low": conf_counter.get("low", 0),
    },
    "systems": dict(sorted(overrides.items())),
}
if skipped_overrides:
    overrides_out["skippedUnknownIds"] = sorted(skipped_overrides)


# ----------------------------------------------------------------------------- legacy-planets.json
# Сначала воспроизводим исходные 316 строк для аудита и обратной совместимости.
legacy_planets: list[dict] = []
for raw in planets_raw:
    name_key = norm(raw.get("name"))
    ref = atlas_planets_by_name.get(name_key) or atlas_planets_by_stem.get(stem_key(raw.get("name"))) or {}
    item = {
        "id": raw["id"],
        "name": raw["name"],
        "sourceName": raw.get("sourceName") or raw["name"],
        "custom": bool(raw.get("custom")),
        "parent": raw.get("parent"),
        "relation": raw.get("relation"),
        "systemId": raw.get("systemId"),
        "factions": raw.get("factions") or [],
        "terrain": raw.get("terrain") or [],
        "population": raw.get("population"),
        "status": raw.get("status"),
        "sourceLine": raw.get("sourceLine"),
    }
    if item["parent"] is None:
        item.pop("parent")
    if item["relation"] is None:
        item.pop("relation")
    if item["status"] is None:
        item.pop("status")

    if ref:
        if ref.get("nameEn"):
            item["nameEn"] = ref["nameEn"]
        if ref.get("fandomUrl"):
            item["wiki"] = ref["fandomUrl"]
            item["wikiConfidence"] = ref.get("linkConfidence")
        if ref.get("onMap") or ref.get("x") is not None:
            item["onMap"] = True
            if ref.get("x") is not None:
                item["mapCoord"] = {"x": ref["x"], "y": ref["y"]}
            if ref.get("mapLabel"):
                item["mapLabel"] = ref["mapLabel"]
        if ref.get("terrain") and not item["terrain"] and ref["terrain"] != "неизвестно":
            item["terrain"] = [ref["terrain"]] if isinstance(ref["terrain"], str) else list(ref["terrain"])

    object_ref = atlas_object_planets.get(item["id"])
    if object_ref:
        item["onMap"] = True
        item["mapCoord"] = {"x": object_ref["x"], "y": object_ref["y"]}
        item["mapLabel"] = object_ref["name"]
        item["mapMatchNote"] = object_ref.get("note")

    # Категория и точное соответствие сильнее старого эвристического URL. Одна
    # Wiki-страница никогда не назначается нескольким локальным нумерованным мирам.
    if item["id"] in rejected_wiki_ids:
        item.pop("nameEn", None)
        item.pop("wiki", None)
        item.pop("wikiConfidence", None)
        item["wikiRejected"] = "duplicate-page-assignment"

    canonical_record = canonical_planets.get(item["id"])
    if canonical_record:
        item["canonical"] = True
        item["canonicalWikiTitle"] = canonical_record["wikiTitle"]
        item["canonicalWikiPages"] = canonical_record["wikiPages"]
        item["nameEn"] = canonical_record["wikiTitle"]
        item["wiki"] = canonical_record["wiki"]
        item["wikiConfidence"] = "category-exact"
        canonical_system = canonical_record.get("system")
        if canonical_system:
            item["systemId"] = canonical_system["id"]
            item["canonicalSystem"] = {
                "name": canonical_system["name"],
                "wikiTitle": canonical_system["title"],
                "wiki": canonical_system["wiki"],
            }
    legacy_planets.append(item)

# ----------------------------------------------------------------------------- planets.json
# Главный каталог теперь содержит только строгий канон из полного реестра мест.
# Для 191 точного пересечения сохраняются русские данные исходной строки; 106
# отсутствовавших объектов получают официальный английский заголовок Wiki.
legacy_by_id = {item["id"]: item for item in legacy_planets}
planets: list[dict] = []
used_place_ids: set[str] = set()
for wiki_title, record in sorted(strict_places.items()):
    current = record.get("current") or {}
    current_id = current.get("localId")
    if current_id and current_id in legacy_by_id:
        item = deepcopy(legacy_by_id[current_id])
        if current.get("suggestedName"):
            item["name"] = current["suggestedName"]
        item["legacyId"] = current_id
        item["addedFromWiki"] = False
    else:
        item = {
            "id": wiki_place_id(wiki_title),
            "name": wiki_title,
            "sourceName": wiki_title,
            "custom": False,
            "factions": [],
            "terrain": [],
            "population": "не указано",
            "sourceLine": "StarCraft Wiki: " + wiki_title,
            "addedFromWiki": True,
        }

    # ID должен быть стабилен и уникален даже при совпадающих slug.
    base_id = item["id"]
    suffix = 2
    while item["id"] in used_place_ids:
        item["id"] = f"{base_id}-{suffix}"
        suffix += 1
    used_place_ids.add(item["id"])

    item["custom"] = False
    item["canonical"] = True
    item["strictCanon"] = True
    item["canonicalWikiTitle"] = wiki_title
    item["canonicalWikiPages"] = [{"title": wiki_title, "url": record["url"]}]
    item["nameEn"] = wiki_title
    item["wiki"] = record["url"]
    item["wikiConfidence"] = "strict-canon"
    item["placeTypes"] = record["types"]
    item["placeType"] = record["types"][0]
    item["wikiCategories"] = record.get("categories") or []
    item.pop("wikiRejected", None)

    worldbox = record.get("worldbox") or {}
    if worldbox.get("primary"):
        item["canonicalPrimary"] = worldbox["primary"]
    if "moon" in record["types"]:
        item["relation"] = "moon"
    elif "asteroid" in record["types"]:
        item["relation"] = "asteroid"
    elif "station" in record["types"]:
        item["relation"] = "station"

    # Новым строкам система назначается только из явного WorldBox.system.
    # Для старых точных строк сохраняется исходная проверяемая группировка, но
    # структурированное поле Wiki всегда имеет приоритет.
    explicit_system = record.get("system")
    if explicit_system:
        item["systemId"] = explicit_system["id"]
        item["canonicalSystem"] = {
            "name": explicit_system["name"],
            "wikiTitle": explicit_system["wikiTitle"],
            "wiki": explicit_system["wiki"],
        }
    elif item.get("addedFromWiki"):
        item.pop("systemId", None)
        item.pop("canonicalSystem", None)

    planets.append(item)

planet_ids = {item["id"] for item in planets}
planet_by_name = {norm(item["name"]): item for item in planets}

# Пересобираем состав систем по строгому каталогу.
for system in systems:
    members = [item for item in planets if item.get("systemId") == system["id"]]
    system["planetIds"] = [item["id"] for item in members]
    system["planetCount"] = len(members)
    factions = []
    for planet in members:
        for faction in planet.get("factions") or []:
            if faction not in factions:
                factions.append(faction)
    if factions:
        system["factions"] = factions
        system["primaryFaction"] = factions[0]


# --------------------------------------------------------------------- map-labels.json
labels: dict[tuple, dict] = {}
object_planet_links = {
    (norm(entry.get("name")), int(entry["x"]), int(entry["y"])): entry["catalogPlanetId"]
    for entry in atlas_objects
    if entry.get("catalogPlanetId") and entry.get("x") is not None and entry.get("y") is not None
}


def add_label(name, x, y, kind, conf=None, note=None):
    if not name or x is None or y is None:
        return
    raw_name = name
    if kind == "system":
        name = map_system_names.get(raw_name)
        if not name:
            raise SystemExit(f"Нет именительного названия для подписи системы {raw_name!r}")
    key = (norm(name), int(x), int(y))
    if key in labels:
        return
    record = {"name": name, "x": int(x), "y": int(y), "kind": kind}
    if raw_name != name:
        record["rawMapLabel"] = raw_name
    if is_noisy(name):
        record["noisy"] = True
    if conf is not None:
        record["conf"] = conf
    if note:
        record["note"] = note
    labels[key] = record


for entry in atlas_coords.values():
    kind = entry.get("type") or "system"
    add_label(entry.get("name"), entry.get("x"), entry.get("y"), kind)

for entry in atlas_objects:
    add_label(
        entry.get("name"), entry.get("x"), entry.get("y"),
        entry.get("type") or "object", entry.get("conf"), entry.get("note")
    )

# привязка подписей к записям каталога, чтобы карточки могли ссылаться друг на друга
systems_by_key = {strip_system_prefix(item["name"]): item["id"] for item in systems}
systems_by_stem = {}
for item in systems:
    systems_by_stem.setdefault(stem_key(item["name"]), item["id"])
planets_by_stem = {}
planet_by_id = {}
for item in planets:
    planets_by_stem.setdefault(stem_key(item["name"]), item["id"])
    planet_by_id[item["id"]] = item

for label in labels.values():
    key = norm(label["name"])
    if label["kind"] == "system":
        linked = systems_by_key.get(strip_system_prefix(label["name"])) or systems_by_stem.get(stem_key(label["name"]))
        if linked:
            label["linkedSystemId"] = linked
    else:
        explicit_planet_id = object_planet_links.get((key, label["x"], label["y"]))
        linked = planet_by_id.get(explicit_planet_id) if explicit_planet_id else planet_by_name.get(key)
        if linked is None:
            planet_id = planets_by_stem.get(stem_key(label["name"]))
            if planet_id:
                linked = planet_by_id.get(planet_id)
        if linked:
            label["linkedPlanetId"] = linked["id"]

labels_out = sorted(labels.values(), key=lambda rec: (rec["y"], rec["x"]))
label_counts = Counter(rec["kind"] for rec in labels_out)


# ----------------------------------------------------------------------------- meta.json
facts = atlas.get("meta", {})
place_type_counts = Counter(kind for item in planets for kind in item.get("placeTypes", []))
meta = {
    "source": "StarCraft Wiki — строгий канонический реестр мест",
    "sourceRecords": len(planets),
    "legacySource": "Планеты Копрулу.pdf",
    "legacySourceRecords": 317,
    "legacyPlanetCount": len(legacy_planets),
    "planetCount": len(planets),
    "placeCount": len(planets),
    "placeTypeCounts": dict(sorted(place_type_counts.items())),
    "addedCanonicalPlaces": sum(1 for item in planets if item.get("addedFromWiki")),
    "matchedLegacyPlaces": sum(1 for item in planets if not item.get("addedFromWiki")),
    "strictExcludedPages": len(canonical_places.get("excluded") or {}),
    "systemCount": len(systems),
    "groupedPlanetCount": sum(1 for item in planets if item.get("systemId")),
    "unassignedPlanetCount": sum(1 for item in planets if not item.get("systemId")),
    "customCount": sum(1 for item in planets if item.get("custom")),
    "mapSize": MAP_SIZE,
    "tileSize": 512,
    "levels": [1250, 2500, 5000, 10000],
    "mapImage": "koprulu_map.jpg",  # фактическая подложка из data/sources.json
    # проверка подложки и координат: важно не потерять при пересборке
    "mapImageNote": (ROOT / "data" / "META_MAP_NOTE.txt").read_text(encoding="utf-8").strip()
    if (ROOT / "data" / "META_MAP_NOTE.txt").exists() else None,
    "mapLabeledObjects": len(labels_out),
    "mapLabeledSystems": label_counts.get("system", 0),
    "mapLabeledPlanets": label_counts.get("planet", 0),
    "mapLabeledOther": label_counts.get("object", 0),
    "coordinateNote": (
        "Координаты {} систем сняты с подписей карты ({} высокой, {} средней, {} низкой уверенности). "
        "Ещё {} видимых точек условны; {} систем из Wiki не показаны на карте без надёжной координаты. "
        "Расхождения с базовыми координатами показывают величину исправления условных точек."
    ).format(
        len(overrides),
        overrides_out["counts"]["high"],
        overrides_out["counts"]["medium"],
        overrides_out["counts"]["low"],
        sum(1 for item in systems if item.get("coord")) - len(overrides),
        sum(1 for item in systems if not item.get("coord")),
    ),
    "coordinateSource": facts.get("coordinateSource"),
    "overridesCount": len(overrides),
    "systemsWithMapCoord": len(overrides),
    "systemsWithConditionalCoord": sum(1 for item in systems if item.get("coord")) - len(overrides),
    "systemsWithoutAnyCoord": sum(1 for item in systems if not item.get("coord")),
    "systemsWithoutMapCoord": len(systems) - len(overrides),
    "wikiLinkedPlanets": sum(1 for item in planets if item.get("wiki")),
    "canonicalWikiMatchedPlanets": sum(1 for item in planets if item.get("canonical")),
    "canonicalWikiSystemPlanets": sum(1 for item in planets if item.get("canonicalSystem")),
    "canonicalWikiSystems": len(strict_systems),
    "wikiRejectedDuplicateLinks": len(canonical_places.get("duplicateRejections") or []),
    "planetsOnMap": sum(1 for item in planets if item.get("onMap")),
    "assets": {
        "tiles": "assets/tiles.json",
        "tilesDir": "assets/tiles",
        "preview": "assets/map-preview.webp",
        "sourceImage": "assets/map-source.jpg",
        # hasRaster = растр собран (tools/build_tiles.py). Пока false, страница
        # не запрашивает отсутствующие файлы и рисует схему со слоем подписей.
        "hasRaster": (ROOT / "assets" / "tiles.json").exists(),
    },
    "adminNote": (
        "Правки координат в режиме администратора хранятся в localStorage браузера и перекрывают "
        "и опубликованную таблицу, и system-overrides.json. Экспорт из панели даёт файл, совместимый "
        "с data/system-overrides.json."
    ),
    "generated": GENERATED,
}

meta["noisyMapLabels"] = sum(1 for rec in labels_out if rec.get("noisy"))
# подписи карты, которым не нашлось пары в каталоге (только читаемые, без OCR-шума)
meta["unmatchedMapLabels"] = sorted({
    rec["name"] for rec in labels_out
    if not (rec.get("linkedSystemId") or rec.get("linkedPlanetId")) and not rec.get("noisy")
})
meta["unmatchedMapLabelsTotal"] = len(meta["unmatchedMapLabels"])
meta["unmatchedMapLabels"] = meta["unmatchedMapLabels"][:60]


# --------------------------------------------------------------- systems-sheet-template.csv
template_rows = []
for item in systems:
    # В шаблон попадают только подтверждённые координаты: условные точки не
    # выдаём за снятые с карты, их место — пустая пара X/Y в таблице.
    override = overrides.get(item["id"])
    x, y = (override["x"], override["y"]) if override else (None, None)
    template_rows.append(
        {
            "id": item["id"],
            "Название системы": item["name"],
            "X": x,
            "Y": y,
            "Описание": item.get("note") or "",
            "Фракция": item.get("primaryFaction") or "",
        }
    )


# ----------------------------------------------------------------------------- запись
write_json(DATA / "systems.json", systems)
write_json(DATA / "system-overrides.json", overrides_out)
write_json(DATA / "planets.json", planets)
write_json(DATA / "legacy-planets.json", legacy_planets)
write_json(DATA / "map-labels.json", labels_out)
write_json(DATA / "meta.json", meta)

with (DATA / "systems-sheet-template.csv").open("w", encoding="utf-8-sig", newline="") as fh:
    writer = csv.DictWriter(fh, fieldnames=["id", "Название системы", "X", "Y", "Описание", "Фракция"])
    writer.writeheader()
    writer.writerows(template_rows)

print("systems.json           ", len(systems))
print("system-overrides.json  ", len(overrides), dict(conf_counter))
print("planets.json           ", len(planets), "| строгий канон · добавлено:", meta["addedCanonicalPlaces"], "| на карте:", meta["planetsOnMap"])
print("legacy-planets.json    ", len(legacy_planets), "| исходная сверка")
print("map-labels.json        ", len(labels_out), dict(label_counts), "| шумных OCR:", meta["noisyMapLabels"])
print("подписей без пары      ", meta["unmatchedMapLabelsTotal"], "—", ", ".join(meta["unmatchedMapLabels"][:10]))
if not meta["assets"]["hasRaster"]:
    print("растр не собран: атлас покажет схему со слоем подписей (tools/build_tiles.py)")
print("systems-sheet-template ", len(template_rows), "строк")
if skipped_overrides:
    print("!! неизвестные id в переопределениях:", skipped_overrides)
