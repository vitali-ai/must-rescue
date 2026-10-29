import { createClient, exportProfile, makeFiles, makeZip } from './core.mjs';

const $ = id => document.getElementById(id);
let current = null, controller = null, isDemo = false;

function warningText(backup) {
  const lines = [];
  for (const warning of backup.warnings ?? []) {
    if (warning === 'RATING_COUNT_MISMATCH') lines.push(`Rating counts differ: ${backup.verification.ratings.exported} exported, ${backup.verification.ratings.profile_aggregate} in the profile statistics. Missing ratings were not invented.`);
    else if (warning.startsWith('SEASONS_UNAVAILABLE')) lines.push('Season export is incomplete. Movie files are available; see the report in the ZIP.');
    else if (warning.startsWith('INCOMPLETE')) lines.push('Must did not return all expected records. This export may be incomplete; check verification.json in the ZIP.');
    else lines.push(warning);
  }
  return [...new Set(lines)].join('\n');
}
function paintResults() {
  const { counts, backup } = current;
  $('result-user').textContent = `@${backup.profile.uri}`;
  for (const [id, label, count] of [['watched-title', 'Watched', counts.watched], ['want-title', 'Watchlist', counts.want]]) {
    const heading = $(id);
    heading.textContent = label + ' ';
    const span = document.createElement('span'); span.textContent = String(count); heading.append(span);
  }
  $('result-detail').textContent = `Also in your backup: ${counts.shows} TV shows, ${counts.seasons} seasons.`;
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
  let text;
  if (error.name === 'AbortError') text = 'Export cancelled. You can start again.';
  else if (error.message === 'INVALID_USERNAME') text = 'Enter a username or a link like https://mustapp.com/@nickname.';
  else if (['PRIVATE_OR_MISSING_PROFILE', 'MUST_API_ERROR', 'MUST_HTTP_404'].includes(error.message)) text = 'Profile not found or private. Check the username and profile visibility in Must.';
  else if (/^MUST_HTTP_5/.test(error.message)) text = 'Must’s server is currently unavailable. Try again later: we cannot retrieve data while Must is offline.';
  else if (error.message === 'MUST_HTTP_429') text = 'Must is rate-limiting requests. Wait a little and try again.';
  else if (error.message === 'INVALID_BACKUP') text = 'Choose the backup.json created by Must Rescue, inside your downloaded ZIP.';
  else text = 'Could not retrieve data. Must may be offline, or CORS/network restrictions may be blocking access. Try later or use the CLI in the repository. No password is needed.';
  $('error').textContent = text; $('error').hidden = false;
}
function progress({ phase, done, total }) {
  const phases = { profile: 'Checking profile', want: 'Saving watchlist', watched: 'Saving watched films', shows: 'Saving shows', youtube: 'Saving videos', 'show-details': 'Checking seasons', seasons: 'Saving season ratings' };
  $('status-text').textContent = `${phases[phase] ?? phase}${phase === 'profile' ? '…' : ` · ${done} / ${total}`}`;
  if (phase === 'profile') $('progress').removeAttribute('value');
  else { $('progress').max = Math.max(1, total); $('progress').value = done; }
}
$('export-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (controller) return;
  controller = new AbortController();
  $('error').hidden = true; $('status').hidden = false; $('submit').disabled = true;
  $('demo').disabled = true; $('backup-file').disabled = true; $('results').hidden = true; current = null;
  try {
    const request = createClient({ signal: controller.signal, onRetry: () => { $('status-text').textContent = 'Must did not respond. Retrying…'; } });
    const backup = await exportProfile($('profile').value, { request, includeSeasons: $('seasons').checked, onProgress: progress });
    showResults(backup);
  } catch (error) { showError(error); }
  finally { controller = null; $('status').hidden = true; $('submit').disabled = false; $('demo').disabled = false; $('backup-file').disabled = false; }
});
$('cancel').addEventListener('click', () => controller?.abort());
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
  $('error').hidden = true;
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
  $('error').hidden = true; showResults(backup, true);
});
