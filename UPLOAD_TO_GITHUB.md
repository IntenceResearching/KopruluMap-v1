# Как загрузить этот архив на GitHub

Это **исходный репозиторий без карты и без тайлов**. Он содержит:

- рабочие `index.html`, `minimal.html`, `app.js` и CSS;
- главный каталог 297 канонических мест / 55 системных групп, legacy-снимок 316 строк, 25 координат с карты и полный Wiki-аудит;
- публичную Drive-ссылку на полный JPEG 10000×10000 в `data/sources.json`;
- `.github/workflows/sync-and-deploy.yml`;
- инструменты временной загрузки и сборки в `tools/`;
- README и `PIPELINE_SETUP.md`.

В ZIP намеренно нет `assets/tiles/`, `assets/tiles.json`, `assets/map-preview.webp` и исходного JPEG. `.gitignore` запрещает их коммитить.

## Как появляется карта на сайте

GitHub Action скачивает полный открытый файл с Google Drive на временный runner, проверяет размер и SHA-256, строит все 534 тайла четырёх уровней, кладёт их только в Pages artifact и публикует его. После deploy runner удаляется. Ни исходник, ни производные пиксели в историю Git не попадают.

## Вариант 1 — через git

Распакуйте архив и откройте терминал внутри папки `koprulu-atlas`:

```bash
git init
git add .
git commit -m "Initial reconstructed Koprulu Atlas"
git branch -M main
git remote add origin https://github.com/ВАШ_ЛОГИН/ВАШ_РЕПОЗИТОРИЙ.git
git push -u origin main
```

## Вариант 2 — через интерфейс GitHub

Создайте пустой репозиторий, распакуйте архив и загрузите **содержимое** папки `koprulu-atlas`, включая скрытые `.github` и `.gitignore`. Сам ZIP класть в репозиторий не нужно.

## Включить Pages

1. **Settings → Pages → Build and deployment → Source → GitHub Actions**.
2. **Actions → Sync and deploy Koprulu Atlas → Run workflow**.

Запись workflow в `main` не нужна. Карта уже настроена через `data/sources.json`; `GOOGLE_DRIVE_MAP_URL` — только необязательная подмена. `GOOGLE_SHEETS_CSV_URL` нужна лишь при подключении опубликованной таблицы.
