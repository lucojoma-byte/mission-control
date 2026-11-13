# Guardian Ops — acceso privado

## Riesgo que cierra

Los endpoints de CRM y Campo no deben aceptar solicitudes anónimas porque procesan datos personales, direcciones y fotografías.

## Variables requeridas en Vercel

- `MISSION_CONTROL_PASSWORD`: contraseña de acceso elegida por Joe. No se guarda en Git. Debe tener **al menos 16 caracteres** y ser única para este sistema.
- `MISSION_CONTROL_SESSION_SECRET`: valor aleatorio largo para firmar cookies. No se guarda en Git.

Si falta cualquiera de las dos, los endpoints protegidos responden `503` y no acceden a Google Sheets ni Vercel Blob.

## Comportamiento

1. CRM o Campo recibe una solicitud.
2. Sin cookie válida, la API devuelve `401`.
3. La app solicita la contraseña y la envía a `/api/auth-login`.
4. Una contraseña válida genera una cookie `HttpOnly`, `Secure`, `SameSite=Strict`, con duración de 8 horas.
5. Las siguientes solicitudes del mismo navegador incluyen la cookie sin exponer el secreto al JavaScript.

## Verificación local

```bash
npm ci
npm test
node --check api/auth-login.js
node --check api/campo-visitas.js
node --check api/crm-prospectos.js
node --check lib/auth.js
```

## Gate antes de desplegar

- configurar ambas variables en Vercel;
- desplegar primero a preview;
- verificar login correcto e incorrecto;
- confirmar que una sesión anónima recibe 401 en CRM y Campo;
- confirmar que una sesión válida todavía puede leer Sheets y guardar Campo;
- desplegar a producción solo con aprobación de Joe.

## Alcance

Este parche contiene el acceso a datos. No sustituye un sistema completo de usuarios, roles, recuperación de contraseña ni auditoría por persona. Es una contención adecuada para el piloto privado de un solo propietario.

## Fotos y registros de Campo (almacenamiento privado)

- Fotos y registros JSON de Campo se guardan en un **Blob store privado**, separado del store público histórico (`mission-control-public`).
- Variable requerida: `BLOB_PRIVATE_READ_WRITE_TOKEN`. Se crea sola al conectar el store privado al proyecto con el prefijo de variables `BLOB_PRIVATE`.
- Si falta en Preview o Production, `/api/campo-visitas` responde `503` y **no** guarda en el store público.
- No existen URLs públicas: fotos y registros se leen solo por `GET /api/campo-archivo?path=…`, que exige sesión válida (401 sin sesión o con sesión vencida) y responde con `Cache-Control: private, no-store`.
- El cliente redibuja cada foto en canvas y la exporta como JPEG nuevo (sin EXIF/GPS), máximo 4 fotos, 1 MB cada una y 3 MB en total. El servidor rechaza cualquier JPEG que conserve EXIF.
- Si una escritura falla a mitad de la visita, se borran los archivos ya subidos.
- Las fotos antiguas del store público no se migran ni se borran en este cambio.
