# Модель данных и иерархия адаптации

## Источники
1. **GitHub-репо разработчика карты** (`type: github`) — картинка-подложка + CSV с координатами.
2. **Google Sheets** (`type: url`) — опубликованный CSV (системы/места/описания).

## Иерархия адаптации
```
Google Sheet / upstream repo (сырые данные)
        ↓ sync.py (скачивание, валидация, transform)
data/upstream/<id>.*   (оригинал, для отладки)
        ↓ transform (flipY/scale/offset, мерж по id)
data/sectors.csv, data/objects.csv, data/system-overrides.csv  (рабочие)
        ↓ фронт (app.js)
Каталог / досье / карта
```
Правило: при провале валидации рабочие файлы не затираются.

## Сущности

### System (система / картографическая группа)
| колонка | тип | описание |
|---|---|---|
| id | string (PK) | уникальный id, напр. `aiur-system` |
| name | string | название |
| x, y | number | координаты узла на карте (могут быть условными) |
| faction | string | фракция |
| description | string | описание |
| source_url | string | ссылка на источник/Wiki |

### Place (место)
| колонка | тип | описание |
|---|---|---|
| id | string (PK) | уникальный id |
| name | string | название |
| type | enum | planet / moon / asteroid / station / platform / other |
| system_id | string (FK→System, nullable) | система-владелец |
| x, y | number (nullable) | собственные координаты; если пусто — берётся из системы |
| description | string | описание |
| faction | string | фракция |
| source_url | string | ссылка |

### «Уникальные» места (станции, пояса астероидов)
- type ∈ {station, asteroid_belt, platform, ...}, system_id задан.
- В каталоге попадают в раздел **«Иные места» (ETC)**, но в досье системы показываются как её члены.
- Координаты могут наследоваться от системы (x/y пустые).

## Категории каталога (UI)
- SYS — системы (System)
- PLN — планеты (type=planet)
- STN — станции (type=station)
- PLT — платформы (type=platform)
- ETC — иные (moon, asteroid, asteroid_belt, other)

## Публикация Google Sheet
Таблица должна быть опубликована: File → Share → Publish to web → CSV. Иначе sync получит 403/HTML.
