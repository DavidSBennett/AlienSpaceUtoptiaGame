/**
 * Single source of truth for the playtest questionnaire wording.
 *
 * Imported by BOTH the survey form (pages/PlaytestReportPage.jsx) and the
 * compiled admin report (pages/AdminPlaytestPage.jsx), so the report always
 * documents the exact statements respondents were asked — the two can't drift.
 *
 * Each Likert `id` must match a column in the playtest_feedback table
 * (likert_<id>) and the key the submit endpoint reads under `likert`.
 */

export const LIKERT_ITEMS = [
  { id: 'draw',        label: 'Drawing and collecting evidence cards was enjoyable.' },
  { id: 'publish',     label: 'Assembling and publishing research projects was satisfying.' },
  { id: 'peer_review', label: 'The peer review process was engaging.' },
  { id: 'historian',   label: 'The game made me feel like I was a historian.' },
  { id: 'learned',     label: 'I learned something from the game.' },
  { id: 'enjoyed',     label: 'Overall, I enjoyed playing the game.' },
  { id: 'play_again',  label: 'I would play this game again.' },
];

export const LIKERT_SCALE = [
  { v: 1, label: 'Strongly disagree' },
  { v: 2, label: 'Disagree' },
  { v: 3, label: 'Neutral' },
  { v: 4, label: 'Agree' },
  { v: 5, label: 'Strongly agree' },
];

export const FREE_FIELDS = [
  { id: 'enjoyed',   label: 'What did you enjoy most?' },
  { id: 'confusing', label: 'What was confusing or frustrating?' },
  { id: 'other',     label: 'Any other thoughts or suggestions?' },
];
