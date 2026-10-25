import { Download, Eye } from "lucide-react";
import { sourceFileActionAvailability } from "../sourceFileActions";

export function SourceFileActions({ sourceDocumentId, onView, onDownload }: { sourceDocumentId?: string | null; coreUrl?: string; authHeaders?: () => { Authorization: string }; onView: (id: string) => void; onDownload: (id: string) => void }) {
  const { disabled, title } = sourceFileActionAvailability(sourceDocumentId);
  return <div className="source-file-actions"><button type="button" className="secondary" title={title} disabled={disabled} onClick={() => sourceDocumentId && onView(sourceDocumentId)}><Eye size={18} strokeWidth={1.75}/> View document</button><button type="button" className="secondary" title={title} disabled={disabled} onClick={() => sourceDocumentId && onDownload(sourceDocumentId)}><Download size={18} strokeWidth={1.75}/> Download</button></div>;
}
