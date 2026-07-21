// Rendering layer: given already-computed data, build the DOM. No fetching, no
// statistics — those live in api.js / stats.js. Keeping render pure-ish makes the
// UI easy to reason about: same inputs → same markup.

import { PRECIP_BUCKETS, CALIB_MIN_DAYS, CALIB_MIN_HOURS, MODEL_LABELS } from './config.js';
import { agreement } from './stats.js';
import { pct, mm, ms, deg, hourOf, hourLabel, dayLabel, dateOf } from './format.js';

const SEG_ORDER = ['dry', 'light', 'mod', 'heavy']; // top → bottom in the column
const bucketOf = (key) => PRECIP_BUCKETS.find((b) => b.key === key);

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function renderFavorites(container, favs, activeName, onSelect) {
  container.replaceChildren(
    ...favs.map((f) =>
      el('button', {
        class: 'chip',
        type: 'button',
        'aria-pressed': String(f.name === activeName),
        text: f.name.replace(/^.*시 /, ''), // show 구/시 short form; full in title
        title: `${f.sido} ${f.name}`,
        onclick: () => onSelect(f),
      }),
    ),
  );
}

// Color key for the strip's stacked segments. Phones have no hover tooltip, so
// without this the four colors are unreadable to a first-time user.
export function renderLegend(container) {
  container.replaceChildren(
    ...PRECIP_BUCKETS.map((b) =>
      el('li', {}, [
        el('span', { class: 'swatch', style: `background:var(--p-${b.key})` }),
        b.label,
      ]),
    ),
  );
}

// Day tabs (오늘 / 내일) — the segmented control that makes the canvas operable.
export function renderDayTabs(container, { days, activeDate, todayDate, onSelect }) {
  container.replaceChildren(
    ...days.map((d) =>
      el('button', {
        class: 'daytab',
        type: 'button',
        role: 'tab',
        'aria-selected': String(d === activeDate),
        text: dayLabel(`${d}T00:00`, todayDate),
        onclick: () => onSelect(d),
      }),
    ),
  );
}

// The signature: one column per hour, stacked by precip probability. `nowTime`
// is the ISO of the current hour so we can mark it "지금" wherever it lands.
export function renderStrip(refs, { analyzed, todayDate, nowTime, selectedIndex, onSelect, onHover }) {
  // y-axis (probability scale)
  refs.axis.replaceChildren(
    ...[100, 75, 50, 25].map((v) =>
      el('span', { style: `top:${100 - v}%`, text: `${v}` }),
    ),
  );

  const cols = analyzed.map((a, i) => {
    const classes = ['col'];
    if (a.time === nowTime) classes.push('col--now');

    const stack = el('div', { class: 'col__stack', style: `animation-delay:${i * 22}ms` });
    for (const key of SEG_ORDER) {
      const frac = a.dist.fraction[key];
      if (frac <= 0) continue;
      stack.appendChild(
        el('div', { class: `col__seg col__seg--${key}`, style: `height:${frac * 100}%` }),
      );
    }

    return el('button', {
      class: classes.join(' '),
      type: 'button',
      'aria-pressed': String(i === selectedIndex),
      'aria-label': `${dayLabel(a.time, todayDate)} ${hourLabel(a.time)}, 비 확률 ${pct(a.rain.probability)}`,
      'data-i': String(i),
      onclick: () => onSelect(i),
      onmouseenter: (e) => onHover(i, e.currentTarget),
      onmouseleave: () => onHover(-1),
      onfocus: (e) => onHover(i, e.currentTarget),
      onblur: () => onHover(-1),
    }, stack);
  });
  refs.cols.replaceChildren(...cols);

  // time axis — a tick + hour under every other bar so each bar's time is traceable
  refs.times.replaceChildren(
    ...analyzed.map((a, i) => {
      const h = hourOf(a.time);
      const isNewDay = i === 0 || dateOf(a.time) !== dateOf(analyzed[i - 1].time);
      const labeled = isNewDay || h % 2 === 0;
      const cls = ['tick'];
      if (labeled) cls.push('tick--on');
      if (isNewDay) cls.push('tick--day');
      return el('span', { class: cls.join(' '), text: labeled ? (isNewDay ? `${h}시` : `${h}`) : '' });
    }),
  );
}

