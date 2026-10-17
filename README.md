# Map Atlas — skeleton

Каркас интерактивного атласа: canvas-рендер карты, поиск, каталог, досье, Timeline Project скин.

Специфические данные, пайплайн и документация удалены. Продакшен по ТЗ — позже.

## Запуск

Сайт живёт в папке `site/` — она и есть корень публикации. Скрипты ссылаются на
`/data/…` и `/assets/…` от корня сайта, поэтому поднимать сервер надо так,
чтобы корнем был собранный сайт (страницы + `data/` + `assets/`):

```bash
rm -rf .publish && mkdir -p .publish
cp -R site/. .publish/
cp -R data assets .publish/          # assets/ можно симлинкой
python3 -m http.server 8080 --bind 0.0.0.0 --directory .publish
```

Открывайте через HTTP-сервер, а не `file://`.

## Файлы

## Структура

```
site/                  ← корень сайта (это публикуется в Pages)
├── index.html         карта галактики, стартовая страница
├── galaxy.js          логика карты галактики
├── galaxy.css         стили карты галактики
├── sector/
│   └── sector.html    полный атлас сектора
├── minimal/
│   ├── minimal.html   минимальный скин атласа
│   └── minimal-skin.css
└── shared/            общий код для всех страниц
    ├── app.js             логика атласа: canvas-рендер, поиск, каталог, досье
    ├── focus-fx.js        анимация выделения и приближения (прицел в духе брифингов
    │                      StarCraft II); как подключить — в начале файла
    ├── lag-fx.js          эффект «лага» для картинки (полосы, волна, линии-преломления);
    │                      как подключить — в начале файла
    ├── links.js           пути к страницам и ассетам
    ├── timeline-loader.js прелоадер
    ├── styles.css         базовые стили
    ├── timeline-skin.css  скин Timeline Project
    ├── wiki-skin.css      вики-навигация
    ├── readability.css    типографика
    └── catalog-typography.css

data/                  данные (CSV, JSON) — пишет tools/sync.py, вне site/
assets/                картинки, которые отдаются в веб (собираются, в Git не лежат)
assets/src/            исходники картинок — в Git, в веб не публикуются
docs/, tools/, .github/  служебное, вне site/
```

Все внутренние ссылки — от корня сайта: `/shared/…`, `/sector/sector.html`,
`/data/…`, `/assets/…`. Поэтому страницы можно перекладывать по папкам, не
переписывая пути, а `data/` и `assets/` оставить в корне репозитория.

| Файл | Назначение |
|---|---|
| `site/index.html` | Карта галактики (стартовая) |
| `site/sector/sector.html` | Полный атлас сектора |
| `site/minimal/minimal.html` | Минимальный скин |
| `site/shared/app.js` | Логика: canvas-рендер, поиск, каталог, досье |
| `site/shared/*.css` | Стили и скины |
| `assets/` | Дизайн-ассеты |

## Публикация

Сайт публикуется воркфлоу [`.github/workflows/pages.yml`](.github/workflows/pages.yml): пуш в `main` или запуск вручную из вкладки Actions. В настройках репозитория (**Settings → Pages → Build and deployment → Source**) должен быть выбран **GitHub Actions**.

Если там стоит «Deploy from a branch», Pages публикует корень репозитория через Jekyll, воркфлоу в публикации не участвует, и сайт оказывается под префиксом `/site/` — ссылки вида `/shared/…` и `/sector/sector.html` перестают находиться.

Каждый PR проверяет воркфлоу [`.github/workflows/check.yml`](.github/workflows/check.yml): собирает сайт так же, как деплой, на Ubuntu 24.04 и 26.04 (с 19.10.2026 GitHub переводит `ubuntu-latest` на 26.04), проверяет синтаксис скриптов и обращения к необъявленным переменным (ESLint, настройки — `eslint.config.mjs`). Ничего не публикует. Python для сборки ставится через `actions/setup-python`, версия Pillow зафиксирована в `tools/requirements.txt` — от системного Python раннера сборка не зависит.

## Картинки и тайлы

Исходники лежат в `assets/src/` — это единственное, что хранится в Git. Всё, что
отдаётся в веб, собирается из них скриптом:

```bash
python3 -m pip install -r tools/requirements.txt   # Pillow
python3 tools/build_assets.py            # собрать то, что устарело
python3 tools/build_assets.py --force    # пересобрать всё
python3 tools/build_assets.py --check    # проверить свежесть, ничего не собирая
```

| Исходник | Что получается |
|---|---|
| `src/koprulu-sector.jpg` (10 000²) | `tiles/<уровень>/<столбец>_<строка>.webp` — пирамида 512×512 на четырёх уровнях (1250 → 10 000), 534 файла; `tiles.json` — манифест; `map-preview.webp` (2500²) — подложка на первый кадр |
| `src/galaxy-map.jpg` | `galaxy-map-1200.webp`, `galaxy-map-2000.webp` и `galaxy-map-3000.webp` под `srcset` (3000 — без ресайза, грузится при приближении) |
| `src/timeline-project-logo.png` | `timeline-project-logo.webp` (600²) — логотип экрана загрузки |
| `src/koprulu-macket.jpg`, `src/ozd-macket.png` | `koprulu-macket.webp`, `ozd-macket.webp` |

Свежесть считается по SHA-256 исходника: хэш записан в манифест, поэтому после
подмены исходника сборка сама понимает, что устарела.

GitHub Pages кэширует файлы на 10 минут, а адреса тайлов после пересборки не
меняются, поэтому у сборки есть версии:

- манифест несёт `version` — первые 8 символов SHA-256 исходника карты; `app.js`
  добавляет `?v=` к адресам тайлов и подложки;
- ссылки на `galaxy-map-*`, логотип и макеты получают `?v=` от общего хэша всех
  исходников — их расставляет сам скрипт (шаг «Версии в ссылках»), `--check`
  следит, что они не устарели. Скрипт также пишет в
`data/meta.json` поле `assets.hasRaster` — по нему `app.js` решает, запрашивать ли
манифест тайлов.

Собранные файлы в Git не хранятся (см. `.gitignore`): при деплое `pages.yml`
собирает их на раннере за ~15 с. Чтобы посмотреть результат без деплоя, есть
воркфлоу **Build image assets** (Actions → Run workflow) — он выкладывает картинки
артефактом.

## Правила внесения данных

Как заполнять таблицу-источник, из которой сайт забирает данные: [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md).

## История изменений

См. [CHANGELOG.md](CHANGELOG.md).
