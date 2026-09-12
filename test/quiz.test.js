import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quizReview } from '../src/quiz.js';

test('quizReview orders questions by position and attaches each answer', () => {
  const questions = [
    { id: 'q2', position: 1, prompt: 'Second', options: ['x', 'y'], points: 1 },
    { id: 'q1', position: 0, prompt: 'First', options: ['a', 'b', 'c'], points: 2 },
  ];
  const answers = [{ question_id: 'q1', response: { choice: 2 }, is_correct: true, points_awarded: 2, feedback: 'Nice' }];
  const review = quizReview(questions, answers);
  assert.deepEqual(
    review.map((q) => [q.n, q.prompt, q.answered, q.choice, q.isCorrect]),
    [[1, 'First', true, 2, true], [2, 'Second', false, null, null]],
  );
  assert.equal(review[0].feedback, 'Nice');
});

test('quizReview leaves a non-numeric choice out rather than guessing', () => {
  const [q] = quizReview([{ id: 'q1', prompt: 'Explain', options: null }], [{ question_id: 'q1', response: { text: 'Because' }, is_correct: null }]);
  assert.deepEqual([q.options, q.answered, q.choice, q.isCorrect], [[], true, null, null]);
});
