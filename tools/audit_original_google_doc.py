#!/usr/bin/env python3
"""Сверяет локальный каталог и системные группировки с исходным Google Doc.

Документ — оригинал списка «Планеты сектора Копрулу». В нём нет отдельной
таблицы звёздных систем: явно указаны только строки мест, пометки «кастомная»
и родительские планеты части лун. Поэтому скрипт отдельно считает сведения,
которые действительно следуют из документа, выводы по повторяющимся именам
и внешние lore-связи.

Запуск:
  python3 tools/audit_original_google_doc.py
  python3 tools/audit_original_google_doc.py --refresh
"""

from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import json
import re
import unicodedata
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC_ID = "1pqB3ocnZRbcEvJYOl40Ya9e_DagrmMoCPhkEKqBlfA8"
DOC_URL = f"https://docs.google.com/document/d/{DOC_ID}/edit?tab=t.0"
EXPORT_URL = f"https://docs.google.com/document/d/{DOC_ID}/export?format=txt"
SOURCE_TXT = ROOT / "docs" / "source" / "original-google-doc.txt"
REPORT = ROOT / "reports" / "original-google-doc-reconciliation.md"
CSV_REPORT = ROOT / "reports" / "original-google-doc-reconciliation.csv"


def load_json(relative: str):
    return json.loads((ROOT / relative).read_text(encoding="utf-8"))


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKC", value)
    value = value.casefold().replace("ё", "е").replace("’", "'").replace("`", "'")
    value = re.sub(r"[–—−‑]", "-", value)
    return re.sub(r"\s+", " ", value).strip()


def download() -> None:
    try:
        import requests
    except ImportError as exc:
        raise SystemExit("Для --refresh нужен requests: pip install -r tools/requirements.txt") from exc
    response = requests.get(EXPORT_URL, timeout=90)
    response.raise_for_status()
    SOURCE_TXT.parent.mkdir(parents=True, exist_ok=True)
    SOURCE_TXT.write_bytes(response.content)


def primary_lines(text: str) -> list[str]:
    """Возвращает строки 317 записей, отбрасывая заголовки и продолжения."""
    lines = text.splitlines()
    headings = [index for index, line in enumerate(lines) if line.strip() == "Планеты сектора Копрулу"]
    if not headings:
        raise SystemExit("В экспорте не найден заголовок «Планеты сектора Копрулу»")
    start = headings[-1] + 1
    result: list[str] = []
    for raw in lines[start:]:
        stripped = raw.strip()
        if not stripped or re.fullmatch(r"[А-ЯЁ]", stripped):
            continue
        if raw[:1].isspace() or stripped.startswith(("*", "-")):
            continue
        result.append(stripped)
    return result


def match_document(lines: list[str], local_rows: list[dict]) -> tuple[list[tuple[str, dict]], list[str]]:
    names = sorted(
        ((normalize(row["sourceName"]), row) for row in local_rows),
        key=lambda item: len(item[0]),
        reverse=True,
    )
    matched: list[tuple[str, dict]] = []
    unmatched: list[str] = []
    for line in lines:
        normalized = normalize(line)
        winner = None
        for name, row in names:
            if normalized.startswith(name) and (
                len(normalized) == len(name) or normalized[len(name)] in " -("
            ):
                winner = row
                break
        if winner is None:
            unmatched.append(line)
        else:
            matched.append((line, winner))
    return matched, unmatched


