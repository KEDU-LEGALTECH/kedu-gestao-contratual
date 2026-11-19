import { CheckCircle2, AlertCircle } from "lucide-react";
import { demandReport, type ReportItem } from "../shared/demand-report";

const groups: { kind: ReportItem["kind"]; title: string }[] = [
  { kind: "erro", title: "Erros para corrigir" },
  { kind: "pendencia", title: "Pendências" },
  { kind: "aviso", title: "Avisos" },
];

/** First block of a demand: situation, reason, every pending item and the next step. */
export function DemandReport({ job, intake }: { job: any; intake?: any }) {
  const report = demandReport(job, intake);
  if (!report) return null;
  const clean = report.situation === "Sem erros";
  return <div className="demand-report">
   <div className="simple-result-heading">{clean ? <CheckCircle2 size={26}/> : <AlertCircle size={26}/>}<div><h2>{report.situation}</h2><p>{report.reason}</p></div></div>
   <p className="demand-report-next"><strong>Próximo passo:</strong> {report.next}</p>
   {groups.map(group => {
    const items = report.items.filter(item => item.kind === group.kind);
    return !!items.length && <details key={group.kind} className={"pending-groups report-" + group.kind} open={group.kind !== "aviso" && items.length <= 6}>
     <summary>{group.title} ({items.length})</summary>
     <ul className="simple-issues">{items.map((item, n) => <li key={group.kind + n}><strong>{item.title}</strong><p>{item.detail}</p>{item.action && <p><strong>Próxima ação:</strong> {item.action}</p>}{item.source && <small>Arquivo: {item.source}</small>}</li>)}</ul>
    </details>;
   })}
  </div>;
}
