#!/usr/bin/env python3
"""Полная строгая сверка индивидуальных миров и станций StarCraft Wiki.

В отличие от sync_starcraft_wiki.py этот аудит не ограничивается Category:Planets:
он перечисляет планеты, луны, астероиды, индивидуальные космические платформы
и страницы станций/верфей из Category:Installations. Затем отбрасывает явно
неканонические, вырезанные, концептуальные и родовые страницы и сопоставляет
остаток с существующими 316 строками без приблизительных догадок.

Результаты:
  data/canonical-wiki-places.json
  data/canonical-wiki-places.csv
  reports/starcraft-wiki-canonical-places.md
"""

from __future__ import annotations

import csv
import json
import re
import sys
import urllib.parse
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

try:
    import mwparserfromhell
    import requests
except ImportError:
    print("Нужны requests и mwparserfromhell: pip install -r tools/requirements.txt", file=sys.stderr)
    raise SystemExit(2)

from sync_starcraft_wiki import (  # сохраняем те же точные локальные алиасы
    API,
    CATEGORY_SYSTEMS,
    EXACT_ALIASES,
    SYSTEM_LOCAL,
    USER_AGENT,
    candidate_score,
    category_members,
    load_local_planets,
    norm_title,
    resolve_title,
    wiki_title,
)

ROOT = Path(__file__).resolve().parents[1]
PLACE_CATEGORIES = {
    "Planets": "planet",
    "Moons": "moon",
    "Asteroids": "asteroid",
    "Space platforms": "station",
}

# Строгий канон: эти страницы остаются в приложении Wiki, но их единственный
# источник явно неканоничен/вырезан/неоднозначен. Родовые статьи — не места.
STRICT_EXCLUSIONS: dict[str, tuple[str, str]] = {
    "Alamar": ("noncanon", "только отменённая StarCraft: Ghost"),
    "Albion": ("ambiguous", "предыдущая версия StarCraft II; AmbigCanon3"),
    "Alision": ("concept", "только концепт StarCraft: Frontiers"),
    "Altheon": ("cut", "вырезанная версия StarCraft II; Dev"),
    "Aridas": ("ambiguous", "только Retribution; Blizzard склонялся не считать дополнение каноном"),
    "Braxis Holdout": ("noncanon", "Heroes of the Storm не каноничен для StarCraft"),
    "Brontes IV": ("ambiguous", "только Insurrection; каноничность не подтверждена"),
    "Brontes IV Orbital Relay Center": ("ambiguous", "только Insurrection"),
    "Brontes IV Satellite Platform": ("ambiguous", "только Insurrection"),
    "Dannuth VII": ("ambiguous", "удалённый вариант миссии; AmbigCanon2"),
    "Dylar Station": ("noncanon", "только Alternity RPG; RPG не входит в канон"),
    "Erebus Station": ("ambiguous", "только лицензированная настольная игра Fantasy Flight; канон не подтверждён"),
    "Hydrax": ("ambiguous", "только лицензированная настольная игра Fantasy Flight; канон не подтверждён"),
    "Immortal Forge": ("cut", "только бета Heart of the Swarm; Dev"),
    "Incendia 4": ("concept", "только концепт StarCraft: Frontiers"),
    "Lerilak Crest": ("cut", "только бета Legacy of the Void"),
    "Lorcadia": ("noncanon", "только отменённая StarCraft: Ghost и концепт-арт"),
    "Moebius Station": ("cut", "вырезана из Heart of the Swarm; Dev"),
    "Moebius battle station": ("noncanon", "только Co-op Missions"),
    "Niflheim": ("concept", "только концепт-арт, предшественник Kaldir"),
    "Orbital Shipyard": ("cut", "только бета Legacy of the Void"),
    "Planet Christmas": ("noncanon", "рождественская карта; XMas"),
    "Port Zion": ("cut", "вырезанная версия StarCraft II; Dev"),
    "PUT239610": ("concept", "только концепт StarCraft: Frontiers"),
    "Rajal": ("ambiguous", "только лицензированная настольная RISK: StarCraft; канон не подтверждён"),
    "Sammy": ("cut", "планировалась для StarCraft II, но не появилась; Dev"),
    "Science Station 12": ("ambiguous", "только Retribution"),
    "Swampus": ("noncanon", "только отменённая StarCraft: Ghost и концепт-арт"),
    "Veridia Prime": ("noncanon", "только Co-op Missions"),
    # Не индивидуальные места.
    "Orbital Relay": ("generic", "родовой тип орбитальной платформы"),
    "Sentinel watchtower": ("generic", "собирательная статья о четырёх башнях"),
    "Space platform": ("generic", "родовая статья о классе сооружений"),
}

