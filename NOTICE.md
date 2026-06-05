# Notice

This repository is an unofficial preservation and research fork of WeFlow.

## Upstream Attribution

The majority of the WeFlow application source code was originally authored by the WeFlow project author:

- GitHub profile: https://github.com/hicccc77
- Original repository path, when available: `hicccc77/WeFlow`

The original repository later became unavailable to the maintainer of this fork. This repository is not affiliated with, endorsed by, sponsored by, or maintained by the original author.

The current maintainer is not a professional developer. This repository exists because the maintainer personally likes WeFlow and wanted to keep using and studying it after the original repository became unavailable. If any attribution, licensing, distribution, or other compliance issue exists, please contact the maintainer; the maintainer will promptly correct, clarify, remove, or take down the relevant material as appropriate.

## Local Modifications

This fork adds and documents local changes around WeChat WCDB key handling, especially for macOS:

- macOS passphrase capture using LLDB breakpoints.
- SQLCipher4/WCDB key derivation from passphrase and database salt.
- `all_keys.json` output containing both `passphrase` and per-database `enc_key` / `raw_key`.
- WeFlow key import logic that prefers passphrase and avoids importing per-database keys as the application decrypt key.
- Account-directory detection improvements to reduce old-account key reuse.
- Documentation for usage, safety, and non-official status.

## License And Use

The repository keeps the original license file found with the local source snapshot: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International.

This means this repository should be treated as non-commercial source-available material, not as a standard OSI-approved open source project. Downstream users should:

- preserve attribution to the original WeFlow author;
- preserve this notice and the license file;
- indicate meaningful changes when redistributing modified copies;
- avoid commercial use unless they have separate permission from the relevant rights holders.

If the original author or a rights holder asks for attribution changes, removal, or a different handling of this preservation fork, please open an issue or contact the repository owner.

## Safety

Do not commit personal WeChat data or extracted secrets, including:

- `all_keys*.json`
- `wechat-passphrase.json`
- `capture-*.log`
- decrypted `.db` files
- WeFlow local config files
- exported chat records
