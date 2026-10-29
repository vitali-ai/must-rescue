import { createClient, exportProfile, makeFiles, makeZip } from './core.mjs';

const $ = id => document.getElementById(id);
const translated = [...document.querySelectorAll('[data-i18n]')];
const ru = Object.fromEntries(translated.map(node => [node.dataset.i18n, node.textContent]));
ru.headline = 'Фильмы меняют нас.\nСохраните свои.';
const en = {
  transferLabel: 'YOUR COLLECTION MOVES WITH YOU', transferFilms: 'Watched films and personal ratings', transferWatchlist: 'Your want-to-watch list', transferBackup: 'Plus a backup to keep', star: '☆ Star on GitHub',
  eyebrow: 'Your collection. Yours to keep.', headline: 'Films stay with us.\nYour collection should, too.',
  intro: 'Take your Must collection with you: films, ratings and TV shows. Get a personal backup and ready-to-import Letterboxd files.',
  tag1: 'No password', tag2: 'No installation', tag3: 'Open source', local: 'Your data stays in your browser',
  exportTitle: 'Which collection are we saving?', inputLabel: 'Must profile link or username', exportButton: 'Get my files',
  inputHelp: 'Your profile must be public. No password or sign-in codes needed.',
  seasons: 'Include TV seasons and their ratings — this takes a little longer', cancel: 'Cancel',
  patience: 'A large collection can take a few minutes. Keep this tab open.', notReady: 'Want to see how it works first?', demo: 'Try an example →',
  readyLabel: '02 / YOUR COLLECTION', readyTitle: 'Your collection, ready to keep.',
  demoNotice: 'These are fictional example records. To export your own collection, paste your profile link above.',
  backupTitle: 'Everything, backed up', backupText: 'Original data, TV shows, seasons and a verification report. Keep this somewhere safe.',
  downloadZip: 'Download ZIP', watchedTitle: 'Watched', wantTitle: 'Watchlist', downloadCsv: 'Download CSV ↓',
  watchedText: 'Films and personal ratings. Upload using the main Letterboxd importer.',
  wantText: 'Upload from Watchlist → Import films to watchlist. Keep this separate from watched films.',
  importNoteTitle: 'Two files. Two different import paths.',
  importNote: 'The main Letterboxd importer marks films as watched. Import your watchlist only from the Watchlist section. Check the title and year matches before confirming.', importDocs: 'Letterboxd import guide ↗',
  howLabel: 'A SIMPLE PLAN', howTitle: 'Your collection moves with you.',
  how1Title: 'Copy your profile link', how1Text: 'Open your Must profile and share its link. If it is private, make it public temporarily for the export.',
  how2Title: 'Keep a copy', how2Text: 'We request your data from Must, check the records and assemble the files in your browser. Your collection is not uploaded to our server.',
  how3Title: 'Make yourself at home', how3Text: 'Import films and your watchlist separately into Letterboxd. TV shows and seasons remain in your backup.',
  faqTitle: 'A few things worth knowing', q1: 'What happens to my ratings and dates?',
  a1: 'Personal movie ratings are saved out of ten; Letterboxd converts them to stars. Must provides a last-modified date, not a reliable viewing date, so we do not create diary entries using these dates. Available reviews are also preserved.',
  q2: 'Why might the counts be different?', a2: 'Must can put movies and TV shows in the same list. Letterboxd CSVs include movies only. Shows are retained separately in your backup. If the API omits records or the rating count differs from Must’s profile statistics, we show a warning.',
  q3: 'What if Must is not responding?', a3: 'Exporting depends on Must’s servers. If they are unavailable, try again later. Browser CORS restrictions can also block requests; the CLI on GitHub is an alternative. You can open a previously downloaded backup.json below without contacting Must.', openBackup: 'Open backup.json →',
  q4: 'Who sees my collection?', a4: 'The app reads your public Must profile directly from your device. We ask for no password, use no analytics and do not save your collection on a server or in browser storage. GitHub hosts this site, and Must receives API requests. You can make your profile private again after exporting.',
  footer: 'Made so your movie memories do not get lost.', source: 'Open source · MIT ↗', unofficial: 'Independent project. Not affiliated with Must or Letterboxd.'
};
let language = navigator.language.startsWith('ru') ? 'ru' : 'en';
let current = null, controller = null, isDemo = false, currentError = null;
function say(russian, english) { return language === 'ru' ? russian : english; }