// The hero board: the selected hour's competing scenarios, each a big row you can
// tap to highlight. The leading scenario is emphasized but alternatives are never
// hidden — this is the protagonist, in place of a single collapsed probability.
export function renderBoard(container, { analyzedHour, todayDate, picked, kmaKey, onPick }) {
  const a = analyzedHour;
  const leadKey = agreement(a.dist).dominantKey;

  const rows = PRECIP_BUCKETS.map((b) => {
    const frac = a.dist.fraction[b.key];
    const isPicked = picked === b.key;
    const cls = ['scenario'];
    if (b.key === leadKey) cls.push('is-lead');
    if (isPicked) cls.push('is-picked');
    return el('button', {
      class: cls.join(' '),
      type: 'button',
      'aria-pressed': String(isPicked),
      onclick: () => onPick(b.key),
    }, [
      el('span', { class: 'scenario__labelcell' }, [
        el('span', { class: 'scenario__label', text: b.label }),
        b.key === kmaKey
          ? el('span', { class: 'scenario__kma', title: '기상청 KIM 수치모델이 이 시각에 예상한 시나리오', text: '기상청 모델' })
          : null,
      ]),
      el('span', { class: 'scenario__track' }, [
        // 0% stays an honestly empty track; tiny-but-real fractions keep a sliver
        el('span', { class: 'scenario__fill', style: `width:${frac > 0 ? Math.max(frac * 100, 1.5) : 0}%;background:var(--p-${b.key})` }),
      ]),
      el('span', { class: 'scenario__pct num', text: pct(frac) }),
    ]);
  });

  const t = a.temp;
  const amt = a.amount;
  const w = a.wind;
  const tempTxt = t.p10 != null ? `${deg(t.median)} (${deg(t.p10)}–${deg(t.p90)})` : deg(t.median);
  const rainTxt = amt.p50 > 0 ? mm(amt.p50) : amt.p90 > 0 ? `0mm (많으면 ${mm(amt.p90)})` : '0mm';

  container.replaceChildren(
    el('div', { class: 'board__head' }, [
      el('h2', { class: 'board__when', text: `${dayLabel(a.time, todayDate)} ${hourLabel(a.time)}` }),
      el('span', { class: 'board__sub', text: `${a.dist.n}개 예보` }),
    ]),
    el('div', { class: 'board__scenarios' }, rows),
    el('p', {
      class: 'board__cond',
      text: `기온 ${tempTxt}  ·  강수 ${rainTxt}  ·  바람 ${ms(w.median)} m/s`,
    }),
  );
}

