export const MAX_ATTACHMENTS = 3;

export function normalizeAttachmentName(name: string): string {
  return name.trim().toLocaleLowerCase();
}
