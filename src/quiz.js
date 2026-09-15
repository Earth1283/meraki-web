// A submitted quiz's detail: its questions (from Meraki's app, see
// api.getAssessmentQuestions) with your answers marked, or just the scored
// answer log when the questions can't be had.
import { el } from './dom.js';
import { pill } from './rows.js';
import { t } from './i18n.js';

/** A quiz's questions in the order the official site shows them. */
export function sortQuestions(questions) {
  return [...questions].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

// Taking a quiz (quiztake.js): the pure rules live here, alongside the rest
// of this file's quiz logic, so they're testable without a browser the same
// way submission.js holds turnin.js's rules.

/** Whether a "Take Quiz" button belongs on an assessment's detail at all:
 * published, and not already submitted (once there's a submission, the
 * detail panel shows the review above instead). */
export function canTakeQuiz(assessment, submission) {
  return !!assessment?.published && !submission;
}

/** { [questionId]: choiceIndex } -> the wire shape submitAssessmentAnswers
 * wants, one entry per question actually answered. A question left blank is
 * simply left out rather than sent as some guessed "no answer" value. */
export function answerPayload(answers) {
  return Object.entries(answers)
    .filter(([, choice]) => choice != null)
    .map(([questionId, choice]) => ({ questionId, choice: Number(choice) }));
}

export function answeredCount(answers) {
  return answerPayload(answers).length;
}

/** startedAt plus the assessment's time limit, or null for an untimed one. */
export function quizDeadline(startedAt, timeLimitMinutes) {
  return timeLimitMinutes == null ? null : startedAt + timeLimitMinutes * 60000;
}

/** A countdown in mm:ss, floored at 0:00 rather than going negative. */
export function formatCountdown(msRemaining) {
  const total = Math.max(0, Math.ceil(msRemaining / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** A submitted quiz's questions paired with your recorded answers, in
 * question order. `choice` is the 0-based option you picked; `isCorrect`
 * stays null until it's graded. The questions carry no answer key, so a
 * wrong answer can't show which option was right. */
export function quizReview(questions, answers) {
  const byQuestion = new Map(answers.map((a) => [a.question_id, a]));
  return sortQuestions(questions).map((q, i) => {
    const answer = byQuestion.get(q.id) ?? null;
    return {
      n: i + 1,
      prompt: q.prompt ?? '',
      options: Array.isArray(q.options) ? q.options.map(String) : [],
      points: q.points ?? null,
      answered: answer !== null,
      choice: Number.isInteger(answer?.response?.choice) ? answer.response.choice : null,
      isCorrect: answer?.is_correct ?? null,
      pointsAwarded: answer?.points_awarded ?? null,
      feedback: answer?.feedback || null,
    };
  });
}

function answerStatus(isCorrect, answered = true) {
  if (!answered) return ['dim', t('quiz.notAnswered')];
  if (isCorrect === true) return ['good', t('detail.correct')];
  if (isCorrect === false) return ['bad', t('detail.incorrect')];
  return ['dim', t('detail.notGraded')];
}

// With the questions: each prompt, its options, and the one you picked,
// marked right or wrong.
function reviewList(questions, answers) {
  return el(
    'div',
    { class: 'quiz-review' },
    quizReview(questions, answers).map((q) => {
      const [status, statusText] = answerStatus(q.isCorrect, q.answered);
      const pts = q.points != null ? `${q.pointsAwarded ?? '-'}/${q.points} ${t('unit.pts')}` : null;
      return el('div', { class: 'quiz-q' }, [
        el('div', { class: 'quiz-q-head' }, [
          el('span', { class: 'quiz-q-n', text: t('detail.question', { n: q.n }) }),
          pill(statusText, status),
          pts ? el('span', { class: 'quiz-q-pts', text: pts }) : null,
        ]),
        el('p', { class: 'quiz-q-prompt', text: q.prompt }),
        q.options.length
          ? el(
              'ol',
              { class: 'quiz-options' },
              q.options.map((option, i) =>
                el('li', { class: `quiz-option ${i === q.choice ? `chosen ${status}` : ''}` }, [
                  el('span', { class: 'quiz-option-letter', text: String.fromCharCode(65 + i) }),
                  el('span', { class: 'quiz-option-text', text: option }),
                  i === q.choice ? el('span', { class: 'quiz-option-mark', text: t('quiz.yourAnswer') }) : null,
                ]),
              ),
            )
          : null,
        q.feedback ? el('p', { class: 'quiz-feedback', text: q.feedback }) : null,
      ]);
    }),
  );
}

// Without them: the scored answer log, which is all the database itself
// shows a student.
function answerLog(answers) {
  return el(
    'div',
    { class: 'roster-list' },
    answers.map((a, i) => {
      const choice = a.response?.choice;
      const [status, statusText] = answerStatus(a.is_correct);
      const meta = [choice != null ? t('detail.chose', { n: choice + 1 }) : null, a.points_awarded != null ? `${a.points_awarded} ${t('unit.pts')}` : null, a.feedback || null]
        .filter(Boolean)
        .join(' · ');
      return el('div', { class: 'roster-row' }, [
        el('span', { class: 'roster-name', text: t('detail.question', { n: i + 1 }) }),
        el('span', { class: `pill ${status}`, text: statusText }),
        el('span', { class: 'roster-meta', text: meta }),
      ]);
    }),
  );
}

/** The "Your answers" section of a submitted quiz's detail. `answers` and
 * `questions` arrive the way lazyFetch hands them over: undefined while
 * loading, { error } if the fetch failed. */
export function renderQuizReview(answers, questions) {
  const section = el('div', { class: 'detail-section' }, [el('div', { class: 'row-section' }, t('detail.yourAnswers'))]);
  if (!answers || !questions) {
    section.appendChild(el('div', { class: 'row-placeholder', text: t('detail.loading') }));
  } else if (answers.error) {
    section.appendChild(el('div', { class: 'row-placeholder', text: t('detail.answersFailed', { msg: answers.error }) }));
  } else if (answers.length === 0) {
    section.appendChild(el('div', { class: 'row-placeholder', text: t('detail.noAnswers') }));
  } else if (Array.isArray(questions) && questions.length > 0) {
    section.appendChild(reviewList(questions, answers));
  } else {
    if (questions.error) section.appendChild(el('div', { class: 'row-placeholder', text: t('quiz.questionsUnavailable', { msg: questions.error }) }));
    section.appendChild(answerLog(answers));
  }
  return section;
}
