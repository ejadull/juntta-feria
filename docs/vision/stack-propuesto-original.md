# Propuesta original de stack (histórica)

> **No vigente como decisión.** Es el borrador previo a la especificación, conservado como contexto de producto (PWA, offline, dispositivos, performance). Donde contradice lo decidido, mandan los ADR:
> [0001 SVG para editor y mapa](../adr/0001-svg-para-editor-y-mapa.md) (no Konva/Fabric) · [0003 monolito modular con npm workspaces](../adr/0003-monolito-modular-npm-workspaces.md) (no Nx/pnpm) · [0004 entorno y autenticación](../adr/0004-contrato-de-entorno-y-autenticacion.md) · [0005 Drizzle y SQL explícito](../adr/0005-drizzle-y-sql-explicito-postgis.md). En desarrollo el almacenamiento S3 es LocalStack (no MinIO).

Stack tecnológico recomendado para Juntta Feria
Para Juntta Feria, recomiendo desarrollar una PWA instalable, responsive, multiplataforma y con arquitectura modular, utilizando TypeScript tanto en frontend como en backend.

El objetivo es tener una única aplicación que funcione en:
- Android y iPhone.
- Tablets Android y iPad.
- PC con Windows y Linux.
- Mac.
- Navegadores web sin necesidad de instalación.
La misma plataforma tendrá tres experiencias: organizador, feriante y visitante, adaptadas al dispositivo y a los permisos del usuario.
1. Stack propuesto
Arquitectura Juntta Feria

Frontend · Angular + TypeScript
Tailwind CSS
Angular CDK
TanStack Query

PWA instalable · Desktop · Tablet · Mobile
REST / SSE / Web Push

Backend · NestJS + TypeScript

Auth · Tenants · Eventos · Stands · Reservas · Pagos · Social · Notificaciones


PostgreSQL
PostGIS

Redis
BullMQ

S3
MinIO / Cloud


Mercado Pago
Web Push
Konva.js
Docker


Capa	Tecnología recomendada	Justificación
Frontend	Angular, versión estable compatible al iniciar	Framework estructurado y mantenible
Lenguaje	TypeScript estricto	Tipado de contratos extremo a extremo
UI	Tailwind CSS + Angular CDK	Responsive y componentes accesibles
PWA	Service Workers + Workbox	Instalación y estrategias de caché
Estado	Angular Signals + TanStack Query	Estado reactivo y sincronización con API
Editor de planos	Konva.js	Drag & drop, zoom, rotación y edición
Mapas de ubicación	MapLibre GL JS	Ubicar predios sobre mapas reales
Backend	NestJS + Fastify	API modular
ORM	Drizzle ORM + SQL/PostGIS específico	Control de migraciones y consultas espaciales
Base de datos	PostgreSQL + PostGIS	Datos transaccionales y geometría
Cache y colas	Redis + BullMQ	Procesamiento asíncrono
Almacenamiento	S3 compatible	Fotografías y archivos
Pagos	Mercado Pago Checkout Pro	Reservas y pagos en Argentina
Notificaciones	Web Push + VAPID	Push multiplataforma
Infraestructura	Docker Compose + NGINX	Desarrollo y despliegue inicial
Testing	Vitest, Playwright y Supertest	Pruebas unitarias, E2E e integración
Monitoreo	OpenTelemetry + Grafana	Métricas, trazas y observabilidad

Una decisión importante: utilizaría Workbox para el Service Worker principal. Angular continúa ofreciendo soporte PWA mediante ng add @angular/pwa, pero su Service Worker integrado está orientado a caching básico y ya no incorpora nuevas funcionalidades salvo correcciones de seguridad. Para las estrategias offline específicas de Juntta Feria, Workbox ofrece más flexibilidad. 
Angular+1

2. Cómo funcionará en cada dispositivo









Smartphone · Android / iOS

Experiencia mobile-first para buscar ferias, reservar stands, pagar, recibir notificaciones y publicar fotografías.

Navegación inferior, botones táctiles, tarjetas compactas y formularios simplificados.












Tablet · Android / iPad

Visualización amplia del plano, interacción táctil, zoom con gestos y administración de reservas.

Especialmente adecuada para personal que trabaja dentro del predio.












Desktop · Windows / macOS / Linux

Panel administrativo completo, editor avanzado de planos, reportes, facturación y gestión de expositores.

Interfaz con sidebar, tablas extensas, filtros avanzados y operaciones masivas.



La PWA se instala desde el navegador en las plataformas compatibles. En iPhone y iPad, la instalación normalmente requiere que el usuario la agregue a la pantalla de inicio; la promoción automática de instalación no funciona igual que en Android. 
MDN+1

Compatibilidad que debemos garantizar
Funcionalidad	Android	iOS / iPadOS	Desktop
Instalable	Sí*	Sí, manual	Sí*
Interfaz responsive	Sí	Sí	Sí
Notificaciones push	Sí*	Sí, instalada y compatible	Sí*
Cámara para fotos	Sí	Sí	Según dispositivo
Lectura QR	Sí	Sí	Con cámara
Consulta offline	Sí	Sí, con limitaciones	Sí
Reservas y pagos	Online	Online	Online

