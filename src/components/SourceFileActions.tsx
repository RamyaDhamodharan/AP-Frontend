import { useEffect, useState } from "react";
import axios from "axios";
import { Download, ExternalLink } from "lucide-react";
import { isDocxFilename } from "../uploadLimits";
import { sourceFileActionAvailability } from "../sourceFileActions";
import { userFacingErrorMessage } from "../errorMessages";

export function SourceFileActions({ sourceDocumentId, coreUrl, authHeaders, onView, onDownload, onError }: { sourceDocumentId?: string | null; coreUrl: string; authHeaders: () => { Authorization: string }; onView: (id: string) => void; onDownload: (id: string) => void; onError?: (message: string) => void }) {
  const [filename, setFilename] = useState("");
  const { disabled, title } = sourceFileActionAvailability(sourceDocumentId);
  const valid = !disabled;
  useEffect(() => { let live = true; setFilename(""); if (!valid || !sourceDocumentId) return; axios.get<{ original_filename?: string }>(`${coreUrl}/api/documents/${sourceDocumentId}`, { headers: authHeaders() }).then(response => { if (live) setFilename(response.data.original_filename || ""); }).catch(error => { if (live) onError?.(userFacingErrorMessage(error)); }); return () => { live = false; }; }, [sourceDocumentId, coreUrl, authHeaders, valid, onError]);
  const docx = isDocxFilename(filename);
  return <div className="source-file-actions"><button type="button" className="secondary" title={title} disabled={disabled} onClick={() => sourceDocumentId && onView(sourceDocumentId)}>{docx ? <Download size={18} strokeWidth={1.75}/> : <ExternalLink size={18} strokeWidth={1.75}/>} {docx ? "Download to view" : "View original"}</button><button type="button" className="secondary" title={title} disabled={disabled} onClick={() => sourceDocumentId && onDownload(sourceDocumentId)}><Download size={18} strokeWidth={1.75}/> Download</button></div>;
}
