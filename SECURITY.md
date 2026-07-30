# Guardian Ops — acceso privado

## Riesgo que cierra

Los endpoints de CRM y Campo no deben aceptar solicitudes anónimas porque procesan datos personales, direcciones y fotografías.

## Variables requeridas en Vercel

- `MISSION_CONTROL_PASSWORD`: contraseña de acceso elegida por Joe. No se guarda en Git.
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