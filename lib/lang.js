// Bilingual UI strings for Microfiche.
//
// Every user-facing string is written in English at the call site and passed
// through tr(). The mode decides what comes back:
//
//   'auto' (default) — follow the SillyTavern UI language via the detector
//                      (host i18n getCurrentLocale); Russian locale → Russian.
//   'ru' / 'en'      — forced choice, for someone on an English tavern who
//                      still wants these settings in Russian (or vice versa).
//
// Keys are the English source strings themselves, so an untranslated key
// degrades to readable English instead of a bare id. The module is pure and
// DOM-free; applying the translations to the settings DOM lives in index.js.

export const RU = Object.freeze({
    // Settings panel (settings.html)
    'On': 'Включено',
    'Show tokens saved under each reply': 'Показывать сэкономленные токены под ответами',
    'Send as images': 'Отправлять картинками',
    'Chat history': 'История чата',
    'Preset': 'Пресет',
    'Character card': 'Карточка персонажа',
    'Persona': 'Персона',
    'Lorebook': 'Лорбук',
    'Lorebook pages': 'Лорбук картинками',
    'All lorebooks': 'Все лорбуки',
    'Selected books only': 'Только выбранные',
    'Which lorebook entries go as images': 'Какие записи лорбука уходят картинками',
    'Lorebooks to send as images': 'Лорбуки для отправки картинками',
    'No lorebooks are active in this chat.': 'В этом чате нет активных лорбуков.',
    'Inside an entry: the img marker sends it as an image, the keep marker keeps it as text.': 'Внутри записи: маркер img отправляет её картинкой, маркер keep оставляет текстом.',
    'Preview': 'Предпросмотр',
    'See every image attached to your next request': 'Посмотреть все картинки, которые уйдут со следующим запросом',
    'Advanced': 'Дополнительно',
    'Picture quality': 'Качество картинок',
    'Low: up to 20× cheaper than text (OpenRouter only)': 'Низкое: до 20× дешевле текста (только OpenRouter)',
    'Medium: up to 9.9× cheaper than text': 'Среднее: до 9,9× дешевле текста',
    'High: up to 4.95× cheaper than text': 'Высокое: до 4,95× дешевле текста',
    'Lower is cheaper but gets more wrong. Medium is the sweet spot. High gets more details right. On AI Studio and Vertex, Low goes as Medium.': 'Ниже — дешевле, но больше ошибок чтения. Среднее — золотая середина. Высокое точнее в деталях. На AI Studio и Vertex низкое отправляется как среднее.',
    'Other models use PNG images. The quality settings and savings above apply to Gemini.': 'Другие модели отправляются PNG. Настройки качества и экономия выше относятся к Gemini.',
    'Keep newest as text': 'Оставлять новые сообщения текстом',
    'Tokens': 'Токены',
    'Messages': 'Сообщения',
    'Keep newest measured in tokens or messages': 'Измерять хвост в токенах или сообщениях',
    'Number of newest messages to keep as text': 'Сколько последних сообщений оставить текстом',
    'The newest N messages go as normal text; everything older than them goes as images. Raise it to keep recent wording sharper.': 'Последние N сообщений уходят обычным текстом, всё старше — картинками. Больше — свежие формулировки точнее.',
    'The newest message always goes as normal text, plus older ones up to this many tokens. Lower saves a bit more. Higher keeps exact wording sharper.': 'Последнее сообщение всегда остаётся текстом, плюс старые — до этого количества токенов. Меньше — экономнее, больше — свежие формулировки точнее.',
    'Pack preset, card, persona and lorebook tightly': 'Упаковывать пресет, карточку, персону и лорбук плотнее',
    'Off keeps their line breaks, on more images.': 'Выключено сохраняет их переносы строк, включено уходит в меньшее число картинок.',
    'Setup image grouping': 'Группировка картинок',
    'How preset prompts are grouped into images': 'Как промпты пресета собираются в картинки',
    'Merge into fewer images': 'Собирать в меньше картинок',
    'Keep each prompt in place': 'Оставлять каждый промпт на месте',
    'Merging packs the ticked prompts into as few images as possible. Keeping each prompt in place draws one group per prompt, so World Info (before) and (after) stay where the preset puts them; it costs a few partly filled pages.': '«Собирать» упаковывает отмеченные промпты в минимум картинок. «Оставлять на месте» рисует свою группу для каждого промпта, поэтому World Info (before) и (after) остаются там, где их ставит пресет; за это платишь несколькими неполными страницами.',
    'Keep a prompt as text': 'Оставить промпт текстом',
    'Copy': 'Копировать',
    'Put': 'Вставь',
    'anywhere in that prompt.': 'в любое место этого промпта.',
    'With Squash system messages on, the entire merged block stays as text.': 'Со включённым Squash system messages весь объединённый блок останется текстом.',
    'Models': 'Модели',
    'Gemini models on your current connection. Untick one to send it plain text.': 'Модели Gemini текущего подключения. Сними галочку, чтобы отправлять модель обычным текстом.',
    'No Gemini models on this connection.': 'В этом подключении нет моделей Gemini.',
    ' tested': ' проверена',
    'Other models (experimental)': 'Другие модели (экспериментально)',
    'Enable for': 'Включить для',
    'No model selected': 'Модель не выбрана',
    'another model (select one first)': 'другая модель (сначала выбери её)',
    'Select Claude, GPT or another vision model in your connection settings, then enable it here.': 'Выбери Claude, GPT или другую vision-модель в настройках подключения, затем включи её здесь.',
    'Estimated tokens per image': 'Оценка токенов на картинку',
    'Starts at 1,500 as a placeholder. Set this for your model; it controls estimates and whether images save enough tokens.': 'Стартовое значение 1500 — заглушка. Задай своё для модели; от него зависят оценки и то, считается ли экономия достаточной.',
    'Show “sent as images” notifications': 'Показывать уведомления «отправлено картинками»',
    'Diagnostics': 'Диагностика',
    'Keeps a short log of what Microfiche decided. Export it when reporting a problem — it never contains your chat text.': 'Короткий журнал решений Microfiche. Экспортируй его при обращении за помощью — текста чата там нет.',
    'Download the diagnostics log as a JSON file': 'Скачать журнал диагностики в JSON-файл',
    'Export log': 'Экспорт',
    'Copy the diagnostics log to the clipboard': 'Скопировать журнал диагностики в буфер обмена',
    'Discard the buffered diagnostics': 'Стереть буферизованную диагностику',
    'Clear': 'Очистить',
    'No request audited yet.': 'Запросы ещё не проверялись.',
    'Language': 'Язык',
    'Follow SillyTavern': 'Как в SillyTavern',
    'Russian': 'Русский',
    'English': 'English',
    'Extension language': 'Язык расширения',
    'Copy prompt exemption marker': 'Скопировать маркер исключения',
    'Squash system messages keeps the whole merged block as text': 'Squash system messages сохраняет весь объединённый блок текстом',
    'Attachment order of the last audited request': 'Порядок вложений последнего проверенного запроса',

    // Payload audit status and order table
    '{stage}: {att} attachments, {chars} text characters. {arch} archived texts found, {amb} inconclusive. {miss} expected attachments missing. Keep: {keep}.': '{stage}: вложений {att}, текста {chars} символов. Архивных текстов найдено: {arch}, неоднозначных: {amb}. Не достаёт вложений: {miss}. Хвост: {keep}.',
    'and': 'и',
    'setup': 'настройки',
    'Click to see the full page': 'Нажми, чтобы увидеть страницу целиком',
    'Download PNG': 'Скачать PNG',
    'Download JPG': 'Скачать JPG',
    'Download PDF': 'Скачать PDF',
    'All pages as one PDF': 'Все страницы одним PDF',
    'Zoom in': 'Приблизить',
    'Zoom out': 'Отдалить',
    'Reset zoom': 'Сбросить зум',
    'Pictures are off for model {m} — the request went as plain text. Enable the model in Microfiche settings (model list or Other models) if it supports images.': 'Для модели {m} картинки выключены — запрос ушёл обычным текстом. Включи модель в настройках Microfiche (список моделей или Other models), если она поддерживает картинки.',
    'Lorebook {name} is active but unticked — its entries went as text. Tick the book under Lorebook pages to send it as images.': 'Лорбук {name} активен, но не отмечен — его записи ушли текстом. Отметь книгу в разделе Lorebook pages, чтобы отправлять её картинками.',
    'Before sending to SillyTavern': 'Перед отправкой в SillyTavern',
    'After prompt replacement': 'После подстановки картинок',
    'attachments': 'вложений',
    'of text': 'текста',
    'text characters': 'символов текста',
    'archived texts found in the request': 'архивных текстов найдено',
    'inconclusive': 'неоднозначных',
    'expected attachments missing': 'не достаёт вложений',
    'Keep:': 'Хвост:',
    'msg': 'сообщ.',
    'tokens': 'токенов',
    'untracked': 'не отслежено',
    'setup page': 'инструкции, стр.',
    'chat page': 'история, стр.',
    'messages': 'сообщения',
    'planner': 'план',
    '#msg': '#сообщ',
    '#part': '#часть',
    'Kind': 'Тип',
    'Source': 'Источник',

    // Notices
    'Archived history was found in the request as both text and images — another extension is putting it back. Make Microfiche load last among extensions or disable the one interfering.': 'Архивная история найдена в запросе и текстом, и картинками — какое-то другое расширение возвращает её. Поставь Microfiche последним в порядке расширений или отключи виновника.',
    'The attachment order or set changed between prompt assembly and sending — another extension seems to interfere with the request.': 'Порядок или состав вложений изменился между сборкой промпта и отправкой — похоже, другое расширение вмешивается в запрос.',
    'The marker with the images was cut from the request: the context limit or another extension. The images did not go out.': 'Метку с картинками вырезало из запроса: лимит контекста или другое расширение. Картинки не ушли.',
    'The images were cut from the request by the context limit or another extension.': 'Картинки вырезаны из запроса лимитом контекста или другим расширением.',

    // Notifications
    'Older pages did not fit the image size limit, so the {n} oldest pages were left out; their messages stay as text.': 'Старые страницы не влезли в лимит размера картинок: {n} самых старых пропущено, их сообщения остались текстом.',
    'Couldn’t make the images, so this message went as normal text. Details in the browser console.': 'Не удалось сделать картинки, это сообщение ушло обычным текстом. Подробности в консоли браузера.',
    'Couldn’t attach the images, so their text went instead. Details in the browser console.': 'Не удалось прикрепить картинки, вместо них ушёл их текст. Подробности в консоли браузера.',

    // Planner stop reasons
    'a tool call': 'вызов инструмента',
    'an attached image or file': 'прикреплённая картинка или файл',

    // Setup build reasons
    'no identifiable setup blocks in the prompt': 'не удалось опознать блоки настроек в промпте',
    'too much of it is in letters the font lacks': 'слишком много букв, которых нет в шрифте',
    'too short to save anything': 'слишком коротко, экономии не будет',
    'the image size limit would be exceeded': 'превышался бы лимит размера картинок',
    'marked to stay as text': 'помечено оставаться текстом',
    'none of the ticked parts are in this prompt': 'отмеченные блоки в этом промпте не найдены',
    'couldn’t build the prompt': 'не удалось собрать промпт',

    // Status line
    'Latest reply: ~{n} {dir} input tokens.': 'Последний ответ: ~{n} {dir} входных токенов.',
    'fewer': 'меньше',
    'more': 'больше',
    'Ready.': 'Готово.',
    'Next-request estimates are in Preview.': 'Оценки следующего запроса — в Предпросмотре.',
    'Off.': 'Выключено.',
    'Not running: needs Chat Completion.': 'Не работает: нужен Chat Completion.',
    'Not running: this model is unticked.': 'Не работает: модель не отмечена.',
    '{model} is unticked under Advanced → Models.': '{model} не отмечена в Дополнительно → Модели.',
    'Not running: this model needs opt-in.': 'Не работает: модели нужно явное включение.',
    'Enable {model} under Advanced → Other models (experimental). It must accept image input.': 'Включи {model} в Дополнительно → Другие модели (экспериментально). Модель должна принимать картинки.',
    'Open a chat.': 'Открой чат.',
    'Chat history goes as normal text.': 'История чата уходит обычным текстом.',
    'Nothing ticked under Send as images.': 'В «Отправлять картинками» ничего не отмечено.',
    'Not running in this chat.': 'В этом чате не работает.',
    'The first message has {reason}, so nothing goes as images.': 'У первого сообщения {reason}, поэтому картинками ничего не уходит.',
    'Your newest {n} messages stay as text.': 'Последние {n} сообщений остаются текстом.',
    'Your newest {n} stays as text.': 'Последние {n} токенов остаются текстом.',
    'Older messages stay as text until an image saves tokens (about {cost} tokens per image). They’re at {older} now. ': 'Старые сообщения остаются текстом, пока картинка не начнёт экономить токены (около {cost} токенов за картинку). Сейчас их {older} токенов. ',
    'Older messages go as {n} images: {image} tokens instead of {text}.': 'Старые сообщения уходят {n} картинками: {image} токенов вместо {text}.',
    ' Images stop before message #{id} ({reason}).': ' Картинки обрываются перед сообщением #{id} ({reason}).',
    'This model': 'Эта модель',

    // Preview popup
    'Latest reply:': 'Последний ответ:',
    'Connection:': 'Подключение:',
    'on': 'на',
    'low quality images (about 280 tokens each).': 'картинки низкого качества (около 280 токенов каждая).',
    'medium quality images (about 560 tokens each).': 'картинки среднего качества (около 560 токенов каждая).',
    'high quality images (about 1120 tokens each).': 'картинки высокого качества (около 1120 токенов каждая).',
    'experimental PNG images, using your estimate of {n} tokens each. Recall and billing are untested.': 'экспериментальные PNG, токены считаются по твоей оценке: {n} за картинку. Чтение и биллинг не проверены.',
    '{kinds}: {text} text tokens → {image} image tokens.': '{kinds}: {text} токенов текста → {image} токенов картинок.',
    'Setup stays as text': 'Инструкции остаются текстом',
    'Chat: {text} text tokens → {image} image tokens.': 'История: {text} токенов текста → {image} токенов картинок.',
    'Chat stays as text for now': 'История пока остаётся текстом',
    'Next message: about <b>{n} {dir} input tokens</b>.': 'Следующее сообщение: примерно на <b>{n} {dir} входных токенов</b>.',
    'Next message:': 'Следующее сообщение:',
    'Blank space is hidden in these thumbnails. Click an image to see the full page. An exempt prompt keeps the image groups on either side separate, preserving prompt order.': 'Пустое место в миниатюрах скрыто; клик открывает страницу целиком. Промпт с маркером keep разбивает группы картинок, сохраняя порядок промпта.',
    'Details': 'Подробности',
    'Nothing goes as images with your next message.': 'С твоим следующим сообщением картинками ничего не уходит.',
    'Microfiche preview': 'Предпросмотр Microfiche',
    'Setup · {n} images': 'Инструкции · картинок: {n}',
    'Chat · {n} images': 'История · картинок: {n}',
    'Image {i} of {n} · click to see the full page': 'Картинка {i} из {n} · нажми, чтобы увидеть целиком',
    'Image {i} of {n}: messages #{a} to #{b}': 'Картинка {i} из {n}: сообщения #{a}–#{b}',

    // Per-message page view
    'Image {i} of {n}, this message highlighted': 'Картинка {i} из {n}, это сообщение выделено',
    'Chat layout preview only. This message currently stays as text; these preview pages are not attached to a request.': 'Только предпросмотр раскладки чата. Это сообщение сейчас уходит текстом; эти страницы к запросу не прикрепляются.',
    'Exactly what was attached to your last request.': 'Ровно то, что было прикреплено к последнему запросу.',
    'Preview for your next message, using the chat as it is now.': 'Предпросмотр следующего сообщения по текущему чату.',
    'No image for this message yet. Microfiche keeps recent messages as text; Advanced sets how much stays as text.': 'Для этого сообщения картинки ещё нет. Microfiche оставляет свежие сообщения текстом; сколько именно — в Дополнительных настройках.',

    // Keep marker html
    '{kind} · ~{n} tokens — ': '{kind} · ~{n} токенов — ',
    'Kept as text by the keep marker (~{n} tokens):': 'Оставлено текстом маркером keep (~{n} токенов):',
    'Keep markers found, but they only apply once the matching box under Send as images is ticked:': 'Найдены маркеры keep, но они действуют, только когда отмечен соответствующий пункт в «Отправлять картинками»:',

    // Buttons, badges, command
    'Preview this message as an image': 'Предпросмотр сообщения картинкой',
    'About {n} {dir} tokens on this reply.': 'На этом ответе примерно {n} {dir} токенов.',
    'tokens saved': 'токенов сэкономлено',
    'extra tokens': 'токенов сверх нормы',
    'Shows what Microfiche does in this chat. <code>/microfiche on</code> or <code>/microfiche off</code> switches it.': 'Показывает состояние Microfiche в этом чате. <code>/microfiche on</code> или <code>/microfiche off</code> включает и выключает его.',
    'on, off, or nothing to show the status': 'on, off или пусто — показать статус',

    // Bind settings toasts
    'Paste it anywhere in the prompt you want to keep as text.': 'Вставь его в любое место промпта, который хочешь оставить текстом.',
    'Marker copied': 'Маркер скопирован',
    'Copy this into your prompt:': 'Скопируй это в свой промпт:',
    'Nothing logged yet.': 'Журнал пуст.',
    '{n} events buffered · {w} warnings · {e} errors': 'Событий в буфере: {n} · предупреждений: {w} · ошибок: {e}',
    'Diagnostics saved. Attach the file when reporting the problem.': 'Диагностика сохранена. Приложи файл к отчёту о проблеме.',
    'Could not save the diagnostics file. Details in the browser console.': 'Не удалось сохранить файл диагностики. Подробности в консоли браузера.',
    'Diagnostics copied to the clipboard.': 'Диагностика скопирована в буфер обмена.',
    'Copy this into your report:': 'Скопируй это в отчёт:',
    'Diagnostics cleared.': 'Диагностика очищена.',

    // Savings (lib/savings.js)
    'Estimated input reduction: {saved} tokens ({text} as text → {image} as images). Excludes request overhead and cache discounts.': 'Ожидаемая экономия входа: {saved} токенов ({text} текстом → {image} картинками). Без служебных данных запроса и скидок кэша.',
    ' Experimental model: image tokens use your configured estimate, not measured billing.': ' Экспериментальная модель: токены картинок считаются по твоей оценке, а не по фактическому биллингу.',
});

