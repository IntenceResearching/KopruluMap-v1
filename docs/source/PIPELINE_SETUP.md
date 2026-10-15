# Автосинхронизация карты и систем — без Google API

Здесь используется прямое HTTP-скачивание публично расшаренного файла через `gdown`, а не Google Drive API, OAuth или service account. Таблица Google Sheets скачивается Action как опубликованный CSV. Браузер сайта ни к Google Drive, ни к Google Sheets не обращается.

> **Условие для карты:** файл в Drive должен открываться без входа в Google: доступ **Anyone with the link / Все, у кого есть ссылка → Viewer / Читатель**. При режиме Restricted прямое скачивание без авторизации работать не будет. `gdown` обрабатывает Google Drive share-ссылки и обычную страницу подтверждения скачивания для крупных файлов: [gdown](https://github.com/wkentaro/gdown).

## Что уже подготовлено

- `.github/workflows/sync-and-deploy.yml` — ручной запуск, почасовой запуск и запуск при изменении файлов сайта; сборка, commit и Pages deploy.
- `tools/download_drive_file.py` — извлекает ID из обычной Drive share-ссылки или принимает ID и скачивает публичный файл без API; вызов `gdown` использует совместимый URL-интерфейс без аргумента `fuzzy`.
- `tools/build_tiles.py` — строит цветную пирамиду 1 250 / 2 500 / 5 000 / 10 000 px, тайлы 512 px; выход совпадает с текущим атласом: `assets/tiles/<level-index>/<x>_<y>.webp`.
- `tools/sync_system_overrides.py` — загружает опубликованный CSV из Sheets и проверяет ID, названия, координаты, описания и фракции.
- `tools/set_asset_version.py` — обновляет версии JS/CSS/данных/тайлов, чтобы браузер не смешивал старые и новые файлы.
- `tools/stage_pages.py` — собирает публичные файлы сайта для Pages.
- `data/systems-sheet-template.csv` — шаблон таблицы на 45 систем. `id` — стабильный ключ; не удаляйте и не меняйте его, особенно при переименовании системы.

## 1. Подготовьте файл карты в Google Drive

1. Загрузите квадратную растровую карту под именем `koprulu_map.png`. PSD сначала экспортируйте в PNG. Скрипт принимает PNG/JPEG/WebP; если размер квадратный, приведёт изображение к 10 000 × 10 000. Неквадратная карта будет отклонена, чтобы не исказить координаты.
2. В Drive выберите файл → **Share / Поделиться** → **General access / Общий доступ** → **Anyone with the link / Все, у кого есть ссылка** → роль **Viewer / Читатель** → **Copy link / Копировать ссылку**. [Справка Google Drive](https://support.google.com/drive/answer/2494822?hl=en&co=GENIE.Platform%3DDesktop).
3. Проверьте скопированную ссылку в приватном/инкогнито-окне: она должна открываться без входа в Google. Если это запрещает аккаунт Workspace, прямой способ не сработает — тогда понадобится авторизованная схема.
4. Новую ссылку вставьте в GitHub variable `GOOGLE_DRIVE_MAP_URL`. Если заменять содержимое того же Drive-файла, ID/link не меняется; если создать новый файл — обновите variable.

**Важно:** `Anyone with the link` разрешает скачивать исходник карты всем, у кого есть ссылка. Не используйте для приватных материалов.

## 2. Подготовьте Google Sheet

1. Импортируйте `data/systems-sheet-template.csv` в Google Sheets.
2. Не удаляйте колонку `id`. Она позволяет менять отображаемое название, сохраняя привязку к записи каталога. Без ID строка сопоставляется только по старому названию.
3. Рекомендуемые заголовки: `id`, `Название системы`, `X`, `Y`, `Описание`, `Фракция`.
   - `X` и `Y` — целые числа от **0 до 10000**.
   - Альтернатива — колонки `x_norm` и `y_norm` со значениями **0…1**; например, `0.5` — середина карты.
   - Заполняйте X и Y вместе или оставляйте обе ячейки пустыми. Пустая пара не удаляет исходную координату.
   - Пустые описание/фракция не добавляют override; заполненная фракция участвует в фильтре.
4. В таблице откройте **Файл → Поделиться → Опубликовать в интернете**, выберите нужный лист и формат **CSV**, нажмите **Опубликовать**, скопируйте ссылку. [Инструкция Google Sheets](https://support.google.com/docs/answer/183965?hl=en&co=GENIE.Platform%3DDesktop).
5. Вставьте эту ссылку в GitHub variable `GOOGLE_SHEETS_CSV_URL`. Публикуйте только те данные, которые можно показывать публике: CSV доступен согласно параметрам публикации.

## 3. Добавьте две GitHub Variables

Откройте [Settings → Secrets and variables → Actions → Variables](https://github.com/intenceresearching/intenceresearching.github.io/settings/variables/actions) и создайте **Repository variables**:

| Name | Что вставить |
|---|---|
| `GOOGLE_DRIVE_MAP_URL` | Полную ссылку «Копировать ссылку» на файл карты в Drive (не ссылку на папку) |
| `GOOGLE_SHEETS_CSV_URL` | CSV URL из «Опубликовать в интернете» |

Для этого варианта **не нужны** `GOOGLE_SERVICE_ACCOUNT_JSON`, API key, OAuth client или Google Cloud service account. В этой сессии Google Drive тоже подключать не требуется.

## 4. Включите GitHub Pages и запустите Action

1. В [Pages settings](https://github.com/intenceresearching/intenceresearching.github.io/settings/pages) выберите **Build and deployment → Source → GitHub Actions**. Подготовленный workflow собирает и выкладывает Pages artifact напрямую.
2. Убедитесь, что default branch называется `main`. Если ветка другая, замените `main` в `.github/workflows/sync-and-deploy.yml`.
3. В **Settings → Actions → General → Workflow permissions** включите разрешение записи (**Read and write permissions**), чтобы Action мог коммитить сгенерированные тайлы и JSON.
4. Добавьте файлы заготовки в корень репозитория `intenceresearching.github.io` и отправьте commit. Если используете другой репозиторий, поменяйте его имя в ссылках этой инструкции.
5. Откройте [Actions](https://github.com/intenceresearching/intenceresearching.github.io/actions), выберите **Sync and deploy Koprulu Atlas** → **Run workflow**.

После первого ручного запуска workflow выполняется каждый час (cron задан в UTC). Если карта и CSV не изменились, commit и повторная публикация пропускаются. Для немедленной синхронизации используйте **Run workflow**. Google может не сразу обновить опубликованный CSV; Action увидит его при следующем чтении.

## Что обновляется автоматически

- Drive-карта нарезается в `assets/tiles/`, а также обновляет `assets/tiles.json` и `assets/map-preview.webp`.
- Таблица преобразуется в `data/system-overrides.json`; базовый `data/systems.json` остаётся исходным каталогом. Неизвестный ID, дубли и некорректные координаты останавливают синхронизацию вместо создания случайной точки.
- Название, X/Y, описание и фракция накладываются на систему по `id`; фильтр фракций учитывает таблицу. Координата относится к системе, не к отдельной планете.
- В конце workflow пересчитывает cache-busting, коммитит файлы и деплоит Pages. Публикация через custom GitHub Actions workflow описана в [GitHub Pages docs](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

Локальные admin-координаты в `localStorage` остаются приоритетным личным слоем поверх Sheet. Если в браузере уже сохраняли локальные правки, сбросьте их в панели администратора, чтобы увидеть позиции из опубликованной таблицы.

## Если не скачивается

- Если лог показывает `download() got an unexpected keyword argument 'fuzzy'`, репозиторий всё ещё использует старый `tools/download_drive_file.py`: замените его актуальной версией из заготовки и повторите запуск. При этой ошибке до проверки доступа к Drive дело ещё не дошло.
- Убедитесь, что Drive share-ссылка открывается в инкогнито без входа и даёт роль Viewer. Политики Google Workspace иногда запрещают Anyone with the link.
- Проверьте, что это **файл**, а не папка, и что загружен обычный квадратный PNG/JPEG/WebP, не Google Docs и не PSD.
- Если `gdown` сообщает, что файл не найден/доступ закрыт, исправьте общий доступ и снова нажмите **Run workflow**. Если открыть оригинал всем по ссылке нельзя, потребуется аутентифицированная схема через Google Drive API или service account — без неё приватный файл скачать нельзя.
- Если Sheets CSV не читается, проверьте, что URL ведёт на опубликованный CSV-лист, а не на страницу редактирования.
- Если commit блокирует branch protection, разрешите workflow запись в `main` либо отдельно настройте PR-сценарий.
