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
├── galaxy-fx.js       эффекты (фон, свечения)
├── galaxy-ping.js     пинг-подсветка секторов
├── sector/
│   └── sector.html    полный атлас сектора
├── minimal/
│   ├── minimal.html   минимальный скин атласа
│   └── minimal-skin.css
└── shared/            общий код для всех страниц
    ├── app.js             логика атласа: canvas-рендер, поиск, каталог, досье
    ├── links.js           пути к страницам и ассетам
    ├── timeline-loader.js прелоадер
    ├── styles.css         базовые стили
    ├── timeline-skin.css  скин Timeline Project
    ├── wiki-skin.css      вики-навигация
    ├── readability.css    типографика
    └── catalog-typography.css

data/                  данные (CSV, JSON) — пишет tools/sync.py, вне site/
assets/                дизайн-ассеты — вне site/
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

## Правила внесения данных

Как заполнять таблицу-источник, из которой сайт забирает данные: [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md).

## История изменений

См. [CHANGELOG.md](CHANGELOG.md).