let tooltipEl = null;
export function showTooltip(analyzedHour, anchor, todayDate) {
  if (!tooltipEl) {
    tooltipEl = el('div', { class: 'tooltip' });
    document.body.appendChild(tooltipEl);
  }
  const a = analyzedHour;
  tooltipEl.replaceChildren(
    el('div', { class: 'tooltip__t', text: `${dayLabel(a.time, todayDate)} ${hourLabel(a.time)}` }),
    ...PRECIP_BUCKETS.filter((b) => a.dist.fraction[b.key] > 0).map((b) =>
      el('div', { class: 'tooltip__row' }, [
        el('span', {}, bucketOf(b.key).label),
        el('span', { class: 'num', text: pct(a.dist.fraction[b.key]) }),
      ]),
    ),
  );
  tooltipEl.style.display = 'block';
  const r = anchor.getBoundingClientRect();
  const tw = tooltipEl.offsetWidth;
  let left = r.left + r.width / 2 - tw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
  const top = r.top - tooltipEl.offsetHeight - 10;
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top < 8 ? r.bottom + 10 : top}px`;
}
export function hideTooltip() {
  if (tooltipEl) tooltipEl.style.display = 'none';
}

// 돌아보기 — three quiet ledger lines: what actually fell yesterday (always),
// what the odds said then (if this device saw them), and how the user's own
// hunches scored. Information only: an upset reads "작은 확률이 이겼다",
// never "예보가 틀렸다".
export function renderRetro(container, data, { pending = false } = {}) {
  const head = el('p', { class: 'eyebrow', text: '돌아보기' });
  if (!data) {
    container.replaceChildren(
      head,
      el('p', {
        class: 'retro__empty',
        text: pending
          ? '어제 실제 날씨와 대조하는 중…'
          : '오늘 본 경우의 수를 이 기기가 기억해 뒀다가, 내일 실제 날씨와 대조해 보여드립니다. 시나리오를 골라 두면 당신의 예감도 함께 채점됩니다.',
      }),
    );
    return;
  }
  const { todayDate, date, days, actual, predicted, score, forecast, actualCells, pickCells, sel, modelScores, settled, record, calib, onSelectDay, onSelectHour } = data;
  const parts = [head];
  const predByTime = new Map((predicted?.hours || []).map((h) => [h.time, h]));
  const dLabel = dayLabel(`${date}T00:00`, todayDate);

  // (1) 대시보드 머리: 어느 날의 대조인지 + 대조 가능한 다른 날 탭 + 하루 성적 요약.
  //     돌아보기는 부가 기능이 아니라 이 앱의 반쪽 — 예보 보드와 같은 위계로.
  parts.push(
    el('div', { class: 'retro__head' }, [
      el('h2', { class: 'retro__title', text: `${dLabel}의 결과` }),
      days.length > 1
        ? el('div', { class: 'daytabs retro__days', role: 'tablist', 'aria-label': '돌아볼 날짜' },
            days.map((d) =>
              el('button', {
                class: 'daytab',
                type: 'button',
                role: 'tab',
                'aria-selected': String(d === date),
                text: dayLabel(`${d}T00:00`, todayDate),
                onclick: () => onSelectDay(d),
              }),
            ),
          )
        : null,
    ]),
  );
  const statBits = [
    actual.rained
      ? `실제 총 ${actual.totalMm.toFixed(1)}mm · 최다 ${hourLabel(actual.peakTime)} ${actual.peakMm.toFixed(1)}mm`
      : '실제 — 비 없음',
  ];
  if (score) statBits.push(`우세 적중 ${score.hits}/${score.n}시간`, `실제에 준 평균 확률 ${pct(score.meanProb)}`);
  parts.push(el('p', { class: 'retro__stats', text: statBits.join('  ·  ') }));

  // (2) 그날을 오늘과 같은 그래프로: 예측했던 경우의 수 스트립(시각 탭 선택),
  //     (예감 행,) 실제 리본 — 전부 실제 타임라인에 시간 정렬. 폰에선 가로 스크롤.
  const graph = [];
  graph.push(
    el('p', {
      class: 'retro__cap retro__cap--strip',
      text:
        (predicted.source === 'snapshot' ? '그때 화면의 경우의 수' : '예보가 봤던 경우의 수') +
        ' — 눌러서 시각별 대조 보기',
    }),
  );
  graph.push(
    el('div', { class: 'retro__strip', role: 'group', 'aria-label': '시각별 대조 선택. 화살표 키로 이동합니다.' },
      actualCells.map((c) => {
        const h = predByTime.get(c.time);
        const isSel = sel?.time === c.time;
        const stack = el('div', { class: 'retro__colstack' });
        if (h) {
          for (const key of SEG_ORDER) {
            const frac = h.fraction[key];
            if (frac <= 0) continue;
            stack.appendChild(el('div', { class: `col__seg col__seg--${key}`, style: `height:${frac * 100}%` }));
          }
        } else {
          stack.appendChild(el('div', { class: 'retro__nopred' }));
        }
        return el('button', {
          class: isSel ? 'retro__col is-sel' : 'retro__col',
          type: 'button',
          'aria-pressed': String(isSel),
          'data-time': c.time,
          'aria-label': `${hourLabel(c.time)} 대조 보기`,
          title: h
            ? `${hourLabel(c.time)} — ${PRECIP_BUCKETS.filter((b) => h.fraction[b.key] > 0)
                .map((b) => `${b.label} ${pct(h.fraction[b.key])}`)
                .join(' · ')}`
            : `${hourLabel(c.time)} — 이 시각의 예보 기록 없음`,
          onclick: () => onSelectHour(c.time),
        }, stack);
      }),
    ),
  );
  if (pickCells) {
    graph.push(
      el('div', { class: 'retro__ribbonrow' }, [
        el('span', { class: 'retro__cap retro__cap--ribbon', text: '예감' }),
        el('div', { class: 'retro__ribbon' },
          pickCells.map((c) =>
            el('span', { class: 'retro__cell retro__cell--pick' },
              c.picked
                ? el('span', {
                    class: 'retro__pickdot',
                    style: `background:var(--p-${c.picked})`,
                    title: `${hourLabel(c.time)} 예감 '${bucketOf(c.picked).label}'`,
                  })
                : null,
            ),
          ),
        ),
      ]),
    );
  }
  graph.push(
    el('div', { class: 'retro__ribbonrow' }, [
      el('span', { class: 'retro__cap retro__cap--ribbon', text: '실제' }),
      el('div', { class: 'retro__ribbon' },
        actualCells.map((c) => {
          const predFrac = predByTime.get(c.time)?.fraction?.[c.key];
          return el('span', {
            class: 'retro__cell',
            style: `background:var(--p-${c.key})`,
            title:
              `${hourLabel(c.time)} 실제 '${bucketOf(c.key).label}'` +
              (c.mm >= 0.1 ? ` ${c.mm.toFixed(1)}mm` : '') +
              (predFrac != null ? ` — 그때 확률 ${pct(predFrac)}` : ''),
          });
        }),
      ),
    ]),
  );
  graph.push(
    el('div', { class: 'retro__ticks', 'aria-hidden': 'true' },
      actualCells.map((c, i) => el('span', { text: i % 6 === 0 ? `${hourOf(c.time)}시` : '' })),
    ),
  );
  parts.push(el('div', { class: 'retroscroll' }, el('div', { class: 'retroinner' }, graph)));

  // (2.5) 선택 시각의 상세: 그때의 네 시나리오와 확률, 실제로 일어난 것과 나의 예감을
  //       같은 행 위에 표시 — 오늘의 보드와 같은 문법으로 어제를 읽는다.
  if (sel) {
    parts.push(el('p', { class: 'retro__cap retro__cap--board', text: `${hourLabel(sel.time)} — 그때의 경우의 수와 실제` }));
    if (sel.fraction) {
      const rows = PRECIP_BUCKETS.map((b) => {
        const frac = sel.fraction[b.key];
        const isActual = b.key === sel.actualKey;
        const cls = ['retro__brow'];
        if (isActual) cls.push('is-actual');
        return el('div', { class: cls.join(' ') }, [
          el('span', { class: 'retro__blabelcell' }, [
            el('span', { class: 'retro__blabel', text: b.label }),
            isActual
              ? el('span', { class: 'retro__tag retro__tag--actual', text: `실제${typeof sel.mm === 'number' && sel.mm >= 0.1 ? ` ${sel.mm.toFixed(1)}mm` : ''}` })
              : null,
            b.key === sel.picked ? el('span', { class: 'retro__tag retro__tag--pick', text: '나의 예감' }) : null,
          ]),
          el('span', { class: 'retro__btrack' }, [
            el('span', { class: 'retro__bfill', style: `width:${frac > 0 ? Math.max(frac * 100, 1.5) : 0}%;background:var(--p-${b.key})` }),
          ]),
          el('span', { class: 'retro__bpct num', text: pct(frac) }),
        ]);
      });
      parts.push(el('div', { class: 'retro__board' }, rows));
    } else {
      parts.push(
        el('p', { class: 'retro__line', text: '이 시각의 예보 기록이 없습니다 — 그날 처음 화면을 본 시각부터만 저장됩니다.' }),
      );
    }
  }

  // (2) 판정 — 일어난 결과에 그때 얼마의 확률이 걸려 있었는지가 이 문장의 주인공
  if (forecast) {
    const { time, verdict } = forecast;
    const actualLabel = bucketOf(verdict.actualKey).label;
    const probTxt = pct(verdict.prob);
    const big = (txt) => el('strong', { class: 'retro__pct', text: txt });
    const tail = verdict.hit
      ? ' 우세가 그대로 맞았습니다.'
      : verdict.prob < 0.005
        ? ' 화면에 거의 없던 경우가 일어났습니다 — 그런 날도 있습니다.'
        : verdict.prob <= 0.25
          ? ' 작은 확률이 이겼습니다.'
          : ' 우세를 제친 승리였습니다.';
    parts.push(
      el('p', { class: 'retro__line' }, [
        el('strong', { text: `${dayLabel(time, todayDate)} ${hourLabel(time)}` }),
        ` 실제 '${actualLabel}' — 그때 이 경우의 확률은 `,
        big(probTxt),
        '.',
        tail,
      ]),
    );
  }
  // (그날의 총량·적중률·평균 확률은 위 요약 줄이 담당 — 문장 중복은 두지 않는다)

  // (2.6) 기관별 적중 — 이날을 기관별로 따로 채점한 상위 3. 날짜 탭을 바꾸면
  //       그날의 순위로 재계산된다. 모델 불일치가 핵심 정보인 앱답게, 어느
  //       기관이 그날을 제대로 봤는지도 데이터로 보여준다.
  if (modelScores?.length) {
    parts.push(el('p', { class: 'retro__cap retro__cap--board', text: `기관별 적중 — 이날의 상위 3` }));
    const rows = modelScores.slice(0, 3).map((s, i) =>
      el('div', {
        class: 'mrank__row',
        title: `${MODEL_LABELS[s.model] || s.model} — 우세 시나리오 적중 ${s.hits}/${s.n}시간, 실제에 준 평균 확률 ${pct(s.meanProb)}`,
      }, [
        el('span', { class: 'mrank__rank num', text: String(i + 1) }),
        el('span', { class: 'mrank__name', text: MODEL_LABELS[s.model] || s.model }),
        el('span', { class: 'mrank__track' }, [
          el('span', { class: 'mrank__fill', style: `width:${(s.hitRate * 100).toFixed(1)}%` }),
        ]),
        el('span', { class: 'mrank__result num', text: `${s.hits}/${s.n}시간 · ${pct(s.hitRate)}` }),
      ]),
    );
    parts.push(el('div', { class: 'mrank' }, rows));
    parts.push(
      el('p', {
        class: 'mrank__note',
        text: `${modelScores.length}개 기관 각자의 우세 시나리오가 실제와 맞은 시간 비율 — 하루 순위는 크게 출렁입니다`,
      }),
    );
  }

  // (2.7) 확률 성적표 — "N%라고 했을 때 실제로 그만큼 왔나"를 확률대별 한 줄씩.
  // 막대 = 실제 비 온 비율, 세로선 = 그때 말한 평균 확률: 겹칠수록 믿을 만한 확률.
  // 3일치가 모이기 전엔 성적표 대신 조용한 초대문만 — 하루의 시간들은 함께
  // 움직여서, 하루치로 성적을 말하면 그게 또 하나의 거짓 헤드라인이 된다.
  if (calib && calib.days > 0) {
    if (calib.days < CALIB_MIN_DAYS) {
      parts.push(
        el('p', {
          class: 'retro__line calib__wait',
          text: `확률 성적표는 기록이 ${CALIB_MIN_DAYS}일 모이면 열립니다 — 지금까지 ${calib.days}일.`,
        }),
      );
    } else {
      // "N일치": days counts dates that actually have records — visits can skip
      // days, so "지난 N일" (a contiguous window) would overclaim
      parts.push(el('p', { class: 'retro__cap', text: `확률 성적표 — ${calib.days}일치 기록` }));
      const rows = calib.bins
        .filter((b) => b.n > 0)
        .map((b) => {
          const thin = b.n < CALIB_MIN_HOURS;
          const saidTxt = `${Math.round(b.lo * 100)}~${Math.round(b.hi * 100)}%`;
          return el('div', {
            class: thin ? 'calib__row calib__row--thin' : 'calib__row',
            title: thin ? `아직 ${b.n}시간뿐이라 참고만 해주세요` : `'비 올 확률 ${saidTxt}'라고 말한 ${b.n}시간 — 실제 비 ${b.wet}시간`,
          }, [
            el('span', { class: 'calib__said num', text: saidTxt }),
            el('span', { class: 'calib__track' }, [
              el('span', { class: 'calib__fill', style: `width:${(b.wetRate * 100).toFixed(1)}%` }),
              el('span', { class: 'calib__tick', style: `left:${(b.avgP * 100).toFixed(1)}%` }),
            ]),
            el('span', { class: 'calib__result num', text: `${b.n}시간 중 ${b.wet}시간 비 · ${pct(b.wetRate)}` }),
          ]);
        });
      parts.push(el('div', { class: 'calib' }, rows));
      // 종합 한 줄(브라이어) — 단일 헤드라인이 아니라 돌아보기의 조용한 장부 줄.
      // 기준선을 같이 말해줘야 숫자가 읽힌다: 0 = 완벽, 늘 반반 찍기 = 0.25.
      if (calib.brier) {
        parts.push(
          el('p', { class: 'retro__line calib__brier' }, [
            el('strong', { text: '종합 확률 점수 ' }),
            el('strong', { class: 'retro__pct num', text: calib.brier.score.toFixed(2) }),
            ` — 0에 가까울수록 정확합니다. 늘 '반반'으로 찍으면 0.25.`,
          ]),
        );
      }
      parts.push(
        el('p', {
          class: 'calib__how',
          text: '막대 = 실제로 비가 온 비율, 세로선 = 그때 말했던 평균 확률. 둘이 가까울수록 이 앱의 확률은 액면 그대로입니다.',
        }),
      );
    }
  }

  // (3) 당신의 예감 — settled hunches + running hit rate
  if (settled.length || record.length) {
    const lines = settled.slice(0, 3).map((s) =>
      el('p', { class: 'retro__hunch' }, [
        `${hourLabel(s.time)} 예감 '${bucketOf(s.picked).label}' → 실제 '${bucketOf(s.actual).label}' `,
        el('strong', { class: s.hit ? 'is-hit' : 'is-miss', text: s.hit ? '적중' : '빗나감' }),
      ]),
    );
    const hits = record.filter((r) => r.hit).length;
    parts.push(
      el('div', { class: 'retro__hunches' }, [
        el('p', { class: 'retro__line' }, [el('strong', { text: '당신의 예감' })]),
        ...lines,
        record.length
          ? el('p', { class: 'retro__tally', text: `통산 ${hits}/${record.length} 적중 (${Math.round((hits / record.length) * 100)}%)` })
          : null,
      ]),
    );
  }

  parts.push(
    el('p', {
      class: 'retro__sub',
      text:
        (predicted?.source === 'api' ? '예보 분포는 Open-Meteo 보관 예보 · ' : '') +
        '실측은 재분석 기반 근사값 · 기록은 이 기기에만 저장됩니다',
    }),
  );
  container.replaceChildren(...parts);
}

// Search suggestions dropdown.
export function renderSuggestions(listEl, matches, onPick) {
  if (!matches.length) {
    listEl.replaceChildren(el('li', { class: 'suggest__empty', text: '검색 결과가 없습니다.' }));
    listEl.hidden = false;
    return;
  }
  listEl.replaceChildren(
    ...matches.map((m, i) =>
      el('li', {
        class: 'suggest__item',
        role: 'option',
        id: `sg-${i}`,
        'aria-selected': 'false',
        onmousedown: (e) => {
          e.preventDefault();
          onPick(m);
        },
      }, [
        el('span', { text: m.name }),
        el('span', { class: 'suggest__sido', text: m.sido }),
      ]),
    ),
  );
  listEl.hidden = false;
}
