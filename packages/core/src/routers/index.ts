import { get as getBudget, upsert as upsertBudget } from './Budgets';
import {
  addLink,
  create as createObject,
  createType,
  generateSummary,
  get as getObject,
  list as listObjects,
  listTypes,
  removeLink,
  remove as removeObject,
  update as updateObject,
} from './BusinessObject';
import {
  append as appendConvMessage,
  create as createConv,
  get as getConv,
  list as listConvs,
  remove as removeConv,
  rename as renameConv,
} from './Conversations';
import {
  runDetail as evalRunDetail,
  get as getEval,
  runs as listEvalRuns,
  list as listEvals,
  run as runEval,
} from './Evals';
import {
  add as addLearning,
  check as checkLearning,
  get as getLearning,
  listLearningSteps,
  remove as removeLearning,
  update as updateLearning,
} from './Learnings';
import {
  cancel as cancelMissionRoute,
  get as getMissionRoute,
  getRun as getMissionRunRoute,
  listRuns as listMissionRunsRoute,
  list as listMissionsRoute,
  promote as promoteMissionRoute,
  resume as resumeMissionRoute,
  start as startMissionRoute,
  submitFeedback as submitMissionFeedbackRoute,
} from './Missions';
import { get as getPlaybook, list as listPlaybooks } from './Playbooks';
import {
  approve,
  cancel,
  getRun,
  getWorkflowRunRoute,
  listPendingSkillRuns,
  listWorkflowRunsRoute,
  reject,
  resume,
  submitFeedback,
} from './Review';
import { readPrimitive, writeFile } from './Workspace';

export const router = {
  businessObject: {
    listTypes,
    createType,
    list: listObjects,
    get: getObject,
    create: createObject,
    update: updateObject,
    remove: removeObject,
    addLink,
    removeLink,
    generateSummary,
  },
  context: {
    readPrimitive,
    writeFile,
  },
  playbooks: {
    list: listPlaybooks,
    get: getPlaybook,
  },
  missions: {
    list: listMissionsRoute,
    get: getMissionRoute,
    start: startMissionRoute,
    listRuns: listMissionRunsRoute,
    getRun: getMissionRunRoute,
    resume: resumeMissionRoute,
    cancel: cancelMissionRoute,
    submitFeedback: submitMissionFeedbackRoute,
    promote: promoteMissionRoute,
  },
  conversations: {
    list: listConvs,
    get: getConv,
    create: createConv,
    delete: removeConv,
    rename: renameConv,
    append: appendConvMessage,
  },
  learnings: {
    listSteps: listLearningSteps,
    get: getLearning,
    check: checkLearning,
    add: addLearning,
    update: updateLearning,
    remove: removeLearning,
  },
  evals: {
    list: listEvals,
    get: getEval,
    run: runEval,
    runs: listEvalRuns,
    runDetail: evalRunDetail,
  },
  budgets: {
    get: getBudget,
    upsert: upsertBudget,
  },
  review: {
    listSkillRuns: listPendingSkillRuns,
    getSkillRun: getRun,
    approveSkillRun: approve,
    rejectSkillRun: reject,
    submitFeedback,
    listWorkflowRuns: listWorkflowRunsRoute,
    getWorkflowRun: getWorkflowRunRoute,
    resumeWorkflow: resume,
    cancelWorkflow: cancel,
  },
};
