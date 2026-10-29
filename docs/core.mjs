// Original implementation. No account credentials or third-party dependencies.
export const API = 'https://mustapp.com/api';

export function normalizeUsername(value) {
  let input = String(value ?? '').trim();
  if (/^https?:\/\//i.test(input)) {
    let url;
    try { url = new URL(input); } catch { throw new Error('INVALID_USERNAME'); }
    if (!['mustapp.com', 'www.mustapp.com'].includes(url.hostname.toLowerCase()) || url.username || url.password || url.port) throw new Error('INVALID_USERNAME');
    const match = url.pathname.match(/^\/@([^/]+)(?:\/(?:watched|want|shows))?\/?$/);
    if (!match) throw new Error('INVALID_USERNAME');
    input = decodeURIComponent(match[1]);
  } else input = input.replace(/^@/, '');
  if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(input)) throw new Error('INVALID_USERNAME');
  return input;
}

export function csv(rows) {
  return rows.map(row => row.map(value => {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(',')).join('\r\n') + '\r\n';
}

const idOf = item => item?.user_product_info?.product_id ?? item?.product?.id;
const json = value => JSON.stringify(value, null, 2) + '\n';

export function checkIDs(expected, items) {
  const actual = items.map(idOf);
  return {
    expected: expected.length, received: items.length,
    missing: expected.filter(id => !actual.includes(id)),
    unexpected: actual.filter(id => !expected.includes(id)),
    duplicates: actual.filter((id, index) => actual.indexOf(id) !== index),
    missingProducts: items.filter(item => !item?.product?.title).map(idOf)
  };
}

export async function mapLimit(items, limit, fn) {
  const result = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      result[index] = await fn(items[index], index);
    }
  }));
  return result;
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function createClient({ fetchImpl = globalThis.fetch, signal, retries = 2, onRetry = () => {} } = {}) {
  return async function request(path, body) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        const timeout = AbortSignal.timeout(30000);
        const response = await fetchImpl(API + path, {
          method: body === undefined ? 'GET' : 'POST',
          headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          credentials: 'omit', referrerPolicy: 'no-referrer',
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout
        });
        if (!response.ok) {
          const error = new Error(`MUST_HTTP_${response.status}`);
          error.permanent = response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status);
          const retryAfter = response.headers.get('Retry-After');
          error.retryMs = retryAfter ? Math.min(30000, Number(retryAfter) * 1000 || 0) : 0;
          throw error;
        }
        const value = await response.json();
        if (value?.error) {
          const error = new Error('MUST_API_ERROR');
          error.permanent = true;
          throw error;
        }
        return value;
      } catch (error) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (error.permanent || attempt === retries) throw error;
        lastError = error;
        onRetry({ attempt: attempt + 1, error: error.message });
        await wait(error.retryMs || 1000 * 2 ** attempt, signal);
      }
    }
    throw lastError;
  };
}

