#!/usr/bin/env bash
# Pide un access token a Entra ID para un usuario de prueba y muestra sus claims (nunca el token en bruto).
# Uso: bash scripts/entra-access-token.sh ana|bruno [scope]
#   scope por defecto: "openid profile"  -> access token de Microsoft Graph (opaco: no se puede decodificar)
#   scope de la propia app: "api://<CLIENT_ID>/.default" -> access token decodificable, con aud = tu app
# Usa ROPC: solo para pruebas, igual que entra-groups-check.sh. Lee scripts/entra-groups-check.env.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck disable=SC1091
source ./entra-groups-check.env

who="${1:?uso: $0 ana|bruno [scope]}"
scope="${2:-openid profile}"
case "$who" in
  ana)   username="$ANA_USER";   password="$ANA_PASSWORD" ;;
  bruno) username="$BRUNO_USER"; password="$BRUNO_PASSWORD" ;;
  *) echo "usuario desconocido: $who"; exit 2 ;;
esac

b64url_decode() { local s="${1//-/+}"; s="${s//_//}"; while (( ${#s} % 4 )); do s="$s="; done; printf '%s' "$s" | base64 -d 2>/dev/null; }

resp=$(curl -s -X POST "https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token" \
  --data-urlencode "grant_type=password" --data-urlencode "client_id=${CLIENT_ID}" \
  --data-urlencode "client_secret=${CLIENT_SECRET}" --data-urlencode "scope=${scope}" \
  --data-urlencode "username=${username}" --data-urlencode "password=${password}")

if ! jq -e '.access_token' <<<"$resp" >/dev/null 2>&1; then
  echo "✗ sin access_token -> $(jq -r '.error_description // .error' <<<"$resp" | head -1)"; exit 1
fi

echo "Respuesta del endpoint /token (sin los tokens):"
jq '{token_type, scope, expires_in, ext_expires_in, campos: (keys)}' <<<"$resp"

at=$(jq -r '.access_token' <<<"$resp")
if [[ "$at" == *.*.* ]] && header=$(b64url_decode "$(cut -d. -f1 <<<"$at")") && jq -e . <<<"$header" >/dev/null 2>&1; then
  if jq -e '.nonce' <<<"$header" >/dev/null 2>&1; then
    echo; echo "Access token de Microsoft Graph: lleva un 'nonce' en la cabecera, solo Graph puede validarlo. Sus claims no sirven para autorizar en MemTrace."
  fi
  echo; echo "Claims del access token:"
  b64url_decode "$(cut -d. -f2 <<<"$at")" | jq '{aud, iss, appid, scp, roles, groups, _claim_names, oid, upn, exp}'
else
  echo; echo "El access token no es un JWT decodificable (opaco)."
fi

echo; echo "Claims del id_token (donde MemTrace lee los grupos):"
b64url_decode "$(jq -r '.id_token' <<<"$resp" | cut -d. -f2)" | jq '{aud, iss, name, preferred_username, groups, roles, _claim_names}'
