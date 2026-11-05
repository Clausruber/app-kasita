# Kasita — El copiloto 24/7 para tu inmobiliaria

Cada cliente recibe respuesta al instante, a cualquier hora y en cualquier red. Un agente de IA atiende comentarios y mensajes, agenda visitas y da seguimiento a cada persona.
Construida con Firebase + Zernio.
Inspirada en [LateWiz](https://github.com/zernio-dev/latewiz) (MIT).

```
web/        Next.js 16 (App Router) – UI + API (/api/*) que habla con Zernio
functions/  Cloud Functions – webhook de Zernio, responder/ocultar comentarios
firestore.rules, firestore.indexes.json, firebase.json
scripts/test-webhook.mjs   envía un webhook firmado al emulador
```

## Datos en Firestore (todo bajo `kafona-data`)

| Ruta | Quién escribe |
|---|---|
| `kafona-data/{uid}` | API (al primer uso crea el perfil en Zernio) |
| `kafona-data/{uid}/accounts/{accountId}` | API |
| `kafona-data/{uid}/posts/{postId}` | API al crear; webhook actualiza estado |
| `kafona-data/{uid}/posts/{postId}/kfMessages/{commentId}` | webhook / `kfReplyToComment` |
| `kafona-data/{uid}/conversations/{convId}/messages/{id}` | webhook (DMs) |
| `kafona-data/_system/zernio{Profiles,Accounts,Posts}/{id}` | índices de enrutado, solo servidor |

La UI solo lee Firestore con `onSnapshot`. El id de cada mensaje es el id del comentario de la red,
así reintentos de webhook y nuestras propias respuestas no se duplican.

## Desarrollo local (contra el proyecto real `kafona`, sin emuladores)

```bash
npm --prefix web install && npm --prefix functions install && npm --prefix functions run build
npm --prefix web run dev
```

`web/.env.local` ya trae la config web de Firebase del proyecto `kafona`. Para las rutas de API
(firebase-admin) define `GOOGLE_APPLICATION_CREDENTIALS` con la cuenta de servicio, y
`ZERNIO_API_KEY` / `DF_AI_ENCRYPTION_KEY` para publicar, conectar cuentas y el agente IA.

## Despliegue a un proyecto real

1. Crea el proyecto en Firebase (plan Blaze), activa Auth (Email) y Firestore.
2. Proyecto `kafona` (ya en `.firebaserc`): `firebase use kafona`
3. Secretos de las funciones:
   `firebase functions:secrets:set DF_ZERNIO_API_KEY` y `firebase functions:secrets:set DF_ZERNIO_WEBHOOK_SECRET`
4. `firebase deploy --only functions:kafona` y `firebase deploy --only firestore,storage` para reglas e índices.
5. Registra el webhook en Zernio (`POST /v1/webhooks/settings`) con la URL de `kfZernioWebhook`,
   el mismo secreto y los eventos `comment.received`, `message.received`, `message.sent`,
   `post.published`, `post.failed`, `post.partial`, `account.disconnected`.
6. Web en App Hosting: crea el backend apuntando a `web/`, da acceso al secreto con `firebase apphosting:secrets:grantaccess DF_ZERNIO_API_KEY --backend <id>`
   y define `NEXT_PUBLIC_FIREBASE_*` y `NEXT_PUBLIC_APP_URL` (ver `web/apphosting.yaml`).
