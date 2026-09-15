// Taking a quiz, the way the official site does it: fetch its questions
// (api.getAssessmentQuestions — safe to call repeatedly, see the comment on
// it), pick an answer per question, then one call to submitAssessmentAnswers
// grades whatever it can right away. The rules this leans on (canTakeQuiz,
// answerPayload, the countdown math) are pure and live in quiz.js, so
// they're testable without a browser; this file is the panel and its writes.
import { el } from './dom.js';
import * as api from './api.js';
import { state, closeOverlay, openDetailFor, openTakeQuiz, refresh, notify } from './state.js';
import { lazyFetch } from './lazy.js';
import { showToast } from './toast.js';
import { sidePanel } from './panels.js';
import { submissionForAssessment } from './rows.js';
import { sortQuestions, answerPayload, answeredCount, quizDeadline, formatCountdown } from './quiz.js';
import { t } from './i18n.js';

// What's been picked so far, per assessment. Kept until submitted (or
// abandoned by navigating away for good) so closing the panel by accident —
// or a background refresh re-rendering it — never loses your picks, the same
// way turnin.js keeps a draft alive across re-renders.
const attempts = new Map();

function attemptFor(assessment) {
  if (!attempts.has(assessment.id)) {
    attempts.set(assessment.id, { answers: {}, index: 0, startedAt: Date.now(), submitting: false, error: null });
  }
  return attempts.get(assessment.id);
}

async function submit(assessment, attempt, { auto = false } = {}) {
  const payload = answerPayload(attempt.answers);
  if (!auto && payload.length === 0) {
    attempt.error = t('quiz.answerAtLeastOne');
    notify();
    return;
  }
  attempt.submitting = true;
  attempt.error = null;
  notify();
  try {
    const result = await api.submitAssessmentAnswers(assessment.id, payload);
    attempts.delete(assessment.id);
    const back = state.quizReturn;
    state.quizReturn = null;
    await refresh();
    if (back) openDetailFor(back);
    else closeOverlay();
    showToast(
      result.needsReview
        ? t('quiz.submittedPending')
        : t('quiz.submitted', { score: result.autoScore ?? 0, total: result.totalPoints ?? 0 }),
    );
  } catch (err) {
    attempt.submitting = false;
    attempt.error = t('quiz.submitFailed', { msg: err.message });
    notify();
  }
}

// A self-cleaning countdown: it stops itself once `span` leaves the
// document (the panel closed or re-rendered onto a new span) instead of
// needing an explicit unmount hook — the same isConnected check turnin.js
// uses for its own cleanup.
function attachCountdown(span, deadline, onExpire) {
  let expired = false;
  const tick = () => {
    if (!span.isConnected) {
      clearInterval(interval);
      return;
    }
    const remaining = deadline - Date.now();
    span.textContent = formatCountdown(remaining);
    span.classList.toggle('quiz-timer-low', remaining <= 60000);
    if (remaining <= 0 && !expired) {
      expired = true;
      clearInterval(interval);
      onExpire();
    }
  };
  const interval = setInterval(tick, 1000);
  tick();
}

/** A "Take Quiz" prompt for an assessment's detail panel, once it's clear
 * there's no submission yet (see detail-sections.js). */
export function renderTakeQuizCta(assessment) {
  const hint = assessment.time_limit_minutes != null ? t('quiz.timeLimitHint', { n: assessment.time_limit_minutes }) : t('quiz.noTimeLimitHint');
  return el('div', { class: 'detail-section take-quiz-cta' }, [
    el('div', { class: 'row-section' }, t('quiz.notStarted')),
    el('p', { class: 'row-placeholder', text: hint }),
    el('div', { class: 'panel-actions panel-actions-start' }, [
      el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => openTakeQuiz(assessment.id), text: t('quiz.start') }),
    ]),
  ]);
}

function optionButton(question, attempt, i, option) {
  const chosen = attempt.answers[question.id] === i;
  return el(
    'button',
    {
      type: 'button',
      role: 'radio',
      'aria-checked': chosen,
      class: `quiz-option quiz-option-btn ${chosen ? 'chosen' : ''}`,
      onclick: () => {
        attempt.answers[question.id] = i;
        notify();
      },
    },
    [el('span', { class: 'quiz-option-letter', text: String.fromCharCode(65 + i) }), el('span', { class: 'quiz-option-text', text: String(option) })],
  );
}

