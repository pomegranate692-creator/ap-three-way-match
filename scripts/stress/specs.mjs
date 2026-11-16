// Source data for the 10 synthetic stress-test invoices. Vendors, buyers and products are fictional.
// Ground truth is computed from these numbers (decimal arithmetic), never read back from the rendered image.
import Decimal from "decimal.js";

const D = (v) => new Decimal(v);
const r2 = (d) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** label sets are written the way each fictional vendor would print them, not tuned to the extractor's vocabulary */
export const SPECS = [
  {
    id: "S01", damage: "light", currency: "USD", locale: "us", dateOrder: "MDY",
    vendor: { name: "Quillfeather Print Works", addr: ["418 Mill Race Road", "Dayton, OH 45402"], taxId: "47-3318820" },
    buyer: { name: "Alder Street Cafe", addr: ["92 Alder Street", "Columbus, OH 43215"] },
    invoiceNo: "QF-30417", poRef: "PO-55102", date: "2026-03-14", taxRatePct: "8.25", freight: "24", discountPct: null,
    lines: [
      { sku: "PR-2201", desc: "Business cards matte box/500", qty: 12, uom: "BX", price: "38.40" },
      { sku: "PR-2210", desc: "Letterhead 24lb ream", qty: 20, uom: "RM", price: "21.75" },
      { sku: "PR-2230", desc: "Presentation folders", qty: 150, uom: "EA", price: "1.18" },
      { sku: "PR-2244", desc: "Die-cut stickers 3in", qty: 400, uom: "EA", price: "0.62" },
    ],
    notes: [],
    style: { family: "Helvetica", header: "left", table: "grid", accent: "#1f4e79", dateFmt: "mdy-slash", money: { pos: "prefix", symbol: "$" }, tableSymbol: false,
      title: "INVOICE", labels: { invoiceNo: "Invoice #", date: "Date", poRef: "PO Number", taxId: "EIN", subtotal: "Subtotal", tax: "Sales Tax", freight: "Shipping", total: "Total Due", discount: "Discount" },
      taxLabelShowsRate: true, cols: [["sku", "SKU", 0.15, "l"], ["desc", "Description", 0.38, "l"], ["qty", "Qty", 0.08, "r"], ["uom", "UOM", 0.09, "l"], ["price", "Unit Price", 0.15, "r"], ["amount", "Amount", 0.15, "r"]] },
  },
  {
    id: "S02", damage: "light", currency: "USD", locale: "us", dateOrder: "MDY",
    vendor: { name: "Tanager Hydro Supply", addr: ["2200 Cedar Flats Pkwy", "Boise, ID 83702"], taxId: "82-5540913" },
    buyer: { name: "Westlake Property Services", addr: ["15 Lakeview Terrace", "Meridian, ID 83642"] },
    invoiceNo: "TH-100823", poRef: "WL-4471-B", date: "2026-04-02", taxRatePct: "7", freight: null, discountPct: null,
    lines: [
      { sku: "HY-100", desc: "PVC elbow 2in", qty: 60, price: "3.85" },
      { sku: "HY-118", desc: "Ball valve brass 1in", qty: 24, price: "14.20" },
      { sku: "HY-203", desc: "Pipe cement 8oz", qty: 12, price: "6.95" },
      { sku: "HY-310", desc: "PTFE tape 3/4in", qty: 100, price: "0.89" },
      { sku: "HY-415", desc: "Sump pump 1/3HP", qty: 3, price: "189.00" },
    ],
    notes: ["Please quote the invoice number with your payment.", "Returns within 30 days are subject to a 15% restocking fee."],
    style: { family: "Georgia", header: "right", table: "zebra", accent: "#7a3b1d", dateFmt: "long", money: { pos: "prefix", symbol: "$" }, tableSymbol: false,
      title: "Invoice", labels: { invoiceNo: "Invoice No.", date: "Invoice Date", poRef: "Customer PO", taxId: "Tax ID", subtotal: "Subtotal", tax: "Tax", total: "Total" },
      taxLabelShowsRate: true, cols: [["sku", "Item", 0.13, "l"], ["desc", "Description", 0.41, "l"], ["qty", "Qty", 0.09, "r"], ["price", "Price", 0.18, "r"], ["amount", "Total", 0.19, "r"]] },
  },
  {
    id: "S03", damage: "light", currency: "USD", locale: "us", dateOrder: "MDY",
    vendor: { name: "Saltmarsh Freight Services", addr: ["Dock 7, 88 Harbor Way", "Portland, ME 04101"], taxId: "01-6620034" },
    buyer: { name: "Fennimore Marine Supply", addr: ["5 Wharf Lane", "Albany, NY 12207"] },
    invoiceNo: "SF/2026/00871", poRef: null, date: "2026-05-09", taxRatePct: "6", freight: null, discountPct: null,
    lines: [
      { sku: "SVC-LTL", desc: "LTL freight Boston-Albany", qty: 4, price: "312.50" },
      { sku: "SVC-LGT", desc: "Liftgate delivery", qty: 4, price: "45.00" },
      { sku: "SVC-FSC", desc: "Fuel surcharge", qty: 1, price: "128.40" },
    ],
    notes: ["Remit within 15 days. Late balances accrue 1.5% per month."],
    style: { family: "Menlo", header: "center", table: "rules", accent: "#222222", dateFmt: "iso", money: { pos: "codePrefix" }, tableSymbol: false,
      title: "INVOICE", upper: true, labels: { invoiceNo: "Invoice Number", date: "Date", taxId: "Tax ID", subtotal: "Subtotal", tax: "Tax", total: "Amount Due" },
      taxLabelShowsRate: true, cols: [["sku", "Code", 0.14, "l"], ["desc", "Service", 0.4, "l"], ["qty", "Qty", 0.08, "r"], ["price", "Rate", 0.18, "r"], ["amount", "Amount", 0.2, "r"]] },
  },
  {
    id: "S04", damage: "medium", currency: "EUR", locale: "eu", dateOrder: "DMY",
    vendor: { name: "Nordlicht Elektro GmbH", addr: ["Hafenstrasse 14", "24103 Kiel"], taxId: "DE811234567" },
    buyer: { name: "Hansen Gebaeudetechnik", addr: ["Ringstrasse 3", "20095 Hamburg"] },
    invoiceNo: "RE-2026-0418", poRef: "B-77120", date: "2026-03-21", taxRatePct: "19", freight: null, discountPct: null,
    lines: [
      { sku: "EL-4410", desc: "Kabel NYM-J 3x1,5 Ring 50m", qty: 12, uom: "ST", price: "58.90" },
      { sku: "EL-4420", desc: "Schalter Serie 55 weiss", qty: 40, uom: "ST", price: "4.35" },
      { sku: "EL-4455", desc: "Steckdose 2-fach", qty: 40, uom: "ST", price: "6.80" },
      { sku: "EL-5001", desc: "Verteilerkasten 24 TE", qty: 3, uom: "ST", price: "74.50" },
      { sku: "EL-5090", desc: "Sicherungsautomat B16", qty: 30, uom: "ST", price: "5.95" },
    ],
    notes: ["Zahlbar innerhalb von 14 Tagen ohne Abzug."],
    style: { family: "Avenir Next", header: "left", table: "zebra", accent: "#0b6e4f", dateFmt: "dmy-dot", money: { pos: "suffix", symbol: "€" }, tableSymbol: true,
      title: "Rechnung", labels: { billTo: "Kunde", invoiceNo: "Rechnungsnummer", date: "Rechnungsdatum", poRef: "Bestellnummer", taxId: "USt-IdNr.", subtotal: "Zwischensumme", tax: "MwSt.", total: "Gesamtbetrag" },
      taxLabelShowsRate: true, ratePattern: "{label} {rate} %", cols: [["sku", "Artikelnr.", 0.14, "l"], ["desc", "Bezeichnung", 0.36, "l"], ["qty", "Menge", 0.09, "r"], ["uom", "Einheit", 0.1, "l"], ["price", "Einzelpreis", 0.15, "r"], ["amount", "Betrag", 0.16, "r"]] },
  },
  {
    id: "S05", damage: "medium", currency: "GBP", locale: "us", dateOrder: "DMY",
    vendor: { name: "Brightwater Linen Co.", addr: ["Unit 4, Calder Mills", "Leeds LS11 9QT"], taxId: "GB284771903" },
    buyer: { name: "The Harrow Inn", addr: ["1 Market Row", "York YO1 7LZ"] },
    invoiceNo: "BL-55190", poRef: "HI-0098", date: "2026-02-27", taxRatePct: "20", freight: "18.50", discountPct: null,
    lines: [
      { sku: "LN-101", desc: "Table cloth white 90in", qty: 24, price: "14.80", disc: "10" },
      { sku: "LN-104", desc: "Napkins cotton pack/12", qty: 30, price: "9.45" },
      { sku: "LN-110", desc: "Bed sheet king", qty: 40, price: "17.20", disc: "10" },
      { sku: "LN-112", desc: "Pillowcase std pair", qty: 80, price: "6.35" },
      { sku: "LN-120", desc: "Bath towel 500gsm", qty: 60, price: "8.90" },
      { sku: "LN-121", desc: "Hand towel 500gsm", qty: 60, price: "4.75", disc: "10" },
      { sku: "LN-130", desc: "Laundry bag large", qty: 15, price: "11.00" },
      { sku: "LN-140", desc: "Mattress protector", qty: 20, price: "13.60" },
    ],
    notes: ["Payment by bank transfer to Brightwater Linen Co.", "Sort code 20-45-17, account 40081264.", "Goods remain our property until paid in full."],
    style: { family: "Trebuchet MS", header: "left", table: "grid", accent: "#6b2d5c", dateFmt: "dmy-mon", money: { pos: "prefix", symbol: "£" }, tableSymbol: false,
      title: "INVOICE", labels: { billTo: "Invoice to", invoiceNo: "Invoice No.", date: "Date of issue", poRef: "Order ref", taxId: "VAT No.", subtotal: "Net", tax: "VAT", freight: "Carriage", total: "Amount payable" },
      taxLabelShowsRate: true, ratePattern: "{label} @ {rate}%", cols: [["sku", "Part No.", 0.12, "l"], ["desc", "Description", 0.33, "l"], ["qty", "Qty", 0.07, "r"], ["price", "Price", 0.14, "r"], ["disc", "Disc %", 0.1, "r"], ["amount", "Net Total", 0.14, "r"]] },
  },
  {
    id: "S06", damage: "medium", currency: "CAD", locale: "us", dateOrder: "MDY",
    vendor: { name: "Pinecrest Bakery Wholesale", addr: ["77 Elm Industrial Ave", "Calgary, AB T2G 4H5"], taxId: "812345678RT0001" },
    buyer: { name: "Summit Ridge Lodge", addr: ["1 Ridge Road", "Banff, AB T1L 1B2"] },
    invoiceNo: "PB-20948", poRef: "SRL-331", date: "2026-06-03", taxRatePct: "5", freight: null, discountPct: null,
    lines: [
      { sku: "BK-010", desc: "Sourdough loaf 800g", qty: 120, uom: "EA", price: "4.10" },
      { sku: "BK-022", desc: "Croissant butter 70g", qty: 300, uom: "EA", price: "1.35" },
      { sku: "BK-031", desc: "Rye bread sliced", qty: 60, uom: "EA", price: "3.80" },
      { sku: "BK-045", desc: "Cinnamon roll tray/12", qty: 25, uom: "TR", price: "17.50" },
    ],
    notes: ["Delivered Tues/Fri before 6 a.m.", "Please count goods on receipt; shortages must be reported within 24 hours."],
    style: { family: "Tahoma", header: "right", table: "rules", accent: "#b5651d", dateFmt: "mon-long", money: { pos: "suffixCode", symbol: "$" }, tableSymbol: false,
      title: "Invoice", labels: { billTo: "Sold to", invoiceNo: "Invoice Number", date: "Invoice Date", poRef: "PO #", taxId: "GST No.", subtotal: "Subtotal", tax: "GST", total: "Total" },
      taxLabelShowsRate: true, cols: [["sku", "Item #", 0.13, "l"], ["desc", "Description", 0.37, "l"], ["qty", "Qty", 0.08, "r"], ["uom", "Unit", 0.08, "l"], ["price", "Unit Price", 0.16, "r"], ["amount", "Line Total", 0.18, "r"]] },
  },
  {
    id: "S07", damage: "medium", currency: "USD", locale: "us", dateOrder: "MDY",
    vendor: { name: "Kestrel Industrial Pumps Ltd", addr: ["1900 Ironworks Blvd", "Houston, TX 77003"], taxId: "74-2201186" },
    buyer: { name: "Gulfline Water Utility", addr: ["300 Bayou Street", "Galveston, TX 77550"] },
    invoiceNo: "KP-981204", poRef: "GWU-2026-114", date: "2026-07-18", taxRatePct: "9.5", freight: "85", discountPct: "5",
    lines: [
      { sku: "KP-7700", desc: "Centrifugal pump 2in", qty: 2, uom: "EA", price: "845.00" },
      { sku: "KP-7712", desc: "Mechanical seal kit", qty: 6, uom: "EA", price: "63.25" },
      { sku: "KP-7740", desc: "Impeller bronze", qty: 4, uom: "EA", price: "212.80" },
      { sku: "KP-7790", desc: "Gasket set", qty: 10, uom: "EA", price: "17.40" },
    ],
    notes: ["Terms: net 30. Warranty 12 months from shipment."],
    style: { family: "Palatino", header: "left", table: "band", accent: "#243b53", dateFmt: "mdy-dash", money: { pos: "prefix", symbol: "$" }, tableSymbol: true,
      title: "INVOICE", labels: { invoiceNo: "Invoice Number", date: "Date", poRef: "Reference PO", taxId: "Tax ID", subtotal: "Subtotal", discount: "Volume Discount", tax: "Sales Tax", freight: "Freight", total: "Total" },
      taxLabelShowsRate: true, discountShowsRate: true, cols: [["sku", "Item", 0.14, "l"], ["desc", "Description", 0.36, "l"], ["qty", "Qty", 0.08, "r"], ["uom", "UOM", 0.08, "l"], ["price", "Rate", 0.16, "r"], ["amount", "Amount", 0.18, "r"]] },
  },
  {
    id: "S08", damage: "heavy", currency: "AUD", locale: "us", dateOrder: "DMY",
    vendor: { name: "Marigold Organics Pty Ltd", addr: ["12 Bottlebrush Close", "Byron Bay NSW 2481"], taxId: "51824753556" },
    buyer: { name: "Seaview Grocer", addr: ["200 Marine Parade", "Newcastle NSW 2300"] },
    invoiceNo: "MO-77203", poRef: "SG-5521", date: "2026-08-11", taxRatePct: "10", freight: null, discountPct: null,
    lines: [
      { sku: "OR-101", desc: "Rolled oats 1kg", qty: 48, price: "3.20" },
      { sku: "OR-102", desc: "Almond butter 250g", qty: 36, price: "6.90" },
      { sku: "OR-110", desc: "Chia seeds 500g", qty: 24, price: "8.75" },
      { sku: "OR-115", desc: "Coconut oil 500ml", qty: 30, price: "9.40" },
      { sku: "OR-120", desc: "Maple syrup 250ml", qty: 24, price: "11.20" },
      { sku: "OR-133", desc: "Quinoa 1kg", qty: 20, price: "7.85" },
      { sku: "OR-140", desc: "Dried mango 200g", qty: 40, price: "4.95" },
      { sku: "OR-151", desc: "Peanut butter 380g", qty: 36, price: "4.30" },
      { sku: "OR-160", desc: "Green tea 50 bags", qty: 48, price: "3.65" },
      { sku: "OR-170", desc: "Honey raw 500g", qty: 24, price: "10.10" },
    ],
    notes: ["All amounts in AUD. Goods are GST inclusive where indicated."],
    style: { family: "Arial Narrow", header: "left", table: "rules", accent: "#c26a00", dateFmt: "dmy-slash", money: { pos: "prefix", symbol: "A$" }, tableSymbol: false, compact: true,
      title: "TAX INVOICE", labels: { invoiceNo: "Invoice no", date: "Date", poRef: "Customer order no", taxId: "ABN", subtotal: "Sub-total", tax: "GST", total: "Total AUD" },
      taxLabelShowsRate: true, cols: [["sku", "Code", 0.12, "l"], ["desc", "Product", 0.4, "l"], ["qty", "Qty", 0.08, "r"], ["price", "Price", 0.18, "r"], ["amount", "Amount", 0.18, "r"]] },
  },
  {
    id: "S09", damage: "heavy", currency: "EUR", locale: "eu", dateOrder: "DMY",
    vendor: { name: "Lumen Optics SA", addr: ["Calle del Cristal 21", "28014 Madrid"], taxId: "ESB12345678" },
    buyer: { name: "Vista Clara Opticians", addr: ["Plaza Mayor 8", "37002 Salamanca"] },
    invoiceNo: "LO-2026-3340", poRef: "VC-0612", date: "2026-09-05", taxRatePct: "21", freight: "35", discountPct: null,
    lines: [
      { sku: "OP-210", desc: "Lens blank 1.60 pair", qty: 80, price: "12.40" },
      { sku: "OP-215", desc: "Anti-glare coating", qty: 80, price: "3.15" },
      { sku: "OP-301", desc: "Frame titanium M", qty: 25, price: "38.00" },
      { sku: "OP-322", desc: "Lens cloth 10-pack", qty: 12, price: "6.90" },
      { sku: "OP-340", desc: "Case hard black", qty: 50, price: "2.45" },
    ],
    notes: ["Due date: 05/10/2026.", "Reverse charge does not apply."],
    style: { family: "Optima", header: "sidebar", table: "zebra", accent: "#14507a", dateFmt: "dmy-slash", money: { pos: "codePrefix" }, tableSymbol: false,
      title: "Invoice", labels: { billTo: "Customer", invoiceNo: "Invoice number", date: "Invoice date", poRef: "Order reference", taxId: "VAT ID", subtotal: "Net amount", tax: "VAT", freight: "Delivery", total: "Invoice total" },
      taxLabelShowsRate: true, ratePattern: "{label} {rate}%", cols: [["sku", "Ref.", 0.12, "l"], ["desc", "Description", 0.38, "l"], ["qty", "Qty", 0.09, "r"], ["price", "Unit", 0.19, "r"], ["amount", "Net", 0.19, "r"]] },
  },
  {
    id: "S10", damage: "heavy", currency: "USD", locale: "us", dateOrder: "MDY",
    vendor: { name: "Orchid & Slate Design Studio", addr: ["6 Foundry Court, Suite B", "Providence, RI 02903"], taxId: "05-7741208" },
    buyer: { name: "Granite Row Dental", addr: ["410 Bridge Street", "Warwick, RI 02886"] },
    invoiceNo: "OS-0291", poRef: "GR-17", date: "2026-10-23", taxRatePct: "6.5", freight: "40", discountPct: null,
    lines: [
      { sku: "OS-01", desc: "Brand guideline layout", qty: 1, price: "1800.00" },
      { sku: "OS-02", desc: "Logo variants set", qty: 3, price: "350.00" },
      { sku: "OS-05", desc: "Signage artwork", qty: 2, price: "420.00" },
      { sku: "OS-07", desc: "Brochure print-ready", qty: 1, price: "960.00" },
      { sku: "OS-09", desc: "Revision rounds", qty: 4, price: "85.00" },
      { sku: "OS-11", desc: "Stock photo licences", qty: 6, price: "29.50" },
    ],
    notes: ["Deposit of 50% received 2026-09-30 and applied to the project.", "Thank you!"],
    style: { family: "American Typewriter", header: "right", table: "grid", accent: "#3d3d3d", dateFmt: "mon-abbr", money: { pos: "prefix", symbol: "$" }, tableSymbol: false, plainNumbers: true,
      title: "Inv.", labels: { billTo: "Client", invoiceNo: "Inv. No.", date: "Date", poRef: "PO", taxId: "Tax ID", subtotal: "Sub total", tax: "Tax", freight: "Delivery", total: "Balance due" },
      taxLabelShowsRate: true, cols: [["sku", "No.", 0.1, "l"], ["desc", "Item", 0.42, "l"], ["qty", "Qty", 0.08, "r"], ["price", "Each", 0.19, "r"], ["amount", "Ext", 0.21, "r"]] },
  },
];

