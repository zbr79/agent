import { normalizeAttachmentName } from "./limits";

interface NamedImage {
  name?: string;
}

interface NamedDocument {
  name: string;
}

export function hasDuplicateAttachmentNames(
  images: readonly NamedImage[] = [],
  documents: readonly NamedDocument[] = []
): boolean {
  const names = new Set<string>();
  for (const item of [...images, ...documents]) {
    const name = normalizeAttachmentName(item.name ?? "");
    if (!name) continue;
    if (names.has(name)) return true;
    names.add(name);
  }
  return false;
}
