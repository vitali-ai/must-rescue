# Must Rescue

Keep your movie memories. Back up a **public Must profile** and prepare separate movie imports for **Letterboxd watched films** and **watchlist**.

**[Open the web app →](https://vitali-ai.github.io/must-rescue/)** · [Русская инструкция](README.ru.md) · [Letterboxd import format](https://letterboxd.com/about/importing-data/)

No password, account token, installation, analytics or database. The website reads Must directly from your browser and builds downloads locally. It does not change either account. Your export is not committed to this repository or uploaded to an application server. GitHub serves the website and Must receives API requests.

## Use the website

1. Make your Must profile public temporarily if needed, then copy its link or nickname.
2. Paste it into the app. Leave season export enabled to preserve TV season ratings; this requires additional requests.
3. Download the ZIP backup, plus the two Letterboxd CSVs. Check any completeness warnings.
4. In Letterboxd, upload **`letterboxd_watched.csv`** at **[Import](https://letterboxd.com/import/)**.
5. Upload **`letterboxd_watchlist.csv`** only from **your Watchlist → Import films to watchlist**. The main importer marks titles as watched.
6. Review title/year matches before confirming. You can make your Must profile private again after exporting.

The demo uses fictional records. It does not retrieve another person's collection. You can also reopen a `backup.json` made by this version without accessing Must.

## What is saved

| File | Contents |
| --- | --- |
| `letterboxd_watched.csv` | Movie title, year, personal `Rating10`, available review |
| `letterboxd_watchlist.csv` | Wanted movie title and year; no watched flags or ratings |
| `backup/backup.json` | Profile collection metadata, lists, raw product responses, available reviews and season progress |
| `backup/want.csv`, `watched.csv`, `shows.csv`, `youtube.csv` | Human-readable copies, including TV entries excluded from movie imports |
| `backup/seasons.csv` | Available season ratings, status, progress and reviews |
| `backup/verification.json` | Expected/received IDs, missing records, duplicates, missing product metadata and rating count discrepancies |
| `READ-ME.txt` | English and Russian import instructions |

Must movie lists can contain TV shows. These stay in the backup and are excluded from the movie import files. Must stores season ratings separately; this app retrieves show statistics, season IDs and season records rather than interpreting a missing show-level rating as zero. The backup retains show-to-season and episode-ID metadata, but does not promise a complete per-episode watch history.

`Rating10` uses the original 1–10 scale; Letterboxd converts it to half-star increments. Must's modification timestamp is **not** treated as a viewing date. We supply no `WatchedDate`, so no dated diary entries are fabricated. Text/HTML reviews are preserved when returned.

## Limitations and service availability

- Must's undocumented public API can change or go offline. The browser also depends on its CORS policy. A running website cannot recover data while Must is unavailable. The CLI bypasses browser CORS restrictions, but still needs Must to respond.
- Movie matching uses **title and year**, not verified IMDb or TMDB identifiers. Check the Letterboxd preview, especially ambiguous titles.
- ID verification establishes completeness relative to the public lists returned by Must, not all data that may exist in the mobile app or a private account.
- Aggregate rating counts may disagree with exported records. We display the difference instead of inventing missing ratings. A partially unavailable season export still allows downloading the movie backup with warnings.
- Requests use batches of 50 and at most two concurrent requests. Transient failures retry twice with timeouts. There is no persistent browser cache. Cancel stops the current export; starting again requests the data anew.
- The website stores nothing in localStorage or a database. Keep your downloaded backup somewhere safe. For very large collections, prefer the CLI; the browser constructs an uncompressed ZIP in memory.
- Current release: unit and offline real-backup checks pass. **A fresh browser export could not be verified on 29 October 2026 because Must returned HTTP 522**, including for profile and preflight requests. Cross-origin live behavior remains to be verified when the service returns. Do not interpret the demo as a live service health check.

## Command line

Requires **Node.js 24+**, no dependencies or API keys.

```sh
git clone https://github.com/vitali-ai/must-rescue.git
cd must-rescue
node --use-env-proxy cli.mjs https://mustapp.com/@your-nickname --out exports
```

Skip season requests:

```sh
node --use-env-proxy cli.mjs your-nickname --no-seasons --out exports
```

Regenerate files offline from a downloaded backup:

```sh
node cli.mjs --from-backup exports/backup/backup.json --out regenerated
```

Choose a new output folder for each dated backup. Existing files in the chosen folder are overwritten. Exit code `0` means files were produced (check warnings); `2` means collection/season records were incomplete; `1` means export failed. A rating-count mismatch is recorded as a warning, not proof that any particular movie is missing.

## Development and hosting

The browser and CLI share `docs/core.mjs`. The web app is static HTML/CSS/ES modules. ZIP writing uses the ZIP store method and CRC32, with no dependency or third-party CDN. The tests verify ZIP files with Python's independent `zipfile` reader; development tests require Python 3.

```sh
npm test
python3 -m http.server 8080 --directory docs
```

Open `http://localhost:8080` (ES modules require an HTTP server, not `file://`). GitHub Pages: **Settings → Pages → Deploy from a branch → main → /docs**. No build step is needed. You can host `docs/` on any static host. The site has English and Russian interfaces and uses system fonts. No hosted API proxy is required.

## Contributing

Please report reproducible bugs with the error message and browser version. **Do not attach personal backups, passwords, account tokens or other people's profile data to public issues.** Use fictional or redacted fixtures. Include tests for export-format or completeness changes. Network-dependent tests should remain optional: service downtime must not make the test suite unreliable.

## Acknowledgements

This is an original dependency-free implementation built after investigating existing community tools: [Dj-Frixz/export-mustapp-data](https://github.com/Dj-Frixz/export-mustapp-data) and [VsevolodGolovanov/mustapp-exporter](https://github.com/VsevolodGolovanov/mustapp-exporter). The public API behavior and season-statistics endpoint were also inspected in Must's web client. No third-party API credentials or personal exports are included.

Independent project; not affiliated with Must or Letterboxd. [MIT License](LICENSE).
