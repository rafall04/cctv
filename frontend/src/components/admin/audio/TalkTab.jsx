/*
 * Purpose: "Bicara" tab — live push-to-talk. The admin holds a button and speaks; the browser mic is
 *   encoded to G.711 u-law 16k IN the browser (an AudioWorklet) and streamed over a WebSocket to the
 *   chosen camera's ONVIF speaker in real time (server does zero transcoding). Like ATCS paging.
 * Caller: pages/AudioBroadcast.jsx.
 * Deps: audioService.talkTicket, getApiUrl, capabilityInfo, contexts, components/ui.
 * MainFuncs: TalkTab.
 * SideEffects: getUserMedia (mic), opens a WebSocket, streams audio to a camera speaker (makes sound!).
 *
 * Requires a secure context (HTTPS — the site is) and a real browser/PWA (in-app webviews block the mic).
 * The mic is captured only while the button is held; releasing (or leaving the tab/blurring) stops it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { talkTicket } from '../../../services/audioService';
import { getApiUrl } from '../../../config/config.js';
import { useNotification } from '../../../contexts/NotificationContext';
import CameraMultiSelect from './CameraMultiSelect';

// AudioWorklet: resample the mic to 16kHz, encode G.711 u-law, emit 320-byte (20ms) frames + an RMS level.
const WORKLET_SRC = `
class PTT extends AudioWorkletProcessor {
  constructor(){ super(); this.ratio = sampleRate/16000; this.phase=0; this.out=new Uint8Array(320); this.n=0; this.sq=0; this.c=0; }
  static mu(s){ const B=0x84,C=32635; let sign=(s>>8)&0x80; if(sign)s=-s; if(s>C)s=C; s+=B; let e=7; for(let m=0x4000;(s&m)===0&&e>0;m>>=1)e--; const man=(s>>(e+3))&0x0f; return (~(sign|(e<<4)|man))&0xff; }
  process(inputs){ const ch = inputs[0] && inputs[0][0]; if(!ch) return true;
    for(let i=0;i<ch.length;i++){ this.phase+=1; this.sq+=ch[i]*ch[i]; this.c++;
      if(this.phase>=this.ratio){ this.phase-=this.ratio; let v=ch[i]; if(v>1)v=1; else if(v<-1)v=-1;
        this.out[this.n++]=PTT.mu((v*32767)|0);
        if(this.n===320){ const rms=Math.sqrt(this.sq/Math.max(1,this.c)); this.sq=0; this.c=0;
          const b=this.out.slice(0).buffer; this.port.postMessage({frame:b, rms}, [b]); this.n=0; } } }
    return true; }
}
registerProcessor('ptt', PTT);
`;

export default function TalkTab({ cameras }) {
    const [cameraIds, setCameraIds] = useState([]);
    const [state, setState] = useState('idle'); // idle | connecting | onair
    const [level, setLevel] = useState(0);
    const { showNotification } = useNotification();

    const refs = useRef({ ws: null, ctx: null, node: null, stream: null, active: false, workletUrl: null });

    const cleanup = useCallback(() => {
        const r = refs.current;
        r.active = false;
        try { r.node && r.node.disconnect(); } catch { /* */ }
        try { r.stream && r.stream.getTracks().forEach((t) => t.stop()); } catch { /* */ }
        try { r.ctx && r.ctx.state !== 'closed' && r.ctx.close(); } catch { /* */ }
        try { if (r.ws && r.ws.readyState <= 1) { r.ws.send(JSON.stringify({ type: 'stop' })); r.ws.close(); } } catch { /* */ }
        if (r.workletUrl) { try { URL.revokeObjectURL(r.workletUrl); } catch { /* */ } }
        refs.current = { ws: null, ctx: null, node: null, stream: null, active: false, workletUrl: null };
        setLevel(0);
        setState('idle');
    }, []);

    const stop = useCallback(() => { if (refs.current.active || refs.current.ws) cleanup(); }, [cleanup]);

    const start = useCallback(async () => {
        if (refs.current.active) return;
        if (cameraIds.length === 0) { showNotification({ type: 'error', title: 'Pilih kamera dulu' }); return; }
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
            showNotification({ type: 'error', title: 'Mic tidak tersedia', message: 'Butuh HTTPS + browser asli (bukan in-app).' });
            return;
        }
        refs.current.active = true;
        setState('connecting');
        try {
            // 1) ticket (authed) -> WS URL on the API origin.
            const tk = await talkTicket(cameraIds);
            if (!tk.success) throw new Error(tk.message || 'Gagal tiket');
            if (!refs.current.active) return;
            const apiBase = getApiUrl() || window.location.origin;
            const ws = new WebSocket(apiBase.replace(/^http/, 'ws') + tk.data.wsPath);
            ws.binaryType = 'arraybuffer';
            refs.current.ws = ws;

            ws.onmessage = (ev) => {
                try {
                    const m = JSON.parse(ev.data);
                    if (m.type === 'ready') setState('onair');
                    else if (m.type === 'error') { showNotification({ type: 'error', title: m.message || 'Ditolak' }); stop(); }
                    else if (m.type === 'ended') stop();
                } catch { /* non-JSON */ }
            };
            ws.onclose = () => stop();
            ws.onerror = () => { showNotification({ type: 'error', title: 'Koneksi bicara gagal' }); stop(); };

            await new Promise((res, rej) => { ws.onopen = res; ws.addEventListener('error', rej, { once: true }); });
            if (!refs.current.active) return;

            // 2) mic + audio graph.
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
            refs.current.stream = stream;
            let ctx;
            try { ctx = new AudioContext({ sampleRate: 16000 }); } catch { ctx = new AudioContext(); }
            refs.current.ctx = ctx;
            const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
            refs.current.workletUrl = url;
            await ctx.audioWorklet.addModule(url);
            if (!refs.current.active) return;
            const srcNode = ctx.createMediaStreamSource(stream);
            const node = new AudioWorkletNode(ctx, 'ptt');
            refs.current.node = node;
            node.port.onmessage = (e) => {
                const r = refs.current;
                if (!r.active || !r.ws || r.ws.readyState !== 1) return;
                if (e.data.frame) { try { r.ws.send(e.data.frame); } catch { /* */ } setLevel(Math.min(1, e.data.rms * 4)); }
            };
            srcNode.connect(node);
            // A muted sink keeps the graph pulling on some browsers without echoing to the operator.
            const sink = ctx.createGain(); sink.gain.value = 0; node.connect(sink).connect(ctx.destination);
        } catch (error) {
            if (refs.current.active) showNotification({ type: 'error', title: 'Gagal bicara', message: error.message });
            cleanup();
        }
    }, [cameraIds, showNotification, stop, cleanup]);

    // Safety: releasing focus / leaving must stop a hot mic. Also clean up on unmount.
    useEffect(() => {
        const onLeave = () => stop();
        window.addEventListener('blur', onLeave);
        document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
        window.addEventListener('pagehide', onLeave);
        return () => {
            window.removeEventListener('blur', onLeave);
            window.removeEventListener('pagehide', onLeave);
            cleanup();
        };
    }, [stop, cleanup]);

    const held = state === 'onair' || state === 'connecting';

    return (
        <div className="space-y-5">
            <div className="rounded-card border border-edge bg-surface p-4 shadow-e1">
                <CameraMultiSelect cameras={cameras} value={cameraIds} onChange={setCameraIds} disabled={held} />
                <p className="mt-2 text-xs text-content-subtle">
                    Bisa banyak kamera sekaligus (paging zona) — maksimum beberapa kamera per sesi; hanya yang
                    &quot;Didukung&quot; yang berbunyi, yang sibuk dilewati. Endurance kamera murah belum teruji: uji dulu.
                </p>
            </div>

            <div className="flex flex-col items-center gap-4 rounded-card border border-edge bg-surface p-6 shadow-e1">
                <button
                    type="button"
                    disabled={cameraIds.length === 0}
                    onPointerDown={(e) => { e.preventDefault(); start(); }}
                    onPointerUp={stop}
                    onPointerCancel={stop}
                    onPointerLeave={() => { if (state !== 'idle') stop(); }}
                    className={`flex h-40 w-40 select-none items-center justify-center rounded-full border-2 text-center text-base font-semibold transition-colors ${
                        state === 'onair' ? 'border-status-live bg-status-live/15 text-status-live'
                            : state === 'connecting' ? 'border-status-warn bg-status-warn/10 text-status-warn'
                                : 'border-primary bg-primary/10 text-primary disabled:opacity-50'
                    }`}
                    style={{ touchAction: 'none' }}
                >
                    {state === 'onair' ? 'MENGUDARA…' : state === 'connecting' ? 'Menyambung…' : 'Tahan untuk\nBicara'}
                </button>

                {/* Level meter */}
                <div className="h-2 w-48 overflow-hidden rounded-full bg-surface-sunken">
                    <div className="h-full rounded-full bg-status-live transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
                </div>

                <p className="text-center text-xs text-content-subtle">
                    Tahan tombol lalu bicara — suara keluar langsung di speaker kamera. Lepas untuk berhenti.
                    Setengah-dupleks (satu arah); pakai browser asli/PWA, bukan dalam aplikasi lain.
                </p>
            </div>
        </div>
    );
}
