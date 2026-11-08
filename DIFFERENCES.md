# Differences from the original · Отличия от оригинала

Upstream original: [cata02222/SillyTavern-Microfiche](https://github.com/cata02222/SillyTavern-Microfiche) **v0.3.0** (commit `9b35fa8`).
This edition: **v0.4.1**, by AlhenaaS, under the same AGPL-3.0 license.

The original renders prompt blocks as images for Gemini with a `keep` marker and per-quality cost tuning. Everything below is what this edition changes, fixes and adds on top of it.

---

## English

### Fixed

- **Lorebook pages converted only one entry per block.** The activated-entry array that SillyTavern reports (`WORLD_INFO_ACTIVATED`) is in activation order, while the joined prompt string is built in the opposite direction. The splitter matched entries by array position with a forward-only cursor, so all entries except one degraded to plain text — which is why some lorebooks "worked" (a single activated entry) and others did not. Entries are now matched by position in the string, order-independently, with all occurrences considered and overlaps resolved deterministically. Multi-entry books convert fully.
- **Depth-injected lorebook entries can no longer steal text.** Entries positioned atDepth / author's note / EM are injected elsewhere in the payload and never belong to the World Info (before/after) strings; they are now filtered out of block matching instead of being able to claim text by coincidence.
- **Quiet generations are left alone.** Background requests from other extensions (summarizers, memory plugins) used to get converted into pages and disturbed the last-request state; they now pass through untouched.
- **Inline base64 payloads no longer fill pages with noise.** Data URLs pasted into messages (screenshots and the like) become a short `[inline … data omitted, ~N KB]` placeholder on the rendered page.

### Added

- **Lorebook granularity** — send all lorebooks or only selected books; per-entry `img` / `keep` markers override the selection; unattributed text always stays as text.
- **Keep-newest modes** — keep the newest messages as text by count (`Messages`) or by token budget (`Tokens`).
- **Payload audit and diagnostics** — attachment counts, an attachment order map (position → page → message range), comparison between prompt assembly and sending, bounded in-memory log with JSON/clipboard export. The log never contains chat text, URLs or base64.
- **Page viewer with zoom and export** — a popup per message showing exactly what was attached: zoom via ＋/－/⟲ buttons, Ctrl+wheel fine steps (plain wheel keeps scrolling), pinch and one-finger pan on touch screens, double click reset; per-page **PNG/JPG download** and the whole set as **one multi-page PDF**.
- **Notifications** — a success toast on every converted request (swipes included, toggleable); warnings when the current model has images off, and when an active lorebook is unticked in "selected" mode.
- **Setup image grouping** — merge selected prompts into fewer pages, or keep each at its preset position.
- **Bilingual UI** — Russian and English, follows SillyTavern's language or is forced in settings.
- **Standalone lorebook converter** — `tools/convert-lorebooks.mjs` converts old book shapes (`entries` as an array, NovelAI lorebooks) to the native format with timestamped backups; `--check` reports without writing.
- **Test suite** — 145 Node tests over the pure modules (layout, splitting, rendering, audit, converter, i18n).

### Changed

- `loading_order` 90 → 1000: this edition runs its prompt hook after other extensions' hooks (trackers, prompt templates), so it sees and finalizes the payload last.
- Non-Gemini models: the experimental opt-in gained a per-model tokens-per-page estimate instead of a fixed one.

### Kept from the original

- The rendering pipeline and page format ideas, the `keep` marker, the Gemini quality tiers, the byte budget, the AGPL-3.0 license and the font credits.

---

## Русский

Оригинал: [cata02222/SillyTavern-Microfiche](https://github.com/cata02222/SillyTavern-Microfiche) **v0.3.0** (коммит `9b35fa8`).
Это издание: **v0.4.1**, автор AlhenaaS, под той же лицензией AGPL-3.0.

Оригинал рендерил блоки промпта картинками для Gemini, имел маркер `keep` и настройку качества. Ниже — всё, что это издание меняет, чинит и добавляет поверх него.

### Исправлено

- **Лорбук конвертировался одной записью на блок.** Массив активированных записей из события `WORLD_INFO_ACTIVATED` приходит в порядке активации, а строка промпта собирается в обратном направлении. Сплиттер сопоставлял записи по позиции в массиве с «только вперёд» курсором — все записи, кроме первой, оставались текстом. Поэтому одни лорбуки «работали» (активна одна запись), другие — нет. Теперь записи сопоставляются по позиции в строке независимо от порядка, с перебором всех вхождений и детерминированным разрешением пересечений. Многозаписные книги конвертируются целиком.
- **Записи с инъекцией на глубину больше не крадут текст.** Записи с позицией atDepth / авторская заметка / EM попадают в другое место промпта и не могут лежать в строках World Info (before/after); теперь они отфильтровываются до сопоставления.
- **Тихие генерации не трогаются.** Фоновые запросы других расширений (суммаризаторы, memory-плагины) больше не конвертируются и не сбивают состояние последнего запроса.
- **Inline base64 больше не заливает страницы шумом.** Data-URL, вставленные в сообщения, превращаются в короткую плашку `[inline … data omitted, ~N KB]`.

### Добавлено

- **Гранулярность лорбуков** — все книги или только отмеченные; маркеры `img` / `keep` в записях перекрывают выбор; неатрибутированный текст всегда остаётся текстом.
- **Режимы «хвоста текстом»** — по количеству сообщений (`Messages`) или по токен-бюджету (`Tokens`).
- **Аудит полезной нагрузки и диагностика** — счётчики вложений, карта порядка вложений (позиция → страница → диапазон сообщений), сверка сборки промпта с отправкой, ограниченный лог в памяти с экспортом JSON/в буфер. Лог не содержит текста чата, URL и base64.
- **Просмотрщик страниц с зумом и экспортом** — попап по сообщению показывает ровно то, что ушло: зум кнопками ＋/－/⟲, Ctrl+колесо (обычное колесо скроллит), пинч и перетаскивание пальцем на тач-экранах, двойной клик — сброс; скачка каждой страницы в **PNG/JPG** и всего набора **одним многостраничным PDF**.
- **Уведомления** — тост об успешной конвертации на каждом запросе (свайпы тоже, отключается); предупреждения о выключенных картинках у модели и о неотмеченном активном лорбуке.
- **Группировка картинок настроек** — слить выбранные промпты в меньше страниц или держать каждый на своём месте.
- **Двуязычный интерфейс** — русский и английский.
- **Отдельный конвертер лорбуков** — `tools/convert-lorebooks.mjs` переводит старые форматы (`entries` массивом, NovelAI) в нативный вид с бэкапами; `--check` только показывает.
- **Набор тестов** — 145 Node-тестов чистых модулей.

### Изменено

- `loading_order` 90 → 1000: хук промпта исполняется после хуков других расширений.
- Для не-Gemini моделей: настраиваемая оценка токенов на страницу вместо фиксированной.

### Сохранено из оригинала

- Идеи конвейера рендера и формата страниц, маркер `keep`, уровни качества Gemini, байтовый бюджет, лицензия AGPL-3.0 и авторы шрифтов.
