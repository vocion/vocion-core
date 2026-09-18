import process from 'node:process';
import {
  DescribeProjectVersionsCommand,
  RekognitionClient,
  StartProjectVersionCommand,
  StopProjectVersionCommand,
} from '@aws-sdk/client-rekognition';
import { NextResponse } from 'next/server';
import { authApi, isErrorResponse, jsonError, readJsonBody } from '../../_shared';

/**
 * The workspace's trained classifier (Amazon Rekognition Custom Labels) as a
 * switch. GET reports status; POST { action: 'start' | 'stop' } flips the
 * endpoint. While RUNNING, `Analyze photo` runs the hybrid (Claude Vision +
 * classifier); otherwise Claude Vision alone. The endpoint bills per hour
 * while it runs, which is why this is a button and not always-on.
 *
 * Project comes from VOCION_REKOGNITION_PROJECT_ARN; region from
 * VOCION_REKOGNITION_REGION (falls back to AWS_REGION).
 */

const region = () => process.env.VOCION_REKOGNITION_REGION ?? process.env.AWS_REGION ?? 'us-east-1';

async function describe() {
  const projectArn = process.env.VOCION_REKOGNITION_PROJECT_ARN;
  if (!projectArn) {
    return { configured: false as const };
  }
  const rek = new RekognitionClient({ region: region() });
  const d = await rek.send(new DescribeProjectVersionsCommand({ ProjectArn: projectArn }));
  const v = (d.ProjectVersionDescriptions ?? [])[0];
  if (!v) {
    return { configured: true as const, status: 'NO_VERSIONS', versionArn: null, f1: null, since: null, project: projectArn };
  }
  return {
    configured: true as const,
    project: projectArn,
    versionArn: v.ProjectVersionArn ?? null,
    status: v.Status ?? 'UNKNOWN',
    statusMessage: v.StatusMessage ?? null,
    f1: v.EvaluationResult?.F1Score ?? null,
    since: v.CreationTimestamp?.toISOString() ?? null,
    inferenceUnits: v.MinInferenceUnits ?? null,
    hybrid: v.Status === 'RUNNING',
  };
}

/**
 * GET /api/v1/vision/model
 *
 * Whether the workspace's trained classifier is running, with the version's
 * status, F1 score, inference units and creation time. `configured: false`
 * means no model is set for this deployment; a call to AWS that fails comes
 * back as 502.
 * @param req - Request.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  try {
    return NextResponse.json(await describe());
  } catch (err) {
    return jsonError('AWS_ERROR', (err as Error).message, 502);
  }
}

/**
 * POST /api/v1/vision/model  { action }
 *
 * Start or stop the classifier endpoint — `action` is `start` or `stop`.
 * Starting from a status that cannot start is a 409; starting one already
 * running, or stopping one already stopped, is a 200 carrying a `note` rather
 * than an error, so a retry is safe. The endpoint bills per hour while it
 * runs, which is why this is a button and not always-on.
 * @param req - Request.
 */
export async function POST(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  const action = body.action;
  if (action !== 'start' && action !== 'stop') {
    return jsonError('BAD_REQUEST', 'action must be start or stop', 400);
  }
  try {
    const current = await describe();
    if (!current.configured || !current.versionArn) {
      return jsonError('NOT_CONFIGURED', 'No Rekognition model is configured for this workspace', 400);
    }
    const rek = new RekognitionClient({ region: region() });
    if (action === 'start') {
      if (current.status === 'RUNNING' || current.status === 'STARTING') {
        return NextResponse.json({ ...current, note: 'already starting or running' });
      }
      if (current.status !== 'TRAINING_COMPLETED' && current.status !== 'STOPPED') {
        return jsonError('BAD_STATE', `Cannot start from status ${current.status}`, 409);
      }
      await rek.send(new StartProjectVersionCommand({ ProjectVersionArn: current.versionArn, MinInferenceUnits: 1 }));
    } else {
      if (current.status !== 'RUNNING' && current.status !== 'STARTING') {
        return NextResponse.json({ ...current, note: 'not running' });
      }
      await rek.send(new StopProjectVersionCommand({ ProjectVersionArn: current.versionArn }));
    }
    return NextResponse.json({ ...(await describe()), requestedBy: caller.actorId, action });
  } catch (err) {
    return jsonError('AWS_ERROR', (err as Error).message, 502);
  }
}
