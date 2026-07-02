import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  SectionType,
  AlignmentType,
} from "docx";

export interface ResumeStructure {
  name: string;
  tagline: string;
  contact: {
    email: string;
    phone: string;
    location: string;
    linkedin?: string;
    portfolio?: string;
  };
  professionalSummary: string;
  coreCompetencies: {
    technical: string[];
    operations: string[];
    leadership: string[];
  };
  professionalExperience: {
    title: string;
    company: string;
    location: string;
    startDate: string;
    endDate: string;
    bullets: string[];
  }[];
  technicalProficiencies: string[];
  certifications: string[];
}

/**
 * Generate a DOCX document matching the template format from the user's
 * Butterfield_DrTavel_ContentCreator_Resume.docx, Butterfield_Ecommerce_Resume.docx,
 * and Butterfield_PinkBlush_Fulfillment_Resume.docx
 */
export function createDocxFromStructure(resume: ResumeStructure): Document {
  const children: Paragraph[] = [];

  // Name - centered, large
  if (resume.name) {
    children.push(
      new Paragraph({
        text: resume.name,
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
      })
    );
  }

  // Tagline - centered, smaller
  if (resume.tagline) {
    children.push(
      new Paragraph({
        text: resume.tagline,
        alignment: AlignmentType.CENTER,
        spacing: { after: 50 },
        style: "Subtitle",
      })
    );
  }

  // Contact line - centered, pipe-separated
  if (resume.contact) {
    const contactParts = [
      resume.contact.email,
      resume.contact.phone,
      resume.contact.location,
      resume.contact.linkedin,
      resume.contact.portfolio,
    ].filter(Boolean);
    if (contactParts.length > 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: contactParts.join(" | "),
              size: 18,
              font: "Calibri Light",
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
        })
      );
    }
  }

  // PROFESSIONAL SUMMARY section
  if (resume.professionalSummary) {
    children.push(
      new Paragraph({
        text: "PROFESSIONAL SUMMARY",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      })
    );
    children.push(
      new Paragraph({
        text: resume.professionalSummary,
        spacing: { after: 200 },
        style: "Normal",
      })
    );
  }

  // CORE COMPETENCIES section with categories
  if (resume.coreCompetencies) {
    children.push(
      new Paragraph({
        text: "CORE COMPETENCIES",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 100, after: 100 },
      })
    );

    // Technical category
    if (resume.coreCompetencies.technical?.length > 0) {
      children.push(createCategoryLine("Technical", resume.coreCompetencies.technical));
    }
    if (resume.coreCompetencies.operations?.length > 0) {
      children.push(createCategoryLine("Operations", resume.coreCompetencies.operations));
    }
    if (resume.coreCompetencies.leadership?.length > 0) {
      children.push(createCategoryLine("Leadership", resume.coreCompetencies.leadership));
    }
  }

  // PROFESSIONAL EXPERIENCE section
  if (resume.professionalExperience?.length > 0) {
    children.push(
      new Paragraph({
        text: "PROFESSIONAL EXPERIENCE",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 100, after: 100 },
      })
    );

    for (const exp of resume.professionalExperience) {
      // Title | Company | Location with dates
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${exp.title} | ${exp.company} | ${exp.location} ` }),
            new TextRun({
              text: `${exp.startDate} – ${exp.endDate}`,
              size: 20,
            }),
          ],
          spacing: { before: 100, after: 50 },
        })
      );

      // Bullets
      if (exp.bullets?.length > 0) {
        for (const bullet of exp.bullets) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `• ${bullet}`,
                }),
              ],
              spacing: { after: 50 },
              indent: { left: 300 },
            })
          );
        }
      }
    }
  }

  // TECHNICAL PROFICIENCIES section
  if (resume.technicalProficiencies?.length > 0) {
    children.push(
      new Paragraph({
        text: "TECHNICAL PROFICIENCIES",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      })
    );
    children.push(
      new Paragraph({
        text: resume.technicalProficiencies.join(", "),
        spacing: { after: 200 },
      })
    );
  }

  // CERTIFICATIONS & ACHIEVEMENTS section
  if (resume.certifications?.length > 0) {
    children.push(
      new Paragraph({
        text: "CERTIFICATIONS & ACHIEVEMENTS",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 100, after: 100 },
      })
    );
    for (const cert of resume.certifications) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `• ${cert}`,
            }),
          ],
          spacing: { after: 50 },
        })
      );
    }
  }

  return new Document({
    sections: [
      {
        properties: {
          type: SectionType.NEXT_PAGE,
          page: {
            size: {
              width: 11906, // A4 width in twips
              height: 16838, // A4 height in twips
            },
          },
        },
        children,
      },
    ],
    styles: {
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          run: {
            size: 22,
            font: "Calibri",
          },
          paragraph: {
            spacing: {
              line: 276, // 1.15 line spacing
            },
          },
        },
        {
          id: "Subtitle",
          name: "Subtitle",
          run: {
            size: 22,
            font: "Calibri Light",
            italics: true,
          },
        },
      ],
    },
  });
}

function createCategoryLine(category: string, items: string[]): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: `${category}: `,
        bold: true,
      }),
      new TextRun({
        text: items.join(", "),
      }),
    ],
    spacing: { after: 50 },
  });
}