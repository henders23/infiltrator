import { useEffect, useRef } from 'react';
import { Engine } from '../game/engine';
import { makeDemoMission } from '../content/maps';
import { CSS, FONT_DISPLAY, FONT_MONO } from './theme';
import { useGame } from './store';

export function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const engine = useGame((s) => s.engine);
  const snapshot = useGame((s) => s.snapshot);
  const { setEngine, setSnapshot } = useGame.getState();

  // boot the engine once, into the canvas host
  useEffect(() => {
    if (!hostRef.current) return;
    const e = new Engine(makeDemoMission());
    e.onSnapshot = setSnapshot;
    let disposed = false;
    e.init(hostRef.current).then(() => {
      if (disposed) e.destroy();
    });
    setEngine(e);
    return () => {
      disposed = true;
      setEngine(null);
      e.destroy();
    };
  }, [setEngine, setSnapshot]);

  // keyboard command layer
  useEffect(() => {
    if (!engine) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.code === 'Space') {
        ev.preventDefault();
        engine.togglePause();
      } else if (ev.key.toLowerCase() === 'c') {
        engine.clearSelectedOrder();
      } else if (ev.key === 'Escape') {
        engine.selectedId = null;
      } else if (/^[1-9]$/.test(ev.key)) {
        const friendlies = engine.world.units.filter((u) => u.faction === 'friendly');
        const u = friendlies[Number(ev.key) - 1];
        if (u) engine.selectUnit(u.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);

  const friendlies = snapshot?.units.filter((u) => u.faction === 'friendly') ?? [];
  const contacts = snapshot?.units.filter((u) => u.faction === 'hostile' && u.visible) ?? [];
  const mm = Math.floor((snapshot?.time ?? 0) / 60);
  const ss = Math.floor((snapshot?.time ?? 0) % 60);
  const clock = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;

  return (
    <div style={styles.root}>
      <style>{globalCss}</style>

      {/* tactical viewport (Pixi mounts here) */}
      <div style={styles.viewportWrap}>
        <div style={styles.commandBar}>
          <span style={styles.title}>INFILTRATOR</span>
          <span style={styles.mission}>{snapshot?.missionName ?? '—'}</span>
          <span style={{ flex: 1 }} />
          <span style={styles.clock}>{clock}</span>
          <button
            className="btn go"
            onClick={() => engine?.togglePause()}
            title="Execute / Pause (Space)"
          >
            {snapshot?.paused ? '▶ EXECUTE' : '‖ PAUSE'}
          </button>
        </div>
        <div ref={hostRef} style={styles.host} />
        <div style={styles.stateTag}>
          STATE: <b style={{ color: snapshot?.paused ? CSS.cyan : CSS.orange }}>
            {snapshot?.paused ? 'PLANNING' : 'EXECUTING'}
          </b>
        </div>
      </div>

      {/* right console sidebar */}
      <aside style={styles.side}>
        <div style={styles.sideHead}>
          <div style={styles.sideTitle}>FIRETEAM</div>
          <div style={styles.sideSub}>{friendlies.length} DEPLOYED · {contacts.length} CONTACT</div>
        </div>

        <div style={styles.roster}>
          {friendlies.map((u, i) => {
            const sel = u.id === snapshot?.selectedId;
            return (
              <div
                key={u.id}
                className={'unit' + (sel ? ' sel' : '')}
                onClick={() => engine?.selectUnit(u.id)}
              >
                <div
                  className="dot"
                  style={{ background: u.alive ? CSS.cyan : CSS.muted }}
                />
                <div style={{ flex: 1 }}>
                  <div className="nm">
                    <span style={{ color: CSS.muted }}>{i + 1}</span> {u.name}
                    {u.needsAttention && <span className="attn"> ●</span>}
                  </div>
                  <div className="sub">
                    {u.alive ? `HP ${u.hp} · ${u.status}` : 'K.I.A.'}
                  </div>
                  <div className="hpbar">
                    <i style={{ width: `${Math.max(0, (u.hp / u.maxHp) * 100)}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={styles.cmd}>
          <button className="btn" onClick={() => engine?.clearSelectedOrder()}>
            CLEAR ORDER
          </button>
        </div>

        <div style={styles.help}>
          <div><span className="k">Click soldier</span> / <span className="k">1–4</span> select</div>
          <div><span className="k">Left-click</span> set path (auto) · <span className="k">Shift</span> add leg</div>
          <div><span className="k">Right-click</span> clear order · <span className="k">C</span> clear</div>
          <div><span className="k">Space</span> execute / pause</div>
          <div><span className="k">Wheel</span> zoom · <span className="k">Middle-drag</span> pan</div>
          <div style={{ color: CSS.muted, marginTop: 4 }}>
            Orders persist — untouched soldiers hold their last order.
          </div>
        </div>

        <div style={styles.log}>
          {(snapshot?.log ?? []).map((line, i) => (
            <div key={i} className={logClass(line)}>{line}</div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function logClass(line: string): string {
  if (line.startsWith('●') || line.startsWith('‖')) return 'log warn';
  if (line.startsWith('▶')) return 'log ok';
  return 'log';
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', height: '100vh', width: '100vw', background: CSS.navy, color: CSS.ink, fontFamily: FONT_DISPLAY, overflow: 'hidden' },
  viewportWrap: { position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  commandBar: { display: 'flex', alignItems: 'center', gap: 14, padding: '8px 14px', background: CSS.panel, borderBottom: `1px solid ${CSS.line}`, zIndex: 2 },
  title: { color: CSS.cyan, fontWeight: 700, letterSpacing: 3, fontSize: 16 },
  mission: { color: CSS.muted, fontFamily: FONT_MONO, fontSize: 11, letterSpacing: 1 },
  clock: { color: CSS.ink, fontFamily: FONT_MONO, fontSize: 14, letterSpacing: 2 },
  host: { flex: 1, minHeight: 0, position: 'relative' },
  stateTag: { position: 'absolute', left: 16, bottom: 12, fontFamily: FONT_MONO, fontSize: 12, letterSpacing: 1, background: 'rgba(5,8,13,.6)', padding: '4px 8px', borderRadius: 3, pointerEvents: 'none' },
  side: { width: 300, flex: 'none', background: CSS.panel, borderLeft: `1px solid ${CSS.line}`, display: 'flex', flexDirection: 'column' },
  sideHead: { padding: '12px 14px', borderBottom: `1px solid ${CSS.line}` },
  sideTitle: { color: CSS.cyan, letterSpacing: 3, fontWeight: 700, fontSize: 13 },
  sideSub: { color: CSS.muted, fontFamily: FONT_MONO, fontSize: 10, letterSpacing: 1, marginTop: 3 },
  roster: { flex: 1, overflow: 'auto' },
  cmd: { padding: '10px 14px', borderTop: `1px solid ${CSS.line}` },
  help: { padding: '10px 14px', fontSize: 11, color: CSS.muted, lineHeight: 1.8, borderTop: `1px solid ${CSS.line}` },
  log: { height: 118, overflow: 'auto', padding: '8px 14px', fontSize: 11, lineHeight: 1.6, borderTop: `1px solid ${CSS.line}`, fontFamily: FONT_MONO, color: CSS.muted },
};

const globalCss = `
  * { box-sizing: border-box; }
  html, body, #root { margin: 0; height: 100%; }
  .btn { width: 100%; background: #12202e; color: ${CSS.ink}; border: 1px solid ${CSS.cyanDim};
    padding: 8px 12px; letter-spacing: 2px; font-weight: 700; cursor: pointer; border-radius: 3px;
    font-family: ${FONT_DISPLAY}; font-size: 12px; }
  .btn:hover { border-color: ${CSS.cyan}; color: ${CSS.cyan}; }
  .command-bar .btn { width: auto; }
  .btn.go { width: auto; border-color: ${CSS.orange}; color: ${CSS.orange}; padding: 6px 14px; }
  .btn.go:hover { background: #241206; }
  .unit { display: flex; align-items: center; gap: 10px; padding: 9px 14px;
    border-bottom: 1px solid ${CSS.line}; cursor: pointer; }
  .unit:hover { background: #0f1826; }
  .unit.sel { background: #0f1c28; box-shadow: inset 3px 0 0 ${CSS.cyan}; }
  .unit .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
  .unit .nm { font-weight: 600; letter-spacing: 1px; font-size: 14px; }
  .unit .attn { color: ${CSS.orange}; }
  .unit .sub { font-size: 11px; color: ${CSS.muted}; font-family: ${FONT_MONO}; }
  .unit .hpbar { height: 4px; background: #22303f; border-radius: 2px; margin-top: 3px; width: 150px; overflow: hidden; }
  .unit .hpbar > i { display: block; height: 100%; background: ${CSS.cyan}; }
  .k { color: ${CSS.cyan}; font-family: ${FONT_MONO}; }
  .log.hit { color: ${CSS.red}; } .log.ok { color: ${CSS.cyan}; } .log.warn { color: ${CSS.orange}; }
  ::-webkit-scrollbar { width: 8px; } ::-webkit-scrollbar-thumb { background: #1b2a3c; border-radius: 4px; }
`;
