# Publishing Notes

This repository combines:

- WeFlow desktop app source.
- The macOS `wcdb-key-tool` helper under `tools/wcdb-key-tool-macos`.
- Local fixes for importing passphrase-based key files and avoiding old-account key reuse.

## Sensitive Files

Do not commit real local WeChat data or extracted secrets.

The repository intentionally excludes:

- `all_keys*.json`
- `wechat-passphrase.json`
- `capture-*.log`
- decrypted `.db` files
- WeFlow local config files
- build outputs such as `dist/`, `dist-electron/`, `release/`
- `node_modules/`

## Build

```bash
npm install
npm run typecheck
npm run build
```

## macOS Key Tool

The macOS helper lives in:

```text
tools/wcdb-key-tool-macos/
```

Its generated `all_keys.json` contains both:

- `passphrase` for WeFlow import.
- per-database `enc_key` / `raw_key` values for database decryption.

Switching WeChat accounts requires running extraction again for the current account.
