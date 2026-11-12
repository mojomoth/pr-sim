#!/usr/bin/env python3
"""Export local Codex/Claude prompt histories and last visible responses."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re


def timestamp(value):
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000 if value > 1e12 else value,
                                      timezone.utc).isoformat().replace('+00:00', 'Z')
    return value


def content_text(content):
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ''
    parts = []
    for block in content:
        if not isinstance(block, dict):
            continue
        kind = block.get('type', '').lower()
        if kind in ('text', 'input_text', 'output_text'):
            parts.append(block.get('text', ''))
        elif kind in ('image', 'input_image', 'image_url'):
            parts.append('[이미지 첨부: 바이너리는 내보내지 않음]')
    return '\n'.join(parts)


def rows(path, errors):
    with path.open(encoding='utf-8') as source:
        for number, line in enumerate(source, 1):
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                errors.append({'path': str(path), 'line': number})


def new_session(agent, identity):
    return dict(agent=agent, session_id=identity, models=[], model_source=None,
                model_candidates=[], cwd=None, source_files=[], timestamps=[],
                prompts=[], responses=[], model_events=[], kind='session')


def add_message(session, target, text, time, model=None, phase=None, identity=None):
    if text.strip():
        session[target].append(dict(timestamp=timestamp(time), model=model,
                                    phase=phase, id=identity, text=text))


def export_codex(root, errors):
    sessions = {}
    paths = sorted({p for directory in ('sessions', 'archived_sessions')
                    for p in (root / directory).rglob('*.jsonl')})
    for path in paths:
        session = None
        model = None
        candidates = {'completed': [], 'events': [], 'responses': []}
        for row in rows(path, errors):
            payload = row.get('payload', {})
            kind = row.get('type')
            time = row.get('timestamp')
            if kind == 'session_meta':
                identity = payload.get('id', path.stem)
                session = sessions.setdefault(identity, new_session('codex', identity))
                session['source_files'].append(str(path))
                session['cwd'] = payload.get('cwd')
                session['timestamps'].append(payload.get('timestamp', time))
            if session is None:
                continue
            if time:
                session['timestamps'].append(time)
            if kind == 'turn_context':
                model = payload.get('model', model)
                if model and model not in session['models']:
                    session['models'].append(model)
            if kind == 'event_msg' and payload.get('type') == 'item_completed':
                item = payload.get('item', {})
                if item.get('type') == 'UserMessage':
                    candidates['completed'].append((content_text(item.get('content')), time, model, item.get('id')))
                elif item.get('type') == 'AgentMessage':
                    add_message(session, 'responses', content_text(item.get('content')), time,
                                model, item.get('phase'), item.get('id'))
            elif kind == 'event_msg' and payload.get('type') == 'user_message':
                candidates['events'].append((payload.get('message', ''), time, model, None))
            elif kind == 'response_item' and payload.get('type') == 'message':
                text = content_text(payload.get('content'))
                if payload.get('role') == 'assistant':
                    add_message(session, 'responses', text, time, model,
                                payload.get('phase'), payload.get('id'))
                elif payload.get('role') == 'user':
                    metadata = payload.get('internal_chat_message_metadata_passthrough', {})
                    kinds = metadata.get('content_item_kinds', [])
                    harness = any('environment' in k or 'instruction' in k for k in kinds)
                    if not harness and not text.lstrip().startswith(('<environment_context>', '# AGENTS.md', '<turn_aborted>', '<recommended_plugins>')):
                        candidates['responses'].append((text, time, model, payload.get('id')))
        if session is not None:
            preferred = list(candidates['completed'] or candidates['events'] or candidates['responses'])
            # Raw user messages can contain attachments or interrupted inputs
            # absent from completed UI events. Preserve those without repeating
            # messages represented in both formats.
            if candidates['completed'] or candidates['events']:
                for candidate in candidates['responses']:
                    text = candidate[0]
                    matches = [i for i, entry in enumerate(preferred)
                               if entry[0] == text or entry[0] in text or text in entry[0]]
                    if not matches:
                        preferred.append(candidate)
                    elif len(matches) == 1 and len(text) > len(preferred[matches[0]][0]):
                        preferred[matches[0]] = candidate
            for text, time, model, identity in preferred:
                add_message(session, 'prompts', text, time, model, identity=identity)
    return sessions


def export_claude(root, errors):
    sessions = {}
    for path in sorted((root / 'projects').rglob('*.jsonl')):
        session = None
        subagent = 'subagents' in path.parts
        for row in rows(path, errors):
            if not row.get('sessionId'):
                continue
            identity = row['sessionId'] + ('/' + path.stem if subagent else '')
            session = sessions.setdefault(identity, new_session('claude', identity))
            session['kind'] = 'subagent' if subagent else 'session'
            if str(path) not in session['source_files']:
                session['source_files'].append(str(path))
            session['cwd'] = row.get('cwd', session['cwd'])
            time = row.get('timestamp')
            if time:
                session['timestamps'].append(timestamp(time))
            message = row.get('message', {})
            if not isinstance(message, dict):
                continue
            model = message.get('model')
            if row.get('type') == 'assistant' and model:
                session['model_events'].append((timestamp(time) or '', model))
            if model and model != '<synthetic>' and model not in session['models']:
                session['models'].append(model)
            if row.get('type') == 'user' and not row.get('isMeta'):
                add_message(session, 'prompts', content_text(message.get('content')), time,
                            identity=row.get('uuid'))
            elif row.get('type') == 'assistant':
                add_message(session, 'responses', content_text(message.get('content')), time,
                            model, identity=row.get('uuid'))
    for session in sessions.values():
        if session['models']:
            session['model_source'] = 'transcript: assistant message.model'
    return sessions


def local_day(value):
    # stats-cache.json buckets by the machine's local date.
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone().date().isoformat()
    except ValueError:
        return value[:10]


def claude_model_hints(root, sessions, errors):
    """Recover models for Claude sessions whose transcripts were cleaned up.

    Exact: ~/.claude.json keeps lastModelUsage for each project's last session.
    Estimate: stats-cache.json keeps per-day model token totals (not per session).
    """
    configs = [root / '.claude.json', root.parent / '.claude.json',
               *sorted((root / 'backups').glob('.claude.json.backup.*'))]
    usage = {}
    for path in configs:
        try:
            projects = json.loads(path.read_text(encoding='utf-8')).get('projects', {})
        except (OSError, ValueError):
            continue
        for project in projects.values():
            identity, models = project.get('lastSessionId'), project.get('lastModelUsage')
            if identity and models and identity not in usage:
                usage[identity] = (list(models), str(path))
    try:
        stats = json.loads((root / 'stats-cache.json').read_text(encoding='utf-8'))
        daily = {d['date']: list(d.get('tokensByModel', {})) for d in stats.get('dailyModelTokens', [])}
    except (OSError, ValueError, KeyError, TypeError):
        daily = {}
    for identity, session in sessions.items():
        if session['models']:
            continue
        base = identity.split('/')[0]
        if base in usage:
            session['models'] = usage[base][0]
            session['model_source'] = f'{usage[base][1]}: projects[].lastModelUsage (세션 단위)'
            continue
        if session['kind'] != 'history_only':
            continue  # transcript exists and shows no model call; don't guess.
        days = sorted({local_day(t) for t in session['timestamps'] if t})
        candidates = []
        for day in days:
            candidates.extend(m for m in daily.get(day, []) if m not in candidates)
        if candidates:
            session['model_candidates'] = candidates
            session['model_source'] = 'stats-cache.json: dailyModelTokens (같은 날 전체 사용량 기반 추정, 세션 단위 아님)'


def assign_prompt_models(session):
    """Attach to each prompt the model that answered it."""
    events = sorted(session.pop('model_events'))
    if session['agent'] != 'claude':
        return
    prompts = sorted(session['prompts'], key=lambda m: m['timestamp'] or '')
    for i, prompt in enumerate(prompts):
        if prompt['model']:
            continue
        start = prompt['timestamp'] or ''
        # Prompts sharing a timestamp (e.g. a workflow request + its task) share one turn.
        end = next((p['timestamp'] for p in prompts[i + 1:] if (p['timestamp'] or '') > start), None)
        window = [m for t, m in events if t >= start and (end is None or t < end)]
        real = [m for m in window if m != '<synthetic>']
        if real:
            prompt['model'] = ', '.join(dict.fromkeys(real))
        elif window:
            prompt['model_note'] = '모델 호출 없음 (로컬 오류·합성 응답)'
        elif session['kind'] == 'history_only':
            if session['models']:
                prompt['model_note'] = f"프롬프트별 기록 없음 · 세션 사용 모델: {', '.join(session['models'])}"
            elif session['model_candidates']:
                prompt['model_note'] = f"프롬프트별 기록 없음 · 추정 후보: {', '.join(session['model_candidates'])}"
            else:
                prompt['model_note'] = '원본 transcript 삭제됨'
        else:
            prompt['model_note'] = '모델 응답 없음 (로컬 명령·중단)'


def add_history(root, agent, sessions, errors):
    path = root / 'history.jsonl'
    if not path.exists():
        return
    existing = set(sessions)
    for row in rows(path, errors):
        identity = row.get('session_id', row.get('sessionId'))
        if not identity or identity in existing:
            continue
        session = sessions.setdefault(identity, new_session(agent, identity))
        session['kind'] = 'history_only'
        session['cwd'] = row.get('project', session['cwd'])
        session['source_files'] = [str(path)]
        time = timestamp(row.get('ts', row.get('timestamp')))
        if time:
            session['timestamps'].append(time)
        text = row.get('text', row.get('display', ''))
        pasted = row.get('pastedContents', {})
        if isinstance(pasted, dict):
            for key, value in pasted.items():
                if not isinstance(value, dict):
                    continue
                if value.get('type') == 'text' and isinstance(value.get('content'), str):
                    text += f"\n\n[붙여넣기 #{key} 원문]\n{value['content']}"
                else:
                    text += f"\n\n[첨부 #{key}: 원본 텍스트를 복원할 수 없음]"
        add_message(session, 'prompts', text, time)


def finish(session):
    assign_prompt_models(session)
    times = sorted(t for t in session.pop('timestamps') if t)
    session['started_at'] = times[0] if times else None
    session['last_activity_at'] = times[-1] if times else None
    for target in ('prompts', 'responses'):
        unique, seen = [], set()
        for message in sorted(session[target], key=lambda m: m['timestamp'] or ''):
            key = message['id'] or (message['timestamp'], message['text'])
            if key not in seen:
                unique.append(message)
                seen.add(key)
        session[target] = unique
    responses = session.pop('responses')
    finals = [m for m in responses if m['phase'] == 'final']
    session['last_output'] = (finals or responses or [None])[-1]
    session['last_output_status'] = ('final' if finals else 'last_visible_response'
                                     if responses else 'unavailable')
    return session


def models_label(session):
    if session['models']:
        return ', '.join(session['models'])
    if session['model_candidates']:
        return f"확인 불가 (추정 후보: {', '.join(session['model_candidates'])})"
    if session['kind'] == 'history_only':
        return '확인 불가 (원본 transcript 삭제됨)'
    if session['agent'] == 'claude':
        return '없음 (모델 호출 기록 없음)'
    return '확인 불가'


def markdown(session):
    def shown(value):
        return str(value) if value else '확인 불가'
    def block(text):
        fence = '`' * max(3, max((len(x) + 1 for x in re.findall(r'`+', text)), default=3))
        return f'{fence}text\n{text}\n{fence}\n'
    lines = [f"# {session['agent']} · {session['session_id']}", '',
             f"- 유형: {session['kind']}", f"- 사용 모델: {models_label(session)}",
             f"- 모델 출처: {shown(session['model_source'])}",
             f"- 시작 시간: {shown(session['started_at'])}",
             f"- 마지막 기록 시간: {shown(session['last_activity_at'])}",
             f"- 작업 경로: {shown(session['cwd'])}",
             '- 시간대: UTC (ISO 8601)', '- 원본 로그:',
             *[f'  - `{p}`' for p in session['source_files']], '', '## 입력 프롬프트', '']
    for i, prompt in enumerate(session['prompts'], 1):
        lines.extend([f"### {i}. {shown(prompt['timestamp'])}", '',
                      f"모델: {prompt['model'] or prompt.get('model_note') or '확인 불가'}", '', block(prompt['text'])])
    if not session['prompts']:
        lines.append('기록된 텍스트 프롬프트가 없습니다.\n')
    lines.extend(['## 마지막 세션 아웃풋', '', f"상태: {session['last_output_status']}", ''])
    output = session['last_output']
    if output:
        output_model = output['model']
        if output_model == '<synthetic>':
            output_model = '<synthetic> (로컬 생성 응답, 모델 호출 아님)'
        lines.extend([f"시간: {shown(output['timestamp'])}",
                      f"모델: {shown(output_model)}", '', block(output['text'])])
    else:
        lines.append('원본에 응답 기록이 없어 확인할 수 없습니다.\n')
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--codex-home', type=Path, default=Path(os.environ.get('CODEX_HOME', Path.home() / '.codex')))
    parser.add_argument('--claude-home', type=Path, default=Path(os.environ.get('CLAUDE_CONFIG_DIR', Path.home() / '.claude')))
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    errors, sessions = [], []
    for agent, root, exporter in [('codex', args.codex_home, export_codex), ('claude', args.claude_home, export_claude)]:
        found = exporter(root, errors)
        add_history(root, agent, found, errors)
        if agent == 'claude':
            claude_model_hints(root, found, errors)
        sessions.extend(finish(s) for s in found.values())
    sessions.sort(key=lambda s: (s['agent'], s['started_at'] or '', s['session_id']))
    args.output.mkdir(parents=True, exist_ok=True)
    index = []
    for session in sessions:
        relative = Path(session['agent']) / (session['session_id'].replace('/', '--') + '.md')
        path = args.output / relative
        path.parent.mkdir(exist_ok=True)
        path.write_text(markdown(session), encoding='utf-8')
        index.append({**{k: v for k, v in session.items() if k not in ('prompts', 'last_output')},
                      'prompt_count': len(session['prompts']), 'file': str(relative)})
    manifest = dict(exported_at=datetime.now(timezone.utc).isoformat(),
                    scope='All locally available Codex and Claude logs, including subagents and history-only sessions.',
                    sessions=index, malformed_lines=errors)
    (args.output / 'index.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    readme = ['# Agent sessions', '', f"추출 시간: {manifest['exported_at']}", '',
              '로컬 Codex·Claude 전체 프로젝트의 세션을 기록합니다. 세션별 파일에 사용 모델, UTC 시간, 입력 프롬프트 원문과 마지막 응답을 보존합니다.', '',
              'Codex는 마지막 final 응답을 우선하며, final이 없으면 마지막 표시 응답을 기록합니다. Claude는 마지막 텍스트 응답을 기록합니다. 진행 중인 세션은 추출 시점의 스냅샷입니다.', '',
              '서브 에이전트도 포함합니다. history_only는 입력 이력만 남은 세션으로 응답을 복원할 수 없습니다. 모델이나 시간이 원본에 없으면 확인 불가로 표시합니다. Claude history의 display와 저장된 붙여넣기 텍스트를 함께 보존합니다. 해시만 남은 첨부는 복원 불가로 표시합니다.', '',
              'Claude 모델 기록 방식: transcript가 남은 세션은 각 프롬프트에 응답한 assistant 메시지의 모델을 기록합니다. transcript가 삭제된 history_only 세션은 `~/.claude.json`의 프로젝트별 `lastModelUsage`(세션 단위, 정확)로 복원하고, 그것도 없으면 `stats-cache.json`의 일별 모델 사용량을 \'추정 후보\'로만 표시합니다. 각 세션 파일의 \'모델 출처\'에 근거를 남깁니다. Claude Code는 기본 30일이 지난 transcript를 정리하므로 보존하려면 settings.json의 `cleanupPeriodDays`를 늘려야 합니다.', '',
              'Claude 워크플로 journal은 세션 대화 로그가 아니므로 제외합니다.', '',
              '도구 실행 결과, 내부 추론, 시스템·개발자 지침과 이미지 바이너리는 제외합니다. 사용자 프롬프트에 포함된 텍스트는 그대로 보존합니다. 삭제되었거나 이 기기에 저장되지 않은 세션은 포함되지 않습니다.', '',
              '갱신: `python3 docs/agent-sessions/export_sessions.py`', '',
              '기계 판독용 목록과 원본 경로, 파싱 오류는 [index.json](index.json)에 있습니다.', '',
              '| 에이전트 | 세션 | 모델 | 시작 시간 (UTC) | 프롬프트 수 | 유형 |',
              '| --- | --- | --- | --- | ---: | --- |']
    for item in index:
        readme.append(f"| {item['agent']} | [{item['session_id']}]({item['file']}) | {models_label(item)} | {item['started_at'] or '확인 불가'} | {item['prompt_count']} | {item['kind']} |")
    (args.output / 'README.md').write_text('\n'.join(readme) + '\n', encoding='utf-8')
    print(json.dumps(dict(sessions=len(index), agents=dict(Counter(s['agent'] for s in index)),
                          kinds=dict(Counter(s['kind'] for s in index)),
                          prompts=sum(s['prompt_count'] for s in index), malformed_lines=len(errors)), ensure_ascii=False))


if __name__ == '__main__':
    main()
