export interface DocumentSource {
  locator: string;
  label: string;
  text: string;
}

export interface DocumentAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  text: string;
  sources: DocumentSource[];
}

export interface ExtractedDocument {
  text: string;
  sources: DocumentSource[];
}
