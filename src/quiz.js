// A submitted quiz's detail: its questions (from Meraki's app, see
// api.getAssessmentQuestions) with your answers marked, or just the scored
// answer log when the questions can't be had.
import { el } from './dom.js';
import { pill } from './rows.js';
import { t, getDateLocale } from './i18n.js';

/** A quiz's questions in the order the official site shows them. */
export function sortQuestions(questions) {
  return [...questions].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

// Taking a quiz (quiztake.js): the pure rules live here, alongside the rest
// of this file's quiz logic, so they're testable without a browser the same
// way submission.js holds turnin.js's rules.

/** The states `quizAvailability` can report, in the order a quiz normally
 * passes through them (skipping SUBMITTED, which can happen from any of
 * the others). */
export const QUIZ_AVAILABILITY = {
  NOT_PUBLISHED: 'not-published',
  NOT_YET_OPEN: 'not-yet-open',
  OPEN: 'open',
  CLOSING_SOON: 'closing-soon',
  CLOSED: 'closed',
  SUBMITTED: 'submitted',
};

// Once a quiz's close time is this near, quiztake.js's countdown ought to be
// visible even for an otherwise-untimed quiz, so the state that drives that
// warning kicks in before the window actually shuts. Exported so a caller
// rendering an availability pill (or a test) shares this exact threshold
// instead of guessing at it.
export const QUIZ_CLOSING_SOON_MS = 15 * 60000;

function toEpoch(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Whether (and why) an assessment can be taken right now: published, not
 * already submitted, and within its open/close window. `available_from`
 * and `closes_at` are ISO timestamps that may each be null, meaning that
 * bound is unset — a quiz with neither is open for as long as it's
 * published. `due_at` is deliberately not consulted here: a quiz can be
 * past due and still open for a late attempt. */
export function quizAvailability(assessment, submission, nowMs = Date.now()) {
  if (submission) return { state: QUIZ_AVAILABILITY.SUBMITTED, opensAt: null, closesAt: null, msUntilOpen: null, msUntilClose: null };
  if (!assessment?.published) return { state: QUIZ_AVAILABILITY.NOT_PUBLISHED, opensAt: null, closesAt: null, msUntilOpen: null, msUntilClose: null };

  const opensAt = toEpoch(assessment.available_from);
  const closesAt = toEpoch(assessment.closes_at);

  if (opensAt != null && nowMs < opensAt) {
    return { state: QUIZ_AVAILABILITY.NOT_YET_OPEN, opensAt, closesAt, msUntilOpen: opensAt - nowMs, msUntilClose: closesAt != null ? closesAt - nowMs : null };
  }
  if (closesAt != null && nowMs >= closesAt) {
    return { state: QUIZ_AVAILABILITY.CLOSED, opensAt, closesAt, msUntilOpen: null, msUntilClose: null };
  }
  const msUntilClose = closesAt != null ? closesAt - nowMs : null;
  const state = msUntilClose != null && msUntilClose <= QUIZ_CLOSING_SOON_MS ? QUIZ_AVAILABILITY.CLOSING_SOON : QUIZ_AVAILABILITY.OPEN;
  return { state, opensAt, closesAt, msUntilOpen: null, msUntilClose };
}

/** Whether a "Take Quiz" button belongs on an assessment's detail at all:
 * this is the one place that decides a quiz is actually takeable — open
 * (or closing soon, which is still open) and not already submitted. */
export function canTakeQuiz(assessment, submission, now = Date.now()) {
  const { state } = quizAvailability(assessment, submission, now);
  return state === QUIZ_AVAILABILITY.OPEN || state === QUIZ_AVAILABILITY.CLOSING_SOON;
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

/** The deadline quiztake.js's countdown should actually race against: its
 * own per-attempt time limit, or the assessment's closes_at, whichever
 * comes first (either may be absent). Feeding this single deadline into
 * the existing countdown covers a window closing mid-attempt without a
 * second timer alongside it. */
export function effectiveDeadline(startedAt, timeLimitMinutes, closesAt) {
  const candidates = [quizDeadline(startedAt, timeLimitMinutes), closesAt].filter((d) => d != null);
  return candidates.length ? Math.min(...candidates) : null;
}

/** A countdown in mm:ss, floored at 0:00 rather than going negative. */
export function formatCountdown(msRemaining) {
  const total = Math.max(0, Math.ceil(msRemaining / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const WEEK_MS = 7 * 86400000;

/** A rough duration like "2d", "3h", "5m" — the same unadorned, untranslated
 * idiom formatCountdown uses for a live clock, floored at 1 minute rather
 * than 0 so an imminent bound never reads as "0m". */
export function formatDuration(ms) {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
  if (totalMinutes >= 1440) return `${Math.round(totalMinutes / 1440)}d`;
  if (totalMinutes >= 60) return `${Math.round(totalMinutes / 60)}h`;
  return `${totalMinutes}m`;
}

// Not run through Intl.DateTimeFormat like rows.js's formatDate: this module
// has no access to state.config's 12h/24h preference (it stays state-free
// for testability), so it prints a plain 24-hour clock and leaves the
// weekday name — the one locale-sensitive part — to toLocaleDateString.
function formatWeekdayTime(ms) {
  const d = new Date(ms);
  const weekday = d.toLocaleDateString(getDateLocale(), { weekday: 'short' });
  return `${weekday} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The human-facing window label for an assessment's availability — "Opens
 * in 2d", "Closes in 3h", "Closed", "Opens Tue 9:00" — or null when the
 * state has nothing to say (already submitted, or open with no close
 * bound). Anything under a week away is phrased as a countdown; further out
 * it's a weekday and time instead, which reads better than "Opens in 12d". */
export function formatQuizWindow(availability) {
  switch (availability.state) {
    case QUIZ_AVAILABILITY.NOT_PUBLISHED:
      return t('quiz.window.notPublished');
    case QUIZ_AVAILABILITY.NOT_YET_OPEN:
      return availability.msUntilOpen < WEEK_MS
        ? t('quiz.window.opensIn', { duration: formatDuration(availability.msUntilOpen) })
        : t('quiz.window.opensAt', { when: formatWeekdayTime(availability.opensAt) });
    case QUIZ_AVAILABILITY.CLOSED:
      return t('quiz.window.closed');
    case QUIZ_AVAILABILITY.OPEN:
    case QUIZ_AVAILABILITY.CLOSING_SOON:
      if (availability.closesAt == null) return null;
      return availability.msUntilClose < WEEK_MS
        ? t('quiz.window.closesIn', { duration: formatDuration(availability.msUntilClose) })
        : t('quiz.window.closesAt', { when: formatWeekdayTime(availability.closesAt) });
    default:
      return null;
  }
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
