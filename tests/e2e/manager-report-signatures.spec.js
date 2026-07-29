const { test, expect } = require('@playwright/test');

const templateCases = [
  { name: 'academic-achievement-committee.docx', leftName: 'محمد أحمد' },
  { name: 'school-guard-assignment.docx', leftName: 'خالد عبدالله' }
];
const localBaseUrl = 'http://127.0.0.1:4173';

test('تستبدل قوالب المدير حقول التوقيع الأربعة بالنص العربي', async ({ page }) => {
  await page.goto(`${localBaseUrl}/index.html`);
  await page.addScriptTag({ url: `${localBaseUrl}/assets/vendor/pizzip-3.2.0.min.js` });
  await page.addScriptTag({ url: `${localBaseUrl}/assets/vendor/docxtemplater-3.69.0.js` });

  const results = await page.evaluate(async cases => Promise.all(cases.map(async templateCase => {
    const reportData = {
      schoolName: 'ابتدائية الاختبار',
      schoolStage: 'ابتدائية',
      schoolDisplayName: 'ابتدائية الاختبار',
      educationDepartment: 'إدارة التعليم بمنطقة الاختبار',
      educationDepartmentPrefix: 'الإدارة العامة للتعليم بمنطقة',
      educationDepartmentName: 'الاختبار',
      ministryNumber: '123456',
      principalName: 'مازن الحرساني',
      educationalAffairsAgent: templateCase.leftName,
      studentAffairsAgent: '',
      schoolAffairsAgent: '',
      activityLeaderName: '',
      signatureRightRole: 'مدير المدرسة',
      signatureRightName: 'مازن الحرساني',
      signatureLeftRole: 'وكيل الشؤون التعليمية',
      signatureLeftName: templateCase.leftName
    };

    const response = await fetch(`/assets/report-templates/manager-reports/${templateCase.name}`);
    if(!response.ok) throw new Error(`تعذر تحميل القالب ${templateCase.name}`);

    const zip = new window.PizZip(await response.arrayBuffer());
    const documentTemplate = new window.docxtemplater(zip, {
      delimiters: { start: '{{', end: '}}' },
      paragraphLoop: true,
      linebreaks: true,
      nullGetter() {
        return '';
      }
    });
    documentTemplate.render(reportData);

    const output = documentTemplate.getZip().generate({ type: 'uint8array' });
    const reopened = new window.PizZip(output);
    const documentXml = reopened.file('word/document.xml').asText();
    const parsed = new DOMParser().parseFromString(documentXml, 'application/xml');
    const parserError = parsed.querySelector('parsererror');
    const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const text = Array.from(parsed.getElementsByTagNameNS(
      wordNamespace,
      't'
    ), node => node.textContent || '').join('');
    const leftSignatureBlocks = Array.from(
      parsed.getElementsByTagNameNS(wordNamespace, 'p')
    ).filter(paragraph => paragraph.getElementsByTagNameNS(wordNamespace, 'p').length === 0)
      .map(paragraph => {
        const parts = [];
        const visit = node => {
          if(node.namespaceURI === wordNamespace && node.localName === 't') {
            parts.push(node.textContent || '');
          } else if(node.namespaceURI === wordNamespace && node.localName === 'br') {
            parts.push('\n');
          }
          Array.from(node.childNodes).forEach(visit);
        };
        visit(paragraph);
        return parts.join('');
      }).filter(value => value.includes(reportData.signatureLeftRole)
        && value.includes(reportData.signatureLeftName));

    return {
      name: templateCase.name,
      expectedLeftName: templateCase.leftName,
      validXml: !parserError,
      hasContentTypes: Boolean(reopened.file('[Content_Types].xml')),
      hasRelationships: Boolean(reopened.file('_rels/.rels')),
      leftSignatureBlocks,
      text
    };
  })), templateCases);

  for(const result of results) {
    expect(result.validXml, `${result.name}: document.xml صالح`).toBe(true);
    expect(result.hasContentTypes, `${result.name}: بنية DOCX موجودة`).toBe(true);
    expect(result.hasRelationships, `${result.name}: علاقات DOCX موجودة`).toBe(true);
    expect(result.text, `${result.name}: دور التوقيع الأيمن`).toContain('مدير المدرسة');
    expect(result.text, `${result.name}: اسم التوقيع الأيمن`).toContain('مازن الحرساني');
    expect(result.text, `${result.name}: دور التوقيع الأيسر`).toContain('وكيل الشؤون التعليمية');
    expect(result.text, `${result.name}: اسم التوقيع الأيسر`).toContain(result.expectedLeftName);
    expect(result.leftSignatureBlocks.length, `${result.name}: نسختا DrawingML وVML`).toBeGreaterThanOrEqual(2);
    for(const block of result.leftSignatureBlocks) {
      expect(block, `${result.name}: الاسم الأيسر في سطر مستقل`).toContain(
        `وكيل الشؤون التعليمية\n${result.expectedLeftName}`
      );
    }
    expect(result.text, `${result.name}: لا تبقى placeholders`).not.toContain('{{');
  }
});
