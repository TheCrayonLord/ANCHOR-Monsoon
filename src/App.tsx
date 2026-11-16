// Application shell: menu bar, options bar, toolbar, document tabs, canvas, panel dock, status bar and the phone layout.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { app } from './app';
import { MenuBar, handleKey } from './ui/Menus';
import { OptionsBar } from './ui/OptionsBar';
import { Toolbar } from './ui/Toolbar';
import { View } from './ui/View';
import { Dock } from './ui/Panels';
import { Dialogs } from './ui/Dialogs';
import { run, pasteCanvas, openFiles } from './cmds';
import { storeRecovery, listRecovery, fileToCanvas } from './engine/io';
import { toolName } from './ui/Toolbar';
import * as I from 'lucide-react';

(window as any).__monsoonRun = run;
// restore preferences saved by the Preferences dialog
try { const p = JSON.parse(localStorage.getItem('monsoon-prefs') || 'null'); if (p) Object.assign(app.prefs, p); } catch { /* ignore */ }

function useApp() { useSyncExternalStore(app.subscribe, app.getVersion); }
function usePhone() {
  const q = '(max-width: 900px)';
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => { const mq = matchMedia(q); const f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, []);
  return m;
}

function Tabs() {
  if (!app.docs.length) return null;
  return (
    <div className="doc-tabs" role="tablist">
      {app.docs.map((d) => (
        <div key={d.id} role="tab" aria-selected={d.id === app.activeId} className={'doc-tab' + (d.id === app.activeId ? ' on' : '')} onClick={() => { app.activeId = d.id; app.editMask = false; app.emit(); }} title={d.name}>
          <span className="doc-name">{d.name}{d.dirty ? ' •' : ''}</span><span className="muted small">{Math.round(d.zoom * 100)}%</span>
          <button className="icon-btn" aria-label={`Close ${d.name}`} onClick={(e) => { e.stopPropagation(); app.activeId = d.id; run('close'); }}><I.X size={12} /></button>
        </div>
      ))}
      <button className="icon-btn" title="New document" onClick={() => app.openDialog('new')}><I.Plus size={14} /></button>
    </div>
  );
}

function StatusBar() {
  const d = app.doc;
  return (
    <footer className="statusbar">
      {d ? <>
        <span>{Math.round(d.zoom * 100)}%</span>
        <span>{d.w} × {d.h} px · {d.s.resolution} ppi</span>
        <span className="hide-phone">{d.s.mode === 'rgb' ? 'RGB/8' : d.s.mode}</span>
        <span className="hide-phone">{d.active?.name}{app.editMask ? ' (mask)' : ''}</span>
        {d.quickMask && <span className="badge">Quick Mask</span>}
        {app.recording && <span className="badge rec">● Recording</span>}
      </> : <span>No document</span>}
      <span className="pspacer" />
      <span className="hide-phone muted">{toolName(app.tool)}</span>
    </footer>
  );
}

function Toasts() {
  return <div className="toasts" aria-live="polite">{app.toasts.map((t) => <div key={t.id} className={'toast ' + (t.kind || '')}>{t.text}</div>)}</div>;
}

const SHEETS: [string, string, React.ReactNode, string[]][] = [
  ['layers', 'Layers', <I.Layers size={18} />, ['layers', 'channels', 'paths']],
  ['props', 'Adjust', <I.SlidersHorizontal size={18} />, ['properties', 'adjustments', 'styles']],
  ['color', 'Color', <I.Palette size={18} />, ['color', 'swatches', 'gradients', 'patterns', 'shapes']],
  ['brush', 'Brush', <I.Brush size={18} />, ['brushes']],
  ['history', 'History', <I.History size={18} />, ['history', 'actions', 'comps', 'timeline']],
];
function PhoneBar() {
  const m = app.mobilePanel;
  return (
    <>
      {m && <div className="sheet" role="dialog" aria-label={SHEETS.find((s) => s[0] === m)?.[1]}>
        <div className="sheet-grab" onClick={() => { app.mobilePanel = null; app.emit(); }}><span /></div>
        <Dock only={SHEETS.find((s) => s[0] === m)![3]} />
      </div>}
      <nav className="phone-tabs">
        {SHEETS.map(([k, l, ic]) => <button key={k} className={m === k ? 'on' : ''} onClick={() => { app.mobilePanel = m === k ? null : k; app.emit(); }}>{ic}<span>{l}</span></button>)}
        <button onClick={() => run('undo')} aria-label="Undo" disabled={!app.doc}><I.Undo2 size={18} /><span>Undo</span></button>
      </nav>
    </>
  );
}

