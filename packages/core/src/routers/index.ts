import type { AnyRouter } from '@orpc/server';
import { extensionRouters } from '@/libs/extensions';
import { setVoice as setAgentVoiceRoute, setLeadName as setLeadNameRoute } from './Agents';
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
import { forUser as appsForUserRoute, installTemplate as appsInstallTemplateRoute, templates as appsTemplatesRoute } from './Apps';
import {
  featureShare as artifactFeatureShareRoute,
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
  setFeatureShare as setArtifactFeatureShareRoute,
  setFolder as setArtifactFolderRoute,
  setShare as setArtifactShareRoute,
  update as updateArtifactRoute,
} from './Artifacts';
import { pause as pauseAutomationRoute, resume as resumeAutomationRoute } from './Automations';
import { acknowledgeAutonomyFlagRoute, demoteAutonomyRoute, listAutonomyRoute, promoteAutonomyRoute } from './Autonomy';
import { get as getBrandRoute, restore as restoreBrandRoute, save as saveBrandRoute, uploadLogo as uploadBrandLogoRoute } from './Branding';
import { latestRoute as briefingsLatestRoute, personalRoute as briefingsPersonalRoute, regenerateRoute as briefingsRegenerateRoute } from './Briefings';
import { get as getBudget, upsert as upsertBudget } from './Budgets';
import {
  addLink,
  create as createObject,
  createType,
  generateSummary,
  get as getObject,
  list as listObjects,
  listTypes,
  history as objectHistory,
  removeLink,
  remove as removeObject,
  restore as restoreObject,
  update as updateObject,
} from './BusinessObject';
import { hintEvent as chatHintEvent, suggestions as chatSuggestions } from './Chat';
import { getState as getChatWidgetState, setRail as setChatWidgetRail, setState as setChatWidgetState } from './ChatWidget';
import { addConnectorRoute, revealStoredCredentialRoute, saveSourceRoute as saveConnectedSourceRoute } from './Connect';
import { finishConnectionsRoute, planConnectionsRoute, saveConnectionKeyRoute, verifyConnectionRoute } from './ConnectSystems';
import {
  append as appendConvMessage,
  intake as conversationIntake,
  create as createConv,
  feedback as feedbackConvMessage,
  get as getConv,
  latestForScope as latestConvForScope,
  list as listConvs,
  remove as removeConv,
  rename as renameConv,
  search as searchConvs,
  setAutonomy as setConvAutonomy,
  setModel as setConvModel,
  tail as tailConv,
} from './Conversations';
import { answerRoute as answerDecisionRoute, buildRoute as buildDecisionRoute, openRoute as openDecisionsRoute, waitingRoute as waitingDecisionsRoute } from './Decisions';
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
  create as createGroupRoute,
  overview as groupsOverviewRoute,
  removeDirect as removeDirectGrantRoute,
  remove as removeGroupRoute,
  setGrant as setGroupGrantRoute,
  setMember as setGroupMemberRoute,
} from './Groups';
import { acceptBatchRoute as inboxAcceptBatchRoute, mineCountRoute as inboxMineCountRoute, mineRoute as inboxMineRoute, undoDefaultRoute as inboxUndoDefaultRoute } from './Inbox';
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
  inviteDeliveryRoute,
  listInvitesRoute,
  listMembersRoute,
  removeMemberRoute,
  resendInviteRoute,
  resetSecondFactorRoute,
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
import { dismiss as dismissNavPrompt, getPrefs as getNavPrefs, gettingStarted as navGettingStarted, setPins as setNavPins } from './Nav';
import { get as getPlaybook, list as listPlaybooks } from './Playbooks';
import { addApp as addAppRoute, list as listPluginsRoute, set as setPluginRoute } from './Plugins';
import { getRoute as getPreviewRoute, statusRoute as previewStatusRoute } from './Preview';
import { changePasswordRoute, disableMfaRoute, getProfileRoute, invitationsRoute, mfaStatusRoute, regenerateRecoveryCodesRoute, setAccountMfaRequirementRoute, signInMethodsRoute, unlinkSignInMethodRoute, updateNameRoute, updatePhoneRoute } from './Profile';
import { list as listProjects, setActive as setActiveProject } from './Projects';
import {
  actAsPersonRoute,
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
import { glanceRoute as runGlanceRoute, logRoute as runLogRoute } from './Runs';
import { scorecardAgentsRoute } from './Scorecard';
import { reset as resetSetupRoute, state as setupStateRoute } from './Setup';
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
    history: objectHistory,
    restore: restoreObject,
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
  setup: {
    state: setupStateRoute,
    reset: resetSetupRoute,
  },
  plugins: {
    list: listPluginsRoute,
    set: setPluginRoute,
    addApp: addAppRoute,
  },
  preview: {
    get: getPreviewRoute,
    status: previewStatusRoute,
  },
  runs: {
    log: runLogRoute,
    glance: runGlanceRoute,
  },
  playbooks: {
    list: listPlaybooks,
    get: getPlaybook,
  },
  agents: {
    setVoice: setAgentVoiceRoute,
    setLeadName: setLeadNameRoute,
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
    updatePhone: updatePhoneRoute,
    changePassword: changePasswordRoute,
    signInMethods: signInMethodsRoute,
    unlinkSignInMethod: unlinkSignInMethodRoute,
    invitations: invitationsRoute,
    mfa: {
      status: mfaStatusRoute,
      disable: disableMfaRoute,
      regenerateRecoveryCodes: regenerateRecoveryCodesRoute,
      setAccountRequirement: setAccountMfaRequirementRoute,
    },
  },
  apps: {
    forUser: appsForUserRoute,
    templates: appsTemplatesRoute,
    installTemplate: appsInstallTemplateRoute,
  },
  projects: {
    list: listProjects,
    setActive: setActiveProject,
  },
  nav: {
    getPrefs: getNavPrefs,
    gettingStarted: navGettingStarted,
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
  connect: {
    saveSource: saveConnectedSourceRoute,
    addConnector: addConnectorRoute,
    revealStoredCredential: revealStoredCredentialRoute,
  },
  connectSystems: {
    plan: planConnectionsRoute,
    saveKey: saveConnectionKeyRoute,
    verify: verifyConnectionRoute,
    finish: finishConnectionsRoute,
  },
  apiTokens: {
    list: listTokensRoute,
    create: createTokenRoute,
    createPlatformKey: createPlatformKeyRoute,
    listPlatforms: listPlatformsRoute,
    revealPlatformKey: revealPlatformKeyRoute,
    revoke: revokeTokenRoute,
  },
  groups: {
    overview: groupsOverviewRoute,
    create: createGroupRoute,
    remove: removeGroupRoute,
    setMember: setGroupMemberRoute,
    setGrant: setGroupGrantRoute,
    removeDirect: removeDirectGrantRoute,
  },
  // The Org's brand — Brand settings (admins of the caller's Org only).
  branding: {
    get: getBrandRoute,
    save: saveBrandRoute,
    restore: restoreBrandRoute,
    uploadLogo: uploadBrandLogoRoute,
  },
  members: {
    list: listMembersRoute,
    invites: listInvitesRoute,
    invite: createInviteRoute,
    inviteDelivery: inviteDeliveryRoute,
    resendInvite: resendInviteRoute,
    revokeInvite: revokeInviteRoute,
    changeRole: changeRoleRoute,
    remove: removeMemberRoute,
    resetSecondFactor: resetSecondFactorRoute,
  },
  chat: {
    suggestions: chatSuggestions,
    hintEvent: chatHintEvent,
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
    featureShare: artifactFeatureShareRoute,
    setFeatureShare: setArtifactFeatureShareRoute,
  },
  conversations: {
    intake: conversationIntake,
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
    setAutonomy: setConvAutonomy,
    setModel: setConvModel,
  },
  // A Decision docked in a conversation (`services/decisions/DecisionService.ts`).
  decisions: {
    open: openDecisionsRoute,
    waiting: waitingDecisionsRoute,
    answer: answerDecisionRoute,
    build: buildDecisionRoute,
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
    personal: briefingsPersonalRoute,
  },
  inbox: {
    mine: inboxMineRoute,
    mineCount: inboxMineCountRoute,
    acceptBatch: inboxAcceptBatchRoute,
    undoDefault: inboxUndoDefaultRoute,
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
    actAsPerson: actAsPersonRoute,
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

/**
 * What `/rpc` serves: core's router, plus each extension's router at
 * `ext.<name>` (`libs/extensions.ts`). Kept apart from {@link router} so core's
 * typed client (`libs/Orpc.ts`) is typed by core's procedures alone; an
 * extension types its own client by its own router.
 */
export function servedRouter() {
  return { ...router, ext: extensionRouters() as Record<string, AnyRouter> };
}
