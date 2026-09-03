import {
  adoptionAgentDetailRoute,
  adoptionAgentsRoute,
  adoptionOverviewRoute,
  adoptionTrendRoute,
  adoptionUserDetailRoute,
  adoptionUsersRoute,
} from './Analytics';
import {
  apply as applyComment,
  create as createComment,
  list as listComments,
  remove as removeComment,
} from './AnchoredComments';
import { createPlatformKeyRoute, createTokenRoute, listPlatformsRoute, listTokensRoute, revealPlatformKeyRoute, revokeTokenRoute } from './ApiTokens';
import { latestRoute as briefingsLatestRoute, regenerateRoute as briefingsRegenerateRoute } from './Briefings';
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
import { suggestions as chatSuggestions } from './Chat';
import { getState as getChatWidgetState, setState as setChatWidgetState } from './ChatWidget';
import {
  append as appendConvMessage,
  create as createConv,
  get as getConv,
  latestForScope as latestConvForScope,
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
  changeRoleRoute,
  createInviteRoute,
  listInvitesRoute,
  listMembersRoute,
  removeMemberRoute,
  revokeInviteRoute,
} from './Members';
import {
  cancel as cancelMissionRoute,
  check as checkMissionRoute,
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
import { changePasswordRoute, getProfileRoute, updateNameRoute } from './Profile';
import { list as listProjects, setActive as setActiveProject } from './Projects';
import {
  cancel,
  decideActionRoute,
  getWorkflowRunRoute,
  listAutoExecutedRoute,
  listPendingActionsRoute,
  listWorkflowRunsRoute,
  proposeFromRecommendationRoute,
  recordSignalRoute,
  resume,
  rewriteDraftRoute,
  snoozeActionRoute,
  submitFeedback,
} from './Review';
import { list as listTeamsRoute, seedSample as seedSampleTeamsRoute } from './Teams';
import { applyNow as applyWorkspaceNow, readPrimitive, driftStatus as workspaceDriftStatus, writeFile } from './Workspace';

export const router = {
  adoption: {
    overview: adoptionOverviewRoute,
    users: adoptionUsersRoute,
    agents: adoptionAgentsRoute,
    trend: adoptionTrendRoute,
    userDetail: adoptionUserDetailRoute,
    agentDetail: adoptionAgentDetailRoute,
  },
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
    driftStatus: workspaceDriftStatus,
    applyNow: applyWorkspaceNow,
  },
  playbooks: {
    list: listPlaybooks,
    get: getPlaybook,
  },
  missions: {
    list: listMissionsRoute,
    check: checkMissionRoute,
    get: getMissionRoute,
    start: startMissionRoute,
    listRuns: listMissionRunsRoute,
    getRun: getMissionRunRoute,
    resume: resumeMissionRoute,
    cancel: cancelMissionRoute,
    submitFeedback: submitMissionFeedbackRoute,
    promote: promoteMissionRoute,
  },
  profile: {
    get: getProfileRoute,
    updateName: updateNameRoute,
    changePassword: changePasswordRoute,
  },
  projects: {
    list: listProjects,
    setActive: setActiveProject,
  },
  teams: {
    list: listTeamsRoute,
    seedSample: seedSampleTeamsRoute,
  },
  apiTokens: {
    list: listTokensRoute,
    create: createTokenRoute,
    createPlatformKey: createPlatformKeyRoute,
    listPlatforms: listPlatformsRoute,
    revealPlatformKey: revealPlatformKeyRoute,
    revoke: revokeTokenRoute,
  },
  members: {
    list: listMembersRoute,
    invites: listInvitesRoute,
    invite: createInviteRoute,
    revokeInvite: revokeInviteRoute,
    changeRole: changeRoleRoute,
    remove: removeMemberRoute,
  },
  chat: {
    suggestions: chatSuggestions,
  },
  anchoredComments: {
    list: listComments,
    create: createComment,
    apply: applyComment,
    delete: removeComment,
  },
  conversations: {
    list: listConvs,
    get: getConv,
    create: createConv,
    delete: removeConv,
    rename: renameConv,
    append: appendConvMessage,
    latestForScope: latestConvForScope,
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
  chatWidget: {
    getState: getChatWidgetState,
    setState: setChatWidgetState,
  },
  briefings: {
    regenerate: briefingsRegenerateRoute,
    latest: briefingsLatestRoute,
  },
  review: {
    listPendingActions: listPendingActionsRoute,
    listAutoExecuted: listAutoExecutedRoute,
    decideAction: decideActionRoute,
    snoozeAction: snoozeActionRoute,
    propose: proposeFromRecommendationRoute,
    recordSignal: recordSignalRoute,
    rewriteDraft: rewriteDraftRoute,
    submitFeedback,
    listWorkflowRuns: listWorkflowRunsRoute,
    getWorkflowRun: getWorkflowRunRoute,
    resumeWorkflow: resume,
    cancelWorkflow: cancel,
  },
};
