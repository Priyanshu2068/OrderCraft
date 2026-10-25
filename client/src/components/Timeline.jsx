import { dateTime, STAGES, STAGE_LABEL } from '../format.js';

// Horizontal progress through the order stages.
export function Stepper({ status }) {
  if (status === 'cancelled') return <div className="stepper"><span className="step cancelled">Cancelled</span></div>;
  const idx = STAGES.indexOf(status === 'draft' ? 'quote' : status);
  return (
    <div className="stepper">
      {STAGES.map((s, i) => (
        <div key={s} className={`step ${i < idx ? 'done' : ''} ${i === idx ? 'current' : ''}`}>
          <span className="dot">{i < idx ? '✓' : i + 1}</span>
          <span className="label">{STAGE_LABEL[s]}</span>
        </div>
      ))}
    </div>
  );
}

// Event history; `events` = [{ status, note, actor?, created_at }]
export function Timeline({ events }) {
  return (
    <ul className="timeline">
      {[...events].reverse().map((e, i) => (
        <li key={i}>
          <b>{STAGE_LABEL[e.status] ?? e.status}</b>
          {e.note && <span> — {e.note}</span>}
          <div className="muted">{dateTime(e.created_at)}{e.actor ? ` · ${e.actor}` : ''}</div>
        </li>
      ))}
    </ul>
  );
}
