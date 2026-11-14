import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const http = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  interceptors: { request: { use: vi.fn() } },
}));

vi.mock('axios', () => ({
  default: {
    create: () => http,
    isAxiosError: (value: unknown) => Boolean((value as { isAxiosError?: boolean })?.isAxiosError),
  },
}));

import { ExamBuilder } from '../exam-builder';

const session = { organization: { id: 'org-1' } };
const response = <T,>(data: T) => Promise.resolve({ data });

afterEach(() => vi.clearAllMocks());

it('creates a question bank and saves a draft question for reuse', async () => {
  http.get.mockImplementation((path: string) => response(path.endsWith('/question-banks') ? [] : []));
  http.post.mockImplementation((path: string, data: { name?: string; prompt?: string; type?: string }) => {
    if (path.endsWith('/question-banks')) return response({ id: 'bank-1', name: data.name });
    return response({ id: 'question-1', ...data, marks: 1, negativeMarks: 0 });
  });
  render(
    <MemoryRouter initialEntries={['/app/exam-builder']}>
      <Routes>
        <Route path="/app/exam-builder" element={<ExamBuilder session={session} />} />
      </Routes>
    </MemoryRouter>,
  );
  const user = userEvent.setup();

  await user.click(screen.getByRole('button', { name: '2. Questions' }));
  await user.type(screen.getByLabelText('New question bank name'), 'Biology Basics');
  await user.click(screen.getByRole('button', { name: 'Create bank' }));
  await waitFor(() => expect(http.post).toHaveBeenCalledWith(
    '/api/organizations/org-1/question-banks',
    { name: 'Biology Basics' },
  ));

  await user.click(screen.getByRole('button', { name: 'Add question' }));
  await user.selectOptions(screen.getByLabelText('Type'), 'short_answer');
  await user.type(screen.getByLabelText('Question text'), 'Define a cell.');
  await user.click(screen.getByRole('button', { name: 'Save to selected bank' }));
  await waitFor(() => expect(http.post).toHaveBeenCalledWith(
    '/api/organizations/org-1/question-banks/bank-1/questions',
    expect.objectContaining({ type: 'short_answer', prompt: 'Define a cell.' }),
  ));
});

