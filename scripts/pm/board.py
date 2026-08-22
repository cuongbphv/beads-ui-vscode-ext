# beads-pm-kit v0.1.0 skill:board surface:module

#!/usr/bin/env python3
"""Board measurement for the beads PM skills. Installed by beads-pm-kit.

One module so the report and the forecast cannot disagree about what the numbers mean.
Data acquisition is separate from computation: --fixture reads a saved board instead of
calling bd, which is how the kit tests the arithmetic.

  python3 scripts/pm/board.py report
  python3 scripts/pm/board.py forecast [--epic <id>]
  python3 scripts/pm/board.py refclass [--id <bead>]
  python3 scripts/pm/board.py report --json
  python3 scripts/pm/board.py report --fixture <file.json>
"""
import argparse
import datetime as dt
import json
import os
import subprocess
import sys

PTS = {'size:XS': 0.5, 'size:S': 1.0, 'size:M': 3.0, 'size:L': 8.0, 'size:XL': 13.0}
LANES = ('auto-ok', 'auto-partial', 'needs-human')
# Without these flags bd omits gate, infra and template beads: measured on a 75-bead board,
# bd stats reported 45 closed while a plain bd list returned 39.
FULL = ['-n', '0', '--include-gates', '--include-infra', '--include-templates']
MARKERS = ('LANE ', 'RE-MEASURE ', 'ESTIMATE ', 'RE-ESTIMATE ', 'CALIBRATE ',
           'SPLIT-REQUIRED', 'FORECAST ', 'PHAN LOAI')
WIDE_WINDOWS = (14, 28, 56)


def bd(*args):
    env = dict(os.environ, BD_JSON_ENVELOPE='1')
    r = subprocess.run(['bd', *args], capture_output=True, text=True, encoding='utf-8', env=env)
    if r.returncode != 0:
        sys.exit(f"bd {' '.join(args)} rc={r.returncode}: {r.stderr.strip()[:300]}")
    data = json.loads(r.stdout or 'null')
    if isinstance(data, dict) and 'data' in data:
        return data['data']
    return data


