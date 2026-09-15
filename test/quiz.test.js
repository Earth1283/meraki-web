import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quizReview, canTakeQuiz, answerPayload, answeredCount, quizDeadline, formatCountdown } from '../src/quiz.js';

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

test('canTakeQuiz needs a published assessment with no submission yet', () => {
  assert.equal(canTakeQuiz({ published: true }, null), true);
  assert.equal(canTakeQuiz({ published: true }, { id: 's1' }), false, 'already submitted');
  assert.equal(canTakeQuiz({ published: false }, null), false, 'not published yet');
  assert.equal(canTakeQuiz(null, null), false);
});

test('answerPayload turns picked choices into the wire shape, skipping blanks', () => {
  assert.deepEqual(answerPayload({ q1: 1, q2: null, q3: 0 }), [{ questionId: 'q1', choice: 1 }, { questionId: 'q3', choice: 0 }]);
  assert.deepEqual(answerPayload({}), []);
});

test('answeredCount counts only the questions actually picked', () => {
  assert.equal(answeredCount({ q1: 1, q2: null, q3: 0 }), 2);
  assert.equal(answeredCount({}), 0);
});

test('quizDeadline adds the time limit in minutes, or stays null for an untimed quiz', () => {
  assert.equal(quizDeadline(1000, 10), 1000 + 10 * 60000);
  assert.equal(quizDeadline(1000, null), null);
});

test('formatCountdown renders mm:ss and floors at 0:00 instead of going negative', () => {
  assert.equal(formatCountdown(9 * 60000 + 5000), '9:05');
  assert.equal(formatCountdown(59000), '0:59');
  assert.equal(formatCountdown(0), '0:00');
  assert.equal(formatCountdown(-5000), '0:00');
});
