import CorrectionDemo from "./panel";
import { correctionDocument, correctionInvoices } from "@/lib/correction-fixtures";

export const metadata = { title: "Anna’s monthly settlement · Correction demo" };
export default function Page() { return <CorrectionDemo sample={correctionDocument} invoices={correctionInvoices} />; }
