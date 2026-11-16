// Draws one synthetic invoice onto a clean 1700x2200 canvas (US-Letter at ~200 dpi). Layout is driven by spec.style.
import { createCanvas } from "@napi-rs/canvas";

export const PAGE = { w: 1700, h: 2200, margin: 120 };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function formatDate(iso, fmt) {
  const [y, m, d] = iso.split("-");
  const mi = Number(m) - 1, di = Number(d);
  const mon = MONTHS[mi];
  switch (fmt) {
    case "iso": return iso;
    case "mdy-slash": return `${m}/${d}/${y}`;
    case "mdy-dash": return `${m}-${d}-${y}`;
    case "dmy-slash": return `${d}/${m}/${y}`;
    case "dmy-dot": return `${d}.${m}.${y}`;
    case "dmy-mon": return `${di} ${mon.slice(0, 3)} ${y}`;
    case "long": return `${mon} ${di}, ${y}`;
    case "mon-long": return `${mon.slice(0, 3)} ${di}, ${y}`;
    case "mon-abbr": return `${mon.slice(0, 3)}. ${di}, ${y}`;
    default: throw new Error(`unknown date format ${fmt}`);
  }
}
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

function group(intPart, sep) { return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep); }
export function num(d, locale, grouped = true) {
  const [i, f] = d.toFixed(2).split(".");
  const sep = locale === "eu" ? "." : ",";
  return `${grouped ? group(i, sep) : i}${locale === "eu" ? "," : "."}${f}`;
}
export function money(d, spec, inTable) {
  const st = spec.style, n = num(d, spec.locale, !(inTable && st.plainNumbers));
  if (inTable && !st.tableSymbol) return n;
  switch (st.money.pos) {
    case "prefix": return `${st.money.symbol}${n}`;
    case "suffix": return `${n} ${st.money.symbol}`;
    case "codePrefix": return `${spec.currency} ${n}`;
    case "suffixCode": return `${st.money.symbol}${n} ${spec.currency}`;
    default: throw new Error("unknown money position");
  }
}

function wrap(ctx, text, maxW) {
  const out = [];
  let cur = "";
  for (const word of text.split(" ")) {
    const t = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = word; } else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}