# Два заголовка несут предупреждающий шаблон в начале, но имеют независимый
# канонический источник: Helios — Wings of Liberty, Ketill IV — Heart of the Swarm.
CANON_OVERRIDES = {
    "Helios": "подтверждена в Wings of Liberty",
    "Ketill IV": "подтверждена в Heart of the Swarm",
}

DISPLAY_CORRECTIONS = {
    "аверн": "Авернус",
}

STATION_WORD = re.compile(r"(?:station|shipyards?)", re.I)
NONCANON_TEMPLATES = {
    "CoopCanon", "Ghost", "DotA", "XMas", "Insurrection", "Retribution",
    "Dev", "ConceptCanon", "AmbigCanon", "AmbigCanon2", "AmbigCanon3",
}


def fetch_pages(session: requests.Session, titles: list[str]) -> tuple[dict[str, dict], dict[str, str]]:
    pages: dict[str, dict] = {}
    aliases: dict[str, str] = {}
    for start in range(0, len(titles), 40):
        params = {
            "action": "query", "prop": "revisions|categories|templates",
            "rvprop": "content", "rvslots": "main", "titles": "|".join(titles[start:start + 40]),
            "redirects": 1, "cllimit": "500", "tllimit": "500",
            "format": "json", "formatversion": 2,
        }
        response = session.get(API, params=params, timeout=60)
        response.raise_for_status()
        query = response.json().get("query", {})
        for row in query.get("normalized", []):
            aliases[norm_title(row["from"])] = row["to"]
        for row in query.get("redirects", []):
            aliases[norm_title(row["from"])] = row["to"]
        for page in query.get("pages", []):
            pages[norm_title(page["title"])] = page
    return pages, aliases


def page_text(page: dict) -> str:
    return page.get("revisions", [{}])[0].get("slots", {}).get("main", {}).get("content", "")


def template_names(page: dict) -> list[str]:
    return sorted(row["title"].removeprefix("Template:") for row in page.get("templates", []))


def category_names(page: dict) -> list[str]:
    return sorted(row["title"].removeprefix("Category:") for row in page.get("categories", []))


def worldbox_fields(text: str) -> dict[str, str]:
    code = mwparserfromhell.parse(text)
    for template in code.filter_templates(recursive=True):
        if str(template.name).strip().casefold() != "worldbox":
            continue
        result: dict[str, str] = {}
        for field in ("system", "primary", "moons", "platforms", "sector", "region", "status"):
            if not template.has(field):
                continue
            value = str(template.get(field).value).strip()
            if value:
                result[field] = value
        return result
    return {}


def first_link(value: str | None) -> str | None:
    if not value:
        return None
    links = mwparserfromhell.parse(value).filter_wikilinks()
    return str(links[0].title).strip() if links else None


def station_installation_titles(session: requests.Session) -> list[str]:
    """Станции/верфи, которые Wiki не включила в Space platforms."""
    installations = category_members(session, "Category:Installations")
    platforms = set(category_members(session, "Category:Space platforms"))
    return sorted(title for title in installations if title not in platforms and STATION_WORD.search(title))


def markdown_table(headers: list[str], rows: list[list[str]]) -> str:
    def clean(value: str) -> str:
        return str(value).replace("|", "\\|").replace("\n", " ")
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    lines.extend("| " + " | ".join(clean(cell) for cell in row) + " |" for row in rows)
    return "\n".join(lines)


