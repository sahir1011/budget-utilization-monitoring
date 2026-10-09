const PDFDocument = require('pdfkit');

// Neutralise spreadsheet formula injection and quote per RFC 4180.
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(columns, rows) {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(c.csv ? c.csv(r) : c.value(r))).join(','));
  return '﻿' + lines.join('\r\n'); // BOM so Excel opens UTF-8 correctly
}

/**
 * Render a paginated landscape table PDF.
 * columns: [{ header, width (fraction), value(row), align }]
 * meta: { title, subtitle, generatedBy, summaryLines: [] }
 */
function toPdf(columns, rows, meta) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true, info: { Title: meta.title } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const widths = columns.map((c) => c.width * usable);
    const bottom = doc.page.height - doc.page.margins.bottom - 20;

    doc.fillColor('#1f3a5f').fontSize(16).font('Helvetica-Bold').text(meta.title, left, 36);
    doc.fillColor('#555').fontSize(9).font('Helvetica').text(meta.subtitle || '', { width: usable });
    doc.text(`Generated ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST by ${meta.generatedBy}`);
    if (meta.summaryLines && meta.summaryLines.length) {
      doc.moveDown(0.4).fillColor('#111').font('Helvetica-Bold').fontSize(9.5);
      for (const line of meta.summaryLines) doc.text(line);
    }
    doc.moveDown(0.6);

    const drawHeader = () => {
      const y = doc.y;
      doc.rect(left, y - 2, usable, 18).fill('#1f3a5f');
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8.5);
      let x = left;
      columns.forEach((c, i) => {
        doc.text(c.header, x + 3, y + 3, { width: widths[i] - 6, align: c.align || 'left', lineBreak: false, ellipsis: true });
        x += widths[i];
      });
      doc.y = y + 18;
    };

    drawHeader();
    doc.font('Helvetica').fontSize(8);
    rows.forEach((r, idx) => {
      const values = columns.map((c) => String(c.value(r) ?? ''));
      const heights = values.map((v, i) => doc.heightOfString(v, { width: widths[i] - 6 }));
      const rowH = Math.max(14, Math.max(...heights) + 6);
      if (doc.y + rowH > bottom) {
        doc.addPage();
        doc.y = doc.page.margins.top;
        drawHeader();
        doc.font('Helvetica').fontSize(8);
      }
      const y = doc.y;
      if (idx % 2 === 0) doc.rect(left, y, usable, rowH).fill('#f2f5f9');
      doc.fillColor('#111');
      let x = left;
      values.forEach((v, i) => {
        doc.text(v, x + 3, y + 3, { width: widths[i] - 6, align: columns[i].align || 'left' });
        x += widths[i];
      });
      doc.y = y + rowH;
    });
    if (!rows.length) doc.fillColor('#555').text('No records for the selected filters.', left, doc.y + 6);

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fillColor('#888').fontSize(7.5).text(
        `AI-Based Budget Utilization Monitoring System  •  Page ${i + 1} of ${range.count}`,
        left,
        doc.page.height - doc.page.margins.bottom - 4,
        { width: usable, align: 'center', lineBreak: false }
      );
    }
    doc.end();
  });
}

module.exports = { toCsv, toPdf };
