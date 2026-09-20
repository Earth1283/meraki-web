import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  quizReview, canTakeQuiz, answerPayload, answeredCount, quizDeadline, formatCountdown,
  quizAvailability, QUIZ_AVAILABILITY, QUIZ_CLOSING_SOON_MS, effectiveDeadline, formatDuration, formatQuizWindow,
} from '../src/quiz.js';
import { t, getDateLocale, i18nReady } from '../src/i18n.js';

await i18nReady;

const NOW = Date.parse('2026-01-15T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

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

test('quizAvailability: no assessment, or an unpublished one, is not-published regardless of dates', () => {
  assert.equal(quizAvailability(null, null, NOW).state, QUIZ_AVAILABILITY.NOT_PUBLISHED);
  assert.equal(quizAvailability({ published: false, closes_at: iso(NOW - 1000) }, null, NOW).state, QUIZ_AVAILABILITY.NOT_PUBLISHED);
});

test('quizAvailability: a submission wins over everything else, even an unpublished or closed quiz', () => {
  assert.equal(quizAvailability({ published: false }, { id: 's1' }, NOW).state, QUIZ_AVAILABILITY.SUBMITTED);
  assert.equal(
    quizAvailability({ published: true, closes_at: iso(NOW - 1000) }, { id: 's1' }, NOW).state,
    QUIZ_AVAILABILITY.SUBMITTED,
  );
});

test('quizAvailability: absent or null bounds in either direction leave a published quiz open', () => {
  const a = quizAvailability({ published: true }, null, NOW);
  assert.deepEqual(a, { state: QUIZ_AVAILABILITY.OPEN, opensAt: null, closesAt: null, msUntilOpen: null, msUntilClose: null });
  assert.equal(quizAvailability({ published: true, available_from: null, closes_at: null }, null, NOW).state, QUIZ_AVAILABILITY.OPEN);
});

test('quizAvailability: not-yet-open before available_from, open at the exact instant it opens', () => {
  const opensAt = NOW + 3 * 86400000;
  const before = quizAvailability({ published: true, available_from: iso(opensAt) }, null, NOW);
  assert.equal(before.state, QUIZ_AVAILABILITY.NOT_YET_OPEN);
  assert.equal(before.msUntilOpen, 3 * 86400000);

  const atOpen = quizAvailability({ published: true, available_from: iso(NOW) }, null, NOW);
  assert.equal(atOpen.state, QUIZ_AVAILABILITY.OPEN);
});

test('quizAvailability: not-yet-open still reports msUntilClose when both bounds are set', () => {
  const opensAt = NOW + 86400000;
  const closesAt = NOW + 2 * 86400000;
  const a = quizAvailability({ published: true, available_from: iso(opensAt), closes_at: iso(closesAt) }, null, NOW);
  assert.equal(a.state, QUIZ_AVAILABILITY.NOT_YET_OPEN);
  assert.equal(a.msUntilOpen, 86400000);
  assert.equal(a.msUntilClose, 2 * 86400000);
});

test('quizAvailability: closed at the exact close instant, still open a moment before', () => {
  const atClose = quizAvailability({ published: true, closes_at: iso(NOW) }, null, NOW);
  assert.equal(atClose.state, QUIZ_AVAILABILITY.CLOSED);

  const justBefore = quizAvailability({ published: true, closes_at: iso(NOW + 1) }, null, NOW);
  assert.notEqual(justBefore.state, QUIZ_AVAILABILITY.CLOSED);
});

test('quizAvailability: past a set close time reports closed', () => {
  const a = quizAvailability({ published: true, closes_at: iso(NOW - 60000) }, null, NOW);
  assert.equal(a.state, QUIZ_AVAILABILITY.CLOSED);
});

test('quizAvailability: closing-soon kicks in exactly at the threshold, open a millisecond further out', () => {
  const atThreshold = quizAvailability({ published: true, closes_at: iso(NOW + QUIZ_CLOSING_SOON_MS) }, null, NOW);
  assert.equal(atThreshold.state, QUIZ_AVAILABILITY.CLOSING_SOON);
  assert.equal(atThreshold.msUntilClose, QUIZ_CLOSING_SOON_MS);

  const justOutside = quizAvailability({ published: true, closes_at: iso(NOW + QUIZ_CLOSING_SOON_MS + 1) }, null, NOW);
  assert.equal(justOutside.state, QUIZ_AVAILABILITY.OPEN);
});

test('quizAvailability: due_at is ignored entirely — a quiz can be past due and still open', () => {
  const a = quizAvailability({ published: true, due_at: iso(NOW - 5 * 86400000), closes_at: iso(NOW + 86400000) }, null, NOW);
  assert.equal(a.state, QUIZ_AVAILABILITY.OPEN);

  const b = quizAvailability({ published: true, due_at: iso(NOW - 5 * 86400000) }, null, NOW);
  assert.equal(b.state, QUIZ_AVAILABILITY.OPEN);
});

test('quizAvailability: an unparseable bound is treated the same as an absent one', () => {
  const a = quizAvailability({ published: true, available_from: 'not-a-date' }, null, NOW);
  assert.equal(a.state, QUIZ_AVAILABILITY.OPEN);
  assert.equal(a.opensAt, null);
});

test('canTakeQuiz also mirrors quizAvailability for the time-bounded states', () => {
  assert.equal(canTakeQuiz({ published: true, available_from: iso(NOW + 86400000) }, null, NOW), false, 'not yet open');
  assert.equal(canTakeQuiz({ published: true, closes_at: iso(NOW - 1000) }, null, NOW), false, 'closed');
  assert.equal(canTakeQuiz({ published: true, closes_at: iso(NOW + 60000) }, null, NOW), true, 'closing soon is still takeable');
  assert.equal(canTakeQuiz({ published: true, available_from: iso(NOW - 1000), closes_at: iso(NOW + 86400000) }, null, NOW), true);
});

test('effectiveDeadline picks whichever of the time limit or the close time comes first', () => {
  assert.equal(effectiveDeadline(1000, 10, null), quizDeadline(1000, 10));
  assert.equal(effectiveDeadline(1000, null, 5000), 5000);
  assert.equal(effectiveDeadline(1000, null, null), null);
  assert.equal(effectiveDeadline(1000, 10, 500000), 500000, 'the sooner close time wins over a longer time limit');
  assert.equal(effectiveDeadline(1000, 10, 900000), quizDeadline(1000, 10), 'the time limit wins when the close time is further out');
});

test('formatDuration renders a rough d/h/m duration, floored at 1m rather than 0m', () => {
  assert.equal(formatDuration(30000), '1m');
  assert.equal(formatDuration(90000), '2m');
  assert.equal(formatDuration(59 * 60000), '59m');
  assert.equal(formatDuration(60 * 60000), '1h');
  assert.equal(formatDuration(23 * 3600000), '23h');
  assert.equal(formatDuration(24 * 3600000), '1d');
  assert.equal(formatDuration(0), '1m');
});

test('formatQuizWindow explains a non-published or closed quiz', () => {
  assert.equal(formatQuizWindow({ state: QUIZ_AVAILABILITY.NOT_PUBLISHED }), t('quiz.window.notPublished'));
  assert.equal(formatQuizWindow({ state: QUIZ_AVAILABILITY.CLOSED }), t('quiz.window.closed'));
});

test('formatQuizWindow has nothing to say once submitted', () => {
  assert.equal(formatQuizWindow({ state: QUIZ_AVAILABILITY.SUBMITTED }), null);
});

test('formatQuizWindow counts down to opening within a week, otherwise names the day and time', () => {
  const soon = { state: QUIZ_AVAILABILITY.NOT_YET_OPEN, msUntilOpen: 2 * 86400000, opensAt: NOW + 2 * 86400000 };
  assert.equal(formatQuizWindow(soon), t('quiz.window.opensIn', { duration: '2d' }));

  const opensAt = NOW + 10 * 86400000;
  const far = { state: QUIZ_AVAILABILITY.NOT_YET_OPEN, msUntilOpen: 10 * 86400000, opensAt };
  const d = new Date(opensAt);
  const when = `${d.toLocaleDateString(getDateLocale(), { weekday: 'short' })} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  assert.equal(formatQuizWindow(far), t('quiz.window.opensAt', { when }));
});

test('formatQuizWindow counts down to closing when open or closing-soon, or says nothing with no close bound', () => {
  assert.equal(formatQuizWindow({ state: QUIZ_AVAILABILITY.OPEN, closesAt: null, msUntilClose: null }), null);

  const soon = { state: QUIZ_AVAILABILITY.CLOSING_SOON, closesAt: NOW + 5 * 60000, msUntilClose: 5 * 60000 };
  assert.equal(formatQuizWindow(soon), t('quiz.window.closesIn', { duration: '5m' }));

  const closesAt = NOW + 10 * 86400000;
  const far = { state: QUIZ_AVAILABILITY.OPEN, closesAt, msUntilClose: 10 * 86400000 };
  const d = new Date(closesAt);
  const when = `${d.toLocaleDateString(getDateLocale(), { weekday: 'short' })} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  assert.equal(formatQuizWindow(far), t('quiz.window.closesAt', { when }));
});
