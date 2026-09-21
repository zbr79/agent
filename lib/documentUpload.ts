import type { DocumentAttachment } from "./documents/types";

export interface DocumentUploadResult {
  documents: DocumentAttachment[];
  errors: string[];
}

export function uploadDocuments(
  files: File[],
  onProgress?: (value: number) => void,
  onProcessing?: () => void
): Promise<DocumentUploadResult> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    let processingStarted = false;
    const markProcessing = () => {
      if (processingStarted) return;
      processingStarted = true;
      onProcessing?.();
    };
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    request.open("POST", "/api/documents");
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.upload.onloadend = () => {
      onProgress?.(100);
      markProcessing();
    };
    request.onreadystatechange = () => {
      if (request.readyState >= 2) markProcessing();
    };
    request.onerror = () => reject(new Error("Could not upload the document."));
    request.onload = () => {
      const body = request.response as
        | { documents?: DocumentAttachment[]; errors?: string[]; error?: string }
        | null;
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(body?.error || "Could not process the document."));
        return;
      }
      if (!body?.documents?.length) {
        reject(new Error("The server returned no processed documents."));
        return;
      }
      resolve({ documents: body.documents, errors: body.errors ?? [] });
    };
    request.send(form);
  });
}
