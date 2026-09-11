const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

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

test('يحافظ fallback على العنوان ويعالج XML المرئي فقط', async ({ page }) => {
  const sourcePath = path.resolve(__dirname, '../../assets/js/report-word-generator.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const reportDataIndex = source.indexOf('const reportData = getCleanReportData(report);');
  const titleIndex = source.indexOf("reportData.reportTitle = report.title || '';");
  const renderIndex = source.indexOf('documentTemplate.render(reportData);');

  expect(reportDataIndex).toBeGreaterThanOrEqual(0);
  expect(titleIndex).toBeGreaterThan(reportDataIndex);
  expect(renderIndex).toBeGreaterThan(titleIndex);

  const extract = (startToken, endToken) => {
    const start = source.indexOf(startToken);
    const end = source.indexOf(endToken, start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end).trim();
  };
  const helperSource = [
    extract('function replaceTokenAcrossWordRuns(', '\nfunction replaceHeaderTokenRuns('),
    extract('function replaceHeaderTokenRuns(', '\nfunction ensureEducationDepartmentSecondLine('),
    extract('function ensureEducationDepartmentSecondLine(', '\nfunction replaceRemainingReportTokens('),
    extract('function replaceRemainingReportTokens(', '\nasync function generateManagerReport(')
  ].join('\n');

  await page.goto('about:blank');
  await page.addScriptTag({
    content: `${helperSource}\nwindow.__reportHelpers = {replaceRemainingReportTokens};`
  });
  const result = await page.evaluate(() => {
    const helpers = window.__reportHelpers;
    const wordNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const contents = new Map([
      ['word/document.xml', `<w:document xmlns:w="${wordNs}"><w:body><w:p><w:r><w:t>{{school</w:t></w:r><w:r><w:t>DisplayName}}</w:t></w:r></w:p></w:body></w:document>`],
      ['word/header1.xml', `<w:hdr xmlns:w="${wordNs}"><w:p><w:r><w:t>{{educationDepartmentPrefix}}</w:t></w:r><w:r><w:t>{{educationDepartmentName}}</w:t></w:r></w:p></w:hdr>`],
      ['word/header2.xml', `<w:hdr xmlns:w="${wordNs}"><w:p><w:r><w:t>نص ثابت</w:t></w:r></w:p></w:hdr>`],
      ['word/header3.xml', `<w:hdr xmlns:w="${wordNs}"><w:p><w:r><w:t>““</w:t></w:r><w:r><w:t>educationDepartmentPrefix</w:t></w:r><w:r><w:t>””</w:t></w:r></w:p></w:hdr>`],
      ['word/footer1.xml', `<w:ftr xmlns:w="${wordNs}"><w:p><w:r><w:t>{{signatureRight</w:t></w:r><w:r><w:t>Role}}</w:t></w:r></w:p></w:ftr>`],
      ['word/styles.xml', `<w:styles xmlns:w="${wordNs}"><w:style><w:name w:val="{{schoolDisplayName}}"/></w:style></w:styles>`],
      ['word/settings.xml', `<w:settings xmlns:w="${wordNs}"/>`]
    ]);
    const original = new Map(contents);
    const writes = [];
    const zip = {
      files: Object.fromEntries([...contents.keys()].map(name => [name, {}])),
      file(name, value) {
        if(arguments.length === 2) {
          contents.set(name, value);
          writes.push(name);
          return this;
        }
        if(!contents.has(name)) return null;
        return {asText: () => contents.get(name)};
      }
    };

    helpers.replaceRemainingReportTokens(zip, {
      educationDepartmentPrefix: 'الإدارة العامة للتعليم بمنطقة',
      educationDepartmentName: 'المدينة المنورة',
      schoolDisplayName: 'متوسطة معن بن عدي',
      signatureRightRole: 'مدير المدرسة'
    });

    const header = new DOMParser().parseFromString(contents.get('word/header1.xml'), 'application/xml');
    return {
      splitPlaceholderReplaced: contents.get('word/document.xml').includes('متوسطة معن بن عدي')
        && !contents.get('word/document.xml').includes('{{school'),
      departmentSeparated: header.getElementsByTagNameNS(wordNs, 'br').length === 1,
      smartQuotePlaceholderReplaced: contents.get('word/header3.xml').includes('الإدارة العامة للتعليم بمنطقة')
        && !contents.get('word/header3.xml').includes('educationDepartmentPrefix'),
      footerPlaceholderReplaced: contents.get('word/footer1.xml').includes('مدير المدرسة'),
      untargetedXmlUnchanged: contents.get('word/styles.xml') === original.get('word/styles.xml')
        && contents.get('word/settings.xml') === original.get('word/settings.xml'),
      unchangedHeaderNotRewritten: contents.get('word/header2.xml') === original.get('word/header2.xml')
        && !writes.includes('word/header2.xml'),
      writes
    };
  });

  expect(result.splitPlaceholderReplaced).toBe(true);
  expect(result.departmentSeparated).toBe(true);
  expect(result.smartQuotePlaceholderReplaced).toBe(true);
  expect(result.footerPlaceholderReplaced).toBe(true);
  expect(result.untargetedXmlUnchanged).toBe(true);
  expect(result.unchangedHeaderNotRewritten).toBe(true);
  expect(result.writes.sort()).toEqual([
    'word/document.xml',
    'word/footer1.xml',
    'word/header1.xml',
    'word/header3.xml'
  ]);
});