it('shows question-bank loading errors instead of presenting an empty list', async () => {
  http.get.mockRejectedValue({ isAxiosError: true, response: { data: { error: 'Access denied' } } });
  render(
    <MemoryRouter initialEntries={['/app/exam-builder']}>
      <Routes>
        <Route path="/app/exam-builder" element={<ExamBuilder session={session} />} />
      </Routes>
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole('button', { name: '2. Questions' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
});

it('restores saved coding question details into the editor', async () => {
  const savedQuestion = {
    id: 'question-1',
    type: 'coding',
    prompt: 'Write a program.',
    options: [],
    marks: 5,
    negativeMarks: 0,
    codingQuestion: {
      title: 'Add two values',
      description: 'Read two numbers and print their sum.',
      difficulty: 'easy',
      mode: 'stdin_stdout',
      inputFormat: 'Two integers',
      outputFormat: 'Their sum',
      constraints: '',
      explanation: '',
      languageIds: ['python'],
      starterCode: { python: '' },
      timeLimitMs: 2000,
      memoryLimitKb: 262144,
      comparisonMode: 'exact',
      testCases: [{ input: '2 3', expectedOutput: '5', visibility: 'sample', position: 0 }],
    },
  };
  http.get.mockImplementation((path: string) => {
    if (path.endsWith('/question-banks')) return response([]);
    if (path.endsWith('/exams/exam-1')) return response({ id: 'exam-1', title: 'Draft exam', durationMinutes: 30 });
    if (path.endsWith('/exams/exam-1/questions')) return response([savedQuestion]);
    return response([]);
  });
  render(
    <MemoryRouter initialEntries={['/app/exam-builder/exam-1']}>
      <Routes>
        <Route path="/app/exam-builder/:examId" element={<ExamBuilder session={session} />} />
      </Routes>
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole('button', { name: '2. Questions' }));

  expect(await screen.findByLabelText('Problem title')).toHaveValue('Add two values');
  expect(screen.getByLabelText('Input')).toHaveValue('2 3');
  expect(screen.getByLabelText('Expected output')).toHaveValue('5');
});

it('imports coding problem details from a bank into a draft without dropping test cases', async () => {
  const bankQuestion = {
    id: 'bank-question-1',
    type: 'coding',
    prompt: 'Write a program.',
    options: [],
    marks: 5,
    negativeMarks: 0,
    codingQuestion: {
      title: 'Add two values',
      description: 'Read two numbers and print their sum.',
      difficulty: 'easy',
      mode: 'stdin_stdout',
      inputFormat: 'Two integers',
      outputFormat: 'Their sum',
      constraints: '',
      explanation: '',
      languageIds: ['python'],
      starterCode: { python: '' },
      timeLimitMs: 2000,
      memoryLimitKb: 262144,
      comparisonMode: 'exact',
      testCases: [{ input: '2 3', expectedOutput: '5', visibility: 'sample', position: 0 }],
    },
  };
  http.get.mockImplementation((path: string) => {
    if (path.endsWith('/question-banks')) return response([{ id: 'bank-1', name: 'Coding' }]);
    if (path.endsWith('/question-banks/bank-1/questions')) return response([bankQuestion]);
    if (path.endsWith('/exams/exam-1')) return response({ id: 'exam-1', title: 'Draft exam', durationMinutes: 30 });
    return response([]);
  });
  http.post.mockImplementation((path: string) => path.includes('/from-bank/')
    ? response({ ...bankQuestion, id: 'exam-question-1' })
    : response({}));
  render(
    <MemoryRouter initialEntries={['/app/exam-builder/exam-1']}>
      <Routes>
        <Route path="/app/exam-builder/:examId" element={<ExamBuilder session={session} />} />
      </Routes>
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '2. Questions' }));
  await user.selectOptions(await screen.findByLabelText('Source bank'), 'bank-1');
  await user.click(await screen.findByRole('button', { name: 'Add to draft' }));

  expect(await screen.findByLabelText('Problem title')).toHaveValue('Add two values');
  expect(screen.getByLabelText('Input')).toHaveValue('2 3');
  expect(screen.getByLabelText('Expected output')).toHaveValue('5');
});

it('selects every supported language by default and lets the author choose languages', async () => {
  http.get.mockReturnValue(response([]));
  render(
    <MemoryRouter initialEntries={['/app/exam-builder']}>
      <Routes>
        <Route path="/app/exam-builder" element={<ExamBuilder session={session} />} />
      </Routes>
    </MemoryRouter>,
  );
  const user = userEvent.setup();

  await user.click(screen.getByRole('button', { name: '2. Questions' }));
  await user.click(screen.getByRole('button', { name: 'Add question' }));
  await user.selectOptions(screen.getByLabelText('Type'), 'coding');

  const languageOptions = ['Python', 'JavaScript', 'Java', 'C++', 'C'];
  for (const language of languageOptions) {
    expect(screen.getByRole('checkbox', { name: language })).toBeChecked();
  }
  await user.click(screen.getByRole('checkbox', { name: 'Java' }));
  expect(screen.getByRole('checkbox', { name: 'Java' })).not.toBeChecked();
});

it('applies a template to a new draft and preserves its exam settings', async () => {
  const template = {
    id: 'template-1',
    name: 'Algebra',
    settings: {
      title: 'Algebra assessment',
      instructions: 'Show your work.',
      durationMinutes: 45,
      randomizeQuestions: true,
      randomizeOptions: false,
      interventionPolicy: {
        windowSeconds: 600,
        warningAt: 2,
        pauseAt: 4,
        terminateAt: 6,
        automaticTerminationEnabled: false,
        fullscreenRequired: true,
      },
    },
    questions: [{ type: 'short_answer', prompt: 'Solve x + 2 = 4.', options: [], correctAnswer: '2', marks: 2, negativeMarks: 0 }],
  };
  http.get.mockImplementation((path: string) => {
    if (path.endsWith('/exam-templates')) return response([{ id: template.id, name: template.name }]);
    if (path.endsWith(`/exam-templates/${template.id}`)) return response(template);
    if (path.endsWith('/question-banks')) return response([]);
    return response([]);
  });
  http.post.mockImplementation((path: string, data: unknown) => path.endsWith('/exams')
    ? response({ id: 'new-exam', ...(data as object) })
    : response({}));
  render(
    <MemoryRouter initialEntries={['/app/exam-builder']}>
      <Routes>
        <Route path="/app/exam-builder" element={<ExamBuilder session={session} />} />
      </Routes>
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText('Exam template'), template.id);
  await user.click(screen.getByRole('button', { name: 'Use template' }));

  expect(await screen.findByLabelText('Question text')).toHaveValue('Solve x + 2 = 4.');
  await user.click(screen.getByRole('button', { name: '1. Details' }));
  expect(screen.getByLabelText('Title')).toHaveValue('Algebra assessment');
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(http.post).toHaveBeenCalledWith(
    '/api/organizations/org-1/exams',
    expect.objectContaining({
      title: 'Algebra assessment',
      durationMinutes: 45,
      randomizeQuestions: true,
      interventionPolicy: template.settings.interventionPolicy,
    }),
  ));
});
