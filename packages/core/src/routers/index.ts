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
import {
  folders as artifactFoldersRoute,
  share as artifactShareRoute,
  exportPage as exportArtifactPageRoute,
  get as getArtifactRoute,
  version as getArtifactVersionRoute,
  listForConversation as listArtifactsForConversationRoute,
  list as listArtifactsRoute,
  versions as listArtifactVersionsRoute,
  remove as removeArtifactRoute,
  restore as restoreArtifactVersionRoute,
  setFolder as setArtifactFolderRoute,
  setShare as setArtifactShareRoute,
  update as updateArtifactRoute,
} from './Artifacts';
import { pause as pauseAutomationRoute, resume as resumeAutomationRoute } from './Automations';
import { acknowledgeAutonomyFlagRoute, demoteAutonomyRoute, listAutonomyRoute, promoteAutonomyRoute } from './Autonomy';
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
import { getState as getChatWidgetState, setRail as setChatWidgetRail, setState as setChatWidgetState } from './ChatWidget';
import {
  append as appendConvMessage,
  create as createConv,
  feedback as feedbackConvMessage,
  get as getConv,
  latestForScope as latestConvForScope,
  list as listConvs,
  recordCardDecision as recordConvCardDecision,
  remove as removeConv,
  rename as renameConv,
  search as searchConvs,
  setAutonomy as setConvAutonomy,
  setModel as setConvModel,
  tail as tailConv,
} from './Conversations';
import {
  runDetail as evalRunDetail,
  get as getEval,
  runs as listEvalRuns,
  list as listEvals,
  onlineSetEnabled as onlineEvalSetEnabled,
  onlineSetSampling as onlineEvalSetSampling,
  onlineSetUp as onlineEvalSetUp,
  onlineStatus as onlineEvalStatus,
  onlineTearDown as onlineEvalTearDown,
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
import { dismiss as dismissNavPrompt, getPrefs as getNavPrefs, setPins as setNavPins } from './Nav';
import { get as getPlaybook, list as listPlaybooks } from './Playbooks';
import { list as listPluginsRoute, set as setPluginRoute } from './Plugins';
import { getRoute as getPreviewRoute } from './Preview';
import { changePasswordRoute, getProfileRoute, updateNameRoute } from './Profile';
import { list as listProjects, setActive as setActiveProject } from './Projects';
import {
  actionStatusRoute,
  approveContentRoute,
  cancel,
  contextRoute,
  decideActionRoute,
  getWorkflowRunRoute,
  listAutoExecutedRoute,
  listPendingActionsRoute,
  listPendingActionTypesRoute,
  listWorkflowRunsRoute,
  proposeFromRecommendationRoute,
  recordSignalRoute,
  regenerateActionRoute,
  resume,
  rewriteDraftRoute,
  snoozeActionRoute,
  submitFeedback,
  unapproveContentRoute,
  undoActionRoute,
} from './Review';
import { scorecardAgentsRoute } from './Scorecard';
import { applyConfigRoute as applyTeamReportConfigRoute, planConfigRoute as planTeamReportConfigRoute, lineageRoute as teamReportLineageRoute } from './TeamReport';
import { list as listTeamsRoute, seedSample as seedSampleTeamsRoute } from './Teams';
import { applyNow as applyWorkspaceNow, pause as pauseWorkspaceRoute, readPrimitive, resume as resumeWorkspaceRoute, driftDiff as workspaceDriftDiff, driftStatus as workspaceDriftStatus, pauseState as workspacePauseState, writeFile } from './Workspace';

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
    driftDiff: workspaceDriftDiff,
    applyNow: applyWorkspaceNow,
  },
  // The workspace's off switch. Under `workspace` rather than `context`
  // because it is a fact about the running workspace, not about the authored
  // files that `context.*` reads and applies.
  workspace: {
    pauseState: workspacePauseState,
    pause: pauseWorkspaceRoute,
    resume: resumeWorkspaceRoute,
  },
  plugins: {
    list: listPluginsRoute,
    set: setPluginRoute,
  },
  preview: {
    get: getPreviewRoute,
  },
  playbooks: {
    list: listPlaybooks,
    get: getPlaybook,
  },
  automations: {
    pause: pauseAutomationRoute,
    resume: resumeAutomationRoute,
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
  nav: {
    getPrefs: getNavPrefs,
    setPins: setNavPins,
    dismiss: dismissNavPrompt,
  },
  teams: {
    list: listTeamsRoute,
    seedSample: seedSampleTeamsRoute,
  },
  teamReport: {
    lineage: teamReportLineageRoute,
    planConfig: planTeamReportConfigRoute,
    applyConfig: applyTeamReportConfigRoute,
  },
  autonomy: {
    list: listAutonomyRoute,
    promote: promoteAutonomyRoute,
    demote: demoteAutonomyRoute,
    acknowledgeFlag: acknowledgeAutonomyFlagRoute,
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
  artifacts: {
    listForConversation: listArtifactsForConversationRoute,
    get: getArtifactRoute,
    list: listArtifactsRoute,
    folders: artifactFoldersRoute,
    update: updateArtifactRoute,
    setFolder: setArtifactFolderRoute,
    versions: listArtifactVersionsRoute,
    version: getArtifactVersionRoute,
    restore: restoreArtifactVersionRoute,
    remove: removeArtifactRoute,
    exportPage: exportArtifactPageRoute,
    share: artifactShareRoute,
    setShare: setArtifactShareRoute,
  },
  conversations: {
    list: listConvs,
    get: getConv,
    create: createConv,
    delete: removeConv,
    rename: renameConv,
    append: appendConvMessage,
    latestForScope: latestConvForScope,
    search: searchConvs,
    tail: tailConv,
    feedback: feedbackConvMessage,
    recordCardDecision: recordConvCardDecision,
    setAutonomy: setConvAutonomy,
    setModel: setConvModel,
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
    // Continuous scoring of live traffic. Each of these changes what the
    // customer's AWS account is being charged — see services/evals/online.ts.
    online: {
      status: onlineEvalStatus,
      setUp: onlineEvalSetUp,
      setEnabled: onlineEvalSetEnabled,
      setSampling: onlineEvalSetSampling,
      tearDown: onlineEvalTearDown,
    },
  },
  budgets: {
    get: getBudget,
    upsert: upsertBudget,
  },
  chatWidget: {
    getState: getChatWidgetState,
    setState: setChatWidgetState,
    setRail: setChatWidgetRail,
  },
  briefings: {
    regenerate: briefingsRegenerateRoute,
    latest: briefingsLatestRoute,
  },
  scorecard: {
    agents: scorecardAgentsRoute,
  },
  review: {
    listPendingActions: listPendingActionsRoute,
    listPendingActionTypes: listPendingActionTypesRoute,
    listAutoExecuted: listAutoExecutedRoute,
    decideAction: decideActionRoute,
    undoAction: undoActionRoute,
    snoozeAction: snoozeActionRoute,
    regenerateAction: regenerateActionRoute,
    approveContent: approveContentRoute,
    unapproveContent: unapproveContentRoute,
    propose: proposeFromRecommendationRoute,
    recordSignal: recordSignalRoute,
    rewriteDraft: rewriteDraftRoute,
    actionStatus: actionStatusRoute,
    context: contextRoute,
    submitFeedback,
    listWorkflowRuns: listWorkflowRunsRoute,
    getWorkflowRun: getWorkflowRunRoute,
    resumeWorkflow: resume,
    cancelWorkflow: cancel,
  },
};