def main() -> int:
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT.replace("canonical planet/system", "canonical places")

    by_category: dict[str, list[str]] = {}
    all_titles: set[str] = set()
    for category, kind in PLACE_CATEGORIES.items():
        titles = category_members(session, "Category:" + category)
        by_category[category] = titles
        all_titles.update(titles)
    station_extras = station_installation_titles(session)
    by_category["Installation stations"] = station_extras
    all_titles.update(station_extras)

    local = load_local_planets()
    local_by_id = {row["id"]: row for row in local}
    requested_local: dict[str, list[tuple[dict, bool]]] = defaultdict(list)
    for row in local:
        if row.get("wiki"):
            requested_local[wiki_title(row["wiki"])].append((row, False))
    for title, planet_id in EXACT_ALIASES.items():
        if planet_id in local_by_id:
            requested_local[title].append((local_by_id[planet_id], True))

    query_titles = sorted(all_titles | set(requested_local))
    pages, aliases = fetch_pages(session, query_titles)
    system_titles = {norm_title(title): title for title in category_members(session, CATEGORY_SYSTEMS)}

    title_kinds: dict[str, set[str]] = defaultdict(set)
    for category, titles in by_category.items():
        kind = "station" if category == "Installation stations" else PLACE_CATEGORIES[category]
        for title in titles:
            title_kinds[norm_title(title)].add(kind)

    canonical: dict[str, dict] = {}
    excluded: dict[str, dict] = {}
    leading_unclassified: list[dict] = []
    for title in sorted(all_titles):
        page = pages.get(norm_title(title))
        if not page or page.get("missing"):
            continue
        canonical_title = page["title"]
        text = page_text(page)
        templates = template_names(page)
        categories = category_names(page)
        kinds = sorted(title_kinds[norm_title(title)])
        fields = worldbox_fields(text)
        warning_templates = sorted(NONCANON_TEMPLATES.intersection(templates))
        exclusion = STRICT_EXCLUSIONS.get(canonical_title)
        base = {
            "title": canonical_title,
            "url": "https://starcraft.fandom.com/wiki/" + urllib.parse.quote(canonical_title.replace(" ", "_"), safe="_()'"),
            "types": kinds,
            "categories": categories,
            "warningTemplates": warning_templates,
        }
        if fields:
            base["worldbox"] = fields
            system_title = first_link(fields.get("system"))
            if system_title and norm_title(system_title) in system_titles:
                canonical_system_title = system_titles[norm_title(system_title)]
                base["systemTitle"] = canonical_system_title
                local_system = SYSTEM_LOCAL.get(canonical_system_title)
                if not local_system:
                    raise SystemExit(f"Нет локального id/имени для системы {canonical_system_title!r}")
                base["system"] = {
                    "id": local_system[0],
                    "name": local_system[1],
                    "wikiTitle": canonical_system_title,
                    "wiki": "https://starcraft.fandom.com/wiki/" + canonical_system_title.replace(" ", "_"),
                    "source": "WorldBox.system",
                }
        if exclusion:
            base["status"] = exclusion[0]
            base["reason"] = exclusion[1]
            excluded[canonical_title] = base
            continue
        base["status"] = "canon"
        if canonical_title in CANON_OVERRIDES:
            base["canonNote"] = CANON_OVERRIDES[canonical_title]
        canonical[canonical_title] = base

        # Страховка от новых целиком помеченных страниц: отчёт сообщает их,
        # чтобы обновление Wiki не прошло незаметно.
        intro = text.find("'''")
        leading = [name for name in warning_templates if 0 <= text.casefold().find("{{" + name.casefold()) < intro]
        if leading and canonical_title not in CANON_OVERRIDES:
            leading_unclassified.append({"title": canonical_title, "templates": leading})

    # Сопоставление с 316 строками: только URL/redirect или curated exact alias.
    candidates_by_page: dict[str, list[dict]] = defaultdict(list)
    for requested_title, candidates in requested_local.items():
        resolved = resolve_title(requested_title, aliases)
        page = pages.get(norm_title(resolved)) or pages.get(norm_title(requested_title))
        if not page or page.get("missing") or page["title"] not in canonical:
            continue
        for row, explicit_alias in candidates:
            candidates_by_page[page["title"]].append({
                "row": row,
                "score": candidate_score(row, requested_title, page["title"], explicit_alias),
                "explicit": explicit_alias,
            })

    matches: dict[str, dict] = {}
    duplicate_rejections: list[dict] = []
    for title, candidates in sorted(candidates_by_page.items()):
        best_by_id: dict[str, dict] = {}
        for candidate in candidates:
            row_id = candidate["row"]["id"]
            if row_id not in best_by_id or candidate["score"] > best_by_id[row_id]["score"]:
                best_by_id[row_id] = candidate
        ranked = sorted(best_by_id.values(), key=lambda row: (-row["score"], row["row"]["id"]))
        winner = ranked[0]["row"]
        matches[title] = {
            "localId": winner["id"],
            "localName": winner["name"],
            "suggestedName": DISPLAY_CORRECTIONS.get(winner["id"]),
        }
        for loser in ranked[1:]:
            duplicate_rejections.append({
                "title": title,
                "localId": loser["row"]["id"],
                "localName": loser["row"]["name"],
                "winnerId": winner["id"],
            })

    for title, match in matches.items():
        canonical[title]["current"] = match

    # Строки текущего списка, которые ссылаются только на строгие исключения.
    excluded_current: list[dict] = []
    for requested_title, candidates in requested_local.items():
        resolved = resolve_title(requested_title, aliases)
        page = pages.get(norm_title(resolved)) or pages.get(norm_title(requested_title))
        if not page or page.get("missing") or page["title"] not in excluded:
            continue
        for row, explicit in candidates:
            excluded_current.append({
                "localId": row["id"], "localName": row["name"],
                "wikiTitle": page["title"], "reason": excluded[page["title"]]["reason"],
            })
    # Убираем повторы от URL + alias.
    excluded_current = list({(r["localId"], r["wikiTitle"]): r for r in excluded_current}.values())
    excluded_current.sort(key=lambda row: (row["wikiTitle"], row["localId"]))

    type_counts = Counter()
    matched_type_counts = Counter()
    for title, row in canonical.items():
        for kind in row["types"]:
            type_counts[kind] += 1
            if title in matches:
                matched_type_counts[kind] += 1
    missing_type_counts = Counter({kind: type_counts[kind] - matched_type_counts[kind] for kind in type_counts})
    matched_titles = set(matches)
    missing_titles = sorted(set(canonical) - matched_titles)
    matched_local_ids = {row["localId"] for row in matches.values()}

    payload = {
        "version": 1,
        "generated": date.today().isoformat(),
        "source": API,
        "scope": {
            "categories": list(PLACE_CATEGORIES),
            "installationStationRule": "Category:Installations title contains Station or Shipyard, excluding Space-platform duplicates",
            "individualOnly": True,
            "strictCanon": True,
        },
        "counts": {
            "rawCategoryMemberships": {name: len(titles) for name, titles in by_category.items()},
            "rawUniqueCandidates": len(all_titles),
            "canonicalPlaces": len(canonical),
            "excludedPages": len(excluded),
            "canonicalByType": dict(sorted(type_counts.items())),
            "matchedByType": {kind: matched_type_counts[kind] for kind in sorted(type_counts)},
            "missingByType": {kind: missing_type_counts[kind] for kind in sorted(type_counts)},
            "matchedCanonicalPages": len(matched_titles),
            "matchedCurrentRows": len(matched_local_ids),
            "missingCanonicalPages": len(missing_titles),
            "currentRowsWithExcludedOnlyPage": len({row["localId"] for row in excluded_current}),
        },
        "places": dict(sorted(canonical.items())),
        "missingFromCurrent": missing_titles,
        "excluded": dict(sorted(excluded.items())),
        "currentRowsPointingToExcluded": excluded_current,
        "duplicateRejections": duplicate_rejections,
        "leadingWarningPagesKept": leading_unclassified,
    }

    data_json = ROOT / "data" / "canonical-wiki-places.json"
    data_csv = ROOT / "data" / "canonical-wiki-places.csv"
    report = ROOT / "reports" / "starcraft-wiki-canonical-places.md"
    data_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    with data_csv.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=[
            "wiki_title", "types", "current_status", "local_id", "local_name",
            "suggested_name", "system_title", "wiki_url",
        ])
        writer.writeheader()
        for title, row in sorted(canonical.items(), key=lambda pair: (",".join(pair[1]["types"]), pair[0])):
            current = row.get("current") or {}
            writer.writerow({
                "wiki_title": title,
                "types": ", ".join(row["types"]),
                "current_status": "в текущем списке" if current else "нет в текущем списке",
                "local_id": current.get("localId", ""),
                "local_name": current.get("localName", ""),
                "suggested_name": current.get("suggestedName", "") or "",
                "system_title": row.get("systemTitle", ""),
                "wiki_url": row["url"],
            })

    report.parent.mkdir(parents=True, exist_ok=True)
    kind_ru = {"planet": "Планеты", "moon": "Луны", "asteroid": "Астероиды", "station": "Станции и платформы"}
    lines = [
        "# Полный строгий список канонических миров и станций StarCraft Wiki",
        "",
        f"Снимок MediaWiki API: **{payload['generated']}**. Это аудит канона, а не автоматическое добавление отсутствующих строк в атлас.",
        "",
        "## Правила",
        "",
        "- Берутся прямые страницы `Category:Planets`, `Category:Moons`, `Category:Asteroids`, `Category:Space platforms`.",
        "- Дополнительно берутся страницы со словами `Station`/`Shipyard` из `Category:Installations`, если они ещё не являются space platform.",
        "- Родовые статьи, Co-op-only, Heroes of the Storm, Christmas, отменённая Ghost, cut/dev/concept и неоднозначные Insurrection/Retribution исключаются.",
        "- Совпадение с 316 строками — только существующий URL/redirect или проверенный exact alias. Похожее имя не считается совпадением.",
        "",
        "## Итог",
        "",
        f"- Сырых уникальных кандидатов: **{len(all_titles)}**.",
        f"- Строго канонических индивидуальных мест: **{len(canonical)}**.",
        f"- Исключено: **{len(excluded)}**.",
        f"- Уже представлены в текущем списке: **{len(matched_titles)} страниц / {len(matched_local_ids)} строк**.",
        f"- Канонических страниц вне текущего списка: **{len(missing_titles)}**.",
        f"- Текущих строк, ссылающихся только на исключённую страницу: **{len({row['localId'] for row in excluded_current})}**.",
        "",
        markdown_table(
            ["Тип", "Канон", "Есть в 316", "Отсутствует"],
            [[kind_ru[kind], str(type_counts[kind]), str(matched_type_counts[kind]), str(missing_type_counts[kind])]
             for kind in ("planet", "moon", "asteroid", "station")],
        ),
        "",
        "Пересечения типов считаются в каждом типе отдельно (например, `Sigma Centari` — asteroid + station).",
        "",
    ]

    for kind in ("planet", "moon", "asteroid", "station"):
        rows = []
        for title, row in canonical.items():
            if kind not in row["types"]:
                continue
            current = row.get("current") or {}
            local = current.get("localName", "—")
            if current.get("suggestedName"):
                local += " → **" + current["suggestedName"] + "**"
            status = "есть" if current else "нет"
            system = row.get("systemTitle", "—")
            rows.append([f"[{title}]({row['url']})", local, status, system])
        rows.sort(key=lambda row: row[0].casefold())
        lines.extend([
            f"## {kind_ru[kind]} ({type_counts[kind]})",
            "",
            markdown_table(["StarCraft Wiki", "Текущая строка", "В списке", "Явная система"], rows),
            "",
        ])

    exclusion_rows = [[
        f"[{title}]({row['url']})", ", ".join(row["types"]), row["status"], row["reason"]
    ] for title, row in sorted(excluded.items())]
    lines.extend([
        "## Исключённые страницы",
        "",
        markdown_table(["Страница", "Тип", "Статус", "Причина"], exclusion_rows),
        "",
        "## Текущие строки, которые требуют решения",
        "",
    ])
    decision_rows = [[row["localId"], row["localName"], row["wikiTitle"], row["reason"]] for row in excluded_current]
    lines.append(markdown_table(["ID", "Текущее имя", "Wiki", "Почему не принят строгий канон"], decision_rows) if decision_rows else "Нет.")
    lines.extend([
        "",
        "## Файлы",
        "",
        "- Полная машинная версия: `data/canonical-wiki-places.json`.",
        "- Таблица для фильтрации: `data/canonical-wiki-places.csv`.",
        "",
    ])
    report.write_text("\n".join(lines), encoding="utf-8")

    print(f"Кандидатов: {len(all_titles)} · строгий канон: {len(canonical)} · исключено: {len(excluded)}")
    print(f"В текущем списке: {len(matched_titles)} страниц / {len(matched_local_ids)} строк · отсутствует: {len(missing_titles)}")
    print("Типы:", dict(sorted(type_counts.items())))
    print("Записано:", data_json)
    print("          ", data_csv)
    print("          ", report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
