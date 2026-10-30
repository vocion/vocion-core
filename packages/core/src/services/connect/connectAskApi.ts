/**
 * The connect gate's and the GitHub install's entry points, in one module,
 * for `libs/connectAskBridge.ts`: the tool registry and the connect callback
 * reach them through the bridge, so their reads (projects, decisions, plugins,
 * publishing) are not compiled into every route.
 */

export { actionConnects, connectAskGate, connectorsInSetupAsk, markPublishStep, projectOfPublish, proposedAction, PUBLISH_STEP_REF, publishStepOf } from './connectAskGate';
export { connectedGithubRepos, coverageCardAtPublish, finishGithubInstall, noteRequestOnAsk, repoPickerAsk, requestedOrg, requestedSummary } from './githubInstall';