export default function App() {
  useApp();
  const phone = usePhone();

  useEffect(() => {
    const kd = (e: KeyboardEvent) => handleKey(e);
    const paste = async (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input, textarea')) return;
      const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); pasteCanvas(await fileToCanvas(f, f.name)); }
    };
    window.addEventListener('keydown', kd); window.addEventListener('paste', paste);
    const before = (e: BeforeUnloadEvent) => { if (app.docs.some((d) => d.dirty)) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', before);
    // files opened through the installed app's file handler
    const lq = (window as any).launchQueue; if (lq) lq.setConsumer(async (p: any) => { const files = await Promise.all((p.files || []).map((h: any) => h.getFile())); if (files.length) openFiles(files); });
    listRecovery().then((r) => { if (r.length) app.toast(`${r.length} unsaved document${r.length > 1 ? 's were' : ' was'} recovered. Open File › Recent to restore.`); });
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('paste', paste); window.removeEventListener('beforeunload', before); };
  }, []);

  // auto-save dirty documents for crash recovery
  useEffect(() => {
    const mins = app.prefs.autosaveMinutes; if (!mins) return;
    const t = setInterval(() => { for (const d of app.docs) if (d.dirty && (d as any).__saved !== d.version) { (d as any).__saved = d.version; storeRecovery(d); } }, mins * 60000);
    return () => clearInterval(t);
  }, [app.prefs.autosaveMinutes]);

  const sm = app.view.screenMode;
  const cls = ['app', 'theme-' + app.prefs.theme, phone ? 'phone' : 'desktop', 'mode-' + sm, app.mobilePanel ? 'sheet-open' : ''].join(' ');
  return (
    <div className={cls} style={{ ['--ui-scale' as any]: app.prefs.interfaceScale }}>
      {sm !== 'full' && <MenuBar />}
      {sm !== 'full' && <OptionsBar />}
      <div className="workspace">
        {sm !== 'full' && <Toolbar />}
        <main className="center">
          {sm === 'standard' && <Tabs />}
          <View />
        </main>
        {sm === 'standard' && !phone && <Dock />}
      </div>
      {sm !== 'full' && !phone && <StatusBar />}
      {phone && sm !== 'full' && <PhoneBar />}
      {sm === 'full' && <button className="exit-full" onClick={() => { app.view.screenMode = 'standard'; app.emit(); }}>Exit full screen (F)</button>}
      <Dialogs />
      <Toasts />
    </div>
  );
}
// handles for automated tests
import { FILTERS, defaults as filterDefaults } from './engine/filterdefs';
import { ADJ_TYPES } from './cmds';
import { ADJ_DEFAULTS } from './engine/adjust';
import * as IO from './engine/io';
import * as RENDER from './engine/render';
import * as VECTOR from './engine/vector';
import { newLayer as newLayerFn } from './engine/doc';
Object.assign(window as any, { __monsoonRender: RENDER, __monsoonVector: VECTOR, __monsoonNewLayer: newLayerFn, __monsoonFilters: { FILTERS, defaults: filterDefaults }, __monsoonAdj: ADJ_TYPES, __monsoonAdjDefaults: ADJ_DEFAULTS, __monsoonIO: IO });
