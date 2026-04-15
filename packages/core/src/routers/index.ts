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
import { readPrimitive, writeFile } from './Context';
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