export async function exportProfile(username, { request = createClient(), includeSeasons = true, onProgress = () => {}, now = () => new Date().toISOString() } = {}) {
  username = normalizeUsername(username);
  const warnings = [], raw = {};
  onProgress({ phase: 'profile', done: 0, total: 1 });
  const source = await request(`/users/uri/${encodeURIComponent(username)}`);
  if (!source || source.is_private || !source.lists || !Number.isSafeInteger(source.id)) throw new Error('PRIVATE_OR_MISSING_PROFILE');
  // Export collection metadata only, not followers, account details or social graph.
  const profile = { id: source.id, uri: source.uri, name: source.name, lists: source.lists, rates_statistics: source.rates_statistics, watched_by_type: source.watched_by_type };
  const data = {}, verification = {};
  const listNames = ['want', 'watched', 'shows', 'youtube'];
  const allIDs = listNames.flatMap(name => source.lists[name] ?? []);
  if (allIDs.length > 100000 || allIDs.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('INVALID_LIST_IDS');
  let done = 0;
  const batches = async (ids, phase, endpoint) => {
    const chunks = [];
    for (let start = 0; start < ids.length; start += 50) chunks.push(ids.slice(start, start + 50));
    const responses = await mapLimit(chunks, 2, async (chunk, index) => {
      const items = await request(endpoint, { ids: chunk });
      if (!Array.isArray(items)) throw new Error('INVALID_MUST_RESPONSE');
      raw[`${phase}-${index}.json`] = items;
      done += chunk.length;
      onProgress({ phase, done, total: Math.max(allIDs.length, done) });
      return items;
    });
    return responses.flat();
  };
  const productsEndpoint = `/users/id/${profile.id}/products?embed=product,review`;
  for (const name of listNames) {
    const ids = source.lists[name] ?? [];
    if (!Array.isArray(ids)) throw new Error('INVALID_LIST_IDS');
    const items = await batches(ids, name, productsEndpoint);
    const byId = new Map(items.map(item => [idOf(item), item]));
    data[name] = ids.filter(id => byId.has(id)).map(id => byId.get(id));
    verification[name] = checkIDs(ids, items);
    if (['missing', 'unexpected', 'duplicates', 'missingProducts'].some(key => verification[name][key].length)) warnings.push(`INCOMPLETE_LIST:${name}`);
  }
  const shows = new Map(Object.values(data).flat().filter(item => item.product?.type === 'show').map(item => [idOf(item), item]));
  let showStats = [], seasons = [], seasonMetadata = [];
  if (includeSeasons && shows.size) {
    try {
      onProgress({ phase: 'show-details', done: 0, total: shows.size });
      const showIDs = [...shows.keys()], showChunks = [];
      for (let start = 0; start < showIDs.length; start += 50) showChunks.push(showIDs.slice(start, start + 50));
      showStats = (await mapLimit(showChunks, 2, async ids => {
        const result = await request(`/users/id/${profile.id}/shows/watched_stats`, { ids });
        if (!Array.isArray(result)) throw new Error('INVALID_SHOW_STATS');
        return result;
      })).flat();
      verification.showStats = checkIDs(showIDs, showStats.map(item => ({ user_product_info: { product_id: item.product_id }, product: { title: 'show-statistics' } })));
      if (['missing', 'unexpected', 'duplicates'].some(key => verification.showStats[key].length)) warnings.push('INCOMPLETE_SHOW_STATS');
      let count = 0;
      const details = await mapLimit([...shows.keys()], 2, async id => {
        const value = await request(`/products/${id}`);
        raw[`show-${id}.json`] = value;
        onProgress({ phase: 'show-details', done: ++count, total: shows.size });
        return value;
      });
      seasonMetadata = details.flatMap(detail => (detail.show?.seasons ?? []).map(season => ({ show_id: detail.id, ...season })));
      const ids = [...new Set(seasonMetadata.map(season => season.season_id))];
      seasons = await batches(ids, 'seasons', productsEndpoint);
      verification.seasons = checkIDs(ids, seasons);
      if (['missing', 'unexpected', 'duplicates', 'missingProducts'].some(key => verification.seasons[key].length)) warnings.push('INCOMPLETE_SEASONS');
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      warnings.push(`SEASONS_UNAVAILABLE:${error.message}`);
    }
  }
  const uniqueRecords = new Map([...Object.values(data).flat(), ...seasons].map(item => [idOf(item), item]));
  const rated = [...uniqueRecords.values()].filter(item => item.user_product_info?.rate != null).length;
  const aggregate = profile.rates_statistics?.rates_count ?? null;
  verification.ratings = { exported: rated, profile_aggregate: aggregate };
  if (aggregate != null && aggregate !== rated) warnings.push('RATING_COUNT_MISMATCH');
  return { format: 'must-rescue-v1', exported_at: now(), profile, data, showStats, seasons, seasonMetadata, verification, warnings, raw };
}

function reviewOf(item) {
  const review = item.user_product_info?.review;
  return typeof review === 'string' ? review : review?.body ?? '';
}

export function makeFiles(backup) {
  const { profile, data } = backup;
  if (!profile?.uri || !data || !Array.isArray(data.want) || !Array.isArray(data.watched)) throw new Error('INVALID_BACKUP');
  const files = {};
  const watched = data.watched.filter(item => item.product?.type === 'movie' && item.product.title);
  const want = data.want.filter(item => item.product?.type === 'movie' && item.product.title);
  files['letterboxd_watched.csv'] = csv([
    ['Title', 'Year', 'Rating10', 'Review'],
    ...watched.map(item => [item.product.title, (item.product.release_date ?? '').slice(0, 4), item.user_product_info?.rate, reviewOf(item)])
  ]);
  files['letterboxd_watchlist.csv'] = csv([
    ['Title', 'Year'], ...want.map(item => [item.product.title, (item.product.release_date ?? '').slice(0, 4)])
  ]);
  for (const [name, items] of Object.entries(data)) {
    if (!['want', 'watched', 'shows', 'youtube'].includes(name)) continue;
    files[`backup/${name}.csv`] = csv([
      ['MustID', 'Title', 'Year', 'Type', 'Status', 'Rating10', 'Review', 'ModifiedAt', 'EpisodesWatched', 'EpisodeCount'],
      ...items.map(item => {
        const p = item.product ?? {}, u = item.user_product_info ?? {};
        return [idOf(item), p.title, (p.release_date ?? '').slice(0, 4), p.type, u.status, u.rate, reviewOf(item), u.modified_at, u.user_show_info?.episodes_watched, p.items_count];
      })
    ]);
  }
  files['backup/seasons.csv'] = csv([
    ['MustID', 'Title', 'Rating10', 'Status', 'EpisodesWatched', 'Review'],
    ...(backup.seasons ?? []).map(item => [idOf(item), item.product?.title, item.user_product_info?.rate, item.user_product_info?.status, item.user_product_info?.user_season_info?.episodes_watched, reviewOf(item)])
  ]);
  files['backup/backup.json'] = json(backup);
  files['backup/verification.json'] = json({ verification: backup.verification, warnings: backup.warnings });
  files['READ-ME.txt'] = `MUST RESCUE — ${profile.uri}\nExport: ${backup.exported_at}\n\nENGLISH\n1. Import letterboxd_watched.csv at https://letterboxd.com/import/ (${watched.length} movies).\n2. Import letterboxd_watchlist.csv ONLY from your Watchlist > Import films to watchlist (${want.length} movies). The main importer marks everything as watched!\n3. Review title/year matches before confirming. No exact IMDb/TMDB matching has been performed.\nRating10 is converted by Letterboxd to its five-star scale.\nMust modification dates are NOT viewing dates; no diary dates are supplied.\nTV series and seasons are retained in backup/, separate from movie imports.\nAn empty rating/review means no value was returned, not a zero rating.\nWarnings: ${(backup.warnings ?? []).join(', ') || 'none'}. See backup/verification.json.\nNo claim of completeness beyond the public lists returned by Must.\n\nSource: https://github.com/vitali-ai/must-rescue\nFormat documentation: https://letterboxd.com/about/importing-data/\n`;
  return { files, counts: { watched: watched.length, want: want.length, shows: Object.values(data).flat().filter(item => item.product?.type === 'show').length, seasons: backup.seasons?.length ?? 0 } };
}

// ZIP store method: no compression dependency, UTF-8 names, CRC32 checked by unzip.
export function makeZip(files, now = new Date()) {
  const encoder = new TextEncoder(), chunks = [], directory = [];
  let offset = 0;
  const table = Uint32Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const [name, content] of Object.entries(files)) {
    const filename = encoder.encode(name), bytes = typeof content === 'string' ? encoder.encode(content) : content;
    const crc = crc32(bytes), header = new Uint8Array(30), view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
    view.setUint16(10, time, true); view.setUint16(12, date, true); view.setUint32(14, crc, true);
    view.setUint32(18, bytes.length, true); view.setUint32(22, bytes.length, true); view.setUint16(26, filename.length, true);
    chunks.push(header, filename, bytes);
    const central = new Uint8Array(46), cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true);
    cv.setUint16(12, time, true); cv.setUint16(14, date, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, bytes.length, true); cv.setUint32(24, bytes.length, true); cv.setUint16(28, filename.length, true); cv.setUint32(42, offset, true);
    directory.push(central, filename); offset += header.length + filename.length + bytes.length;
  }
  const size = directory.reduce((sum, bytes) => sum + bytes.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  if (Object.keys(files).length > 65535 || offset + size > 0xffffffff) throw new Error('ZIP_TOO_LARGE');
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, Object.keys(files).length, true); ev.setUint16(10, Object.keys(files).length, true);
  ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
  const result = new Uint8Array(offset + size + end.length);
  let cursor = 0;
  for (const bytes of [...chunks, ...directory, end]) { result.set(bytes, cursor); cursor += bytes.length; }
  return result;
}
