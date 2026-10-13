import { connection } from "next/server";
import { PageHeader } from "@/components/common";
import { CourseForm } from "@/components/course/course-form";
import { isParserConfigured, type ParsedCourseDraft } from "@/lib/deepseek/parser";
import { formatTime } from "@/lib/dates";
import { getMail, type CalendarioAllegato } from "@/server/mail-service";
import { getDb } from "@/db";

export const metadata = { title: "Nuovo corso" };

/**
 * Righe orario e prelezione ricavate dal calendario allegato. Il modulo tiene
 * una fase sola: si compila con la prima, che è quella con cui il corso parte.
 * Gli eventuali periodi successivi li applica il pulsante "crea il corso col
 * calendario", oppure si aggiungono dopo con "cambia calendarizzazione".
 */
function datiDalCalendario(calendario: CalendarioAllegato, draft: ParsedCourseDraft) {
  const prima = calendario.phases[0];
  const primoBlocco = prima?.blocks[0];
  if (!prima || !primoBlocco) return {};
  return {
    startDate: prima.from,
    totalHours: calendario.totalMinutes / 60,
    schedule:
      draft.schedule.length > 0
        ? draft.schedule
        : [
            {
              days: primoBlocco.weekdays,
              startTime: formatTime(primoBlocco.startMin),
              endTime: formatTime(primoBlocco.endMin),
              startDate: null,
            },
          ],
    preLesson: calendario.preLesson
      ? {
          date: calendario.preLesson.date,
          startTime: formatTime(calendario.preLesson.startMin),
          endTime: formatTime(calendario.preLesson.endMin),
        }
      : draft.preLesson,
  };
}

export default async function NewCoursePage({ searchParams }: PageProps<"/corsi/nuovo">) {
  await connection();
  const params = await searchParams;
  // Arrivando da una mail in "Posta" il modulo parte già compilato.
  const mailId = typeof params.mail === "string" ? Number(params.mail) : NaN;
  const mail = Number.isInteger(mailId) && mailId > 0 ? getMail(getDb(), mailId) : null;
  const proposta = mail?.proposal.kind === "NUOVO_CORSO" ? mail.proposal : null;
  // Il numero d'incarico scritto sul contratto vince su quello letto nella mail;
  // i giorni, quando la mail rimanda al calendario allegato, li detta il PDF.
  const calendario = proposta?.calendar ?? null;
  const draft = proposta
    ? {
        ...proposta.draft,
        assignmentNumber: proposta.contract?.assignmentNumber || proposta.draft.assignmentNumber,
        ...(calendario ? datiDalCalendario(calendario, proposta.draft) : {}),
      }
    : undefined;

  return (
    <>
      <PageHeader
        title="Nuovo corso"
        description={
          draft
            ? `Dati letti dalla mail «${mail!.subject}»: verificali prima di salvare.`
            : "Compila i dati oppure incolla la mail di assegnazione e verifica i campi estratti."
        }
      />
      <CourseForm
        parserConfigured={isParserConfigured()}
        initialDraft={draft}
        initialFeeCents={proposta?.contract?.feeCents ?? null}
        mailId={draft ? mail!.id : undefined}
      />
    </>
  );
}
