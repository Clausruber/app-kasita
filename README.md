# Autolix — La central de mando para lotes y agencias de autos

Gestiona tus lotes y agencias de autos y conecta tus redes sociales y WhatsApp en un solo lugar.
Construida con Firebase + Zernio.
Inspirada en [LateWiz](https://github.com/zernio-dev/latewiz) (MIT).

```
web/        Next.js 16 (App Router) – UI + API (/api/*) que habla con Zernio
functions/  Cloud Functions – webhook de Zernio, responder/ocultar comentarios
firestore.rules, firestore.indexes.json, firebase.json
scripts/test-webhook.mjs   envía un webhook firmado al emulador
```

## Datos en Firestore (todo bajo `app-autolix-prod`)

| Ruta | Quién escribe |
|---|---|
| `app-autolix-prod/{uid}` | API (al primer uso crea el perfil en Zernio) |
| `app-autolix-prod/{uid}/accounts/{accountId}` | API |
| `app-autolix-prod/{uid}/posts/{postId}` | API al crear; webhook actualiza estado |
| `app-autolix-prod/{uid}/posts/{postId}/alMessages/{commentId}` | webhook / `alReplyToComment` |
| `app-autolix-prod/{uid}/conversations/{convId}/messages/{id}` | webhook (DMs) |
| `app-autolix-prod/_system/zernio{Profiles,Accounts,Posts}/{id}` | índices de enrutado, solo servidor |

La UI solo lee Firestore con `onSnapshot`. El id de cada mensaje es el id del comentario de la red,
así reintentos de webhook y nuestras propias respuestas no se duplican.

## Desarrollo local (emuladores, sin credenciales)

```bash
npm --prefix web install && npm --prefix functions install && npm --prefix functions run build
firebase emulators:start --project demo-social
npm --prefix web run dev
```

`web/.env.local` usa `NEXT_PUBLIC_USE_EMULATORS=true` y `functions/.secret.local` define
`DF_ZERNIO_API_KEY` y `DF_ZERNIO_WEBHOOK_SECRET=test-secret`. Simular un comentario entrante:

```bash
node scripts/test-webhook.mjs <uid> c_123
```

Publicar, conectar cuentas y responder necesitan una `ZERNIO_API_KEY` real en `web/.env.local`
y en Secret Manager (`DF_ZERNIO_API_KEY`).

## Despliegue a un proyecto real

1. Crea el proyecto en Firebase (plan Blaze), activa Auth (Email + Google) y Firestore.
2. `firebase use --add <project-id>`
3. Secretos de las funciones:
   `firebase functions:secrets:set DF_ZERNIO_API_KEY` y `firebase functions:secrets:set DF_ZERNIO_WEBHOOK_SECRET`
4. `firebase deploy --only functions:app-autolix` (codebase propio: no toca otras funciones del proyecto). Las reglas e índices de Firestore se agregan a mano si el proyecto comparte reglas con otra app.
5. Registra el webhook en Zernio (`POST /v1/webhooks/settings`) con la URL de `alZernioWebhook`,
   el mismo secreto y los eventos `comment.received`, `message.received`, `message.sent`,
   `post.published`, `post.failed`, `post.partial`, `account.disconnected`.
6. Web en App Hosting: crea el backend apuntando a `web/`, da acceso al secreto con `firebase apphosting:secrets:grantaccess DF_ZERNIO_API_KEY --backend <id>`
   y define `NEXT_PUBLIC_FIREBASE_*` y `NEXT_PUBLIC_APP_URL` (ver `web/apphosting.yaml`).
