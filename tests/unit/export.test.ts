import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildXlsx, sheetToCsv, type ExportBundleData, type Sheet } from "../../server/export/build.ts";
import { U, bundleByLabel, makeApp } from "../helpers.ts";

const hostile = '=HYPERLINK("http://evil.example/x","Click for refund")';
const sheet = (name: string): Sheet => ({
  name, headers: ["Bundle", "Supplier", "Invoice total", "Note"], numeric: [2],
  rows: [["B99", hostile, "1234.50", "+cmd|' /C calc'!A0"], ["B98", "Normal Co", "-12.50", "@SUM(1+1)"]],
});
const data: ExportBundleData = { summary: sheet("Summary"), lines: sheet("Line match"), exceptions: sheet("Exceptions"), audit: sheet("Audit trail"), meta: [["Organisation", "=1+1"]] };

describe("export safety (AT-8)", () => {
  it("CSV: hostile cells are neutralised, genuine numbers stay numeric", () => {
    const csv = sheetToCsv(data.summary);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example/x"",""Click for refund"")"`);
    expect(csv).toContain("1234.50");
    expect(csv).toContain(",-12.50,"); // a real negative amount is not mangled
    expect(csv).toContain("'@SUM(1+1)");
    expect(csv).toContain("'+cmd");
  });
  it("XLSX: re-opens, keeps numbers numeric, and no text cell can be read as a formula", async () => {
    const buf = await buildXlsx(data, ["summary", "exceptions"]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["About this file", "Summary", "Exceptions"]);
    const ws = wb.getWorksheet("Summary")!;
    expect(ws.getCell("B2").value).toBe(`'${hostile}`);
    expect(typeof ws.getCell("C2").value).toBe("number");
    expect(ws.getCell("C2").value).toBe(1234.5);
    expect(ws.getCell("C3").value).toBe(-12.5);
    expect(ws.getCell("D3").value).toBe("'@SUM(1+1)");
    for (const w of wb.worksheets) w.eachRow((r) => r.eachCell((c) => { expect(typeof c.value === "object" && c.value !== null && "formula" in (c.value as object)).toBe(false); }));
    const about = wb.getWorksheet("About this file")!;
    expect(about.getCell("B1").value).toMatch(/No payment was made/);
    expect(about.getCell("B2").value).toBe("'=1+1"); // even metadata is neutralised
  });
  it("end to end: a hostile supplier name in an uploaded invoice cannot become a formula in the exception record", async () => {
    const t = makeApp();
    const s = t.as(U.harbor, "controller");
    await s.post("/api/demo/load");
    const b = await bundleByLabel(s, "B05");
    const inv = b.documents.find((d: any) => d.role === "invoice");
    expect((await s.put(`/api/documents/${inv.id}/fields/supplierName`, { value: hostile, reason: "test hostile name" })).status).toBe(200);
    const r = await s.post("/api/exports", { kind: "exception_record", format: "csv" });
    const csv = ((await s.get(`/api/exports/${r.data.exportId}/download`)).data as Buffer).toString("utf8");
    expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/m);
    expect(csv).toContain("'=HYPERLINK");
  });
});