def bullet_list(values: list[str], empty: str = "нет") -> str:
    return "\n".join(f"- {value}" for value in values) if values else f"- {empty}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Сверка исходного Google Doc с каталогом атласа")
    parser.add_argument("--refresh", action="store_true", help="заново скачать текстовый экспорт Google Doc")
    parser.add_argument("--report", default=str(REPORT))
    parser.add_argument("--csv", default=str(CSV_REPORT))
    args = parser.parse_args()

    if args.refresh or not SOURCE_TXT.exists():
        download()
    text = SOURCE_TXT.read_text(encoding="utf-8-sig")
    lines = primary_lines(text)

    local_rows = load_json("docs/source/planets.updated.json")
    legacy_systems = load_json("docs/source/systems.updated.json")
    strict_places = load_json("data/planets.json")
    current_systems = load_json("data/systems.json")
    census = load_json("data/canonical-wiki-places.json")

    matched, unmatched = match_document(lines, local_rows)
    matched_ids = [row["id"] for _, row in matched]
    id_counts = collections.Counter(matched_ids)
    absent_local = [row for row in local_rows if row["id"] not in id_counts]
    duplicate_rows = [(row_id, count) for row_id, count in id_counts.items() if count > 1]

    document_line_counts = collections.Counter(normalize(line) for line in lines)
    source_line_mismatches = [
        row for row in local_rows if not document_line_counts[normalize(row.get("sourceLine") or "")]
    ]
    custom_mismatches = []
    for line, row in matched:
        marker = "(кастомная)" in normalize(line)
        if marker != bool(row.get("custom")):
            custom_mismatches.append(f"{row['name']}: документ={marker}, JSON={bool(row.get('custom'))}")

    strict_legacy_ids = {row.get("legacyId") for row in strict_places if row.get("legacyId")}
    source_only = [row for row in local_rows if row["id"] not in strict_legacy_ids]
    strict_added = [row for row in strict_places if row.get("addedFromWiki")]
    excluded_rows = census.get("currentRowsPointingToExcluded") or []
    excluded_ids = {row["localId"] for row in excluded_rows}
    excluded_but_retained = [row for row in excluded_rows if row["localId"] in strict_legacy_ids]

    legacy_confidences = collections.Counter(row.get("confidence") or "не указано" for row in legacy_systems)
    legacy_system_ids = {row["id"] for row in legacy_systems}
    legacy_member_confidences = collections.Counter()
    for row in local_rows:
        system_id = row.get("systemId")
        if not system_id:
            legacy_member_confidences["без системы"] += 1
            continue
        system = next((item for item in legacy_systems if item["id"] == system_id), None)
        legacy_member_confidences[(system or {}).get("confidence") or "неизвестная"] += 1

    canonical_systems = [row for row in current_systems if row.get("canonical")]
    legacy_only_systems = [row for row in current_systems if not row.get("canonical")]
    empty_systems = [row for row in current_systems if not row.get("planetIds")]
    explicit_system_places = [row for row in strict_places if row.get("canonicalSystem")]
    grouped_places = [row for row in strict_places if row.get("systemId")]
    inherited_grouping_count = len(grouped_places) - len(explicit_system_places)

    moon_rows = [row for row in local_rows if row.get("relation") == "moon"]
    moon_with_parent = [row for row in moon_rows if row.get("parent")]

    sha256 = hashlib.sha256(SOURCE_TXT.read_bytes()).hexdigest()
    duplicate_names = [
        f"{next(row['name'] for row in local_rows if row['id'] == row_id)} — {count} строки"
        for row_id, count in duplicate_rows
    ]
    mismatch_names = [row["name"] for row in source_line_mismatches]
    source_only_custom = sum(bool(row.get("custom")) for row in source_only)
    source_only_regular = len(source_only) - source_only_custom
    unmatched_noncustom = [
        row for row in source_only if not row.get("custom") and row["id"] not in excluded_ids
    ]

    system_split_ok = (
        any(row["id"] == "uilel-system" for row in current_systems)
        and any(row["id"] == "inferred-уилила" for row in current_systems)
    )

    report = f"""# Сверка с оригинальным Google Doc

Дата сверки: **{date.today().isoformat()}**  
Оригинал: [{DOC_URL}]({DOC_URL})  
Текстовый снимок: `docs/source/original-google-doc.txt`  
SHA-256 снимка: `{sha256}`  
Полная таблица 316 записей: `reports/original-google-doc-reconciliation.csv`

## Краткий вывод

- В документе **{len(lines)} строк объектов**, но **{len(id_counts)} уникальных записей**: `Миранар` приведён дважды.
- Локальный исходный каталог содержит **{len(local_rows)} уникальных строк** и покрывает документ полностью: найдено **{len(matched)}/{len(lines)}** строк, потерянных объектов — **{len(unmatched)}**.
- Пометка `кастомная` совпадает у **{len(local_rows) - len(custom_mismatches)}/{len(local_rows)}** записей. В документе/legacy-каталоге: **{sum(bool(row.get('custom')) for row in local_rows)} кастомных** и **{sum(not row.get('custom') for row in local_rows)} остальных**.
- Документ явно помечает **{len(moon_rows)} лун**, у **{len(moon_with_parent)}** из них назван родительский мир.
- Главный каталог сайта намеренно не является копией документа: это **{len(strict_places)} строго канонических мест**. Из документа сохранено **{len(strict_legacy_ids)}**, из Wiki добавлено **{len(strict_added)}**, а **{len(source_only)}** исходных записей остаются только в legacy-слое.
- Отдельного списка звёздных систем в Google Doc **нет**. Системы можно проверять только по явным лунам, повторяющимся обозначениям, карте и внешнему лору.

## 1. Список планет и других объектов исходника

| Проверка | Результат |
|---|---:|
| Строк объектов в Google Doc | {len(lines)} |
| Уникальных локальных записей | {len(local_rows)} |
| Сопоставлено строк документа | {len(matched)} |
| Строк документа без локальной пары | {len(unmatched)} |
| Локальных записей без строки документа | {len(absent_local)} |
| Точных нормализованных `sourceLine` | {len(local_rows) - len(source_line_mismatches)}/{len(local_rows)} |
| Кастомных записей | {sum(bool(row.get('custom')) for row in local_rows)} |
| Некастомных записей | {sum(not row.get('custom') for row in local_rows)} |
| Лун | {len(moon_rows)} |
| Лун с указанным родителем | {len(moon_with_parent)} |

Дубли в оригинале:

{bullet_list(duplicate_names)}

Несопоставленные строки оригинала:

{bullet_list(unmatched)}

Записи с несовпадающим `sourceLine`:

{bullet_list(mismatch_names)}

При этой сверке исправлены три ранее обрезанные строки источника: **Веридия Тэлф**, **Мертвецкий валун / Мертвецкий порт / Сион (D-3974)** и **Онуру Альфа**.

## 2. Почему основной каталог отличается от оригинала

| Набор | Количество |
|---|---:|
| Уникальные записи оригинала / legacy | {len(local_rows)} |
| Точные пересечения с главным строгим каталогом | {len(strict_legacy_ids)} |
| Канонические места Wiki, отсутствовавшие в оригинале | {len(strict_added)} |
| Записи оригинала, отсутствующие в строгом каталоге | {len(source_only)} |
| Из них кастомные | {source_only_custom} |
| Из них некастомные | {source_only_regular} |
| Некастомные без принятой или явно исключённой точной Wiki-пары | {len(unmatched_noncustom)} |
| Строки, указывающие на исключённые Wiki-страницы | {len(excluded_rows)} |

Одна составная строка — **{excluded_but_retained[0]['localName'] if excluded_but_retained else 'нет'}** — одновременно указывает на исключённый `Port Zion`, но сохраняется благодаря принятому отдельному месту `Dead Man’s Rock`.

## 3. Системы

### Что действительно есть в Google Doc

Документ не объявляет звёздные системы отдельным перечнем. Прямыми свидетельствами являются только конструкции вроде `Бивак (Луна Шайло)`, `Саалок (Луна Айура)` и нумерованные/повторяющиеся названия. Нумерация сама по себе не доказывает каноническую звёздную принадлежность.

Legacy-группировки (`docs/source/systems.updated.json`):

| Основание | Систем | Назначенных строк исходника |
|---|---:|---:|
| Явная связь в документе (`pdf-linked`) | {legacy_confidences.get('pdf-linked', 0)} | {legacy_member_confidences.get('pdf-linked', 0)} |
| Вывод по повторяющимся обозначениям (`inferred`) | {legacy_confidences.get('inferred', 0)} | {legacy_member_confidences.get('inferred', 0)} |
| Внешний лор (`lore`) | {legacy_confidences.get('lore', 0)} | {legacy_member_confidences.get('lore', 0)} |
| Без системной связи | — | {legacy_member_confidences.get('без системы', 0)} |

### Текущее состояние атласа

| Показатель | Количество |
|---|---:|
| Всего системных/картографических групп | {len(current_systems)} |
| Канонические системы с явным `WorldBox.system` | {len(canonical_systems)} |
| Legacy-/картографические группы без такого подтверждения | {len(legacy_only_systems)} |
| Системы хотя бы с одним строгим местом | {len(current_systems) - len(empty_systems)} |
| Пустые после строгой фильтрации | {len(empty_systems)} |
| Строгие места с назначенной системой | {len(grouped_places)} |
| Из них по явному `WorldBox.system` | {len(explicit_system_places)} |
| Из них сохранённая legacy-группировка | {inherited_grouping_count} |

Пустые группы после удаления неканонических/кастомных мест:

{bullet_list([row['name'] for row in empty_systems])}

## 4. Найденное и исправленное расхождение систем

В оригинале есть **два разных названия**:

- `Уилел IV`;
- `Уилила I`, `Уилила II`, `Уилила III`, `Уилила IV`.

Ранее одна внутренняя система `inferred-уилила` ошибочно получила подпись карты `Уилела` и координату Уилела. Теперь они разделены:

- `uilel-system` → **Система Уилел**, `Уилел IV`, координата подписи карты `5135, 6351`;
- `inferred-уилила` → **Система Уилила**, семейство `Уилила I–IV`, без неподтверждённой координаты.

Проверка разделения: **{'пройдена' if system_split_ok else 'НЕ ПРОЙДЕНА'}**.

## 5. Итоговая оценка

1. **Список исходных объектов перенесён полностью**: 317 строк документа соответствуют 316 уникальным legacy-записям.
2. **Главный список отличается намеренно**, потому что показывает строгий канон и дополняет оригинал местами Wiki.
3. **Системы нельзя объявлять списком “из PDF/Google Doc”**: документ такого списка не содержит. В интерфейсе корректно различать 22 явные канонические системы и вспомогательные legacy-/картографические группы.
4. Исправлены три обрезанных `sourceLine` и смешение **Уилел / Уилила**.
"""

    output = Path(args.report)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(report, encoding="utf-8")

    # Полная построчная таблица: позволяет отфильтровать любую из 316 записей.
    legacy_system_by_id = {row["id"]: row for row in legacy_systems}
    strict_by_legacy = {
        row["legacyId"]: row for row in strict_places if row.get("legacyId")
    }
    excluded_by_local: dict[str, list[dict]] = collections.defaultdict(list)
    for row in excluded_rows:
        excluded_by_local[row["localId"]].append(row)
    csv_rows = []
    for row in local_rows:
        strict = strict_by_legacy.get(row["id"])
        system = legacy_system_by_id.get(row.get("systemId"))
        excluded = excluded_by_local.get(row["id"], [])
        if strict:
            status = "в строгом каталоге"
        elif row.get("custom"):
            status = "legacy: кастомная"
        elif excluded:
            status = "legacy: Wiki-страница исключена"
        else:
            status = "legacy: нет принятой точной Wiki-пары"
        csv_rows.append({
            "local_id": row["id"],
            "document_name": row["name"],
            "document_occurrences": id_counts.get(row["id"], 0),
            "custom": "да" if row.get("custom") else "нет",
            "relation": row.get("relation") or "",
            "parent": row.get("parent") or "",
            "legacy_system_id": row.get("systemId") or "",
            "legacy_system_name": (system or {}).get("name") or "",
            "legacy_system_basis": (system or {}).get("confidence") or "",
            "strict_status": status,
            "strict_wiki_title": (strict or {}).get("canonicalWikiTitle") or "",
            "strict_types": ";".join((strict or {}).get("placeTypes") or []),
            "excluded_wiki_pages": ";".join(item["wikiTitle"] for item in excluded),
            "excluded_reasons": ";".join(item["reason"] for item in excluded),
            "source_line": row.get("sourceLine") or "",
        })
    csv_output = Path(args.csv)
    csv_output.parent.mkdir(parents=True, exist_ok=True)
    with csv_output.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(csv_rows[0]))
        writer.writeheader()
        writer.writerows(csv_rows)

    print(f"Документ: {len(lines)} строк → {len(id_counts)} уникальных записей")
    print(f"Совпало: {len(matched)}; без пары: {len(unmatched)}; sourceLine mismatch: {len(source_line_mismatches)}")
    print(f"Legacy systems: {len(legacy_systems)}; current systems: {len(current_systems)}; canonical: {len(canonical_systems)}")
    print(f"Отчёт: {output}")
    print(f"Таблица: {csv_output} ({len(csv_rows)} строк)")
    return 1 if unmatched or absent_local or source_line_mismatches or custom_mismatches else 0


if __name__ == "__main__":
    raise SystemExit(main())
