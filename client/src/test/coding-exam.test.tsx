import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, expect, it } from 'vitest';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <textarea aria-label="Code editor" value={value} onChange={(event) => onChange(event.target.value)} />
}));

import { CodingExamWorkspace, type CodingQuestion } from '../coding-exam';

const questions: CodingQuestion[] = [
  { id: 'q1', title: 'Double it', description: 'Return twice the input.', difficulty: 'easy' as const, marks: 5, languageIds: ['python'], starterCode: { python: 'print(2)' }, samples: [{ id: 'sample', input: '2', output: '4' }] },
  { id: 'q2', title: 'Add it', description: 'Add numbers.', difficulty: 'medium' as const, marks: 5, languageIds: ['javascript'], starterCode: { javascript: 'console.log(1)' }, samples: [] }
];

describe('coding examination workspace', () => {
  it('keeps question code in memory, disables unconfigured execution, and never renders private cases', async () => {
    const user = userEvent.setup();
    render(<CodingExamWorkspace assessment={{ title: 'Programming fundamentals', deadlineAt: '2099-01-01T00:00:00.000Z' }} attemptId="attempt-1" questions={questions} />);
    expect(screen.getByText('Secure runner is not configured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run samples' })).toBeDisabled();
    expect(screen.getByText(/Server-side code persistence is not configured/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Code editor'));
    await user.type(screen.getByLabelText('Code editor'), 'print(42)');
    await user.click(screen.getByRole('button', { name: /Q2 Add it/ }));
    await user.click(screen.getByRole('button', { name: /Q1 Double it/ }));
    expect(screen.getByLabelText('Code editor')).toHaveValue('print(42)');
    expect(screen.queryByText(/private input|private output|secret/i)).not.toBeInTheDocument();
  });
});
