#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOL="$ROOT_DIR/wcdb_key_tool.py"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[ERROR] This deploy helper is for macOS only." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "[ERROR] python3 is required. Install it with Homebrew or Xcode Command Line Tools." >&2
  exit 1
fi

OPENSSL_LIB="${WCDB_KEY_TOOL_LIBCRYPTO:-}"
if [[ -z "$OPENSSL_LIB" ]]; then
  for candidate in \
    /opt/homebrew/opt/openssl@3/lib/libcrypto.3.dylib \
    /opt/homebrew/opt/openssl@3/lib/libcrypto.dylib \
    /usr/local/opt/openssl@3/lib/libcrypto.3.dylib \
    /usr/local/opt/openssl@3/lib/libcrypto.dylib; do
    if [[ -f "$candidate" ]]; then
      OPENSSL_LIB="$candidate"
      break
    fi
  done
fi

if [[ -z "$OPENSSL_LIB" ]]; then
  echo "[ERROR] Homebrew OpenSSL was not found." >&2
  echo "        Run: brew install openssl@3" >&2
  echo "        Or set WCDB_KEY_TOOL_LIBCRYPTO=/path/to/libcrypto.dylib" >&2
  exit 1
fi

mkdir -p "$HOME/.wcdb-key-tool"
chmod 700 "$HOME/.wcdb-key-tool"

cd "$ROOT_DIR"
WCDB_KEY_TOOL_LIBCRYPTO="$OPENSSL_LIB" python3 - <<'PY'
import wcdb_key_tool as tool
tool._get_ssl()
print("[OK] OpenSSL loaded")
print("[OK] Config dir ready")
PY

cat <<EOF

macOS local mode is ready.

Next commands:
  export WCDB_KEY_TOOL_LIBCRYPTO="$OPENSSL_LIB"
  python3 "$TOOL" extract --db-dir <db_storage> --decrypt --timeout 180

macOS automatic capture is experimental and uses LLDB on CCKeyDerivationPBKDF.
If macOS blocks debugger attach, use:
  python3 "$TOOL" import-passphrase <64hex_passphrase> --db-dir <db_storage> --decrypt
EOF
