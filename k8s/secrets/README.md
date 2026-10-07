# k8s/secrets/

Esta carpeta está en `.gitignore`: nunca se commitea (ADR-013).

Copia aquí `identity-oauth.env` con los valores reales (los mismos que `api/.env`):

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
MICROSOFT_APPLICATION_ID=...
MICROSOFT_TENANT_ID=...
MICROSOFT_CLIENT_SECRET=...
AUTH_SECRET=...   # `openssl rand -base64 32`
```

`kustomization.yaml` genera con esto el Secret `identity-oauth-credentials`, que consume el Deployment de la API (`k8s/50-api.yaml`).

Copia también `resend.env` con los valores reales (los mismos que `api/.env`):

```
RESEND_API_KEY=...
EMAIL_FROM=MemTrace <invites@tudominio.com>   # dominio verificado en Resend
```

`kustomization.yaml` genera con esto el Secret `resend-credentials`, que consume el Deployment de la API (`k8s/50-api.yaml`).

## GitHub App (opcional, ADR-064)

Para lanzar despliegues desde MemTrace hace falta una GitHub App instalada en los repositorios de los agentes, con permisos
**Contents: read**, **Actions: write** y **Metadata: read**, y un webhook a `https://<tu-api>/api/v1/webhooks/github` con el evento
**Workflow runs**. A diferencia de los anteriores, este Secret no lo genera kustomize (el fichero con la clave privada no debe
estar en el repo): créalo a mano. Sin él, todo funciona y el botón Deploy avisa de que no está configurado.

```
kubectl -n memtrace create secret generic github-app-credentials \
  --from-literal=GITHUB_APP_ID=123456 \
  --from-file=GITHUB_APP_PRIVATE_KEY=./memtrace-app.private-key.pem \
  --from-literal=GITHUB_WEBHOOK_SECRET="$(openssl rand -hex 32)"
```
