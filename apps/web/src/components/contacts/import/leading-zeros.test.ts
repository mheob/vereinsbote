import { describe, expect, it } from 'vite-plus/test';

import { keepLeadingZeros } from './leading-zeros';

const WORKBOOK = `<workbook xmlns:r="urn:r"><sheets>
<sheet name="Mitglieder" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const RELS = `<Relationships>
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
// `cellStyleXfs` and the conditional format in `dxfs` must not count: cells use neither.
const STYLES = `<styleSheet><numFmts count="2"><numFmt numFmtId="164" formatCode="00000"/>
<numFmt numFmtId="165" formatCode="#,##0"/></numFmts>
<cellStyleXfs count="1"><xf numFmtId="164"/></cellStyleXfs>
<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"><alignment/></xf><xf numFmtId="165"/></cellXfs>
<dxfs count="1"><dxf><numFmt numFmtId="165" formatCode="000000"/></dxf></dxfs></styleSheet>`;
const SHEET = `<worksheet><sheetData><row r="1"><c r="A1" s="1"><v>1067</v></c>
<c r="B1" s="1" t="s"><v>0</v></c><c r="C1" s="2"><v>1067</v></c><c r="D1"><v>1067</v></c>
<c r="AA1" s="1" t="n"><v>42</v></c></row></sheetData></worksheet>`;

const encoder = new TextEncoder();

function entries(files: Readonly<Record<string, string>>): Record<string, Uint8Array> {
	return Object.fromEntries(
		Object.entries(files).map(([path, text]) => [path, encoder.encode(text)]),
	);
}

const WORKBOOK_FILES = {
	'xl/_rels/workbook.xml.rels': RELS,
	'xl/styles.xml': STYLES,
	'xl/workbook.xml': WORKBOOK,
	'xl/worksheets/sheet1.xml': SHEET,
};

/** The row read-excel-file returns for `SHEET`: A1 to D1, then AA1 (column 27). */
const ROW = [1067, 'Text', 1067, 1067, ...Array.from({ length: 22 }, () => null), 42];

describe(keepLeadingZeros, () => {
	it('pads numeric cells whose format is zeros only', () => {
		expect(keepLeadingZeros(entries(WORKBOOK_FILES), 0, [ROW])).toStrictEqual([
			['01067', 'Text', 1067, 1067, ...Array.from({ length: 22 }, () => null), '00042'],
		]);
	});

	it('reads prefixed tags, single quotes and absolute targets', () => {
		const files = entries({
			'xl/_rels/workbook.xml.rels': RELS.replace(
				'Target="worksheets/sheet1.xml"',
				"Target='/xl/worksheets/data.xml'",
			),
			'xl/styles.xml': STYLES.replaceAll('<xf', '<x:xf').replaceAll('cellXfs', 'x:cellXfs'),
			'xl/workbook.xml': WORKBOOK.replace('<sheet ', '<x:sheet xmlns:x="urn:x" '),
			'xl/worksheets/data.xml': SHEET.replaceAll('<c ', '<x:c '),
		});
		expect(keepLeadingZeros(files, 0, [[1067]])).toStrictEqual([['01067']]);
	});

	it('leaves the cells as they are without styles, sheet or relations', () => {
		const { 'xl/styles.xml': _styles, ...withoutStyles } = WORKBOOK_FILES;
		const { 'xl/_rels/workbook.xml.rels': _rels, ...withoutRelations } = WORKBOOK_FILES;
		expect(keepLeadingZeros(entries(withoutStyles), 0, [[1067]])).toStrictEqual([[1067]]);
		expect(keepLeadingZeros(entries(withoutRelations), 0, [[1067]])).toStrictEqual([[1067]]);
		expect(keepLeadingZeros(entries(WORKBOOK_FILES), 1, [[1067]])).toStrictEqual([[1067]]);
	});
});
