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
