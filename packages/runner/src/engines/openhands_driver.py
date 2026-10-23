"""One OpenHands pass in the runner's checkout, printed as Claude Code stream-json.

The runner (src/runner.mjs) reads an engine pass the same way whatever ran it: one JSON message per
line on stdout, tool calls as `assistant` messages with `tool_use` blocks, their outcomes as `user`
messages with `tool_result` blocks, and a last `type: result` line with the cost, the usage and the
report. This driver runs the OpenHands Software Agent SDK (MIT, `openhands-sdk` and
`openhands-tools`, no browser, no agent-server, no posthog) in this process and prints exactly that,
so the runner's events, transcript, cost and usage code need no second reader.

    python3 openhands_driver.py --model anthropic/claude-opus-5-5 --budget 5 \
        --workdir /workspace/repo --session-id <uuid> [--resume <uuid>] < prompt.md

The guard is the runner's own: each tool call goes through hooks/openhands-guard.sh (a PreToolUse
hook, exit 2 blocks), which hands it to guard-bash.sh or guard-write.sh in the shape they read.
The model key is read once and removed from this process's environment before any tool starts, so
the agent's shell never holds it.
"""

import argparse
import json
import os
import sys
import time
import uuid

os.environ.setdefault('OPENHANDS_SUPPRESS_BANNER', '1')
# Telemetry off, whatever the image's environment says: no Laminar traces, no LiteLLM callbacks.
for k in ('LMNR_PROJECT_API_KEY', 'LMNR_BASE_URL', 'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'):
    os.environ.pop(k, None)
os.environ['LITELLM_TELEMETRY'] = 'False'
os.environ['ANONYMIZED_TELEMETRY'] = 'false'

# The secrets the agent's shell must never hold. Read what the LLM needs, then drop them all.
SECRET_ENV = ('ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN', 'VOCION_TOKEN', 'VOCION_RUNNER_TOKEN',
              'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
              'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI', 'AWS_CONTAINER_CREDENTIALS_FULL_URI',
              'AWS_CONTAINER_AUTHORIZATION_TOKEN')

# OpenHands tool names, as the runner's events and hooks know them (Claude Code's names).
FILE_COMMANDS = {'create': 'Write', 'str_replace': 'Edit', 'insert': 'Edit', 'undo_edit': 'Edit', 'view': 'Read'}


def out(obj):
    sys.stdout.write(json.dumps(obj, default=str) + '\n')
    sys.stdout.flush()


def claude_tool(tool_name, action):
    """The Claude Code name and input for an OpenHands action, for events, the ledger and hooks."""
    a = action or {}
    if tool_name == 'terminal':
        return 'Bash', {'command': a.get('command', '')}
    if tool_name == 'file_editor':
        cmd = a.get('command', '')
        name = FILE_COMMANDS.get(cmd, 'Edit')
        inp = {'file_path': a.get('path', '')}
        if cmd == 'create':
            inp['content'] = a.get('file_text') or ''
        elif cmd == 'str_replace':
            inp['old_string'] = a.get('old_str') or ''
            inp['new_string'] = a.get('new_str') or ''
        elif cmd == 'insert':
            inp['old_string'] = ''
            inp['new_string'] = a.get('new_str') or ''
        return name, inp
    if tool_name == 'task_tracker':
        return 'TodoWrite', {'todos': a.get('task_list') or []}
    return tool_name, a


def text_of(contents):
    parts = []
    for c in contents or []:
        t = getattr(c, 'text', None)
        if isinstance(t, str):
            parts.append(t)
    return '\n'.join(parts)


