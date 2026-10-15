# Changelog

## Galaxy page — переработка перехода и управления
- Переход на карту сектора: квадрат из 4 угловых сегментов, сужающийся в 4 этапа от границ страницы точно в маркер сектора (48×48), вместо 4 гаснущих панелей-квадрантов.
- Исправлена точка схождения: считалась от окна, а не от изображения — на 1920×1080 анимация промахивалась на 193.5px правее сектора (letterbox карты).
- Финальный zoom ×2.6 в точку сектора теперь проигрывается полностью (0.95 с), переход на sector.html — после него (~3 с на всё).
- Карта галактики: zoom колесом (0.6×–8×, к курсору), панорама drag'ом, двойной клик — сброс вида. Хотспот пересчитывается от фактического rect'а картинки, поэтому точен при любом зуме.
- Список секторов — выезжающий (slide), у пункта миниатюра: кроп карты галактики вокруг сектора (`assets/thumb-koprulu.jpg`, центр 2191×945).

## Data model — sheet schema
- `docs/stages/stage-data-model.md`, `data/systems-sheet-template.csv`.

## Stage A (upd) — url sources
- Google Sheets published CSV support in sync.py + sources.json.

## Stage 2 — frontend skeleton
- `?fresh=1` parsing, `#mapPlaceholder`, report `docs/stages/stage-2-frontend.md`.

## Stage A — sync skeleton
- `tools/sync.py`, `.github/workflows/sync.yml`, report `docs/stages/stage-a-sync.md`.

## Stage 0 — 8436f41
- Skeleton: `data/sources.json`, `data/meta.json`, `.github/workflows/sync.yml` (draft), report `docs/stages/stage-0-agreements.md`.
