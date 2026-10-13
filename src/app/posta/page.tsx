import { connection } from "next/server";
import { PageHeader } from "@/components/common";
import { MailInbox } from "@/components/mail/mail-inbox";
import { isMailConfigured } from "@/lib/mail/config";
import { listMail } from "@/server/mail-service";

export const metadata = { title: "Posta" };

export default async function MailPage({ searchParams }: PageProps<"/posta">) {
  await connection();
  const params = await searchParams;
  const showingHandled = params.tutte === "1";
  const mail = listMail(undefined, { includeHandled: showingHandled });

  return (
    <>
      <PageHeader
        title="Posta"
        description="Le mail di incarico, annullamento e cambio orario diventano proposte: nulla entra in calendario senza la tua conferma."
      />
      <MailInbox mail={mail} configured={isMailConfigured()} showingHandled={showingHandled} />
    </>
  );
}
