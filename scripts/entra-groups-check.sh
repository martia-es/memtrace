#!/usr/bin/env bash
# Comprueba qué grupos de Entra ID llegan en el id_token de cada usuario de prueba.
# Uso: cp scripts/entra-groups-check.env.example scripts/entra-groups-check.env  (rellénalo)
#      bash scripts/entra-groups-check.sh
# Solo para pruebas: usa el flujo ROPC (usuario y contraseña), que no funciona con MFA ni con contraseñas temporales.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck disable=SC1091
source ./entra-groups-check.env

b64url_decode() { local s="${1//-/+}"; s="${s//_//}"; while (( ${#s} % 4 )); do s="$s="; done; printf '%s' "$s" | base64 -d 2>/dev/null; }

fail=0
check_user() {
  local label="$1" username="$2" password="$3" expected="$4" forbidden="$5"
  local resp token claims groups
  resp=$(curl -s -X POST "https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token" \
    --data-urlencode "grant_type=password" --data-urlencode "client_id=${CLIENT_ID}" \
    --data-urlencode "client_secret=${CLIENT_SECRET}" --data-urlencode "scope=openid profile" \
    --data-urlencode "username=${username}" --data-urlencode "password=${password}")
  token=$(jq -r '.id_token // empty' <<<"$resp")
  if [[ -z "$token" ]]; then
    echo "✗ ${label}: no hay id_token -> $(jq -r '.error_description // .error' <<<"$resp" | head -1)"; fail=1; return
  fi
  claims=$(b64url_decode "$(cut -d. -f2 <<<"$token")")
  if jq -e '._claim_names' <<<"$claims" >/dev/null 2>&1; then
    echo "✗ ${label}: overage (el token no trae los grupos, hay que leerlos por Graph)"; fail=1; return
  fi
  groups=$(jq -c '.groups // []' <<<"$claims")
  echo "• ${label} (${username}) groups=${groups}"
  for g in $expected;  do jq -e --arg g "$g" 'index($g)' <<<"$groups" >/dev/null && echo "   ✓ trae $g"        || { echo "   ✗ FALTA $g"; fail=1; }; done
  for g in $forbidden; do jq -e --arg g "$g" 'index($g)' <<<"$groups" >/dev/null && { echo "   ✗ NO debería traer $g"; fail=1; } || echo "   ✓ no trae $g"; done
}

check_user "tecnica" "$ANA_USER"   "$ANA_PASSWORD"   "$GUID_DATA_SCIENCE"     "$GUID_FINANZAS"
check_user "negocio" "$BRUNO_USER" "$BRUNO_PASSWORD" "$GUID_NEGOCIO_ANALISTAS" "$GUID_RRHH"

if [[ -n "${MEMTRACE_URL:-}" && -n "${ORG_ID:-}" && -n "${EXPERIMENT_ID:-}" ]]; then
  cat <<MAP

Mappings a crear en MemTrace (${MEMTRACE_URL}/api/v1/organizations/${ORG_ID}/identity/mappings), como org_admin:
  {"externalGroup":"${GUID_DATA_SCIENCE}","experimentId":"${EXPERIMENT_ID}","role":"technical"}
  {"externalGroup":"${GUID_NEGOCIO_ANALISTAS}","experimentId":"${EXPERIMENT_ID}","role":"business"}
MAP
fi
exit $fail
