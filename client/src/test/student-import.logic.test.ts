import { describe, expect, it } from 'vitest';
import { parseStudentCsv } from '../lib/student-import';

describe('parseStudentCsv', () => {
  it('reads named columns, quoted commas, escaped quotes, and CRLF rows', () => {
    expect(parseStudentCsv('EMAIL,NAME\r\nstudent@example.test,"Rao, ""Sam"""')).toEqual([
      { name: 'Rao, "Sam"', email: 'student@example.test' },
    ]);
  });

  it('ignores blank lines and a UTF-8 BOM in the header', () => {
    expect(parseStudentCsv('\uFEFFname,email\n\nStudent,student@example.test\n')).toEqual([
      { name: 'Student', email: 'student@example.test' },
    ]);
  });

  it('requires both columns and non-empty values', () => {
    expect(() => parseStudentCsv('name\nStudent')).toThrow('headers must include name and email');
    expect(() => parseStudentCsv('name,email\nStudent,')).toThrow('must contain both a name and email');
  });

  it('rejects an unclosed quoted field and a header without student rows', () => {
    expect(() => parseStudentCsv('name,email\n"Student,student@example.test')).toThrow('unclosed quoted field');
    expect(() => parseStudentCsv('name,email\n"Student"x,student@example.test')).toThrow('unexpected characters after a quoted field');
    expect(() => parseStudentCsv('name,email\nStu"dent,student@example.test')).toThrow('quote inside an unquoted field');
    expect(() => parseStudentCsv('name,email\n')).toThrow('at least one student row');
  });
});
