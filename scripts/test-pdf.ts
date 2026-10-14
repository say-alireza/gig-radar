import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import master from '../resume/master.json';
import { tailorResume, ResumeDoc } from '../src/resume/tailor';

export async function buildPdf(resume: ResumeDoc): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // Standard A4: 595.28 x 841.89 points
  const page = doc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();

  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const leftMargin = 38;
  const rightMargin = 38;
  const contentWidth = width - leftMargin - rightMargin;

  let y = height - 38;

  const colorPrimary = rgb(0.12, 0.17, 0.36); // #1F2B5B
  const colorText = rgb(0.13, 0.13, 0.13); // #222222
  const colorMuted = rgb(0.35, 0.35, 0.35); // #555555
  const colorLine = rgb(0.85, 0.85, 0.88);

  function wrap(text: string, font: any, size: number, maxW: number): string[] {
    const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const candidate = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(candidate, size) > maxW && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = candidate;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function drawSectionHeader(title: string) {
    y -= 12;
    page.drawText(title.toUpperCase(), {
      x: leftMargin,
      y,
      size: 10,
      font: fontBold,
      color: colorPrimary,
    });
    y -= 3;
    page.drawLine({
      start: { x: leftMargin, y },
      end: { x: width - rightMargin, y },
      thickness: 0.75,
      color: colorLine,
    });
    y -= 8;
  }

  // 1. Header (Name, Headline, Contacts)
  const name = resume.header.name || 'Alireza Rahimpanah';
  page.drawText(name, {
    x: leftMargin,
    y,
    size: 17,
    font: fontBold,
    color: colorPrimary,
  });
  y -= 14;

  const headline = resume.header.headline || 'Full-Stack Software Engineer';
  page.drawText(headline, {
    x: leftMargin,
    y,
    size: 10,
    font: fontBold,
    color: colorText,
  });
  y -= 12;

  const contacts = [
    resume.header.location,
    resume.header.email,
    resume.header.website,
    resume.header.github,
    resume.header.linkedin,
  ]
    .filter(Boolean)
    .join('  •  ');

  page.drawText(contacts, {
    x: leftMargin,
    y,
    size: 8.5,
    font: fontRegular,
    color: colorMuted,
  });
  y -= 6;

  // 2. Professional Summary
  if (resume.summary) {
    drawSectionHeader('Professional Summary');
    const lines = wrap(resume.summary, fontRegular, 8.5, contentWidth);
    for (const line of lines) {
      page.drawText(line, { x: leftMargin, y, size: 8.5, font: fontRegular, color: colorText });
      y -= 10.5;
    }
  }

  // 3. Technical Skills
  if (resume.skills && resume.skills.length) {
    drawSectionHeader('Technical Skills');
    for (const group of resume.skills) {
      const items = (group.items || []).join(', ');
      const prefix = `${group.category}: `;
      const prefixWidth = fontBold.widthOfTextAtSize(prefix, 8.5);

      const remainingWidth = contentWidth - prefixWidth;
      const wrappedItems = wrap(items, fontRegular, 8.5, remainingWidth);

      page.drawText(prefix, { x: leftMargin, y, size: 8.5, font: fontBold, color: colorText });
      page.drawText(wrappedItems[0] || '', {
        x: leftMargin + prefixWidth,
        y,
        size: 8.5,
        font: fontRegular,
        color: colorText,
      });
      y -= 10;

      for (let i = 1; i < wrappedItems.length; i++) {
        page.drawText(wrappedItems[i], {
          x: leftMargin + prefixWidth,
          y,
          size: 8.5,
          font: fontRegular,
          color: colorText,
        });
        y -= 10;
      }
    }
  }

  // 4. Professional Experience
  if (resume.experience && resume.experience.length) {
    drawSectionHeader('Professional Experience');
    for (const exp of resume.experience) {
      const roleCompany = `${exp.title} — ${exp.company}`;
      const datesLoc = [exp.location, [exp.start, exp.end].filter(Boolean).join(' - ')].filter(Boolean).join('  |  ');

      page.drawText(roleCompany, { x: leftMargin, y, size: 9, font: fontBold, color: colorText });
      const rightWidth = fontRegular.widthOfTextAtSize(datesLoc, 8);
      page.drawText(datesLoc, {
        x: width - rightMargin - rightWidth,
        y,
        size: 8,
        font: fontRegular,
        color: colorMuted,
      });
      y -= 10.5;

      for (const bullet of exp.bullets || []) {
        const text = typeof bullet === 'string' ? bullet : bullet.text;
        if (!text) continue;
        const bulletLines = wrap(text, fontRegular, 8.5, contentWidth - 12);
        page.drawText('•', { x: leftMargin + 2, y, size: 8.5, font: fontRegular, color: colorPrimary });
        for (let i = 0; i < bulletLines.length; i++) {
          page.drawText(bulletLines[i], {
            x: leftMargin + 12,
            y,
            size: 8.5,
            font: fontRegular,
            color: colorText,
          });
          y -= 10;
        }
      }
      y -= 2;
    }
  }

  // 5. Key Projects
  const projects = (resume.projects || []).slice(0, 2);
  if (projects.length) {
    drawSectionHeader('Key Projects');
    for (const proj of projects) {
      const stack = (proj.stack || []).join(' · ');
      const headerText = `${proj.name}${stack ? ' — ' + stack : ''}`;
      page.drawText(headerText, { x: leftMargin, y, size: 9, font: fontBold, color: colorText });
      if (proj.year) {
        const yrW = fontRegular.widthOfTextAtSize(proj.year, 8);
        page.drawText(proj.year, { x: width - rightMargin - yrW, y, size: 8, font: fontRegular, color: colorMuted });
      }
      y -= 10;

      for (const bullet of proj.bullets || []) {
        const text = typeof bullet === 'string' ? bullet : bullet.text;
        if (!text) continue;
        const bulletLines = wrap(text, fontRegular, 8.5, contentWidth - 12);
        page.drawText('•', { x: leftMargin + 2, y, size: 8.5, font: fontRegular, color: colorPrimary });
        for (const line of bulletLines) {
          page.drawText(line, { x: leftMargin + 12, y, size: 8.5, font: fontRegular, color: colorText });
          y -= 10;
        }
      }
      y -= 2;
    }
  }

  // 6. Education
  if (resume.education && resume.education.length) {
    drawSectionHeader('Education');
    for (const edu of resume.education) {
      const title = `${edu.degree} — ${edu.school}`;
      const yrs = [edu.start, edu.end].filter(Boolean).join(' - ');
      page.drawText(title, { x: leftMargin, y, size: 8.5, font: fontBold, color: colorText });
      if (yrs) {
        const yrW = fontRegular.widthOfTextAtSize(yrs, 8);
        page.drawText(yrs, { x: width - rightMargin - yrW, y, size: 8, font: fontRegular, color: colorMuted });
      }
      y -= 10;
    }
  }

  return await doc.save();
}

async function test() {
  const result = await tailorResume({ master, jd: 'React, Next.js, Django, TypeScript' });
  const pdfBytes = await buildPdf(result.resume);
  console.log('PDF rendered successfully! Total bytes:', pdfBytes.length);
}

if (process.argv[1]?.endsWith('test-pdf.ts')) {
  test().catch(console.error);
}
