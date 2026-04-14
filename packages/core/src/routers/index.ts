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
  approve,
  cancel,
  getRun,
  getWorkflowRunRoute,
  listPendingSkillRuns,
  listWorkflowRunsRoute,
  reject,
  resume,
} from './Review';

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
  review: {
    listSkillRuns: listPendingSkillRuns,
    getSkillRun: getRun,
    approveSkillRun: approve,
    rejectSkillRun: reject,
    listWorkflowRuns: listWorkflowRunsRoute,
    getWorkflowRun: getWorkflowRunRoute,
    resumeWorkflow: resume,
    cancelWorkflow: cancel,
  },
};
