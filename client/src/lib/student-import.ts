export type StudentCsvRow = { name: string; email: string };

export function parseStudentCsv(input: string): StudentCsvRow[] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  let afterQuote = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        afterQuote = true;
      } else {
        cell += character;
      }
    } else if (afterQuote && character === ',') {
      record.push(cell.trim());
      cell = "";
      afterQuote = false;
    } else if (afterQuote && (character === '\n' || character === '\r')) {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      record.push(cell.trim());
      cell = "";
      if (record.some(value => value.length)) records.push(record);
      record = [];
      afterQuote = false;
    } else if (afterQuote && !/[ \t]/.test(character)) {
      throw new Error('CSV contains unexpected characters after a quoted field.');
    } else if (!afterQuote && character === '"' && cell.trim().length === 0) {
      cell = "";
      quoted = true;
    } else if (!afterQuote && character === '"') {
      throw new Error('CSV contains a quote inside an unquoted field.');
    } else if (!afterQuote && character === ',') {
      record.push(cell.trim());
      cell = "";
    } else if (!afterQuote && (character === '\n' || character === '\r')) {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      record.push(cell.trim());
      cell = "";
      if (record.some(value => value.length)) records.push(record);
      record = [];
    } else if (!afterQuote) {
      cell += character;
    }
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  record.push(cell.trim());
  if (record.some(value => value.length)) records.push(record);
  if (records.length < 2) throw new Error('CSV must include a header and at least one student row.');

  const headers = records[0].map(header => header.replace(/^\uFEFF/, '').toLowerCase());
  const nameColumn = headers.indexOf('name');
  const emailColumn = headers.indexOf('email');
  if (nameColumn < 0 || emailColumn < 0) throw new Error('CSV headers must include name and email columns.');

  return records.slice(1).map((values, index) => {
    const name = values[nameColumn]?.trim() ?? '';
    const email = values[emailColumn]?.trim() ?? '';
    if (!name || !email) throw new Error(`CSV row ${index + 2} must contain both a name and email.`);
    return { name, email };
  });
}
