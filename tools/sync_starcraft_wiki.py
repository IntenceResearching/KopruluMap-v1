#!/usr/bin/env python3
"""Сверяет наш список с английской StarCraft Wiki без догадок.

Источник истины о каноничности — членство страницы в Category:Planets.
Система берётся только из WorldBox.system и только если ссылка сама состоит в
Category:Star Systems. Одна wiki-страница назначается максимум одной строке
нашего списка: это исключает старые ошибки «Гантуан I–VI = Gantuan VI».

Результат: data/canonical-wiki-planets.json. Затем tools/derive_catalog.py
накладывает подтверждённые связи на planets.json/systems.json.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
import urllib.parse
from collections import defaultdict
from datetime import date
from pathlib import Path

try:
    import mwparserfromhell
    import requests
except ImportError:
    print("Нужны requests и mwparserfromhell: pip install -r tools/requirements.txt", file=sys.stderr)
    raise SystemExit(2)

ROOT = Path(__file__).resolve().parents[1]
API = "https://starcraft.fandom.com/api.php"
CATEGORY_PLANETS = "Category:Planets"
CATEGORY_SYSTEMS = "Category:Star Systems"
USER_AGENT = "KopruluAtlas/1.0 (canonical planet/system verification)"

# Строгие переводы/транслитерации страниц, которые автоматический индекс раньше
# пропустил. Здесь нет приблизительных пар: справа — существующий id нашего списка.
EXACT_ALIASES: dict[str, str] = {
    "Aeneas (planet)": "эней",
    "Artesia Prime": "артезия-прайм",
    "Atticus Minor": "младший-аттикус",
    "Planet Christmas": "планета-рождества",
    "Cruxas III": "круксас-iii",
    "Dark planet": "темная-планета",
    "Dead Man's Rock": "мертвецкий-валун-мертвецкий-порт-сион-d-3974",
    "Port Zion": "мертвецкий-валун-мертвецкий-порт-сион-d-3974",
    "Demon's Fair": "ярмарка-демонов-d-4358",
    "Eldersthine": "эльдерстайн",
    "Exgelia IV": "эксгелия-iv",
    "Formicia": "формиция",
    "Garrxax": "гаррахакс",
    "Goldilocks": "златовласка",
    "Halcyon": "халкион",
    "Haven": "гавань",
    "Heimdall IV": "хеймдаль-iv",
    "Helioc III": "гелиок-iii",
    "Helios": "гелиос",
    "Icarus IV": "икар-iv",
    "Jarban Minor": "малый-джарбан",
    "Jontur II": "йонтур-ii",
    "Jotun": "джотан",
    "Lerilak Crest": "герб-лерилака",
    "Marlowe": "марлоу",
    "Nephor II": "нефор-ii",
    "Niflheim": "нифельхельм",
    "Phaeton": "фаэтон",
    "Pike's Peak": "пайкс-пик",
    "Pridewater": "прайдуотер",
    "Shiloh": "шайло",
    "Taurus IV": "телец-iv",
    "Thanix III": "таникс-iii",
    "Tyrador IX": "тирадор-ix-аракир",
    "Van Osten's Moon": "луна-ван-остена",
    "Veridia Prime": "веридия-прайм",
    "Vygoire": "вигуар",
    "Wotan II": "вотан-ii",
    "Zeph III": "зеф-iii",
}

# Номинативные локальные имена. Новые системы создаются только для явных
# WorldBox.system; остальные планеты остаются без выдуманной принадлежности.
SYSTEM_LOCAL: dict[str, tuple[str, str]] = {
    "Antiga system": ("antiga-system", "Система Антига"),
    "Atrias system": ("atrias-system", "Система Атриас"),
    "Brontes system": ("brontes-system", "Система Бронтес"),
    "Bukari system": ("bukari-system", "Система Букари"),
    "Castanar system": ("castanar-system", "Система Кастанар"),
    "Char system": ("char-system", "Система Чар"),
    "Dylar system": ("dylar-system", "Система Дилар"),
    "Gyras system": ("gyras-system", "Система Гирис"),
    "Gystt system": ("gystt-system", "Система Гистт"),
    "Koprulu system": ("koprulu-system", "Система Копрулу"),
    "Korhal system": ("korhal-system", "Система Корхал"),
    "Mackan system": ("mackan-system", "Система Маккан"),
    "Meinhoff system": ("meinhoff-system", "Система Майнхофф"),
    "Redshift system": ("redshift-system", "Система Редшифт"),
    "Redstone system": ("redstone-system", "Система Редстоун"),
    "Sara system": ("sara-system", "Система Сара"),
    "Solar system": ("earth-system", "Система Сол"),
    "Tarsonis system": ("tarsonis-system", "Система Тарсонис"),
    "The Baker's Dozen": ("bakers-dozen-system", "Система Бейкерс-Дозен"),
    "Torus system": ("torus-system", "Система Торус"),
    "Typhon system": ("typhon-system", "Система Тифон"),
    "Tyrador system": ("tyrador-system", "Система Тирадор"),
    "Umoja system": ("umoja-system", "Система Умоджа"),
}

ROMAN = re.compile(r"\b(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)\b", re.I)


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def norm_title(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("_", " ").strip()).casefold()


def norm_local(value: str | None) -> str:
    if not value:
        return ""
    text = unicodedata.normalize("NFKC", str(value)).lower().replace("ё", "е")
    text = re.sub(r"[\u2010-\u2015]", "-", text)
    return re.sub(r"\s+", " ", text).strip()


ENDINGS = (
    "иями", "иях", "иям", "ием", "ией", "ию", "ия", "ии", "ью", "ей", "ов", "ев",
    "ах", "ях", "ам", "ям", "ом", "ем", "ой", "ый", "ий", "ая", "яя", "ое", "ее",
    "а", "я", "ы", "и", "е", "у", "ю", "о",
)


def stem_key(value: str | None) -> str:
    words = []
    for word in norm_local(value).split():
        for ending in ENDINGS:
            if len(word) > len(ending) + 3 and word.endswith(ending):
                word = word[:-len(ending)]
                break
        words.append(word)
    return " ".join(words)


def load_local_planets() -> list[dict]:
    """Восстанавливает старые wiki-кандидаты из неизменяемых source-файлов."""
    planets = read_json(ROOT / "docs" / "source" / "planets.updated.json")
    atlas = read_json(ROOT / "docs" / "source" / "koprulu-coordinates.json").get("planets", {})
    by_name: dict[str, dict] = {}
    by_stem: dict[str, dict] = {}
    for entry in atlas.values():
        key = norm_local(entry.get("name"))
        current = by_name.get(key)
        if current is None or (not current.get("fandomUrl") and entry.get("fandomUrl")):
            by_name[key] = entry
        by_stem.setdefault(stem_key(entry.get("name")), entry)
    result = []
    for source in planets:
        planet = dict(source)
        ref = by_name.get(norm_local(source.get("name"))) or by_stem.get(stem_key(source.get("name"))) or {}
        if ref.get("nameEn"):
            planet["nameEn"] = ref["nameEn"]
        if ref.get("fandomUrl"):
            planet["wiki"] = ref["fandomUrl"]
            planet["wikiConfidence"] = ref.get("linkConfidence")
        result.append(planet)
    return result


def wiki_title(url: str) -> str:
    return urllib.parse.unquote(url.split("/wiki/", 1)[1]).replace("_", " ")


def category_members(session: requests.Session, category: str) -> list[str]:
    result: list[str] = []
    cursor = None
    while True:
        params = {
            "action": "query", "list": "categorymembers", "cmtitle": category,
            "cmnamespace": 0, "cmlimit": "500", "format": "json", "formatversion": 2,
        }
        if cursor:
            params["cmcontinue"] = cursor
        response = session.get(API, params=params, timeout=45)
        response.raise_for_status()
        payload = response.json()
        result.extend(row["title"] for row in payload["query"]["categorymembers"])
        cursor = payload.get("continue", {}).get("cmcontinue")
        if not cursor:
            return result


def fetch_pages(session: requests.Session, titles: list[str]) -> tuple[dict[str, dict], dict[str, str]]:
    pages: dict[str, dict] = {}
    aliases: dict[str, str] = {}
    for start in range(0, len(titles), 40):
        params = {
            "action": "query", "prop": "revisions|categories", "rvprop": "content",
            "rvslots": "main", "titles": "|".join(titles[start:start + 40]),
            "redirects": 1, "cllimit": "500", "format": "json", "formatversion": 2,
        }
        response = session.get(API, params=params, timeout=60)
        response.raise_for_status()
        payload = response.json().get("query", {})
        for row in payload.get("normalized", []):
            aliases[norm_title(row["from"])] = row["to"]
        for row in payload.get("redirects", []):
            aliases[norm_title(row["from"])] = row["to"]
        for page in payload.get("pages", []):
            pages[norm_title(page["title"])] = page
    return pages, aliases


def resolve_title(title: str, aliases: dict[str, str]) -> str:
    current = title
    seen: set[str] = set()
    while norm_title(current) in aliases and norm_title(current) not in seen:
        seen.add(norm_title(current))
        current = aliases[norm_title(current)]
    return current


def worldbox_system(wikitext: str, system_titles: dict[str, str]) -> str | None:
    code = mwparserfromhell.parse(wikitext)
    for template in code.filter_templates(recursive=True):
        if str(template.name).strip().casefold() != "worldbox" or not template.has("system"):
            continue
        raw = str(template.get("system").value).strip()
        for link in mwparserfromhell.parse(raw).filter_wikilinks():
            title = str(link.title).strip()
            canonical = system_titles.get(norm_title(title))
            if canonical:
                return canonical
        return None
    return None


def candidate_score(planet: dict, requested_title: str, resolved_title: str, explicit_alias: bool) -> int:
    score = 1000 if explicit_alias else 0
    confidence = planet.get("wikiConfidence")
    score += {"exact": 80, "high": 40, "weak": 5}.get(confidence, 0)
    if norm_title(planet.get("nameEn") or "") == norm_title(resolved_title):
        score += 60
    title_roman = [value.upper() for value in ROMAN.findall(resolved_title)]
    name_roman = [value.upper() for value in ROMAN.findall(planet.get("name") or "")]
    if title_roman:
        score += 160 if title_roman == name_roman else -500
    if "prime" in resolved_title.casefold():
        score += 120 if "прайм" in planet.get("name", "").casefold() else -120
    if norm_title(requested_title) == norm_title(resolved_title):
        score += 10
    return score


def main() -> int:
    parser = argparse.ArgumentParser(description="Строгая сверка планет с английской StarCraft Wiki")
    parser.add_argument("--out", default=str(ROOT / "data" / "canonical-wiki-planets.json"))
    args = parser.parse_args()

    planets = load_local_planets()
    planets_by_id = {row["id"]: row for row in planets}
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    planet_category = category_members(session, CATEGORY_PLANETS)
    system_category = category_members(session, CATEGORY_SYSTEMS)
    planet_titles = {norm_title(title): title for title in planet_category}
    system_titles = {norm_title(title): title for title in system_category}

    requested: dict[str, list[tuple[dict, bool]]] = defaultdict(list)
    for planet in planets:
        if planet.get("wiki"):
            requested[wiki_title(planet["wiki"])].append((planet, False))
    for title, planet_id in EXACT_ALIASES.items():
        planet = planets_by_id.get(planet_id)
        if planet is None:
            raise SystemExit(f"EXACT_ALIASES: неизвестный planet id {planet_id!r}")
        requested[title].append((planet, True))

    pages, aliases = fetch_pages(session, sorted(requested))
    candidates_by_page: dict[str, list[dict]] = defaultdict(list)
    all_existing_by_page: dict[str, list[dict]] = defaultdict(list)
    page_data: dict[str, dict] = {}

    for requested_title, candidates in requested.items():
        resolved_title = resolve_title(requested_title, aliases)
        page = pages.get(norm_title(resolved_title)) or pages.get(norm_title(requested_title))
        if not page or page.get("missing"):
            continue
        for planet, explicit_alias in candidates:
            # Общая дедупликация нужна и для лун/астероидов из старого справочника
            # (например, две локальные строки, ссылавшиеся на Chanuk).
            if not explicit_alias:
                all_existing_by_page[norm_title(page["title"])].append({
                    "planet": planet,
                    "requestedTitle": requested_title,
                    "score": candidate_score(planet, requested_title, page["title"], False),
                    "pageTitle": page["title"],
                })
        canonical_title = planet_titles.get(norm_title(page["title"]))
        categories = {row["title"] for row in page.get("categories", [])}
        if not canonical_title and CATEGORY_PLANETS not in categories:
            continue
        canonical_title = canonical_title or page["title"]
        wikitext = page.get("revisions", [{}])[0].get("slots", {}).get("main", {}).get("content", "")
        system_title = worldbox_system(wikitext, system_titles)
        page_data[norm_title(canonical_title)] = {
            "title": canonical_title,
            "wiki": "https://starcraft.fandom.com/wiki/" + canonical_title.replace(" ", "_"),
            "systemTitle": system_title,
        }
        for planet, explicit_alias in candidates:
            candidates_by_page[norm_title(canonical_title)].append({
                "planet": planet,
                "requestedTitle": requested_title,
                "explicitAlias": explicit_alias,
                "score": candidate_score(planet, requested_title, canonical_title, explicit_alias),
            })

    accepted: dict[str, dict] = {}
    rejected: list[dict] = []
    for page_key, candidates in sorted(candidates_by_page.items()):
        # Одна wiki-страница — одна строка списка. Исключение: составная строка
        # Dead Man's Rock / Port Zion сознательно хранит несколько wikiPages.
        candidates.sort(key=lambda row: (-row["score"], row["planet"]["id"]))
        winner = candidates[0]
        planet_id = winner["planet"]["id"]
        page = page_data[page_key]
        record = accepted.setdefault(planet_id, {
            "name": winner["planet"]["name"],
            "wikiTitle": page["title"],
            "wiki": page["wiki"],
            "wikiPages": [],
            "category": CATEGORY_PLANETS,
        })
        record["wikiPages"].append({"title": page["title"], "url": page["wiki"]})
        if page.get("systemTitle"):
            system_title = page["systemTitle"]
            local = SYSTEM_LOCAL.get(system_title)
            if not local:
                raise SystemExit(f"Нет локального имени для канонической системы {system_title!r}")
            record["system"] = {
                "title": system_title,
                "id": local[0],
                "name": local[1],
                "wiki": "https://starcraft.fandom.com/wiki/" + system_title.replace(" ", "_"),
                "source": "WorldBox.system",
            }
        for loser in candidates[1:]:
            if loser["planet"]["id"] == planet_id:
                continue
            rejected.append({
                "planetId": loser["planet"]["id"],
                "planetName": loser["planet"]["name"],
                "wikiTitle": page["title"],
                "reason": f"страница назначена более точному совпадению {planet_id}",
            })

    # Старый индекс содержал дубли и за пределами Category:Planets. Не объявляем
    # такие страницы планетами, но всё равно гарантируем единственность URL.
    seen_rejections = {(row["planetId"], norm_title(row["wikiTitle"])) for row in rejected}
    for page_key, candidates in sorted(all_existing_by_page.items()):
        best_by_id: dict[str, dict] = {}
        for candidate in candidates:
            planet_id = candidate["planet"]["id"]
            if planet_id not in best_by_id or candidate["score"] > best_by_id[planet_id]["score"]:
                best_by_id[planet_id] = candidate
        if len(best_by_id) < 2:
            continue
        ranked = sorted(best_by_id.values(), key=lambda row: (-row["score"], row["planet"]["id"]))
        canonical_winner = next((
            planet_id for planet_id, record in accepted.items()
            if any(norm_title(page["title"]) == page_key for page in record["wikiPages"])
        ), None)
        winner_id = canonical_winner or ranked[0]["planet"]["id"]
        for loser in ranked:
            loser_id = loser["planet"]["id"]
            rejection_key = (loser_id, page_key)
            if loser_id == winner_id or rejection_key in seen_rejections:
                continue
            rejected.append({
                "planetId": loser_id,
                "planetName": loser["planet"]["name"],
                "wikiTitle": loser["pageTitle"],
                "reason": f"страница назначена более точному совпадению {winner_id}",
            })
            seen_rejections.add(rejection_key)

    systems: dict[str, dict] = {}
    for planet_id, record in accepted.items():
        system = record.get("system")
        if not system:
            continue
        row = systems.setdefault(system["id"], {
            "id": system["id"], "name": system["name"], "wikiTitle": system["title"],
            "wiki": system["wiki"], "planetIds": [], "source": "StarCraft Wiki / WorldBox.system",
        })
        row["planetIds"].append(planet_id)

    for record in accepted.values():
        record["wikiPages"].sort(key=lambda row: row["title"])
    for record in systems.values():
        record["planetIds"].sort()

    payload = {
        "version": 1,
        "generated": date.today().isoformat(),
        "source": API,
        "rules": {
            "planet": "только страницы Category:Planets, совпавшие со строкой нашего списка",
            "system": "только явная ссылка WorldBox.system на страницу Category:Star Systems",
            "deduplication": "одна wiki-страница назначается одной строке списка",
        },
        "counts": {
            "wikiPlanetCategory": len(planet_category),
            "wikiSystemCategory": len(system_category),
            "matchedPlanets": len(accepted),
            "withCanonicalSystem": sum(1 for row in accepted.values() if row.get("system")),
            "canonicalSystemsUsed": len(systems),
            "rejectedDuplicateLinks": len(rejected),
        },
        "planets": dict(sorted(accepted.items())),
        "systems": dict(sorted(systems.items())),
        "rejectedDuplicateLinks": sorted(rejected, key=lambda row: (row["wikiTitle"], row["planetId"])),
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"StarCraft Wiki: {len(planet_category)} планет в категории")
    print(f"Совпало со списком: {len(accepted)} · с явной системой: {payload['counts']['withCanonicalSystem']}")
    print(f"Канонических систем использовано: {len(systems)} · отклонено дублей: {len(rejected)}")
    print(f"Записано: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
