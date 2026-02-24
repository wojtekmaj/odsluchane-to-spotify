# odsluchane-to-spotify

TypeScript CLI that scrapes public playlists from [odsluchane.eu](https://www.odsluchane.eu/) and syncs them to Spotify.

## Prerequisites

- [Node.js](https://nodejs.org) 22.18 or later with [Corepack](https://nodejs.org/api/corepack.html) enabled
- Spotify app credentials from [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)

## Usage

Add `.env` file:

```sh
cp .env.example .env
```

Fill in:

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REDIRECT_URI` (recommended: `http://127.0.0.1:8888/callback`)

In Spotify Dashboard, add the exact same Redirect URI:

- `http://127.0.0.1:8888/callback`

Install:

```sh
yarn
```

### Auth

Get Spotify refresh token:

```sh
yarn auth
```

This starts a local callback server, auto-opens the authorization URL in your default browser, waits for Spotify redirect, exchanges code automatically, and writes `SPOTIFY_REFRESH_TOKEN` to `.env`.

If browser does not open automatically, open the URL printed in the terminal while `yarn auth` is still running.

### Mapping

Map station to playlist:

```sh
yarn map
```

Interactive `yarn map` flow:

- fetches stations from odsluchane.eu
- lets you pick station group first (`groupName`)
- then lets you pick station in that group
- fetches playlists from your Spotify library
- lets you pick playlist and saves mapping
- picker controls: type to search, use arrows to navigate, Enter to select

Non-interactive flow with CLI args:

```sh
yarn map --station 40 --playlist 37i9dQZF1DX…
```

You can also pass full Spotify playlist URL in `--playlist`.

Filter-by-name mapping:

```sh
yarn map --station-name chill --playlist-name chill
```

If each filter matches exactly one result, mapping is saved automatically without prompts.

#### Accepted options (`yarn map`)

| Option            | Type   | Required | Default | Description                                                                           |
| ----------------- | ------ | -------- | ------- | ------------------------------------------------------------------------------------- |
| `--station`       | string | no       | none    | Station ID. When used together with `--playlist`, mapping is saved non-interactively. |
| `--playlist`      | string | no       | none    | Spotify playlist ID or full playlist URL.                                             |
| `--station-name`  | string | no       | none    | Filters station list by name. Auto-selects when exactly one result matches.           |
| `--playlist-name` | string | no       | none    | Filters playlist list by name. Auto-selects when exactly one result matches.          |

### Syncing

Run sync:

Default run for full day (`00-24`) with 2-hour windows and date set to today in Europe/Warsaw:

```sh
yarn sync --station 40
```

You can also select station by name filter (must match exactly one station):

```sh
yarn sync --station-name chill --date 24-02-2026
```

Use remembered mapping, or override and save mapping in one go:

```sh
yarn sync --station 40 --playlist 37i9dQZF1DX… --date 24-02-2026
```

#### Accepted options (`yarn sync`)

| Option               | Type         | Required    | Default                | Description                                                                       |
| -------------------- | ------------ | ----------- | ---------------------- | --------------------------------------------------------------------------------- |
| `--station`          | string       | conditional | none                   | Station ID. Required unless `--station-name` is provided.                         |
| `--station-name`     | string       | conditional | none                   | Filters station list by name. Auto-selects when exactly one result matches.       |
| `--playlist`         | string       | no          | mapped from state      | Optional Spotify playlist ID or URL override. Also saves mapping for the station. |
| `--date`             | `DD-MM-YYYY` | no          | today in Europe/Warsaw | Date to scrape. Must be a real calendar date.                                     |
| `--from`             | integer      | no          | `0`                    | Start hour (0-23).                                                                |
| `--to`               | integer      | no          | `24`                   | End hour (1-24). Must be greater than `--from`.                                   |
| `--window`           | integer      | no          | `2`                    | Window size in hours. Allowed values: `1` or `2`.                                 |
| `--source-delay-ms`  | integer      | no          | `2500`                 | Delay between source requests (respectful pacing).                                |
| `--spotify-delay-ms` | integer      | no          | `120`                  | Delay between Spotify search requests in a window.                                |
| `--dry-run`          | boolean flag | no          | `false`                | Runs matching logic without modifying Spotify playlists or state.                 |
| `--force`            | boolean flag | no          | `false`                | Ignores processed-window memory and scrapes windows again.                        |

## What it does

- Scrapes song history windows from `https://www.odsluchane.eu/szukaj.php`.
- Searches tracks on Spotify and prefers album versions over singles when the match is close.
- Adds matched tracks to your chosen playlist.
- Inserts newly added tracks at the top of the playlist (newest first).
- Remembers station-to-playlist mapping.
- Remembers already-scraped date/time windows.
- Avoids adding duplicate songs already present in the playlist.
- Uses respectful request pacing (`--source-delay-ms`, retries with backoff).

## Cache and state

By default, runtime files are saved in `.cache/`:

- `.cache/state.json`
- `.cache/stations.json`

`state.json` stores:

- station -> playlist mapping
- processed windows per station/date (`from-to`), so reruns skip already scraped ranges

`stations.json` stores cached station catalog from odsluchane.eu to avoid unnecessary repeated fetches.
