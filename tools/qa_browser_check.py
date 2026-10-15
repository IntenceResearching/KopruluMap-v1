#!/usr/bin/env python3
"""Проверка атласа в реальном браузере (Playwright + Chromium).

Скрипт открывает сайт, проходит по сценариям и печатает отчёт. Возвращает 1,
если нашёл ошибки в консоли или сломанное поведение, — удобно вешать в CI.

Сценарии по умолчанию: каталог и панель, deep-link на систему, поиск, фильтры,
досье планеты, слой подписей, фильтр карты, «О данных», вики-разделы, режим
администратора (неверный/верный код, правка X/Y, экспорт, сброс), мобильная
раскладка, одиночная сборка.
С ключом --tiles дополнительно проверяется растровый режим: запросы тайлов,
переключение уровней детализации, отрисовка после зума.

Требуется:
    pip install playwright && python3 -m playwright install chromium

Примеры:
    python3 tools/qa_browser_check.py http://127.0.0.1:8080/ /tmp/shots
    python3 tools/qa_browser_check.py http://127.0.0.1:8081/ /tmp/shots --tiles
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Проверка атласа в headless Chromium")
    parser.add_argument("url", nargs="?", default="http://127.0.0.1:8080/")
    parser.add_argument("shots", nargs="?", default="/tmp/koprulu-shots")
    parser.add_argument("--tiles", action="store_true", help="добавить сценарий растрового режима")
    args = parser.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Нужен playwright: pip install playwright && python3 -m playwright install chromium", file=sys.stderr)
        return 2

    base = args.url if args.url.endswith("/") else args.url + "/"
    shots = Path(args.shots)
    shots.mkdir(parents=True, exist_ok=True)
    problems: list[str] = []
    logs: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})

        def on_console(message):
            logs.append(f"{message.type}: {message.text}")
            if message.type == "error":
                problems.append("console error: " + message.text)

        def on_pageerror(error):
            stack = getattr(error, "stack", "") or ""
            problems.append("pageerror: " + str(error))
            print("!! pageerror:", error, "\n", stack[:800])

        page.on("console", on_console)
        page.on("pageerror", on_pageerror)

        page.goto(base, wait_until="networkidle")
        page.wait_for_timeout(350)
        if page.locator("#timelineLoader").count():
            page.locator("#timelineLoader").wait_for(state="hidden", timeout=7000)
        page.wait_for_timeout(250)

        # каталог в вики-скине закрыт по умолчанию — открываем кнопкой в шапке
        if page.evaluate("() => document.getElementById('leftPanel').classList.contains('collapsed')"):
            page.click("#toggleSidePanel")
            page.wait_for_timeout(600)
            panel = page.evaluate("""() => ({
              collapsed: document.getElementById('leftPanel').classList.contains('collapsed'),
              box: (() => { const r = document.getElementById('leftPanel').getBoundingClientRect();
                            return [Math.round(r.x), Math.round(r.width)]; })(),
              mapWide: document.getElementById('mapStage').classList.contains('wide')
            })""")
            print("ПАНЕЛЬ после открытия:", json.dumps(panel))
            if panel["collapsed"] or panel["box"][0] < 0 or panel["mapWide"]:
                problems.append("кнопка в шапке не открывает каталог и не расширяет карту")

        state = page.evaluate("""() => ({
          rows: document.querySelectorAll('#catalogList .catalog-row').length,
          caption: document.querySelector('#listCaption').textContent.trim(),
          stats: document.querySelector('#catalogStats').textContent,
          filters: document.querySelectorAll('#filters .filter-chip').length,
          notice: document.querySelector('.map-notice span:nth-child(2)').textContent.trim(),
          scale: document.querySelector('#mapScale').textContent.trim()
        })""")
        print("КАТАЛОГ:", json.dumps(state, ensure_ascii=False))
        if state["rows"] < 40:
            problems.append("в каталоге мало строк: " + str(state["rows"]))
        if state["filters"] < 5:
            problems.append("мало фильтров по фракциям")

        ink = page.evaluate("""() => {
          const c = document.getElementById('mapCanvas');
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let painted = 0;
          for (let i = 0; i < d.length; i += 4000) if (d[i] + d[i+1] + d[i+2] > 24) painted++;
          return { sampled: Math.round(d.length / 4000), painted };
        }""")
        print("CANVAS:", json.dumps(ink))
        if ink["painted"] < ink["sampled"] * 0.02:
            problems.append("canvas почти пустой")
        page.screenshot(path=str(shots / "01-map.png"))

        # LOD маркеров/подписей: сначала центрируем известную систему, затем
        # перехватываем canvas-вызовы и проверяем рост world-space геометрии.
        page.evaluate("() => { location.hash = '#/s/aiur-system'; }")
        page.wait_for_timeout(700)
        page.evaluate("""() => {
          window.__lodProbe = { arcs: [], fonts: [] };
          const proto = CanvasRenderingContext2D.prototype;
          if (!proto.__kopruluLodProbe) {
            proto.__kopruluLodProbe = true;
            const arc = proto.arc;
            proto.arc = function(x, y, radius) {
              if (window.__lodProbe) window.__lodProbe.arcs.push(radius);
              return arc.apply(this, arguments);
            };
            const strokeText = proto.strokeText;
            proto.strokeText = function() {
              if (window.__lodProbe) window.__lodProbe.fonts.push(parseFloat(this.font) || 0);
              return strokeText.apply(this, arguments);
            };
          }
        }""")
        canvas_box = page.locator("#mapCanvas").bounding_box()
        if canvas_box:
            page.mouse.move(canvas_box["x"] + canvas_box["width"] / 2,
                            canvas_box["y"] + canvas_box["height"] / 2)
            page.mouse.wheel(0, 1)
            page.wait_for_timeout(350)
            overview_lod = page.evaluate("""() => ({
              radius: Math.max(0, ...window.__lodProbe.arcs),
              font: Math.max(0, ...window.__lodProbe.fonts)
            })""")
            page.evaluate("() => { window.__lodProbe.arcs = []; window.__lodProbe.fonts = []; }")
            page.mouse.wheel(0, -5000)
            page.wait_for_timeout(650)
            close_lod = page.evaluate("""() => ({
              radius: Math.max(0, ...window.__lodProbe.arcs),
              font: Math.max(0, ...window.__lodProbe.fonts),
              scale: document.querySelector('#mapScale').textContent.trim()
            })""")
            print("LOD МАРКЕРОВ:", json.dumps({"overview": overview_lod, "close": close_lod}, ensure_ascii=False))
            if close_lod["radius"] < max(18, overview_lod["radius"] * 1.7):
                problems.append("круги маркеров не растут вместе с картой при приближении")
            if close_lod["font"] < max(18, overview_lod["font"] * 1.5):
                problems.append("подписи маркеров не растут вместе с картой при приближении")
            page.screenshot(path=str(shots / "01b-lod-close.png"))
        else:
            problems.append("не удалось измерить canvas для LOD-проверки")

        page.evaluate("() => { location.hash = '#/s/aiur-system'; }")
        page.wait_for_timeout(700)
        detail = page.evaluate("""() => ({
          visible: !document.getElementById('detailPanel').hidden,
          title: (document.querySelector('.detail-title') || {}).textContent || '',
          type: document.getElementById('detailType').textContent,
          worlds: document.querySelectorAll('#detailContent .world-card').length
        })""")
        print("ДОСЬЕ:", json.dumps(detail, ensure_ascii=False))
        if not detail["visible"] or "Айур" not in detail["title"] or detail["worlds"] < 2:
            problems.append("deep-link на систему не открыл досье с мирами")
        page.screenshot(path=str(shots / "02-dossier.png"))

        page.fill("#searchInput", "тарсо")
        page.wait_for_timeout(400)
        search_state = page.evaluate("""() => ({
          open: !document.getElementById('suggestions').hidden,
          count: document.querySelectorAll('#suggestions .suggestion').length,
          first: (document.querySelector('#suggestions .suggestion-title') || {}).textContent || ''
        })""")
        print("ПОИСК:", json.dumps(search_state, ensure_ascii=False))
        if not search_state["open"] or search_state["count"] == 0:
            problems.append("поиск «тарсо» не дал подсказок")
        page.keyboard.press("Enter")
        page.wait_for_timeout(600)
        opened = page.evaluate("() => (document.querySelector('.detail-title') || {}).textContent")
        search_section = page.evaluate("() => document.querySelector('[data-catalog-view].active')?.dataset.catalogView")
        print("ПО ENTER:", opened, "· раздел", search_section)
        if not opened or search_section != "planet":
            problems.append("Enter в поиске не открыл карточку в связанном разделе каталога")
        page.screenshot(path=str(shots / "03-search.png"))

        if page.locator("#clearSearch").is_visible():
            page.click("#clearSearch")
        page.click("#catalogViewPlanets")
        page.wait_for_timeout(300)
        planets_total = page.evaluate("() => document.querySelectorAll('#catalogList .catalog-row').length")
        page.evaluate("""() => { const chips = [...document.querySelectorAll('#filters .filter-chip')];
            const target = chips.find(chip => chip.dataset.faction === 'Доминион'); target.click(); }""")
        page.wait_for_timeout(300)
        filtered = page.evaluate("() => document.querySelectorAll('#catalogList .catalog-row').length")
        print(f"ПЛАНЕТЫ: всего {planets_total}, после фильтра {filtered}")
        if planets_total != 177 or not 0 < filtered < planets_total:
            problems.append("раздел планет или фильтр по фракции работает неверно")
        page.evaluate("""() => document.querySelector('#filters .filter-chip[data-faction=""]').click()""")

        category_counts = {}
        for selector, label in (("#catalogViewStations", "stations"),
                                ("#catalogViewPlatforms", "platforms"),
                                ("#catalogViewOther", "other")):
            page.click(selector)
            page.wait_for_timeout(220)
            category_counts[label] = page.evaluate("() => document.querySelectorAll('#catalogList .catalog-row').length")
        print("РАЗДЕЛЫ МЕСТ:", json.dumps(category_counts, ensure_ascii=False))
        if category_counts["stations"] < 1 or category_counts["platforms"] < 20 or category_counts["other"] < 20:
            problems.append("новые разделы станций, платформ или иных мест не наполнены")

        page.click("#catalogViewSystems")
        page.wait_for_timeout(250)
        if page.evaluate("() => document.querySelectorAll('#catalogList .catalog-row').length") < 40:
            problems.append("после перехода в раздел систем список не восстановился")

        page.evaluate("() => document.querySelector('#catalogList .catalog-row').click()")
        page.wait_for_timeout(600)
        print("КЛИК ПО СТРОКЕ:", page.evaluate("() => (document.querySelector('.detail-title') || {}).textContent"))

        page.click("#labelsToggle")
        page.wait_for_timeout(400)
        print("ПОДПИСИ:", page.evaluate("() => document.getElementById('labelsToggle').getAttribute('aria-pressed')"))
        page.screenshot(path=str(shots / "04-labels.png"))

        page.select_option("#mapFactionFilter", index=1)
        page.wait_for_timeout(500)
        print("ФИЛЬТР КАРТЫ:", page.evaluate("() => document.getElementById('mapFactionFilter').value"))

        page.click("#helpButton")
        page.wait_for_timeout(300)
        print("О ДАННЫХ:", str(page.evaluate(
            "() => document.querySelector('#helpModal .modal-body').textContent.replace(/\\s+/g, ' ').slice(0, 140)")))
        page.screenshot(path=str(shots / "05-help.png"))
        page.keyboard.press("Escape")
        page.wait_for_timeout(250)

        sections = page.evaluate("""() => ({
          total: document.querySelectorAll('[data-catalog-view]').length,
          active: document.querySelector('[data-catalog-view].active')?.dataset.catalogView,
          labels: [...document.querySelectorAll('[data-catalog-view] strong')].map(node => node.textContent.trim())
        })""")
        print("РАЗДЕЛЫ КАТАЛОГА:", json.dumps(sections, ensure_ascii=False))
        if sections["total"] != 5 or sections["active"] != "systems":
            problems.append("функциональная навигация каталога собрана неверно")
        page.screenshot(path=str(shots / "06-catalog-sections.png"))
        page.wait_for_timeout(250)

        page.click("#adminAccessButton")
        page.wait_for_timeout(300)
        page.fill("#adminCode", "неверно")
        page.click("#adminForm button[type=submit]")
        page.wait_for_timeout(250)
        if not page.evaluate("() => document.getElementById('adminError').textContent"):
            problems.append("неверный код доступа не дал ошибки")
        page.fill("#adminCode", "koprulu-2513")
        page.click("#adminForm button[type=submit]")
        page.wait_for_timeout(500)
        admin = page.evaluate("""() => ({
          dock: !document.getElementById('adminDock').hidden,
          canvasClass: document.getElementById('mapCanvas').className,
          session: sessionStorage.getItem('koprulu.atlas.admin.v1')
        })""")
        print("АДМИН включён:", json.dumps(admin, ensure_ascii=False))
        if not admin["dock"] or "admin-mode" not in admin["canvasClass"]:
            problems.append("режим правки не включился по верному коду")

        page.evaluate("() => { location.hash = '#/s/char-system'; }")
        page.wait_for_timeout(700)
        page.fill("#coordX", "5100")
        page.fill("#coordY", "5900")
        page.click("#applyCoords")
        page.wait_for_timeout(400)
        stored = page.evaluate("() => localStorage.getItem('koprulu.atlas.edits.v1')")
        print("ПРАВКА:", stored)
        if not stored or "char-system" not in stored:
            problems.append("правка координат не сохранилась в localStorage")
        page.screenshot(path=str(shots / "07-admin.png"))

        with page.expect_download() as download_info:
            page.click("#exportCoords")
        print("ЭКСПОРТ:", download_info.value.suggested_filename)

        page.on("dialog", lambda dialog: dialog.accept())
        page.click("#resetCoords")
        page.wait_for_timeout(400)
        if page.evaluate("() => localStorage.getItem('koprulu.atlas.edits.v1')") not in ("{}", None):
            problems.append("сброс локальных правок не сработал")

        page.set_viewport_size({"width": 420, "height": 900})
        page.wait_for_timeout(700)
        page.evaluate("() => { location.hash = '#/s/tarsonis-system'; }")
        page.wait_for_timeout(600)
        page.screenshot(path=str(shots / "08-mobile.png"))
        mobile = page.evaluate("""() => ({
          detail: !document.getElementById('detailPanel').hidden,
          canvas: [document.getElementById('mapCanvas').clientWidth, document.getElementById('mapCanvas').clientHeight]
        })""")
        print("МОБИЛЬНЫЙ:", json.dumps(mobile))
        if not mobile["detail"] or mobile["canvas"][0] < 300:
            problems.append("мобильная раскладка сломана")

        single = browser.new_page(viewport={"width": 1280, "height": 860})
        single.goto(base + "koprulu-atlas.html", wait_until="load")
        single.wait_for_timeout(1500)
        single_state = single.evaluate("""() => ({
          rows: document.querySelectorAll('#catalogList .catalog-row').length,
          inline: !!window.__KOPRULU_DATA__,
          errors: document.querySelectorAll('.data-error').length
        })""")
        print("ОДИНОЧНЫЙ ФАЙЛ:", json.dumps(single_state, ensure_ascii=False))
        if single_state["rows"] < 40 or single_state["errors"] or not single_state["inline"]:
            problems.append("одиночная сборка не работает")
        single.screenshot(path=str(shots / "09-single.png"))

        if args.tiles:
            # возвращаем десктопную раскладку и выходим из режима правки:
            # на мобильной ширине док администратора перекрывает управление картой
            page.set_viewport_size({"width": 1440, "height": 900})
            page.wait_for_timeout(700)
            if not page.evaluate("() => document.getElementById('adminDock').hidden"):
                page.click("#exitAdmin")
                page.wait_for_timeout(400)
            page.evaluate("() => { location.hash = ''; }")
            page.wait_for_timeout(400)

            raster = page.evaluate("""() => {
              const c = document.getElementById('mapCanvas');
              const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
              let colored = 0;
              for (let i = 0; i < d.length; i += 4000) {
                if (Math.abs(d[i] - 3) > 6 || Math.abs(d[i + 1] - 6) > 6) colored++;
              }
              return { sampled: Math.round(d.length / 4000), colored,
                       notice: document.querySelector('.map-notice span:nth-child(2)').textContent.trim() };
            }""")
            print("РАСТР:", json.dumps(raster, ensure_ascii=False))
            if raster["colored"] < raster["sampled"] * 0.2:
                problems.append("тайлы не отрисовались: canvas почти чёрный")
            tiles_requested = page.evaluate("""() => performance.getEntriesByType('resource')
                .filter(r => r.name.includes('/assets/tiles/')).length""")
            print("ЗАПРОСОВ ТАЙЛОВ:", tiles_requested)
            if not tiles_requested:
                problems.append("страница не запросила ни одного тайла")
            page.screenshot(path=str(shots / "10-tiles.png"))

            for _ in range(6):
                page.mouse.move(700, 450)
                page.mouse.wheel(0, -600)
                page.wait_for_timeout(220)
            page.wait_for_timeout(1000)
            levels = page.evaluate("""() => [...new Set(performance.getEntriesByType('resource')
                .map(r => (r.name.match(/\\/assets\\/tiles\\/(\\d+)\\//) || [])[1]).filter(Boolean))]""")
            print("УРОВНИ ДЕТАЛИЗАЦИИ:", levels, "| зум:",
                  page.evaluate("() => document.getElementById('zoomPercent').textContent"))
            page.screenshot(path=str(shots / "11-tiles-zoom.png"))
            page.click("#resetMap")
            page.wait_for_timeout(800)
            if page.evaluate("() => document.getElementById('zoomPercent').textContent") != "100%":
                problems.append("кнопка «показать всю карту» не вернула обзор")

            # Регрессия геометрии тайлов: уровень 1250 имеет 3 колонки, причём
            # последняя неполная. Старое size/cols сжимало растр до 84,7%, а
            # маркеры улетали в чёрное поле справа. Повторяем размер и 138% со
            # скриншота дефекта и ищем зелёную рамку карты у расчётной границы.
            page.set_viewport_size({"width": 1560, "height": 749})
            page.wait_for_timeout(500)
            page.click("#resetMap")
            page.wait_for_timeout(350)
            canvas_box = page.locator("#mapCanvas").bounding_box()
            page.mouse.move(canvas_box["x"] + canvas_box["width"] / 2,
                            canvas_box["y"] + canvas_box["height"] / 2)
            page.mouse.wheel(0, -201)
            page.wait_for_timeout(900)
            geometry = page.evaluate("""() => {
              const c = document.getElementById('mapCanvas');
              const factor = parseInt(document.getElementById('zoomPercent').textContent, 10) / 100;
              const span = Math.min(c.clientWidth, c.clientHeight) * .94 * factor;
              const expectedLeft = Math.round((c.clientWidth - span) / 2);
              const expectedRight = Math.round((c.clientWidth + span) / 2);
              const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
              function greenAt(cx) {
                let count = 0;
                for (let x = Math.max(0, cx - 7); x <= Math.min(c.width - 1, cx + 7); x++) {
                  for (let y = 0; y < c.height; y++) {
                    const i = (y * c.width + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
                    if (g > 55 && g > r * 1.12 && g > b * 1.06) count++;
                  }
                }
                return count;
              }
              return { zoom: factor, expectedLeft, expectedRight,
                       leftGreen: greenAt(expectedLeft), rightGreen: greenAt(expectedRight) };
            }""")
            print("ГЕОМЕТРИЯ 1560×749 / 138%:", json.dumps(geometry, ensure_ascii=False))
            if geometry["leftGreen"] < 500 or geometry["rightGreen"] < 500:
                problems.append("растр сжат относительно координатного слоя: рамка не совпала с границами мира")
            page.screenshot(path=str(shots / "12-geometry-138.png"))

        browser.close()

    print("\nПоследние записи консоли:")
    for line in logs[-8:]:
        print("   " + line[:160])

    print("\nПРОБЛЕМЫ:" if problems else "\nПРОБЛЕМ НЕТ")
    for problem in problems:
        print("   x " + problem[:200])
    print(f"\nСнимки экрана: {shots}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