const has = (spec, key) => spec.style.cols.some((c) => c[0] === key);

/** Computes every printed number and the exact ground truth for one spec. */
export function compute(spec) {
  const lines = spec.lines.map((l) => {
    const disc = l.disc ? D(l.disc) : null;
    const gross = D(l.qty).times(l.price);
    const amount = r2(disc ? gross.times(D(100).minus(disc)).div(100) : gross);
    return { ...l, priceD: D(l.price), amount };
  });
  const subtotal = lines.reduce((s, l) => s.plus(l.amount), D(0));
  const discountTotal = spec.discountPct ? r2(subtotal.times(spec.discountPct).div(100)) : null;
  const freight = spec.freight ? D(spec.freight) : null;
  const taxBase = subtotal.minus(discountTotal ?? 0);
  const taxTotal = r2(taxBase.times(spec.taxRatePct).div(100));
  const total = taxBase.plus(freight ?? 0).plus(taxTotal);
  const s = (d) => (d === null ? null : d.toString());
  return {
    lines, subtotal, discountTotal, freight, taxTotal, total,
    gold: {
      docType: "INVOICE",
      fields: {
        docNumber: spec.invoiceNo, poRef: spec.poRef, supplierName: spec.vendor.name, supplierTaxId: spec.vendor.taxId,
        currency: spec.currency, docDate: spec.date, taxRate: spec.taxRatePct, subtotal: s(subtotal), discountTotal: s(discountTotal),
        freight: s(freight), taxTotal: s(taxTotal), total: s(total),
      },
      lines: lines.map((l) => ({
        sku: l.sku, description: l.desc, qty: String(l.qty), uom: has(spec, "uom") ? l.uom ?? null : null,
        unitPrice: D(l.price).toString(), discountPct: has(spec, "disc") ? l.disc ?? null : null, amount: s(l.amount),
      })),
    },
  };
}