let mode = 'auto';
let detect = () => 'en';

/** Sets the language mode: 'auto', 'ru' or 'en'. Anything else falls back to auto. */
export function setLanguageMode(value) {
    mode = value === 'ru' || value === 'en' ? value : 'auto';
}

export function getLanguageMode() {
    return mode;
}

/**
 * Overrides how 'auto' detects the tavern language. In the extension this is
 * the host i18n `getCurrentLocale()`; tests substitute their own.
 */
export function setDetector(fn) {
    detect = typeof fn === 'function' ? fn : () => 'en';
}

/** The effective language after applying the mode ('ru' or 'en'). */
export function currentLanguage() {
    if (mode !== 'auto') return mode;
    return String(detect() ?? '').toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

/**
 * Translates one UI string. The key is the English source; an unknown key
 * degrades to readable English instead of a bare id. `{placeholders}` are
 * replaced from the params object by the caller via `.replace`.
 * @param {string} key English source string.
 * @returns {string}
 */
export function tr(key) {
    if (currentLanguage() !== 'ru') return key;
    return RU[key] ?? key;
}

/**
 * Applies translations to a rendered settings DOM subtree: `data-i18n` sets
 * the text, `data-i18n-title` the title and `data-i18n-aria` the aria-label.
 * Re-run it after the mode changes or the template re-renders.
 */
export function applyI18n(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = tr(el.getAttribute('data-i18n'));
    for (const el of root.querySelectorAll('[data-i18n-title]')) el.setAttribute('title', tr(el.getAttribute('data-i18n-title')));
    for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', tr(el.getAttribute('data-i18n-aria')));
}
