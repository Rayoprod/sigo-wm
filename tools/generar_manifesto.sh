#!/usr/bin/env bash
# ==============================================================================
# GENERADOR AUTÓNOMO DE MANIFIESTO DE ARCHIVOS - ECOSISTEMA SIGO-WM
# Genera docs/auditoria/MANIFIESTO_BASE.json con hashes SHA256 y metadatos.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURRENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -d "$CURRENT_DIR/src" ] && [ -d "$CURRENT_DIR/../sigo_wm_mobile" ]; then
  ROOT_DIR="$(cd "$CURRENT_DIR/.." && pwd)"
elif [ -d "$CURRENT_DIR/sigo-wm" ] && [ -d "$CURRENT_DIR/sigo_wm_mobile" ]; then
  ROOT_DIR="$CURRENT_DIR"
elif [ -d "$CURRENT_DIR/../sigo-wm" ] && [ -d "$CURRENT_DIR/../sigo_wm_mobile" ]; then
  ROOT_DIR="$(cd "$CURRENT_DIR/.." && pwd)"
else
  ROOT_DIR="$CURRENT_DIR"
fi

OUTPUT_FILE="$ROOT_DIR/docs/auditoria/MANIFIESTO_BASE.json"

mkdir -p "$ROOT_DIR/docs/auditoria"
mkdir -p "$ROOT_DIR/sigo-wm/docs/auditoria"
mkdir -p "$ROOT_DIR/sigo_wm_mobile/docs/auditoria"

echo "🔍 Escaneando archivos fuente en $ROOT_DIR..."

TMP_JSON=$(mktemp)

cat <<EOF > "$TMP_JSON"
{
  "generado": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "archivos": [
EOF

FIRST=true

# Escanear sigo-wm y sigo_wm_mobile
find "$ROOT_DIR/sigo-wm/src" "$ROOT_DIR/sigo-wm/api" "$ROOT_DIR/sigo_wm_mobile/lib" \
  -type f \
  \( -name "*.ts" -o -name "*.html" -o -name "*.scss" -o -name "*.css" -o -name "*.dart" -o -name "*.js" \) \
  -not -path "*/node_modules/*" \
  -not -path "*/.git/*" \
  -not -path "*/.dart_tool/*" \
  -not -path "*/build/*" \
  -not -path "*/dist/*" \
  | sort | while read -r filepath; do

  relpath="${filepath#$ROOT_DIR/}"
  lines=$(wc -l < "$filepath" | tr -d ' ')
  
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sha256=$(shasum -a 256 "$filepath" | awk '{print $1}')
    mtime=$(stat -f "%Sm" -t "%Y-%m-%dT%H:%M:%SZ" "$filepath")
  else
    sha256=$(sha256sum "$filepath" | awk '{print $1}')
    mtime=$(date -r "$filepath" -u +"%Y-%m-%dT%H:%M:%SZ")
  fi

  if [ "$FIRST" = true ]; then
    FIRST=false
  else
    echo "," >> "$TMP_JSON"
  fi

  cat <<EOF >> "$TMP_JSON"
    {
      "path": "$relpath",
      "sha256": "$sha256",
      "lineas": $lines,
      "mtime": "$mtime"
    }
EOF
done

cat <<EOF >> "$TMP_JSON"

  ]
}
EOF

if command -v python3 &>/dev/null; then
  python3 -m json.tool "$TMP_JSON" > "$OUTPUT_FILE"
elif command -v jq &>/dev/null; then
  jq . "$TMP_JSON" > "$OUTPUT_FILE"
else
  mv "$TMP_JSON" "$OUTPUT_FILE"
fi

rm -f "$TMP_JSON"

[ -f "$OUTPUT_FILE" ] && [ -d "$ROOT_DIR/sigo-wm/docs/auditoria" ] && cp -f "$OUTPUT_FILE" "$ROOT_DIR/sigo-wm/docs/auditoria/MANIFIESTO_BASE.json" 2>/dev/null || true
[ -f "$OUTPUT_FILE" ] && [ -d "$ROOT_DIR/sigo_wm_mobile/docs/auditoria" ] && cp -f "$OUTPUT_FILE" "$ROOT_DIR/sigo_wm_mobile/docs/auditoria/MANIFIESTO_BASE.json" 2>/dev/null || true

if [ -f "$ROOT_DIR/docs/auditoria/BASE_DE_HECHOS.md" ]; then
  [ -d "$ROOT_DIR/sigo-wm/docs/auditoria" ] && cp -f "$ROOT_DIR/docs/auditoria/BASE_DE_HECHOS.md" "$ROOT_DIR/sigo-wm/docs/auditoria/BASE_DE_HECHOS.md" 2>/dev/null || true
  [ -d "$ROOT_DIR/sigo_wm_mobile/docs/auditoria" ] && cp -f "$ROOT_DIR/docs/auditoria/BASE_DE_HECHOS.md" "$ROOT_DIR/sigo_wm_mobile/docs/auditoria/BASE_DE_HECHOS.md" 2>/dev/null || true
fi

COUNT=$(grep -c '"path"' "$OUTPUT_FILE" || true)
echo "✅ Manifiesto generado con éxito: $COUNT archivos fuente registrados."
