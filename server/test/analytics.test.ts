import assert from 'node:assert/strict';
import test from 'node:test';
import { durations, parseDateParam, participation, questionPerformance, scores } from '../src/analytics.js';
import { csvCell, toCsv } from '../src/csv.js';

const t = (m: number) => new Date(Date.UTC(2026, 10, 7, 10, m));
const attempt = (status: string, start: number, end: number | null) => ({ status, startedAt: t(start), submittedAt: end == null ? null : t(end) });

test('participation separates not-started, in-progress, submitted and deadline-closed', () => {
  const p = participation(10, [attempt('submitted', 0, 30), attempt('expired', 0, 60), attempt('in_progress', 0, null), attempt('terminated', 0, null)]);
  assert.deepEqual(p, { assigned: 10, started: 4, notStarted: 6, inProgress: 1, submitted: 1, closedAtDeadline: 1, terminated: 1, completionRate: 0.2 });
  assert.equal(participation(0, []).completionRate, 0);
});
test('duration stats ignore unfinished or inconsistent attempts', () => {
  const d = durations([attempt('submitted', 0, 30), attempt('submitted', 0, 50), attempt('expired', 0, 40), attempt('in_progress', 0, null), attempt('submitted', 10, 5)]);
  assert.deepEqual(d, { samples: 3, averageMinutes: 40, medianMinutes: 40, minMinutes: 30, maxMinutes: 50 });
  assert.equal(durations([]).averageMinutes, null);
});
test('score stats exclude grades still awaiting manual marking and clamp to 0-100', () => {
  const s = scores([{ totalMarks: 8, maxMarks: 10, status: 'published' }, { totalMarks: 2, maxMarks: 10, status: 'graded' }, { totalMarks: 0, maxMarks: 10, status: 'pending_manual' }, { totalMarks: -3, maxMarks: 10, status: 'graded' }, { totalMarks: 5, maxMarks: 0, status: 'graded' }]);
  assert.equal(s.graded, 3); assert.equal(s.pendingManual, 1); assert.equal(s.averagePercent, 33.3); assert.equal(s.medianPercent, 20);
  assert.equal(s.distribution[8].count, 1); assert.equal(s.distribution[2].count, 1); assert.equal(s.distribution[0].count, 1);
  assert.equal(scores([]).averagePercent, null);
});
test('question performance uses the grading equality rule and handles order-insensitive multi-select', () => {
  const qs = [{ id: 'q2', type: 'multiple_select', prompt: 'Pick', position: 2, correctAnswer: ['a', 'b'] }, { id: 'q1', type: 'mcq', prompt: 'x'.repeat(100), position: 1, correctAnswer: 'c' }, { id: 'q3', type: 'descriptive', prompt: 'Essay', position: 3, correctAnswer: null }];
  const answers = [{ questionId: 'q1', value: 'c' }, { questionId: 'q1', value: 'd' }, { questionId: 'q1', value: null }, { questionId: 'q2', value: ['b', 'a'] }];
  const r = questionPerformance(qs, answers, 3);
  assert.deepEqual(r.map(x => x.questionId), ['q1', 'q2'], 'descriptive questions are excluded and rows are ordered');
  assert.deepEqual([r[0].answered, r[0].correct, r[0].skipped, r[0].correctRate], [2, 1, 1, 0.5]);
  assert.equal(r[0].prompt.length, 78); assert.equal(r[1].correctRate, 1);
});
test('date parameters: absent ok, invalid rejected', () => {
  assert.equal(parseDateParam(undefined), undefined); assert.equal(parseDateParam('nope'), 'invalid'); assert.equal(parseDateParam(['x']), 'invalid');
  assert.equal((parseDateParam('2026-11-01') as Date).toISOString(), '2026-11-01T00:00:00.000Z');
});
test('regression: CSV cells cannot start a spreadsheet formula', () => {
  for (const evil of ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1']) assert.ok(csvCell(evil).startsWith(`"'`), evil);
  assert.equal(csvCell('Ana "A" Lee'), '"Ana ""A"" Lee"'); assert.equal(csvCell(7.5), '7.5'); assert.equal(csvCell(null), '""');
  assert.equal(csvCell(-3), '-3', 'real numbers stay numeric');
});
test('toCsv writes BOM, CRLF and escaped rows', () => {
  const out = toCsv(['candidate', 'score'], [['=cmd', 5], ['Ben, Jr.', 6]]);
  assert.ok(out.startsWith('\uFEFF"candidate","score"\r\n')); assert.ok(out.includes('"\'=cmd",5\r\n')); assert.ok(out.includes('"Ben, Jr.",6\r\n'));
});
