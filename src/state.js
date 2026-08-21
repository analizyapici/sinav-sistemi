/** Uygulama genel durumu — tek kaynak */

export const state = {
  systemPreparerName: 'Sistem Yöneticisi',
  isDbConnected: false,
  isTeacherMode: false,
  isPreviewMode: false,
  isAdminViewingResult: false,

  currentExamConfig: {
    exam_code: 'DEFAULT',
    teacher_name: 'Yükleniyor...',
    time_limit: 600,
    exam_description: '...',
    is_active: true,
  },

  quizQuestions: [], // { question, options, image } — answer yok
  studentListCache: {}, // className -> students[]
  examClasses: [],

  studentData: {},
  selectedAnswers: [],
  questionOrder: [],
  questionDurations: [],
  currentQuestionIndex: 0,
  focusLossCount: 0,
  sessionId: null,
  clientToken: null,
  examEndTimestamp: null,
  lastQuestionStartTime: 0,
  studentPassword: '', // sonuç yenileme için bellek

  timerInterval: null,
  autoSaveInterval: null,
  lastSavedAnswers: null,
  lastSavedFocus: 0,

  allSubmissions: [],
  currentSort: { column: 'score', direction: 'desc' },
};

export function clearExamRuntime() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  if (state.autoSaveInterval) clearInterval(state.autoSaveInterval);
  state.timerInterval = null;
  state.autoSaveInterval = null;
  window.onblur = null;

  state.quizQuestions = [];
  state.studentListCache = {};
  state.examClasses = [];
  state.studentData = {};
  state.selectedAnswers = [];
  state.questionOrder = [];
  state.questionDurations = [];
  state.currentQuestionIndex = 0;
  state.focusLossCount = 0;
  state.sessionId = null;
  state.clientToken = null;
  state.examEndTimestamp = null;
  state.lastQuestionStartTime = 0;
  state.studentPassword = '';
  state.isPreviewMode = false;
  state.isAdminViewingResult = false;
  state.lastSavedAnswers = null;
  state.lastSavedFocus = 0;
  state.allSubmissions = [];
}
