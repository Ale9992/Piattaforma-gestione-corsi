import { connection } from "next/server";
import { PageHeader } from "@/components/common";
import { ReportView } from "@/components/report/report-view";
import { todayInRome } from "@/lib/dates";
import { listReportRows } from "@/server/queries";

export const metadata = { title: "Report" };

export default async function ReportPage() {
  await connection();
  return (
    <>
      <PageHeader title="Report" description="Riepilogo per anno e per mese, con ore svolte e importi dei corsi." />
      <ReportView rows={listReportRows()} today={todayInRome()} />
    </>
  );
}
