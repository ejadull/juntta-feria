# ADR 0008: Ingreso con Google

- Estado: aceptada (2026-11-10). Complementa el ADR 0004 (sesión): no cambia el contrato de access token + refresh rotativo.

## Contexto

El ingreso era sólo con email y contraseña. Los feriantes llegan por una invitación (`EXH-04`) y muchos prefieren no inventar otra contraseña. Se pidió "Ingresar con Google" sin abrir un registro público: las cuentas siguen naciendo por invitación del organizador (o por el alta de la organización), así que Google es una forma de *probar identidad*, no de *crear usuarios*.

## Decisión

- **Google Identity Services (GIS)** en la web: el botón entrega un ID token (`credential`) al navegador, sin redirecciones ni secreto de cliente. El script `https://accounts.google.com/gsi/client` se carga a demanda detrás de un `InjectionToken` (los tests nunca lo cargan). La web se entera del client id por `GET /api/v1/auth/providers` → `{ google: { clientId } | null }`, así que no hay variables de build.
- **Verificación en la API** (`POST /api/v1/auth/google { credential }`) con `jose`, que ya era dependencia (`^6.2.12`; es la que firma los access tokens): firma RS256 contra el JWKS de Google (`https://www.googleapis.com/oauth2/v3/certs`), `aud` = `GOOGLE_CLIENT_ID`, `iss` en `{accounts.google.com, https://accounts.google.com}`, `exp` e `iat` con 60 s de tolerancia, `email_verified === true` (booleano estricto). No se agregó `google-auth-library`: trae `gaxios` y varias dependencias para hacer lo que `jose` ya hace. El `createRemoteJWKSet` de `jose` usa un TTL fijo, así que un envoltorio chico (`GoogleKeys`) respeta el `Cache-Control: max-age` de Google (entre 60 s y 24 h), comparte un solo request entre verificaciones concurrentes y refresca antes si aparece un `kid` desconocido (rotación), a lo sumo cada 30 s.
- **Misma sesión que el login con contraseña**: access token en el body y refresh en la cookie HttpOnly, y **el mismo limitador** (`LoginRateLimiter`): una credencial inválida cuenta contra la IP (`hitIp`); una válida, contra IP y email, y un éxito limpia el balde del email.
- **Sólo cuentas existentes.** Se busca primero por `users.google_sub` (único, nullable) y si no, por email verificado sin distinguir mayúsculas, y se vincula el `sub` en el primer éxito. Cuenta ya vinculada a otro `sub` → 401 `GOOGLE_ACCOUNT_MISMATCH`; sin cuenta → 403 `GOOGLE_ACCOUNT_NOT_REGISTERED` (nunca se crea un usuario); cuenta deshabilitada → el mismo 401 de un login fallido (`GOOGLE_CREDENTIAL_INVALID`) y sin vincular; credencial inválida → 401 `GOOGLE_CREDENTIAL_INVALID`.
- **Alta de feriante con Google** (`EXH-04`): `POST /public/invitations/:token/accept` acepta `{ googleCredential, fullName?, phone? }` como alternativa a los campos de contraseña (mezclar ambos → 400). El email de Google tiene que ser el invitado (sin distinguir mayúsculas), si no 422 `INVITATION_EMAIL_MISMATCH` y la invitación sigue vigente. Crea el usuario confirmado con `google_sub` y **sin contraseña**.
- **Contrato de la contraseña** (migración `0017`): `users.password_hash` pasa a nullable y se agrega `CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL)`: una cuenta siempre tiene alguna forma de ingresar. El login con contraseña rechaza una cuenta sin hash con la misma respuesta (y el mismo costo de Argon2) que una contraseña errónea.
- **Configuración opcional**: sin `GOOGLE_CLIENT_ID`, `/auth/google` responde 503 `GOOGLE_SIGN_IN_UNAVAILABLE` (también si no se pueden cargar las claves de Google) y `/auth/providers` devuelve `google: null`, con lo que la web oculta el botón.
- El filtro de errores ahora conserva el `code` de un 5xx (siempre es una constante nuestra, nunca un mensaje) para poder distinguir el 503 de Google de cualquier otro 503; el `detail` de un 5xx sigue siendo genérico.

## Consecuencias

- Confiamos en que Google verifica el email: quien controle el email de una cuenta existente (p. ej. un Workspace propio del dominio) puede vincular su `sub`. Mitigado porque sólo se vincula a cuentas ya registradas y activas, y porque una vez vinculada otra identidad de Google no entra (`GOOGLE_ACCOUNT_MISMATCH`). No hay desvinculación todavía.
- El ID token de la invitación se reutiliza para iniciar sesión justo después de aceptar; vale ~1 hora, de modo que el alta con Google es un solo clic.
- La web gana la página `/invitacion/:token` (hasta ahora el link que genera la API no tenía pantalla) con contraseña o Google.
- Pendiente: desvincular Google desde el perfil; "olvidé mi contraseña" para cuentas creadas con Google; el origen de producción en la consola de Google; probar con una cuenta real (las pruebas usan un JWKS generado localmente).
