import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LEGAL_INFO } from './legal-info';

/** Términos y Condiciones de uso. Operator values come from LEGAL_INFO. */
@Component({
  selector: 'app-terms-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <main class="min-h-screen bg-background text-text">
      <article class="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 class="text-3xl font-semibold tracking-tight">Términos y Condiciones</h1>
        <p class="mt-2 text-sm text-text-muted">Última actualización: {{ info.lastUpdated }}</p>
        <p class="mt-6">
          Al acceder y usar {{ info.operator }} (en adelante, "Juntta" o "la plataforma"), aceptás
          estos Términos y Condiciones. Si no estás de acuerdo, te pedimos que no uses la
          plataforma.
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
          <section aria-labelledby="servicio">
            <h2 id="servicio" class="text-xl font-semibold">1. Descripción del servicio</h2>
            <p class="mt-2">
              Juntta es una plataforma para que organizadores de ferias y encuentros gestionen
              predios, planos, eventos, reservas de stands y cobros; para que los feriantes
              reserven y paguen stands; y para que los visitantes consulten un catálogo público de
              ferias y expositores. Juntta es la plataforma tecnológica: las ferias las organizan
              terceros independientes.
            </p>
          </section>

          <section aria-labelledby="roles">
            <h2 id="roles" class="text-xl font-semibold">2. Roles</h2>
            <ul class="mt-2 list-disc space-y-1 pl-6">
              <li>
                <strong>Organizador:</strong> quien crea y administra ferias y eventos en la
                plataforma y vende los stands.
              </li>
              <li>
                <strong>Feriante:</strong> quien es invitado por un organizador, reserva y paga
                stands y expone en sus eventos.
              </li>
              <li>
                <strong>Visitante:</strong> quien consulta el catálogo público sin necesidad de
                iniciar sesión.
              </li>
            </ul>
          </section>

          <section aria-labelledby="cuentas">
            <h2 id="cuentas" class="text-xl font-semibold">3. Cuentas</h2>
            <p class="mt-2">
              Las cuentas se crean solo por invitación de un organizador. El ingreso se realiza con
              tu cuenta de Google. Sos responsable de la actividad realizada desde tu cuenta y de
              mantener la seguridad de tu cuenta de Google. Si no encontramos una cuenta asociada a
              tu email, pedile una invitación al organizador.
            </p>
          </section>

          <section aria-labelledby="reservas">
            <h2 id="reservas" class="text-xl font-semibold">4. Reservas de stands</h2>
            <p class="mt-2">
              Al iniciar una reserva, el stand queda retenido de forma temporal hasta un
              vencimiento. Si el pago no se completa antes de ese vencimiento, la retención expira
              y el stand vuelve a estar disponible. La reserva se confirma cuando el pago se
              acredita.
            </p>
          </section>

          <section aria-labelledby="pagos">
            <h2 id="pagos" class="text-xl font-semibold">5. Pagos</h2>
            <p class="mt-2">
              Los pagos se procesan a través de Mercado Pago. Juntta no almacena datos de tu
              tarjeta. El organizador es el vendedor del stand y recibe el pago en su propia cuenta
              de Mercado Pago; Juntta no es parte de esa compraventa. Las devoluciones se rigen por
              la política del organizador y por las reglas de Mercado Pago, y debés reclamarlas al
              organizador.
            </p>
          </section>

          <section aria-labelledby="organizador">
            <h2 id="organizador" class="text-xl font-semibold">
              6. Responsabilidades del organizador
            </h2>
            <ul class="mt-2 list-disc space-y-1 pl-6">
              <li>
                Brindar información veraz y actualizada sobre su feria, predio, evento y stands.
              </li>
              <li>
                Cumplir la normativa aplicable al evento y contar con los permisos y habilitaciones
                necesarios.
              </li>
              <li>
                Vincular su propia cuenta de Mercado Pago y atender las devoluciones y reclamos.
              </li>
              <li>
                Tratar los datos de los feriantes conforme a la Política de Privacidad y a la ley.
              </li>
            </ul>
          </section>

          <section aria-labelledby="feriante">
            <h2 id="feriante" class="text-xl font-semibold">7. Responsabilidades del feriante</h2>
            <ul class="mt-2 list-disc space-y-1 pl-6">
              <li>Declarar razón social y CUIT verdaderos y mantener tu perfil actualizado.</li>
              <li>Presentar documentación válida y vigente cuando el organizador la requiera.</li>
              <li>Conducirte con respeto hacia el organizador, otros feriantes y visitantes.</li>
              <li>Cumplir las normas del evento y la normativa aplicable a tu actividad.</li>
            </ul>
          </section>

          <section aria-labelledby="documentos">
            <h2 id="documentos" class="text-xl font-semibold">8. Documentos subidos</h2>
            <p class="mt-2">
              Los documentos que subís los puede ver el organizador para revisarlos. Declarás que
              tenés derecho a subirlos y que son auténticos. Su tratamiento se rige por la
              <a routerLink="/privacidad" class="text-primary-strong underline"
                >Política de Privacidad</a
              >.
            </p>
          </section>

          <section aria-labelledby="uso">
            <h2 id="uso" class="text-xl font-semibold">9. Uso permitido</h2>
            <p class="mt-2">Te comprometés a usar la plataforma de forma lícita. Queda prohibido:</p>
            <ul class="mt-2 list-disc space-y-1 pl-6">
              <li>Intentar vulnerar, probar o evadir la seguridad de la plataforma.</li>
              <li>Extraer datos de forma masiva o usar bots sin autorización escrita.</li>
              <li>Publicar contenido ilegal, difamatorio o que infrinja derechos de terceros.</li>
              <li>Suministrar información falsa o suplantar la identidad de otra persona.</li>
            </ul>
          </section>

          <section aria-labelledby="propiedad">
            <h2 id="propiedad" class="text-xl font-semibold">10. Propiedad intelectual</h2>
            <p class="mt-2">
              La plataforma, su diseño y su código son de Juntta o de sus licenciantes. Las marcas
              y logotipos de terceros, como los de Google y Mercado Pago, pertenecen a sus
              respectivos titulares. El contenido que cargues sigue siendo tuyo; nos otorgás el
              permiso necesario para mostrarlo y procesarlo dentro del servicio.
            </p>
          </section>

          <section aria-labelledby="enlaces">
            <h2 id="enlaces" class="text-xl font-semibold">11. Enlaces y contenido de terceros</h2>
            <p class="mt-2">
              La plataforma puede enlazar a sitios o servicios de terceros. No controlamos su
              contenido ni sus políticas y no somos responsables por ellos.
            </p>
          </section>

          <section aria-labelledby="exactitud">
            <h2 id="exactitud" class="text-xl font-semibold">12. Exactitud del contenido</h2>
            <p class="mt-2">
              La información de ferias, planos, stands y expositores la carga cada organizador o
              feriante. La plataforma se ofrece "tal cual" y no garantizamos que esa información
              sea exacta, completa o esté actualizada.
            </p>
          </section>

          <section aria-labelledby="comunicaciones">
            <h2 id="comunicaciones" class="text-xl font-semibold">
              13. Formularios y comunicaciones
            </h2>
            <p class="mt-2">
              Los datos que ingresás en formularios y los que usamos para comunicarnos con vos
              (por ejemplo, invitaciones) se tratan según nuestra
              <a routerLink="/privacidad" class="text-primary-strong underline"
                >Política de Privacidad</a
              >.
            </p>
          </section>

          <section aria-labelledby="responsabilidad">
            <h2 id="responsabilidad" class="text-xl font-semibold">
              14. Limitación de responsabilidad
            </h2>
            <p class="mt-2">
              Juntta es la plataforma; las ferias y eventos son organizados por terceros. En la
              medida permitida por la ley, no respondemos por la realización, cancelación o
              condiciones de un evento, por las obligaciones entre organizador y feriante, ni por
              daños indirectos derivados del uso de la plataforma o de servicios de terceros.
            </p>
          </section>

          <section aria-labelledby="disponibilidad">
            <h2 id="disponibilidad" class="text-xl font-semibold">
              15. Disponibilidad, suspensión y baja
            </h2>
            <p class="mt-2">
              Procuramos que la plataforma esté disponible, pero no garantizamos un servicio
              ininterrumpido: puede haber mantenimientos o fallas. Podemos suspender o dar de baja
              una cuenta que incumpla estos términos o ponga en riesgo la plataforma o a otros
              usuarios.
            </p>
          </section>

          <section aria-labelledby="modificaciones">
            <h2 id="modificaciones" class="text-xl font-semibold">16. Modificaciones</h2>
            <p class="mt-2">
              Podemos modificar estos términos. La versión vigente estará siempre en esta página,
              con su fecha de última actualización. Si seguís usando la plataforma luego de los
              cambios, se entiende que los aceptás.
            </p>
          </section>

          <section aria-labelledby="ley">
            <h2 id="ley" class="text-xl font-semibold">17. Ley aplicable y jurisdicción</h2>
            <p class="mt-2">
              Estos términos se rigen por las leyes de la República Argentina. Cualquier
              controversia se someterá a {{ info.jurisdiction }}, sin perjuicio de las
              disposiciones legales imperativas, incluidas las de defensa del consumidor (Ley
              24.240) cuando resulten aplicables.
            </p>
          </section>

          <section aria-labelledby="contacto">
            <h2 id="contacto" class="text-xl font-semibold">18. Contacto</h2>
            <p class="mt-2">
              Para consultas sobre estos términos escribinos a
              <a [href]="'mailto:' + info.generalEmail" class="text-primary-strong underline">{{
                info.generalEmail
              }}</a
              >.
            </p>
          </section>
        </div>

        <p class="mt-10 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-6 text-sm">
          <a routerLink="/" class="text-primary-strong underline">Volver al inicio</a>
          <a routerLink="/privacidad" class="text-primary-strong underline"
            >Política de Privacidad</a
          >
        </p>
      </article>
    </main>
  `,
})
export class TermsPage {
  protected readonly info = LEGAL_INFO;
  protected readonly sections = [
    { id: 'servicio', title: 'Descripción del servicio' },
    { id: 'roles', title: 'Roles' },
    { id: 'cuentas', title: 'Cuentas' },
    { id: 'reservas', title: 'Reservas de stands' },
    { id: 'pagos', title: 'Pagos' },
    { id: 'organizador', title: 'Responsabilidades del organizador' },
    { id: 'feriante', title: 'Responsabilidades del feriante' },
    { id: 'documentos', title: 'Documentos subidos' },
    { id: 'uso', title: 'Uso permitido' },
    { id: 'propiedad', title: 'Propiedad intelectual' },
    { id: 'enlaces', title: 'Enlaces y contenido de terceros' },
    { id: 'exactitud', title: 'Exactitud del contenido' },
    { id: 'comunicaciones', title: 'Formularios y comunicaciones' },
    { id: 'responsabilidad', title: 'Limitación de responsabilidad' },
    { id: 'disponibilidad', title: 'Disponibilidad, suspensión y baja' },
    { id: 'modificaciones', title: 'Modificaciones' },
    { id: 'ley', title: 'Ley aplicable y jurisdicción' },
    { id: 'contacto', title: 'Contacto' },
  ] as const;
}