*Depende del navegador, la versión del sistema operativo y los permisos concedidos. Web Push en iOS está disponible para aplicaciones agregadas a la pantalla de inicio desde iOS 16.4. 
Apple Developer Documentation
3. Estrategia de funcionamiento offline
Para una feria esto es relevante: los predios pueden tener conectividad irregular o redes móviles saturadas.

Propongo tres niveles de funcionamiento:
Online — Funcionalidad completa

Reservas, pagos, estados de stands en tiempo real, publicaciones y notificaciones.



Offline — Consulta

Plano descargado, programa del evento, directorio de expositores, información del stand y comunicaciones sincronizadas previamente.



Reconexión — Sincronización controlada

Recuperación de datos, actualización del mapa y envío de borradores sociales pendientes, cuando sea seguro hacerlo.



Utilizaría IndexedDB con Dexie.js para datos estructurados locales y Cache Storage para recursos estáticos.

No permitiría reservar un stand offline: la disponibilidad y el precio deben verificarse contra el servidor para evitar dobles adjudicaciones.
4. Editor de planos: componente técnico crítico
Para diseñar los stands recomiendo Konva.js, porque permite trabajar con escenas interactivas basadas en Canvas, múltiples capas, transformaciones y detección de objetos. 
Konva - JavaScript Canvas 2d Library+1


El editor deberá tener:
- Sistema de coordenadas en metros.
- Grilla configurable y snap-to-grid.
- Zoom y desplazamiento táctil.
- Creación de stands rectangulares y poligonales.
- Rotación, alineación, duplicación y selección múltiple.
- Detección de superposiciones.
- Versionado de planos.
- Guardado y recuperación.
- Exportación a SVG, PNG y PDF.
Separaría técnicamente el editor administrativo, optimizado para desktop y tablets, del visor público, más liviano, optimizado para teléfonos y navegación táctil.
5. Estructura del repositorio
Utilizaría un monorepo con pnpm workspaces y Nx para las dependencias entre proyectos.
juntta-feria/
├── apps/
│   ├── web/                  # Angular PWA
│   ├── api/                  # NestJS REST API
│   └── worker/               # BullMQ jobs
│
├── libs/
│   ├── ui/                   # Design System
│   ├── domain/               # Modelos de dominio
│   ├── contracts/            # Contratos OpenAPI / tipos
│   ├── auth/
│   ├── maps/                 # Editor y visor
│   ├── payments/
│   ├── notifications/
│   └── social/
│
├── infra/
│   ├── docker/
│   ├── nginx/
│   └── monitoring/
│
├── docs/
│   └── openspec/
│
├── docker-compose.yml
├── nx.json
├── pnpm-workspace.yaml
└── README.md


Esto facilita compartir contratos y componentes sin dividir prematuramente el sistema en microservicios.
6. Infraestructura y despliegue
Para el MVP utilizaría Docker Compose en un VPS o servidor cloud administrado, con almacenamiento persistente y backups automatizados.
Servicios iniciales
Contenedor	Función
juntta-web	Angular PWA servida por NGINX
juntta-api	API NestJS
juntta-worker	Notificaciones y trabajos asíncronos
juntta-postgres	PostgreSQL + PostGIS
juntta-redis	Cache y colas
juntta-minio	Archivos y fotografías
juntta-proxy	HTTPS y proxy inverso


En producción separaría progresivamente la base de datos y el almacenamiento del servidor de aplicación. Desde el primer despliegue incluiría HTTPS, backups verificados, auditoría, rate limiting y aislamiento multi-tenant.
Objetivos de performance
Indicador	Objetivo inicial
Lighthouse Performance móvil	≥ 90 en páginas públicas representativas
LCP móvil, p75	≤ 2,5 segundos
INP, p75	≤ 200 ms
CLS, p75	≤ 0,1
Respuesta API simple, p95	Menos de 300 ms
Visor de plano	Interacción fluida con 500 stands
Tamaño inicial de la PWA	Carga por módulos, sin editor en bundle inicial

Estos valores son objetivos de diseño y deben validarse con pruebas de carga y dispositivos reales.
7. Decisiones finales para Juntta Feria
Frontend

Angular + TypeScript + Tailwind CSS


PWA

Workbox + Web App Manifest + IndexedDB


Backend

NestJS + Fastify


Base de datos

PostgreSQL + PostGIS


Mapas interactivos

Konva.js + visor optimizado


Notificaciones

Web Push + VAPID + BullMQ


Muro social

NestJS + almacenamiento S3


Pagos

Mercado Pago Checkout Pro


Arquitectura

Monolito modular multi-tenant


Despliegue

Docker Compose, evolucionable a cloud administrado



Mi recomendación es mantener este stack como estándar arquitectónico de Juntta Feria. Angular y NestJS ofrecen una base consistente, mientras que PostGIS resuelve la parte geométrica del negocio y Workbox permite diseñar una experiencia PWA robusta.

No desarrollaría aplicaciones nativas separadas para Android e iOS en el MVP. Primero validaría el producto con una PWA instalable y, si posteriormente aparecen necesidades específicas de integración con el sistema operativo o distribución en tiendas, evaluaría empaquetarla con Capacitor.

El siguiente paso técnico es actualizar el OpenSpec con esta arquitectura como decisión formal (ADR-001), establecer los requisitos PWA y definir el primer sprint del repositorio ejadull/juntta-feria.