function pagerDot(question, attempt, i) {
  return el(
    'button',
    {
      type: 'button',
      class: `quiz-take-dot ${i === attempt.index ? 'active' : ''} ${attempt.answers[question.id] != null ? 'answered' : ''}`,
      'aria-label': t('detail.question', { n: i + 1 }),
      onclick: () => {
        attempt.index = i;
        notify();
      },
    },
    String(i + 1),
  );
}

/** The take-quiz overlay's panel (see overlays.js's 'quiz' case). */
export function buildTakeQuizForm() {
  const assessment = state.data.assessments.find((a) => a.id === state.quizAssessmentId);
  if (!assessment) return sidePanel(t('quiz.title'), el('p', { class: 'form-error', text: t('quiz.missing') }));

  if (submissionForAssessment(state.data, assessment)) {
    // Reopened after a background refresh landed the submission (e.g. the
    // timer expired and auto-submitted while this panel was closed) — the
    // detail panel's review section covers it from here.
    return sidePanel(t('quiz.title'), el('p', { class: 'form-error', text: t('quiz.alreadySubmitted') }));
  }

  const questions = lazyFetch(`questions:${assessment.id}`, () => api.getAssessmentQuestions(assessment.id));
  if (questions === undefined) return sidePanel(t('quiz.title'), el('div', { class: 'row-placeholder', text: t('detail.loading') }));
  if (questions.error) return sidePanel(t('quiz.title'), el('p', { class: 'form-error', text: t('quiz.questionsUnavailable', { msg: questions.error }) }));
  if (questions.length === 0) return sidePanel(t('quiz.title'), el('p', { class: 'form-error', text: t('quiz.noQuestions') }));

  const attempt = attemptFor(assessment);
  const ordered = sortQuestions(questions);
  attempt.index = Math.min(attempt.index, ordered.length - 1);
  const question = ordered[attempt.index];
  const isLast = attempt.index === ordered.length - 1;

  const timerNode = assessment.time_limit_minutes != null ? el('span', { class: 'quiz-timer', text: '--:--' }) : null;

  const prevBtn = el('button', {
    class: 'btn btn-ghost',
    type: 'button',
    disabled: attempt.index === 0,
    onclick: () => {
      attempt.index -= 1;
      notify();
    },
    text: t('quiz.prev'),
  });
  const nextOrSubmitBtn = isLast
    ? el('button', { class: 'btn btn-primary', type: 'submit', disabled: attempt.submitting, text: attempt.submitting ? t('quiz.submitting') : t('quiz.submit') })
    : el('button', {
        class: 'btn btn-primary',
        type: 'button',
        onclick: () => {
          attempt.index += 1;
          notify();
        },
        text: t('quiz.next'),
      });

  const form = el(
    'form',
    {
      class: 'panel-form quiz-take-form',
      onsubmit: (e) => {
        e.preventDefault();
        if (isLast) submit(assessment, attempt);
      },
    },
    [
      el('p', { class: 'turnin-assignment' }, [el('strong', { text: assessment.title }), timerNode]),
      assessment.instructions ? el('p', { class: 'detail-body take-quiz-instructions', text: assessment.instructions }) : null,
      el(
        'div',
        { class: 'quiz-take-pager' },
        ordered.map((q, i) => pagerDot(q, attempt, i)),
      ),
      el('div', { class: 'quiz-take-question' }, [
        el('div', { class: 'quiz-q-head' }, [
          el('span', { class: 'quiz-q-n', text: t('detail.question', { n: attempt.index + 1 }) }),
          question.points != null ? el('span', { class: 'quiz-q-pts', text: `${question.points} ${t('unit.pts')}` }) : null,
        ]),
        el('p', { class: 'quiz-q-prompt', text: question.prompt }),
        Array.isArray(question.options) && question.options.length > 0
          ? el(
              'div',
              { class: 'quiz-take-options', role: 'radiogroup', 'aria-label': question.prompt },
              question.options.map((option, i) => optionButton(question, attempt, i, option)),
            )
          : el('p', { class: 'row-placeholder', text: t('quiz.unsupportedQuestion') }),
      ]),
      el('p', { class: 'take-quiz-progress', text: t('quiz.answeredCount', { n: answeredCount(attempt.answers), total: ordered.length }) }),
      attempt.error ? el('p', { class: 'form-error', role: 'alert', text: attempt.error }) : null,
      el('div', { class: 'panel-actions' }, [prevBtn, nextOrSubmitBtn]),
    ],
  );

  if (timerNode) {
    const deadline = quizDeadline(attempt.startedAt, assessment.time_limit_minutes);
    queueMicrotask(() => attachCountdown(timerNode, deadline, () => submit(assessment, attempt, { auto: true })));
  }

  return sidePanel(t('quiz.title'), form);
}