export function renderInvoice(spec, calc) {
  const { w: W, h: H, margin: M } = PAGE;
  const st = spec.style, L = st.labels;
  const canvas = createCanvas(W, H);
  const c = canvas.getContext("2d");
  const base = st.compact ? 26 : 31;
  const ink = "#1b1b1b", soft = "#555555";
  const up = (s) => (st.upper ? s.toUpperCase() : s);
  const font = (px, weight = "") => `${weight} ${px}px "${st.family}"`.trim();
  const text = (s, x, y, o = {}) => {
    c.font = font(o.size ?? base, o.weight ?? "");
    c.fillStyle = o.color ?? ink;
    c.textAlign = o.align ?? "left";
    c.fillText(s, x, y);
  };

  c.fillStyle = "#fdfcf9";
  c.fillRect(0, 0, W, H);

  const mainX = st.header === "sidebar" ? 470 : M;
  const right = W - M;
  const meta = [[L.invoiceNo, spec.invoiceNo], [L.date, formatDate(spec.date, st.dateFmt)]];
  if (spec.poRef) meta.push([L.poRef, spec.poRef]);
  if (st.header !== "left" && st.header !== "center" && st.header !== "sidebar") meta.push([L.taxId, spec.vendor.taxId]);
  if (spec.id === "S01" || spec.id === "S06") meta.push([spec.id === "S01" ? "Due Date" : "Payment due", formatDate(addDays(spec.date, 30), st.dateFmt)]);

  const vendorLines = (x, y, align, color = ink, sub = soft) => {
    const side = st.header === "sidebar";
    c.font = font(base * (side ? 1.35 : 1.75), "bold");
    const nameLines = side ? wrap(c, spec.vendor.name, 330) : [spec.vendor.name];
    nameLines.forEach((n, i) => text(n, x, y + i * base * 1.7, { size: base * (side ? 1.35 : 1.75), weight: "bold", color: side ? "#ffffff" : st.accent, align }));
    const top = y + (nameLines.length - 1) * base * 1.7;
    spec.vendor.addr.forEach((a, i) => text(a, x, top + base * 1.7 * (i + 1), { color: sub, align }));
    return top + base * 1.7 * (spec.vendor.addr.length + 1);
  };
  const metaBlock = (x, y, labelAlign, valueX, valueAlign = "left") => {
    meta.forEach(([k, v], i) => {
      text(`${up(k)}${st.header === "center" ? ":" : ""}`, x, y + i * base * 1.65, { color: soft, align: labelAlign, weight: "bold" });
      text(v, valueX, y + i * base * 1.65, { align: valueAlign });
    });
    return y + meta.length * base * 1.65;
  };

  let y;
  if (st.header === "left") {
    let vy = vendorLines(M, 190, "left");
    text(`${L.taxId}: ${spec.vendor.taxId}`, M, vy, { color: soft });
    text(up(st.title), right, 190, { size: 70, weight: "bold", color: st.accent, align: "right" });
    y = Math.max(metaBlock(1000, 260, "left", 1250), vy) + 70;
  } else if (st.header === "right") {
    text(up(st.title), M, 200, { size: 78, weight: "bold", color: st.accent });
    const vy = vendorLines(right, 170, "right");
    y = Math.max(metaBlock(M, 280, "left", M + 280), vy) + 70;
  } else if (st.header === "center") {
    text(spec.vendor.name, W / 2, 190, { size: base * 1.9, weight: "bold", align: "center" });
    spec.vendor.addr.forEach((a, i) => text(a, W / 2, 190 + base * 1.7 * (i + 1), { color: soft, align: "center" }));
    text(`${L.taxId}: ${spec.vendor.taxId}`, W / 2, 190 + base * 1.7 * 3, { color: soft, align: "center" });
    c.fillStyle = ink; c.fillRect(M, 380, W - 2 * M, 4);
    text(up(st.title), W / 2, 460, { size: 62, weight: "bold", align: "center" });
    y = metaBlock(W / 2 - 24, 540, "right", W / 2 + 24) + 60;
  } else {
    c.fillStyle = st.accent;
    c.fillRect(0, 0, 410, H);
    let vy = vendorLines(40, 200, "left", "#fff", "#e6eef5");
    text(`${L.taxId}`, 40, vy + 20, { color: "#cfe0ee", size: base * 0.9 });
    text(spec.vendor.taxId, 40, vy + 20 + base * 1.5, { color: "#ffffff" });
    text(up(st.title), mainX, 200, { size: 74, weight: "bold", color: st.accent });
    y = metaBlock(mainX, 290, "left", mainX + 330) + 70;
  }

  // bill-to
  text(up(L.billTo ?? "Bill To"), mainX, y, { weight: "bold", color: soft, size: base * 0.95 });
  text(spec.buyer.name, mainX, y + base * 1.7, { weight: "bold" });
  spec.buyer.addr.forEach((a, i) => text(a, mainX, y + base * 1.7 * (i + 2), { color: soft }));
  y += base * 1.7 * (spec.buyer.addr.length + 2) + 50;

  // line-item table
  const x0 = mainX, x1 = right, tw = x1 - x0;
  const rowH = base * 2.15, pad = 14;
  const colsX = [];
  let acc = x0;
  for (const col of st.cols) { colsX.push(acc); acc += col[2] * tw; }
  const cell = (ci, str, rowY, o = {}) => {
    const [, , frac, al] = st.cols[ci];
    const cw = frac * tw;
    let size = o.size ?? base;
    c.font = font(size, o.weight ?? "");
    while (c.measureText(str).width > cw - pad * 2 && size > base * 0.7) { size -= 1; c.font = font(size, o.weight ?? ""); }
    text(str, al === "r" ? colsX[ci] + cw - pad : colsX[ci] + pad, rowY + rowH * 0.66, { ...o, size, align: al === "r" ? "right" : "left" });
  };
  const headerH = rowH;
  if (st.table === "band") { c.fillStyle = st.accent; c.fillRect(x0, y, tw, headerH); }
  if (st.table === "grid") { c.fillStyle = "#e9ecef"; c.fillRect(x0, y, tw, headerH); }
  st.cols.forEach((col, i) => cell(i, up(col[1]), y, { weight: "bold", color: st.table === "band" ? "#ffffff" : ink, size: base * 0.95 }));
  const fieldText = (l, key) => {
    if (key === "price") return money(l.priceD, spec, true);
    if (key === "amount") return money(l.amount, spec, true);
    if (key === "disc") return l.disc ? `${l.disc}%` : "";
    if (key === "qty") return String(l.qty);
    return key === "desc" ? l.desc : (l[key] ?? "");
  };
  calc.lines.forEach((l, r) => {
    const ry = y + headerH + r * rowH;
    if (st.table === "zebra" && r % 2 === 0) { c.fillStyle = "rgba(0,0,0,0.06)"; c.fillRect(x0, ry, tw, rowH); }
    st.cols.forEach((col, i) => cell(i, fieldText(l, col[0]), ry));
  });
  const tableBottom = y + headerH + calc.lines.length * rowH;
  c.strokeStyle = "#444"; c.lineWidth = 2;
  if (st.table === "grid") {
    c.strokeRect(x0, y, tw, tableBottom - y);
    for (let r = 0; r <= calc.lines.length; r++) { c.beginPath(); c.moveTo(x0, y + headerH + r * rowH); c.lineTo(x1, y + headerH + r * rowH); c.stroke(); }
    colsX.slice(1).forEach((cx) => { c.beginPath(); c.moveTo(cx, y); c.lineTo(cx, tableBottom); c.stroke(); });
  } else {
    c.strokeStyle = st.table === "band" ? "#9aa5b1" : "#555";
    const lineYs = st.table === "zebra" ? [y + headerH, tableBottom] : [y, y + headerH, ...calc.lines.map((_, r) => y + headerH + (r + 1) * rowH)];
    for (const ly of lineYs) { c.beginPath(); c.moveTo(x0, ly); c.lineTo(x1, ly); c.stroke(); }
  }

  // totals block (right aligned)
  let ty = tableBottom + 60;
  const lx = x1 - 600, step = base * 1.75;
  const rate = (s) => (s.endsWith(".0") ? s.slice(0, -2) : s);
  const taxLabel = (st.ratePattern ?? "{label} ({rate}%)").replace("{label}", L.tax).replace("{rate}", rate(spec.taxRatePct));
  const rows = [[L.subtotal, money(calc.subtotal, spec, false)]];
  if (calc.discountTotal) rows.push([`${L.discount}${st.discountShowsRate ? ` (${spec.discountPct}%)` : ""}`, `-${money(calc.discountTotal, spec, false)}`]);
  if (calc.freight) rows.push([L.freight, money(calc.freight, spec, false)]);
  rows.push([taxLabel, money(calc.taxTotal, spec, false)]);
  for (const [k, v] of rows) { text(up(k), lx, ty, { color: soft }); text(v, x1, ty, { align: "right" }); ty += step; }
  c.fillStyle = ink; c.fillRect(lx, ty - step * 0.55, x1 - lx, 3);
  text(up(L.total), lx, ty + 14, { weight: "bold", size: base * 1.15 });
  text(money(calc.total, spec, false), x1, ty + 14, { weight: "bold", size: base * 1.15, align: "right" });
  ty += step * 1.7;

  // notes / payment details
  c.font = font(base * 0.95);
  let ny = Math.max(ty + 30, tableBottom + 60 + step * 5);
  for (const n of spec.notes) {
    for (const ln of wrap(c, n, tw)) { text(ln, mainX, ny, { color: soft, size: base * 0.95 }); ny += base * 1.55; }
    ny += base * 0.4;
  }
  text("Thank you for your business", mainX, H - 140, { color: soft, size: base * 0.9 });
  return canvas;
}
