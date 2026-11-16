import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LEGAL_INFO } from './legal-info';

/** Política de Privacidad (Ley 25.326). Operator values come from LEGAL_INFO. */
@Component({
  selector: 'app-privacy-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <main class="min-h-screen bg-background text-text">
      <article class="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 class="text-3xl font-semibold tracking-tight">Política de Privacidad</h1>
        <p class="mt-2 text-sm text-text-muted">Última actualización: {{ info.lastUpdated }}</p>
        <p class="mt-6">
          En {{ info.operator }} nos importa tu privacidad. Esta política explica qué datos
          personales tratamos cuando usás la plataforma, para qué los usamos y qué derechos tenés,
          de acuerdo con la Ley 25.326 de Protección de los Datos Personales de la República
          Argentina.
        </p>

        <nav aria-label="Contenido" class="mt-8 rounded-lg border border-border bg-surface p-4">
          <p class="font-semibold">Contenido</p>
          <ol class="mt-2 list-decimal space-y-1 pl-6 text-sm">
            @for (s of sections; track s.id) {
              <li>
                <a [href]="'#' + s.id" class="text-primary-strong underline">{{ s.title }}</a>
              </li>
            }
          </ol>
        </nav>

        <div class="mt-8 space-y-8 leading-relaxed">
          <section aria-labelledby="responsable">
            <h2 id="responsable" class="text-xl font-semibold">1. Responsable del tratamiento</h2>
            <p class="mt-2">
              El responsable del tratamiento de tus datos es {{ info.operator }} (en adelante,
              "Juntta"), operador de la plataforma. Los datos de contacto figuran al final de esta
              política. Cuando un organizador de ferias te invita o gestiona tus reservas, también
              accede a los datos necesarios para organizar su evento.
            </p>
          </section>

          <section aria-labelledby="informacion">
            <h2 id="informacion" class="text-xl font-semibold">2. Información que recopilamos</h2>
            <h3 class="mt-4 text-lg font-semibold">2.1. Información que nos proporcionás</h3>
            <ul class="mt-2 list-disc space-y-1 pl-6">
              <li>
                Datos de tu cuenta de Google al ingresar: email, nombre e identificador de la
                cuenta de Google. No almacenamos contraseñas de cuentas de Google.
              </li>
              <li>Teléfono, que el organizador usa para enviarte invitaciones por WhatsApp.</li>
              <li>Perfil de feriante: razón social, CUIT y rubro o categoría en el que exponés.</li>
              <li>
                Documentos que subís como feriante, guardados en un servicio de almacenamiento de
                objetos en la nube.
              </li>
              <li>
                Reservas de stands y su estado de pago, incluidos los identificadores de pago de
                Mercado Pago. No recibimos ni guardamos datos de tarjetas.
              </li>
            </ul>
            <h3 class="mt-4 text-lg font-semibold">2.2. Información recopilada automáticamente</h3>
            <ul class="mt-2 list-disc space-y-1 pl-6">
              <li>
                Registros de auditoría de acciones relevantes realizadas en la plataforma (quién
                hizo qué y cuándo).
              </li>
              <li>
                Dirección IP: la usamos para limitar la cantidad de solicitudes a las rutas
                públicas. Esos contadores se guardan en una ventana corta de tiempo y luego
                expiran. La IP también puede figurar en los registros del servidor.
              </li>
            </ul>
          </section>

          <section aria-labelledby="finalidades">
            <h2 id="finalidades" class="text-xl font-semibold">3. Finalidades</h2>
            <ul class="mt-2 list-disc space-y-1 pl-6">
              <li>Identificarte y permitirte ingresar a tu cuenta.</li>
              <li>Gestionar invitaciones, perfiles de feriantes, documentos y reservas.</li>
              <li>Procesar y confirmar los pagos de las reservas a través de Mercado Pago.</li>
              <li>Proteger la plataforma contra abusos y mantener registros de auditoría.</li>
              <li>Responder tus consultas y cumplir obligaciones legales.</li>
            </ul>
            <p class="mt-2">No vendemos tus datos ni los usamos para publicidad de terceros.</p>
          </section>

          <section aria-labelledby="base-legal">
            <h2 id="base-legal" class="text-xl font-semibold">4. Base legal</h2>
            <p class="mt-2">
              Tratamos tus datos con tu consentimiento libre, expreso e informado al ingresar y
              usar la plataforma, por la ejecución de la relación contractual con el organizador y
              con Juntta, y para cumplir obligaciones legales (art. 5 de la Ley 25.326).
            </p>
          </section>

          <section aria-labelledby="destinatarios">
            <h2 id="destinatarios" class="text-xl font-semibold">
              5. Destinatarios y transferencias
            </h2>
            <p class="mt-2">
              Compartimos datos solo con quienes los necesitan para prestar el servicio:
            </p>
            <ul class="mt-2 list-disc space-y-1 pl-6">
              <li>
                El organizador de la feria en la que participás, que puede ver tu perfil, tus
                documentos y tus reservas.
              </li>
              <li>
                Google, para el ingreso con Google, y Google Cloud, donde alojamos la aplicación, la
                base de datos y los archivos.
              </li>
              <li>Mercado Pago, para procesar los pagos.</li>
              <li>Autoridades, cuando una norma o una orden judicial lo exijan.</li>
            </ul>
            <p class="mt-2">
              Algunos de estos proveedores pueden procesar datos fuera de la Argentina. Esa
              transferencia internacional se realiza conforme al art. 12 de la Ley 25.326, hacia
              proveedores que ofrecen niveles de protección adecuados o con las garantías
              contractuales correspondientes.
            </p>
          </section>

          <section aria-labelledby="derechos">
            <h2 id="derechos" class="text-xl font-semibold">6. Tus derechos</h2>
            <p class="mt-2">
              Podés ejercer, de forma gratuita, los derechos de acceso, rectificación,
              actualización y supresión de tus datos (derechos ARCO) escribiendo a
              <a [href]="'mailto:' + info.contactEmail" class="text-primary-strong underline">{{
                info.contactEmail
              }}</a
              >. Indicá tu nombre, el email de tu cuenta y qué derecho querés ejercer. Podemos
              pedirte que acredites tu identidad. Responderemos dentro de los plazos legales.
            </p>
          </section>

          <section aria-labelledby="conservacion">
            <h2 id="conservacion" class="text-xl font-semibold">7. Conservación</h2>
            <p class="mt-2">
              Conservamos tus datos durante la relación con el organizador y luego por el plazo
              legal aplicable, en particular para la información de pagos y facturación. Los
              contadores de IP para limitar solicitudes expiran en poco tiempo. Podés pedir la
              supresión de tus datos, salvo los que debamos conservar por obligación legal.
            </p>
          </section>

          <section aria-labelledby="cookies">
            <h2 id="cookies" class="text-xl font-semibold">8. Cookies y almacenamiento local</h2>
            <ul class="mt-2 list-disc space-y-1 pl-6">
              <li>
                Una cookie de sesión HttpOnly, necesaria para mantenerte conectado. JavaScript no
                puede leerla y solo se envía a los endpoints de autenticación.
              </li>
              <li>
                El almacenamiento local del navegador guarda la clave <code>juntta.theme</code>,
                con el tema de color que elegiste.
              </li>
            </ul>
            <p class="mt-2">
              No usamos herramientas de analítica ni cookies publicitarias. Cuando usás Google
              (ingreso) o Mercado Pago (pago), esos servicios pueden configurar sus propias cookies
              según sus políticas.
            </p>
          </section>

          <section aria-labelledby="terceros">
            <h2 id="terceros" class="text-xl font-semibold">9. Enlaces a terceros</h2>
            <p class="mt-2">
              La plataforma puede enlazar a sitios de terceros, como Mercado Pago. No controlamos
              sus prácticas de privacidad; te recomendamos leer sus políticas.
            </p>
          </section>

          <section aria-labelledby="seguridad">
            <h2 id="seguridad" class="text-xl font-semibold">10. Seguridad</h2>
            <p class="mt-2">
              Aplicamos medidas técnicas y organizativas razonables: sesiones con cookie HttpOnly,
              límites de solicitudes y registros de auditoría. Ningún sistema es infalible, por lo
              que no podemos garantizar una seguridad absoluta.
            </p>
          </section>

          <section aria-labelledby="menores">
            <h2 id="menores" class="text-xl font-semibold">11. Menores de 18 años</h2>
            <p class="mt-2">
              La plataforma no está dirigida a menores de 18 años y no recopilamos sus datos de
              forma deliberada. Si creés que un menor nos entregó datos, escribinos para
              eliminarlos.
            </p>
          </section>

          <section aria-labelledby="autoridad">
            <h2 id="autoridad" class="text-xl font-semibold">12. Autoridad de control</h2>
            <p class="mt-2">
              La Agencia de Acceso a la Información Pública (AAIP) es el órgano de control de la
              Ley 25.326 y podés presentar ante ella una denuncia:
              <a
                href="https://www.argentina.gob.ar/aaip"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary-strong underline"
                >argentina.gob.ar/aaip</a
              >
              (Av. Pres. Roque Sáenz Peña 832, Ciudad Autónoma de Buenos Aires).
            </p>
          </section>

          <section aria-labelledby="cambios">
            <h2 id="cambios" class="text-xl font-semibold">13. Cambios</h2>
            <p class="mt-2">
              Podemos actualizar esta política. Publicaremos la versión vigente en esta página con
              su fecha de última actualización.
            </p>
          </section>

          <section aria-labelledby="ley">
            <h2 id="ley" class="text-xl font-semibold">14. Ley aplicable y jurisdicción</h2>
            <p class="mt-2">
              Esta política se rige por las leyes de la República Argentina. Cualquier controversia
              se someterá a {{ info.jurisdiction }}, sin perjuicio de las disposiciones legales
              imperativas.
            </p>
          </section>

          <section aria-labelledby="contacto">
            <h2 id="contacto" class="text-xl font-semibold">Contacto</h2>
            <p class="mt-2">
              Para consultas sobre privacidad escribinos a
              <a [href]="'mailto:' + info.contactEmail" class="text-primary-strong underline">{{
                info.contactEmail
              }}</a
              >.
            </p>
          </section>
        </div>

        <p class="mt-10 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-6 text-sm">
          <a routerLink="/" class="text-primary-strong underline">Volver al inicio</a>
          <a routerLink="/terminos" class="text-primary-strong underline">Términos y Condiciones</a>
        </p>
      </article>
    </main>
  `,
})
export class PrivacyPage {
  protected readonly info = LEGAL_INFO;
  protected readonly sections = [
    { id: 'responsable', title: 'Responsable del tratamiento' },
    { id: 'informacion', title: 'Información que recopilamos' },
    { id: 'finalidades', title: 'Finalidades' },
    { id: 'base-legal', title: 'Base legal' },
    { id: 'destinatarios', title: 'Destinatarios y transferencias' },
    { id: 'derechos', title: 'Tus derechos' },
    { id: 'conservacion', title: 'Conservación' },
    { id: 'cookies', title: 'Cookies y almacenamiento local' },
    { id: 'terceros', title: 'Enlaces a terceros' },
    { id: 'seguridad', title: 'Seguridad' },
    { id: 'menores', title: 'Menores de 18 años' },
    { id: 'autoridad', title: 'Autoridad de control' },
    { id: 'cambios', title: 'Cambios' },
    { id: 'ley', title: 'Ley aplicable y jurisdicción' },
    { id: 'contacto', title: 'Contacto' },
  ] as const;
}
