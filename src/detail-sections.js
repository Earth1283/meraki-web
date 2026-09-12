// The sections a detail panel shows under its fields, for the kinds of row
// that have more to show: a grade or assignment's feedback and your work, a
// submitted quiz's answers, a portfolio item's actions.
import * as api from './api.js';
import { state, openTurnIn } from './state.js';
import { lazyFetch } from './lazy.js';
import { submissionForAssessment, submissionForAssignment } from './rows.js';
import { teacherFeedback, renderTeacherFeedback } from './feedback.js';
import { assignmentForTarget, renderYourWork } from './submission.js';
import { renderQuizReview } from './quiz.js';
import { portfolioActions } from './portfolio.js';
import { downloadFileUpload } from './files.js';

export function detailSections(target) {
  const data = state.data;
  switch (target.kind) {
    case 'portfolio':
      return [portfolioActions(data.portfolio[target.index])].filter(Boolean);
    case 'grade':
    case 'assignment': {
      const nodes = [];
      const feedback = teacherFeedback(target, data);
      if (feedback) nodes.push(renderTeacherFeedback(feedback));
      const assignment = assignmentForTarget(target, data);
      if (assignment) {
        const submission = submissionForAssignment(data, assignment.id);
        const annotations = submission ? lazyFetch(`annotations:${submission.id}`, () => api.getSubmissionAnnotations(submission.id)) : [];
        nodes.push(renderYourWork({ assignment, submission, annotations, onTurnIn: () => openTurnIn(assignment.id), onDownload: downloadFileUpload }));
      }
      return nodes;
    }
    case 'assessment': {
      const assessment = data.assessments[target.index];
      const sub = submissionForAssessment(data, assessment);
      if (!sub) return [];
      const answers = lazyFetch(`answers:${sub.id}`, () => api.getAssessmentAnswers(sub.id));
      const questions = lazyFetch(`questions:${assessment.id}`, () => api.getAssessmentQuestions(assessment.id));
      return [renderQuizReview(answers, questions)];
    }
    default:
      return [];
  }
}