function paint() {
  for (const node of translated) node.textContent = (language === 'ru' ? ru : en)[node.dataset.i18n] ?? ru[node.dataset.i18n];
  document.documentElement.lang = language;
  $('language').textContent = language === 'ru' ? 'English' : 'Русский';
  if (current) paintResults();
  if (currentError) showError(currentError);
}
function warningText(backup) {
  const lines = [];
  for (const warning of backup.warnings ?? []) {
    if (warning === 'RATING_COUNT_MISMATCH') lines.push(say(`Число оценок расходится: API вернул ${backup.verification.ratings.exported}, статистика профиля — ${backup.verification.ratings.profile_aggregate}. Отсутствующие оценки не заменялись.`, `Rating counts differ: ${backup.verification.ratings.exported} exported, ${backup.verification.ratings.profile_aggregate} in the profile statistics. Missing ratings were not invented.`));
    else if (warning.startsWith('SEASONS_UNAVAILABLE')) lines.push(say('Сезоны удалось сохранить не полностью. Фильмы доступны; подробности — в отчёте ZIP.', 'Season export is incomplete. Movie files are available; see the report in the ZIP.'));
    else if (warning.startsWith('INCOMPLETE')) lines.push(say('Must вернул не все ожидаемые данные. Проверьте verification.json в архиве: выгрузка может быть неполной.', 'Must did not return all expected records. This export may be incomplete; check verification.json in the ZIP.'));
    else lines.push(warning);
  }
  return [...new Set(lines)].join('\n');
}
function paintResults() {
  const { counts, backup } = current;
  $('result-user').textContent = `@${backup.profile.uri}`;
  for (const [key, count] of [['watchedTitle', counts.watched], ['wantTitle', counts.want]]) {
    const heading = document.querySelector(`[data-i18n="${key}"]`);
    heading.textContent = (language === 'ru' ? ru : en)[key].trim() + ' ';
    const span = document.createElement('span'); span.textContent = String(count); heading.append(span);
  }
  $('result-detail').textContent = say(`В резервной копии также: ${counts.shows} сериалов, ${counts.seasons} сезонов.`, `Also in your backup: ${counts.shows} TV shows, ${counts.seasons} seasons.`);
  $('warnings').textContent = warningText(backup);
  $('warnings').hidden = !$('warnings').textContent;
  $('demo-notice').hidden = !isDemo;
}
function showResults(backup, demo = false) {
  const generated = makeFiles(backup);
  current = { ...generated, backup }; isDemo = demo;
  $('results').hidden = false;
  paintResults();
  $('results').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
}
function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function showError(error) {
  currentError = error;
  let text;
  if (error.name === 'AbortError') text = say('Выгрузка отменена. Можно начать заново.', 'Export cancelled. You can start again.');
  else if (error.message === 'INVALID_USERNAME') text = say('Вставьте ник или ссылку вида https://mustapp.com/@nickname.', 'Enter a username or a link like https://mustapp.com/@nickname.');
  else if (['PRIVATE_OR_MISSING_PROFILE', 'MUST_API_ERROR', 'MUST_HTTP_404'].includes(error.message)) text = say('Профиль не найден или закрыт. Проверьте ник и публичность профиля в Must.', 'Profile not found or private. Check the username and profile visibility in Must.');
  else if (/^MUST_HTTP_5/.test(error.message)) text = say('Сервер Must сейчас недоступен. Повторите позже: сайт не может восстановить данные, пока Must не отвечает.', 'Must’s server is currently unavailable. Try again later: we cannot retrieve data while Must is offline.');
  else if (error.message === 'MUST_HTTP_429') text = say('Must временно ограничил запросы. Подождите немного и повторите.', 'Must is rate-limiting requests. Wait a little and try again.');
  else if (error.message === 'INVALID_BACKUP') text = say('Нужен файл backup.json, созданный Must Rescue. Выберите его внутри скачанного ZIP.', 'Choose the backup.json created by Must Rescue, inside your downloaded ZIP.');
  else text = say('Не удалось получить данные. Возможные причины: сбой Must, ограничение CORS или соединения. Повторите позже либо используйте CLI из репозитория. Пароль не нужен.', 'Could not retrieve data. Must may be offline, or CORS/network restrictions may be blocking access. Try later or use the CLI in the repository. No password is needed.');
  $('error').textContent = text; $('error').hidden = false;
}
function progress({ phase, done, total }) {
  const phases = language === 'ru' ? { profile: 'Проверяем профиль', want: 'Сохраняем Want', watched: 'Сохраняем просмотренные', shows: 'Сохраняем сериалы', youtube: 'Сохраняем видео', 'show-details': 'Проверяем сезоны', seasons: 'Сохраняем оценки сезонов' } : { profile: 'Checking profile', want: 'Saving watchlist', watched: 'Saving watched films', shows: 'Saving shows', youtube: 'Saving videos', 'show-details': 'Checking seasons', seasons: 'Saving season ratings' };
  $('status-text').textContent = `${phases[phase] ?? phase}${phase === 'profile' ? '…' : ` · ${done} / ${total}`}`;
  if (phase === 'profile') $('progress').removeAttribute('value');
  else { $('progress').max = Math.max(1, total); $('progress').value = done; }
}
$('export-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (controller) return;
  controller = new AbortController();
  currentError = null; $('error').hidden = true; $('status').hidden = false; $('submit').disabled = true;
  $('demo').disabled = true; $('backup-file').disabled = true; $('results').hidden = true; current = null;
  try {
    const request = createClient({ signal: controller.signal, onRetry: () => { $('status-text').textContent = say('Must не ответил. Повторяем запрос…', 'Must did not respond. Retrying…'); } });
    const backup = await exportProfile($('profile').value, { request, includeSeasons: $('seasons').checked, onProgress: progress });
    showResults(backup);
  } catch (error) { showError(error); }
  finally { controller = null; $('status').hidden = true; $('submit').disabled = false; $('demo').disabled = false; $('backup-file').disabled = false; }
});
$('cancel').addEventListener('click', () => controller?.abort());
$('language').addEventListener('click', () => { language = language === 'ru' ? 'en' : 'ru'; paint(); });
$('download-all').addEventListener('click', () => {
  if (!current) return;
  try { const name = current.backup.profile.uri.replace(/[^a-zA-Z0-9_.-]/g, '_'); download(makeZip(current.files), `must-rescue-${name}${isDemo ? '-example' : ''}.zip`, 'application/zip'); }
  catch (error) { showError(error); }
});
for (const [button, file] of [['download-watched', 'letterboxd_watched.csv'], ['download-want', 'letterboxd_watchlist.csv']]) {
  $(button).addEventListener('click', () => { if (current) download(current.files[file], (isDemo ? 'example_' : '') + file, 'text/csv;charset=utf-8'); });
}
$('backup-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  currentError = null; $('error').hidden = true;
  try {
    if (file.size > 50 * 1024 * 1024) throw new Error('INVALID_BACKUP');
    const backup = JSON.parse(await file.text());
    if (backup.format !== 'must-rescue-v1') throw new Error('INVALID_BACKUP');
    showResults(backup);
  } catch { showError(new Error('INVALID_BACKUP')); }
  event.target.value = '';
});
$('demo').addEventListener('click', () => {
  const record = (id, title, year, status, rate, type = 'movie') => ({ product: { id, title, release_date: `${year}-01-01`, type }, user_product_info: { product_id: id, status, rate } });
  const backup = { format: 'must-rescue-v1', exported_at: new Date().toISOString(), profile: { uri: 'example', lists: { watched: [1, 2], want: [3] } }, data: { watched: [record(1, 'The Imaginary Cinema', '2001', 'watched', 9), record(2, 'A Film That Never Was', '2010', 'watched', 8)], want: [record(3, 'Tomorrow at the Movies', '2025', 'want', null)], shows: [], youtube: [] }, seasons: [], showStats: [], verification: {}, warnings: [] };
  currentError = null; $('error').hidden = true; showResults(backup, true);
});
paint();