def acquire(with_snapshots=False):
    """Everything the PM skills read, in one pass."""
    board = bd('list', '--all', '--json', *FULL)
    snapshots = {}
    if with_snapshots:
        # metadata is absent from bd list --json, so the previous forecast has to be fetched
        # per epic. Measured: bd stores pm.forecast as a JSON *string* inside the metadata
        # object, so it needs parsing twice.
        for e in [i for i in board if i.get('issue_type') == 'epic']:
            got = bd('show', e['id'], '--json')
            row = got[0] if isinstance(got, list) and got else got
            raw = ((row or {}).get('metadata') or {}).get('pm.forecast')
            if not raw:
                continue
            try:
                snapshots[e['id']] = raw if isinstance(raw, dict) else json.loads(raw)
            except (ValueError, TypeError):
                snapshots[e['id']] = {'error': 'pm.forecast does not parse as JSON', 'raw': str(raw)[:120]}
    return {
        'board': board,
        'snapshots': snapshots,
        'stats': bd('stats', '--json'),
        # bd list --json carries no is_blocked field and leaves blocked beads at status
        # "open" — measured: a board with five blocked beads reports zero without this call.
        'blocked': bd('blocked', '--json'),
        'stale': bd('stale', '-d', '7', '--json'),
        'now': dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def ts(v):
    if not v:
        return None
    try:
        return dt.datetime.fromisoformat(str(v).replace('Z', '+00:00'))
    except (ValueError, TypeError):
        return None


def points(issue):
    for label in issue.get('labels') or []:
        if label in PTS:
            return PTS[label]
    return None


def lane(issue):
    labels = issue.get('labels') or []
    for name in LANES:
        if name in labels:
            return name
    return 'unlabeled'


def reason(issue):
    lines = [l.strip() for l in (issue.get('notes') or '').splitlines() if l.strip()]
    marked = [l for l in lines if l.startswith(MARKERS)]
    if marked:
        return marked[-1]
    return lines[-1] if lines else '(no note — unmeasured)'


def clip(text, n):
    t = ' '.join((text or '').split())
    return (t[:n] + '…') if len(t) > n else t


def measure(raw):
    now = ts(raw['now']) or dt.datetime.now(dt.timezone.utc)
    board = raw['board']
    stats = raw['stats']
    summary = stats.get('summary', stats) if isinstance(stats, dict) else {}
    blocked = raw.get('blocked') or []
    stale = raw.get('stale') or []

    epics = [i for i in board if i.get('issue_type') == 'epic']
    work = [i for i in board if i.get('issue_type') != 'epic']
    closed = [i for i in work if i.get('status') == 'closed']
    open_work = [i for i in work if i.get('status') != 'closed']
    in_progress = [i for i in work if i.get('status') == 'in_progress']
    unsized = [i for i in open_work if points(i) is None]

    m = {
        'now': now,
        'by_id': {i['id']: i for i in board},
        'epics': epics, 'work': work, 'closed': closed, 'open': open_work,
        'in_progress': in_progress, 'unsized': unsized,
        'stale': stale, 'blocked': blocked,
        'blocked_ids': {b['id'] for b in blocked},
        'delta': len(board) - summary.get('total_issues', len(board)),
        'stats_total': summary.get('total_issues'),
        'board_size': len(board),
        'done_pts': sum(points(i) or 0 for i in closed),
        'open_pts': sum(points(i) or 0 for i in open_work),
        'overdue': [i for i in open_work if ts(i.get('due_at')) and ts(i['due_at']) < now],
        'invariants': invariants(board, epics, open_work),
        'snapshots': raw.get('snapshots') or {},
    }
    m['total_pts'] = m['done_pts'] + m['open_pts']
    sized_open = len(open_work) - len(unsized)
    m['coverage'] = {
        'sized_open': sized_open, 'open': len(open_work),
        'ratio': (sized_open / len(open_work)) if open_work else 1.0,
    }
    # Below this, every points figure describes a minority of the remaining work, so the
    # report labels it instead of presenting it as the state of the project.
    m['coverage']['low'] = m['coverage']['ratio'] < 0.6
    m['velocity'] = velocity(closed, now)
    m['epic_rows'] = epic_rows(epics, work, m)
    m['chains'] = blocked_chains(blocked)
    m['scope'] = scope_windows(work, closed, now)
    return m


def invariants(board, epics, open_work):
    """The board rules the PM skills refuse to average over."""
    sized_epics = [e['id'] for e in epics if points(e) is not None]
    multi = [i['id'] for i in open_work
             if sum(1 for l in (i.get('labels') or []) if l in PTS) > 1]
    unclassified = [i['id'] for i in open_work if lane(i) == 'unlabeled']
    orphans = [i['id'] for i in open_work if not i.get('parent')]
    return {'epic_sized': sized_epics, 'multi_sized': multi,
            'unclassified': unclassified, 'no_epic': orphans}


def velocity(closed, now):
    """Points per day, with the confidence regime that decides whether a date may be shown.

    A forecast built on two closed beads is not a forecast; printing a date anyway is the
    most damaging thing a report can do, so the regime is part of the number.
    """
    window, recent, active = WIDE_WINDOWS[0], [], set()
    for w in WIDE_WINDOWS:
        window = w
        cut = now - dt.timedelta(days=w)
        recent = [i for i in closed if ts(i.get('closed_at')) and ts(i['closed_at']) >= cut]
        active = {ts(i['closed_at']).date() for i in recent}
        if len(active) >= 5:
            break
    sized = [i for i in recent if points(i) is not None]
    if len(sized) >= 5:
        v = sum(points(i) for i in sized) / window
        regime, opt, pes = 'measured', 1.25, 0.6
    elif len(sized) >= 2:
        med = sorted(points(i) for i in sized)[len(sized) // 2]
        v = (len(recent) / window) * med
        # Deliberately wide: the sized sample may not represent the unsized closes.
        regime, opt, pes = 'provisional', 1.25, 0.35
    else:
        v, regime, opt, pes = 0.0, 'withheld', 1.0, 1.0
    return {'pts_per_day': v, 'regime': regime, 'window': window,
            'active_days': len(active), 'sized': len(sized), 'recent': len(recent),
            'opt_factor': opt, 'pes_factor': pes,
            'lead_basis': lead_basis(closed)}


def lead_basis(closed):
    """Which duration definition the actuals rest on, and the calibrated hours per point."""
    cycle = [i for i in closed if ts(i.get('started_at')) and ts(i.get('closed_at'))]
    ratios = []
    for i in closed:
        p = points(i)
        end = ts(i.get('closed_at'))
        start = ts(i.get('started_at')) or ts(i.get('created_at'))
        if not p or not end or not start:
            continue
        ratios.append((end - start).total_seconds() / 3600.0 / p)
    ratios.sort()
    hpp = ratios[len(ratios) // 2] if len(ratios) >= 10 else 1.0
    # A point that appears to take minutes, or weeks, is almost always an artifact: beads
    # created and closed inside one session, or beads that sat in the backlog for months.
    implausible = None
    if len(ratios) >= 10 and hpp < 0.25:
        implausible = 'implausibly fast — beads created and closed within the same session'
    elif len(ratios) >= 10 and hpp > 40:
        implausible = 'implausibly slow — the durations are dominated by backlog wait'
    return {'basis': 'cycle' if cycle else 'lead', 'cycle_count': len(cycle),
            'hours_per_point': hpp, 'calibrated': len(ratios) >= 10, 'samples': len(ratios),
            'implausible': implausible}


def eta(remaining, factor, vel, now):
    if vel['regime'] == 'withheld' or vel['pts_per_day'] <= 0 or remaining <= 0:
        return None
    days = remaining / (vel['pts_per_day'] * factor)
    return (now + dt.timedelta(days=days)).date().isoformat()


def epic_rows(epics, work, m):
    kids = {}
    for i in work:
        kids.setdefault(i.get('parent') or '', []).append(i)
    rows = []
    for e in epics:
        ks = kids.get(e['id'], [])
        if not ks:
            continue
        done = sum(points(k) or 0 for k in ks if k.get('status') == 'closed')
        total = sum(points(k) or 0 for k in ks)
        open_kids = [k for k in ks if k.get('status') != 'closed']
        rows.append({
            'id': e['id'], 'title': e.get('title', ''), 'done_pts': done, 'total_pts': total,
            'remaining_pts': total - done, 'kids': len(ks), 'open_kids': len(open_kids),
            'unsized': sum(1 for k in open_kids if points(k) is None),
            'pct': (done / total * 100) if total else None,
        })
    rows.sort(key=lambda r: (-(r['remaining_pts']), -r['open_kids']))
    return rows


def blocked_chains(blocked):
    """Group blocked beads by the root bead that actually gates them."""
    up = {b['id']: (b.get('blocked_by') or []) for b in blocked}

    def root(node, seen=()):
        if node in seen:
            return None          # a cycle blocks forever: report it, do not loop
        ups = up.get(node) or []
        return node if not ups else root(ups[0], seen + (node,))

    chains = {}
    for b in blocked:
        r = root(b['id']) or 'CYCLE'
        chains.setdefault(r, [])
        # The root is the gate, not one of the beads waiting on it.
        if b['id'] != r:
            chains[r].append(b['id'])
    return sorted(((k, v) for k, v in chains.items() if v), key=lambda kv: -len(kv[1]))


def scope_windows(work, closed, now, weeks=3):
    out = []
    for k in range(weeks):
        hi, lo = now - dt.timedelta(days=7 * k), now - dt.timedelta(days=7 * (k + 1))
        created = sum(points(i) or 0 for i in work
                      if ts(i.get('created_at')) and lo <= ts(i['created_at']) < hi)
        done = sum(points(i) or 0 for i in closed
                   if ts(i.get('closed_at')) and lo <= ts(i['closed_at']) < hi)
        out.append({'week': k, 'created_pts': created, 'closed_pts': done})
    return out


# Same issue_type alone scores 1.0 and means nothing — most beads on a board are tasks. A
# comparable has to share a label or some title vocabulary on top of that, or the "reference
# class" is a coincidence dressed as evidence.
MIN_SIMILARITY = 1.5
# A comparable that was closed minutes after it was created is an artifact of a bead being
# filed and ticked inside one session, not a measurement of how long that work takes.
MIN_PLAUSIBLE_HOURS = 0.25

STOPWORDS = {'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'with', 'is',
             'be', 'it', 'that', 'this', 'va', 'cho', 'khi', 'la', 'cua', 'mot', 'khong',
             'theo', 'tren', 'trong', 'voi', 'bead', 'beads'}
SCALE = (0.5, 1.0, 3.0, 8.0, 13.0)


def tokens_of(title):
    words = ''.join(c.lower() if (c.isalnum() or c in '._-/') else ' ' for c in (title or '')).split()
    return {w for w in words if len(w) > 2 and w not in STOPWORDS}


def snap(value):
    return min(SCALE, key=lambda s: abs(s - value))


def reference_class(target, closed, hours_per_point, top=5):
    """Score closed beads for similarity, then price the target off their actual durations.

    Similarity is deliberately dumb and inspectable: shared labels weigh double because a
    label is a human's own statement about what kind of work this is, then title-token
    overlap, then issue type. File names and symbols dominate the token overlap, which is why
    it survives a board whose titles mix languages.
    """
    t_tokens = tokens_of(target.get('title'))
    t_labels = {l for l in (target.get('labels') or []) if l not in PTS and l not in LANES}
    scored = []
    for c in closed:
        if points(c) is None:
            continue
        c_labels = {l for l in (c.get('labels') or []) if l not in PTS and l not in LANES}
        c_tokens = tokens_of(c.get('title'))
        union = t_tokens | c_tokens
        jaccard = len(t_tokens & c_tokens) / len(union) if union else 0.0
        score = 2 * len(t_labels & c_labels) + jaccard + (1 if c.get('issue_type') == target.get('issue_type') else 0)
        if score < MIN_SIMILARITY:
            continue
        end, start = ts(c.get('closed_at')), ts(c.get('started_at')) or ts(c.get('created_at'))
        hours = (end - start).total_seconds() / 3600.0 if (end and start) else None
        scored.append({'id': c['id'], 'score': round(score, 3), 'points': points(c),
                       'hours': hours, 'basis': 'cycle' if ts(c.get('started_at')) else 'lead',
                       'shared_labels': sorted(t_labels & c_labels),
                       'shared_tokens': sorted(t_tokens & c_tokens)[:6]})
    scored.sort(key=lambda x: -x['score'])
    picked = scored[:top]
    usable = [x for x in picked if x['hours'] is not None]
    base = {'id': target['id'], 'title': target.get('title', ''), 'comparables': picked,
            'usable': len(usable), 'median_hours': None, 'proposed': None, 'why': None}
    if len(usable) < 3:
        return dict(base, basis='pert',
                    why=f'{len(usable)} comparable(s) above the similarity floor, need 3')
    hrs = sorted(x['hours'] for x in usable)
    median = hrs[len(hrs) // 2]
    if median < MIN_PLAUSIBLE_HOURS:
        return dict(base, basis='unusable', median_hours=median,
                    why='the comparables were closed minutes after they were filed, so their '
                        'duration measures bookkeeping rather than work')
    return dict(base, basis='refclass', median_hours=median,
                proposed=snap(median / hours_per_point))


def render_refclass(m, only_id=None):
    hpp = m['velocity']['lead_basis']['hours_per_point']
    if m['velocity']['lead_basis'].get('implausible') or not m['velocity']['lead_basis']['calibrated']:
        hpp = 1.0
    targets = [i for i in m['open'] if points(i) is None]
    if only_id:
        targets = [i for i in m['open'] + m['closed'] if i['id'] == only_id]
    L = [f"# REFERENCE CLASS {m['now'].date()} | hours per point {hpp:.2f}"
         f"{' (assumed)' if hpp == 1.0 else ''} | {len(targets)} target(s)"]
    L.append('')
    results = [reference_class(t, m['closed'], hpp) for t in targets]
    L.append(f"   {'bead':26} | {'basis':8} | median h | proposed | comparables")
    NAMES = {0.5: 'XS', 1.0: 'S', 3.0: 'M', 8.0: 'L', 13.0: 'XL'}
    for r in results:
        prop = f"size:{NAMES[r['proposed']]}" if r['proposed'] else '—'
        med = f"{r['median_hours']:8.2f}" if r['median_hours'] is not None else '       —'
        comp = ', '.join(f"{c['id'].split('-')[-1]}({c['score']})" for c in r['comparables'][:3]) or 'none'
        L.append(f"   {r['id'][:26]:26} | {r['basis']:8} | {med} | {prop:12} | {comp}")
    fallback = [r for r in results if r['basis'] != 'refclass']
    if fallback:
        L.append('')
        L.append(f"   {len(fallback)} of {len(results)} bead(s) have no usable reference class:")
        for r in fallback[:6]:
            L.append(f"     {r['id']} — {r['why']}")
        if len(fallback) > 6:
            L.append(f"     ... and {len(fallback) - 6} more with the same reason")
        L.append('   Estimate those with the PERT fallback in bead-estimate §3, from their own scope')
        L.append('   signals, and tag the note basis:pert. Do not let this table invent a number for')
        L.append('   them — a reference class of coincidences is worse than admitting there is none.')
    return '\n'.join(L)


def grew(window):
    """Scope grew by enough to be worth a decision, rather than by a rounding difference.

    Half a point over a week is noise; flagging it teaches the reader to ignore the flag.
    """
    excess = window['created_pts'] - window['closed_pts']
    return excess > 2 and excess > 0.1 * max(window['closed_pts'], 1)


def bar(pct, width=10):
    filled = int(round((pct or 0) / 100 * width))
    return '█' * filled + '░' * (width - filled)


def render_report(m):
    v = m['velocity']
    now = m['now']
    L = []
    L.append(f"# PM REPORT {now.date()} | bd list {m['board_size']} vs stats {m['stats_total']}")
    if m['delta']:
        L.append(f"WARN list/stats delta {m['delta']:+d} — bd is hiding a type this report does not ask for")
    work, closed = m['work'], m['closed']
    pct_count = 100.0 * len(closed) / len(work) if work else 0.0
    pct_pts = 100.0 * m['done_pts'] / m['total_pts'] if m['total_pts'] else 0.0
    L.append('')
    L.append(f"## BOARD        work {len(work)} (+{len(m['epics'])} epics) | open {len(m['open'])} | "
             f"in_progress {len(m['in_progress'])} | blocked {len(m['blocked_ids'])} | closed {len(closed)}")
    cov = m['coverage']
    L.append(f"## COMPLETION   {pct_count:.0f}% by count ({len(closed)}/{len(work)}) | "
             f"{pct_pts:.0f}% by points ({m['done_pts']:g}/{m['total_pts']:g}) | "
             f"sizing coverage {cov['sized_open']}/{cov['open']} open")
    if cov['low']:
        L.append(f"   LOW COVERAGE — only {cov['sized_open']} of {cov['open']} open beads are sized, so "
                 f"the points figure describes finished work and says almost nothing about what is left. "
                 f"Read the count column, and run bead-estimate --backfill before trusting any date.")
    plan_label = 'plan(pes)' if v['regime'] == 'provisional' else 'plan'
    rows = [r for r in m['epic_rows'] if r['open_kids'] or r['total_pts']]
    quiet = [r for r in m['epic_rows'] if r not in rows]
    L.append('')
    L.append(f"   {'epic':26} | {'pts done/total':14} | {'%':4} | {'bar':10} | unsized | {plan_label}")
    factor = v['pes_factor'] if v['regime'] == 'provisional' else 1.0
    for r in rows:
        if r['total_pts']:
            cell, pcell, b = f"{r['done_pts']:g}/{r['total_pts']:g}", f"{r['pct']:3.0f}%", bar(r['pct'])
            when = eta(r['remaining_pts'], factor, v, now) or 'n/a'
        else:
            cell, pcell, b = f"—/— ({r['open_kids']} open)", ' n/a', 'unsized   '
            when = 'n/a'
        L.append(f"   {r['id'][:26]:26} | {cell:14} | {pcell:4} | {b:10} | {r['unsized']:7d} | {when}")
    if not rows:
        L.append('   — no epic has open work or a points total')
    if quiet:
        L.append(f"   {len(quiet)} epic(s) complete with nothing sized: "
                 + ', '.join(r['id'] for r in quiet[:6]) + ('…' if len(quiet) > 6 else ''))
    inv = m['invariants']
    for key, text in (('no_epic', 'open beads with no epic'),
                      ('unclassified', 'open beads with no auto-ok/auto-partial/needs-human label'),
                      ('epic_sized', 'epics carrying a size label (breaks the rollup)'),
                      ('multi_sized', 'beads carrying more than one size label')):
        if inv[key]:
            L.append(f"   INVARIANT {text}: {len(inv[key])} — {', '.join(inv[key][:8])}"
                     + ('…' if len(inv[key]) > 8 else ''))
    L.append('')
    L.append(f"## FLOW         WIP {len(m['in_progress'])} | blocked {len(m['blocked_ids'])} in "
             f"{len(m['chains'])} chain(s) | stale>7d {len(m['stale'])} | overdue {len(m['overdue'])}")
    for root_id, ids in m['chains']:
        who = m['by_id'].get(root_id, {})
        L.append(f"   root {root_id} ({who.get('status', '?')}, {lane(who) if who else '?'}) "
                 f"gates {len(ids)}: {', '.join(ids)}")
        if who:
            L.append(f"        {clip(who.get('title'), 78)}")
    L.append("   lanes(open): " + ", ".join(
        f"{t}={sum(1 for i in m['open'] if lane(i) == t)}" for t in LANES + ('unlabeled',)))
    for i in m['stale'][:5]:
        L.append(f"   stale {i['id']} — {clip(i.get('title'), 66)}")
    L.append('')
    lb = v['lead_basis']
    L.append(f"## VELOCITY     {v['pts_per_day']:.2f} pt/d ({v['regime']}, {v['window']}d window, "
             f"{v['active_days']} active close-days, {v['sized']}/{v['recent']} closes sized)")
    L.append(f"   actuals basis {lb['basis']}"
             + (f" (started_at set on {lb['cycle_count']} closes)" if lb['cycle_count'] else
                " (no started_at anywhere: lead time includes backlog wait)")
             + f" | {lb['hours_per_point']:.2f} h/pt"
             + ('' if lb['calibrated'] else f" assumed, {lb['samples']}/10 samples toward calibration"))
    if lb.get('implausible'):
        L.append(f"   IGNORE the h/pt figure: {lb['implausible']}. It calibrates nothing until real "
                 f"work is claimed and closed across separate sessions.")
    if v['regime'] == 'withheld':
        L.append(f"   FORECAST WITHHELD — {v['sized']} sized close(s) in the window. To earn one: "
                 f"size the open beads (bead-estimate --backfill), then close 5 sized beads.")
        L.append(f"   remaining {m['open_pts']:g} pt over {len(m['open'])} open bead(s), "
                 f"{len(m['unsized'])} of them unsized")
    else:
        if v['regime'] == 'provisional':
            L.append(f"   PROVISIONAL — extrapolated from {v['sized']} sized close(s) via throughput. "
                     f"Plan on the pessimistic date, not the likely one.")
        scope_note = (f" — covers only the {m['coverage']['sized_open']} sized bead(s) of "
                      f"{m['coverage']['open']} open") if m['coverage']['low'] else ''
        L.append(f"   remaining {m['open_pts']:g} pt over {len(m['open'])} open bead(s) | ETA opt "
                 f"{eta(m['open_pts'], v['opt_factor'], v, now)} / likely {eta(m['open_pts'], 1.0, v, now)}"
                 f" / pes {eta(m['open_pts'], v['pes_factor'], v, now)}{scope_note}")
    L.append('')
    L.append('## RISKS/ASKS')
    for s in m['scope']:
        flag = '  <-- growing' if grew(s) else ''
        L.append(f"   scope w-{s['week']}: +{s['created_pts']:g} pt created vs "
                 f"{s['closed_pts']:g} pt closed{flag}")
    if all(grew(s) for s in m['scope']) and any(s['created_pts'] for s in m['scope']):
        L.append('   SCOPE ALARM: created has outrun closed for three windows — a user decision is '
                 'owed before creating further non-bug beads')
    nh = [i for i in m['open'] if lane(i) == 'needs-human']
    L.append(f"   needs-human {len(nh)}:")
    for i in nh[:3]:
        L.append(f"     {i['id']} — {clip(i.get('title'), 60)}")
        L.append(f"        why: {clip(reason(i), 92)}")
    if len(nh) > 3:
        L.append(f"     ... and {len(nh) - 3} more: bd list --label needs-human --status open")
    if m['unsized']:
        ids = [i['id'] for i in m['unsized']]
        L.append(f"   unsized open beads excluded from every points figure: {len(ids)} — "
                 f"{', '.join(ids[:6])}{'…' if len(ids) > 6 else ''}")
    return '\n'.join(L)


def render_forecast(m, only_epic=None):
    v = m['velocity']
    now = m['now']
    L = [f"# FORECAST {now.date()} | velocity {v['pts_per_day']:.2f} pt/d ({v['regime']}, "
         f"{v['window']}d, {v['sized']}/{v['recent']} closes sized)"]
    if v['regime'] == 'withheld':
        L.append('')
        L.append('No forecast. There are fewer than two sized closes in the widest window, so any '
                 'date would be invented rather than measured.')
        L.append(f"What it takes: size the {len(m['unsized'])} unsized open bead(s) with "
                 f"bead-estimate --backfill, then close 5 sized beads.")
        return '\n'.join(L)
    rows = [r for r in m['epic_rows'] if not only_epic or r['id'] == only_epic]
    L.append('')
    L.append(f"   {'epic':26} | remaining | {'opt':10} | {'likely':10} | {'pes':10} | unsized")
    for r in rows:
        if not r['total_pts']:
            L.append(f"   {r['id'][:26]:26} | {'unsized':>9} | {'—':10} | {'—':10} | {'—':10} | "
                     f"{r['unsized']}")
            continue
        o = eta(r['remaining_pts'], v['opt_factor'], v, now) or 'n/a'
        l = eta(r['remaining_pts'], 1.0, v, now) or 'n/a'
        p = eta(r['remaining_pts'], v['pes_factor'], v, now) or 'n/a'
        L.append(f"   {r['id'][:26]:26} | {r['remaining_pts']:9g} | {o:10} | {l:10} | {p:10} | "
                 f"{r['unsized']}")
    L.append('')
    L.append('## WHY THE BANDS ARE THIS WIDE')
    if v['regime'] == 'provisional':
        L.append(f"   - velocity is extrapolated from {v['sized']} sized close(s); the pessimistic "
                 f"column is the planning date")
    if m['unsized']:
        L.append(f"   - {len(m['unsized'])} open bead(s) carry no size and are absent from every "
                 f"remaining figure above")
    if m['coverage']['low']:
        L.append(f"   - sizing coverage is {m['coverage']['sized_open']}/{m['coverage']['open']} open "
                 f"beads: these dates cover a minority of the remaining work and will move once the "
                 f"rest is sized")
    for root_id, ids in m['chains']:
        L.append(f"   - {len(ids)} bead(s) wait behind {root_id}; the dates assume it moves first")
    nh = sum(1 for i in m['open'] if lane(i) == 'needs-human')
    if nh:
        L.append(f"   - {nh} bead(s) are needs-human: no agent velocity applies to them")
    lb = v['lead_basis']
    if lb['basis'] == 'lead':
        L.append('   - actuals use lead time (no started_at on any close), which includes backlog '
                 'wait and so overstates effort')
    if not lb['calibrated']:
        L.append(f"   - hours per point is assumed at 1.0 ({lb['samples']}/10 samples toward a "
                 f"measured value)")
    L.append('')
    L.append('## HOW THE LAST FORECAST DID')
    snaps = m.get('snapshots') or {}
    reported = 0
    for r in rows:
        prev = snaps.get(r['id'])
        if not prev:
            continue
        reported += 1
        if prev.get('error'):
            L.append(f"   {r['id']}: {prev['error']}")
            continue
        was, likely, pes = prev.get('remaining_pts'), prev.get('eta_likely'), prev.get('eta_pes')
        moved = (was - r['remaining_pts']) if isinstance(was, (int, float)) else None
        line = f"   {r['id']}: forecast {prev.get('date')} said {was:g} pt left" if isinstance(was, (int, float)) \
            else f"   {r['id']}: forecast {prev.get('date')}"
        if moved is not None:
            verb = 'unchanged' if moved == 0 else (f"{abs(moved):g} pt closed" if moved > 0
                                                  else f"{abs(moved):g} pt added")
            line += f", now {r['remaining_pts']:g} — {verb}"
        L.append(line)
        today = now.date().isoformat()
        if r['remaining_pts'] <= 0:
            L.append(f"      closed out; the likely date was {likely}")
        elif pes and today > pes:
            over = (now.date() - dt.date.fromisoformat(pes)).days
            L.append(f"      PAST the pessimistic date {pes} by {over} day(s) — the reason is in the "
                     f"list above, not in the arithmetic")
        elif likely and today > likely:
            L.append(f"      past the likely date {likely}, inside the pessimistic {pes}")
        else:
            L.append(f"      on track against likely {likely} (pessimistic {pes})")
        prev_v = prev.get('velocity_ppd')
        if isinstance(prev_v, (int, float)) and prev_v > 0 and v['pts_per_day'] > 0:
            ratio = v['pts_per_day'] / prev_v
            if ratio >= 2 or ratio <= 0.5:
                L.append(f"      velocity moved {ratio:.1f}x since then ({prev_v:.2f} -> "
                         f"{v['pts_per_day']:.2f} pt/d): that is a change in what the board holds, "
                         f"not a trend — say which beads caused it")
    if not reported:
        L.append('   no previous snapshot on any of these epics — this is the first forecast, so '
                 'there is nothing to calibrate against yet')
    L.append('')
    L.append('## SNAPSHOT COMMANDS (run these to record the forecast)')
    for r in rows:
        if not r['total_pts']:
            continue
        snap = {'date': now.date().isoformat(), 'remaining_pts': r['remaining_pts'],
                'velocity_ppd': round(v['pts_per_day'], 3),
                'eta_opt': eta(r['remaining_pts'], v['opt_factor'], v, now),
                'eta_likely': eta(r['remaining_pts'], 1.0, v, now),
                'eta_pes': eta(r['remaining_pts'], v['pes_factor'], v, now),
                'basis': v['regime']}
        L.append(f"   bd update {r['id']} --set-metadata pm.forecast='{json.dumps(snap)}' \\")
        L.append(f"     --append-notes \"FORECAST {now.date()}: remaining {r['remaining_pts']:g} pt, "
                 f"v={v['pts_per_day']:.2f} pt/d, ETA likely {snap['eta_likely']} "
                 f"(opt {snap['eta_opt']} / pes {snap['eta_pes']}, {v['regime']})\"")
    return '\n'.join(L)


def jsonable(m):
    keep = ('delta', 'stats_total', 'board_size', 'done_pts', 'open_pts', 'total_pts',
            'velocity', 'epic_rows', 'scope', 'invariants', 'coverage')
    out = {k: m[k] for k in keep}
    out['now'] = m['now'].isoformat()
    out['counts'] = {k: len(m[k]) for k in ('work', 'closed', 'open', 'in_progress',
                                            'unsized', 'stale', 'overdue', 'epics')}
    out['blocked_chains'] = [{'root': r, 'ids': ids} for r, ids in m['chains']]
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('mode', choices=['report', 'forecast', 'refclass', 'acquire'])
    ap.add_argument('--epic')
    ap.add_argument('--id', help='refclass: price this one bead instead of every unsized bead')
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--fixture', help='read a saved board instead of calling bd')
    a = ap.parse_args(argv)
    raw = json.load(open(a.fixture, encoding='utf-8')) if a.fixture else acquire(a.mode == 'forecast')
    if a.mode == 'acquire':
        print(json.dumps(raw, indent=1))
        return 0
    m = measure(raw)
    if a.json:
        print(json.dumps(jsonable(m), indent=1, default=str))
    elif a.mode == 'report':
        print(render_report(m))
    elif a.mode == 'refclass':
        print(render_refclass(m, a.id))
    else:
        print(render_forecast(m, a.epic))
    return 0


if __name__ == '__main__':
    sys.exit(main())
