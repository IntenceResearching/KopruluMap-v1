# Map Atlas — skeleton

Каркас интерактивного атласа: canvas-рендер карты, поиск, каталог, досье, Timeline Project скин.

Специфические данные, пайплайн и документация удалены. Продакшен по ТЗ — позже.

## Запуск

```bash
python3 -m http.server 8080 --bind 0.0.0.0
```

Открывайте через HTTP-сервер, а не `file://`.

## Файлы

| Файл | Назначение |
|---|---|
| `index.html` | Карта галактики (стартовая) |
| `sector.html` | Полный атлас сектора |
| `minimal.html` | Минимальный скин |
| `app.js` | Логика: canvas-рендер, поиск, каталог, досье |
| `styles.css`, `wiki-skin.css`, `timeline-skin.css`, `readability.css`, `minimal-skin.css` | Стили и скины |
| `assets/` | Дизайн-ассеты |

## Правила внесения данных

Как заполнять таблицу-источник, из которой сайт забирает данные: [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md).

## История изменений

См. [CHANGELOG.md](CHANGELOG.md).
