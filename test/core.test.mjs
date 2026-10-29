import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeUsername, csv, checkIDs, createClient, exportProfile, makeFiles, makeZip } from '../docs/core.mjs';

const record = (id, type, title, status, rate = null) => ({ product: { id, type, title, release_date: '2001-04-02', items_count: type === 'movie' ? 0 : 8 }, user_product_info: { product_id: id, status, rate, modified_at: '2026-01-01T12:00:00Z', review: null } });
const watched = record(1, 'movie', 'A "Film", with commas\nand a newline', 'watched', 9);
watched.user_product_info.review = { body: 'A review with "quotes", and commas.' };
const wanted = record(2, 'movie', 'Tomorrow', 'want');
const show = record(3, 'show', 'An Example Series', 'want');
const season = record(4, 'season', 'Season 1', 'watched', 8);
const source = { id: 42, uri: 'example', name: 'Example', is_private: false, lists: { watched: [1], want: [2, 3], shows: [], youtube: [] }, rates_statistics: { rates_count: 2 }, followers: [999], phone_md5: 'do-not-export' };
function api({ omit = false, unavailableSeasons = false } = {}) {
  return async (path, body) => {
    if (path === '/users/uri/example') return structuredClone(source);
    if (path.endsWith('/shows/watched_stats')) return [{ product_id: 3, last_season_rate: 8, watched_seasons: [4] }];
    if (path === '/products/3') { if (unavailableSeasons) throw new Error('MUST_HTTP_522'); return { id: 3, show: { seasons: [{ season_id: 4, episodes: [5] }] } }; }
    if (path.includes('/products?')) return body.ids.filter(id => !(omit && id === 2)).map(id => structuredClone([watched, wanted, show, season].find(item => item.product.id === id)));
    throw new Error('Unexpected test API path: ' + path);
  };
}

test('profile parsing accepts only Must links or safe usernames', () => {
  for (const value of ['example', '@example', ' https://mustapp.com/@example ', 'https://mustapp.com/@example/want']) assert.equal(normalizeUsername(value), 'example');
  for (const value of ['https://evil.example/@example', 'https://mustapp.com.evil/@example', 'https://mustapp.com:8080/@example', '../example', 'https://mustapp.com/@a/../../../x', '', 'a b']) assert.throws(() => normalizeUsername(value));
});
test('CSV preserves quotes, commas, unicode and multiline reviews', () => {
  assert.equal(csv([['Title', 'Review'], ['Фильм, "А"', 'one\ntwo']]), 'Title,Review\r\n"Фильм, ""А""","one\ntwo"\r\n');
});
test('backup exports all list IDs, separates TV, preserves ratings and excludes modification dates from Letterboxd', async () => {
  const backup = await exportProfile('example', { request: api() });
  assert.deepEqual(backup.warnings, []);
  assert.equal(backup.seasons.length, 1);
  assert.equal(backup.profile.followers, undefined);
  assert.equal(backup.profile.phone_md5, undefined);
  const { files, counts } = makeFiles(backup);
  assert.deepEqual(counts, { watched: 1, want: 1, shows: 1, seasons: 1 });
  assert.ok(files['letterboxd_watched.csv'].includes(',9,'));
  assert.ok(files['letterboxd_watched.csv'].includes('A review with ""quotes"", and commas.'));
  assert.ok(!files['letterboxd_watched.csv'].includes('2026-01-01'));
  assert.ok(!files['letterboxd_watchlist.csv'].includes('An Example Series'));
  assert.ok(!files['letterboxd_watchlist.csv'].includes('Rating10'));
  assert.ok(files['backup/want.csv'].includes('An Example Series'));
  assert.equal(JSON.parse(files['backup/backup.json']).seasons[0].user_product_info.rate, 8);
});
test('missing IDs produce a visible incomplete report and are not reported as success', async () => {
  const backup = await exportProfile('example', { request: api({ omit: true }) });
  assert.ok(backup.warnings.includes('INCOMPLETE_LIST:want'));
  assert.deepEqual(backup.verification.want.missing, [2]);
});
test('unavailable season endpoints preserve movie backup and warn', async () => {
  const backup = await exportProfile('example', { request: api({ unavailableSeasons: true }) });
  assert.equal(backup.data.watched.length, 1);
  assert.ok(backup.warnings.some(value => value.startsWith('SEASONS_UNAVAILABLE')));
  assert.ok(backup.warnings.includes('RATING_COUNT_MISMATCH'));
});
test('private profiles fail without requesting products', async () => {
  let requests = 0;
  await assert.rejects(exportProfile('example', { request: async () => { requests++; return { id: 42, is_private: true }; } }), /PRIVATE_OR_MISSING_PROFILE/);
  assert.equal(requests, 1);
});
test('empty profile produces header-only valid files', async () => {
  const backup = await exportProfile('empty', { request: async () => ({ id: 42, uri: 'empty', lists: { watched: [], want: [], shows: [] } }) });
  assert.equal(makeFiles(backup).files['letterboxd_watched.csv'], 'Title,Year,Rating10,Review\r\n');
});
test('record verification detects duplicates, missing products and unexpected IDs', () => {
  const result = checkIDs([1, 2], [watched, watched, record(7, 'movie', '', 'want')]);
  assert.deepEqual(result.missing, [2]); assert.deepEqual(result.duplicates, [1]); assert.deepEqual(result.unexpected, [7]); assert.deepEqual(result.missingProducts, [7]);
});
test('client sends no credentials, Bearer token or extra CORS headers', async () => {
  let captured;
  const request = createClient({ fetchImpl: async (url, options) => { captured = { url, options }; return new Response('[]'); } });
  await request('/products', { ids: [1] });
  assert.equal(captured.options.credentials, 'omit');
  assert.deepEqual(captured.options.headers, { 'Content-Type': 'application/json' });
  assert.equal(captured.options.body, '{"ids":[1]}');
});
test('client reports HTTP errors and respects cancellation', async () => {
  let requests = 0;
  const request = createClient({ fetchImpl: async () => { requests++; return new Response('', { status: 403 }); } });
  await assert.rejects(request('/x'), /MUST_HTTP_403/); assert.equal(requests, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createClient({ signal: controller.signal })('/x'), error => error.name === 'AbortError');
});
test('ZIP CRCs and Unicode contents pass an independent Python zipfile reader', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'must-rescue-test-'));
  try {
    const path = join(dir, 'test.zip');
    const content = { 'backup/пример.json': '{"title":"Фильм"}', 'watched.csv': csv([['Title'], ['A "film", B']]) };
    await writeFile(path, makeZip(content));
    const result = spawnSync('python3', ['-c', 'import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({n:z.read(n).decode() for n in z.namelist()},ensure_ascii=False))', path], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), content);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
