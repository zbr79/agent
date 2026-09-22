import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { DocumentExtractionError, extractDocument } from "@/lib/documents/extract";

describe("document extraction", () => {
  it("extracts and labels plain text sources", async () => {
    const result = await extractDocument(
      "notes.txt",
      "text/plain",
      Buffer.from("First line\r\nSecond line\n")
    );
    expect(result.text).toContain("[notes.txt — Lines 1-2]");
    expect(result.text).toContain("First line\nSecond line");
    expect(result.sources).toEqual([
      {
        locator: "L1-L2",
        label: "Lines 1-2",
        text: "First line\nSecond line",
      },
    ]);
  });

  it("extracts spreadsheet rows with worksheet source labels", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Summary");
    sheet.addRow(["Name", "Value"]);
    sheet.addRow(["Alice", 42]);
    const buffer = await workbook.xlsx.writeBuffer();

    const result = await extractDocument(
      "data.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      new Uint8Array(buffer)
    );
    expect(result.text).toContain("[data.xlsx — Summary, row 1]");
    expect(result.text).toContain("Name | Value");
    expect(result.text).toContain("Alice | 42");
    expect(result.sources).toHaveLength(2);
  });

  it("uses the filename extension when the MIME type is missing", async () => {
    const result = await extractDocument("readme.txt", "", Buffer.from("hello"));
    expect(result.text).toContain("hello");
  });

  it("rejects unsupported or unreadable documents with a stable error", async () => {
    await expect(
      extractDocument("image.png", "image/png", Buffer.from("not a document"))
    ).rejects.toThrow(DocumentExtractionError);
    await expect(
      extractDocument(
        "broken.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Buffer.from("broken")
      )
    ).rejects.toThrow("Could not read broken.xlsx.");
  });
});