def usage_dict(u):
    """A TokenUsage as Anthropic's usage block (input excludes cache reads and writes)."""
    if not u:
        return {'input_tokens': 0, 'output_tokens': 0, 'cache_read_input_tokens': 0, 'cache_creation_input_tokens': 0}
    read = int(u.cache_read_tokens or 0)
    write = int(u.cache_write_tokens or 0)
    return {
        'input_tokens': max(0, int(u.prompt_tokens or 0) - read - write),
        'output_tokens': int(u.completion_tokens or 0),
        'cache_read_input_tokens': read,
        'cache_creation_input_tokens': write,
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--model', required=True)
    p.add_argument('--budget', type=float, required=True)
    p.add_argument('--workdir', required=True)
    p.add_argument('--session-id', default=None)
    p.add_argument('--resume', default=None)
    p.add_argument('--persist-dir', default=os.path.expanduser('~/.openhands-runner/conversations'))
    p.add_argument('--system-suffix-file', default=None)
    p.add_argument('--hooks-dir', default=os.environ.get('RUNNER_HOME', '/opt/vocion-runner') + '/hooks')
    p.add_argument('--effort', default=None)
    p.add_argument('--max-iterations', type=int, default=500)
    args = p.parse_args()
    prompt = sys.stdin.read()

    secrets = {k: os.environ.pop(k) for k in SECRET_ENV if k in os.environ}

    from pydantic import SecretStr
    from openhands.sdk import LLM, Agent, AgentContext, Conversation, Tool
    from openhands.sdk.event import ActionEvent, AgentErrorEvent, MessageEvent, ObservationEvent
    from openhands.sdk.event.conversation_error import ConversationErrorEvent
    from openhands.sdk.event.llm_convertible.observation import UserRejectObservation
    from openhands.sdk.hooks import HookConfig, HookDefinition, HookMatcher
    from openhands.sdk.conversation.response_utils import get_agent_final_response
    from openhands.tools.file_editor import FileEditorTool
    from openhands.tools.task_tracker import TaskTrackerTool
    from openhands.tools.terminal import TerminalTool
    from openhands.tools.preset.default import register_default_tools

    register_default_tools(enable_browser=False)

    llm_kwargs = {'model': args.model, 'usage_id': 'agent', 'num_retries': 5}
    if args.model.startswith('bedrock/'):
        # Production path: Claude on Bedrock. The task role's credentials are resolved here, once,
        # and handed to LiteLLM; the agent's shell never sees them (see docs in openhands.mjs).
        import boto3
        session = boto3.Session()
        creds = session.get_credentials().get_frozen_credentials()
        llm_kwargs.update(aws_access_key_id=SecretStr(creds.access_key), aws_secret_access_key=SecretStr(creds.secret_key),
                          aws_region_name=os.environ.get('AWS_REGION') or os.environ.get('AWS_DEFAULT_REGION') or session.region_name)
        if creds.token:
            llm_kwargs['aws_session_token'] = SecretStr(creds.token)
    elif 'ANTHROPIC_API_KEY' in secrets:
        llm_kwargs['api_key'] = SecretStr(secrets['ANTHROPIC_API_KEY'])
    if args.effort:
        llm_kwargs['reasoning_effort'] = args.effort
    llm = LLM(**llm_kwargs)
    secrets.clear()

    suffix = None
    if args.system_suffix_file and os.path.exists(args.system_suffix_file):
        with open(args.system_suffix_file, encoding='utf-8') as f:
            suffix = f.read()
    agent = Agent(
        llm=llm,
        tools=[Tool(name=TerminalTool.name), Tool(name=FileEditorTool.name), Tool(name=TaskTrackerTool.name)],
        agent_context=AgentContext(system_message_suffix=suffix, load_user_skills=False, load_public_skills=False, load_project_skills=True),
    )

    guard = os.path.join(args.hooks_dir, 'openhands-guard.sh')
    ledger = os.path.join(args.hooks_dir, 'openhands-log-tool.sh')
    hooks = HookConfig(
        pre_tool_use=[HookMatcher(matcher='*', hooks=[HookDefinition(command=guard, timeout=30)])],
        post_tool_use=[HookMatcher(matcher='*', hooks=[HookDefinition(command=ledger, timeout=30)])],
    )

    session_id = args.resume or args.session_id or str(uuid.uuid4())
    started = time.time()
    state = {'turns': 0, 'denials': [], 'last_usage': None, 'is_error': False, 'subtype': 'success', 'error': ''}

    def usage_now(conv):
        m = conv.conversation_stats.get_combined_metrics()
        return m.accumulated_cost or 0.0, m.accumulated_token_usage

    def delta_usage(conv):
        _, u = usage_now(conv)
        cur = usage_dict(u)
        prev = state['last_usage'] or {k: 0 for k in cur}
        state['last_usage'] = cur
        return {k: max(0, cur[k] - prev.get(k, 0)) for k in cur}

    conv_ref = {}

    def on_event(ev):
        conv = conv_ref.get('c')
        if isinstance(ev, ActionEvent):
            state['turns'] += 1
            content = []
            thought = text_of(ev.thought)
            if thought.strip():
                content.append({'type': 'text', 'text': thought})
            action = ev.action.model_dump() if ev.action is not None else {}
            if ev.tool_name == 'finish':
                msg = action.get('message') or ''
                if msg.strip():
                    content.append({'type': 'text', 'text': msg})
            elif ev.tool_name != 'think':
                name, inp = claude_tool(ev.tool_name, action)
                content.append({'type': 'tool_use', 'id': ev.tool_call_id, 'name': name, 'input': inp})
            msg = {'type': 'assistant', 'session_id': session_id, 'message': {'model': args.model.split('/', 1)[-1], 'content': content}}
            if conv is not None:
                msg['message']['usage'] = delta_usage(conv)
            out(msg)
        elif isinstance(ev, UserRejectObservation):
            state['denials'].append({'tool_name': ev.tool_name, 'tool_use_id': ev.tool_call_id, 'reason': ev.rejection_reason})
            out({'type': 'user', 'message': {'content': [{'type': 'tool_result', 'tool_use_id': ev.tool_call_id, 'is_error': True, 'content': ev.rejection_reason}]}})
        elif isinstance(ev, ObservationEvent):
            obs = ev.observation
            is_error = bool(getattr(obs, 'is_error', False))
            out({'type': 'user', 'message': {'content': [{'type': 'tool_result', 'tool_use_id': ev.tool_call_id, 'is_error': is_error, 'content': text_of(obs.to_llm_content)[:20000]}]}})
        elif isinstance(ev, AgentErrorEvent):
            out({'type': 'user', 'message': {'content': [{'type': 'tool_result', 'tool_use_id': ev.tool_call_id, 'is_error': True, 'content': ev.error[:4000]}]}})
        elif isinstance(ev, MessageEvent) and ev.source == 'agent':
            t = text_of(ev.llm_message.content)
            if t.strip():
                msg = {'type': 'assistant', 'session_id': session_id, 'message': {'model': args.model.split('/', 1)[-1], 'content': [{'type': 'text', 'text': t}]}}
                if conv is not None:
                    msg['message']['usage'] = delta_usage(conv)
                out(msg)
        elif isinstance(ev, ConversationErrorEvent):
            state['is_error'] = True
            state['error'] = f'{ev.code}: {ev.detail}'
            state['subtype'] = 'error_max_budget_usd' if 'budget' in (ev.code + ev.detail).lower() else 'error_during_execution'

    os.makedirs(args.persist_dir, exist_ok=True)
    conv = Conversation(
        agent=agent,
        workspace=args.workdir,
        persistence_dir=args.persist_dir,
        conversation_id=uuid.UUID(session_id),
        callbacks=[on_event],
        hook_config=hooks,
        max_iteration_per_run=args.max_iterations,
        max_budget_per_run=args.budget,
        visualizer=None,
        delete_on_close=False,
    )
    conv_ref['c'] = conv
    # A resumed session reports its running totals, as Claude Code does; the runner takes the delta.
    out({'type': 'system', 'subtype': 'init', 'session_id': session_id, 'model': args.model, 'engine': 'openhands'})
    start_cost, _ = usage_now(conv)
    state['last_usage'] = usage_dict(usage_now(conv)[1])
    # A resumed conversation already spent start_cost; this pass may spend its own budget on top.
    if args.resume:
        conv.max_budget_per_run = start_cost + args.budget
    report = ''
    try:
        conv.send_message(prompt)
        conv.run()
        report = get_agent_final_response(conv.state.events) or ''
    except Exception as e:  # the run ends with a result line whatever happened
        state['is_error'] = True
        state['subtype'] = 'error_during_execution'
        state['error'] = f'{type(e).__name__}: {e}'[:2000]
    cost, u = usage_now(conv)
    model_id = args.model.split('/', 1)[-1]
    usage = usage_dict(u)
    out({
        'type': 'result',
        'subtype': state['subtype'],
        'is_error': state['is_error'],
        'result': report if report else state['error'],
        'session_id': session_id,
        'num_turns': state['turns'],
        'duration_ms': int((time.time() - started) * 1000),
        'total_cost_usd': round(cost, 6),
        'usage': usage,
        'modelUsage': {model_id: {'inputTokens': usage['input_tokens'], 'outputTokens': usage['output_tokens'], 'cacheReadInputTokens': usage['cache_read_input_tokens'], 'cacheCreationInputTokens': usage['cache_creation_input_tokens'], 'costUSD': round(cost, 6)}},
        'permission_denials': state['denials'],
        'engine': 'openhands',
    })
    try:
        conv.close()
    except Exception:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
